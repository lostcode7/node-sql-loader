import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { checkSqlSync, loadSqlCatalogSync } from '../../dist/index.js';

const fixture = (name) => new URL(`../fixtures/${name}/`, import.meta.url);

let tmpDir;
let counter = 0;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-dialect-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function tempSqlDir(files) {
  const dir = path.join(tmpDir, `case${counter++}`);
  fs.mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

test('dialect: named params compile to $n; original text and hashes unchanged', () => {
  const plain = loadSqlCatalogSync(fixture('pg'));
  const dialect = loadSqlCatalogSync(fixture('pg'), { dialect: 'postgres' });

  // The invariant that protects `check --generated`: hashes never move.
  assert.equal(dialect.hash, plain.hash);

  // Annotation lines stay in the body (they are valid SQL comments and part
  // of the hashed text); compilation only rewrites the parameters.
  const findById = dialect.catalog.get('users/findById');
  assert.equal(
    findById.compiledText,
    '-- @returns zero-or-one\nSELECT * FROM users WHERE id = $1;',
  );
  assert.deepEqual(findById.parameters, ['id']);
  assert.equal(findById.cardinality, 'zero-or-one');
  assert.ok(findById.text.includes(':id'), 'original text must keep :name style');
  assert.equal(findById.hash, plain.catalog.get('users/findById').hash);
  assert.equal(findById.line, 1);

  // Repeated :status reuses $1; order is first-occurrence.
  const list = dialect.catalog.get('users/listByStatus');
  assert.deepEqual(list.parameters, ['status', 'org']);
  assert.equal(
    list.compiledText,
    '-- @returns many\nSELECT * FROM users WHERE status = $1 AND org = $2 AND status <> $1;',
  );
  assert.equal(list.cardinality, 'many');
  assert.equal(list.line, 5);
});

test('dialect: positional queries record positionalCount, no compiledText', () => {
  const dialect = loadSqlCatalogSync(fixture('pg'), { dialect: 'postgres' });
  const count = dialect.catalog.get('count');
  assert.equal(count.positionalCount, 1);
  assert.equal(count.parameters, undefined);
  assert.equal(count.compiledText, undefined);
});

test('without dialect, no compiled fields appear', () => {
  const plain = loadSqlCatalogSync(fixture('pg'));
  const entry = plain.catalog.get('users/findById');
  assert.equal(entry.parameters, undefined);
  assert.equal(entry.compiledText, undefined);
  assert.equal(entry.cardinality, undefined);
});

test('dialect diagnostics: mixed, gap, syntax, annotation errors', () => {
  const dir = tempSqlDir({
    'mixed.sql': 'SELECT :a, $1;\n',
    'gap.sql': 'SELECT $1, $3;\n',
    'zero.sql': 'SELECT $0;\n',
    'badreturns.sql': '-- name: q\n-- @returns sometimes\nSELECT 1;\n',
    'dupreturns.sql': '-- name: q\n-- @returns many\n-- @returns none\nSELECT 1;\n',
  });
  const { diagnostics } = checkSqlSync(dir, { dialect: 'postgres' });
  const codesFor = (file) =>
    diagnostics.filter((d) => d.file === file && d.severity === 'error').map((d) => d.code);
  assert.deepEqual(codesFor('mixed.sql'), ['ERR_PARAM_MIXED']);
  assert.deepEqual(codesFor('gap.sql'), ['ERR_PARAM_GAP']);
  assert.deepEqual(codesFor('zero.sql'), ['ERR_PARAM_SYNTAX']);
  assert.deepEqual(codesFor('badreturns.sql'), ['ERR_ANNOTATION']);
  assert.deepEqual(codesFor('dupreturns.sql'), ['ERR_ANNOTATION']);
  const gapMessage = diagnostics.find((d) => d.code === 'ERR_PARAM_GAP').message;
  assert.match(gapMessage, /\$2/);
});

test('dialect diagnostics: unknown annotation is a warning, load still succeeds', () => {
  const dir = tempSqlDir({
    'q.sql': '-- name: q\n-- @cached forever\nSELECT :id;\n',
  });
  const { diagnostics } = checkSqlSync(dir, { dialect: 'postgres' });
  assert.deepEqual(
    diagnostics.map((d) => [d.code, d.severity, d.line]),
    [['WARN_UNKNOWN_ANNOTATION', 'warning', 1]],
  );
  const catalog = loadSqlCatalogSync(dir, { dialect: 'postgres' });
  assert.deepEqual(catalog.catalog.get('q/q').parameters, ['id']);
});

test('dialect errors are thrown by loading APIs with their code', () => {
  const dir = tempSqlDir({ 'mixed.sql': 'SELECT :a, $1;\n' });
  assert.throws(
    () => loadSqlCatalogSync(dir, { dialect: 'postgres' }),
    (err) => err.code === 'ERR_PARAM_MIXED',
  );
});

test('annotations without dialect mode are inert comments', () => {
  const dir = tempSqlDir({
    'q.sql': '-- name: q\n-- @returns sometimes\nSELECT 1;\n',
  });
  const { diagnostics } = checkSqlSync(dir);
  assert.deepEqual(diagnostics, []);
});
