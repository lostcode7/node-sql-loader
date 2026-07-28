import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { compileSqlModule, SqlLoaderError } from '../../dist/index.js';

let tmpDir;
let moduleCounter = 0;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-emit-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function importCompiled(code) {
  const file = path.join(tmpDir, `mod${moduleCounter++}.mjs`);
  fs.writeFileSync(file, code);
  return import(pathToFileURL(file));
}

test('plain file compiles to a single default string export', async () => {
  const { code } = compileSqlModule('SELECT 1;\n', 'x.sql');
  const mod = await importCompiled(code);
  assert.equal(mod.default, 'SELECT 1;\n');
  assert.deepEqual(Object.keys(mod).sort(), ['default']);
});

test('CRLF and BOM are normalized before compilation', async () => {
  const { code } = compileSqlModule('﻿SELECT 1;\r\nSELECT 2;\r\n', 'x.sql');
  const mod = await importCompiled(code);
  assert.equal(mod.default, 'SELECT 1;\nSELECT 2;\n');
});

test('named file compiles to named exports plus a frozen default object', async () => {
  const source = [
    '-- name: findById',
    'SELECT * FROM users WHERE id = :id;',
    '',
    '-- name: insertOne',
    'INSERT INTO users (name) VALUES (:name);',
    '',
  ].join('\n');
  const { code } = compileSqlModule(source, 'users.sql');
  const mod = await importCompiled(code);
  assert.equal(mod.findById, 'SELECT * FROM users WHERE id = :id;');
  assert.equal(mod.insertOne, 'INSERT INTO users (name) VALUES (:name);');
  assert.equal(mod.default.findById, mod.findById);
  assert.ok(Object.isFrozen(mod.default));
});

test('reserved words are legal query names via alias exports', async () => {
  const source = ['-- name: delete', 'DELETE FROM users WHERE id = :id;'].join('\n');
  const { code } = compileSqlModule(source, 'users.sql');
  assert.match(code, /export \{ _q0 as delete \};/);
  const file = path.join(tmpDir, `reserved${moduleCounter++}.mjs`);
  fs.writeFileSync(file, code);
  // `import { delete }` is illegal — importers must alias; verify that works.
  const consumer = path.join(tmpDir, `consumer${moduleCounter++}.mjs`);
  fs.writeFileSync(
    consumer,
    `import { delete as removeUser } from ${JSON.stringify(pathToFileURL(file).href)};\n` +
      'export { removeUser };\n',
  );
  const mod = await import(pathToFileURL(consumer));
  assert.equal(mod.removeUser, 'DELETE FROM users WHERE id = :id;');
});

test('__proto__ works as a query name and lands as an own property', async () => {
  const source = ['-- name: __proto__', "SELECT 'proto';"].join('\n');
  const { code } = compileSqlModule(source, 'weird.sql');
  const mod = await importCompiled(code);
  assert.ok(Object.hasOwn(mod.default, '__proto__'));
  assert.equal(Object.getOwnPropertyDescriptor(mod.default, '__proto__').value, "SELECT 'proto';");
});

test('a query named "default" is rejected', () => {
  const source = ['-- name: default', 'SELECT 1;'].join('\n');
  assert.throws(
    () => compileSqlModule(source, 'bad.sql'),
    (err) => {
      assert.ok(SqlLoaderError.isSqlLoaderError(err));
      assert.equal(err.code, 'ERR_INVALID_NAME');
      assert.match(err.message, /default export/);
      return true;
    },
  );
});

test('parse errors propagate with file context', () => {
  assert.throws(
    () => compileSqlModule('-- name: bad name\nSELECT 1;', 'queries/broken.sql'),
    (err) => {
      assert.equal(err.code, 'ERR_INVALID_NAME');
      assert.match(err.message, /queries\/broken\.sql/);
      return true;
    },
  );
});

test('compilation is byte-deterministic', () => {
  const source = ['-- name: a', 'SELECT 1;', '-- name: b', 'SELECT 2;'].join('\n');
  assert.equal(compileSqlModule(source, 'x.sql').code, compileSqlModule(source, 'x.sql').code);
});
