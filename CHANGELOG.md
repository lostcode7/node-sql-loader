# Changelog

## 2.1.0-beta.0 - 2026-07-29

`.sql` files are now directly importable — the "loader" in the name is literal.

### Added

- Bundler plugins as export subpaths (zero runtime dependencies; dual ESM/CJS):
  `sql-loader/vite`, `sql-loader/rollup`, `sql-loader/esbuild`.
  Plain files compile to a default string export; `-- name:` files to named
  exports plus a frozen default object. Reserved-word query names work via
  alias exports (`import { delete as removeUser } ...`).
- Node ESM loader: `node --import sql-loader/register app.mjs` (ESM-only).
  CJS `require('./x.sql')` is intentionally unsupported (Node's require(esm)
  translator crashes with customization-hook-provided modules on current 22.x).
- `sql-loader/types`: opt-in ambient `declare module '*.sql'` declarations.
- `compileSqlModule(rawText, filePath)` public API — the shared single-file
  compiler behind all plugins, usable for custom integrations.
- In Vite, `?raw`/`?url`/`?inline` `.sql` imports keep their asset semantics.

## 2.0.0-beta.0 - 2026-07-29

Full rewrite. Positioning: “Load and compile `.sql` files into a safe, typed query catalog.”

### Breaking

- The module is no longer callable — use named exports: `loadSql`, `loadSqlSync`, `loadSqlCatalog(Sync)`, `checkSql(Sync)`, `watchSql`, `SqlLoaderError`.
- Relative string paths resolve against `process.cwd()` (v1: the calling file). Pass `new URL('./sql/', import.meta.url)` for module-relative resolution.
- Singleton cache removed; every call returns an independent result.
- Only exact `.sql` extensions load (v1 matched any filename containing `sql`).
- Empty files and empty roots are errors by default (`onEmpty` option to relax).
- File-vs-directory and duplicate-ID conflicts are hard errors instead of silent overwrites.
- Node.js >= 22 required.

### Added

- ESM + CJS dual build with bundled TypeScript declarations; zero runtime dependencies.
- Named queries: `-- name: queryName` markers, several queries per file.
- `loadSqlCatalog`: flat `Map` catalog, per-query and per-directory `sha256-` hashes.
- CLI: `sql-loader generate` (byte-deterministic embedded codegen, `--format ts|js`) and `sql-loader check` (full diagnostics, `--json`, staleness detection via generated-file header). Exit-code contract: 0/1/2.
- `watchSql`: debounced, hash-diffed dev-time reload with `poll` fallback and `Symbol.asyncDispose` support.
- `checkSql(Sync)`: programmatic validation returning all diagnostics without throwing.
- Safety: deeply frozen null-prototype trees, BOM stripping, CRLF→LF normalization, deterministic binary sort order, `SqlLoaderError` with stable codes and fix hints.
- AI-agent support: `llms.txt` shipped in the package, machine-readable CLI output, self-correcting error messages.

### Fixed (vs v1)

- Windows absolute paths no longer break (v1 concatenated strings).
- `Error.prepareStackTrace` is no longer overwritten (v1 permanently corrupted process-wide stack traces).
- Loading no longer depends on `require.main` (v1 crashed under `node -e`, ESM, and test runners).
