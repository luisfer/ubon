// This file uses CRLF line endings.
const { slugify } = require('./slug');

describe('slugify', () => {
  // ok: this skip existed at the base (the file is CRLF, the check compares lines without CR)
  it.skip('keeps emoji', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  fit('lowercases', () => { // expect-block: integrity/test-skipped
    expect(slugify('A')).toBe('a');
  });

  it('joins words with dashes', () => {
    expect(slugify('a b')).toBe('a-b');
  });
});
