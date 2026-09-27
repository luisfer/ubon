export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInFebruary(year: number): number {
  return isLeapYear(year) ? 29 : 28;
}
