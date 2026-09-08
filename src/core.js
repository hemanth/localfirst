import { detect } from './detect.js';
import { Router } from './router.js';
import { LocalProvider } from './providers/local.js';
import { CloudProvider } from './providers/cloud.js';

export class HybridEngine {
  constructor(options = {}, deviceProfile = null) {
    this.options = options;
    this.device = deviceProfile;
    this.router = new Router(options);
    this.local = new LocalProvider(options.local || {});
    this.cloud = new CloudProvider(options.cloud || options);
    this._listeners = new Map();
  }

  /**
   * Event subscription method on returned object.
   */
  on(event, handler) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
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
          // don't let listener error break execution
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
    this.emit('load', { taskType, success: true });
    return true;
  }

  /**
   * Unload / evict a local model from memory.
   */
  async unload(taskType) {
    await this.local.unload(taskType);
    this.emit('unload', { taskType, success: true });
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

    const decision = this.route('llm', prompt, options);
    this.emit('route', { task: 'llm', ...decision });

    if (decision.target === 'local') {
      try {
        const localResult = await this.local.generate(prompt, options);

        // Post-generation confidence check
        const threshold = options.confidenceThreshold ?? this.router.confidenceThreshold;
        if (localResult.confidence != null && localResult.confidence < threshold && this.options.mode !== 'local-only') {
          this.emit('fallback', {
            task: 'llm',
            reason: `low_confidence: ${localResult.confidence} < ${threshold}`,
            localResult
          });
          return await this.cloud.generate(prompt, options);
        }

        return localResult;
      } catch (err) {
        // Silent fallback to cloud on local runtime failure (OOM, WebGPU timeout, model crash)
        if (this.options.mode === 'local-only') {
          throw err;
        }
        this.emit('fallback', {
          task: 'llm',
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

    const decision = this.route('llm', prompt, options);
    this.emit('route', { task: 'llm', ...decision });

    if (decision.target === 'local') {
      try {
        let lastChunk = null;
        for await (const chunk of this.local.generateStream(prompt, options)) {
          lastChunk = chunk;
          yield chunk;
        }

        const threshold = options.confidenceThreshold ?? this.router.confidenceThreshold;
        if (lastChunk?.confidence != null && lastChunk.confidence < threshold && this.options.mode !== 'local-only') {
          this.emit('fallback', {
            task: 'llm',
            reason: `low_confidence: ${lastChunk.confidence} < ${threshold}`,
            localResult: lastChunk
          });
          yield* this.cloud.generateStream(prompt, options);
        }
        return;
      } catch (err) {
        if (this.options.mode === 'local-only') {
          throw err;
        }
        this.emit('fallback', {
          task: 'llm',
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

    const decision = this.route('stt', audio, options);
    this.emit('route', { task: 'stt', ...decision });

    if (decision.target === 'local') {
      try {
        const localResult = await this.local.transcribe(audio, options);

        const threshold = options.confidenceThreshold ?? this.router.confidenceThreshold;
        if (localResult.confidence != null && localResult.confidence < threshold && this.options.mode !== 'local-only') {
          this.emit('fallback', {
            task: 'stt',
            reason: `low_confidence: ${localResult.confidence} < ${threshold}`,
            localResult
          });
          return await this.cloud.transcribe(audio, options);
        }

        return localResult;
      } catch (err) {
        if (this.options.mode === 'local-only') {
          throw err;
        }
        this.emit('fallback', {
          task: 'stt',
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

    const decision = this.route('tts', text, options);
    this.emit('route', { task: 'tts', ...decision });

    if (decision.target === 'local') {
      try {
        return await this.local.speak(text, options);
      } catch (err) {
        if (this.options.mode === 'local-only') {
          throw err;
        }
        this.emit('fallback', {
          task: 'tts',
          reason: `local_error: ${err.message}`,
          error: err
        });
        return await this.cloud.speak(text, options);
      }
    }

    return await this.cloud.speak(text, options);
  }
}
