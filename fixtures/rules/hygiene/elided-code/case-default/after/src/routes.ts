import { createOrder, getOrder, listOrders } from './orders';

export const routes = [
  { method: 'GET', path: '/orders', handler: listOrders },
  // ... existing routes ...
  { method: 'DELETE', path: '/orders/:id', handler: createOrder },
];

export async function handle(method: string, path: string): Promise<unknown> {
  // rest of the implementation
}

export function retry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  // ok: prose that starts with an ellipsis is not elision
  // ...and then we retry with one attempt fewer
  return fn().catch((error) => {
    if (times <= 0) throw error;
    return retry(fn, times - 1);
  });
}
