import { SqlLoaderError } from './errors';

/** One query parsed from a `.sql` file. `name` is null for whole-file queries. */
export interface ParsedQuery {
  name: string | null;
  text: string;
}

// Line-based grammar, evaluated per line. Lowercase `name` only; `-- NAME:` is
// an ordinary comment. This is intentionally NOT a SQL lexer: a marker-shaped
// line inside a string literal or block comment is still treated as a marker
// (documented limitation — a dialect-aware lexer is out of scope).
const MARKER_RE = /^\s*--\s*name\s*:\s*(.*)$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && isBlank(lines[start] ?? '')) start++;
  while (end > start && isBlank(lines[end - 1] ?? '')) end--;
  return lines.slice(start, end);
}

function validateName(payload: string, relativePath: string, lineNumber: number): string {
  if (payload === '') {
    throw new SqlLoaderError(
      'ERR_INVALID_NAME',
      `Missing query name after "-- name:" in ${relativePath} (line ${lineNumber}). ` +
        'Fix: write "-- name: someIdentifier".',
    );
  }
  if (/\s/.test(payload)) {
    throw new SqlLoaderError(
      'ERR_INVALID_NAME',
      `Unexpected tokens after the query name in ${relativePath} (line ${lineNumber}): "${payload}". ` +
        'Only "-- name: <identifier>" is allowed on a marker line. Fix: remove the extra tokens.',
    );
  }
  if (!NAME_RE.test(payload)) {
    throw new SqlLoaderError(
      'ERR_INVALID_NAME',
      `Invalid query name "${payload}" in ${relativePath} (line ${lineNumber}). ` +
        'Names must match [A-Za-z_][A-Za-z0-9_]* (no dots, slashes, or dashes).',
    );
  }
  return payload;
}

// The prelude (content before the first marker) may contain only blank lines,
// `--` line comments, and non-nested `/* */` block comments. It is discarded.
function validatePrelude(preludeLines: string[], relativePath: string): void {
  const s = preludeLines.join('\n');
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (s.startsWith('--', i)) {
      const nl = s.indexOf('\n', i);
      i = nl === -1 ? s.length : nl + 1;
      continue;
    }
    if (s.startsWith('/*', i)) {
      const close = s.indexOf('*/', i + 2);
      if (close === -1) {
        throw new SqlLoaderError(
          'ERR_PRELUDE_CONTENT',
          `Unclosed block comment before the first "-- name:" marker in ${relativePath}. ` +
            'Fix: close the comment with */.',
        );
      }
      i = close + 2;
      continue;
    }
    throw new SqlLoaderError(
      'ERR_PRELUDE_CONTENT',
      `Unexpected content before the first "-- name:" marker in ${relativePath}. ` +
        'Only comments and blank lines may precede the first marker. ' +
        'Fix: move the SQL under a "-- name:" marker or remove it.',
    );
  }
}

/**
 * Parse one `.sql` file. A file with at least one `-- name:` marker yields one
 * query per marker; a file without markers yields a single whole-file query
 * with `name: null` and its text preserved verbatim.
 */
export function parseSqlFile(text: string, relativePath: string): ParsedQuery[] {
  const lines = text.split('\n');
  const markers: { line: number; payload: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = MARKER_RE.exec(lines[i] ?? '');
    if (match) markers.push({ line: i, payload: (match[1] ?? '').trim() });
  }

  const first = markers[0];
  if (first === undefined) return [{ name: null, text }];

  validatePrelude(lines.slice(0, first.line), relativePath);

  const queries: ParsedQuery[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    if (marker === undefined) continue;
    const name = validateName(marker.payload, relativePath, marker.line + 1);
    if (seen.has(name)) {
      throw new SqlLoaderError(
        'ERR_DUPLICATE_ID',
        `Duplicate query name "${name}" in ${relativePath} (line ${marker.line + 1}). ` +
          'Fix: rename one of the "-- name:" markers.',
      );
    }
    seen.add(name);
    const next = markers[i + 1];
    const end = next === undefined ? lines.length : next.line;
    const body = trimBlankEdges(lines.slice(marker.line + 1, end));
    if (body.length === 0) {
      throw new SqlLoaderError(
        'ERR_EMPTY_SQL',
        `Named query "${name}" in ${relativePath} (line ${marker.line + 1}) has no SQL body. ` +
          'Fix: add SQL under the marker or remove the marker.',
      );
    }
    queries.push({ name, text: body.join('\n') });
  }
  return queries;
}
