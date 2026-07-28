import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// Runs npm via the same install that launched the tests when possible;
// otherwise falls back to the npm on PATH (shell needed for npm.cmd on Windows).
function npm(args, cwd) {
  const execPath = process.env.npm_execpath;
  if (execPath?.endsWith('.js')) {
    return spawnSync(process.execPath, [execPath, ...args], { cwd, encoding: 'utf8' });
  }
  return spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

test('npm pack → install into a temp project → ESM, CJS, and CLI all work', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sql-loader-pack-'));
  try {
    // --ignore-scripts: dist/ is already built by the test script's build step.
    const pack = npm(['pack', '--ignore-scripts', '--pack-destination', tmpDir], ROOT);
    assert.equal(pack.status, 0, pack.stderr);
    const tarball = path.join(tmpDir, pack.stdout.trim().split('\n').at(-1).trim());
    assert.ok(fs.existsSync(tarball), `tarball not found: ${tarball}`);

    const project = path.join(tmpDir, 'consumer');
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
    );
    const install = npm(['install', tarball, '--no-audit', '--no-fund'], project);
    assert.equal(install.status, 0, install.stderr);

    const sqlDir = path.join(project, 'sql');
    fs.mkdirSync(sqlDir);
    fs.writeFileSync(path.join(sqlDir, 'hello.sql'), 'SELECT 1 AS hello;\n');

    fs.writeFileSync(
      path.join(project, 'esm-check.mjs'),
      [
        "import { loadSql, SqlLoaderError } from 'sql-loader';",
        "const sql = await loadSql(new URL('./sql/', import.meta.url));",
        "if (typeof sql.hello !== 'string') throw new Error('bad tree');",
        "if (typeof SqlLoaderError.isSqlLoaderError !== 'function') throw new Error('bad export');",
        "console.log('esm-ok');",
      ].join('\n'),
    );
    const esm = spawnSync(process.execPath, ['esm-check.mjs'], { cwd: project, encoding: 'utf8' });
    assert.equal(esm.status, 0, esm.stderr);
    assert.match(esm.stdout, /esm-ok/);

    fs.writeFileSync(
      path.join(project, 'cjs-check.cjs'),
      [
        "const { loadSqlSync } = require('sql-loader');",
        "const sql = loadSqlSync(require('node:path').join(__dirname, 'sql'));",
        "if (typeof sql.hello !== 'string') throw new Error('bad tree');",
        "console.log('cjs-ok');",
      ].join('\n'),
    );
    const cjs = spawnSync(process.execPath, ['cjs-check.cjs'], { cwd: project, encoding: 'utf8' });
    assert.equal(cjs.status, 0, cjs.stderr);
    assert.match(cjs.stdout, /cjs-ok/);

    const cliPath = path.join(project, 'node_modules', 'sql-loader', 'dist', 'cli', 'index.js');
    const version = spawnSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);

    const check = spawnSync(process.execPath, [cliPath, 'check', 'sql', '--json'], {
      cwd: project,
      encoding: 'utf8',
    });
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).ok, true);

    const shebang = fs.readFileSync(cliPath, 'utf8').slice(0, 2);
    assert.equal(shebang, '#!', 'CLI entry must start with a shebang');

    // v2.1 subpaths: bundler plugins resolve via ESM and CJS.
    fs.writeFileSync(
      path.join(project, 'subpaths-check.mjs'),
      [
        "import { sqlLoader as vite } from 'sql-loader/vite';",
        "import { sqlLoader as rollup } from 'sql-loader/rollup';",
        "import { sqlLoader as esbuild } from 'sql-loader/esbuild';",
        "if (typeof vite !== 'function' || typeof rollup !== 'function' || typeof esbuild !== 'function')",
        "  throw new Error('bad plugin exports');",
        "if (vite().enforce !== 'pre') throw new Error('vite plugin missing enforce');",
        "console.log('subpaths-ok');",
      ].join('\n'),
    );
    const subpaths = spawnSync(process.execPath, ['subpaths-check.mjs'], {
      cwd: project,
      encoding: 'utf8',
    });
    assert.equal(subpaths.status, 0, subpaths.stderr);
    assert.match(subpaths.stdout, /subpaths-ok/);

    fs.writeFileSync(
      path.join(project, 'subpaths-check.cjs'),
      [
        "const { sqlLoader } = require('sql-loader/rollup');",
        "if (typeof sqlLoader !== 'function') throw new Error('bad cjs plugin export');",
        "console.log('subpaths-cjs-ok');",
      ].join('\n'),
    );
    const subpathsCjs = spawnSync(process.execPath, ['subpaths-check.cjs'], {
      cwd: project,
      encoding: 'utf8',
    });
    assert.equal(subpathsCjs.status, 0, subpathsCjs.stderr);

    // v2.1: --import sql-loader/register from the installed package.
    fs.writeFileSync(
      path.join(project, 'register-check.mjs'),
      [
        "import query from './sql/hello.sql';",
        "if (!query.includes('SELECT')) throw new Error('bad .sql import');",
        "console.log('register-ok');",
      ].join('\n'),
    );
    const registered = spawnSync(
      process.execPath,
      ['--import', 'sql-loader/register', 'register-check.mjs'],
      { cwd: project, encoding: 'utf8' },
    );
    assert.equal(registered.status, 0, registered.stderr);
    assert.match(registered.stdout, /register-ok/);

    // v2.1: wildcard types ship in the tarball.
    assert.ok(fs.existsSync(path.join(project, 'node_modules', 'sql-loader', 'types.d.ts')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
