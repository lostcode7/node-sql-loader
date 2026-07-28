# sql-loader

> Load and compile `.sql` files into a safe, typed query catalog.

Keep your SQL in `.sql` files — with syntax highlighting, reviews, and diffs — and access it from Node.js as a nested, read-only catalog. Optionally compile the whole directory into a single typed module with full autocomplete.

- **Zero runtime dependencies** · ESM + CJS · TypeScript types included · Node.js >= 22
- **Deterministic**: same directory → same IDs, same order, same hashes, on every OS
- **Safe**: frozen null-prototype trees, collision detection, actionable errors with stable codes
- **No SQL execution, no parameter templating** — parameters always go to your DB driver, never into the SQL string

```
npm install sql-loader
```

> Migrating from v1? See [Migrating from v1](#migrating-from-v1) — v2 is a full rewrite with breaking changes.

## Quick start

```
sql/
├─ users.sql          -- named queries (multiple per file)
└─ reports/
   └─ monthly.sql     -- one file = one query
```

```js
import { loadSql } from 'sql-loader';

const sql = await loadSql(new URL('./sql/', import.meta.url));

await db.query(sql.users.findById, [userId]);
await db.query(sql.reports.monthly);
```

CommonJS works the same way:

```js
const { loadSqlSync } = require('sql-loader');
const sql = loadSqlSync(`${__dirname}/sql`);
```

## Named queries

A file with `-- name:` markers holds several queries; the file becomes a namespace:

```sql
-- users.sql
-- name: findById
SELECT * FROM users WHERE id = :id;

-- name: insertOne
INSERT INTO users (name) VALUES (:name);
```

```js
sql.users.findById;   // "SELECT * FROM users WHERE id = :id;"
sql.users.insertOne;
```

Names must match `[A-Za-z_][A-Za-z0-9_]*`; only comments may precede the first marker. Parsing is line-based (documented limitation: a marker-shaped line inside a string literal is still treated as a marker).

## Typed codegen — autocomplete for your SQL

Runtime loading can't tell TypeScript which files exist. The CLI can:

```
npx sql-loader generate ./sql --out src/sql.generated.ts
```

The generated module embeds the SQL (no filesystem access at runtime — bundler- and serverless-friendly):

```ts
import { queries, getSql } from './sql.generated.js';

queries.users.findById;      // autocompleted
queries.users.notExists;     // ✗ compile error
getSql('users/findById');    // ID-based access, typed by the SqlQueryId union
```

Keep it fresh in CI:

```
npx sql-loader check ./sql --generated src/sql.generated.ts
```

Exit codes: `0` ok · `1` findings or stale generated file · `2` usage/I/O error. Add `--json` for machine-readable diagnostics. Projects that can't compile TypeScript can use `--format js` (emits `.js` + `.d.ts`).

## API

| Function | Returns |
|---|---|
| `loadSql(source, options?)` / `loadSqlSync` | Nested read-only tree of SQL strings |
| `loadSqlCatalog(source, options?)` / `loadSqlCatalogSync` | `{ tree, catalog: Map<id, SqlEntry>, entries, hash }` |
| `checkSql(source, options?)` / `checkSqlSync` | All diagnostics without throwing — programmatic `check` |
| `watchSql(source, options?)` | Dev-time watcher with hash-diffed `change` events |

`source` is a `file:` URL (module-relative — recommended) or a path string (relative strings resolve against `process.cwd()`).

Options: `filter` (RegExp or predicate over the POSIX relative path), `onEmpty: 'error' | 'warn' | 'ignore'` (default `'error'`), `followSymlinks` (default `false`), `encoding` (default `'utf-8'`).

Every entry carries a `sha256-` content hash; the catalog carries a directory hash over sorted `(id, hash)` pairs — stable across machines and useful for cache keys and staleness checks.

### Errors

Everything throws `SqlLoaderError` with a stable `code` — branch on the code, and prefer `SqlLoaderError.isSqlLoaderError(err)` over `instanceof` (dual-package safe). Messages always include the file involved and a suggested fix.

`ERR_SOURCE_NOT_FOUND` · `ERR_INVALID_SOURCE` · `ERR_DUPLICATE_ID` · `ERR_NAME_COLLISION` · `ERR_EMPTY_SQL` · `ERR_INVALID_NAME` · `ERR_PRELUDE_CONTENT` · `ERR_WATCH_UNAVAILABLE`

### Dev-time reload

```js
import { watchSql } from 'sql-loader';

const watcher = watchSql(new URL('./sql/', import.meta.url));
watcher.on('error', console.error); // required — unhandled 'error' events crash the process
watcher.on('change', ({ snapshot, added, removed, changed }) => {
  currentSql = snapshot.tree;
});
```

Events are debounced, rescanned, and hash-diffed — editor save storms collapse into one accurate `change`. On filesystems where native watching is unreliable (NFS, containers), pass `{ poll: 1000 }`.

## Loading rules (deterministic by design)

- Only exact `.sql` extensions load (case-sensitive). `B.SQL` and `queries.sql.txt` are ignored.
- `get/user.sql` → ID `get/user` → tree access `sql.get.user`. Dots in basenames are preserved.
- Traversal uses binary code-unit ordering — never locale-dependent.
- UTF-8 BOM is stripped; CRLF is normalized to LF (text and hashes agree across OSes).
- File-vs-directory and duplicate-ID conflicts are hard errors, not silent overwrites.
- Trees are deeply frozen with null prototypes — `__proto__.sql` is just data.
- Symlinks are skipped unless `followSymlinks: true`; empty directories are omitted.

## For AI agents

This package ships a machine-oriented reference at [`llms.txt`](./llms.txt) (also inside the npm package: `node_modules/sql-loader/llms.txt`) covering exact signatures, the error-code → fix table, the CLI's JSON schema and exit-code contract, and the named-query grammar. Errors are designed for self-correction: every message states what broke, in which file, and how to fix it. `sql-loader check --json` and byte-deterministic `generate` output are safe to drive from automated loops.

## Migrating from v1

The two changes most likely to bite (full guide: [docs/MIGRATION.md](./docs/MIGRATION.md)):

1. **The module is no longer callable.** `require('sql-loader')('./sql')` → `loadSqlSync('./sql')` or `await loadSql(...)`.
2. **Relative strings now resolve against `process.cwd()`**, not the calling file. For the old behavior use `new URL('./sql/', import.meta.url)`.

Also: the singleton cache is gone (each call is independent), only exact `.sql` files load, and Node >= 22 is required.

## 한국어 요약

`.sql` 파일 디렉터리를 안전한 읽기 전용 쿼리 카탈로그로 불러오는 라이브러리입니다.

```js
import { loadSql } from 'sql-loader';
const sql = await loadSql(new URL('./sql/', import.meta.url));
await db.query(sql.users.findById, [userId]);
```

- `npx sql-loader generate ./sql --out src/sql.generated.ts` — SQL을 임베드한 타입 모듈 생성 (자동완성 + 오타는 컴파일 에러)
- `npx sql-loader check ./sql --generated src/sql.generated.ts` — CI에서 검증·재생성 필요 감지 (`--json` 지원)
- `watchSql(dir)` — 개발 중 `.sql` 변경 자동 반영
- **v1에서 오신 분**: 모듈이 더 이상 함수가 아닙니다(`loadSqlSync(dir)` 사용). 상대경로는 이제 호출 파일이 아닌 `process.cwd()` 기준입니다 — 모듈 기준 경로는 `new URL('./sql/', import.meta.url)`을 쓰세요. 자세한 내용: [docs/MIGRATION.md](./docs/MIGRATION.md)

## License

MIT
