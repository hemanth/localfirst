import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });

// Build ESM bundle
await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  outfile: 'dist/index.mjs',
  platform: 'neutral',
  target: ['es2022', 'node18'],
  packages: 'external'
});

// Build CJS bundle
await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/index.cjs',
  platform: 'neutral',
  target: ['es2022', 'node18'],
  packages: 'external',
  footer: {
    js: 'module.exports = Object.assign(localfirst, module.exports);'
  }
});

// Build IIFE standalone browser bundle for GitHub Pages
await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'iife',
  globalName: 'localfirstBundle',
  outfile: 'dist/localfirst.iife.js',
  platform: 'browser',
  target: ['es2022']
});

// Build subpath CJS bundles for detect & router
await build({
  entryPoints: ['src/detect.js'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/detect.cjs',
  platform: 'neutral',
  target: ['es2022', 'node18'],
  packages: 'external'
});

await build({
  entryPoints: ['src/router.js'],
  bundle: true,
  format: 'cjs',
  outfile: 'dist/router.cjs',
  platform: 'neutral',
  target: ['es2022', 'node18'],
  packages: 'external'
});

// Copy TypeScript typings
copyFileSync('src/index.d.ts', 'dist/index.d.ts');

console.log('Build complete: dist/index.mjs, dist/index.cjs, dist/localfirst.iife.js, dist/detect.cjs, dist/router.cjs, dist/index.d.ts');
