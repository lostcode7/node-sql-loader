import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSqlCatalogSync, loadSqlSync } from '../../dist/index.js';

const fixture = (name) => new URL(`../fixtures/${name}/`, import.meta.url);
const CLI = fileURLToPath(new URL('../../dist/cli/index.js', import.meta.url));

test('dangerous filenames become plain own properties on null-proto nodes', () => {
  const sql = loadSqlSync(fixture('proto'));
  assert.equal(Object.getPrototypeOf(sql), null);
  for (const key of ['__proto__', 'constructor', 'toString']) {
    assert.ok(Object.hasOwn(sql, key), `missing own property ${key}`);
    assert.equal(typeof sql[key], 'string');
    assert.ok(sql[key].includes(`'${key === '__proto__' ? 'proto' : key}'`));
  }
  assert.ok(Object.isFrozen(sql));
});

test('generated js module carries __proto__ as a real own property', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-proto-'));
  try {
    const out = path.join(tmpDir, 'proto.js');
    const result = spawnSync(
      process.execPath,
      [CLI, 'generate', fileURLToPath(fixture('proto')), '--format', 'js', '--out', out],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const mod = await import(pathToFileURL(out));
    assert.ok(Object.hasOwn(mod.queries, '__proto__'));
    // biome-ignore lint/suspicious/noProto: the test verifies __proto__ works as a data key
    // biome-ignore lint/complexity/useLiteralKeys: bracket access is the point being tested
    assert.equal(typeof mod.queries['__proto__'], 'string');
    assert.equal(typeof mod.getSql('__proto__'), 'string');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('CRLF and LF files with identical lines normalize to identical text and hash', () => {
  const result = loadSqlCatalogSync(fixture('crlf'));
  const win = result.catalog.get('win');
  const unix = result.catalog.get('unix');
  assert.equal(win.text, unix.text);
  assert.equal(win.hash, unix.hash);
  assert.ok(!win.text.includes('\r'));
});

test('IDs and keys never contain backslashes, even on Windows', () => {
  const result = loadSqlCatalogSync(fixture('basic'));
  for (const entry of result.entries) {
    assert.ok(!entry.id.includes('\\'), `backslash in id: ${entry.id}`);
  }
  for (const key of result.catalog.keys()) {
    assert.ok(!key.includes('\\'), `backslash in catalog key: ${key}`);
  }
});

test('symlinked directories are skipped by default and followed with followSymlinks', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-symlink-'));
  try {
    const realDir = path.join(tmpDir, 'real');
    const linkedTarget = path.join(tmpDir, 'linked-target');
    fs.mkdirSync(realDir);
    fs.mkdirSync(linkedTarget);
    fs.writeFileSync(path.join(realDir, 'x.sql'), 'SELECT 1;\n');
    fs.writeFileSync(path.join(linkedTarget, 'y.sql'), 'SELECT 2;\n');
    try {
      fs.symlinkSync(linkedTarget, path.join(realDir, 'link'), 'junction');
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES') {
        t.skip('symlink creation not permitted on this system');
        return;
      }
      throw error;
    }

    const skipped = loadSqlCatalogSync(realDir);
    assert.deepEqual(
      skipped.entries.map((e) => e.id),
      ['x'],
    );

    const followed = loadSqlCatalogSync(realDir, { followSymlinks: true });
    assert.deepEqual(
      followed.entries.map((e) => e.id),
      ['link/y', 'x'],
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('reserved Windows device names load fine on POSIX', (t) => {
  if (process.platform === 'win32') {
    t.skip('CON is a reserved device name on Windows');
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-reserved-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'CON.sql'), 'SELECT 1;\n');
    const result = loadSqlCatalogSync(tmpDir);
    assert.deepEqual(
      result.entries.map((e) => e.id),
      ['CON'],
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
