import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSqlCatalogSync, loadSqlSync, SqlLoaderError } from '../../dist/index.js';

const fixture = (name) => new URL(`../fixtures/${name}/`, import.meta.url);

const assertThrowsCode = (fn, code) => {
  assert.throws(fn, (err) => {
    assert.ok(SqlLoaderError.isSqlLoaderError(err), `expected SqlLoaderError, got: ${err}`);
    assert.equal(err.name, 'SqlLoaderError');
    assert.equal(err.code, code);
    return true;
  });
};

const plain = (tree) => JSON.parse(JSON.stringify(tree));

function nextWarning(filter, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.off('warning', onWarning);
      reject(new Error('expected a process warning, got none'));
    }, timeoutMs);
    function onWarning(warning) {
      if (!filter(warning)) return;
      clearTimeout(timer);
      process.off('warning', onWarning);
      resolve(warning);
    }
    process.on('warning', onWarning);
  });
}

test('loads a directory into a nested tree (URL source)', () => {
  const sql = loadSqlSync(fixture('basic'));
  assert.deepEqual(Object.keys(plain(sql)), ['get', 'insert', 'select', 'update']);
  assert.equal(sql.get.user.trim(), 'SELECT * FROM USER;');
  assert.equal(typeof sql.get.get_sub.user, 'string');
  assert.equal(typeof sql.select, 'string');
});

test('tree nodes are frozen and have a null prototype', () => {
  const sql = loadSqlSync(fixture('basic'));
  assert.equal(Object.getPrototypeOf(sql), null);
  assert.equal(Object.getPrototypeOf(sql.get), null);
  assert.ok(Object.isFrozen(sql));
  assert.ok(Object.isFrozen(sql.get));
  assert.throws(() => {
    sql.injected = 'x';
  }, TypeError);
});

test('accepts absolute and cwd-relative string sources', () => {
  const abs = fileURLToPath(fixture('basic'));
  assert.equal(loadSqlSync(abs).get.user.trim(), 'SELECT * FROM USER;');
  // npm test runs with cwd at the project root.
  assert.equal(loadSqlSync('test/fixtures/basic').get.user.trim(), 'SELECT * FROM USER;');
});

test('named queries: markers split a file into multiple queries', () => {
  const sql = loadSqlSync(fixture('named'));
  assert.equal(sql.queries.findById, 'SELECT * FROM users WHERE id = :id;');
  assert.equal(sql.queries.insertOne, 'INSERT INTO users (name)\nVALUES (:name);');
  assert.equal(sql['block-prelude'].countAll, 'SELECT COUNT(*) FROM users;');
});

test('catalog exposes entries, flat map, and hashes', () => {
  const result = loadSqlCatalogSync(fixture('basic'));
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ['get/get_sub/user', 'get/user', 'insert/user', 'select', 'update/user'],
  );
  const entry = result.catalog.get('get/user');
  assert.match(entry.hash, /^sha256-[0-9a-f]{64}$/);
  assert.match(result.hash, /^sha256-[0-9a-f]{64}$/);
  assert.ok(entry.filePath.endsWith('.sql'));
  assert.ok(!entry.id.includes('\\'), 'IDs must never contain backslashes');
});

test('traversal order is deterministic binary code-unit order', () => {
  const result = loadSqlCatalogSync(fixture('sort'));
  assert.deepEqual(
    result.entries.map((e) => e.id),
    ['B', '_x', 'a'],
  );
});

test('same content yields the same hash regardless of location', () => {
  const a = loadSqlCatalogSync(fixture('sort')).catalog.get('a');
  const b = loadSqlCatalogSync(fixture('filter-mix')).catalog.get('a');
  assert.equal(a.hash, b.hash);
});

test('only exact .sql extensions load; dots in basenames are preserved', () => {
  assert.deepEqual(Object.keys(plain(loadSqlSync(fixture('filter-mix')))), ['a']);
  const dots = loadSqlSync(fixture('dots'));
  assert.ok('report.monthly' in dots);
});

test('BOM is stripped from file content', () => {
  const sql = loadSqlSync(fixture('bom'));
  assert.ok(!sql.bom.startsWith('﻿'));
  assert.ok(sql.bom.startsWith("SELECT 'bom'"));
});

