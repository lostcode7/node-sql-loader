import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Windows: --import rejects absolute paths — must be a URL.
const REGISTER_URL = pathToFileURL(
  fileURLToPath(new URL('../../dist/register.js', import.meta.url)),
).href;
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

const fixtureUrl = (rel) => pathToFileURL(path.join(FIXTURES, rel)).href;

let tmpDir;
let counter = 0;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-register-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runWithRegister(source, ext = '.mjs') {
  const entry = path.join(tmpDir, `entry${counter++}${ext}`);
  fs.writeFileSync(entry, source);
  return spawnSync(process.execPath, ['--import', REGISTER_URL, entry], { encoding: 'utf8' });
}

test('--import register: plain .sql resolves to a default string export', () => {
  const result = runWithRegister(
    [
      `import query from ${JSON.stringify(fixtureUrl('basic/select.sql'))};`,
      "if (typeof query !== 'string' || !query.includes('SELECT')) throw new Error('bad default');",
      "console.log('plain-ok');",
    ].join('\n'),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /plain-ok/);
});

test('--import register: named .sql exposes named exports and frozen default', () => {
  const result = runWithRegister(
    [
      `import all, { findById, insertOne } from ${JSON.stringify(fixtureUrl('named/queries.sql'))};`,
      "if (findById !== 'SELECT * FROM users WHERE id = :id;') throw new Error('bad findById');",
      "if (!insertOne.includes('INSERT INTO users')) throw new Error('bad insertOne');",
      "if (!Object.isFrozen(all) || all.findById !== findById) throw new Error('bad default');",
      "console.log('named-ok');",
    ].join('\n'),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /named-ok/);
});

test('--import register: dynamic import() also goes through the hook', () => {
  const result = runWithRegister(
    [
      `const mod = await import(${JSON.stringify(fixtureUrl('dots/report.monthly.sql'))});`,
      "if (!mod.default.includes('monthly')) throw new Error('bad dynamic import');",
      "console.log('dynamic-ok');",
    ].join('\n'),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dynamic-ok/);
});

test('--import register: grammar errors fail loudly with the file path', () => {
  const broken = path.join(tmpDir, 'broken.sql');
  fs.writeFileSync(broken, '-- name: bad name\nSELECT 1;\n');
  const result = runWithRegister(`import ${JSON.stringify(pathToFileURL(broken).href)};`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /broken\.sql/);
});

test('--import register: CJS require of .sql is documented as unsupported', () => {
  // module.register hooks only customize the ESM pipeline; require() of .sql
  // must fail (routing it through hooks crashes Node's require(esm) translator
  // on current 22.x, so we deliberately do not attempt it).
  const target = path.join(tmpDir, 'req.sql');
  fs.writeFileSync(target, "SELECT 'via require';\n");
  const result = runWithRegister(`require(${JSON.stringify(target)});`, '.cjs');
  assert.notEqual(result.status, 0);
});
