import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    clean: true,
  },
  {
    // CLI is ESM-only; must not be part of the CJS build.
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    clean: false,
  },
]);
