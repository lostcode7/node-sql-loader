import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { watchSql } from '../../dist/index.js';

function makeSqlDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-watch-'));
  fs.writeFileSync(path.join(dir, 'a.sql'), 'SELECT 1;\n');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'b.sql'), 'SELECT 2;\n');
  return dir;
}

function collect(watcher) {
  const state = { changes: [], errors: [], ready: null };
  watcher.on('ready', (snapshot) => {
    state.ready = snapshot;
  });
  watcher.on('change', (event) => state.changes.push(event));
  watcher.on('error', (error) => state.errors.push(error));
  return state;
}

async function until(predicate, what, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for: ${what}`);
}

test('ready fires with the initial snapshot', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir);
  const state = collect(watcher);
  try {
    await until(() => state.ready !== null, 'ready event');
    assert.deepEqual(
      state.ready.entries.map((e) => e.id),
      ['a', 'sub/b'],
    );
    assert.equal(watcher.snapshot, state.ready);
    assert.deepEqual(state.errors, []);
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('create, modify, and delete each produce a correct diff', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir);
  const state = collect(watcher);
  try {
    await until(() => state.ready !== null, 'ready event');

    fs.writeFileSync(path.join(dir, 'c.sql'), 'SELECT 3;\n');
    await until(() => state.changes.some((e) => e.added.includes('c')), 'change event adding "c"');
    const addEvent = state.changes.find((e) => e.added.includes('c'));
    assert.ok(addEvent.snapshot.catalog.has('c'));

    fs.writeFileSync(path.join(dir, 'a.sql'), 'SELECT 100;\n');
    await until(
      () => state.changes.some((e) => e.changed.includes('a')),
      'change event modifying "a"',
    );

    fs.rmSync(path.join(dir, 'sub', 'b.sql'));
    await until(
      () => state.changes.some((e) => e.removed.includes('sub/b')),
      'change event removing "sub/b"',
    );
    assert.deepEqual(state.errors, []);
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a burst of writes settles into a correct final snapshot', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir);
  const state = collect(watcher);
  try {
    await until(() => state.ready !== null, 'ready event');
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dir, `burst${i}.sql`), `SELECT ${i};\n`);
    }
    await until(() => {
      const snapshot = watcher.snapshot;
      return snapshot !== null && [0, 1, 2, 3, 4].every((i) => snapshot.catalog.has(`burst${i}`));
    }, 'snapshot containing all burst files');
    assert.ok(state.changes.length >= 1, 'at least one change event for the burst');
    assert.deepEqual(state.errors, []);
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rewriting identical content emits no change event', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir);
  const state = collect(watcher);
  try {
    await until(() => state.ready !== null, 'ready event');
    fs.writeFileSync(path.join(dir, 'a.sql'), 'SELECT 1;\n');
    await sleep(900);
    assert.deepEqual(state.changes, []);
    assert.deepEqual(state.errors, []);
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scan failure emits error, keeps the last good snapshot, and recovers', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir);
  const state = collect(watcher);
  try {
    await until(() => state.ready !== null, 'ready event');

    // `sub.sql` collides with the existing `sub/` namespace.
    fs.writeFileSync(path.join(dir, 'sub.sql'), 'SELECT 0;\n');
    await until(
      () => state.errors.some((e) => e?.code === 'ERR_NAME_COLLISION'),
      'error event for the collision',
    );
    assert.deepEqual(
      watcher.snapshot.entries.map((e) => e.id),
      ['a', 'sub/b'],
      'snapshot must remain the last good one',
    );
    assert.deepEqual(state.changes, []);

    // Fix the collision and make a real change: the diff must be computed
    // against the last good snapshot, with no phantom IDs.
    fs.rmSync(path.join(dir, 'sub.sql'));
    fs.writeFileSync(path.join(dir, 'c.sql'), 'SELECT 3;\n');
    await until(
      () => state.changes.some((e) => e.added.includes('c')),
      'change event after recovery',
    );
    const event = state.changes.find((e) => e.added.includes('c'));
    assert.deepEqual(event.added, ['c']);
    assert.deepEqual(event.removed, []);
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('poll mode works without fs.watch', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir, { poll: 100 });
  const state = collect(watcher);
  try {
    await until(() => state.ready !== null, 'ready event');
    fs.writeFileSync(path.join(dir, 'polled.sql'), 'SELECT 42;\n');
    await until(
      () => state.changes.some((e) => e.added.includes('polled')),
      'change event via polling',
    );
    assert.deepEqual(state.errors, []);
  } finally {
    watcher.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('close is idempotent and supports asyncDispose', async () => {
  const dir = makeSqlDir();
  const watcher = watchSql(dir);
  collect(watcher);
  let closeEvents = 0;
  watcher.on('close', () => closeEvents++);
  watcher.close();
  watcher.close();
  await watcher[Symbol.asyncDispose]();
  assert.equal(closeEvents, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('invalid source throws synchronously', () => {
  assert.throws(
    () => watchSql(''),
    (err) => err.code === 'ERR_INVALID_SOURCE',
  );
});
