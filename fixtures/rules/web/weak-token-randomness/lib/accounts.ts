import { db } from './db';

function makeRandomString(length: number): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
  return text;
}

export async function createTemporaryAccount(email: string) {
  return db.user.create({ data: { email, password: makeRandomString(12) } }); // expect: web/weak-token-randomness
}

export async function createRandomFakeUsers(count: number) {
  const users = Array.from({ length: count }, (_, i) => ({
    email: `user${i}@example.com`,
    password: makeRandomString(5), // ok: sample users built by a function named as fake data
  }));
  return db.user.createMany({ data: users });
}
