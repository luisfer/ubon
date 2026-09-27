import { expect, test } from '@playwright/test';

test('checkout works', async ({ page, browserName }) => {
  // ok: a conditional skip on a fixture value is a deliberate browser check
  test.skip(browserName === 'webkit', 'The payment iframe does not load in WebKit');
  await page.goto('/checkout');
  await expect(page.getByText('Pay')).toBeVisible();
});

test('refund works', async ({ page }) => {
  test.fixme(); // expect-block: integrity/test-skipped
  await page.goto('/refund');
  await expect(page.getByText('Refunded')).toBeVisible();
});

test.describe.skip('invoices', () => { // expect-block: integrity/test-skipped
  test('lists invoices', async ({ page, context }) => {
    // ok: context is the browser context fixture, not the Mocha alias
    await context.clearCookies();
    await page.goto('/invoices');
  });
});
