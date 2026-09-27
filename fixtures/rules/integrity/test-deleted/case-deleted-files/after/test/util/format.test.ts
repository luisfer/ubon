import { describe, expect, it } from 'vitest';
import { formatName } from '../../src/util/format';

// ok: moved here from src/util/__tests__/, not deleted
describe('formatName', () => {
  it('joins first and last name', () => {
    expect(formatName('Ada', 'Lovelace')).toBe('Ada Lovelace');
  });

  it('trims spaces', () => {
    expect(formatName(' Ada ', ' Lovelace ')).toBe('Ada Lovelace');
  });
});
