import { createHash } from 'node:crypto';
import type { SqlEntry } from './types';

/** Hash of a query text, formatted `sha256-<hex>`. Input is the normalized (LF) text. */
export function hashText(text: string): string {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

/**
 * Directory content hash: sha-256 over `id + "\n" + contentHash + "\n"` for all
 * entries in sorted-ID order. Depends only on IDs and content — never on
 * absolute paths, mtimes, or machine state.
 */
export function hashCatalog(entries: readonly SqlEntry[]): string {
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const h = createHash('sha256');
  for (const entry of sorted) {
    h.update(`${entry.id}\n${entry.hash}\n`, 'utf8');
  }
  return `sha256-${h.digest('hex')}`;
}
