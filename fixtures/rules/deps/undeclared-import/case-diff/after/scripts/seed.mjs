// ok: optional import in a try block, not installed and not declared
let faker = null;
try {
  faker = (await import('@faker-js/faker')).faker;
} catch {
  faker = null;
}

export const seed = faker;
