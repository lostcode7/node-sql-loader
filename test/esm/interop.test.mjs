import { test } from 'node:test';
import * as lib from '../../dist/index.js';
import { runSharedAssertions } from '../helpers/shared.cjs';

test('ESM build: import(dist/index.js) passes the shared interop suite', async () => {
  await runSharedAssertions(lib);
});
