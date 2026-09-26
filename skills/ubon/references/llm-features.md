# Features that call a model

Use when you build a feature that calls a language model: chat, summarization, agents, tools the model can call.

## Keys and calls

- Call the model from server code (a route handler, Server Action, or server function). Never construct an SDK client in browser code, and never use `dangerouslyAllowBrowser: true` with a real key (`llm/browser-key`).
- Read the key from a server-only environment variable.

## Prompts

- Keep the system prompt constant. Put user input, retrieved documents, and web content in user messages, not in the system prompt (`llm/untrusted-system-prompt`).
- Treat model output as untrusted input. Never pass it to `eval`, a shell, raw SQL, or `dangerouslySetInnerHTML` without validation (`llm/output-to-sink`). Parse structured output with a schema (`zod`, `valibot`).

## Tools the model can call

- Give each tool the narrowest capability that does the job. A tool that runs shell commands, writes files, runs SQL, or fetches arbitrary URLs with model-chosen arguments is blocked unless the arguments are constrained (`llm/tool-dangerous-capability`).
- Constrain arguments with an enum or an allowlist in the tool's input schema, and check them again in the handler.
- Check authorization inside each tool handler as if a stranger called it: the model acts with the user's authority, and prompt injection can steer it.

## Cost and abuse

A public route that calls a model can be used to run up the bill. Require auth, add a rate limit (for example Upstash Ratelimit or Arcjet), and set `maxOutputTokens` (or the SDK's equivalent).

## Check

Run `ubon check`, and run `ubon map` to see every route that calls a model and whether it has an auth call and a rate limit.
