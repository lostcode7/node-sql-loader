import { SqlLoaderError } from './errors';
import { normalizeSqlText, parseSqlFile } from './parse';

export const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Emit an object-literal key. `__proto__` must be a computed key: in an object
 * literal even a quoted "__proto__" key triggers prototype-setter semantics.
 */
export function emitKey(key: string): string {
  if (key === '__proto__') return '["__proto__"]';
  return IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

export interface CompiledSqlModule {
  /** Self-contained ESM source for the file. */
  code: string;
}

/**
 * Compile ONE `.sql` file into an ES module — the shared engine behind the
 * bundler plugins and the Node ESM loader.
 *
 * - A file without `-- name:` markers becomes `export default "<sql>"`.
 * - A file with markers gets one named export per query plus a frozen
 *   object as the default export. Query names that are JS reserved words
 *   (`delete`, `return`, ...) are legal export names via alias exports;
 *   importers bind them with `import { delete as remove } from './x.sql'`.
 * - A query named exactly `default` would collide with the default export
 *   and is rejected.
 *
 * Input may be raw file bytes as a string: BOM stripping and CRLF
 * normalization are applied here so every entry point agrees with
 * `loadSql` semantics. Output is byte-deterministic.
 */
export function compileSqlModule(rawText: string, filePath: string): CompiledSqlModule {
  const { text } = normalizeSqlText(rawText);
  const queries = parseSqlFile(text, filePath);

  const first = queries[0];
  if (first !== undefined && first.name === null) {
    return { code: `export default ${JSON.stringify(first.text)};\n` };
  }

  const locals: string[] = [];
  const exportSpecifiers: string[] = [];
  const objectEntries: string[] = [];
  for (const [index, query] of queries.entries()) {
    if (query.name === null) continue;
    if (query.name === 'default') {
      throw new SqlLoaderError(
        'ERR_INVALID_NAME',
        `Query name "default" in ${filePath} conflicts with the module's default export. ` +
          'Fix: rename the query.',
      );
    }
    const local = `_q${index}`;
    locals.push(`const ${local} = ${JSON.stringify(query.text)};`);
    exportSpecifiers.push(`${local} as ${query.name}`);
    objectEntries.push(`  ${emitKey(query.name)}: ${local},`);
  }

  const code = [
    ...locals,
    `export { ${exportSpecifiers.join(', ')} };`,
    'export default Object.freeze({',
    ...objectEntries,
    '});',
    '',
  ].join('\n');
  return { code };
}
