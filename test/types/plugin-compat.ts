// Compile-only test: our structural plugin types must remain assignable to
// the real bundler plugin types (which we deliberately do not reference in
// the shipped d.ts). Run via `tsc -p test/types` in the test suite.
import type { Plugin as EsbuildPlugin } from 'esbuild';
import type { Client, Pool, PoolClient } from 'pg';
import type { Plugin as RollupPlugin } from 'rollup';
import { sqlLoader as esbuildSql } from '../../dist/esbuild.js';
import type { PgQueryable } from '../../dist/pg.js';
import { sqlLoader as rollupSql } from '../../dist/rollup.js';
import { sqlLoader as viteSql } from '../../dist/vite.js';

const rollupPlugin: RollupPlugin = rollupSql();
const vitePlugin: RollupPlugin = viteSql();
const esbuildPlugin: EsbuildPlugin = esbuildSql();

// pg's real client types must satisfy our structural PgQueryable.
declare const pool: Pool;
declare const client: Client;
declare const poolClient: PoolClient;
const q1: PgQueryable = pool;
const q2: PgQueryable = client;
const q3: PgQueryable = poolClient;

export { esbuildPlugin, q1, q2, q3, rollupPlugin, vitePlugin };
