import fs from 'node:fs';
import { compileSqlModule } from './emit';

/**
 * Structural esbuild plugin shape — intentionally NOT esbuild's `Plugin`
 * type, so consumers without esbuild's types installed get a working d.ts.
 * Assignability to esbuild's `Plugin` is verified by a compile test.
 */
export interface SqlLoaderEsbuildPlugin {
  name: string;
  setup(build: {
    onLoad(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { contents: string; loader: 'js' },
    ): void;
  }): void;
}

/**
 * esbuild plugin: makes `.sql` files importable as modules.
 *
 * If you only ever need the raw string (no `-- name:` handling), esbuild's
 * built-in `loader: { '.sql': 'text' }` is enough — this plugin's value is
 * the named-query module shape.
 *
 * @example
 * import { build } from 'esbuild';
 * import { sqlLoader } from 'sql-loader/esbuild';
 * await build({ entryPoints: ['app.ts'], bundle: true, plugins: [sqlLoader()] });
 */
export function sqlLoader(): SqlLoaderEsbuildPlugin {
  return {
    name: 'sql-loader',
    setup(build) {
      build.onLoad({ filter: /\.sql$/ }, (args) => {
        const raw = fs.readFileSync(args.path, 'utf8');
        return { contents: compileSqlModule(raw, args.path).code, loader: 'js' };
      });
    },
  };
}
