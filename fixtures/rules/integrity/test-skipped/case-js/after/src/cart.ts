export function total(prices: number[]): number {
  return prices.reduce((sum, price) => sum + price, 0);
}

export function discount(amount: number, percent: number): number {
  return amount * (1 - percent / 100);
}
