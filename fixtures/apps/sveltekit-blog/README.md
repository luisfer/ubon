# sveltekit-blog

A SvelteKit blog with SQLite.

The planted problem: the preview page, `src/routes/preview/+page.svelte`, renders HTML built from a form field with `{@html}`.

The publish action also writes to the database without checking the user. Ubon 4.0 does not report that (a rule for it is planned); `fixed/` checks `locals.user.admin`.

`{@html}` on a saved post, rendered when an admin published it, is a common and accepted shape; how Ubon reports it is recorded in `EXPECTED.json`. `fixed/` shows the preview as text.
