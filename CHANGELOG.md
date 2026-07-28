# Changelog

## 2.0.0

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
