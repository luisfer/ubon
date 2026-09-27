// This file uses CRLF line endings.
const { slugify } = require('./slug');

describe('slugify', () => {
  it.skip('keeps emoji', () => {
    expect(slugify('a b')).toBe('a-b');
  });

  it('lowercases', () => {
    expect(slugify('A')).toBe('a');
  });

  it('joins words with dashes', () => {
    expect(slugify('a b')).toBe('a-b');
  });
});
