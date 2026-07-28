// Compile-only test: our structural plugin types must remain assignable to
// the real bundler plugin types (which we deliberately do not reference in
// the shipped d.ts). Run via `tsc -p test/types` in the test suite.
import type { Plugin as EsbuildPlugin } from 'esbuild';
import type { Plugin as RollupPlugin } from 'rollup';
import { sqlLoader as esbuildSql } from '../../dist/esbuild.js';
import { sqlLoader as rollupSql } from '../../dist/rollup.js';
import { sqlLoader as viteSql } from '../../dist/vite.js';

const rollupPlugin: RollupPlugin = rollupSql();
const vitePlugin: RollupPlugin = viteSql();
const esbuildPlugin: EsbuildPlugin = esbuildSql();

export { esbuildPlugin, rollupPlugin, vitePlugin };
