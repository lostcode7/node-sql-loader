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
  {
    // Bundler plugins: dual, because bundler config files are CJS-heavy.
    entry: { vite: 'src/vite.ts', rollup: 'src/rollup.ts', esbuild: 'src/esbuild.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    clean: false,
  },
  {
    // Node loader: ESM-only (--import context). hooks is internal, referenced
    // by register via file URL — it is intentionally not an exports subpath.
    entry: { register: 'src/register.ts', hooks: 'src/hooks.ts' },
    format: ['esm'],
    dts: true,
    platform: 'node',
    target: 'node22',
    fixedExtension: false,
    clean: false,
  },
]);
