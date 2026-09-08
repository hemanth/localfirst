import { detect } from './detect.js';
import { Router } from './router.js';
import { LocalProvider } from './providers/local.js';
import { CloudProvider } from './providers/cloud.js';
import { HybridEngine } from './core.js';

/**
 * Main factory function. Probes hardware capabilities, configures hybrid router,
 * and returns an active HybridEngine instance.
 *
 * @param {object} options
 * @returns {Promise<HybridEngine>}
 */
export default async function localfirst(options = {}) {
  const profile = await detect();
  const engine = new HybridEngine(options, profile);

  // Auto-preload capable local models if requested
  if (options.preload) {
    const tasks = Array.isArray(options.preload) ? options.preload : ['llm', 'stt', 'tts'];
    await Promise.all(
      tasks
        .filter((t) => engine.can(t))
        .map((t) => engine.load(t))
    );
  }

  return engine;
}

export {
  localfirst,
  localfirst as hybrid,
  detect,
  Router,
  LocalProvider,
  CloudProvider,
  HybridEngine
};
