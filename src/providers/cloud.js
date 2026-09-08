/**
 * Cloud fallback and escalation provider for LLM, STT, and TTS.
 * Zero external dependencies: uses native fetch with OpenAI/Gemini compatibility,
 * native SSE (Server-Sent Events) streaming, and real-time WebSocket (WSS) streaming.
 */

/**
 * Parse standard Server-Sent Events (SSE) stream chunk-by-chunk.
 */
export async function* parseSseStream(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue; // SSE comment or ping
        if (trimmed === 'data: [DONE]') {
          yield { token: '', text: accumulated, source: 'cloud', confidence: 1.0, done: true };
          return;
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const token = json.choices?.[0]?.delta?.content ?? json.text ?? json.delta ?? '';
            if (token) {
              accumulated += token;
              yield { token, text: accumulated, source: 'cloud', confidence: 1.0, done: false };
            }
          } catch {
            // Ignore non-JSON or partial frames
          }
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }

  if (accumulated) {
    yield { token: '', text: accumulated, source: 'cloud', confidence: 1.0, done: true };
  }
}

/**
 * Stream real-time tokens over WebSocket (ws:// or wss://).
 */
export async function* streamWebSocket(url, payload, options = {}) {
  const WebSocketImpl = globalThis.WebSocket || options.WebSocket;
  if (!WebSocketImpl) {
    throw new Error('WebSocket is not available in the current environment');
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
    const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
    ws.send(data);
  };

  ws.onmessage = (event) => {
    let token = '';
    let isDone = false;
    try {
      const parsed = JSON.parse(event.data);
      token = parsed.token ?? parsed.delta ?? parsed.text ?? parsed.content ?? '';
      if (parsed.done) {
        isDone = true;
      }
    } catch {
      token = event.data;
    }

    if (isDone) {
      push({ token: '', done: true });
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

  let accumulated = '';
  try {
    while (true) {
      if (queue.length === 0 && (finished || error)) break;

      const item = queue.length > 0 ? queue.shift() : await new Promise(r => { resolveNext = r; });
      if (!item) break;
      if (item.error) {
        throw new Error(`WebSocket error: ${item.error.message || 'connection failed'}`);
      }
      if (item.done) break;

      accumulated += item.token;
      yield {
        token: item.token,
        text: accumulated,
        source: 'cloud',
        confidence: 1.0,
        done: false
      };
    }
    yield {
      token: '',
      text: accumulated,
      source: 'cloud',
      confidence: 1.0,
      done: true
    };
  } finally {
    if (ws.readyState === 0 || ws.readyState === 1) {
      ws.close();
    }
  }
}

export class CloudProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || (typeof process !== 'undefined' ? process.env?.AI_API_KEY || process.env?.OPENAI_API_KEY : '');
    this.endpoint = options.endpoint || 'https://api.openai.com/v1';
    this.transport = options.transport || (this.endpoint.startsWith('ws') ? 'ws' : 'sse');
    this.models = {
      llm: options.models?.llm || 'gpt-4o-mini',
      stt: options.models?.stt || 'whisper-1',
      tts: options.models?.tts || 'tts-1'
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
    // 1. Custom stream handler if provided
    if (typeof this.customHandlers.stream === 'function') {
      yield* this.customHandlers.stream(prompt, options);
      return;
    }

    // 2. WebSocket transport if specified or ws:// / wss:// endpoint
    const isWs = (options.transport || this.transport) === 'ws' || this.endpoint.startsWith('ws://') || this.endpoint.startsWith('wss://');
    if (isWs) {
      const payload = {
        prompt,
        model: options.model || this.models.llm,
        stream: true,
        temperature: options.temp ?? 0.7,
        apiKey: this.apiKey || undefined
      };
      yield* streamWebSocket(this.endpoint, payload, options);
      return;
    }

    // 3. HTTP SSE (Server-Sent Events) via native fetch
    if (this.apiKey) {
      const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: options.model || this.models.llm,
          messages: [{ role: 'user', content: prompt }],
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

    // 4. Fallback chunked simulation if no apiKey configured
    const nonStream = await this.generate(prompt, options);
    const tokens = nonStream.text.split(/(\s+)/);
    let accumulated = '';
    for (let i = 0; i < tokens.length; i++) {
      accumulated += tokens[i];
      yield {
        token: tokens[i],
        text: accumulated,
        source: 'cloud',
        confidence: 1.0,
        done: i === tokens.length - 1
      };
    }
  }

  /**
   * Execute cloud LLM generation.
   */
  async generate(prompt, options = {}) {
    const startTime = Date.now();

    // 1. Custom handler
    if (typeof this.customHandlers.llm === 'function') {
      const res = await this.customHandlers.llm(prompt, options);
      return {
        text: typeof res === 'string' ? res : res.text,
        confidence: 1.0,
        latency: Date.now() - startTime,
        source: 'cloud'
      };
    }

    // 2. OpenAI / Compatible endpoint
    if (this.apiKey) {
      const url = `${this.endpoint.replace(/\/+$/, '')}/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: options.model || this.models.llm,
          messages: [{ role: 'user', content: prompt }],
          temperature: options.temp ?? 0.7,
          max_tokens: options.maxTokens ?? 1024
        })
      });

      if (!res.ok) {
        const errorBody = await res.text();
        throw new Error(`Cloud LLM request failed (${res.status}): ${errorBody}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '';

      return {
        text,
        confidence: 1.0,
        latency: Date.now() - startTime,
        source: 'cloud'
      };
    }

    // 3. Fallback dummy response if no key configured
    return {
      text: `[cloud fallback] ${prompt}`,
      confidence: 1.0,
      latency: Date.now() - startTime,
      source: 'cloud'
    };
  }

  /**
   * Execute cloud STT audio transcription.
   */
  async transcribe(audio, options = {}) {
    const startTime = Date.now();

    // 1. Custom handler
    if (typeof this.customHandlers.stt === 'function') {
      const res = await this.customHandlers.stt(audio, options);
      return {
        text: typeof res === 'string' ? res : res.text,
        confidence: 1.0,
        latency: Date.now() - startTime,
        source: 'cloud'
      };
    }

    // 2. OpenAI Whisper endpoint
    if (this.apiKey && audio) {
      const url = `${this.endpoint.replace(/\/+$/, '')}/audio/transcriptions`;
      const formData = new FormData();
      formData.append('model', options.model || this.models.stt);

      if (typeof audio === 'string') {
        // Fetch remote or local file if URL or string path
        const fileRes = await fetch(audio);
        const blob = await fileRes.blob();
        formData.append('file', blob, 'audio.wav');
      } else if (audio instanceof Blob) {
        formData.append('file', audio, 'audio.wav');
      } else if (audio.buffer || audio instanceof ArrayBuffer) {
        const blob = new Blob([audio]);
        formData.append('file', blob, 'audio.wav');
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Cloud STT request failed (${res.status}): ${err}`);
      }

      const data = await res.json();
      return {
        text: data.text || '',
        confidence: 1.0,
        latency: Date.now() - startTime,
        source: 'cloud'
      };
    }

    return {
      text: '[cloud transcript]',
      confidence: 1.0,
      latency: Date.now() - startTime,
      source: 'cloud'
    };
  }

  /**
   * Execute cloud TTS speech synthesis.
   */
  async speak(text, options = {}) {
    const startTime = Date.now();

    // 1. Custom handler
    if (typeof this.customHandlers.tts === 'function') {
      const res = await this.customHandlers.tts(text, options);
      return {
        audio: res.audio || res,
        latency: Date.now() - startTime,
        source: 'cloud'
      };
    }

    // 2. OpenAI TTS endpoint
    if (this.apiKey) {
      const url = `${this.endpoint.replace(/\/+$/, '')}/audio/speech`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: options.model || this.models.tts,
          input: text,
          voice: options.voice || 'alloy'
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
        source: 'cloud'
      };
    }

    return {
      audio: new Uint8Array([0, 1, 2, 3]).buffer,
      latency: Date.now() - startTime,
      source: 'cloud'
    };
  }
}
