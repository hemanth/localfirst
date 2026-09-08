# localfirst Specification

## Overview
`localfirst` is an intelligent, zero-dependency hybrid AI router for JavaScript (Browser, Node.js, and Edge environments). It dynamically probes host hardware capabilities, routes tasks to run on-device (STT, TTS, LLM) when capable, balances execution based on task complexity and model confidence scoring, and silently falls back to cloud providers when local execution fails or is outmatched.

---

## 1. Functional Requirements

### 1.1 Device Capability Probing (`detect`)
- **Hardware Telemetry**:
  - Memory: Check available RAM (`navigator.deviceMemory` in browser, `os.totalmem()` / `os.freemem()` in Node.js).
  - Compute Acceleration: Probe WebGPU support (`navigator.gpu.requestAdapter()`) and WebAssembly SIMD support.
  - Concurrency: Detect CPU logical cores (`navigator.hardwareConcurrency`, `os.cpus().length`).
  - Network: Inspect online status (`navigator.onLine`), round-trip time (`connection.rtt`), and downlink speed.
- **Model Feasibility Checks (`canLoad`)**:
  - `llm`: Requires WebGPU or minimum 4GB RAM + 4 CPU cores (for quantized lightweight LLMs).
  - `stt`: Requires Web Speech API or minimum 2GB RAM + 2 CPU cores (for local Whisper).
  - `tts`: Requires Web Speech Synthesis or minimum 2GB RAM + 2 CPU cores (for local synthesis).

### 1.2 Model Execution & Local Runtimes (`providers/local`)
- **LLM**: Local text generation via WebGPU / local runner with activation confidence scoring.
- **STT**: Local speech-to-text via browser SpeechRecognition or local audio buffer decoder.
- **TTS**: Local speech synthesis via browser SpeechSynthesis or local audio synthesis.

### 1.3 Cloud Providers & Fallback (`providers/cloud`)
- OpenAI / Gemini / OpenRouter / Anthropic or generic HTTP endpoints.
- Pluggable custom client functions for user-defined cloud backends.

### 1.4 Hybrid Routing & Complexity Balancer (`router`)
- **Confidence Scoring**: Estimates correctness probability P(correct) in [0, 1].
- **Task Complexity**: Classifies command vs. heavy reasoning task.
- **Threshold Escalation**: If local confidence is below `threshold` (default `0.70`), escalates task to cloud.
- **Modes**:
  - `auto`: Intelligently balances between local and cloud based on device capability, task complexity, and confidence.
  - `prefer-local`: Always tries local first, falls back to cloud on error or low confidence.
  - `prefer-cloud`: Uses cloud unless offline or latency-critical.
  - `local-only`: Restricts execution strictly to local device.
  - `cloud-only`: Bypasses local models entirely.
- **Silent Fallback Guarantee**:
  - If a local model fails to load, crashes, runs out of memory, or encounters a runtime error, the request automatically and silently succeeds by routing to the cloud provider without throwing exceptions to the caller.
  - Emits observable events (`route`, `fallback`, `load`) for logging and telemetry.

---

## 2. API Contract (Hemanth Module Style)

### 2.1 Default Export
```js
const localfirst = require('localfirst');
const ai = await localfirst(options);
```

### 2.2 Core Methods
- `ai.ask(prompt, options)`: Hybrid LLM query resolution.
- `ai.transcribe(audio, options)`: Hybrid Speech-to-Text.
- `ai.speak(text, options)`: Hybrid Text-to-Speech.
- `ai.detect()`: Returns full device profile & capability metrics.
- `ai.can(type)`: Boolean check if device can load `'llm' | 'stt' | 'tts'`.
- `ai.load(type)`: Preloads local model into memory.
- `ai.route(task, options)`: Returns routing decision `{ target: 'local' | 'cloud', confidence, reason }`.
- `ai.on(event, listener)`: Event emitter (`'route'`, `'fallback'`, `'load'`, `'error'`).

---

## 3. Performance & Size Goals
- Zero external production dependencies (`node_modules` size < 50KB).
- < 2ms capability probe overhead.
- Pure Dual ESM & CommonJS support.
