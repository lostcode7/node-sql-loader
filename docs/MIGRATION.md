# Migrating from sql-loader v1 to v2

v2 is a full rewrite. The core idea is unchanged — a SQL directory becomes a nested object of query strings — but the API surface, path resolution, and guarantees are different.

## The two changes most likely to break your code

### 1. The module is no longer a callable function

```js
// v1
const sqlLoader = require('sql-loader');
const sql = sqlLoader('../sql');

// v2 (CJS)
const { loadSqlSync } = require('sql-loader');
const sql = loadSqlSync(`${__dirname}/../sql`);

// v2 (ESM, recommended)
import { loadSql } from 'sql-loader';
const sql = await loadSql(new URL('../sql/', import.meta.url));
```

Calling the module itself now fails with "is not a function".

### 2. Relative string paths resolve against `process.cwd()`, not the calling file

v1 inspected the stack to find the calling file and resolved relative paths against it (this also permanently corrupted `Error.prepareStackTrace` for the whole process). v2 removes caller inspection entirely:

| source | v1 behavior | v2 behavior |
|---|---|---|
| `new URL('./sql/', import.meta.url)` | n/a | module-relative (use this for the v1 feel) |
| `'./sql'` (relative string) | relative to the **calling file** | relative to **`process.cwd()`** |
| `'/sql'` | appended to the main module's directory | absolute path, used as-is |
| `'F:\\proj\\sql'` (Windows absolute) | broken (string concatenation) | works |

If a path that worked in v1 now throws `ERR_SOURCE_NOT_FOUND`, this is why — the error message itself explains the fix.

## Other behavioral changes

| | v1 | v2 |
|---|---|---|
| Singleton | first directory wins, second call ignored | every call independent; reuse the returned object for caching |
| File matching | any filename containing `sql` (regex `/sql/`) | exact `.sql` extension, case-sensitive |
| Key derivation | first `".sql"` occurrence removed | only the final `.sql` stripped; dots preserved |
| `foo.sql` + `foo/` conflict | silent overwrite | `ERR_NAME_COLLISION` error |
| Empty files | loaded as `''` | error by default (`onEmpty: 'warn' \| 'ignore'` to relax) |
| Tree mutability | plain mutable object | deeply frozen, null-prototype |
| Line endings / BOM | raw bytes | CRLF→LF normalized, BOM stripped |
| Errors | thrown strings / raw fs errors | `SqlLoaderError` with stable `code` and fix hints |
| Node support | ancient | >= 22, ESM + CJS dual, bundled TypeScript types |

## New capabilities worth adopting

- **Named queries** — several queries per file with `-- name:` markers; the file becomes a namespace.
- **Typed codegen** — `npx sql-loader generate ./sql --out src/sql.generated.ts` embeds SQL into one typed module with autocomplete; `sql-loader check --generated` detects staleness in CI.
- **Catalog metadata** — `loadSqlCatalog` returns a flat `Map` plus per-query and per-directory `sha256-` hashes.
- **Watch mode** — `watchSql(dir)` for dev-time reload with hash-diffed change events.
- **Programmatic validation** — `checkSqlSync(dir)` returns all diagnostics without throwing.

## Checklist

1. Replace the callable usage with `loadSqlSync` / `await loadSql`.
2. Convert relative string paths to `new URL('./sql/', import.meta.url)` (ESM) or `path.join(__dirname, ...)` (CJS).
3. If you loaded the same directory from multiple modules, load once and share the result (the v1 singleton did this implicitly).
4. Rename any non-`.sql` files you were relying on, and resolve any file/directory name conflicts (v2 reports them precisely).
5. Ensure Node >= 22.
