import { openai } from '@ai-sdk/openai';
import { generateObject, generateText } from 'ai';
import { z } from 'zod';
import { pool } from '@/lib/db';

export async function POST() {
  const { text } = await generateText({ model: openai('gpt-4.1'), prompt: 'Write one SQL query that lists overdue invoices.' });
  const rows = await pool.query(text); // expect: llm/output-to-sink

  const { object } = await generateObject({
    model: openai('gpt-4.1'),
    schema: z.object({ sortBy: z.enum(['due_date', 'amount']), note: z.string() }),
    prompt: 'Pick a sort order for the invoice report.',
  });
  const sorted = await pool.query(`SELECT * FROM invoices ORDER BY ${object.sortBy}`); // ok: enum field of a schema-checked object
  const noted = await pool.query(`INSERT INTO notes (body) VALUES ('${object.note}')`); // expect: llm/output-to-sink
  const safe = await pool.query('INSERT INTO notes (body) VALUES ($1)', [text]); // ok: model output passed as a parameter
  return Response.json({ rows, sorted, noted, safe });
}
