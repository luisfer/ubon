export interface User {
  id: string;
  name: string;
}

export function parseUser(input: unknown): User {
  if (typeof input !== 'object' || input === null) throw new Error('not an object');
  const record = input as Record<string, unknown>;
  return { id: String(record.id), name: String(record.name) };
}

export function greet(user: User): string {
  return `Hello, ${user.name}`;
}
