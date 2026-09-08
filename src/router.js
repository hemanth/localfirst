/**
 * Intelligent hybrid workload router for localfirst.
 * Evaluates device readiness, user-defined rules, task complexity,
 * and confidence scoring to balance execution between on-device and cloud.
 */

export class Router {
  constructor(options = {}) {
    this.mode = options.mode || 'auto'; // 'auto' | 'prefer-local' | 'prefer-cloud' | 'local-only' | 'cloud-only'
    this.confidenceThreshold = options.confidenceThreshold ?? 0.70;
    this.customProbe = typeof options.probe === 'function' ? options.probe : null;
    this.customRouter = typeof options.router === 'function' ? options.router : null;
    this.rules = Array.isArray(options.rules) ? options.rules : [];
    this.taskOverrides = {
      llm: options.llm || {},
      stt: options.stt || {},
      tts: options.tts || {}
    };
  }

  /**
   * Decide whether to execute locally or in the cloud.
   *
   * @param {string} taskType - 'llm' | 'stt' | 'tts'
   * @param {any} input - Prompt text or audio data
   * @param {object} deviceProfile - Capability telemetry from detect()
   * @param {object} runOptions - Per-call options
   * @returns {{ target: 'local' | 'cloud', confidence: number, complexity: number, reason: string }}
   */
  decide(taskType, input, deviceProfile, runOptions = {}) {
    const taskConfig = this.taskOverrides[taskType] || {};
    const mode = runOptions.mode || taskConfig.mode || this.mode;
    const threshold = runOptions.confidenceThreshold ?? runOptions.threshold ?? taskConfig.threshold ?? this.confidenceThreshold;
    const isCapable = Boolean(runOptions.hasLocalEngine) || (deviceProfile?.models?.[taskType]?.capable ?? false);
    const isOnline = deviceProfile?.online ?? true;

    // 1. Explicit per-call target override ('local' | 'cloud')
    if (runOptions.target === 'local' || runOptions.target === 'cloud') {
      if (runOptions.target === 'local' && !isCapable) {
        throw new Error(`Device incapable of running ${taskType} for requested target: 'local'`);
      }
      return {
        target: runOptions.target,
        confidence: 1.0,
        complexity: runOptions.target === 'local' ? 0.1 : 0.9,
        reason: `explicit target override: '${runOptions.target}'`
      };
    }

    // 2. Strict mode constraints
    if (mode === 'cloud-only') {
      return {
        target: 'cloud',
        confidence: 1.0,
        complexity: 1.0,
        reason: 'cloud-only mode forced'
      };
    }

    if (mode === 'local-only') {
      if (!isCapable) {
        throw new Error(`Device incapable of running ${taskType} in local-only mode`);
      }
      return {
        target: 'local',
        confidence: 1.0,
        complexity: 0.0,
        reason: 'local-only mode forced'
      };
    }

    // 3. Network offline override
    if (!isOnline) {
      if (isCapable) {
        return {
          target: 'local',
          confidence: 0.8,
          complexity: 0.5,
          reason: 'device offline: routing locally'
        };
      }
      throw new Error(`Device is offline and cannot run ${taskType} locally`);
    }

    // If local hardware is completely incapable and no local engine is configured
    if (!isCapable) {
      return {
        target: 'cloud',
        confidence: 1.0,
        complexity: 1.0,
        reason: `device hardware incapable of on-device ${taskType}: ${deviceProfile?.models?.[taskType]?.reason || 'insufficient compute'}`
      };
    }

    if (mode === 'prefer-cloud') {
      return {
        target: 'cloud',
        confidence: 1.0,
        complexity: 0.8,
        reason: 'prefer-cloud mode active'
      };
    }

    // 4. Calculate complexity and confidence
    const complexity = this.estimateComplexity(taskType, input);
    const confidence = this.estimateConfidence(taskType, input, complexity, deviceProfile);

    // 5. User-defined routing rules
    const rules = [...(runOptions.rules || []), ...this.rules];
    for (const rule of rules) {
      let matched = false;

      if (rule.match && typeof input === 'string') {
        if (rule.match instanceof RegExp) {
          matched = rule.match.test(input);
        } else if (typeof rule.match === 'string') {
          matched = input.includes(rule.match);
        }
      }

      if (typeof rule.if === 'function') {
        matched = Boolean(rule.if({ task: taskType, input, complexity, confidence, device: deviceProfile }));
      }

      if (matched && (rule.target === 'local' || rule.target === 'cloud')) {
        return {
          target: rule.target,
          confidence,
          complexity,
          reason: rule.reason || `matched rule: ${rule.match || 'custom predicate'}`
        };
      }
    }

    // 6. Custom router callback function
    const customRouter = runOptions.router || this.customRouter;
    if (typeof customRouter === 'function') {
      const customDecision = customRouter({
        task: taskType,
        input,
        complexity,
        confidence,
        device: deviceProfile,
        options: runOptions
      });
      if (customDecision === 'local' || customDecision === 'cloud') {
        return {
          target: customDecision,
          confidence,
          complexity,
          reason: 'custom router function returned decision'
        };
      }
    }

    if (mode === 'prefer-local') {
      return {
        target: 'local',
        confidence,
        complexity,
        reason: 'prefer-local mode active'
      };
    }

    // 7. Auto Mode: Confidence and Complexity thresholding
    if (confidence >= threshold && complexity < 0.6) {
      return {
        target: 'local',
        confidence,
        complexity,
        reason: `local confidence (${confidence.toFixed(2)}) >= threshold (${threshold})`
      };
    }

    return {
      target: 'cloud',
      confidence,
      complexity,
      reason: `escalated to cloud: confidence (${confidence.toFixed(2)}) < threshold (${threshold}) or complexity (${complexity.toFixed(2)}) high`
    };
  }

