/** Machine-readable error codes carried by {@link SqlLoaderError}. */
export type SqlLoaderErrorCode =
  | 'ERR_SOURCE_NOT_FOUND'
  | 'ERR_INVALID_SOURCE'
  | 'ERR_DUPLICATE_ID'
  | 'ERR_NAME_COLLISION'
  | 'ERR_EMPTY_SQL'
  | 'ERR_INVALID_NAME'
  | 'ERR_PRELUDE_CONTENT'
  | 'ERR_WATCH_UNAVAILABLE';

const ERROR_BRAND: unique symbol = Symbol.for('sql-loader.error') as never;

/**
 * Error thrown by all sql-loader APIs.
 *
 * Use the `code` property (not the message) to branch on failure kinds.
 * Prefer {@link SqlLoaderError.isSqlLoaderError} over `instanceof`: in a
 * dual-package (ESM + CJS) setup two class identities may exist and
 * `instanceof` can report `false` for a genuine sql-loader error.
 */
export class SqlLoaderError extends Error {
  readonly code: SqlLoaderErrorCode;

  constructor(code: SqlLoaderErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SqlLoaderError';
    this.code = code;
    Object.defineProperty(this, ERROR_BRAND, { value: true });
  }

  /** Brand-based check that survives dual-package (ESM/CJS) class duplication. */
  static isSqlLoaderError(value: unknown): value is SqlLoaderError {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<PropertyKey, unknown>)[ERROR_BRAND] === true
    );
  }
}
