'use strict';
// Shared interop assertions driven by both the ESM and CJS test entries.
// Receives the loaded library so each side exercises its own dist artifact.
const assert = require('node:assert/strict');
const path = require('node:path');

const BASIC = path.join(__dirname, '..', 'fixtures', 'basic');

async function runSharedAssertions(lib) {
  const { loadSql, loadSqlSync, loadSqlCatalogSync, checkSqlSync, SqlLoaderError, watchSql } = lib;

  assert.equal(typeof loadSql, 'function');
  assert.equal(typeof watchSql, 'function');

  const tree = loadSqlSync(BASIC);
  assert.equal(tree.get.user.trim(), 'SELECT * FROM USER;');
  assert.equal(Object.getPrototypeOf(tree), null);

  const asyncTree = await loadSql(BASIC);
  assert.equal(JSON.stringify(asyncTree), JSON.stringify(tree));

  const catalog = loadSqlCatalogSync(BASIC);
  assert.equal(catalog.entries.length, 5);
  assert.match(catalog.hash, /^sha256-/);

  const checked = checkSqlSync(BASIC);
  assert.deepEqual(checked.diagnostics, []);
  assert.equal(checked.hash, catalog.hash);

  try {
    loadSqlSync(path.join(BASIC, 'does-not-exist'));
    assert.fail('expected ERR_SOURCE_NOT_FOUND');
  } catch (error) {
    assert.ok(SqlLoaderError.isSqlLoaderError(error), `not a SqlLoaderError: ${error}`);
    assert.equal(error.code, 'ERR_SOURCE_NOT_FOUND');
  }
}

module.exports = { runSharedAssertions };
