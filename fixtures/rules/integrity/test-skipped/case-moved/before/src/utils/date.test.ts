import { describe, expect, it } from '@jest/globals';
import { daysInFebruary, isLeapYear } from './date';

describe('isLeapYear', () => {
  it('knows 2024 is a leap year', () => {
    expect(isLeapYear(2024)).toBe(true);
  });

  it('knows 1900 is not a leap year', () => {
    expect(isLeapYear(1900)).toBe(false);
  });

  it.skip('handles leap seconds', () => {
    expect(isLeapYear(2016)).toBe(true);
  });
});

describe('daysInFebruary', () => {
  it('returns 29 in a leap year', () => {
    expect(daysInFebruary(2000)).toBe(29);
  });

  it('returns 28 otherwise', () => {
    expect(daysInFebruary(2023)).toBe(28);
  });
});
