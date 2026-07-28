/**
 * A single SQL query loaded from disk.
 */
export interface SqlEntry {
  /** Query ID with `/` separators, e.g. `"users/findById"`. */
  id: string;
  /** SQL text. UTF-8 BOM is stripped and CRLF is normalized to LF. */
  text: string;
  /** Absolute path of the source `.sql` file. */
  filePath: string;
  /** Content hash of `text`, formatted as `sha256-<hex>`. */
  hash: string;
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
