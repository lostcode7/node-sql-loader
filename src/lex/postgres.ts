/**
 * PostgreSQL-aware parameter lexer. NOT a SQL parser: it understands exactly
 * enough of the lexical structure (comments, strings, dollar quoting,
 * identifiers, casts) to find `:name` and `$1` parameters reliably.
 *
 * Input is assumed BOM-stripped and LF-normalized (the loader guarantees it).
 *
 * Known, documented limitations:
 * - `a[x:y]` array slices: `:y` lexes as a named parameter. Use positional
 *   parameters (or no named params) in slice-heavy queries.
 * - psql client-side interpolation (`:'var'`, `:"var"`) is rejected with an
 *   error — it is a psql feature, not server SQL.
 */

export interface NamedParamOccurrence {
  kind: 'named';
  name: string;
  start: number;
  end: number;
}

export interface PositionalParamOccurrence {
  kind: 'positional';
  index: number;
  start: number;
  end: number;
}

export type ParamOccurrence = NamedParamOccurrence | PositionalParamOccurrence;

export interface PostgresLexError {
  message: string;
  /** 0-based character offset into the text. */
  position: number;
  /** 1-based line number. */
  line: number;
}

export interface PostgresLexResult {
  /** Parameter occurrences in source order (duplicates preserved). */
  params: ParamOccurrence[];
  errors: PostgresLexError[];
}

const NAMED_PARAM_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

// PostgreSQL identifiers may contain letters (incl. non-ASCII), digits, `_`
// and `$`. Treating every char > 0x7f as an identifier char is deliberately
// conservative: it prevents misreading `café$1` as a parameter.
function isIdentStart(code: number): boolean {
  return (
    (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f || code > 0x7f
  );
}

function isIdentPart(code: number): boolean {
  return isIdentStart(code) || (code >= 0x30 && code <= 0x39) || code === 0x24;
}

function isDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

// Dollar-quote tag continuation chars (a leading digit never reaches this
// branch — `$` + digit is handled as a positional parameter first).
function isTagChar(code: number): boolean {
  return isIdentStart(code) || (code >= 0x30 && code <= 0x39);
}

function lineOf(text: string, position: number): number {
  let line = 1;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text.charCodeAt(i) === 0x0a) line++;
  }
  return line;
}

