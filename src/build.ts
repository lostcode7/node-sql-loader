import { compilePostgresQuery } from './dialect';
import { SqlLoaderError, type SqlLoaderErrorCode } from './errors';
import { hashCatalog, hashText } from './hash';
import { parseSqlFile } from './parse';
import type { ResolvedOptions, ScanResult } from './scan';
import type { CatalogResult, SqlEntry, SqlTree } from './types';

const SQL_EXTENSION = '.sql';

export type DiagnosticCode =
  | SqlLoaderErrorCode
  | 'WARN_BOM'
  | 'WARN_CASE_INSENSITIVE_DUPLICATE'
  | 'WARN_UNREADABLE'
  | 'WARN_UNKNOWN_ANNOTATION';

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: DiagnosticCode;
  message: string;
  /** Relative path of the file involved, if any. */
  file?: string;
  /** Query ID involved, if any. */
  id?: string;
  /** 1-based line of the `-- name:` marker for named queries, if any. */
  line?: number;
}

export interface AnalyzeResult {
  entries: SqlEntry[];
  diagnostics: Diagnostic[];
}

interface Candidate {
  segments: string[];
  entry: SqlEntry;
  relativePath: string;
}

/**
 * Turn scanned files into validated entries plus a full diagnostics list.
 * Never throws for content problems — `buildCatalog` throws on the first
 * error-severity diagnostic, while the `check` CLI reports all of them.
 */
export function analyze(
  scanned: ScanResult,
  options: ResolvedOptions,
  rootDisplay: string,
): AnalyzeResult {
  const diagnostics: Diagnostic[] = [];
  const candidates: Candidate[] = [];

  for (const problem of scanned.problems) {
    diagnostics.push({
      severity: 'warning',
      code: 'WARN_UNREADABLE',
      message: `Could not read ${problem.relativePath || '<root>'}: ${problem.message}`,
      file: problem.relativePath,
    });
  }

  for (const file of scanned.files) {
    if (file.hadBom) {
      diagnostics.push({
        severity: 'warning',
        code: 'WARN_BOM',
        message:
          `${file.relativePath} starts with a UTF-8 BOM (stripped at load time). ` +
          'Fix: save the file without a BOM for byte-stable hashing across editors.',
        file: file.relativePath,
      });
    }

    const baseName = file.segments.at(-1);
    if (baseName === undefined) continue;
    const dirSegments = file.segments.slice(0, -1);
    const baseKey = baseName.slice(0, -SQL_EXTENSION.length);

    let parsed: ReturnType<typeof parseSqlFile>;
    try {
      parsed = parseSqlFile(file.text, file.relativePath);
    } catch (error) {
      if (SqlLoaderError.isSqlLoaderError(error)) {
        diagnostics.push({
          severity: 'error',
          code: error.code,
          message: error.message,
          file: file.relativePath,
        });
        continue;
      }
      throw error;
    }

    for (const query of parsed) {
      const segments =
        query.name === null ? [...dirSegments, baseKey] : [...dirSegments, baseKey, query.name];
      const id = segments.join('/');

      if (query.name === null && query.text.trim() === '') {
        if (options.onEmpty === 'ignore') continue;
        diagnostics.push({
          severity: options.onEmpty === 'error' ? 'error' : 'warning',
          code: 'ERR_EMPTY_SQL',
          message:
            `${file.relativePath} is empty (query "${id}"). ` +
            'Fix: add SQL, delete the file, or pass onEmpty: "warn" | "ignore".',
          file: file.relativePath,
          id,
        });
        if (options.onEmpty === 'error') continue;
      }

      const entry: SqlEntry = {
        id,
        text: query.text,
        filePath: file.absolutePath,
        hash: hashText(query.text),
      };
      if (query.line !== null) entry.line = query.line;

      if (options.dialect === 'postgres') {
        const context =
          query.name === null ? file.relativePath : `${file.relativePath} (query "${query.name}")`;
        const compiled = compilePostgresQuery(query.text, context);
        let hasParamError = false;
        for (const dialectDiagnostic of compiled.diagnostics) {
          if (dialectDiagnostic.severity === 'error') hasParamError = true;
          const diagnostic: Diagnostic = {
            severity: dialectDiagnostic.severity,
            code: dialectDiagnostic.code,
            message: dialectDiagnostic.message,
            file: file.relativePath,
            id,
          };
          if (query.line !== null) diagnostic.line = query.line;
          diagnostics.push(diagnostic);
        }
        if (!hasParamError) {
          if (compiled.parameters.length > 0) {
            entry.parameters = compiled.parameters;
            entry.compiledText = compiled.compiledText;
          }
          if (compiled.positionalCount > 0) entry.positionalCount = compiled.positionalCount;
          if (compiled.cardinality !== null) entry.cardinality = compiled.cardinality;
        }
      }

      candidates.push({ segments, relativePath: file.relativePath, entry });
    }
  }

  const entries: SqlEntry[] = [];
  const leaves = new Map<string, string>();
  const namespaces = new Map<string, string>();
  const lowerIds = new Map<string, string>();

  for (const candidate of candidates) {
    const { segments, entry, relativePath } = candidate;
    const id = entry.id;

    const duplicateSource = leaves.get(id);
    if (duplicateSource !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_DUPLICATE_ID',
        message:
          `Duplicate query ID "${id}" produced by both ${duplicateSource} and ${relativePath}. ` +
          'Fix: rename one of the files or named queries.',
        file: relativePath,
        id,
      });
      continue;
    }
    const namespaceSource = namespaces.get(id);
    if (namespaceSource !== undefined) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_NAME_COLLISION',
        message:
          `Query ID "${id}" from ${relativePath} collides with the namespace "${id}/" ` +
          `established by ${namespaceSource}. Fix: rename the file or the directory.`,
        file: relativePath,
        id,
      });
      continue;
    }

    let prefixConflict = false;
    for (let k = 1; k < segments.length; k++) {
      const prefix = segments.slice(0, k).join('/');
      const leafSource = leaves.get(prefix);
      if (leafSource !== undefined) {
        diagnostics.push({
          severity: 'error',
          code: 'ERR_NAME_COLLISION',
          message:
            `Query ID "${id}" from ${relativePath} needs the namespace "${prefix}/", but ` +
            `"${prefix}" is already a query from ${leafSource}. Fix: rename the file or the directory.`,
          file: relativePath,
          id,
        });
        prefixConflict = true;
        break;
      }
      if (!namespaces.has(prefix)) namespaces.set(prefix, relativePath);
    }
    if (prefixConflict) continue;

    const lower = id.toLowerCase();
    const lowerExisting = lowerIds.get(lower);
    if (lowerExisting !== undefined && lowerExisting !== id) {
      diagnostics.push({
        severity: 'warning',
        code: 'WARN_CASE_INSENSITIVE_DUPLICATE',
        message:
          `Query IDs "${lowerExisting}" and "${id}" differ only by case. ` +
          'They collide on case-insensitive filesystems (Windows/macOS defaults). Fix: rename one.',
        file: relativePath,
        id,
      });
    } else {
      lowerIds.set(lower, id);
    }

    leaves.set(id, relativePath);
    entries.push(entry);
  }

  const hasError = diagnostics.some((d) => d.severity === 'error');
  if (entries.length === 0 && !hasError && options.onEmpty !== 'ignore') {
    diagnostics.push({
      severity: options.onEmpty === 'error' ? 'error' : 'warning',
      code: 'ERR_EMPTY_SQL',
      message:
        `No .sql files found under ${rootDisplay}. ` +
        'Fix: check the directory path and the filter option, or pass onEmpty: "warn" | "ignore".',
    });
  }

  return { entries, diagnostics };
}

