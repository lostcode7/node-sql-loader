// Ambient wildcard declaration for `.sql` imports. Opt-in:
//   tsconfig.json → { "compilerOptions": { "types": ["sql-loader/types"] } }
// or a triple-slash directive: /// <reference types="sql-loader/types" />
//
// TypeScript cannot express per-file named exports for a wildcard module, so
// this is a deliberate approximation:
// - plain files: the default export IS the SQL string (accurate)
// - `-- name:` files: the default export is a frozen object of query strings;
//   property access on it (users.findById) is the blessed typed pattern.
// Named imports (`import { findById } from './users.sql'`) work at runtime
// but cannot be typed here — use `sql-loader generate` for precise types.
declare module '*.sql' {
  const sql: string & { readonly [queryName: string]: string };
  export default sql;
}
