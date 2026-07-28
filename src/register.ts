import module from 'node:module';

/**
 * Side-effect entry: `node --import sql-loader/register app.mjs` makes
 * `.sql` files importable via ESM `import` (static and dynamic).
 *
 * Deliberately uses `module.register` (stable across all Node 22) rather
 * than `module.registerHooks`: routing `require('./x.sql')` through a
 * load hook crashes inside Node's require(esm) translator on current 22.x,
 * so CJS `require` of `.sql` is documented as unsupported — use `import`
 * or the bundler plugins instead.
 */
module.register(new URL('./hooks.js', import.meta.url));
