# express-legacy

An Express API with PostgreSQL, written in CommonJS.

| Problem | File |
| --- | --- |
| Path traversal in a download route | `src/routes/files.js` |
| `exec` with a query parameter in the command | `src/routes/tools.js` |
| Session cookie without `httpOnly` | `src/routes/auth.js` |

The app also hashes passwords with MD5. Ubon 4.0 does not report that (a rule for it is planned); `fixed/` uses scrypt.

The SQL queries use parameters (`$1`) and must not be reported. `fixed/` resolves the path and checks that it stays in the uploads folder, validates the host and uses `execFile`, and sets `httpOnly`, `secure`, and `sameSite` on the cookie. `EXPECTED.json` lists every finding with its rule and line.
