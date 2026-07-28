import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sqlLoader as esbuildSql } from '../../dist/esbuild.js';
import { sqlLoader as rollupSql } from '../../dist/rollup.js';
import { sqlLoader as viteSql } from '../../dist/vite.js';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const TSC = fileURLToPath(new URL('../../node_modules/typescript/lib/tsc.js', import.meta.url));
const TYPES_PROJECT = fileURLToPath(new URL('../types/', import.meta.url));

const posix = (p) => p.replaceAll('\\', '/');

let tmpDir;
let counter = 0;
before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-plugins-'));
});
after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeEntry() {
  const entry = path.join(tmpDir, `entry${counter++}.mjs`);
  fs.writeFileSync(
    entry,
    [
      `export { findById, insertOne } from '${posix(path.join(FIXTURES, 'named', 'queries.sql'))}';`,
      `export { default as selectAll } from '${posix(path.join(FIXTURES, 'basic', 'select.sql'))}';`,
    ].join('\n'),
  );
  return entry;
}

async function importCode(code) {
  const file = path.join(tmpDir, `out${counter++}.mjs`);
  fs.writeFileSync(file, code);
  return import(pathToFileURL(file));
}

function assertBundleExports(mod) {
  assert.equal(mod.findById, 'SELECT * FROM users WHERE id = :id;');
  assert.equal(mod.insertOne, 'INSERT INTO users (name)\nVALUES (:name);');
  assert.equal(typeof mod.selectAll, 'string');
  assert.ok(mod.selectAll.includes('SELECT'));
}

test('transform: filters ids correctly (unit, shared by rollup/vite)', () => {
  const plugin = rollupSql();
  assert.equal(plugin.name, 'sql-loader');
  assert.equal(plugin.transform('SELECT 1;', '/x/query.js'), null);
  assert.equal(plugin.transform('SELECT 1;', '\0virtual.sql'), null);
  assert.equal(plugin.transform('SELECT 1;', '/x/q.sql?raw'), null);
  assert.equal(plugin.transform('SELECT 1;', '/x/q.sql?url'), null);
  assert.equal(plugin.transform('SELECT 1;', '/x/q.sql?inline'), null);

  const hmr = plugin.transform('SELECT 1;', '/x/q.sql?t=1234');
  assert.match(hmr.code, /^export default "SELECT 1;";$/m);
  assert.equal(hmr.map, null);

  const plain = plugin.transform('SELECT 1;', '/x/q.sql');
  assert.match(plain.code, /export default/);
});

test('vite factory is the rollup plugin plus enforce: "pre"', () => {
  const plugin = viteSql();
  assert.equal(plugin.enforce, 'pre');
  assert.equal(plugin.name, 'sql-loader');
  assert.match(plugin.transform('SELECT 1;', '/x/q.sql').code, /export default/);
});

test('transform errors carry the file path (bundler-visible)', () => {
  const plugin = rollupSql();
  assert.throws(
    () => plugin.transform('-- name: bad name\nSELECT 1;', '/proj/sql/broken.sql'),
    (err) => {
      assert.equal(err.code, 'ERR_INVALID_NAME');
      assert.match(err.message, /broken\.sql/);
      return true;
    },
  );
});

test('rollup e2e: bundles .sql imports', async () => {
  const { rollup } = await import('rollup');
  const bundle = await rollup({
    input: writeEntry(),
    plugins: [rollupSql()],
    onwarn: () => {},
  });
  const { output } = await bundle.generate({ format: 'esm' });
  await bundle.close();
  const mod = await importCode(output[0].code);
  assertBundleExports(mod);
});

test('esbuild e2e: bundles .sql imports', async () => {
  const esbuild = await import('esbuild');
  const result = await esbuild.build({
    entryPoints: [writeEntry()],
    bundle: true,
    format: 'esm',
    write: false,
    logLevel: 'silent',
    plugins: [esbuildSql()],
  });
  const mod = await importCode(result.outputFiles[0].text);
  assertBundleExports(mod);
});

test('plugin types stay assignable to real bundler Plugin types', () => {
  const result = spawnSync(process.execPath, [TSC, '-p', TYPES_PROJECT], { encoding: 'utf8' });
  assert.equal(result.status, 0, `tsc failed:\n${result.stdout}${result.stderr}`);
});
