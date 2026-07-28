import { sqlLoader as rollupSqlLoader, type SqlLoaderPlugin } from './rollup';

export type { SqlLoaderPlugin } from './rollup';

/**
 * Vite plugin: makes `.sql` files importable as modules. The Rollup plugin
 * plus `enforce: 'pre'` so it runs before other transforms. `?raw`, `?url`,
 * and `?inline` imports are left to Vite's asset pipeline.
 *
 * HMR note: `.sql` edits propagate to importers (typically a full reload) —
 * the generated module intentionally does not self-accept, which would leave
 * importers holding stale strings.
 *
 * @example
 * // vite.config.ts
 * import { sqlLoader } from 'sql-loader/vite';
 * export default { plugins: [sqlLoader()] };
 */
export function sqlLoader(): SqlLoaderPlugin {
  return { ...rollupSqlLoader(), enforce: 'pre' };
}
