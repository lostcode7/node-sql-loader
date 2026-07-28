import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lexPostgresParams } from '../../dist/index.js';

// Table-driven corpus. `named`/`positional` are the expected occurrences in
// source order (duplicates preserved); `errors` are substrings that must each
// match one reported error message.
const CORPUS = [
  {
    name: 'basic named params',
    sql: 'SELECT * FROM users WHERE id = :id AND status = :status',
    named: ['id', 'status'],
  },
  {
    name: 'cast after a param: :: consumed first',
    sql: 'SELECT :id::uuid, :other',
    named: ['id', 'other'],
  },
  {
    name: 'double cast is not a param',
    sql: "SELECT '5'::int::text",
    named: [],
  },
  {
    name: ':= named-notation is not a param',
    sql: 'SELECT f(a := 1, b := :real)',
    named: ['real'],
  },
  {
    name: 'params inside standard strings are inert',
    sql: "SELECT ':fake' , :real FROM t",
    named: ['real'],
  },
  {
    name: "doubled-quote escape: 'it''s :not'",
    sql: "SELECT 'it''s :not', :yes",
    named: ['yes'],
  },
  {
    name: 'line comments are inert (incl. EOF without newline)',
    sql: 'SELECT :a -- ignore :b\nFROM t -- :c',
    named: ['a'],
  },
  {
    name: 'nested block comments are inert',
    sql: '/* outer /* nested :x */ still :y */ SELECT :z',
    named: ['z'],
  },
  {
    name: 'dollar-quoted body is inert (empty tag)',
    sql: 'SELECT $$ :x $1 $$ , :y',
    named: ['y'],
  },
  {
    name: 'dollar-quoted body is inert (named tag)',
    sql: 'SELECT $fn$ :x $other$ :still $fn$ , :y',
    named: ['y'],
  },
  {
    name: 'positional params',
    sql: 'SELECT $1, $2 FROM t WHERE a = $10',
    positional: [1, 2, 10],
  },
  {
    name: '$ inside an identifier is not a param',
    sql: 'SELECT abc$1 FROM t',
    positional: [],
    named: [],
  },
  {
    name: 'E-string backslash escape does not close the string',
    sql: "SELECT E'\\' :inside', :outside",
    named: ['outside'],
  },
  {
    name: 'E-string with escaped backslash closes normally',
    sql: "SELECT e'\\\\', :after",
    named: ['after'],
  },
  {
    name: 'U& string is inert; UESCAPE clause is an ordinary string',
    sql: "SELECT U&'d\\0061t :no' UESCAPE '!' , :yes",
    named: ['yes'],
  },
  {
    name: 'bit and hex strings are inert',
    sql: "SELECT B'0101 :a', X'1FF :b', :c",
    named: ['c'],
  },
  {
    name: 'quoted identifiers are inert',
    sql: 'SELECT "col:on", "we""ird :x", :ok FROM t',
    named: ['ok'],
  },
  {
    name: 'jsonb ? operators are never parameters',
    sql: "SELECT doc ? 'k', doc ?| array['a'], doc ?& array['b'], :ok FROM t",
    named: ['ok'],
  },
  {
    name: 'numeric array slice is safe',
    sql: 'SELECT a[1:3] FROM t',
    named: [],
  },
  {
    name: 'identifier array slice lexes :y as a param (documented limitation)',
    sql: 'SELECT a[x:y] FROM t',
    named: ['y'],
  },
  {
    name: 'param at end of text',
    sql: 'SELECT :name',
    named: ['name'],
  },
  {
    name: 'lone colon at EOF is inert',
    sql: 'SELECT 1 :',
    named: [],
  },
  {
    name: 'repeated names are preserved in order (dedupe is the compiler’s job)',
    sql: 'SELECT :a, :b, :a',
    named: ['a', 'b', 'a'],
  },
  {
    name: '$0 is an error',
    sql: 'SELECT $0',
    errors: ['start at $1'],
  },
  {
    name: 'psql interpolation is an error',
    sql: "SELECT :'var'",
    errors: ['psql'],
  },
  {
    name: 'psql double-quoted interpolation is an error',
    sql: 'SELECT :"var"',
    errors: ['psql'],
  },
  {
    name: 'unterminated string',
    sql: "SELECT 'abc",
    errors: ['Unterminated string'],
  },
  {
    name: 'unterminated block comment',
    sql: 'SELECT 1 /* nope',
    errors: ['Unterminated block comment'],
  },
  {
    name: 'unterminated dollar quote',
    sql: 'SELECT $tag$ nope',
    errors: ['Unterminated dollar-quoted'],
  },
];

for (const entry of CORPUS) {
  test(`lex: ${entry.name}`, () => {
    const result = lexPostgresParams(entry.sql);
    if (entry.errors) {
      for (const expected of entry.errors) {
        assert.ok(
          result.errors.some((e) => e.message.includes(expected)),
          `expected an error containing "${expected}", got: ${JSON.stringify(result.errors)}`,
        );
      }
    } else {
      assert.deepEqual(result.errors, [], `unexpected errors: ${JSON.stringify(result.errors)}`);
    }
    if (entry.named) {
      assert.deepEqual(
        result.params.filter((p) => p.kind === 'named').map((p) => p.name),
        entry.named,
      );
    }
    if (entry.positional) {
      assert.deepEqual(
        result.params.filter((p) => p.kind === 'positional').map((p) => p.index),
        entry.positional,
      );
    }
  });
}

test('lex: occurrences carry correct offsets and line numbers', () => {
  const sql = 'SELECT 1\nFROM t\nWHERE id = :id';
  const result = lexPostgresParams(sql);
  const [param] = result.params;
  assert.equal(param.kind, 'named');
  assert.equal(sql.slice(param.start, param.end), ':id');
});

test('lex: error positions report 1-based lines', () => {
  const result = lexPostgresParams("SELECT 1\nSELECT :'var'");
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
});
