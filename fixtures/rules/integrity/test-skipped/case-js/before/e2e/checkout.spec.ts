import { expect, test } from '@playwright/test';

test('checkout works', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page.getByText('Pay')).toBeVisible();
});

test('refund works', async ({ page }) => {
  await page.goto('/refund');
  await expect(page.getByText('Refunded')).toBeVisible();
});

test.describe('invoices', () => {
  test('lists invoices', async ({ page }) => {
    await page.goto('/invoices');
  });
});
