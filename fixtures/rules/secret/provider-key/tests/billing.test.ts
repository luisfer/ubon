import { it } from 'vitest';

it('charges in test mode', () => {
  const key = '{{fake:stripe-test:2}}'; // expect-warn: secret/provider-key
});
