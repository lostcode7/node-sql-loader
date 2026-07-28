import { lexPostgresParams } from './lex/postgres';
import type { SqlCardinality } from './types';

export type DialectDiagnosticCode =
  | 'ERR_PARAM_MIXED'
  | 'ERR_PARAM_GAP'
  | 'ERR_PARAM_SYNTAX'
  | 'ERR_ANNOTATION'
  | 'WARN_UNKNOWN_ANNOTATION';

export interface DialectDiagnostic {
  severity: 'error' | 'warning';
  code: DialectDiagnosticCode;
  message: string;
}

export interface CompiledQuery {
  /**
   * Text with named parameters rewritten to `$n` placeholders. Equals the
   * input text when the query has no named parameters. The original text is
   * never modified elsewhere — hashes are unaffected by compilation.
   */
  compiledText: string;
  /** Named parameter names in placeholder order (deduped by first occurrence). */
  parameters: string[];
  /** Highest `$n` index for positional-style queries (0 when named/none). */
  positionalCount: number;
  cardinality: SqlCardinality | null;
  diagnostics: DialectDiagnostic[];
}

const RETURNS_VALUES: ReadonlySet<string> = new Set(['zero-or-one', 'exactly-one', 'many', 'none']);

// Line-based like the `-- name:` grammar (and with the same documented
// limitation: an annotation-shaped line inside a dollar-quoted string is
// still treated as an annotation).
const ANNOTATION_RE = /^\s*--\s*@([A-Za-z][A-Za-z-]*)(?:\s+(.*))?$/;

function scanAnnotations(
  text: string,
  context: string,
  diagnostics: DialectDiagnostic[],
): SqlCardinality | null {
  let cardinality: SqlCardinality | null = null;
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    const match = ANNOTATION_RE.exec(line);
    if (match === null) continue;
    const key = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    if (key !== 'returns') {
      diagnostics.push({
        severity: 'warning',
        code: 'WARN_UNKNOWN_ANNOTATION',
        message:
          `Unknown annotation "@${key}" in ${context} (line ${index + 1}). ` +
          'Known annotations: @returns.',
      });
      continue;
    }
    if (!RETURNS_VALUES.has(value)) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_ANNOTATION',
        message:
          `Invalid @returns value "${value}" in ${context} (line ${index + 1}). ` +
          'Use one of: zero-or-one, exactly-one, many, none.',
      });
      continue;
    }
    if (cardinality !== null) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_ANNOTATION',
        message: `Duplicate @returns annotation in ${context} (line ${index + 1}).`,
      });
      continue;
    }
    cardinality = value as SqlCardinality;
  }
  return cardinality;
}

/**
 * Compile one query for the `postgres` dialect: extract `-- @returns`,
 * lex parameters, validate, and rewrite `:name` → `$n`. Never interpolates
 * values into the SQL string.
 */
export function compilePostgresQuery(text: string, context: string): CompiledQuery {
  const diagnostics: DialectDiagnostic[] = [];
  const cardinality = scanAnnotations(text, context, diagnostics);

  const lex = lexPostgresParams(text);
  for (const error of lex.errors) {
    diagnostics.push({
      severity: 'error',
      code: 'ERR_PARAM_SYNTAX',
      message: `${error.message} (${context}, query line ${error.line})`,
    });
  }

  const named = lex.params.filter((p) => p.kind === 'named');
  const positional = lex.params.filter((p) => p.kind === 'positional');

  if (named.length > 0 && positional.length > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'ERR_PARAM_MIXED',
      message:
        `${context} mixes named (:name) and positional ($n) parameters. ` +
        'Fix: use one style per query.',
    });
    return { compiledText: text, parameters: [], positionalCount: 0, cardinality, diagnostics };
  }

  if (positional.length > 0) {
    const seen = new Set(positional.map((p) => p.index));
    const max = Math.max(...seen);
    const missing: number[] = [];
    for (let n = 1; n <= max; n++) {
      if (!seen.has(n)) missing.push(n);
    }
    if (missing.length > 0) {
      diagnostics.push({
        severity: 'error',
        code: 'ERR_PARAM_GAP',
        message:
          `${context} uses $${max} but skips $${missing.join(', $')}. ` +
          'Fix: number positional parameters consecutively from $1.',
      });
    }
    return { compiledText: text, parameters: [], positionalCount: max, cardinality, diagnostics };
  }

  if (named.length === 0) {
    return { compiledText: text, parameters: [], positionalCount: 0, cardinality, diagnostics };
  }

  const order = new Map<string, number>();
  for (const param of named) {
    if (!order.has(param.name)) order.set(param.name, order.size + 1);
  }
  let compiledText = '';
  let cursor = 0;
  for (const param of named) {
    compiledText += text.slice(cursor, param.start);
    compiledText += `$${order.get(param.name)}`;
    cursor = param.end;
  }
  compiledText += text.slice(cursor);

  return {
    compiledText,
    parameters: [...order.keys()],
    positionalCount: 0,
    cardinality,
    diagnostics,
  };
}
