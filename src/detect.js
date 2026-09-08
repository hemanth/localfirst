/**
 * Device capability probe for on-device AI execution.
 * Detects WebGPU, CPU concurrency, RAM, Wasm SIMD, and Speech APIs.
 */

let memoryCache = null;

export async function detect(options = {}) {
  const useCache = options.cache !== false;
  const forceRefresh = options.forceRefresh === true;

  const isBrowser = typeof window !== 'undefined' && typeof navigator !== 'undefined';
  const isNode = typeof process !== 'undefined' && process.versions && !!process.versions.node;
  const currentRuntime = isBrowser ? 'browser' : (isNode ? 'node' : 'unknown');

  if (useCache && !forceRefresh && memoryCache && memoryCache.runtime === currentRuntime) {
    const isOnline = isBrowser ? (navigator.onLine !== false) : true;
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

  // 1. Detect Wasm SIMD
  const wasmSimd = checkWasmSimd();

  // 2. Browser Environment
  if (isBrowser) {
    online = navigator.onLine !== false;
    cores = navigator.hardwareConcurrency || 4;

    if (navigator.deviceMemory) {
      totalMemoryGb = navigator.deviceMemory;
    }

    if (navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          hasWebGPU = true;
          gpuInfo = {
            webgpu: true,
            adapter: adapter.info?.device || 'WebGPU Device'
          };
        }
      } catch {
        gpuInfo = { webgpu: false, adapter: null };
      }
    }

    hasSpeechRecognition = Boolean(
      window.SpeechRecognition ||
      window.webkitSpeechRecognition
    );

    hasSpeechSynthesis = Boolean(
      window.speechSynthesis &&
      typeof window.speechSynthesis.speak === 'function'
    );
  }

  // 3. Node.js Environment
  if (isNode && !isBrowser) {
    try {
      const osModule = 'node:os';
      const os = await import(osModule);
      totalMemoryGb = +(os.totalmem() / (1024 ** 3)).toFixed(2);
      freeMemoryGb = +(os.freemem() / (1024 ** 3)).toFixed(2);
      cores = os.cpus()?.length || 4;
    } catch {
      // fallback safe defaults
    }
  }

  // 4. Model capability feasibility heuristics
  const canLlm = hasWebGPU || (totalMemoryGb >= 4 && cores >= 4 && wasmSimd);
  const llmTier = hasWebGPU ? 'webgpu' : (canLlm ? 'wasm-simd' : 'none');

  const canStt = hasSpeechRecognition || (totalMemoryGb >= 2 && cores >= 2);
  const sttTier = hasSpeechRecognition ? 'native-speech' : (canStt ? 'wasm' : 'none');

  const canTts = hasSpeechSynthesis || (totalMemoryGb >= 2 && cores >= 2);
  const ttsTier = hasSpeechSynthesis ? 'native-speech' : (canTts ? 'wasm' : 'none');

  const result = {
    runtime: isBrowser ? 'browser' : (isNode ? 'node' : 'unknown'),
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
        reason: canLlm ? 'Sufficient resources for on-device LLM' : 'Requires WebGPU or >= 4GB RAM + SIMD'
      },
      stt: {
        capable: canStt,
        tier: sttTier,
        reason: canStt ? 'Speech recognition supported' : 'Requires Speech API or >= 2GB RAM'
      },
      tts: {
        capable: canTts,
        tier: ttsTier,
        reason: canTts ? 'Speech synthesis supported' : 'Requires SpeechSynthesis or >= 2GB RAM'
      }
    }
  };

  memoryCache = result;
  return result;
}

/**
 * Validates WebAssembly SIMD instruction support.
 */
function checkWasmSimd() {
  try {
    if (typeof WebAssembly === 'undefined' || typeof WebAssembly.validate !== 'function') {
      return false;
    }
    // Minimal valid Wasm module with SIMD v128 instruction
    const bytes = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
      0x03, 0x02, 0x01, 0x00,
      0x0a, 0x16, 0x01, 0x14, 0x00,
      0xfd, 0x0c,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x0b
    ]);
    return WebAssembly.validate(bytes);
  } catch {
    return false;
  }
}
