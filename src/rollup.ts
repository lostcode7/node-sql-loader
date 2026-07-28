import { type SqlTransformResult, transformSqlId } from './transform';

/**
 * Structural plugin shape — intentionally NOT `import type { Plugin } from
 * 'rollup'`, so consumers without Rollup's types installed get a working d.ts.
 * Assignability to Rollup's `Plugin` is verified by a compile test.
 */
export interface SqlLoaderPlugin {
  name: string;
  enforce?: 'pre';
  transform(code: string, id: string): SqlTransformResult | null;
}

/**
 * Rollup plugin: makes `.sql` files importable as modules.
 *
 * - `import query from './find-user.sql'` — plain file, default string export
 * - `import { findById } from './users.sql'` — `-- name:` file, named exports
 *
 * Also works in Vite; prefer `sql-loader/vite` there (adds `enforce: 'pre'`).
 *
 * @example
 * // rollup.config.mjs
 * import { sqlLoader } from 'sql-loader/rollup';
 * export default { plugins: [sqlLoader()] };
 */
export function sqlLoader(): SqlLoaderPlugin {
  return {
    name: 'sql-loader',
    transform(code, id) {
      return transformSqlId(code, id);
    },
  };
}
