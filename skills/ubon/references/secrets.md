# Secrets

Use when code needs an API key or another secret, or when a secret was exposed.

## Where secrets go

- In code, read them from the environment: `process.env.OPENAI_API_KEY` in Node, `import.meta.env` only for values that are meant to be public.
- Keep the values in a `.env` file that git ignores (`.env`, `.env.local`), or in the hosting platform's secret settings. Commit a `.env.example` with the variable names and empty values.
- Never put a secret behind a public prefix: `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`, `EXPO_PUBLIC_`, `REACT_APP_`. Frameworks copy those variables into the browser bundle. If browser code needs something that uses a secret, move that call into a route handler, Server Action, or server function, and call it from the browser.
- Public-by-design values are fine in browser code: the Supabase URL and anon (publishable) key, Stripe publishable keys, Firebase web config. Their safety depends on access rules on the server side; see [data-access](data-access.md).

## When a secret was exposed

A key that was committed, printed, pasted into a prompt, or shipped to the browser should be treated as known to others.

1. Remove it from the code and read it from the environment instead.
2. Tell the user which key it was (the provider and the variable name, never the value) and that it needs to be rotated in the provider's dashboard. Removing it from the code does not remove it from git history or from deployed bundles.
3. Do not try to rewrite git history unless the user asks.

## Never

- Print, log, or echo a secret, including in tests and debug output.
- Read `.env` files to learn values. Ask the user for the variable names you need, or read `.env.example`.
