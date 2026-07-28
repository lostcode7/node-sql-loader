import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const TSC = fileURLToPath(new URL('../../node_modules/typescript/lib/tsc.js', import.meta.url));

const fixture = (name) => path.join(FIXTURES, name);
const run = (args, options = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...options });

let tmpDir;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-dialect-gen-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('generate --dialect postgres emits statements and a dialect header field', () => {
  const out = path.join(tmpDir, 'pg.ts');
  const result = run(['generate', fixture('pg'), '--dialect', 'postgres', '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const text = fs.readFileSync(out, 'utf8');
  assert.match(
    text,
    /^\/\/ sql-loader:generated v=1 hash=sha256-[0-9a-f]{64} files=3 dialect=postgres$/m,
  );
  assert.match(text, /export const statements = \{/);
  assert.match(text, /export type SqlParamsOf/);
  // entries/queries keep the ORIGINAL :name text; statements carry compiled $n.
  assert.match(text, /WHERE id = :id/);
  assert.match(text, /WHERE id = \$1/);
});

test('generated dialect module + params consumer pass tsc --strict', () => {
  const out = path.join(tmpDir, 'typed', 'pg.ts');
  assert.equal(run(['generate', fixture('pg'), '--dialect', 'postgres', '--out', out]).status, 0);
  const consumer = path.join(tmpDir, 'typed', 'consumer.ts');
  fs.writeFileSync(
    consumer,
    [
      "import { statements, type SqlParamsOf } from './pg';",
      '',
      "const ok: SqlParamsOf<'users/findById'> = { id: 1 };",
      '',
      '// @ts-expect-error missing required parameter "org"',
      "const missing: SqlParamsOf<'users/listByStatus'> = { status: 'ACTIVE' };",
      '',
      '// @ts-expect-error unknown parameter',
      "const excess: SqlParamsOf<'users/findById'> = { id: 1, nope: 2 };",
      '',
      "const cardinality: 'zero-or-one' = statements['users/findById'].cardinality;",
      '',
      'export { ok, missing, excess, cardinality };',
    ].join('\n'),
  );
  const result = spawnSync(
    process.execPath,
    [
      TSC,
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'es2022',
      '--module',
      'esnext',
      '--moduleResolution',
      'bundler',
      out,
      consumer,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `tsc failed:\n${result.stdout}${result.stderr}`);
});

test('generate --format js --dialect: statements work at runtime', async () => {
  const out = path.join(tmpDir, 'pg.js');
  const result = run([
    'generate',
    fixture('pg'),
    '--dialect',
    'postgres',
    '--format',
    'js',
    '--out',
    out,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const mod = await import(pathToFileURL(out));
  const stmt = mod.statements['users/findById'];
  assert.match(stmt.text, /WHERE id = \$1/);
  assert.deepEqual(stmt.parameters, ['id']);
  assert.equal(stmt.cardinality, 'zero-or-one');
  assert.match(stmt.hash, /^sha256-/);
  // Original texts unchanged in queries/entries.
  assert.match(mod.getSql('users/findById'), /:id/);
  const dts = fs.readFileSync(path.join(tmpDir, 'pg.d.ts'), 'utf8');
  assert.match(dts, /readonly parameters: readonly \["id"\]/);
});

test('without --dialect the output shape is unchanged (no statements, no field)', () => {
  const out = path.join(tmpDir, 'plain.ts');
  assert.equal(run(['generate', fixture('pg'), '--out', out]).status, 0);
  const text = fs.readFileSync(out, 'utf8');
  assert.doesNotMatch(text, /statements/);
  assert.doesNotMatch(text, /dialect=/);
  assert.match(text, /^\/\/ sql-loader:generated v=1 hash=sha256-[0-9a-f]{64} files=3$/m);
});

test('check --generated: dialect mismatch is reported as stale despite equal hashes', () => {
  const out = path.join(tmpDir, 'stale-dialect.ts');
  assert.equal(run(['generate', fixture('pg'), '--dialect', 'postgres', '--out', out]).status, 0);

  const fresh = run([
    'check',
    fixture('pg'),
    '--dialect',
    'postgres',
    '--generated',
    out,
    '--json',
  ]);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(JSON.parse(fresh.stdout).generated.status, 'fresh');

  // Same directory, same hash — but the file was generated in dialect mode
  // and this check is not: regeneration required.
  const mismatch = run(['check', fixture('pg'), '--generated', out, '--json']);
  assert.equal(mismatch.status, 1);
  assert.equal(JSON.parse(mismatch.stdout).generated.status, 'stale');
});

test('generate/check reject unknown dialects', () => {
  assert.equal(
    run(['generate', fixture('pg'), '--dialect', 'mysql', '--out', path.join(tmpDir, 'x.ts')])
      .status,
    2,
  );
  assert.equal(run(['check', fixture('pg'), '--dialect', 'mysql']).status, 2);
});
