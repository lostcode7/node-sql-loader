import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSql, loadSqlCatalog, loadSqlCatalogSync, SqlLoaderError } from '../../dist/index.js';

const fixture = (name) => new URL(`../fixtures/${name}/`, import.meta.url);

const GOOD_FIXTURES = ['basic', 'named', 'dots', 'filter-mix', 'sort', 'bom'];

const BAD_FIXTURES = [
  ['collisions', 'ERR_NAME_COLLISION'],
  ['prefix-collision', 'ERR_NAME_COLLISION'],
  ['duplicate-id', 'ERR_DUPLICATE_ID'],
  ['named-invalid-trailing', 'ERR_INVALID_NAME'],
  ['named-invalid-prelude', 'ERR_PRELUDE_CONTENT'],
  ['named-empty-block', 'ERR_EMPTY_SQL'],
  ['named-duplicate', 'ERR_DUPLICATE_ID'],
  ['empty', 'ERR_EMPTY_SQL'],
  ['whitespace', 'ERR_EMPTY_SQL'],
];

test('loadSql resolves to the same tree as loadSqlSync', async () => {
  const sql = await loadSql(fixture('basic'));
  assert.equal(sql.get.user.trim(), 'SELECT * FROM USER;');
});

test('sync/async parity: identical catalogs for every good fixture', async () => {
  for (const name of GOOD_FIXTURES) {
    const syncResult = loadSqlCatalogSync(fixture(name));
    const asyncResult = await loadSqlCatalog(fixture(name));
    assert.deepEqual(
      asyncResult.entries.map(({ id, text, hash }) => ({ id, text, hash })),
      syncResult.entries.map(({ id, text, hash }) => ({ id, text, hash })),
      `entries mismatch for fixture "${name}"`,
    );
    assert.equal(asyncResult.hash, syncResult.hash, `directory hash mismatch for "${name}"`);
    assert.deepEqual(
      JSON.parse(JSON.stringify(asyncResult.tree)),
      JSON.parse(JSON.stringify(syncResult.tree)),
      `tree mismatch for fixture "${name}"`,
    );
  }
});

test('sync/async parity: identical error codes for every bad fixture', async () => {
  for (const [name, code] of BAD_FIXTURES) {
    let syncCode = null;
    try {
      loadSqlCatalogSync(fixture(name));
    } catch (err) {
      assert.ok(SqlLoaderError.isSqlLoaderError(err));
      syncCode = err.code;
    }
    assert.equal(syncCode, code, `sync error code mismatch for "${name}"`);
    await assert.rejects(loadSqlCatalog(fixture(name)), (err) => {
      assert.ok(SqlLoaderError.isSqlLoaderError(err));
      assert.equal(err.code, code, `async error code mismatch for "${name}"`);
      return true;
    });
  }
});

test('async rejects with ERR_SOURCE_NOT_FOUND for a missing directory', async () => {
  await assert.rejects(loadSql(fixture('does-not-exist')), (err) => {
    assert.equal(err.code, 'ERR_SOURCE_NOT_FOUND');
    return true;
  });
});
