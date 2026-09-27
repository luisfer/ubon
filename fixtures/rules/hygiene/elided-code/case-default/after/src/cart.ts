type Action = { type: 'add'; price: number } | { type: 'noop' };

export function cart(state: number, action: Action): number {
  switch (action.type) {
    case 'add':
      return state + action.price;
    default:
      // ok (next line): "unchanged" alone describes the state, it is not a placeholder
      // unchanged
      return state;
  }
}

export class Shape {
  // ok (next line): a section header, not elision
  // Other methods
  area(): number {
    return 0;
  }

  perimeter(): number {
    /* ... */ return 0;
  }
}
