# Configuration

Ubon works without configuration. To change it, create `ubon.json` at the root of the repository. It is plain JSON; Ubon never runs code from your project to read settings, and it does not read settings from `package.json`.

Unknown keys are an error (exit code 2, with the key named), so a typo cannot switch a check off without anyone noticing. Editors can complete and check the file with the JSON Schema that ships in the package:

```json
{
  "$schema": "./node_modules/ubon/schema/config.json"
}
```

## Example

```json
{
  "$schema": "./node_modules/ubon/schema/config.json",
  "rules": {
    "web/open-redirect": "block",
    "hygiene/*": "off"
  },
  "ignore": ["legacy/**"],
  "auth": {
    "functions": ["requireUser", "getCurrentOrg"],
    "public": ["app/api/health/route.ts"]
  },
  "packages": {
    "online": false,
    "minAgeDays": 7,
    "minReleaseAgeHours": 48,
    "allow": ["@acme/*"]
  },
  "commands": {
    "ask": ["npm publish", "vercel --prod"],
    "deny": ["prisma migrate reset"],
    "allow": ["rm -rf .next", "rm -rf dist"]
  },
  "suppressions": { "agent": "allow" },
  "session": { "stop": "block" },
  "prompts": { "secrets": "block" }
}
```

## Keys

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `rules` | object | `{}` | Level per rule ID or pack selector (`pack/*`): `block`, `warn`, or `off`. An exact ID wins over a pack selector. `block` raises every finding of the rule to block; `warn` lowers them; `off` stops the rule from running. |
| `ignore` | string[] | `[]` | Glob patterns of files not to check. A pattern without a slash matches at any depth, as in `.gitignore`. Git-ignored files are never checked. |
| `auth.functions` | string[] | `[]` | Names of your own auth helpers, so `ubon map` recognizes calls to them as auth checks. |
| `auth.public` | string[] | `[]` | Glob patterns of entry point files that are public on purpose; `ubon map` marks them. |
| `packages.online` | boolean | `false` | Allow npm registry and OSV lookups for new packages, in `ubon check` and in install commands in hooks. `ubon vet` always looks up. |
| `packages.minAgeDays` | number | `7` | A newly added package must have existed for at least this many days (`deps/young-package`). |
| `packages.minReleaseAgeHours` | number | `48` | A newly added version must have been published at least this many hours ago. |
| `packages.allow` | string[] | `[]` | Package names or scopes (`@acme/*`) that skip the package checks. |
| `commands.ask` | string[] | `[]` | Command prefixes that need a person to approve them in agent hooks. |
| `commands.deny` | string[] | `[]` | Command prefixes that are always denied in agent hooks. |
| `commands.allow` | string[] | `[]` | Command prefixes that are always allowed, checked before the built-in command rules. |
| `suppressions.agent` | `allow`, `human-only` | `allow` | With `human-only`, a suppression added during an agent session blocks the stop hook until a person approves it. Either way, every new suppression is listed. |
| `session.stop` | `block`, `warn` | `block` | `block`: an agent must fix blocking findings before it finishes. `warn`: it is told and may stop. |
| `prompts.secrets` | `block`, `warn` | `block` | What to do with a prompt that contains a provider key. |
| `maxFileSize` | number | `1048576` | Files larger than this many bytes are skipped and listed under "Not checked". |

## Suppressing one finding

Put a comment above the line, or at the end of it, in the file's comment syntax:

```ts
// ubon-ignore web/ssrf: dana: URL is checked by isAllowedHost() in lib/net.ts
```

```sql
-- ubon-ignore data/permissive-policy: dana: public read-only catalog, reviewed 2026-09-01
```

The reason is required and has two parts: who decided, and the evidence. A comment without a reason, or with an unknown rule ID, suppresses nothing and is reported by `integrity/invalid-suppression`. Markdown files use HTML comments: `<!-- ubon-ignore agent/instruction-injection: dana: quoted example -->`.

## Baselines for existing projects

`ubon baseline` records every current finding in `.ubon/baseline.json` (rule IDs, file paths, and fingerprints; no code and no secrets). Later checks leave those findings out, so an existing project sees only new problems. Commit the file. Diff checks do not need a baseline: they already report only what changed.

## Personal defaults for the Claude Code plugin

The plugin has two options, set when you enable it: the stop behavior and registry lookups for installs. They apply only where `ubon.json` says nothing, so the project's settings always win. Outside the plugin, the environment variables `UBON_STOP` (`block` or `warn`) and `UBON_ONLINE` (`true` or `false`) do the same.
