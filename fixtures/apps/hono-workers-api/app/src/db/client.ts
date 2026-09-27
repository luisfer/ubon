import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

export const getDb = (url: string) => drizzle(neon(url));
