import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { normalizeSqlText } from './parse';
import { notADirectoryError, type ResolvedSource, sourceNotFoundError } from './resolve';
import type { FilterInput, LoadOptions, OnEmpty, SqlDialect } from './types';

const SQL_EXTENSION = '.sql';

/** A `.sql` file discovered during a scan, with normalized content. */
export interface ScannedFile {
  absolutePath: string;
  /** Relative to the source root, always with `/` separators. */
  relativePath: string;
  /** Path segments including the basename with its extension. */
  segments: string[];
  /** File content, BOM-stripped and CRLF-normalized to LF. */
  text: string;
  /** Whether the file started with a UTF-8 BOM (reported by `check`). */
  hadBom: boolean;
}

/** A file or directory that could not be read (collected only for `check`). */
export interface ScanProblem {
  relativePath: string;
  message: string;
}

export interface ScanResult {
  files: ScannedFile[];
  problems: ScanProblem[];
}

/** `LoadOptions` with defaults applied. */
export interface ResolvedOptions {
  filter: RegExp | ((file: FilterInput) => boolean) | null;
  onEmpty: OnEmpty;
  followSymlinks: boolean;
  encoding: BufferEncoding;
  dialect: SqlDialect | null;
}

export function resolveOptions(options: LoadOptions = {}): ResolvedOptions {
  return {
    filter: options.filter ?? null,
    onEmpty: options.onEmpty ?? 'error',
    followSymlinks: options.followSymlinks ?? false,
    encoding: options.encoding ?? 'utf-8',
    dialect: options.dialect ?? null,
  };
}

/** Deterministic, locale-independent name ordering (UTF-16 code units). */
export function compareNames(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function includeFile(
  name: string,
  relativePath: string,
  absolutePath: string,
  options: ResolvedOptions,
): boolean {
  if (path.extname(name) !== SQL_EXTENSION) return false;
  if (options.filter === null) return true;
  if (options.filter instanceof RegExp) return options.filter.test(relativePath);
  return options.filter({ relativePath, absolutePath });
}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Synchronous scan. When `collectProblems` is false (runtime loads), read
 * failures propagate as-is; when true (the `check` CLI), they are collected
 * so one unreadable file does not hide the rest of the report.
 */
export function scanSync(
  resolved: ResolvedSource,
  options: ResolvedOptions,
  collectProblems = false,
): ScanResult {
  let rootStat: fs.Stats;
  try {
    rootStat = fs.statSync(resolved.rootDir);
  } catch (cause) {
    throw sourceNotFoundError(resolved, cause);
  }
  if (!rootStat.isDirectory()) throw notADirectoryError(resolved);

  const files: ScannedFile[] = [];
  const problems: ScanProblem[] = [];

  const walk = (dirAbs: string, relSegments: string[]): void => {
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch (cause) {
      if (!collectProblems) throw cause;
      problems.push({ relativePath: relSegments.join('/'), message: toMessage(cause) });
      return;
    }
    dirents.sort((a, b) => compareNames(a.name, b.name));
    for (const dirent of dirents) {
      const abs = path.join(dirAbs, dirent.name);
      const segments = [...relSegments, dirent.name];
      const rel = segments.join('/');
      let isDir = dirent.isDirectory();
      let isFile = dirent.isFile();
      if (dirent.isSymbolicLink()) {
        if (!options.followSymlinks) continue;
        try {
          const stat = fs.statSync(abs);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch (cause) {
          if (collectProblems) problems.push({ relativePath: rel, message: toMessage(cause) });
          continue;
        }
      }
      if (isDir) {
        walk(abs, segments);
        continue;
      }
      if (!isFile || !includeFile(dirent.name, rel, abs, options)) continue;
      try {
        const raw = fs.readFileSync(abs, options.encoding);
        const { text, hadBom } = normalizeSqlText(raw);
        files.push({ absolutePath: abs, relativePath: rel, segments, text, hadBom });
      } catch (cause) {
        if (!collectProblems) throw cause;
        problems.push({ relativePath: rel, message: toMessage(cause) });
      }
    }
  };

  walk(resolved.rootDir, []);
  return { files, problems };
}

/** Asynchronous scan. Same traversal rules and output as {@link scanSync}. */
export async function scan(
  resolved: ResolvedSource,
  options: ResolvedOptions,
  collectProblems = false,
): Promise<ScanResult> {
  let rootStat: fs.Stats;
  try {
    rootStat = await fsp.stat(resolved.rootDir);
  } catch (cause) {
    throw sourceNotFoundError(resolved, cause);
  }
  if (!rootStat.isDirectory()) throw notADirectoryError(resolved);

  const files: ScannedFile[] = [];
  const problems: ScanProblem[] = [];

  const walk = async (dirAbs: string, relSegments: string[]): Promise<void> => {
    let dirents: fs.Dirent[];
    try {
      dirents = await fsp.readdir(dirAbs, { withFileTypes: true });
    } catch (cause) {
      if (!collectProblems) throw cause;
      problems.push({ relativePath: relSegments.join('/'), message: toMessage(cause) });
      return;
    }
    dirents.sort((a, b) => compareNames(a.name, b.name));
    for (const dirent of dirents) {
      const abs = path.join(dirAbs, dirent.name);
      const segments = [...relSegments, dirent.name];
      const rel = segments.join('/');
      let isDir = dirent.isDirectory();
      let isFile = dirent.isFile();
      if (dirent.isSymbolicLink()) {
        if (!options.followSymlinks) continue;
        try {
          const stat = await fsp.stat(abs);
          isDir = stat.isDirectory();
          isFile = stat.isFile();
        } catch (cause) {
          if (collectProblems) problems.push({ relativePath: rel, message: toMessage(cause) });
          continue;
        }
      }
      if (isDir) {
        await walk(abs, segments);
        continue;
      }
      if (!isFile || !includeFile(dirent.name, rel, abs, options)) continue;
      try {
        const raw = await fsp.readFile(abs, options.encoding);
        const { text, hadBom } = normalizeSqlText(raw);
        files.push({ absolutePath: abs, relativePath: rel, segments, text, hadBom });
      } catch (cause) {
        if (!collectProblems) throw cause;
        problems.push({ relativePath: rel, message: toMessage(cause) });
      }
    }
  };

  await walk(resolved.rootDir, []);
  return { files, problems };
}
