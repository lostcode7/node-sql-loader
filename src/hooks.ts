import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileSqlModule } from './emit';

type NextLoad = (url: string, context?: unknown) => unknown;

/**
 * Node module-customization `load` hook. Turns `.sql` file URLs into ES
 * modules via {@link compileSqlModule}. Deliberately synchronous: that
 * satisfies `module.registerHooks` (which requires sync hooks) and is
 * equally valid for `module.register` (which merely allows async).
 *
 * No `resolve` hook is needed — Node resolves `.sql` specifiers fine; only
 * format detection in the default `load` rejects them.
 */
export function load(url: string, context: unknown, nextLoad: NextLoad): unknown {
  const clean = (url.split('?')[0] ?? url).split('#')[0] ?? url;
  if (clean.startsWith('file:') && clean.endsWith('.sql')) {
    const filePath = fileURLToPath(new URL(clean));
    const raw = fs.readFileSync(filePath, 'utf8');
    return {
      format: 'module',
      source: compileSqlModule(raw, filePath).code,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
}
