import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import OpenAI from 'npm:openai@5.23.0';

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const { question } = await req.json();
  const response = await openai.responses.create({
    model: 'gpt-4.1-mini',
    instructions: 'You suggest recipes from the ingredients the user lists.',
    input: String(question).slice(0, 2000),
    max_output_tokens: 500,
  });
  return Response.json({ answer: response.output_text });
});
