import OpenAI from 'openai'; // ok: mapped in the Deno import map
import { serve } from 'std/http/server.ts'; // ok: prefix mapped in the Deno import map
import { z } from 'npm:zod@3'; // ok: npm: specifier resolved by Deno
import { cors } from 'hono-cors-helper'; // expect-warn: deps/undeclared-import

serve(async () => new Response(JSON.stringify({ ok: !!OpenAI && !!z && !!cors })));
