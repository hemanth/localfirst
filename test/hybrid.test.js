import { test } from 'node:test';
import assert from 'node:assert/strict';
import localfirst from '../src/index.js';

test('3-line quick start works cleanly', async () => {
  const ai = await localfirst();
  const res = await ai.ask('What is the weather today?');
  assert.ok(res.text);
  assert.ok(['local', 'cloud'].includes(res.source));
});

test('Silent fallback to cloud when local LLM throws error', async () => {
  const fallbacks = [];
  const ai = await localfirst({
    local: {
      llm: {
        generate: async () => {
          throw new Error('WebGPU Out Of Memory (VRAM exhausted)');
        }
      }
    },
    cloud: {
      ask: async (prompt) => {
        return { text: `Cloud saved: ${prompt}` };
      }
    }
  });

  ai.on('fallback', (info) => fallbacks.push(info));

  // Should NOT throw, but silently fall back to cloud!
  const res = await ai.ask('Simple prompt');
  assert.equal(res.source, 'cloud');
  assert.equal(res.text, 'Cloud saved: Simple prompt');
  assert.equal(fallbacks.length, 1);
  assert.match(fallbacks[0].reason, /local_error: WebGPU Out Of Memory/);
});

test('Silent fallback to cloud when local confidence is below threshold', async () => {
  const fallbacks = [];
  const ai = await localfirst({
    confidenceThreshold: 0.75,
    local: {
      llm: {
        generate: async (prompt) => {
          return { text: 'Low confidence answer', confidence: 0.45 };
        }
      }
    },
    cloud: {
      ask: async (prompt) => {
        return { text: `Cloud high-accuracy: ${prompt}` };
      }
    }
  });

  ai.on('fallback', (info) => fallbacks.push(info));

  const res = await ai.ask('What is quantum entanglement?');
  assert.equal(res.source, 'cloud');
  assert.equal(res.text, 'Cloud high-accuracy: What is quantum entanglement?');
  assert.equal(fallbacks.length, 1);
  assert.match(fallbacks[0].reason, /low_confidence/);
});

test('STT transcription works locally and falls back silently on error', async () => {
  let fallbackEmitted = false;
  const ai = await localfirst({
    local: {
      stt: {
        transcribe: async () => {
          throw new Error('Microphone audio buffer corrupted');
        }
      }
    },
    cloud: {
      transcribe: async () => {
        return { text: 'Recovered transcript from cloud' };
      }
    }
  });

  ai.on('fallback', () => {
    fallbackEmitted = true;
  });

  const res = await ai.transcribe(new Uint8Array([1, 2, 3]));
  assert.equal(res.text, 'Recovered transcript from cloud');
  assert.equal(res.source, 'cloud');
  assert.equal(fallbackEmitted, true);
});

test('TTS synthesis works locally and emits route events', async () => {
  const routes = [];
  const ai = await localfirst({
    local: {
      tts: {
        speak: async (text) => {
          return { audio: new Uint8Array([9, 8, 7]).buffer };
        }
      }
    }
  });

  ai.on('route', (evt) => routes.push(evt));

  const res = await ai.speak('Hello from hybrid speech');
  assert.ok(res);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].task, 'tts');
});

test('ai.can() and ai.load() handle capability queries and preloading', async () => {
  let loadCalled = false;
  const ai = await localfirst({
    local: {
      llm: {
        load: async () => {
          loadCalled = true;
        }
      }
    }
  });

  const canLlm = ai.can('llm');
  assert.ok(typeof canLlm === 'boolean');

  if (canLlm) {
    const loaded = await ai.load('llm');
    assert.equal(loaded, true);
    assert.equal(loadCalled, true);
  }
});

test('ai.askStream() streams token chunks with hybrid resolution', async () => {
  const ai = await localfirst({
    local: {
      llm: {
        generate: async (prompt) => ({
          text: 'Turned on the kitchen light',
          source: 'local',
          confidence: 0.95
        })
      }
    }
  });

  const chunks = [];
  for await (const chunk of ai.askStream('Turn on light')) {
    chunks.push(chunk);
  }

  assert.ok(chunks.length > 1);
  assert.equal(chunks[chunks.length - 1].done, true);
  assert.equal(chunks[chunks.length - 1].text, 'Turned on the kitchen light');
});

test('ai.status() and ai.once() lifecycle and event listeners work as expected', async () => {
  let routeCount = 0;
  const ai = await localfirst({
    local: {
      llm: {
        load: async () => {},
        generate: async () => ({ text: 'ok', source: 'local' })
      }
    }
  });

  assert.equal(ai.status('llm').state, 'unloaded');
  await ai.load('llm');
  assert.equal(ai.status('llm').state, 'resident');
  assert.ok(ai.status('llm').loadedAt > 0);

  ai.once('route', () => { routeCount++; });
  await ai.ask('First call');
  await ai.ask('Second call');
  assert.equal(routeCount, 1);
});

test('CloudProvider parses SSE streams accurately', async () => {
  const { parseSseStream } = await import('../src/providers/cloud.js');

  const ssePayload = [
    'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
    'data: [DONE]\n\n'
  ].join('');

  const mockResponse = {
    body: {
      getReader: () => {
        let sent = false;
        return {
          read: async () => {
            if (!sent) {
              sent = true;
              return { value: new TextEncoder().encode(ssePayload), done: false };
            }
            return { done: true };
          },
          releaseLock: () => {}
        };
      }
    }
  };

  const chunks = [];
  for await (const chunk of parseSseStream(mockResponse)) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].token, 'Hello');
  assert.equal(chunks[1].token, ' world');
  assert.equal(chunks[1].text, 'Hello world');
  assert.equal(chunks[2].done, true);
});

test('CloudProvider supports custom cloud endpoints and custom stream handlers', async () => {
  const ai = await localfirst({
    endpoint: 'https://my-custom-llm.internal.corp/v1',
    mode: 'cloud-only',
    cloud: {
      stream: async function* (prompt) {
        yield { token: 'Custom', text: 'Custom', source: 'cloud', done: false };
        yield { token: ' response', text: 'Custom response', source: 'cloud', done: true };
      }
    }
  });

  const chunks = [];
  for await (const chunk of ai.askStream('ping')) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].text, 'Custom response');
  assert.equal(chunks[1].done, true);
});

test('ai.askStream() silently falls back to cloud stream when local generator errors', async () => {
  let fallbackEmitted = false;
  const ai = await localfirst({
    local: {
      llm: {
        generateStream: async function* () {
          throw new Error('Local WebGPU out of memory');
        }
      }
    },
    cloud: {
      stream: async function* () {
        yield { token: 'Cloud', text: 'Cloud', source: 'cloud', done: false };
        yield { token: ' rescued', text: 'Cloud rescued', source: 'cloud', done: true };
      }
    }
  });

  ai.on('fallback', (e) => {
    fallbackEmitted = true;
    assert.match(e.reason, /local_error/);
  });

  const chunks = [];
  for await (const chunk of ai.askStream('test')) {
    chunks.push(chunk);
  }

  assert.equal(fallbackEmitted, true);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].text, 'Cloud rescued');
});


