import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseToml } from '../src/lang/toml.ts';

/** Plain objects for deepEqual (the parser uses null-prototype tables). */
function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test('tables, dotted and quoted keys, and line numbers', () => {
  const doc = parseToml(
    [
      '# Codex config',
      'model = "gpt-5.1-codex"',
      'approval_policy = "on-request"',
      '',
      '[profiles.fast]',
      'model_reasoning_effort = "low"',
      'site."example.com".enabled = true',
      '',
      "[mcp_servers.'docs server']",
      'command = "npx"',
    ].join('\n'),
  );
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(plain(doc.data), {
    model: 'gpt-5.1-codex',
    approval_policy: 'on-request',
    profiles: { fast: { model_reasoning_effort: 'low', site: { 'example.com': { enabled: true } } } },
    mcp_servers: { 'docs server': { command: 'npx' } },
  });
  assert.equal(doc.lineOf(['model']), 2);
  assert.equal(doc.lineOf(['profiles', 'fast']), 5);
  assert.equal(doc.lineOf(['profiles', 'fast', 'site', 'example.com', 'enabled']), 7);
  assert.equal(doc.lineOf(['mcp_servers', 'docs server', 'command']), 10);
});

test('arrays of tables nest under the last element', () => {
  const doc = parseToml(
    [
      '[[hooks.PreToolUse]]',
      'matcher = "Bash"',
      '[[hooks.PreToolUse.hooks]]',
      'type = "command"',
      'command = "ubon hook codex PreToolUse"',
      '[[hooks.PreToolUse.hooks]]',
      'type = "command"',
      'command = "echo second"',
      '[[hooks.PreToolUse]]',
      'matcher = "apply_patch"',
    ].join('\n'),
  );
  assert.deepEqual(doc.errors, []);
  assert.deepEqual(plain(doc.data), {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'ubon hook codex PreToolUse' },
            { type: 'command', command: 'echo second' },
          ],
        },
        { matcher: 'apply_patch' },
      ],
    },
  });
  assert.equal(doc.lineOf(['hooks', 'PreToolUse', 0, 'hooks', 1, 'command']), 8);
  assert.equal(doc.lineOf(['hooks', 'PreToolUse', 1]), 9);
});

test('strings: basic, literal, multi-line, and escapes', () => {
  const doc = parseToml(
    [
      'basic = "tab\\there \\"quoted\\" \\u00e9 \\U0001F600"',
      "literal = 'C:\\Users\\dev\\n'",
      'multi = """',
      'first line',
      'second \\',
      '   continued"""',
      "raw = '''",
      "keep \\n as is'''",
      'quotes = """two ""quotes"" at the end"""""',
    ].join('\n'),
  );
  assert.deepEqual(doc.errors, []);
  const data = plain(doc.data) as Record<string, string>;
  assert.equal(data.basic, 'tab\there "quoted" \u00e9 \u{1F600}');
  assert.equal(data.literal, 'C:\\Users\\dev\\n');
  assert.equal(data.multi, 'first line\nsecond continued');
  assert.equal(data.raw, 'keep \\n as is');
  assert.equal(data.quotes, 'two ""quotes"" at the end""');
});

test('numbers, booleans, dates, arrays, and inline tables', () => {
  const doc = parseToml(
    [
      'int = 1_000',
      'neg = -17',
      'hex = 0xDEAD_BEEF',
      'oct = 0o755',
      'bin = 0b1101',
      'float = 6.626e-34',
      'inf = -inf',
      'yes = true',
      'when = 1979-05-27T07:32:00Z',
      'spaced = 1979-05-27 07:32:00',
      'day = 1979-05-27',
      'time = 07:32:00',
      'args = ["-y", "pkg@1.2.3", # comment inside',
      '  "--flag",',
      ']',
      'env = { API_KEY = "${API_KEY}", nested.depth = 2 }',
      'multi_inline = {',
      '  a = 1,',
      '  b = [1, 2],',
      '}',
    ].join('\n'),
  );
  assert.deepEqual(doc.errors, []);
  const d = doc.data as Record<string, unknown>;
  assert.equal(d.int, 1000);
  assert.equal(d.neg, -17);
  assert.equal(d.hex, 0xdeadbeef);
  assert.equal(d.oct, 0o755);
  assert.equal(d.bin, 13);
  assert.equal(d.float, 6.626e-34);
  assert.equal(d.inf, Number.NEGATIVE_INFINITY);
  assert.equal(d.yes, true);
  assert.equal(d.when, '1979-05-27T07:32:00Z');
  assert.equal(d.spaced, '1979-05-27 07:32:00');
  assert.equal(d.day, '1979-05-27');
  assert.equal(d.time, '07:32:00');
  assert.deepEqual(d.args, ['-y', 'pkg@1.2.3', '--flag']);
  assert.deepEqual(plain(d.env), { API_KEY: '${API_KEY}', nested: { depth: 2 } });
  assert.deepEqual(plain(d.multi_inline), { a: 1, b: [1, 2] });
  assert.equal(doc.lineOf(['args', 2]), 14);
  assert.equal(doc.lineOf(['env', 'API_KEY']), 16);
});

test('errors are reported with lines and parsing continues', () => {
  const doc = parseToml(
    [
      'good = 1',
      'bad = ',
      'dup = 1',
      'dup = 2',
      '[table]',
      'x = "unclosed',
      '[table]',
      'after = "still parsed"',
      'weird = nope',
      'trailing = 1 junk',
      '[[good_array]]',
      'y = 1',
    ].join('\n'),
  );
  const lines = doc.errors.map((e) => e.line);
  assert.deepEqual(lines, [2, 4, 6, 7, 9, 10]);
  const d = plain(doc.data) as Record<string, unknown>;
  assert.equal(d.good, 1);
  assert.equal(d.dup, 1);
  assert.deepEqual(d.good_array, [{ y: 1 }]);
  assert.ok(doc.errors.every((e) => e.message.length > 0));
});

test('never throws, and prototype keys stay data', () => {
  for (const input of ['[', '[[a]', 'a = [1, 2', 'a = {b = 1', '"""', "a = '''open", 'a.b.c', '= 1', '\u0000', 'a = """\\z"""']) {
    const doc = parseToml(input);
    assert.ok(doc.errors.length > 0, JSON.stringify(input));
  }
  const doc = parseToml('__proto__ = "x"\n[constructor]\nprototype = 1');
  assert.deepEqual(doc.errors, []);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(doc.data), null);
});

test('a byte order mark at the start is ignored', () => {
  const doc = parseToml('\uFEFFkey = "value"');
  assert.deepEqual(doc.errors, []);
  assert.equal((doc.data as Record<string, unknown>).key, 'value');
});
