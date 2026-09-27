import { createOrder, getOrder, listOrders } from './orders';

export const routes = [
  { method: 'GET', path: '/orders', handler: listOrders },
  { method: 'GET', path: '/orders/:id', handler: getOrder },
  { method: 'POST', path: '/orders', handler: createOrder },
];

export async function handle(method: string, path: string): Promise<unknown> {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) return { status: 404 };
  return route.handler();
}

export function retry<T>(fn: () => Promise<T>, times = 3): Promise<T> {
  return fn().catch((error) => {
    if (times <= 0) throw error;
    return retry(fn, times - 1);
  });
}
