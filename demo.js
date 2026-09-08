import localfirst, { detect } from './src/index.js';

console.log('=== 1. Probing Hardware Capabilities ===');
const telemetry = await detect();
console.log(`Runtime:    ${telemetry.runtime}`);
console.log(`Cores:      ${telemetry.cores}`);
console.log(`RAM:        ${telemetry.memory.totalGb} GB`);
console.log(`Wasm SIMD:  ${telemetry.wasmSimd ? '✓ Available' : '✗ Unsupported'}`);
console.log(`WebGPU:     ${telemetry.gpu.webgpu ? '✓ ' + telemetry.gpu.adapter : '✗ None'}`);
console.log('Model Suitability:');
console.log(`  LLM:      ${telemetry.models.llm.capable ? '✓ Can run on-device' : '✗ Fallback to cloud'} (${telemetry.models.llm.reason})`);
console.log(`  STT:      ${telemetry.models.stt.capable ? '✓ Can run on-device' : '✗ Fallback to cloud'} (${telemetry.models.stt.reason})`);
console.log(`  TTS:      ${telemetry.models.tts.capable ? '✓ Can run on-device' : '✗ Fallback to cloud'} (${telemetry.models.tts.reason})\n`);

console.log('=== 2. Initializing localfirst Engine ===');
const ai = await localfirst({
  confidenceThreshold: 0.70,
  local: {
    llm: {
      generate: async (prompt) => {
        // Fast local execution simulation
        return {
          text: `On-device: Handled "${prompt}" in 12ms`,
          confidence: 0.91
        };
      }
    }
  },
  cloud: {
    ask: async (prompt) => {
      // Cloud fallback simulation
      return {
        text: `Cloud: High-precision reasoning answer for "${prompt}"`
      };
    }
  }
});

ai.on('route', ({ task, target, confidence, complexity, reason }) => {
  console.log(`[ROUTE] ${task.toUpperCase()} → ${target.toUpperCase()} (confidence: ${confidence.toFixed(2)}, complexity: ${complexity.toFixed(2)})`);
  console.log(`        Reason: ${reason}`);
});

ai.on('fallback', ({ task, reason }) => {
  console.log(`[FALLBACK] ${task.toUpperCase()} fallback triggered: ${reason}`);
});

console.log('\n=== 3. Running Simple Command (Local) ===');
const res1 = await ai.ask('Set kitchen light to warm amber');
console.log(`Result: ${res1.text} (source: ${res1.source})\n`);

console.log('=== 4. Running Complex Reasoning (Cloud Escalation) ===');
const res2 = await ai.ask('Provide a rigorous mathematical proof of the Riemann hypothesis and optimize distributed consensus algorithm');
console.log(`Result: ${res2.text} (source: ${res2.source})\n`);

console.log('=== 5. Testing Silent Fallback on Local Error ===');
const aiWithFailingLocal = await localfirst({
  local: {
    llm: {
      generate: async () => {
        throw new Error('WebGPU context lost (Out of VRAM)');
      }
    }
  },
  cloud: {
    ask: async (prompt) => ({ text: `Cloud seamlessly handled: ${prompt}` })
  }
});

aiWithFailingLocal.on('fallback', ({ reason }) => {
  console.log(`[FALLBACK] Silently caught: ${reason}`);
});

const res3 = await aiWithFailingLocal.ask('Quick query with broken local model');
console.log(`Result: ${res3.text} (source: ${res3.source})`);

console.log('\n=== Demo Completed Successfully ===');
