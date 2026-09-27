import { existsSync } from 'node:fs';

// Outside server code, session IDs and nonces are often plain names: warn, not block.
export function newCliSessionId(): string {
  const rand = Math.random().toString(36).slice(2, 6); // expect-warn: web/weak-token-randomness
  return `cli_${Date.now()}_${rand}`;
}

export function tempPath(base: string): string {
  let name: string;
  do {
    const nonce = Math.random().toString(36).slice(-8); // expect-warn: web/weak-token-randomness
    name = `${base}.check-${nonce}`;
  } while (existsSync(name));
  return name;
}
