import postgres from 'postgres';

export const prod = postgres('postgres://app:{{fake:db-password}}@db.prod.internal:5432/app'); // expect-block: secret/db-url-password
export const local = postgres('postgres://postgres:postgres@localhost:5432/app'); // ok: local development database
export const loopback = postgres('postgres://app:{{fake:db-password:5}}@127.0.0.1:5432/app'); // ok: loopback host
export const weak = postgres('postgres://postgres:postgres@db.prod.internal:5432/app'); // expect-warn: secret/db-url-password
export const internal = postgres('postgres://app:{{fake:db-password:6}}@pgbouncer:6432/app'); // expect-warn: secret/db-url-password
export const ipv6 = postgres('postgresql://user:{{fake:db-password:7}}@[2001:db8::1]:5432/app'); // ok: IPv6 range reserved for documentation
export const template = postgres('postgresql://user:password@your-postgres-host:5432/app'); // ok: placeholder host
export const fromEnv = postgres(process.env.DATABASE_URL!); // ok: read from the environment
export const interpolated = postgres(`postgres://app:${process.env.DB_PASSWORD}@db.prod.internal/app`); // ok: password comes from the environment
export const docs = 'postgresql://postgres:[YOUR-PASSWORD]@db.abcdefghij.supabase.co:5432/postgres'; // ok: Supabase documentation placeholder
