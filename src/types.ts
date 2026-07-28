/** Supported dialect for parameter compilation (opt-in). */
export type SqlDialect = 'postgres';

/** Declared result-shape of a query (`-- @returns <value>` annotation). */
export type SqlCardinality = 'zero-or-one' | 'exactly-one' | 'many' | 'none';

/**
 * A single SQL query loaded from disk.
 */
export interface SqlEntry {
  /** Query ID with `/` separators, e.g. `"users/findById"`. */
  id: string;
  /**
   * ORIGINAL SQL text (`:name` style preserved). UTF-8 BOM is stripped and
   * CRLF is normalized to LF. Never rewritten — `hash` and all catalog
   * hashes are computed over this text regardless of dialect mode.
   */
  text: string;
  /** Absolute path of the source `.sql` file. */
  filePath: string;
  /** Content hash of `text`, formatted as `sha256-<hex>`. */
  hash: string;
  /** 1-based line of the `-- name:` marker (named queries only). */
  line?: number;
  /**
   * Dialect-compiled text with named parameters rewritten to positional
   * placeholders (`:id` → `$1`). Present only when `dialect` is set and the
   * query uses named parameters.
   */
  compiledText?: string;
  /** Named parameter names in placeholder order (dialect mode only). */
  parameters?: string[];
  /** Highest positional placeholder index used (`$n`-style queries). */
  positionalCount?: number;
  /** Cardinality declared via `-- @returns` (dialect mode only). */
  cardinality?: SqlCardinality;
}

/**
 * Nested read-only tree of SQL strings mirroring the directory structure.
 * Leaves are SQL strings; inner nodes are nested trees.
 * Nodes have a `null` prototype and are deeply frozen.
 */
export interface SqlTree {
  readonly [key: string]: string | SqlTree;
}

/** Policy for empty SQL files and for a source directory containing no queries. */
export type OnEmpty = 'error' | 'warn' | 'ignore';

/** Argument passed to a `filter` predicate. */
export interface FilterInput {
  /** Path relative to the source directory, always with `/` separators. */
  relativePath: string;
  /** Absolute path of the file. */
  absolutePath: string;
}

/**
 * Options accepted by all load functions.
 */
export interface LoadOptions {
  /**
   * Include filter applied to each `.sql` file before IDs are derived.
   * A RegExp is tested against the POSIX-style relative path; a predicate
   * receives `{ relativePath, absolutePath }` and returns `true` to include.
   */
  filter?: RegExp | ((file: FilterInput) => boolean);
  /**
   * What to do when a `.sql` file is empty/whitespace-only, or when the
   * source directory contains no queries at all. Default: `'error'`.
   * `'warn'` emits a process warning (name `SqlLoaderWarning`) and keeps the
   * empty entry; `'ignore'` silently drops it.
   * Note: an empty named block (`-- name:` marker with no body) is always an error.
   */
  onEmpty?: OnEmpty;
  /** Follow symbolic links while scanning. Default: `false`. */
  followSymlinks?: boolean;
  /** File encoding used to read `.sql` files. Default: `'utf-8'`. */
  encoding?: BufferEncoding;
  /**
   * Opt-in parameter compilation. With `'postgres'`, `:name` parameters are
   * lexed (string/comment/dollar-quote aware), validated, and compiled to
   * `$n` placeholders on `SqlEntry.compiledText`; `-- @returns` annotations
   * populate `cardinality`. Original `text` and every hash stay unchanged.
   */
  dialect?: SqlDialect;
}

/**
 * Result of `loadSqlCatalog`/`loadSqlCatalogSync`.
 */
export interface CatalogResult {
  /** Nested tree of SQL strings (same shape as `loadSql`'s return value). */
  tree: SqlTree;
  /** Flat map from query ID (`users/findById`) to its entry. */
  catalog: Map<string, SqlEntry>;
  /** All entries in deterministic traversal order. */
  entries: SqlEntry[];
  /** Directory content hash (`sha256-<hex>`) over sorted `(id, hash)` pairs. */
  hash: string;
}
