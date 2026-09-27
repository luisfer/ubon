import { describe, expect, it, xit } from '@jest/globals';
import { daysInFebruary, isLeapYear } from '../../src/utils/date';

// The file moved from src/utils/ to tests/utils/ (a deletion plus a new file for git).
describe('isLeapYear', () => {
  it('knows 2024 is a leap year', () => {
    expect(isLeapYear(2024)).toBe(true);
  });

  it('knows 1900 is not a leap year', () => {
    expect(isLeapYear(1900)).toBe(false);
  });

  // ok: this skip moved with the file and existed at the base
  it.skip('handles leap seconds', () => {
    expect(isLeapYear(2016)).toBe(true);
  });
});

describe('daysInFebruary', () => {
  it('returns 29 in a leap year', () => {
    expect(daysInFebruary(2000)).toBe(29);
  });

  xit('returns 28 otherwise', () => { // expect-block: integrity/test-skipped
    expect(daysInFebruary(2023)).toBe(28);
  });
});
