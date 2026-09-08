# localfirst

On-device AI with dynamic capability probing, hybrid routing, and silent cloud fallback.

```bash
npm install localfirst
```

## Quick start

```js
import localfirst from 'localfirst';

const ai = await localfirst({ apiKey: process.env.OPENAI_API_KEY });
const answer = await ai.ask('Turn off the kitchen lights');
console.log(answer.text, answer.source);
```

`detect()` probes hardware suitability. `ask()` runs LLMs locally with confidence-aware routing. `transcribe()` and `speak()` handle hybrid audio with automatic cloud escalation.

## Hardware capability probing

```js
import { detect } from 'localfirst/detect';

const telemetry = await detect();
console.log(telemetry.cores, telemetry.memory.totalGb, telemetry.gpu.webgpu);
console.log(telemetry.models.llm.capable); // true if WebGPU or >=4GB RAM + SIMD
```

Inspects WebGPU, CPU cores, RAM, Wasm SIMD, Speech APIs, and network connectivity in <2ms. Cached with 15s TTL (`detect({ forceRefresh: true })` bypasses cache).

## Token streaming

```js
for await (const chunk of ai.askStream('Explain quantum computing')) {
  process.stdout.write(chunk.token);
}
```


## Intelligent hybrid balancing

```js
const ai = await localfirst({
  mode: 'auto',              // 'auto' | 'prefer-local' | 'prefer-cloud' | 'local-only'
  confidenceThreshold: 0.70  // Hand off to cloud if local confidence drops below 0.70
});

ai.on('route', ({ task, target, confidence, complexity }) => {
  console.log(`${task} → ${target} (conf: ${confidence}, complex: ${complexity})`);
});

// Simple query → executes locally on-device
await ai.ask('What is 2 + 2?');

// Deep reasoning → escalates to cloud model
await ai.ask('Prove the Riemann hypothesis and optimize distributed Paxos');
```

Routes based on prompt complexity and local model confidence scoring. Simple queries run locally with sub-100ms latency, while heavy queries escalate to the cloud.

## Silent cloud fallback

```js
const ai = await localfirst({
  local: {
    llm: {
      generate: async () => {
        throw new Error('WebGPU context lost');
      }
    }
  }
});

ai.on('fallback', ({ task, reason }) => {
  console.warn(`Local ${task} failed: ${reason}, escalated to cloud`);
});

const res = await ai.ask('Summarize this note');
console.log(res.source); // 'cloud' (no throw, zero crash)
```

If an on-device model runs out of memory, crashes, or drops below the confidence threshold, the request silently succeeds via cloud fallback without throwing errors to the user.

## Custom cloud endpoints, SSE, and WebSockets

`localfirst` works with **any OpenAI-compatible endpoint** (Ollama, vLLM, LM Studio, OpenRouter, Groq, Together, DeepSeek, Gemini):

```js
const ai = await localfirst({
  endpoint: 'http://localhost:11434/v1', // Ollama, vLLM, LM Studio, or OpenRouter
  apiKey: 'ollama'
});
```

Native **Server-Sent Events (SSE)** and **WebSocket (WSS)** streaming:

```js
// 1. Server-Sent Events (SSE) via native fetch
for await (const chunk of ai.askStream('Explain Raft')) {
  process.stdout.write(chunk.token);
}

// 2. Real-time WebSocket (WSS) streaming
const ai = await localfirst({
  endpoint: 'wss://realtime.ai.internal/v1',
  transport: 'ws'
});
```

Or provide custom functions to plug in any proprietary API (AWS Bedrock, Vertex AI, Anthropic SDK):

```js
const ai = await localfirst({
  cloud: {
    ask: async (prompt) => ({ text: await callMyCustomLLM(prompt) }),
    stream: async function* (prompt) {
      for await (const token of myStreamingService(prompt)) {
        yield { token, text: token, source: 'cloud', done: false };
      }
    }
  }
});
```

## Hybrid STT and TTS

```js
// Speech to text: runs on-device via Web Speech / local Whisper, falls back to cloud
const transcript = await ai.transcribe('./sample.wav');

// Text to speech: synthesizes on-device or streams from cloud
const speech = await ai.speak('System ready');
```

Works seamlessly in the browser and Node.js with smart input detection for URLs, Blobs, Buffers, and microphone streams.

## Demo

```bash
npm run demo
```

Runs the hardware probe, local execution, cloud escalation, and silent fallback simulation.

## License

MIT © [Hemanth.HM](https://h3manth.com)