test('filter: RegExp tests the POSIX relative path', () => {
  const sql = loadSqlSync(fixture('basic'), { filter: /^get\// });
  assert.deepEqual(Object.keys(plain(sql)), ['get']);
});

test('filter: predicate receives relative and absolute paths', () => {
  const seen = [];
  loadSqlSync(fixture('basic'), {
    filter: ({ relativePath, absolutePath }) => {
      seen.push(relativePath);
      assert.ok(!relativePath.includes('\\'));
      assert.ok(absolutePath.endsWith('.sql'));
      return true;
    },
  });
  assert.ok(seen.includes('get/user.sql'));
});

test('onEmpty defaults to error for empty and whitespace-only files', () => {
  assertThrowsCode(() => loadSqlSync(fixture('empty')), 'ERR_EMPTY_SQL');
  assertThrowsCode(() => loadSqlSync(fixture('whitespace')), 'ERR_EMPTY_SQL');
});

test('onEmpty: ignore drops empty files silently', () => {
  const sql = loadSqlSync(fixture('empty'), { onEmpty: 'ignore' });
  assert.deepEqual(Object.keys(plain(sql)), []);
});

test('onEmpty: warn keeps the empty entry and emits a process warning', async () => {
  const warning = nextWarning((w) => w.name === 'SqlLoaderWarning');
  const result = loadSqlCatalogSync(fixture('empty'), { onEmpty: 'warn' });
  assert.equal(result.catalog.get('empty').text, '');
  const w = await warning;
  assert.equal(w.code, 'SQL_LOADER_EMPTY');
});

test('onEmpty applies to a root with no queries at all', async () => {
  assertThrowsCode(() => loadSqlSync(fixture('basic'), { filter: () => false }), 'ERR_EMPTY_SQL');
  const warning = nextWarning((w) => w.name === 'SqlLoaderWarning');
  const sql = loadSqlSync(fixture('basic'), { filter: () => false, onEmpty: 'warn' });
  assert.deepEqual(Object.keys(plain(sql)), []);
  await warning;
});

test('file vs directory collision is an error', () => {
  assertThrowsCode(() => loadSqlSync(fixture('collisions')), 'ERR_NAME_COLLISION');
  assertThrowsCode(() => loadSqlSync(fixture('prefix-collision')), 'ERR_NAME_COLLISION');
});

test('named file virtual namespace collides with a real file of the same ID', () => {
  assertThrowsCode(() => loadSqlSync(fixture('duplicate-id')), 'ERR_DUPLICATE_ID');
});

test('named query grammar violations carry specific codes', () => {
  assertThrowsCode(() => loadSqlSync(fixture('named-invalid-trailing')), 'ERR_INVALID_NAME');
  assertThrowsCode(() => loadSqlSync(fixture('named-invalid-prelude')), 'ERR_PRELUDE_CONTENT');
  assertThrowsCode(() => loadSqlSync(fixture('named-empty-block')), 'ERR_EMPTY_SQL');
  assertThrowsCode(() => loadSqlSync(fixture('named-duplicate')), 'ERR_DUPLICATE_ID');
});

test('missing directory: ERR_SOURCE_NOT_FOUND with a v1 migration hint', () => {
  assert.throws(
    () => loadSqlSync(fixture('does-not-exist')),
    (err) => {
      assert.equal(err.code, 'ERR_SOURCE_NOT_FOUND');
      assert.match(err.message, /process\.cwd\(\)/);
      assert.match(err.message, /import\.meta\.url/);
      return true;
    },
  );
});

test('invalid sources: empty string, non-file URL, file instead of directory', () => {
  assertThrowsCode(() => loadSqlSync(''), 'ERR_INVALID_SOURCE');
  assertThrowsCode(() => loadSqlSync(new URL('https://example.com/sql/')), 'ERR_INVALID_SOURCE');
  assertThrowsCode(
    () => loadSqlSync(new URL('../fixtures/basic/select.sql', import.meta.url)),
    'ERR_INVALID_SOURCE',
  );
});

test('isSqlLoaderError rejects foreign errors', () => {
  assert.equal(SqlLoaderError.isSqlLoaderError(new Error('nope')), false);
  assert.equal(SqlLoaderError.isSqlLoaderError(null), false);
  assert.equal(SqlLoaderError.isSqlLoaderError(undefined), false);
});
