import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

export const env = createEnv({
  server: { DATABASE_URL: z.string().url(), AUTH_SECRET: z.string() },
  client: { NEXT_PUBLIC_SITE_URL: z.string().url() },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL, // ok: createEnv keeps server variables on the server
    AUTH_SECRET: process.env.AUTH_SECRET,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  },
});
