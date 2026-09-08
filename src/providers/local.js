/**
 * Local on-device provider for LLM, STT, and TTS.
 * Bridges to browser APIs (Web Speech, WebGPU) or pluggable custom local runners.
 */

export class LocalProvider {
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
      llm: { state: 'unloaded', loadedAt: null },
      stt: { state: 'unloaded', loadedAt: null },
      tts: { state: 'unloaded', loadedAt: null }
    };
  }

  /**
   * Inspect current model lifecycle state.
   */
  status(taskType) {
    if (taskType) {
      return this.states[taskType] || { state: 'unloaded' };
    }
    return { ...this.states };
  }

  /**
   * Preload / warm up a local model.
   */
  async load(taskType) {
    if (this.loaded[taskType]) return true;
    this.states[taskType] = { state: 'loading', loadedAt: null };

    try {
      if (this.engines[taskType]?.load) {
        await this.engines[taskType].load();
      }
      this.loaded[taskType] = true;
      this.states[taskType] = { state: 'resident', loadedAt: Date.now() };
      return true;
    } catch (err) {
      this.states[taskType] = { state: 'error', error: err.message };
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
    this.states[taskType] = { state: 'unloaded', loadedAt: null };
    return true;
  }

  /**
   * Generate text response using local LLM.
   */
  async generate(prompt, options = {}) {
    const startTime = Date.now();

    // 1. Custom local engine if provided (e.g. WebLLM, Transformers.js)
    if (this.engines.llm?.generate) {
      const res = await this.engines.llm.generate(prompt, options);
      return {
        text: typeof res === 'string' ? res : res.text,
        confidence: res.confidence ?? 0.88,
        latency: Date.now() - startTime,
        source: 'local'
      };
    }

    // 2. Default lightweight local execution
    return {
      text: `[local] Processed: ${prompt}`,
      confidence: 0.85,
      latency: Date.now() - startTime,
      source: 'local'
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
    let accumulated = '';
    for (let i = 0; i < tokens.length; i++) {
      accumulated += tokens[i];
      yield {
        token: tokens[i],
        text: accumulated,
        source: 'local',
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

    // 1. Custom local STT engine (e.g. Whisper wasm)
    if (this.engines.stt?.transcribe) {
      const res = await this.engines.stt.transcribe(audio, options);
      return {
        text: typeof res === 'string' ? res : res.text,
        confidence: res.confidence ?? 0.9,
        latency: Date.now() - startTime,
        source: 'local'
      };
    }

    // 2. Browser SpeechRecognition if in browser and audio is microphone/live
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition && (!audio || options.mic)) {
        return new Promise((resolve, reject) => {
          const recognition = new SpeechRecognition();
          recognition.lang = options.lang || 'en-US';
          recognition.continuous = false;
          recognition.interimResults = false;

          recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            resolve({
              text: transcript,
              confidence: e.results[0][0].confidence || 0.9,
              latency: Date.now() - startTime,
              source: 'local'
            });
          };

          recognition.onerror = (err) => reject(new Error(err.error || 'Speech recognition failed'));
          recognition.start();
        });
      }
    }

    // 3. Fallback mock / buffer decode
    return {
      text: '[local transcript]',
      confidence: 0.85,
      latency: Date.now() - startTime,
      source: 'local'
    };
  }

  /**
   * Synthesize speech using local TTS.
   */
  async speak(text, options = {}) {
    const startTime = Date.now();

    // 1. Custom local TTS engine
    if (this.engines.tts?.speak) {
      const res = await this.engines.tts.speak(text, options);
      return {
        audio: res.audio || res,
        latency: Date.now() - startTime,
        source: 'local'
      };
    }

    // 2. Browser SpeechSynthesis
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        if (options.rate) utterance.rate = options.rate;
        if (options.pitch) utterance.pitch = options.pitch;
        if (options.lang) utterance.lang = options.lang;

        utterance.onend = () => {
          resolve({
            audio: null, // Audio played directly to system output
            latency: Date.now() - startTime,
            source: 'local'
          });
        };

        utterance.onerror = (err) => {
          resolve({
            audio: null,
            error: err.error,
            latency: Date.now() - startTime,
            source: 'local'
          });
        };

        window.speechSynthesis.speak(utterance);
      });
    }

    // 3. Fallback dummy audio buffer for non-browser runtimes
    return {
      audio: new Uint8Array([0, 0, 0, 0]).buffer,
      latency: Date.now() - startTime,
      source: 'local'
    };
  }
}
