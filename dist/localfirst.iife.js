var localfirstBundle = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.js
  var index_exports = {};
  __export(index_exports, {
    CloudProvider: () => CloudProvider,
    HybridEngine: () => HybridEngine,
    LocalProvider: () => LocalProvider,
    Router: () => Router,
    default: () => localfirst,
    detect: () => detect,
    hybrid: () => localfirst,
    localfirst: () => localfirst
  });

  // src/detect.js
  var memoryCache = null;
  async function detect(options = {}) {
    const useCache = options.cache !== false;
    const forceRefresh = options.forceRefresh === true;
    const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";
    const isNode = typeof process !== "undefined" && process.versions && !!process.versions.node;
    const currentRuntime = isBrowser ? "browser" : isNode ? "node" : "unknown";
    if (useCache && !forceRefresh && memoryCache && memoryCache.runtime === currentRuntime) {
      const isOnline = isBrowser ? navigator.onLine !== false : true;
      return { ...memoryCache, online: isOnline, cached: true };
    }
    let totalMemoryGb = 4;
    let freeMemoryGb = null;
    let cores = 4;
    let online = true;
    let hasWebGPU = false;
    let gpuInfo = { webgpu: false, adapter: null };
    let hasSpeechRecognition = false;
    let hasSpeechSynthesis = false;
    const wasmSimd = checkWasmSimd();
    if (isBrowser) {
      online = navigator.onLine !== false;
      cores = navigator.hardwareConcurrency || 4;
      if (navigator.deviceMemory) {
        totalMemoryGb = navigator.deviceMemory;
      }
      if (navigator.gpu && typeof navigator.gpu.requestAdapter === "function") {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          if (adapter) {
            hasWebGPU = true;
            gpuInfo = {
              webgpu: true,
              adapter: adapter.info?.device || "WebGPU Device"
            };
          }
        } catch {
          gpuInfo = { webgpu: false, adapter: null };
        }
      }
      hasSpeechRecognition = Boolean(
        window.SpeechRecognition || window.webkitSpeechRecognition
      );
      hasSpeechSynthesis = Boolean(
        window.speechSynthesis && typeof window.speechSynthesis.speak === "function"
      );
    }
    if (isNode && !isBrowser) {
      try {
        const osModule = "node:os";
        const os = await import(osModule);
        totalMemoryGb = +(os.totalmem() / 1024 ** 3).toFixed(2);
        freeMemoryGb = +(os.freemem() / 1024 ** 3).toFixed(2);
        cores = os.cpus()?.length || 4;
      } catch {
      }
    }
    const canLlm = hasWebGPU || totalMemoryGb >= 4 && cores >= 4 && wasmSimd;
    const llmTier = hasWebGPU ? "webgpu" : canLlm ? "wasm-simd" : "none";
    const canStt = hasSpeechRecognition || totalMemoryGb >= 2 && cores >= 2;
    const sttTier = hasSpeechRecognition ? "native-speech" : canStt ? "wasm" : "none";
    const canTts = hasSpeechSynthesis || totalMemoryGb >= 2 && cores >= 2;
    const ttsTier = hasSpeechSynthesis ? "native-speech" : canTts ? "wasm" : "none";
    const result = {
      runtime: isBrowser ? "browser" : isNode ? "node" : "unknown",
      cores,
      memory: {
        totalGb: totalMemoryGb,
        freeGb: freeMemoryGb
      },
      gpu: gpuInfo,
      wasmSimd,
      online,
      models: {
        llm: {
          capable: canLlm,
          tier: llmTier,
          reason: canLlm ? "Sufficient resources for on-device LLM" : "Requires WebGPU or >= 4GB RAM + SIMD"
        },
        stt: {
          capable: canStt,
          tier: sttTier,
          reason: canStt ? "Speech recognition supported" : "Requires Speech API or >= 2GB RAM"
        },
        tts: {
          capable: canTts,
          tier: ttsTier,
          reason: canTts ? "Speech synthesis supported" : "Requires SpeechSynthesis or >= 2GB RAM"
        }
      }
    };
    memoryCache = result;
    return result;
  }
  function checkWasmSimd() {
    try {
      if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") {
        return false;
      }
      const bytes = new Uint8Array([
        0,
        97,
        115,
        109,
        1,
        0,
        0,
        0,
        1,
        5,
        1,
        96,
        0,
        1,
        123,
        3,
        2,
        1,
        0,
        10,
        22,
        1,
        20,
        0,
        253,
        12,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        11
      ]);
      return WebAssembly.validate(bytes);
    } catch {
      return false;
    }
  }

  // src/router.js
  var Router = class {
    constructor(options = {}) {
      this.mode = options.mode || "auto";
      this.confidenceThreshold = options.confidenceThreshold ?? 0.7;
      this.customProbe = typeof options.probe === "function" ? options.probe : null;
      this.customRouter = typeof options.router === "function" ? options.router : null;
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
      if (runOptions.target === "local" || runOptions.target === "cloud") {
        if (runOptions.target === "local" && !isCapable) {
          throw new Error(`Device incapable of running ${taskType} for requested target: 'local'`);
        }
        return {
          target: runOptions.target,
          confidence: 1,
          complexity: runOptions.target === "local" ? 0.1 : 0.9,
          reason: `explicit target override: '${runOptions.target}'`
        };
      }
      if (mode === "cloud-only") {
        return {
          target: "cloud",
          confidence: 1,
          complexity: 1,
          reason: "cloud-only mode forced"
        };
      }
      if (mode === "local-only") {
        if (!isCapable) {
          throw new Error(`Device incapable of running ${taskType} in local-only mode`);
        }
        return {
          target: "local",
          confidence: 1,
          complexity: 0,
          reason: "local-only mode forced"
        };
      }
      if (!isOnline) {
        if (isCapable) {
          return {
            target: "local",
            confidence: 0.8,
            complexity: 0.5,
            reason: "device offline: routing locally"
          };
        }
        throw new Error(`Device is offline and cannot run ${taskType} locally`);
      }
      if (!isCapable) {
        return {
          target: "cloud",
          confidence: 1,
          complexity: 1,
          reason: `device hardware incapable of on-device ${taskType}: ${deviceProfile?.models?.[taskType]?.reason || "insufficient compute"}`
        };
      }
      if (mode === "prefer-cloud") {
        return {
          target: "cloud",
          confidence: 1,
          complexity: 0.8,
          reason: "prefer-cloud mode active"
        };
      }
      const complexity = this.estimateComplexity(taskType, input);
      const confidence = this.estimateConfidence(taskType, input, complexity, deviceProfile);
      const rules = [...runOptions.rules || [], ...this.rules];
      for (const rule of rules) {
        let matched = false;
        if (rule.match && typeof input === "string") {
          if (rule.match instanceof RegExp) {
            matched = rule.match.test(input);
          } else if (typeof rule.match === "string") {
            matched = input.includes(rule.match);
          }
        }
        if (typeof rule.if === "function") {
          matched = Boolean(rule.if({ task: taskType, input, complexity, confidence, device: deviceProfile }));
        }
        if (matched && (rule.target === "local" || rule.target === "cloud")) {
          return {
            target: rule.target,
            confidence,
            complexity,
            reason: rule.reason || `matched rule: ${rule.match || "custom predicate"}`
          };
        }
      }
      const customRouter = runOptions.router || this.customRouter;
      if (typeof customRouter === "function") {
        const customDecision = customRouter({
          task: taskType,
          input,
          complexity,
          confidence,
          device: deviceProfile,
          options: runOptions
        });
        if (customDecision === "local" || customDecision === "cloud") {
          return {
            target: customDecision,
            confidence,
            complexity,
            reason: "custom router function returned decision"
          };
        }
      }
      if (mode === "prefer-local") {
        return {
          target: "local",
          confidence,
          complexity,
          reason: "prefer-local mode active"
        };
      }
      if (confidence >= threshold && complexity < 0.6) {
        return {
          target: "local",
          confidence,
          complexity,
          reason: `local confidence (${confidence.toFixed(2)}) >= threshold (${threshold})`
        };
      }
      return {
        target: "cloud",
        confidence,
        complexity,
        reason: `escalated to cloud: confidence (${confidence.toFixed(2)}) < threshold (${threshold}) or complexity (${complexity.toFixed(2)}) high`
      };
    }
    /**
     * Estimates task complexity [0.0 - 1.0].
     */
    estimateComplexity(taskType, input) {
      if (taskType === "stt" || taskType === "tts") {
        if (typeof input === "string") {
          return Math.min(1, +(input.length / 800).toFixed(2));
        }
        return 0.2;
      }
      if (typeof input !== "string") {
        return 0.5;
      }
      let score = 0.15;
      const length = input.length;
      if (length > 1e3) score += 0.35;
      else if (length > 300) score += 0.2;
      const complexPatterns = [
        /\b(solve|mathematical|proof|algorithm|optimize|refactor|benchmark)\b/i,
        /\b(architecture|distributed|deep analysis|step-by-step reasoning|synthesis)\b/i,
        /```[\s\S]*```/,
        // code block
        /\b(hypothesis|consensus|rigorous|comprehensive)\b/i
      ];
      for (const pattern of complexPatterns) {
        if (pattern.test(input)) {
          score += 0.2;
        }
      }
      return Math.min(1, +score.toFixed(2));
    }
    /**
     * Estimates model confidence P(correct) [0.0 - 1.0].
     * Can be hooked to a neural probe or uses heuristic scoring.
     */
    estimateConfidence(taskType, input, complexity, deviceProfile) {
      if (this.customProbe) {
        try {
          const probed = this.customProbe({ taskType, input, complexity, deviceProfile });
          if (typeof probed === "number" && !Number.isNaN(probed)) {
            return Math.max(0, Math.min(1, probed));
          }
        } catch {
        }
      }
      let conf = 0.98 - complexity * 0.55;
      const tier = deviceProfile?.models?.[taskType]?.tier;
      if (tier === "webgpu") {
        conf += 0.05;
      } else if (tier === "wasm" || tier === "wasm-simd") {
        conf -= 0.05;
      }
      return Math.max(0.05, Math.min(0.99, +conf.toFixed(2)));
    }
  };

  // src/providers/local.js
  var LocalProvider = class {
    constructor(options = {}) {
      this.engines = {
        llm: options.llm || null,
        stt: options.stt || null,
        tts: options.tts || null
      };
      this.loaded = {
        llm: false,
        stt: false,
        tts: false
      };
      this.states = {
        llm: { state: "unloaded", loadedAt: null },
        stt: { state: "unloaded", loadedAt: null },
        tts: { state: "unloaded", loadedAt: null }
      };
    }
    /**
     * Inspect current model lifecycle state.
     */
    status(taskType) {
      if (taskType) {
        return this.states[taskType] || { state: "unloaded" };
      }
      return { ...this.states };
    }
    /**
     * Preload / warm up a local model.
     */
    async load(taskType) {
      if (this.loaded[taskType]) return true;
      this.states[taskType] = { state: "loading", loadedAt: null };
      try {
        if (this.engines[taskType]?.load) {
          await this.engines[taskType].load();
        }
        this.loaded[taskType] = true;
        this.states[taskType] = { state: "resident", loadedAt: Date.now() };
        return true;
      } catch (err) {
        this.states[taskType] = { state: "error", error: err.message };
        throw err;
      }
    }
    /**
     * Evict / unload a local model from memory.
     */
    async unload(taskType) {
      if (this.engines[taskType]?.unload) {
        await this.engines[taskType].unload();
      }
      this.loaded[taskType] = false;
      this.states[taskType] = { state: "unloaded", loadedAt: null };
      return true;
    }
    /**
     * Generate text response using local LLM.
     */
    async generate(prompt, options = {}) {
      const startTime = Date.now();
      if (this.engines.llm?.generate) {
        const res = await this.engines.llm.generate(prompt, options);
        return {
          text: typeof res === "string" ? res : res.text,
          confidence: res.confidence ?? 0.88,
          latency: Date.now() - startTime,
          source: "local"
        };
      }
      return {
        text: `[local] Processed: ${prompt}`,
        confidence: 0.85,
        latency: Date.now() - startTime,
        source: "local"
      };
    }
    /**
     * Stream text tokens using local LLM.
     */
    async *generateStream(prompt, options = {}) {
      if (this.engines.llm?.generateStream) {
        yield* this.engines.llm.generateStream(prompt, options);
        return;
      }
      const res = await this.generate(prompt, options);
      const tokens = res.text.split(/(\s+)/);
      let accumulated = "";
      for (let i = 0; i < tokens.length; i++) {
        accumulated += tokens[i];
        yield {
          token: tokens[i],
          text: accumulated,
          source: "local",
          confidence: res.confidence,
          done: i === tokens.length - 1
        };
      }
    }
    /**
     * Transcribe audio to text using local STT.
     */
    async transcribe(audio, options = {}) {
      const startTime = Date.now();
      if (this.engines.stt?.transcribe) {
        const res = await this.engines.stt.transcribe(audio, options);
        return {
          text: typeof res === "string" ? res : res.text,
          confidence: res.confidence ?? 0.9,
          latency: Date.now() - startTime,
          source: "local"
        };
      }
      if (typeof window !== "undefined") {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition && (!audio || options.mic)) {
          return new Promise((resolve, reject) => {
            const recognition = new SpeechRecognition();
            recognition.lang = options.lang || "en-US";
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.onresult = (e) => {
              const transcript = e.results[0][0].transcript;
              resolve({
                text: transcript,
                confidence: e.results[0][0].confidence || 0.9,
                latency: Date.now() - startTime,
                source: "local"
              });
            };
            recognition.onerror = (err) => reject(new Error(err.error || "Speech recognition failed"));
            recognition.start();
          });
        }
      }
      return {
        text: "[local transcript]",
        confidence: 0.85,
        latency: Date.now() - startTime,
        source: "local"
      };
    }
    /**
     * Synthesize speech using local TTS.
     */
    async speak(text, options = {}) {
      const startTime = Date.now();
      if (this.engines.tts?.speak) {
        const res = await this.engines.tts.speak(text, options);
        return {
          audio: res.audio || res,
          latency: Date.now() - startTime,
          source: "local"
        };
      }
      if (typeof window !== "undefined" && window.speechSynthesis) {
        return new Promise((resolve) => {
          const utterance = new SpeechSynthesisUtterance(text);
          if (options.rate) utterance.rate = options.rate;
          if (options.pitch) utterance.pitch = options.pitch;
          if (options.lang) utterance.lang = options.lang;
          utterance.onend = () => {
            resolve({
              audio: null,
              // Audio played directly to system output
              latency: Date.now() - startTime,
              source: "local"
            });
          };
          utterance.onerror = (err) => {
            resolve({
              audio: null,
              error: err.error,
              latency: Date.now() - startTime,
              source: "local"
            });
          };
          window.speechSynthesis.speak(utterance);
        });
      }
      return {
        audio: new Uint8Array([0, 0, 0, 0]).buffer,
        latency: Date.now() - startTime,
        source: "local"
      };
    }
  };

  // src/providers/cloud.js
  async function* parseSseStream(response) {
    if (!response.body || typeof response.body.getReader !== "function") {
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue;
          if (trimmed === "data: [DONE]") {
            yield { token: "", text: accumulated, source: "cloud", confidence: 1, done: true };
            return;
          }
          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const token = json.choices?.[0]?.delta?.content ?? json.text ?? json.delta ?? "";
              if (token) {
                accumulated += token;
                yield { token, text: accumulated, source: "cloud", confidence: 1, done: false };
              }
            } catch {
            }
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
    if (accumulated) {
      yield { token: "", text: accumulated, source: "cloud", confidence: 1, done: true };
    }
  }
  async function* streamWebSocket(url, payload, options = {}) {
    const WebSocketImpl = globalThis.WebSocket || options.WebSocket;
    if (!WebSocketImpl) {
      throw new Error("WebSocket is not available in the current environment");
    }
    const ws = new WebSocketImpl(url);
    const queue = [];
    let resolveNext = null;
    let finished = false;
    let error = null;
    function push(item) {
      if (resolveNext) {
        const res = resolveNext;
        resolveNext = null;
        res(item);
      } else {
        queue.push(item);
      }
    }
    ws.onopen = () => {
      const data = typeof payload === "string" ? payload : JSON.stringify(payload);
      ws.send(data);
    };
    ws.onmessage = (event) => {
      let token = "";
      let isDone = false;
      try {
        const parsed = JSON.parse(event.data);
        token = parsed.token ?? parsed.delta ?? parsed.text ?? parsed.content ?? "";
        if (parsed.done) {
          isDone = true;
        }
      } catch {
        token = event.data;
      }
      if (isDone) {
        push({ token: "", done: true });
        ws.close();
      } else if (token) {
        push({ token, done: false });
      }
    };
    ws.onerror = (err) => {
      error = err;
      push({ error: err });
    };
    ws.onclose = () => {
      finished = true;
      push({ done: true });
    };
    let accumulated = "";
    try {
      while (true) {
        if (queue.length === 0 && (finished || error)) break;
        const item = queue.length > 0 ? queue.shift() : await new Promise((r) => {
          resolveNext = r;
        });
        if (!item) break;
        if (item.error) {
          throw new Error(`WebSocket error: ${item.error.message || "connection failed"}`);
        }
        if (item.done) break;
        accumulated += item.token;
        yield {
          token: item.token,
          text: accumulated,
          source: "cloud",
          confidence: 1,
          done: false
        };
      }
      yield {
        token: "",
        text: accumulated,
        source: "cloud",
        confidence: 1,
        done: true
      };
    } finally {
      if (ws.readyState === 0 || ws.readyState === 1) {
        ws.close();
      }
    }
  }
  var CloudProvider = class {
    constructor(options = {}) {
      this.apiKey = options.apiKey || (typeof process !== "undefined" ? process.env?.AI_API_KEY || process.env?.OPENAI_API_KEY : "");
      this.endpoint = options.endpoint || "https://api.openai.com/v1";
      this.transport = options.transport || (this.endpoint.startsWith("ws") ? "ws" : "sse");
      this.models = {
        llm: options.models?.llm || "gpt-4o-mini",
        stt: options.models?.stt || "whisper-1",
        tts: options.models?.tts || "tts-1"
      };
      this.customHandlers = {
        llm: options.ask || options.llm || null,
        stream: options.stream || null,
        stt: options.transcribe || options.stt || null,
        tts: options.speak || options.tts || null
      };
    }
    /**
     * Stream tokens from Cloud endpoint using SSE or WebSocket.
     */
    async *generateStream(prompt, options = {}) {
      if (typeof this.customHandlers.stream === "function") {
        yield* this.customHandlers.stream(prompt, options);
        return;
      }
      const isWs = (options.transport || this.transport) === "ws" || this.endpoint.startsWith("ws://") || this.endpoint.startsWith("wss://");
      if (isWs) {
        const payload = {
          prompt,
          model: options.model || this.models.llm,
          stream: true,
          temperature: options.temp ?? 0.7,
          apiKey: this.apiKey || void 0
        };
        yield* streamWebSocket(this.endpoint, payload, options);
        return;
      }
      if (this.apiKey) {
        const url = `${this.endpoint.replace(/\/+$/, "")}/chat/completions`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: options.model || this.models.llm,
            messages: [{ role: "user", content: prompt }],
            temperature: options.temp ?? 0.7,
            max_tokens: options.maxTokens ?? 1024,
            stream: true
          })
        });
        if (!res.ok) {
          const errorBody = await res.text();
          throw new Error(`Cloud LLM stream failed (${res.status}): ${errorBody}`);
        }
        yield* parseSseStream(res);
        return;
      }
      const nonStream = await this.generate(prompt, options);
      const tokens = nonStream.text.split(/(\s+)/);
      let accumulated = "";
      for (let i = 0; i < tokens.length; i++) {
        accumulated += tokens[i];
        yield {
          token: tokens[i],
          text: accumulated,
          source: "cloud",
          confidence: 1,
          done: i === tokens.length - 1
        };
      }
    }
    /**
     * Execute cloud LLM generation.
     */
    async generate(prompt, options = {}) {
      const startTime = Date.now();
      if (typeof this.customHandlers.llm === "function") {
        const res = await this.customHandlers.llm(prompt, options);
        return {
          text: typeof res === "string" ? res : res.text,
          confidence: 1,
          latency: Date.now() - startTime,
          source: "cloud"
        };
      }
      if (this.apiKey) {
        const url = `${this.endpoint.replace(/\/+$/, "")}/chat/completions`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: options.model || this.models.llm,
            messages: [{ role: "user", content: prompt }],
            temperature: options.temp ?? 0.7,
            max_tokens: options.maxTokens ?? 1024
          })
        });
        if (!res.ok) {
          const errorBody = await res.text();
          throw new Error(`Cloud LLM request failed (${res.status}): ${errorBody}`);
        }
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content || "";
        return {
          text,
          confidence: 1,
          latency: Date.now() - startTime,
          source: "cloud"
        };
      }
      return {
        text: `[cloud fallback] ${prompt}`,
        confidence: 1,
        latency: Date.now() - startTime,
        source: "cloud"
      };
    }
    /**
     * Execute cloud STT audio transcription.
     */
    async transcribe(audio, options = {}) {
      const startTime = Date.now();
      if (typeof this.customHandlers.stt === "function") {
        const res = await this.customHandlers.stt(audio, options);
        return {
          text: typeof res === "string" ? res : res.text,
          confidence: 1,
          latency: Date.now() - startTime,
          source: "cloud"
        };
      }
      if (this.apiKey && audio) {
        const url = `${this.endpoint.replace(/\/+$/, "")}/audio/transcriptions`;
        const formData = new FormData();
        formData.append("model", options.model || this.models.stt);
        if (typeof audio === "string") {
          const fileRes = await fetch(audio);
          const blob = await fileRes.blob();
          formData.append("file", blob, "audio.wav");
        } else if (audio instanceof Blob) {
          formData.append("file", audio, "audio.wav");
        } else if (audio.buffer || audio instanceof ArrayBuffer) {
          const blob = new Blob([audio]);
          formData.append("file", blob, "audio.wav");
        }
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: formData
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Cloud STT request failed (${res.status}): ${err}`);
        }
        const data = await res.json();
        return {
          text: data.text || "",
          confidence: 1,
          latency: Date.now() - startTime,
          source: "cloud"
        };
      }
      return {
        text: "[cloud transcript]",
        confidence: 1,
        latency: Date.now() - startTime,
        source: "cloud"
      };
    }
    /**
     * Execute cloud TTS speech synthesis.
     */
    async speak(text, options = {}) {
      const startTime = Date.now();
      if (typeof this.customHandlers.tts === "function") {
        const res = await this.customHandlers.tts(text, options);
        return {
          audio: res.audio || res,
          latency: Date.now() - startTime,
          source: "cloud"
        };
      }
      if (this.apiKey) {
        const url = `${this.endpoint.replace(/\/+$/, "")}/audio/speech`;
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: options.model || this.models.tts,
            input: text,
            voice: options.voice || "alloy"
          })
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Cloud TTS request failed (${res.status}): ${err}`);
        }
        const arrayBuffer = await res.arrayBuffer();
        return {
          audio: arrayBuffer,
          latency: Date.now() - startTime,
          source: "cloud"
        };
      }
      return {
        audio: new Uint8Array([0, 1, 2, 3]).buffer,
        latency: Date.now() - startTime,
        source: "cloud"
      };
    }
  };

  // src/core.js
  var HybridEngine = class {
    constructor(options = {}, deviceProfile = null) {
      this.options = options;
      this.device = deviceProfile;
      this.router = new Router(options);
      this.local = new LocalProvider(options.local || {});
      this.cloud = new CloudProvider(options.cloud || options);
      this._listeners = /* @__PURE__ */ new Map();
    }
    /**
     * Event subscription method on returned object.
     */
    on(event, handler) {
      if (!this._listeners.has(event)) {
        this._listeners.set(event, /* @__PURE__ */ new Set());
      }
      this._listeners.get(event).add(handler);
      return this;
    }
    /**
     * Remove event listener.
     */
    off(event, handler) {
      if (this._listeners.has(event)) {
        this._listeners.get(event).delete(handler);
      }
      return this;
    }
    /**
     * Register a one-time event listener.
     */
    once(event, handler) {
      const wrapper = (data) => {
        this.off(event, wrapper);
        handler(data);
      };
      return this.on(event, wrapper);
    }
    /**
     * Internal event emitter.
     */
    emit(event, data) {
      const handlers = this._listeners.get(event);
      if (handlers) {
        for (const fn of handlers) {
          try {
            fn(data);
          } catch {
          }
        }
      }
    }
    /**
     * Re-inspect hardware capability and update profile.
     */
    async detect() {
      this.device = await detect();
      return this.device;
    }
    /**
     * Check if a model type ('llm' | 'stt' | 'tts') can be loaded on this device.
     */
    can(taskType) {
      if (this.local?.engines?.[taskType]) return true;
      if (!this.device) return false;
      return Boolean(this.device.models?.[taskType]?.capable);
    }
    /**
     * Preload a model into local memory if capable.
     */
    async load(taskType) {
      if (!this.device) {
        await this.detect();
      }
      if (!this.can(taskType)) {
        return false;
      }
      await this.local.load(taskType);
      this.emit("load", { taskType, success: true });
      return true;
    }
    /**
     * Unload / evict a local model from memory.
     */
    async unload(taskType) {
      await this.local.unload(taskType);
      this.emit("unload", { taskType, success: true });
      return true;
    }
    /**
     * Inspect workload routing without executing.
     */
    route(taskType, input, runOptions = {}) {
      const hasLocalEngine = Boolean(this.local?.engines?.[taskType]);
      return this.router.decide(taskType, input, this.device, { hasLocalEngine, ...runOptions });
    }
    /**
     * LLM text generation with intelligent hybrid routing & silent cloud fallback.
     */
    async ask(prompt, options = {}) {
      if (!this.device) {
        await this.detect();
      }
      const decision = this.route("llm", prompt, options);
      this.emit("route", { task: "llm", ...decision });
      if (decision.target === "local") {
        try {
          const localResult = await this.local.generate(prompt, options);
          const threshold = options.confidenceThreshold ?? this.router.confidenceThreshold;
          if (localResult.confidence != null && localResult.confidence < threshold && this.options.mode !== "local-only") {
            this.emit("fallback", {
              task: "llm",
              reason: `low_confidence: ${localResult.confidence} < ${threshold}`,
              localResult
            });
            return await this.cloud.generate(prompt, options);
          }
          return localResult;
        } catch (err) {
          if (this.options.mode === "local-only") {
            throw err;
          }
          this.emit("fallback", {
            task: "llm",
            reason: `local_error: ${err.message}`,
            error: err
          });
          return await this.cloud.generate(prompt, options);
        }
      }
      return await this.cloud.generate(prompt, options);
    }
    /**
     * Stream LLM text tokens with hybrid routing & silent cloud fallback.
     * Yields { token, text, source, confidence, done }.
     */
    async *askStream(prompt, options = {}) {
      if (!this.device) {
        await this.detect();
      }
      const decision = this.route("llm", prompt, options);
      this.emit("route", { task: "llm", ...decision });
      if (decision.target === "local") {
        try {
          let lastChunk = null;
          for await (const chunk of this.local.generateStream(prompt, options)) {
            lastChunk = chunk;
            yield chunk;
          }
          const threshold = options.confidenceThreshold ?? this.router.confidenceThreshold;
          if (lastChunk?.confidence != null && lastChunk.confidence < threshold && this.options.mode !== "local-only") {
            this.emit("fallback", {
              task: "llm",
              reason: `low_confidence: ${lastChunk.confidence} < ${threshold}`,
              localResult: lastChunk
            });
            yield* this.cloud.generateStream(prompt, options);
          }
          return;
        } catch (err) {
          if (this.options.mode === "local-only") {
            throw err;
          }
          this.emit("fallback", {
            task: "llm",
            reason: `local_error: ${err.message}`,
            error: err
          });
          yield* this.cloud.generateStream(prompt, options);
          return;
        }
      }
      yield* this.cloud.generateStream(prompt, options);
    }
    /**
     * Inspect current model lifecycle states.
     */
    status(taskType) {
      return this.local.status(taskType);
    }
    /**
     * STT audio transcription with hybrid routing & silent cloud fallback.
     */
    async transcribe(audio, options = {}) {
      if (!this.device) {
        await this.detect();
      }
      const decision = this.route("stt", audio, options);
      this.emit("route", { task: "stt", ...decision });
      if (decision.target === "local") {
        try {
          const localResult = await this.local.transcribe(audio, options);
          const threshold = options.confidenceThreshold ?? this.router.confidenceThreshold;
          if (localResult.confidence != null && localResult.confidence < threshold && this.options.mode !== "local-only") {
            this.emit("fallback", {
              task: "stt",
              reason: `low_confidence: ${localResult.confidence} < ${threshold}`,
              localResult
            });
            return await this.cloud.transcribe(audio, options);
          }
          return localResult;
        } catch (err) {
          if (this.options.mode === "local-only") {
            throw err;
          }
          this.emit("fallback", {
            task: "stt",
            reason: `local_error: ${err.message}`,
            error: err
          });
          return await this.cloud.transcribe(audio, options);
        }
      }
      return await this.cloud.transcribe(audio, options);
    }
    /**
     * TTS speech synthesis with hybrid routing & silent cloud fallback.
     */
    async speak(text, options = {}) {
      if (!this.device) {
        await this.detect();
      }
      const decision = this.route("tts", text, options);
      this.emit("route", { task: "tts", ...decision });
      if (decision.target === "local") {
        try {
          return await this.local.speak(text, options);
        } catch (err) {
          if (this.options.mode === "local-only") {
            throw err;
          }
          this.emit("fallback", {
            task: "tts",
            reason: `local_error: ${err.message}`,
            error: err
          });
          return await this.cloud.speak(text, options);
        }
      }
      return await this.cloud.speak(text, options);
    }
  };

  // src/index.js
  async function localfirst(options = {}) {
    const profile = await detect();
    const engine = new HybridEngine(options, profile);
    if (options.preload) {
      const tasks = Array.isArray(options.preload) ? options.preload : ["llm", "stt", "tts"];
      await Promise.all(
        tasks.filter((t) => engine.can(t)).map((t) => engine.load(t))
      );
    }
    return engine;
  }
  return __toCommonJS(index_exports);
})();
