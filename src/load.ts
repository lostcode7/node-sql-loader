import { analyze, buildCatalog, type Diagnostic } from './build';
import { hashCatalog } from './hash';
import { resolveSource } from './resolve';
import { resolveOptions, scan, scanSync } from './scan';
import type { CatalogResult, LoadOptions, SqlEntry, SqlTree } from './types';

/**
 * Load a SQL directory into a catalog (tree + flat map + metadata).
 *
 * @example
 * const { tree, catalog } = await loadSqlCatalog(new URL('./sql/', import.meta.url));
 * catalog.get('users/findById')?.text;
 */
export async function loadSqlCatalog(
  source: string | URL,
  options?: LoadOptions,
): Promise<CatalogResult> {
  const resolved = resolveSource(source);
  const opts = resolveOptions(options);
  const scanned = await scan(resolved, opts);
  return buildCatalog(scanned, opts, resolved.display);
}

/** Synchronous variant of {@link loadSqlCatalog} (handy at startup or in CLIs). */
export function loadSqlCatalogSync(source: string | URL, options?: LoadOptions): CatalogResult {
  const resolved = resolveSource(source);
  const opts = resolveOptions(options);
  const scanned = scanSync(resolved, opts);
  return buildCatalog(scanned, opts, resolved.display);
}

/**
 * Load a SQL directory into a nested read-only tree of SQL strings.
 *
 * @example
 * const sql = await loadSql(new URL('./sql/', import.meta.url));
 * await db.query(sql.users.findById, [userId]);
 */
export async function loadSql(source: string | URL, options?: LoadOptions): Promise<SqlTree> {
  return (await loadSqlCatalog(source, options)).tree;
}

/** Synchronous variant of {@link loadSql}. */
export function loadSqlSync(source: string | URL, options?: LoadOptions): SqlTree {
  return loadSqlCatalogSync(source, options).tree;
}

/** Result of {@link checkSql}/{@link checkSqlSync}. */
export interface CheckResult {
  /** Entries that passed validation, in deterministic traversal order. */
  entries: SqlEntry[];
  /** Every problem found — nothing is thrown for content issues. */
  diagnostics: Diagnostic[];
  /** Directory content hash over the surviving entries. */
  hash: string;
}

/**
 * Validate a SQL directory without throwing on content problems.
 * Collects every diagnostic (duplicates, collisions, empty files, BOM,
 * unreadable files, case-insensitive ID clashes) instead of failing on the
 * first one. Source-level failures (missing directory, invalid source)
 * still throw. This is the programmatic equivalent of `sql-loader check`.
 */
export async function checkSql(source: string | URL, options?: LoadOptions): Promise<CheckResult> {
  const resolved = resolveSource(source);
  const opts = resolveOptions(options);
  const scanned = await scan(resolved, opts, true);
  const { entries, diagnostics } = analyze(scanned, opts, resolved.display);
  return { entries, diagnostics, hash: hashCatalog(entries) };
}

/** Synchronous variant of {@link checkSql}. */
export function checkSqlSync(source: string | URL, options?: LoadOptions): CheckResult {
  const resolved = resolveSource(source);
  const opts = resolveOptions(options);
  const scanned = scanSync(resolved, opts, true);
  const { entries, diagnostics } = analyze(scanned, opts, resolved.display);
  return { entries, diagnostics, hash: hashCatalog(entries) };
}
