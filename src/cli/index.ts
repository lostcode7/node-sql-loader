#!/usr/bin/env node
import { createRequire } from 'node:module';
import { runCheck } from './check';
import { runGenerate } from './generate';

const pkg = createRequire(import.meta.url)('../../package.json') as { version: string };

const HELP = `sql-loader v${pkg.version} — load and compile .sql files into a typed query catalog

Usage:
  sql-loader generate <dir> --out <file> [--format ts|js]
  sql-loader check <dir> [--generated <file>] [--json]

Commands:
  generate   Compile a SQL directory into a self-contained module
             (--format ts emits one .ts file; --format js emits .js + .d.ts)
  check      Validate a SQL directory; with --generated, verify the generated
             file is up to date via its content hash. --json emits machine-
             readable diagnostics.

Exit codes:
  0  ok
  1  validation findings or stale generated file
  2  usage or I/O error
`;

function main(): number {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'generate':
      return runGenerate(rest);
    case 'check':
      return runCheck(rest);
    case '--version':
    case '-v':
      console.log(pkg.version);
      return 0;
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    case undefined:
      console.error(HELP);
      return 2;
    default:
      console.error(`sql-loader: unknown command "${command}"`);
      console.error(HELP);
      return 2;
  }
}

process.exitCode = main();
