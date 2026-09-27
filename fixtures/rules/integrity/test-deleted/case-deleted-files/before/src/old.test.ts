import { describe, expect, it } from 'vitest';
import { oldParser } from './old';

describe.skip('oldParser', () => {
  it('splits on commas', () => {
    expect(oldParser('a,b')).toEqual(['a', 'b']);
  });
});
