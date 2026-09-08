import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

test('ESM bundle exports hybrid as default and named exports', async () => {
  const mod = await import('../dist/index.mjs');
  assert.equal(typeof mod.default, 'function');
  assert.equal(typeof mod.detect, 'function');
  assert.equal(typeof mod.Router, 'function');

  const ai = await mod.default();
  const res = await ai.ask('Hello from ESM bundle');
  assert.ok(res.text);
});

test('CommonJS bundle works with require()', async () => {
  const require = createRequire(import.meta.url);
  const hybrid = require('../dist/index.cjs');
  assert.equal(typeof hybrid, 'function');
  assert.equal(typeof hybrid.detect, 'function');

  const ai = await hybrid();
  const res = await ai.ask('Hello from CommonJS bundle');
  assert.ok(res.text);
});
