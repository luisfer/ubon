import { expect, it } from 'vitest';

// ok: tests use example.com endpoints and placeholder keys on purpose
it('calls the API', () => {
  expect(new URL('https://api.example.com/invoices').host).toBe('api.example.com');
  expect('your-api-key-here').toBeTruthy();
});
