import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { db } from '../lib/db';

export const sqlTool = tool(
  async ({ query }) => {
    const rows = await db.query(query); // expect: llm/tool-dangerous-capability
    return JSON.stringify(rows);
  },
  { name: 'run_sql', description: 'Run SQL against the analytics database', schema: z.object({ query: z.string() }) },
);