/** Lex `text` and report every `:name` / `$n` parameter occurrence. */
export function lexPostgresParams(text: string): PostgresLexResult {
  const params: ParamOccurrence[] = [];
  const errors: PostgresLexError[] = [];
  const fail = (message: string, position: number): void => {
    errors.push({ message, position, line: lineOf(text, position) });
  };

  const length = text.length;
  let i = 0;
  while (i < length) {
    const code = text.charCodeAt(i);

    // -- line comment
    if (code === 0x2d && text.charCodeAt(i + 1) === 0x2d) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? length : nl + 1;
      continue;
    }

    // /* block comment */ — nests in PostgreSQL
    if (code === 0x2f && text.charCodeAt(i + 1) === 0x2a) {
      const start = i;
      let depth = 1;
      i += 2;
      while (i < length && depth > 0) {
        if (text.charCodeAt(i) === 0x2f && text.charCodeAt(i + 1) === 0x2a) {
          depth++;
          i += 2;
        } else if (text.charCodeAt(i) === 0x2a && text.charCodeAt(i + 1) === 0x2f) {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) {
        fail('Unterminated block comment.', start);
        break;
      }
      continue;
    }

    // 'standard string' with '' doubling
    if (code === 0x27) {
      const end = scanQuoted(text, i, 0x27);
      if (end === -1) {
        fail('Unterminated string literal.', i);
        break;
      }
      i = end;
      continue;
    }

    // "quoted identifier" with "" doubling
    if (code === 0x22) {
      const end = scanQuoted(text, i, 0x22);
      if (end === -1) {
        fail('Unterminated quoted identifier.', i);
        break;
      }
      i = end;
      continue;
    }

    // Identifiers — consumed as a whole run so `abc$1` is never a parameter.
    // Prefix-quoted strings (E'', e'', U&'', B'', X'') are detected here.
    if (isIdentStart(code)) {
      const start = i;
      while (i < length && isIdentPart(text.charCodeAt(i))) i++;
      const word = text.slice(start, i);
      const next = text.charCodeAt(i);
      if (next === 0x27 && (word === 'e' || word === 'E')) {
        const end = scanEscapeString(text, i);
        if (end === -1) {
          fail('Unterminated E-string literal.', i);
          break;
        }
        i = end;
      } else if (next === 0x27 && (word === 'b' || word === 'B' || word === 'x' || word === 'X')) {
        const end = scanQuoted(text, i, 0x27);
        if (end === -1) {
          fail('Unterminated string literal.', i);
          break;
        }
        i = end;
      } else if (
        (word === 'u' || word === 'U') &&
        next === 0x26 &&
        text.charCodeAt(i + 1) === 0x27
      ) {
        // U&'...' — quote escaping is still '' doubling.
        const end = scanQuoted(text, i + 1, 0x27);
        if (end === -1) {
          fail('Unterminated U& string literal.', i + 1);
          break;
        }
        i = end;
      }
      continue;
    }

    // $ — positional parameter or dollar quoting (identifier runs consumed above).
    if (code === 0x24) {
      const next = text.charCodeAt(i + 1);
      if (isDigit(next)) {
        const start = i;
        let j = i + 1;
        while (j < length && isDigit(text.charCodeAt(j))) j++;
        const index = Number.parseInt(text.slice(i + 1, j), 10);
        if (index === 0) {
          fail('Positional parameters start at $1 — $0 is invalid.', start);
        } else {
          params.push({ kind: 'positional', index, start, end: j });
        }
        i = j;
        continue;
      }
      // $tag$ ... $tag$ (tag may be empty)
      let j = i + 1;
      while (j < length && isTagChar(text.charCodeAt(j))) j++;
      if (text.charCodeAt(j) === 0x24) {
        const delimiter = text.slice(i, j + 1);
        const close = text.indexOf(delimiter, j + 1);
        if (close === -1) {
          fail(`Unterminated dollar-quoted string (${delimiter}...${delimiter}).`, i);
          break;
        }
        i = close + delimiter.length;
        continue;
      }
      i++;
      continue;
    }

    // : — cast, assignment, psql interpolation, or named parameter
    if (code === 0x3a) {
      const next = text.charCodeAt(i + 1);
      if (next === 0x3a) {
        i += 2; // :: cast
        continue;
      }
      if (next === 0x3d) {
        i += 2; // := (named notation / PL/pgSQL)
        continue;
      }
      if (next === 0x27 || next === 0x22) {
        fail(
          'psql client-side variable interpolation (:\'var\' / :"var") is not supported — ' +
            'it is a psql feature, not server SQL. Fix: pass the value as a parameter.',
          i,
        );
        i += 1; // skip only the colon so the quoted region is consumed normally
        continue;
      }
      const match = NAMED_PARAM_RE.exec(text.slice(i + 1));
      if (match !== null) {
        params.push({ kind: 'named', name: match[0], start: i, end: i + 1 + match[0].length });
        i += 1 + match[0].length;
        continue;
      }
      i++;
      continue;
    }

    i++;
  }

  return { params, errors };
}

/** Scan a quote-delimited region starting at `start`; returns end offset or -1. */
function scanQuoted(text: string, start: number, quote: number): number {
  let i = start + 1;
  while (i < text.length) {
    if (text.charCodeAt(i) === quote) {
      if (text.charCodeAt(i + 1) === quote) {
        i += 2; // doubled quote escape
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return -1;
}

/** Scan an E'...' string: both backslash escapes and '' doubling apply. */
function scanEscapeString(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 0x5c) {
      i += 2; // backslash escape consumes the next char
      continue;
    }
    if (code === 0x27) {
      if (text.charCodeAt(i + 1) === 0x27) {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return -1;
}
