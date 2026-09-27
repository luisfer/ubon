import { describe, expect, it } from 'vitest';
import { formatName } from '../format';

describe('formatName', () => {
  it('joins first and last name', () => {
    expect(formatName('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('trims spaces', () => {
    expect(formatName(' Ada ', ' Lovelace ')).toBe('Ada Lovelace');
  });
});
