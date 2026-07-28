import fs from 'node:fs';
import { parseArgs, styleText } from 'node:util';
import type { Diagnostic } from '../index';
import { checkSqlSync, SqlLoaderError } from '../index';

const USAGE = 'Usage: sql-loader check <dir> [--generated <file>] [--json]';

type GeneratedStatus = 'fresh' | 'stale' | 'unparseable';

// Parses the `// sql-loader:generated v=1 hash=... files=...` header emitted by
// `generate`. Text-only — the generated file is never imported or executed.
function parseGeneratedHeader(text: string): { v: string; hash: string } | null {
  const lines = text.split(/\r?\n/, 20);
  for (const line of lines) {
    if (!/^\/\/ sql-loader:generated\b/.test(line)) continue;
    const fields: Record<string, string> = {};
    for (const token of line.slice('// sql-loader:generated'.length).trim().split(/\s+/)) {
      const eq = token.indexOf('=');
      if (eq > 0) fields[token.slice(0, eq)] = token.slice(eq + 1);
    }
    const v = fields.v;
    const hash = fields.hash;
    if (v !== undefined && hash !== undefined) return { v, hash };
    return null;
  }
  return null;
}

function color(format: Parameters<typeof styleText>[0], text: string): string {
  return process.stdout.isTTY ? styleText(format, text) : text;
}

function printHuman(
  root: string,
  hash: string,
  queryCount: number,
  diagnostics: Diagnostic[],
  generated: { path: string; status: GeneratedStatus } | null,
): void {
  console.log(`sql-loader check ${root}`);
  console.log(`  ${queryCount} queries, ${hash}`);
  for (const diagnostic of diagnostics) {
    const tag =
      diagnostic.severity === 'error' ? color('red', '[error]') : color('yellow', '[warn]');
    console.log(`  ${tag} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (generated !== null) {
    const label =
      generated.status === 'fresh'
        ? color('green', 'fresh')
        : color('red', generated.status.toUpperCase());
    console.log(`  generated: ${label} (${generated.path})`);
  }
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const stale = generated !== null && generated.status !== 'fresh';
  if (errors === 0 && !stale) {
    console.log(color('green', `✓ ok (${warnings} warning${warnings === 1 ? '' : 's'})`));
  } else {
    console.log(
      color('red', `✗ ${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning(s)`) +
        (stale ? color('red', ', generated file needs regeneration') : ''),
    );
  }
}

export function runCheck(argv: string[]): number {
  let dir: string;
  let generatedPath: string | undefined;
  let json: boolean;
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        generated: { type: 'string' },
        json: { type: 'boolean', default: false },
      },
      allowPositionals: true,
      strict: true,
    });
    const positional = parsed.positionals[0];
    if (positional === undefined || parsed.positionals.length !== 1) {
      throw new Error('expected exactly one <dir> argument');
    }
    dir = positional;
    generatedPath = parsed.values.generated;
    json = parsed.values.json ?? false;
  } catch (error) {
    console.error(`sql-loader check: ${error instanceof Error ? error.message : error}`);
    console.error(USAGE);
    return 2;
  }

  let result: ReturnType<typeof checkSqlSync>;
  try {
    result = checkSqlSync(dir);
  } catch (error) {
    if (SqlLoaderError.isSqlLoaderError(error)) {
      console.error(error.message);
      return 2;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }

  let generated: { path: string; status: GeneratedStatus } | null = null;
  if (generatedPath !== undefined) {
    let text: string;
    try {
      text = fs.readFileSync(generatedPath, 'utf8');
    } catch (error) {
      console.error(
        `sql-loader check: cannot read --generated file: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return 2;
    }
    const header = parseGeneratedHeader(text);
    if (header === null) {
      generated = { path: generatedPath, status: 'unparseable' };
    } else {
      generated = {
        path: generatedPath,
        status: header.hash === result.hash ? 'fresh' : 'stale',
      };
    }
  }

  const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
  const ok = errors === 0 && (generated === null || generated.status === 'fresh');

  if (json) {
    console.log(
      JSON.stringify(
        {
          root: dir,
          queries: result.entries.length,
          hash: result.hash,
          diagnostics: result.diagnostics,
          generated,
          ok,
        },
        null,
        2,
      ),
    );
  } else {
    printHuman(dir, result.hash, result.entries.length, result.diagnostics, generated);
  }
  return ok ? 0 : 1;
}