function buildTree(entries: readonly SqlEntry[]): SqlTree {
  const root: Record<string, unknown> = Object.create(null);
  for (const entry of entries) {
    const segments = entry.id.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const key = segments[i] ?? '';
      let next = node[key];
      if (next === undefined) {
        next = Object.create(null);
        node[key] = next;
      }
      node = next as Record<string, unknown>;
    }
    node[segments[segments.length - 1] ?? ''] = entry.text;
  }
  deepFreeze(root);
  return root as SqlTree;
}

function deepFreeze(node: Record<string, unknown>): void {
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) {
      deepFreeze(value as Record<string, unknown>);
    }
  }
  Object.freeze(node);
}

/**
 * Build the final catalog. Throws a `SqlLoaderError` for the first
 * error-severity diagnostic; emits process warnings for `onEmpty: 'warn'`.
 */
export function buildCatalog(
  scanned: ScanResult,
  options: ResolvedOptions,
  rootDisplay: string,
): CatalogResult {
  const { entries, diagnostics } = analyze(scanned, options, rootDisplay);
  const firstError = diagnostics.find((d) => d.severity === 'error');
  if (firstError !== undefined) {
    throw new SqlLoaderError(firstError.code as SqlLoaderErrorCode, firstError.message);
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'warning' && diagnostic.code === 'ERR_EMPTY_SQL') {
      process.emitWarning(diagnostic.message, {
        type: 'SqlLoaderWarning',
        code: 'SQL_LOADER_EMPTY',
      });
    }
  }
  const catalog = new Map(entries.map((entry) => [entry.id, entry]));
  return { tree: buildTree(entries), catalog, entries, hash: hashCatalog(entries) };
}
