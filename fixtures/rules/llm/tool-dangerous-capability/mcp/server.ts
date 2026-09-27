import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import pg from 'pg';
import { z } from 'zod';

const pool = new pg.Pool();
const server = new McpServer({ name: 'shop', version: '1.0.0' });

server.tool('query', 'Run a SQL query against the shop database', { sql: z.string() }, async ({ sql }) => {
  const { rows } = await pool.query(sql); // expect: llm/tool-dangerous-capability
  return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
});

server.tool('orders', 'List the orders of a customer', { customerId: z.string().uuid() }, async ({ customerId }) => {
  const { rows } = await pool.query(`SELECT * FROM orders WHERE customer_id = '${customerId}'`); // ok: uuid format constrains the value
  return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
});

server.tool('fetch_page', 'Fetch a web page', { url: z.string().url() }, async ({ url }) => {
  const res = await fetch(url); // expect: llm/tool-dangerous-capability
  return { content: [{ type: 'text', text: await res.text() }] };
});

server.registerTool('docs', { description: 'Read a documentation page', inputSchema: { page: z.string() } }, async ({ page }) => {
  const res = await fetch(`https://docs.example.com/${page}`); // ok: fixed host; the model only chooses the path
  return { content: [{ type: 'text', text: await res.text() }] };
});

server.tool('products', 'Search products', { term: z.string() }, async ({ term }) => {
  const { rows } = await pool.query('SELECT * FROM products WHERE name ILIKE $1', [`%${term}%`]); // ok: parameterized query
  return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
});