  /**
   * Estimates task complexity [0.0 - 1.0].
   */
  estimateComplexity(taskType, input) {
    if (taskType === 'stt' || taskType === 'tts') {
      if (typeof input === 'string') {
        return Math.min(1.0, +(input.length / 800).toFixed(2));
      }
      return 0.2;
    }

    if (typeof input !== 'string') {
      return 0.5;
    }

    let score = 0.15;
    const length = input.length;

    // Length penalty
    if (length > 1000) score += 0.35;
    else if (length > 300) score += 0.2;

    // Heavy reasoning keywords
    const complexPatterns = [
      /\b(solve|mathematical|proof|algorithm|optimize|refactor|benchmark)\b/i,
      /\b(architecture|distributed|deep analysis|step-by-step reasoning|synthesis)\b/i,
      /```[\s\S]*```/, // code block
      /\b(hypothesis|consensus|rigorous|comprehensive)\b/i
    ];

    for (const pattern of complexPatterns) {
      if (pattern.test(input)) {
        score += 0.2;
      }
    }

    return Math.min(1.0, +score.toFixed(2));
  }

  /**
   * Estimates model confidence P(correct) [0.0 - 1.0].
   * Can be hooked to a neural probe or uses heuristic scoring.
   */
  estimateConfidence(taskType, input, complexity, deviceProfile) {
    if (this.customProbe) {
      try {
        const probed = this.customProbe({ taskType, input, complexity, deviceProfile });
        if (typeof probed === 'number' && !Number.isNaN(probed)) {
          return Math.max(0, Math.min(1, probed));
        }
      } catch {
        // probe failed, fallback to default heuristic
      }
    }

    // Confidence curve: higher complexity drops confidence of small on-device models
    let conf = 0.98 - (complexity * 0.55);

    const tier = deviceProfile?.models?.[taskType]?.tier;
    if (tier === 'webgpu') {
      conf += 0.05;
    } else if (tier === 'wasm' || tier === 'wasm-simd') {
      conf -= 0.05;
    }

    return Math.max(0.05, Math.min(0.99, +conf.toFixed(2)));
  }
}
