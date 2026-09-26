# Demo fixture

The README's example output comes from this fixture. `before/` is committed as the base, then `after/` replaces it, as if an agent had added a link preview route and an OpenAI client. `scripts/gen-docs.mjs` runs `ubon check` on the result and writes the output into the README.

The key in `after/lib/openai.ts` is a marker that the generator replaces with a random key of the right shape; no key is committed.
