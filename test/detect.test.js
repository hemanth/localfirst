import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/detect.js';

test('detect() returns valid hardware telemetry and model readiness', async () => {
  const profile = await detect();

  assert.equal(profile.runtime, 'node');
  assert.ok(typeof profile.cores === 'number' && profile.cores > 0);
  assert.ok(typeof profile.memory.totalGb === 'number' && profile.memory.totalGb > 0);
  assert.ok(typeof profile.wasmSimd === 'boolean');
  assert.equal(profile.wasmSimd, true);
  assert.ok(typeof profile.online === 'boolean');

  assert.ok('llm' in profile.models);
  assert.ok('stt' in profile.models);
  assert.ok('tts' in profile.models);

  assert.ok(typeof profile.models.llm.capable === 'boolean');
  assert.ok(typeof profile.models.stt.capable === 'boolean');
  assert.ok(typeof profile.models.tts.capable === 'boolean');
});

test('detect() detects browser environment mock accurately', async () => {
  // Mock browser globals
  global.window = {
    SpeechRecognition: class MockSpeechRecognition {},
    speechSynthesis: { speak: () => {} }
  };

  const origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: {
      onLine: true,
      hardwareConcurrency: 8,
      deviceMemory: 16,
      gpu: {
        requestAdapter: async () => ({
          info: { device: 'Apple M3 Pro' }
        })
      }
    },
    configurable: true,
    writable: true
  });

  try {
    const profile = await detect();
    assert.equal(profile.runtime, 'browser');
    assert.equal(profile.gpu.webgpu, true);
    assert.equal(profile.gpu.adapter, 'Apple M3 Pro');
    assert.equal(profile.models.llm.capable, true);
    assert.equal(profile.models.llm.tier, 'webgpu');
    assert.equal(profile.models.stt.capable, true);
    assert.equal(profile.models.tts.capable, true);
  } finally {
    delete global.window;
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    }
  }
});

test('detect() respects cache and supports forceRefresh', async () => {
  const first = await detect();
  const second = await detect();
  assert.equal(second.cached, true);

  const third = await detect({ forceRefresh: true });
  assert.equal(third.cached, undefined);
});

