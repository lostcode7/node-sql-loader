import { SqlLoaderError } from './errors';
import type { SqlCardinality } from './types';

/**
 * Structural pg-compatible client. Deliberately NOT `import type { Pool }
 * from 'pg'` — that would leak pg's types into our shipped d.ts and break
 * consumers who don't have them installed. `Pool`, `Client`, and
 * `PoolClient` all satisfy this shape (verified by a compile test).
 */
export interface PgQueryable {
  query(input: {
    text: string;
    values?: readonly unknown[];
    name?: string;
  }): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/** A result row. Use `execute<MyRow>(...)` to assert a narrower shape. */
export type SqlRow = Record<string, unknown>;

/**
 * Statement shape accepted by the executor. Both generated `statements`
 * entries (text = compiled) and runtime `SqlEntry` objects (compiled text on
 * `compiledText`) satisfy it — the executor runs `compiledText ?? text`.
 */
export interface SqlExecutableStatement {
  id: string;
  text: string;
  compiledText?: string;
  parameters?: readonly string[];
  positionalCount?: number;
  cardinality?: SqlCardinality;
  hash?: string;
}

export interface PgExecutorOptions {
  /**
   * Use named prepared statements (name derived from the query hash, capped
   * to PostgreSQL's 63-byte identifier limit). Default: false — named
   * prepared statements break PgBouncer transaction pooling (< 1.21).
   */
  prepare?: boolean;
}

type CardinalityOf<S extends SqlExecutableStatement> = S extends {
  cardinality: infer C extends SqlCardinality;
}
  ? C
  : 'many';

/** Return type per declared cardinality; `'many'` (the default) → rows. */
export type ExecuteResult<S extends SqlExecutableStatement, Row extends SqlRow> =
  CardinalityOf<S> extends 'zero-or-one'
    ? Row | null
    : CardinalityOf<S> extends 'exactly-one'
      ? Row
      : CardinalityOf<S> extends 'none'
        ? number
        : Row[];

/** Argument list per parameter style: named → object, positional → array. */
export type ExecuteArgs<S extends SqlExecutableStatement> = S extends {
  parameters: readonly [string, ...string[]];
}
  ? [params: { [K in S['parameters'][number]]: unknown }]
  : S extends { parameters: readonly string[] }
    ? S['parameters'] extends readonly []
      ? S extends { positionalCount: number }
        ? [values: readonly unknown[]]
        : []
      : [params: Record<string, unknown>]
    : S extends { positionalCount: number }
      ? [values: readonly unknown[]]
      : [];

export interface PgExecutor {
  execute<Row extends SqlRow = SqlRow, S extends SqlExecutableStatement = SqlExecutableStatement>(
    statement: S,
    ...args: ExecuteArgs<S>
  ): Promise<ExecuteResult<S, Row>>;
}

function prepareName(statement: SqlExecutableStatement): string | undefined {
  const hash = statement.hash;
  if (hash === undefined || !hash.startsWith('sha256-')) return undefined;
  // 'sql_' + 56 hex chars = 60 chars, under NAMEDATALEN's 63-byte cap.
  return `sql_${hash.slice(7, 63)}`;
}

function bindValues(
  statement: SqlExecutableStatement,
  params: unknown,
): readonly unknown[] | undefined {
  const names = statement.parameters ?? [];
  if (names.length > 0) {
    if (params === undefined || params === null || Array.isArray(params)) {
      throw new TypeError(
        `Query "${statement.id}" uses named parameters — pass an object with: ${names.join(', ')}.`,
      );
    }
    const record = params as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!names.includes(key)) {
        throw new TypeError(
          `Unknown parameter "${key}" for query "${statement.id}". Expected: ${names.join(', ')}.`,
        );
      }
    }
    return names.map((name) => {
      if (!(name in record)) {
        throw new TypeError(
          `Missing parameter "${name}" for query "${statement.id}". Required: ${names.join(', ')}.`,
        );
      }
      return record[name];
    });
  }
  const positionalCount = statement.positionalCount ?? 0;
  if (positionalCount > 0) {
    if (!Array.isArray(params)) {
      throw new TypeError(
        `Query "${statement.id}" uses positional parameters — pass an array of ${positionalCount} value(s).`,
      );
    }
    if (params.length !== positionalCount) {
      throw new TypeError(
        `Query "${statement.id}" expects ${positionalCount} positional value(s), received ${params.length}.`,
      );
    }
    return params;
  }
  if (params !== undefined) {
    throw new TypeError(`Query "${statement.id}" takes no parameters.`);
  }
  return undefined;
}

function cardinalityError(
  statement: SqlExecutableStatement,
  expected: string,
  received: number,
): SqlLoaderError {
  return new SqlLoaderError(
    'ERR_CARDINALITY',
    `Query "${statement.id}" declared @returns ${expected} but received ${received} row(s). ` +
      'Fix: adjust the query, the data, or the @returns annotation.',
  );
}

/**
 * Thin executor over any pg-compatible client. Compiles nothing and connects
 * to nothing — it binds parameter objects to the compiled positional text and
 * enforces declared cardinalities.
 *
 * @example
 * import { createPgExecutor } from 'sql-loader/pg';
 * import { statements } from './sql.generated.js';
 * const db = createPgExecutor(pool);
 * const user = await db.execute(statements['users/findById'], { id });
 */
export function createPgExecutor(client: PgQueryable, options: PgExecutorOptions = {}): PgExecutor {
  const prepare = options.prepare ?? false;
  return {
    async execute(statement, ...args) {
      const values = bindValues(statement, (args as readonly unknown[])[0]);
      const input: { text: string; values?: readonly unknown[]; name?: string } = {
        text: statement.compiledText ?? statement.text,
      };
      if (values !== undefined) input.values = values;
      if (prepare) {
        const name = prepareName(statement);
        if (name !== undefined) input.name = name;
      }
      const result = await client.query(input);
      const rows = result.rows;
      const cardinality = statement.cardinality ?? 'many';
      switch (cardinality) {
        case 'zero-or-one':
          if (rows.length > 1) throw cardinalityError(statement, cardinality, rows.length);
          return (rows[0] ?? null) as never;
        case 'exactly-one':
          if (rows.length !== 1) throw cardinalityError(statement, cardinality, rows.length);
          return rows[0] as never;
        case 'none':
          return (result.rowCount ?? 0) as never;
        default:
          return rows as never;
      }
    },
  };
}
