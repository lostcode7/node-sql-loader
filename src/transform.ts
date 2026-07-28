import { compileSqlModule } from './emit';

export interface SqlTransformResult {
  code: string;
  map: null;
}

// Vite asset queries whose semantics must be preserved: `?raw` (string of the
// raw file), `?url`, `?inline`. Transforming those would break Vite core.
function hasAssetQuery(query: string): boolean {
  return query.split('&').some((part) => {
    const key = part.split('=')[0];
    return key === 'raw' || key === 'url' || key === 'inline';
  });
}

/**
 * Shared Rollup-style transform: turns the content of a `.sql` module id into
 * ESM source. Returns null for ids the plugin must not touch (non-.sql, Vite
 * virtual modules, asset-query imports).
 */
export function transformSqlId(code: string, id: string): SqlTransformResult | null {
  if (id.startsWith('\0')) return null;
  const queryIndex = id.indexOf('?');
  const cleanId = queryIndex === -1 ? id : id.slice(0, queryIndex);
  if (!cleanId.endsWith('.sql')) return null;
  if (queryIndex !== -1 && hasAssetQuery(id.slice(queryIndex + 1))) return null;
  return { code: compileSqlModule(code, cleanId).code, map: null };
}
