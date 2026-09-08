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

// src/detect.js
var detect_exports = {};
__export(detect_exports, {
  detect: () => detect
});
module.exports = __toCommonJS(detect_exports);
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
