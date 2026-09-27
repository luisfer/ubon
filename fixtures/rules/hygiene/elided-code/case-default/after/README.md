# Orders service

Handles orders and refunds for the shop.

<!-- ... rest of the file unchanged ... --> <!-- expect-block: hygiene/elided-code -->

## Extend

ok: comments in fenced code blocks are documentation, not elision.

```ts
export const routes = [
  // ... existing routes ...
  { method: 'GET', path: '/refunds', handler: listRefunds },
];
```
