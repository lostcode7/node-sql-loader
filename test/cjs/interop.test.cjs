'use strict';
const { test } = require('node:test');
const { runSharedAssertions } = require('../helpers/shared.cjs');

test('CJS build: require(dist/index.cjs) passes the shared interop suite', async () => {
  const lib = require('../../dist/index.cjs');
  await runSharedAssertions(lib);
});
