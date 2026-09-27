# ai-chat-tools

A Next.js chat app built with the Vercel AI SDK, with tools the model can call.

| Problem | File |
| --- | --- |
| A tool that runs any shell command the model writes | `lib/tools/shell.ts` |
| Model output passed to `eval` | `app/api/calculate/route.ts` |
| Request data in the system prompt | `app/api/chat/route.ts` |

The chat route also has no auth, rate limit, or output token cap. Ubon 4.0 does not report that (a rule for it is planned); `fixed/` adds all three.

The weather tool is the safe shape: the model chooses a city from an enum, and the URL is fixed. `fixed/` limits the shell tool to named read-only checks, replaces `eval` with a small arithmetic parser, and maps the persona to fixed text. `EXPECTED.json` lists every finding with its rule and line.
