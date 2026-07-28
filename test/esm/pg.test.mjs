import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSqlCatalogSync, SqlLoaderError } from '../../dist/index.js';
import { createPgExecutor } from '../../dist/pg.js';

const fixture = (name) => new URL(`../fixtures/${name}/`, import.meta.url);

function fakePool(response = { rows: [], rowCount: 0 }) {
  const calls = [];
  return {
    calls,
    client: {
      query: async (input) => {
        calls.push(input);
        return typeof response === 'function' ? response(input) : response;
      },
    },
  };
}

const FIND_BY_ID = {
  id: 'users/findById',
  text: 'SELECT * FROM users WHERE id = $1',
  parameters: ['id'],
  cardinality: 'zero-or-one',
  hash: `sha256-${'ab'.repeat(32)}`,
};

test('named params bind in placeholder order from an object', async () => {
  const pool = fakePool({ rows: [{ id: 7 }], rowCount: 1 });
  const db = createPgExecutor(pool.client);
  const statement = {
    id: 'q',
    text: 'SELECT $1, $2, $1',
    parameters: ['a', 'b'],
  };
  const rows = await db.execute(statement, { b: 2, a: 1 });
  assert.deepEqual(rows, [{ id: 7 }]);
  assert.deepEqual(pool.calls[0].values, [1, 2]);
  assert.equal(pool.calls[0].text, 'SELECT $1, $2, $1');
  assert.equal(pool.calls[0].name, undefined);
});

test('runtime SqlEntry works via compiledText', async () => {
  const catalog = loadSqlCatalogSync(fixture('pg'), { dialect: 'postgres' });
  const entry = catalog.catalog.get('users/findById');
  const pool = fakePool({ rows: [{ id: 1 }], rowCount: 1 });
  const db = createPgExecutor(pool.client);
  const row = await db.execute(entry, { id: 1 });
  assert.deepEqual(row, { id: 1 });
  assert.match(pool.calls[0].text, /WHERE id = \$1/);
  assert.ok(!pool.calls[0].text.includes(':id'), 'must send compiled text, not :name text');
});

test('cardinality zero-or-one: null on empty, error on many', async () => {
  const empty = fakePool({ rows: [], rowCount: 0 });
  assert.equal(await createPgExecutor(empty.client).execute(FIND_BY_ID, { id: 1 }), null);

  const many = fakePool({ rows: [{}, {}], rowCount: 2 });
  await assert.rejects(createPgExecutor(many.client).execute(FIND_BY_ID, { id: 1 }), (err) => {
    assert.ok(SqlLoaderError.isSqlLoaderError(err));
    assert.equal(err.code, 'ERR_CARDINALITY');
    assert.match(err.message, /users\/findById/);
    return true;
  });
});

test('cardinality exactly-one: row on 1, error on 0', async () => {
  const statement = { ...FIND_BY_ID, cardinality: 'exactly-one' };
  const one = fakePool({ rows: [{ id: 5 }], rowCount: 1 });
  assert.deepEqual(await createPgExecutor(one.client).execute(statement, { id: 5 }), { id: 5 });

  const zero = fakePool({ rows: [], rowCount: 0 });
  await assert.rejects(
    createPgExecutor(zero.client).execute(statement, { id: 5 }),
    (err) => err.code === 'ERR_CARDINALITY',
  );
});

test('cardinality none: affected count, tolerating null rowCount', async () => {
  const statement = {
    id: 'q',
    text: 'DELETE FROM t WHERE a = $1',
    parameters: ['a'],
    cardinality: 'none',
  };
  const three = fakePool({ rows: [], rowCount: 3 });
  assert.equal(await createPgExecutor(three.client).execute(statement, { a: 1 }), 3);

  const nullCount = fakePool({ rows: [], rowCount: null });
  assert.equal(await createPgExecutor(nullCount.client).execute(statement, { a: 1 }), 0);
});

test('default cardinality is many (rows array)', async () => {
  const pool = fakePool({ rows: [{ a: 1 }, { a: 2 }], rowCount: 2 });
  const rows = await createPgExecutor(pool.client).execute({ id: 'q', text: 'SELECT 1' });
  assert.equal(rows.length, 2);
});

test('parameter binding misuse throws TypeError with fix hints', async () => {
  const db = createPgExecutor(fakePool().client);
  await assert.rejects(db.execute(FIND_BY_ID), TypeError);
  await assert.rejects(db.execute(FIND_BY_ID, [1]), TypeError);
  await assert.rejects(db.execute(FIND_BY_ID, {}), (err) => {
    assert.ok(err instanceof TypeError);
    assert.match(err.message, /Missing parameter "id"/);
    return true;
  });
  await assert.rejects(db.execute(FIND_BY_ID, { id: 1, tyop: 2 }), (err) => {
    assert.match(err.message, /Unknown parameter "tyop"/);
    return true;
  });
});

test('positional statements take an exact-length array', async () => {
  const statement = { id: 'q', text: 'SELECT $1', positionalCount: 1 };
  const pool = fakePool({ rows: [], rowCount: 0 });
  const db = createPgExecutor(pool.client);
  await db.execute(statement, [42]);
  assert.deepEqual(pool.calls[0].values, [42]);
  await assert.rejects(db.execute(statement, [1, 2]), TypeError);
  await assert.rejects(db.execute(statement, { a: 1 }), TypeError);
});

test('no-parameter statements reject stray arguments', async () => {
  const db = createPgExecutor(fakePool().client);
  await assert.rejects(db.execute({ id: 'q', text: 'SELECT 1' }, { a: 1 }), TypeError);
});

test('prepare: true derives a <=63-char statement name from the hash', async () => {
  const pool = fakePool({ rows: [], rowCount: 0 });
  const db = createPgExecutor(pool.client, { prepare: true });
  await db.execute(FIND_BY_ID, { id: 1 });
  const name = pool.calls[0].name;
  assert.match(name, /^sql_[0-9a-f]{56}$/);
  assert.ok(name.length <= 63);

  // Without a hash, prepare is silently skipped.
  const noHash = fakePool({ rows: [], rowCount: 0 });
  await createPgExecutor(noHash.client, { prepare: true }).execute({ id: 'q', text: 'SELECT 1' });
  assert.equal(noHash.calls[0].name, undefined);
});
