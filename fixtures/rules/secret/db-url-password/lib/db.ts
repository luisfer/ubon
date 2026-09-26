import postgres from 'postgres';

export const prod = postgres('postgres://app:{{fake:db-password}}@db.prod.internal:5432/app'); // expect-block: secret/db-url-password
export const local = postgres('postgres://postgres:postgres@localhost:5432/app'); // expect-warn: secret/db-url-password
export const fromEnv = postgres(process.env.DATABASE_URL!); // ok: read from the environment
export const interpolated = postgres(`postgres://app:${process.env.DB_PASSWORD}@db.prod.internal/app`); // ok: password comes from the environment
export const docs = 'postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghij.supabase.co:5432/postgres'; // ok: Supabase documentation placeholder
