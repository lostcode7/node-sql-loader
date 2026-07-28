export type { Diagnostic, DiagnosticCode } from './build';
export {
  type CompiledQuery,
  compilePostgresQuery,
  type DialectDiagnostic,
  type DialectDiagnosticCode,
} from './dialect';
export { type CompiledSqlModule, compileSqlModule } from './emit';
export { SqlLoaderError, type SqlLoaderErrorCode } from './errors';
export {
  lexPostgresParams,
  type NamedParamOccurrence,
  type ParamOccurrence,
  type PositionalParamOccurrence,
  type PostgresLexError,
  type PostgresLexResult,
} from './lex/postgres';
export {
  type CheckResult,
  checkSql,
  checkSqlSync,
  loadSql,
  loadSqlCatalog,
  loadSqlCatalogSync,
  loadSqlSync,
} from './load';
export type {
  CatalogResult,
  FilterInput,
  LoadOptions,
  OnEmpty,
  SqlCardinality,
  SqlDialect,
  SqlEntry,
  SqlTree,
} from './types';
export { type SqlChangeEvent, type SqlWatcher, type WatchOptions, watchSql } from './watch';
