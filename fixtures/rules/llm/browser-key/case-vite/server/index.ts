import express from 'express';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY }); // ok: server code with a server-only key
const legacy = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, dangerouslyAllowBrowser: true }); // expect-warn: llm/browser-key

const app = express();
app.post('/api/chat', express.json(), async (req, res) => {
  const completion = await (req.body.legacy ? legacy : openai).chat.completions.create({ model: 'gpt-4o-mini', messages: req.body.messages });
  res.json(completion);
});

app.listen(3001);
