type Action = { type: 'add'; price: number } | { type: 'noop' };

export function cart(state: number, action: Action): number {
  switch (action.type) {
    case 'add':
      return state + action.price;
    default:
      return state;
  }
}

export class Shape {
  area(): number {
    return 0;
  }
}
