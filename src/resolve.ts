import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlLoaderError } from './errors';

/** Resolved source directory plus the original spelling for error messages. */
export interface ResolvedSource {
  /** Absolute directory path. */
  rootDir: string;
  /** How the caller spelled the source (used in error messages). */
  display: string;
}

const MIGRATION_HINT =
  'Note: sql-loader v2 resolves relative string paths against process.cwd(); ' +
  'v1 resolved them against the calling file. For module-relative resolution, ' +
  "pass new URL('./sql/', import.meta.url) instead of a string.";

/**
 * Resolve a `string | URL` source to an absolute directory path.
 * URLs must use the `file:` protocol. Relative strings resolve against
 * `process.cwd()`; absolute strings are used as-is.
 */
export function resolveSource(source: string | URL): ResolvedSource {
  if (source instanceof URL) {
    if (source.protocol !== 'file:') {
      throw new SqlLoaderError(
        'ERR_INVALID_SOURCE',
        `SQL source URL must use the file: protocol, got "${source.protocol}". ` +
          "Fix: pass new URL('./sql/', import.meta.url) or a directory path string.",
      );
    }
    try {
      return { rootDir: fileURLToPath(source), display: source.href };
    } catch (cause) {
      throw new SqlLoaderError(
        'ERR_INVALID_SOURCE',
        `SQL source URL could not be converted to a local path: ${source.href}. ` +
          'Fix: pass a file: URL that points to a local directory.',
        { cause },
      );
    }
  }
  if (typeof source !== 'string' || source.trim() === '') {
    throw new SqlLoaderError(
      'ERR_INVALID_SOURCE',
      'SQL source must be a non-empty directory path string or a file: URL. ' +
        "Fix: call e.g. loadSql(new URL('./sql/', import.meta.url)). " +
        MIGRATION_HINT,
    );
  }
  return { rootDir: path.resolve(source), display: source };
}

/** Error for a source directory that does not exist. */
export function sourceNotFoundError(resolved: ResolvedSource, cause?: unknown): SqlLoaderError {
  return new SqlLoaderError(
    'ERR_SOURCE_NOT_FOUND',
    `SQL directory not found: ${resolved.rootDir} (from "${resolved.display}"). ` +
      'Fix: check that the directory exists. ' +
      MIGRATION_HINT,
    cause === undefined ? undefined : { cause },
  );
}

/** Error for a source path that exists but is not a directory. */
export function notADirectoryError(resolved: ResolvedSource): SqlLoaderError {
  return new SqlLoaderError(
    'ERR_INVALID_SOURCE',
    `SQL source is not a directory: ${resolved.rootDir} (from "${resolved.display}"). ` +
      'Fix: pass the directory that contains your .sql files, not a file.',
  );
}
