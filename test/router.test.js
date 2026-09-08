import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../src/router.js';

const mockCapableDevice = {
  online: true,
  models: {
    llm: { capable: true, tier: 'webgpu' },
    stt: { capable: true, tier: 'native-speech' },
    tts: { capable: true, tier: 'native-speech' }
  }
};

const mockIncapableDevice = {
  online: true,
  models: {
    llm: { capable: false, reason: 'Out of memory' },
    stt: { capable: false },
    tts: { capable: false }
  }
};

test('Router routes simple tasks to local and complex tasks to cloud in auto mode', () => {
  const router = new Router({ mode: 'auto', confidenceThreshold: 0.70 });

  // Simple query -> local
  const simpleDecision = router.decide('llm', 'turn on the living room light', mockCapableDevice);
  assert.equal(simpleDecision.target, 'local');
  assert.ok(simpleDecision.confidence >= 0.70);

  // Complex theorem proof -> cloud
  const complexPrompt = 'Provide a rigorous mathematical proof of the Riemann hypothesis and optimize distributed consensus algorithm';
  const complexDecision = router.decide('llm', complexPrompt, mockCapableDevice);
  assert.equal(complexDecision.target, 'cloud');
  assert.ok(complexDecision.complexity > 0.4);
});

test('Router respects incapable hardware and routes to cloud', () => {
  const router = new Router({ mode: 'auto' });
  const decision = router.decide('llm', 'hello', mockIncapableDevice);
  assert.equal(decision.target, 'cloud');
  assert.match(decision.reason, /incapable/);
});

test('Router handles offline mode by forcing local on capable device', () => {
  const router = new Router({ mode: 'auto' });
  const offlineCapable = {
    ...mockCapableDevice,
    online: false
  };

  const decision = router.decide('llm', 'complex algorithm theorem', offlineCapable);
  assert.equal(decision.target, 'local');
  assert.match(decision.reason, /offline/);
});

test('Router throws if offline and device is incapable', () => {
  const router = new Router({ mode: 'auto' });
  const offlineIncapable = {
    ...mockIncapableDevice,
    online: false
  };

  assert.throws(() => {
    router.decide('llm', 'hello', offlineIncapable);
  }, /offline and cannot run/);
});

test('Router supports custom confidence probe', () => {
  const customProbe = ({ input }) => {
    return input.includes('confident') ? 0.99 : 0.20;
  };

  const router = new Router({ mode: 'auto', probe: customProbe });
  const highConf = router.decide('llm', 'I am confident in this', mockCapableDevice);
  assert.equal(highConf.target, 'local');

  const lowConf = router.decide('llm', 'unsure prompt', mockCapableDevice);
  assert.equal(lowConf.target, 'cloud');
});

test('Router supports explicit target override (local or cloud)', () => {
  const router = new Router({ mode: 'auto' });

  // Force cloud even if simple
  const d1 = router.decide('llm', 'hi', mockCapableDevice, { target: 'cloud' });
  assert.equal(d1.target, 'cloud');
  assert.match(d1.reason, /explicit target override/);

  // Force local even if complex
  const d2 = router.decide('llm', 'solve complex equation', mockCapableDevice, { target: 'local' });
  assert.equal(d2.target, 'local');
  assert.match(d2.reason, /explicit target override/);
});

test('Router supports user-defined declarative rules', () => {
  const router = new Router({
    mode: 'auto',
    rules: [
      { match: /ping|pong/, target: 'local', reason: 'ping-pong rule' },
      { match: 'sensitive-data', target: 'local', reason: 'privacy rule' },
      { if: ({ complexity }) => complexity > 0.3, target: 'cloud', reason: 'strict complexity ceiling' }
    ]
  });

  const r1 = router.decide('llm', 'ping system', mockCapableDevice);
  assert.equal(r1.target, 'local');
  assert.equal(r1.reason, 'ping-pong rule');

  const r2 = router.decide('llm', 'process sensitive-data', mockCapableDevice);
  assert.equal(r2.target, 'local');
  assert.equal(r2.reason, 'privacy rule');

  const r3 = router.decide('llm', 'solve mathematical problem', mockCapableDevice);
  assert.equal(r3.target, 'cloud');
  assert.equal(r3.reason, 'strict complexity ceiling');
});

test('Router supports custom router function', () => {
  const customRouter = ({ input }) => {
    if (input.startsWith('!cloud')) return 'cloud';
    if (input.startsWith('!local')) return 'local';
  };

  const router = new Router({ mode: 'auto', router: customRouter });

  const d1 = router.decide('llm', '!cloud simple text', mockCapableDevice);
  assert.equal(d1.target, 'cloud');

  const d2 = router.decide('llm', '!local complex equation proof algorithm', mockCapableDevice);
  assert.equal(d2.target, 'local');
});
