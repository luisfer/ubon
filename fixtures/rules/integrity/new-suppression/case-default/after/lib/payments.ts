export function charge(amount: number): number {
  return amount;
}

// ok: this suppression existed at the base; it only moved below charge()
// ubon-ignore secret/provider-key: luisfer: documented Stripe test key from the setup guide
export const testKey = 'pk_test_placeholder';

// ubon-ignore hygiene/placeholder: agent: the user said the sandbox URL is fine for now // expect-warn: integrity/new-suppression
export const sandbox = 'https://sandbox.example.com';

export const region = 'eu'; // ubon-ignore secret/db-url-password: agent: no password in this value // expect-warn: integrity/new-suppression

// ok: an ubon-ignore without a reason suppresses nothing (integrity/invalid-suppression reports it)
// ubon-ignore hygiene/placeholder
export const other = 'your-api-key-here';

// ok: the syntax inside a string is not a suppression
export const help = 'Write // ubon-ignore <rule>: <who>: <evidence> above the line.';
