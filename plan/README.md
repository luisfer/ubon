# Ubon 4 plan

Status: proposal, for review by the maintainer before any code changes.
Branch: `claude/compassionate-rubin-9zajb1`.
Date: 2026-09-26.

This folder holds the plan for Ubon 4, a rewrite of Ubon on a clean tree inside this repository. Files:

- [README.md](README.md) (this file): findings, concept, product, architecture, packaging, docs, testing, roadmap, and the decisions that need a maintainer answer.
- [rules.md](rules.md): the proposed rule catalog, with the fate of all 155 v3 rules.
- [integrations.md](integrations.md): exact integration specs for each coding agent, git hooks, CI, and MCP.
- [writing-style.md](writing-style.md): the writing rules for the README, docs, skills, and CLI messages, including the banned list of AI writing mannerisms.
- [readme-draft.md](readme-draft.md): a first draft of the new project README, written to those rules.
- [sources.md](sources.md): references for the claims in this plan.

## Contents

1. [Summary](#1-summary)
2. [What v3 is today](#2-what-v3-is-today)
3. [What changed around Ubon](#3-what-changed-around-ubon)
4. [The new concept](#4-the-new-concept)
5. [Product surface](#5-product-surface)
6. [Skills](#6-skills)
7. [Architecture](#7-architecture)
8. [Dependencies, packaging, and release](#8-dependencies-packaging-and-release)
9. [Documentation](#9-documentation)
10. [Testing, examples, and evidence](#10-testing-examples-and-evidence)
11. [Security of Ubon itself](#11-security-of-ubon-itself)
12. [Staying relevant as models improve](#12-staying-relevant-as-models-improve)
13. [What the rewrite deletes](#13-what-the-rewrite-deletes)
14. [Roadmap](#14-roadmap)
15. [Success measures](#15-success-measures)
16. [Risks](#16-risks)
17. [Decisions needed from the maintainer](#17-decisions-needed-from-the-maintainer)

## Where each part of the request is answered

| Request | Answered in |
| --- | --- |
| 1. Dependencies, package hygiene, updates | [Section 8](#8-dependencies-packaging-and-release) |
| 2. Added value and concept | [Sections 3 and 4](#3-what-changed-around-ubon), [section 6](#6-skills) |
| 3. A version that makes the previous ones obsolete | [Sections 4 to 7](#4-the-new-concept), [section 13](#13-what-the-rewrite-deletes), [rules.md](rules.md) |
| 4. Execution without errors or security issues | [Section 10](#10-testing-examples-and-evidence), [section 11](#11-security-of-ubon-itself), [section 2](#2-what-v3-is-today) for what went wrong in v3 |
| 5. Staying relevant as models improve | [Section 12](#12-staying-relevant-as-models-improve) |
| 6. Becoming an essential hook for AI-assisted development | [integrations.md](integrations.md), [section 5](#5-product-surface), [section 14](#14-roadmap) (4.1: done gate and receipts) |
| 7. README and docs without AI mannerisms, usable by agents | [Section 9](#9-documentation), [writing-style.md](writing-style.md), [readme-draft.md](readme-draft.md) |
| 8. Real examples that can be tested | [Sections 10.2 to 10.6](#102-fixture-apps-the-real-life-examples) |
| 9. Lessons from impeccable and similar projects | [Section 6](#6-skills), [section 9.3](#93-docs-that-cannot-drift), [sources.md](sources.md#projects-that-informed-the-design) |


## 1. Summary

Ubon 3.2.3 has 155 rules, 17 commands, and 168 installed packages. Running it in this environment surfaced fourteen reproducible bugs, and several of them mean a documented feature never worked. The MCP server sends raw secrets to the model. The Cursor hooks never reach the agent. The prompt secret check never blocks. Two cache flags do nothing, and so do two config keys. On Vercel's reference AI chatbot, `ubon check` fails the build on false positives. Two rules give advice that makes code worse. No published version carries provenance, and the release workflow cannot publish under npm's current rules.

Around it, coding agents now act on their own: they run commands, install packages, and edit many files per task. All of the major agents expose hooks, skills, and plugins. Models write better code, but some failure rates have not moved, and capable agents game their own checks. Attackers target the paths agents use: hallucinated package names, poisoned skills, install scripts, and agent config files used for persistence.

The proposal is to rebuild Ubon as a checker that runs inside the agent loop. It judges what the agent changed, at the moment it changes it, with deterministic rules that hold no matter which model wrote the code:

- secrets
- trust boundaries
- data access policies
- dependencies
- dangerous commands
- agent configuration
- the integrity of the project's own tests and checks

It ships as one zero-dependency file, with adapters for Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, git, and CI. Skills cover the judgment work, and there is an MCP server for clients without a shell. Every rule has to earn its `block` level on a public corpus of real projects.

The rewrite deletes the whole v3 tree, including the Lovable profile, the posture score, the LSP and VS Code extension, link checking, and 90-odd rules that other tools do better or that were wrong. v3 stays reachable on a branch and a tag.

Ten questions need a maintainer decision ([section 17](#17-decisions-needed-from-the-maintainer)). The main ones are positioning, the default Stop behavior, and the Node version floor.

The work is ordered in six milestones, M0 (reset) through M5 (4.0.0), then 4.1 and later, each with exit criteria that can be checked.

## 2. What v3 is today

Everything in this section was checked by running v3.2.3 in this environment on 2026-09-26. The commands and outputs are summarized in the audit notes kept with this plan's working files.

### Shape

| Measure | v3.2.3 |
| --- | --- |
| Rules | 155 (79 marked high severity, 115 tagged "security", including build errors and `reactStrictMode`) |
| Source | about 13,000 lines of TypeScript plus 3,000 lines of tests: 16 scanners, 2 reporters, an LSP server, an MCP server, a hooks installer, and a separate VS Code extension |
| CLI | 17 commands, about 50 flags on `check`/`scan` |
| Runtime dependencies | 8 direct plus 1 optional; 168 packages installed, about 66 MB. The TypeScript compiler (23 MB) is used at runtime for parsing, the MCP SDK brings 94 packages, `update-notifier` 54. |
| Known vulnerabilities in the shipped tree | 8 (4 high) from `npm audit --omit=dev`, all under the optional MCP SDK (hono, qs, ip-address, fast-uri, express-rate-limit). The lockfile has not been refreshed since May; 10 Dependabot pull requests are open. |
| Cold start | `npx --yes ubon@3.2.3 --version` takes 7.2 s and 128 MB of npm cache on a cold cache, 0.74 s warm |
| Tarball | 459 files, 1.2 MB unpacked, ships source maps that point to unshipped sources |
| Node support | `>=20`, and CI tests Node 20, which reached end of life on 2026-04-30 |
| Provenance | none: no published version from 3.0.0 to 3.2.3 carries an npm provenance attestation, even though the release workflow passes `--provenance` |
| Repository | 49 stars, 3 forks, no user-filed issues, 10 open Dependabot pull requests |
| Tests | 230 passing Jest tests (they did not catch any of the bugs below) |

### Confirmed bugs

These are reproducible today. Several of them mean a documented feature has never worked.

1. The MCP server sends raw secrets to the model. `ubon.scan` and `ubon.verify` return the unmasked `match` field, so a hardcoded key found by Ubon is copied into the agent's context and the model provider's logs. The CLI's JSON output masks the same field.
2. The Cursor hooks do not reach the agent. The after-edit hook is registered on `afterFileEdit`, an event whose output Cursor ignores. Even if it were read, Cursor passes an absolute `file_path` and `--changed-files` only matches relative paths, so every edit returns zero findings, after paying for a full-repository scan. Five of the eight generated Cursor hooks emit fields that their event does not support.
3. The prompt secret hook never blocks. It answers with `permission`, which `beforeSubmitPrompt` ignores (it honors `continue` and `user_message`). It also writes the prompt to a temporary `.ts` file outside the project, which `--changed-files` can never match, and leaves that file behind in `/tmp` with default permissions.
4. `--no-result-cache` and `--no-cache` do nothing. Commander stores them as `resultCache: false` and `cache: false`; the code reads `noResultCache` and `noCache`. The release script `npm run dogfood` depends on the first one.
5. `failOn` and `profile` in `ubon.config.json` are ignored. Commander's defaults (`error`, `auto`) always override the config file. The README's own configuration example is partly inert.
6. The result cache corrupts itself. All scanners share one `.ubon/results-cache.json` with different signatures and overwrite each other. Signatures are constants (`vibe:1`), not tied to the Ubon version or the config, and cross-file results (hallucinated imports depend on `package.json`) are served from a per-file cache, so stale results survive upgrades and dependency changes.
7. Ubon writes into the project it scans. Every `check` creates `.ubon/` in the target directory, including during CI runs on untrusted code and in test fixtures.
8. Changed-file mode misses new files. It uses `git diff --name-only <ref>`, which ignores untracked files, the files an agent creates most often. When no tracked file changed, the empty list silently turns into a full-repository scan, so the Stop gate either misses the agent's new files or blocks on old debt.
9. Inline suppressions break when scanning another directory. The post-processing pass reads files relative to the process working directory, not the scanned directory, so `-d` and the MCP `directory` argument lose suppressions.
10. `check` is not static. It is described as "static analysis only", but unless `--fast` is passed it queries OSV and sends HTTP HEAD requests to every URL found in Markdown and source files, including internal and cloud metadata addresses. Results depend on the network.
11. Ubon ignores `examples/` in every project. Two scanners hardcode `examples/**` in their ignore list, a leftover from scanning Ubon's own repository.
12. Hooks only run on Unix shells (bash scripts) and call `npx --yes ubon` unpinned, so every hook run executes whatever version is newest on npm.
13. Claude Code support is one paragraph in `CLAUDE.md`, and it disables `AGENTS.md`. Ubon ships no hooks, plugin, or skills for Claude Code. Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists, so generating `CLAUDE.md` turns off the `AGENTS.md` guidance Ubon writes for other agents. The generated Cursor rule also uses a `globs` format Cursor does not accept.
14. Releases depend on a long-lived `NPM_TOKEN` and on GitHub Actions pinned by tag, not commit SHA.

### Precision on a real application

`vercel/ai-chatbot` is Vercel's maintained reference app for AI chat (155 TypeScript files). `ubon check --fast` reports 40 findings and exits 1, which would fail CI. Most are false positives:

| Rule | Count | What it flagged |
| --- | --- | --- |
| NEXT217 | 12 | Components without `'use client'` that are only imported by client components. That is valid; the directive marks the boundary, not every file behind it. |
| JSNET001 | 10 | `fetch` without a timeout, labelled a security issue |
| MOD002 | 7 | `async` functions without `await` |
| SEC025 | 4 | `` NextResponse.redirect(new URL(`${base}/`, request.url)) ``, a same-origin redirect built from constants |
| REACT009 | 3 | `const ctx = useContext(X); if (!ctx) throw ...`, flagged as a conditional hook call |
| others | 4 | a test config `localhost`, one duplicate finding reported under two rule IDs |

With `--detailed` the same app produces 1,317 findings (824 "repeated code blocks", 325 "unused exports").

Two rules give advice that makes code worse (details in [rules.md](rules.md#rules-that-were-harmful-in-v3)): NEXT214 tells agents not to import Server Actions into client components, which is the documented pattern, and DRIZZLE001 reports Drizzle's parameterized `sql` template as injection, which pushes an agent toward `sql.raw()`, the unsafe form.

### What this means

v3 grew by adding rules and flags. The result is a large surface that is hard to test, where several integration paths fail silently, and where the default output on a well-built app is mostly noise. In an agent loop, noise has a direct cost: the agent reads every finding and tries to act on it. A wrong finding produces a wrong edit.

The v3 code is not worth refactoring. The knowledge in it is worth keeping: the provider key formats, the list of agent config files, the fixture ideas, and the lessons in the bug list above.

## 3. What changed around Ubon

Ubon started in August 2025 as a pre-commit scanner for Next.js apps written with AI tools. In the thirteen months since, the setting changed in ways that matter for its design.

Agents now take actions. Claude Code, Codex, Cursor, Gemini CLI, and GitHub Copilot run commands, install packages, and edit many files per task. All of them now expose extension points: hooks that run before and after tool calls and before the agent stops, skills (folders with a `SKILL.md` that the agent loads when relevant), plugins that bundle both, and MCP servers. A checker no longer has to wait for a commit. It can run at the moment an action happens. Details per agent are in [integrations.md](integrations.md).

Models write better code, and some failure rates did not move. Veracode's 2025 study of more than 100 models found security flaws in the code for 45 percent of its test tasks, and no improvement in newer or larger models. The failures that persist are the ones that depend on context the model does not see: which routes need auth, which tables need row level security, which values are secrets.

Capable agents game their checks. ImpossibleBench (2025) made tasks impossible by contradicting the spec with the tests and measured how often agents "passed" anyway. GPT-5 exploited the tests 76 percent of the time on one variant; Claude and Qwen models mostly did it by editing the tests. The behavior drops to near zero when the tests are hidden from the agent or cannot be modified. More capable models find better shortcuts, so the need for an independent check grows with capability.

Hallucinated packages became an attack. A USENIX Security 2025 study of 576,000 generated samples found that 19.7 percent of recommended packages did not exist, and 43 percent of hallucinated names came back on every repeat of the prompt, which makes them predictable targets for "slopsquatting". Agents now run the install command themselves.

The npm supply chain was attacked at scale, and agents became part of the attack surface. The s1ngularity attack on Nx (August 2025) ran the AI coding CLIs already installed on victims' machines, with their permission prompts disabled, to search for secrets. A phished maintainer account put malicious code into chalk and debug (September 2025). The Shai-Hulud worms (September and November 2025) spread through install scripts that stole publish tokens and republished infected packages. In 2026 the pattern continued: axios (March), TanStack published with valid provenance through a poisoned CI cache (May), ChainDrop re-infected projects by writing hooks into `.claude/settings.json` and `.vscode/tasks.json` (August), and WEL1DROPPER published hundreds of slopsquatted and typosquatted packages that needed no install script at all (August). npm revoked all classic tokens in December 2025, made staged publishing with 2FA approval generally available in May 2026, and made dependency install scripts opt-in in npm 12 (July 2026). Details and dates are in [sources.md](sources.md).

Agent configuration became a supply chain. Skills and rules files are instructions that agents follow, and they can carry hidden text. In February 2026 researchers found 341 malicious skills (later more than 1,000) on ClawHub, a skill marketplace, installing an infostealer through fake prerequisites.

The largest leaks from AI-built apps came from missing access policies. Moltbook (January 2026) exposed 1.5 million API tokens because its Supabase key was in client JavaScript, which is normal, and row level security was disabled, which is not. The same pattern was behind earlier Lovable-built app exposures in 2025.

Teams are starting to record who wrote what. Cursor's Agent Trace draft (early 2026) proposes a vendor-neutral format for recording which lines an agent wrote. The next question reviewers ask is what was checked before those lines merged.

## 4. The new concept

### One sentence

**Ubon checks the work of coding agents while they work: it runs inside Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, and CI, looks at what the agent changed, and stops it when it leaks a secret, opens a hole at a trust boundary, adds a package that should not be trusted, runs a destructive command, or weakens the project's own checks.**

It is deterministic, runs locally, installs no dependencies, and makes no network calls unless asked.

### Who it is for

- Developers who let agents write most of their code and want a check they do not have to remember to run.
- Teams that need the same rules for every agent and every developer, and a record in the pull request of what was checked.
- Builders on AI app platforms (Lovable, Bolt, v0, Replit) who export to GitHub and have never looked at their row level security.

### Where it runs

| Moment | What Ubon does | How |
| --- | --- | --- |
| Before a shell command | Denies or asks about destructive commands, secret exfiltration, skipped git hooks, and installs of packages that do not exist or were published hours ago. | `PreToolUse`-style hook |
| Before a file read | Asks before `.env` files and private keys enter the model's context. | `PreToolUse` on read tools, Cursor `beforeReadFile` |
| After a file edit | Checks the edited file and tells the agent about blocking problems while it still has the context to fix them. | `PostToolUse`-style hook |
| When the agent tries to finish | Checks everything changed in the session, including new untracked files, against the state at session start. If a blocking finding remains, the agent is told to continue and fix it. | `Stop` hook |
| When the user submits a prompt | Blocks prompts that contain a provider key, so the key never reaches the model provider. | `UserPromptSubmit`-style hook |
| On commit | Checks staged content. | git `pre-commit` |
| On pull request | Checks the diff against the merge base, uploads SARIF, writes a summary that lists every suppression added. | GitHub Action, any CI |
| When a human or an agent reviews | Produces a map of entry points, auth checks, data access, secrets, and model calls for the agent to review with judgment. | `ubon map` and the skill's `review` playbook |

### What it checks

Nine packs, specified in [rules.md](rules.md):

- `secret`: provider keys, secrets behind public env prefixes, committed `.env` and key files, secrets in prompts and tool output.
- `web`: injection, SSRF, path traversal, unverified webhooks, unverified JWTs, credentialed CORS wildcards, weak token randomness.
- `data`: Supabase tables without row level security, permissive policies, service role keys in client code, Firebase rules in test mode.
- `llm`: API keys in the browser, model output reaching `eval`/SQL/HTML, tools with unconstrained dangerous capabilities, untrusted text in system prompts.
- `deps`: packages that do not exist, packages published days ago, typosquats, install scripts, non-registry sources.
- `agent`: hidden Unicode in instruction files, pipe-to-shell in hooks and skills, secrets in MCP configs, unpinned MCP servers, broad permissions, auto-run config, and command checks.
- `ci`: script injection in workflows, untrusted checkouts in privileged workflows, token-based publishing.
- `integrity`: tests skipped or deleted, type and lint suppressions, weakened config and CI, suppressions added by the agent.
- `hygiene`: code a model elided while rewriting a file, placeholders, copy-named files.

### What it deliberately does not do

- It does not call a language model. The agent in the loop is the model; Ubon gives it facts and holds it to rules.
- It does not replace ESLint, TypeScript, tests, `npm audit`, or a full SAST tool. Where one of those does a job well, Ubon's docs say so and point to it.
- It does not sandbox the agent. Command checks catch accidents and obvious attacks. Containment is the job of the agent's sandbox (Claude Code sandboxing, Codex sandbox modes, containers). The docs say this plainly.
- It does not send code or findings anywhere. No telemetry.
- It does not try to prove an app is secure. It checks invariants and reports what it checked.

### Principles

These decide trade-offs during implementation. Each one comes from a v3 failure or from the changes in section 3.

1. Precision before coverage. A rule blocks only if it is right at least 95 percent of the time on a public corpus of real projects. Everything else warns or is cut. In an agent loop a false positive becomes a wrong edit.
2. Judge the change. The default scope is what changed: in a session, since the session started; in CI, since the merge base. New untracked files are always included. Whole-repository audits are opt-in (`--all`) and use a baseline.
3. Enforce invariants. Ubon enforces rules that should hold no matter who or what wrote the code: no service role key in the browser, no new `.skip` in a test, no package published two hours ago without a human saying yes. Style and framework idioms belong to linters.
4. Deterministic and local. Same input, same output, byte for byte. No network unless the user turns it on for a specific check. No model calls.
5. No install-time dependencies. The package is one bundled file (plus a separately loaded file for MCP), under 1 MB, that starts in tens of milliseconds. The two libraries it needs, the Babel parser and the MCP server SDK, are vendored at pinned versions and listed in the SBOM. A security tool should not bring 168 packages and 8 advisories into a project.
6. Do no harm to the project. Never execute project code (config is JSON only), never write to the project unless asked, never print a secret, never make an agent's work fail because Ubon crashed (hooks fail open with a visible message; CI fails closed).
7. One engine, many adapters. Every agent, git hook, CI job, and MCP client calls the same code with the same rules. Integration files are one-line pointers to `ubon hook <agent> <event>`, generated from one source and tested with recorded payloads.
8. Small surface, strong defaults. Ten commands and a short config file. Every documented behavior has a test.
9. Leave judgment to the model. Ubon does the exhaustive, boring part (enumerating routes, diffing tests, checking package ages) and the model does the judgment, guided by skills. As models improve, the judgment improves and the facts stay useful.
10. Back every claim with a test. Every claim in the README (what it catches, where it works, how fast it is) links to a test, a fixture, or a measurement that runs in CI.

## 5. Product surface

### 5.1 Commands

v3 has 17 commands and about 50 flags. Ubon 4 has ten commands. Anything not listed here is not in 4.0.

```
ubon [check] [paths...]   Check what changed (default) or the given paths
ubon init                 Set up Ubon for this project and its agents (dry run unless --yes)
ubon hook <agent> <event> Handle one hook event from an agent; reads the event JSON on stdin
ubon vet <package...>     Check packages before installing them (registry lookup)
ubon map                  List entry points, auth checks, data access, secrets, and model calls
ubon explain <rule>       Show what a rule checks, why, how to fix it, with tested examples
ubon rules                List rules with their levels (--json for machines)
ubon baseline             Record current findings so --all audits only report new ones
ubon mcp                  Run the MCP server over stdio
ubon doctor               Check the installation, integrations, and recent hook activity
```

`check` flags:

| Flag | Meaning |
| --- | --- |
| `--all` | Check every file, not only changes. |
| `--base <ref>` | Compare against this ref. Default: merge base with the default branch, or the session start inside an agent session. |
| `--staged` | Check staged content (what `git commit` will record), for pre-commit. |
| `--format <name>` | `text`, `agent`, `json`, `sarif`, `markdown`. Default: `text` on a terminal, `agent` when Ubon detects it runs inside an agent's shell, `json` when `--output` ends in `.json`. |
| `--output <file>` | Write the report to a file. |
| `--rule <id>` | Only run these rules; accepts `pack/*`. Repeatable. |
| `--online` | Allow registry and OSV lookups for this run. |
| `--quiet` | Print findings only, no header or footer. |

Exit codes are a contract, tested like the output formats:

| Code | Meaning |
| --- | --- |
| 0 | No `block` findings. |
| 1 | At least one `block` finding. |
| 2 | Usage or configuration error (the message says which key or flag). |
| 3 | Ubon failed. In hooks this never blocks the agent: the hook allows the action and prints a visible warning. |

### 5.2 Configuration

One file, `ubon.json`, in plain JSON. Ubon never loads executable config and does not read settings from `package.json`. Unknown keys are an error with exit code 2, so a typo cannot silently disable anything. A JSON Schema ships in the package and is referenced with `$schema` for editor completion.

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
    "public": ["app/api/health/route.ts", "app/api/og/route.tsx"]
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
  "suppressions": {
    "agent": "allow"
  },
  "session": {
    "stop": "block"
  }
}
```

Without a config file, every default applies and Ubon still works. `ubon init` writes a minimal file and proposes `auth.functions` and `auth.public` from what it finds in the code, marked as proposals for a human to confirm.

### 5.3 Output

Each finding carries: rule, level, file, line and column range, a one-sentence message, masked evidence, the source-to-sink trace when there is one, a one-sentence fix, a docs link, a stable fingerprint, and whether the finding is new in this change or already existed at the base.

Text output (terminal):

```
ubon 4.0.0: 7 changed files since origin/main (0.4 s)

block  web/ssrf  app/api/preview/route.ts:12
       fetch() uses a URL from the request body.
       9   const { url } = await request.json()
       12  const res = await fetch(url)
       Fix: check the host against an allowlist before fetching.

block  secret/provider-key  lib/openai.ts:3
       OpenAI key in source: "sk-proj-...a1B2".
       Fix: read it from process.env.OPENAI_API_KEY, then rotate the key.

warn   hygiene/variant-file  components/Header-new.tsx
       New file looks like a copy of components/Header.tsx.

2 blocking, 1 warning. Not checked: registry lookups (offline).
```

Agent output is the same information in fewer tokens, with the instructions an agent needs at the end. It is the default when Ubon detects an agent's shell, and it is what hooks return:

```
ubon: 2 blocking, 1 warning in 7 changed files (base origin/main)
BLOCK web/ssrf app/api/preview/route.ts:12 fetch() uses a URL from the request body (url, line 9). Fix: allowlist the host before fetching.
BLOCK secret/provider-key lib/openai.ts:3 OpenAI key in source. Fix: use process.env.OPENAI_API_KEY; tell the user to rotate the key.
WARN hygiene/variant-file components/Header-new.tsx New file looks like a copy of components/Header.tsx.
Fix BLOCK findings before you finish. If one is wrong, add `// ubon-ignore <rule>: <who decided>: <evidence>` above the line and tell the user.
```

The last line of every report says what was not checked (offline lookups, skipped large files, files Ubon cannot parse). A report that leaves out what it skipped looks more complete than it is.

JSON output has a versioned schema (`schemaVersion: "4.0"`), published in the package and in the docs. SARIF output validates against the SARIF 2.1.0 schema in CI and uses the fingerprint for `partialFingerprints`. Markdown output is for pull request comments and CI job summaries and lists new suppressions in their own section.

### 5.4 Suppressions and baselines

```ts
// ubon-ignore web/ssrf: luisfer: URL is checked by isAllowedHost() in lib/net.ts
const res = await fetch(url)
```

- The comment goes on the line above or at the end of the line. Markdown, YAML, SQL, and shell comment forms work.
- A reason is required, in the form `<who decided>: <evidence>`. A suppression without a reason does not suppress and is itself reported.
- Suppressions that no longer match anything are reported as `warn` in `--all` mode.
- New suppressions are always listed in the output (`integrity/new-suppression`). With `"suppressions": { "agent": "human-only" }`, a suppression added during an agent session blocks the Stop hook until a human approves it.
- The skills tell agents to write `user confirmed` only when the user did.
- `ubon baseline` writes `.ubon/baseline.json` with fingerprints, rule IDs, and file paths only (no code, no secrets). It is meant for `--all` audits of existing projects; diff mode does not need it.

## 6. Skills

Skills are where Ubon uses the model instead of competing with it. The design follows what works in impeccable (71,000 stars in ten months): a short skill that routes to one playbook per task, a deterministic engine underneath, and generated copies for each agent built from one source.

### 6.1 One skill, several playbooks

`skills/ubon/SKILL.src.md` is the source. The build produces `SKILL.md` per agent (the `.src.md` name keeps `npx skills add` from copying the uncompiled template). The skill body stays under 150 lines and loads a playbook from `references/` only when the task needs it.

| Playbook | When the agent uses it | What it does |
| --- | --- | --- |
| `check` | After changing code, before saying the task is done | Runs `ubon check`, fixes `block` findings, reports what remains. Explains the fix-or-suppress protocol. |
| `review` | When asked to review security, or before a release | Runs `ubon map`, then walks every entry point without an auth signal, every write path, every model call, and every secret use, and writes findings with evidence in a fixed format. Keeps Ubon's deterministic findings separate from its own judgment and says which is which. |
| `finish` | Before claiming a task is complete | Runs the project's own checks (tests, type check, lint) and `ubon check`, then reports what was run, what passed, what was not run, and what is left. Tells the agent not to edit tests to make them pass and to stop and ask when a test looks wrong. |
| `add-dependency` | Before installing a package | Prefers the standard library and packages already in the tree, runs `ubon vet`, pins the version, checks for install scripts, commits the lockfile. |
| `secrets` | When code needs a key or a key leaked | Env var conventions per framework, public prefixes and what they mean, `.env.example`, what to tell the user about rotation, never printing values. |
| `data-access` | When creating tables or storage | Supabase row level security with tested policies, Firebase rules, service role keys on the server only. |
| `llm-features` | When building features that call a model | Keys on the server, constant system prompts, untrusted content kept out of system position, tool allowlists, output handling, rate and token limits. |
| `setup` | When asked to set up Ubon | Runs `ubon init`, reviews the proposed `auth.functions` and `auth.public` with the user, installs the right integrations. |
| `triage` | When a finding looks wrong | Verifies against the code, then either fixes, or writes the narrowest suppression with a truthful reason, or asks the user once. |

If the skill cannot run Ubon (not installed, blocked by permissions), its first output line says so: `Ubon did not run: <reason>. Findings below are my own review, not Ubon's.` A silent fallback would look like a clean check.

### 6.2 Slash commands and subagent

- Claude Code gets the playbooks as commands through the plugin: `/ubon:check`, `/ubon:review`, `/ubon:finish`, `/ubon:vet <package>`.
- A read-only `ubon-reviewer` subagent runs the `review` playbook with fresh context and no edit tools, so the review is independent of the agent that wrote the code.
- Codex, Cursor, Gemini CLI, and Copilot get the same playbooks through their skill folders. Where an agent has no subagents, the playbook runs inline and says so.

### 6.3 Portability rules

From the Agent Skills specification and from what broke for other projects:

- `name` equals the folder name; `description` under 1,024 characters and specific about when to use the skill.
- Frontmatter per agent: a spec-only variant for strict validators (claude.ai uploads, the Skills API), extended fields only where the agent supports them. No `allowed-tools` in the Claude Code variant, because it can prevent activation in non-interactive sessions.
- Ship to `.claude/skills/` and `.agents/skills/`, since Claude Code does not read `.agents/skills/`. Copilot also reads `.github/skills/`.
- Every file a playbook references lives inside the skill folder, because per-skill installers copy only that folder.
- Every `ubon` command in a skill or playbook is parsed in CI and checked against the CLI's real commands and flags.

### 6.4 Testing the skills

- Static checks on every build: frontmatter valid per agent, links resolve, commands exist, prose lint passes, line budget respected.
- Trigger tests: a set of user requests with the expected playbook, scored with a simple lexical ranker over the descriptions, run in CI (an approach used by addyosmani/agent-skills).
- Behavior tests (optional, costs API tokens, run before releases): real agents in headless mode with the skill installed, on fixture tasks, with assertions on the tool calls (did it run `ubon check`, did it avoid editing tests, did it report what it did not run). Results are published as they are, including failures.

## 7. Architecture

### 7.1 Repository layout

```
ubon/
  package.json              no dependencies; bin "ubon" -> dist/ubon.mjs
  src/
    cli/                    argument parsing (node:util parseArgs), one file per command
    core/                   scope (git), config, file model, contexts, findings, masking,
                            fingerprints, suppressions, baseline, scheduler
    lang/                   parser wrapper, scope and taint helpers, SFC script extraction
                            (Svelte, Vue, Astro), JSONC, TOML subset, SQL tokenizer, shell tokenizer
    rules/<pack>/<name>.ts  one file per rule: metadata, check function
    data/                   provider key formats, agent hook event names, command policies,
                            popular package names (all plain data, reviewable in PRs)
    adapters/               one per agent: payload parsing, event mapping, output format
    mcp/                    MCP server (official v2 server package, bundled separately)
    report/                 text, agent, json, sarif, markdown
    online/                 npm registry and OSV clients (only loaded with --online)
  skills/ubon/              SKILL.src.md, references/, the source for every agent's copy
  integrations/             generated: Claude Code plugin, Codex, Cursor, Gemini, Copilot files
  .claude-plugin/           marketplace.json, so `/plugin marketplace add luisfer/ubon` works
  action.yml                GitHub Action (runs the committed dist/ubon.mjs, no install step)
  fixtures/                 rule fixtures, fixture apps, agent configs, diffs, recorded sessions
  corpus/                   pinned real-world repositories and triage results
  docs/                     user docs; docs/rules/ is generated
  scripts/                  build, generate integrations, prose lint, corpus runner, release checks
  test/                     integration tests (CLI binary, hooks, MCP, packaging)
```

### 7.2 Pipeline

```
scope ──> files ──> contexts ──> parse (only if a rule needs an AST) ──> rules ──> findings
  │                                                                       │
  │ git: base, changed, untracked, staged, session start                  │ file rules, project rules,
  │                                                                       │ diff rules (read base blobs)
  ▼                                                                       ▼
report <── level from config <── baseline <── suppressions <── dedupe <── mask evidence
```

1. **Scope.** In a git repository the default is: files changed between the base and the working tree, plus staged changes, plus untracked files that are not ignored. The base is the session start inside an agent session, the merge base with the default branch otherwise (`origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`), and `HEAD` when none exists. Shallow clones without a merge base fall back to `HEAD` with a notice in the output. `--staged` reads blobs from the index, not the working tree. Outside git, the scope is the directory.
2. **Files and contexts.** Each file gets a language, a framework (from the nearest `package.json`), and the contexts from [rules.md](rules.md#how-to-read-this-catalog). The client module graph is built from a fast import pre-pass over the repository, cached by content hash, because a changed file's context depends on files that did not change.
3. **Parse.** `@babel/parser` with TypeScript and JSX, error recovery on, bundled into Ubon's single file. Measured on `vercel/ai-chatbot` (155 files, 611 KB): 16 ms to load, 55 ms to parse everything, 0 parse errors. The TypeScript compiler, which v3 loads at runtime, takes 181 ms just to load, and TypeScript 7 (the current `latest` on npm) no longer exposes the classic compiler API that v3 calls, so staying on it would pin Ubon to an old line. Svelte, Vue, and Astro files have their script blocks extracted and parsed with offsets mapped back to the original file.
4. **Rules.** Per-file rules share one traversal (visitors from all enabled rules merged), so adding a rule does not add a pass. Project rules read manifests, lockfiles, migrations, and agent configs once. Diff rules read base content with `git show <base>:<path>`.
5. **Findings.** Evidence is masked when the finding is created, so the raw secret is never stored on the object. Findings at the same location from rules that overlap are merged, keeping the most specific. Suppressions, then the baseline, then the configured levels are applied. Output is sorted by level, file, line, rule.

### 7.3 Hook runtime

`ubon hook <agent> <event>` is the only entry point for agent hooks. It reads the event JSON from stdin (capped at 10 MB), checks it against the agent and event named on the command line, and dispatches. The exact files and output formats per agent are in [integrations.md](integrations.md).

| Event type | Work done | Budget |
| --- | --- | --- |
| before a shell command | tokenize the command, apply command checks, vet packages named in install commands (offline checks always, registry lookup when `packages.online` is on) | 150 ms offline |
| before a file read | match the path against sensitive file patterns | 50 ms |
| before a file write | scan the new content for provider keys and hidden Unicode (so a key never reaches disk) | 100 ms |
| after a file edit | run file rules on the edited files only, return `block` findings to the agent | 400 ms for one file |
| after a shell command | record the command and its outcome in the session log, scan output for secrets | 50 ms |
| prompt submitted | scan the prompt for provider keys | 50 ms |
| session start | record the base state (see below) | 300 ms |
| stop | run file, project, and diff rules on everything changed in the session, apply the stop policy | 3 s for 50 changed files |

Session state lives in the git directory (`$(git rev-parse --git-dir)/ubon/`), which is never committed and never shared: the session start record (HEAD commit, plus a hash of every file that was already dirty or untracked), the session event log (event, time, duration, decision, no file contents), and a small cache. Without a session start record (Ubon installed mid-session, or an agent without a start event), the base falls back to `HEAD` plus untracked files.

The Stop policy has a loop guard. When the agent is blocked twice for the same findings, the third stop is allowed, and the remaining findings are written to the session log as unresolved so that `ubon check` in CI and the pull request summary show them.

Hooks fail open. If Ubon crashes, times out, or cannot parse the payload, the hook allows the action and prints `ubon: hook error (<reason>); action allowed` where the agent or the user sees it. A broken checker must never break the user's session, and it must never look like a clean pass either.

### 7.4 MCP server

Most agents can run `ubon` in a shell, and skills plus hooks cover them. The MCP server is for clients without a shell (Claude Desktop, ChatGPT developer mode, IDE chat panels) and for clients that prefer typed tools.

- The MCP specification now has two live versions: the 2025-11-25 revision with an `initialize` handshake, which Claude Code still uses for stdio servers by default, and the stateless 2026-07-28 revision. The official TypeScript SDK v2 serves both. Its server package depends only on `zod` and the SDK core (the v1 SDK that v3 used installs 94 packages, 29 MB, including express and hono, and is the source of all 8 advisories in v3's lockfile). Ubon bundles the pinned v2 server package into a separate file that only `ubon mcp` loads, so normal runs never pay for it.
- Tools: `check`, `explain`, `map`, `vet`. All annotated `readOnlyHint: true`; no tool writes files. Descriptions are static strings, never built from repository content.
- Results carry `structuredContent` (the JSON report) and a short text summary. Evidence is masked by the same code path as every other output, and snippets are stripped of control, bidi, and Unicode tag characters, because scanned code is hostile input.
- Paths are confined to the workspace the client passes; anything outside is rejected.
- Not enabled by default in the Claude Code plugin, because tool definitions cost context tokens on every turn and the CLI is already on the agent's PATH there.
- Conformance is tested against the official MCP Inspector in CI, for both protocol versions.
- Published to the MCP registry (`mcpName` in `package.json`, `server.json` in the release workflow).

### 7.5 Programmatic API

A small, documented, semver-stable API for people building their own integrations:

```ts
import { check, rules } from 'ubon'

const report = await check({ cwd: '/path/to/repo', scope: 'diff', base: 'origin/main' })
report.findings.filter((f) => f.level === 'block')
```

Rules and adapters are internal in 4.0. A public rule API is considered after 4.1, once the internal one has settled; declarative custom checks (patterns, file globs, message, level in `ubon.json`) come first because they do not execute third-party code.

### 7.6 Performance targets

| Case | Target |
| --- | --- |
| `npx ubon@4 --version`, cold npm cache | under 2 s (single file, no dependencies to fetch) |
| Process start plus hook decision for a shell command | under 150 ms |
| `ubon check` on a 10-file diff | under 500 ms |
| `ubon check --all` on 2,000 files | under 5 s on a CI runner (worker threads above 500 files) |
| Memory for `--all` on 2,000 files | under 400 MB |

A benchmark job runs on every pull request and fails when a target regresses by more than 20 percent.

## 8. Dependencies, packaging, and release

### 8.1 Runtime

| Decision | Choice | Reason |
| --- | --- | --- |
| Node versions | `"engines": { "node": ">=22.18.0" }`; CI on 22, 24, 26 | Node 20 reached end of life on 2026-04-30. Node 22 is in maintenance until 2027-04-30, 24 is the active LTS, 26 becomes LTS on 2026-10-28. Everything Ubon needs from Node is stable from 22.18: `util.parseArgs`, `util.styleText`, `fs.glob`, `AbortSignal.timeout`. |
| Module format | ESM only, one entry `dist/ubon.mjs`, `exports` map with `.` (API), `./package.json`, `./schema/*` | Current tooling and Node versions expect ESM; a single bundled file removes module resolution cost at startup. |
| Runtime dependencies | none at install time | See section 7; vendored parser and MCP server are pinned in the bundle. |
| Replaced by Node built-ins | `commander` by `util.parseArgs`, `picocolors` by `util.styleText` (respects `NO_COLOR`, `FORCE_COLOR`), `glob` by `fs.glob`, `chokidar` dropped (no watch mode), `update-notifier` dropped | `update-notifier` alone installs 54 packages. Update checks are the package manager's job. |
| Parser | `@babel/parser`, bundled | Pure JavaScript, so it can be bundled into one file that runs anywhere Node runs, including inside the Claude Code plugin and the GitHub Action without an install step. Measured at 16 ms to load and 55 ms for a 155-file app. |

The parser choice was compared with `oxc-parser`, which is faster (21 ms on the same kind of input with its raw-transfer mode, per the research for this plan), ESTree-conformant, and used by knip since its version 6. It was not chosen for 4.0 because it ships native binaries per platform: it cannot be bundled into one file, plugins that install from npm cannot build native modules, and npm's optional platform dependencies are a common source of "cannot find module" failures in CI. The parser sits behind a small internal interface, so switching later touches one module.

### 8.2 Development dependencies

A short list, each justified: `typescript` (type checking only; TypeScript 7's native compiler), `@types/node`, `esbuild` or `tsdown` (bundling; tsdown is the maintained successor to tsup), `@babel/parser` and the MCP server package (bundled into the output), one linter-formatter (Biome or oxlint plus Prettier, decided in M0). Tests use `node:test`, which removes Jest and `ts-jest` (280 packages between them, measured). v3's development install is 529 packages. Target: fewer than 10 direct development dependencies and fewer than 60 packages in total. Every one of them runs on the maintainer's machine and in CI, next to the npm publish credentials, so each one is a supply-chain exposure (the Shai-Hulud worms spread through exactly that path).

Repository hardening for contributors:

- `.npmrc` with `ignore-scripts=true`; the few development dependencies that need install scripts are allowed explicitly.
- Dependabot for npm and GitHub Actions with grouped weekly updates and a cooldown of several days, so new releases have time to be flagged before they are merged.
- A lockfile check in CI (only `registry.npmjs.org`, only HTTPS, integrity hashes present).

### 8.3 What the package contains

```
package.json
README.md
LICENSE
THIRD_PARTY_NOTICES.md       licenses of the vendored libraries
dist/ubon.mjs                CLI, engine, rules, adapters, reporters
dist/mcp.mjs                 MCP server, loaded only by `ubon mcp`
dist/index.d.ts              types for the programmatic API
schema/config.json           JSON Schema for ubon.json
schema/report.json           JSON Schema for --format json
llms.txt                     map of the docs for agents, with the agent protocol in short
```

A CI check runs `npm pack --dry-run --json` and fails when the file list changes without a matching test update or when the unpacked size passes 1 MB. The check also installs the tarball in an empty directory with scripts disabled and runs `ubon --version`, `ubon check`, and `ubon hook claude PreToolUse` with a recorded payload, on Linux, macOS, and Windows.

### 8.4 Release pipeline

v3's release workflow cannot work as written: it runs on Node 22, whose bundled npm (10.9) does not support trusted publishing, and it depends on an `NPM_TOKEN` secret, while npm revoked classic tokens on 2025-12-09, limits granular write tokens to 90 days, and plans to remove direct publishing with 2FA-bypass tokens in January 2027. No published v3 version has a provenance attestation, which indicates they were published from a local machine rather than by that workflow.

The Ubon 4 pipeline:

1. A version tag (`v4.0.0`) pushed by the maintainer, signed.
2. `release.yml` runs on a GitHub-hosted runner, in a protected `release` environment, with Node 24 (npm 11.x) and `permissions: { contents: read, id-token: write }` for the publish job only.
3. The job builds from a clean checkout with no dependency cache (the May 2026 TanStack compromise used a poisoned Actions cache to publish malware with valid provenance), runs the full check suite, compares the committed `dist/ubon.mjs` with a fresh build byte for byte, and generates a CycloneDX SBOM.
4. `npm stage publish` through trusted publishing (OIDC, no token). The staged release waits for the maintainer to approve it with a 2FA challenge on npmjs.com; an OIDC token cannot approve it, so a compromised workflow alone cannot release.
5. After approval, a follow-up job verifies the published version: `npm view ubon@<v> dist.attestations` shows provenance, `npm audit signatures` passes, and `npx ubon@<v> --version` works on all three operating systems.
6. The same job updates the moving `v4` tag for the GitHub Action, the plugin manifests, the MCP registry entry, and creates the GitHub release with notes from the changelog and the SBOM attached.

npm package settings: "Require two-factor authentication and disallow tokens", trusted publisher limited to `luisfer/ubon`, workflow `release.yml`, environment `release`.

Every action in every workflow is pinned by full commit SHA with the version in a comment. Workflow permissions default to `contents: read` at the top level. `zizmor` runs on the workflows in CI. The OpenSSF Scorecard action runs weekly and its badge is the only badge in the README besides the npm version.

### 8.5 Versioning and support

- Semantic versioning for the CLI flags, exit codes, `ubon.json` schema, JSON report schema, hook behavior, and the programmatic API.
- Rules are not part of the semver contract in the same way: a new `warn` rule can arrive in a minor release; a new `block` rule arrives in a minor release only after it passed the precision gate, and the release notes list it first so CI users can prepare. Rule IDs are never reused.
- Supported: the latest minor of the current major. Security fixes for the previous major for six months after a new major.
- `CHANGELOG.md` in Keep a Changelog format, written by hand, in the style of [writing-style.md](writing-style.md).

## 9. Documentation

Ubon's documentation has two audiences with the same needs: people who want to know what to run and what it will do, and agents that need exact commands, exact output shapes, and exact rules for what to do with a finding. Both are served by short pages that lead with the command and show real output. Neither is served by adjectives.

### 9.1 Writing rules

[writing-style.md](writing-style.md) is the full guide. It becomes `docs/style.md` in the new tree and applies to the README, docs, skills and playbooks, rule messages, CLI output, the changelog, commit messages, and release notes. The short version:

- Lead with what to run, then what happens. Show real output from the fixtures.
- One idea per sentence. Numbers instead of adjectives. Sentence-case headings.
- State limits in the same place as capabilities.
- Avoid em dashes and en dashes used as dashes, curly quotes, emoji, marketing vocabulary, and the sentence patterns in the banned list (for example `it's not X, it's Y`, `whether you're X or Y`, reflexive groups of three, closing summaries).

`scripts/lint-prose.mjs` enforces the mechanically detectable part in CI on every Markdown file, every `SKILL.md` and playbook, and every user-facing string in the rule metadata and CLI. Code blocks and inline code are skipped. A prototype of this linter was used on this plan.

### 9.2 Pages

The set follows the Diátaxis split (tutorial, how-to, reference, explanation) without naming it in the navigation:

| Page | Type | Content |
| --- | --- | --- |
| `README.md` | overview | What Ubon does in two sentences, a 20-second demo, install per agent, what it checks (one line per pack), what it does not do, links. Under 200 lines. |
| `docs/getting-started.md` | tutorial | Install Ubon and watch it block an agent's Stop in a fixture app: five commands, with the output of each. |
| `docs/agents.md` | reference for agents | The protocol an agent follows: when to run what, how to read each output format, how to fix or suppress, what never to do (edit `ubon.json`, remove hooks, suppress without a truthful reason, edit tests to pass). Written in the second person to the agent. Mirrored in the skill. |
| `docs/integrations/<agent>.md` | how-to | One page per agent, generated in part from the adapter specs: install, what each hook does, known limits, how to verify it fires (`ubon doctor`). |
| `docs/rules/<pack>/<name>.md` | reference | Generated from rule metadata and fixtures: what, why, flagged examples, safe examples, fix, suppression, references. |
| `docs/config.md` | reference | Every `ubon.json` key with type, default, example. Generated from the JSON Schema plus hand-written notes. |
| `docs/output.md` | reference | Every format with an example; JSON schema; exit codes; fingerprints. |
| `docs/ci.md` | how-to | GitHub Action, other CI systems, SARIF, baselines for existing projects. |
| `docs/mcp.md` | how-to | Client configs, tools, what the server never does. |
| `docs/security.md` | explanation | Threat model for Ubon itself, what it sends where (nothing, unless online), how releases are built and verified. |
| `docs/how-it-works.md` | explanation | Scope, contexts, sessions, why diff-first, why no model calls, why some rules only warn. |
| `docs/precision.md` | reference, generated | Corpus results per rule. |
| `docs/evals.md` | reference | Agent evaluation results with method and raw numbers. |
| `docs/compatibility.md` | reference | Agent versions verified, Node versions, operating systems. |
| `docs/history.md` | explanation | v1 to v3 in one paragraph each, and why 4 is a rewrite. |
| `AGENTS.md` | for contributors (human or agent) | How to build, test, add a rule (fixture first), regenerate integrations, and what CI checks. `CLAUDE.md` contains only `@AGENTS.md`. |
| `llms.txt`, `llms-full.txt` | index for models | Generated: a short map of the docs with one-line descriptions, and the full text concatenated. Published in the package and at the repository root. |

### 9.3 Docs that cannot drift

- Every fenced command in the docs and skills that starts with `ubon` is parsed and checked against the CLI's command and flag definitions.
- Code blocks marked `<!-- ubon:example fixture=next-supabase-saas -->` are executed against the named fixture and their output compared with the block.
- Counts in the README ("N rules", "N agents") are computed from the source; the build fails when the text disagrees (impeccable's build does the same).
- Internal links are checked offline. External links are checked weekly, never in the per-commit build.

### 9.4 The README, drafted

[readme-draft.md](readme-draft.md) is a first draft of the new README, written to these rules. It will change as the product settles; the structure and the style will not. It leads with what Ubon does and a real output sample, gives one install line per agent, lists what Ubon checks in a table, and states what it does not do before any configuration details.

## 10. Testing, examples, and evidence

v3 had 230 passing tests and none of them caught the bugs in section 2, because they called internal functions with inline strings. Ubon 4 tests the surfaces people and agents use: the CLI binary, the hook command with real payloads, the MCP protocol, the published tarball.

### 10.1 Test layers

| Layer | What it proves | Tooling |
| --- | --- | --- |
| Rule fixtures | Each rule flags what it should and nothing else. Every rule needs at least 4 flagged cases and 5 known-safe shapes (the safe shapes are where v3 failed). | `node:test`, a small RuleTester reading `// expect: <rule>` and `// ok: <reason>` comments |
| Fixture apps | Rules work together on realistic projects; each app has a fixed twin that must produce zero `block` findings. | CLI binary against `fixtures/apps/*` |
| Git scenarios | Scope is right: untracked files, staged-only changes, renames, deletions, detached HEAD, shallow clones, monorepos, no git at all, paths with spaces and non-ASCII characters, CRLF files. | Temporary repos built by the test |
| Recorded sessions | Hooks behave correctly for each agent, event by event, on payloads recorded from the real agents. | `fixtures/sessions/<agent>/<scenario>.jsonl` replayed through `ubon hook <agent> <event>` |
| Generated integrations | Every generated hook config and plugin manifest validates against the agent's schema, and the committed copies match a fresh build. | JSON Schema checks, `git diff --exit-code` after the generator |
| MCP protocol | Handshake, tool listing, tool calls, errors, path containment, and masking over a real stdio connection. | Spawned `ubon mcp` plus the MCP Inspector CLI |
| Output contracts | JSON matches its schema, SARIF validates against SARIF 2.1.0, text and agent formats match golden files byte for byte. | Golden files, reviewed by hand when they change, never regenerated to make a test pass |
| Masking | No output format, cache, log, or MCP response ever contains a raw secret. | Property test: generated keys of every provider format embedded in generated code, every format checked |
| Malformed input | No crash and bounded time on malformed code, binary files, 50 MB files, deep nesting, pathological regex inputs, symlink loops, unreadable files. | Fuzz corpus plus a per-file time budget |
| Packaging | The published tarball installs with scripts disabled and runs on Linux, macOS, and Windows with Node 22, 24, and 26. File list and size stay within budget. | `npm pack`, install into a temporary directory, run `ubon --version`, `ubon check`, `ubon hook` |
| Docs | Every command in the docs and skills exists with those flags; every tagged example produces the output shown; the prose lint passes. | Scripts in `scripts/`, run in CI |
| Performance | The targets in section 7.6 hold. | Benchmark job with thresholds |

### 10.2 Fixture apps (the real-life examples)

Each app is small (10 to 40 files), realistic, and runnable. Each has `EXPECTED.json` listing every planted problem with its rule, file, and line, and a `fixed/` twin with the problems corrected. They double as the examples in the README and the docs, so the examples are tested by definition.

| App | Stack | Planted problems |
| --- | --- | --- |
| `next-supabase-saas` | Next.js App Router, Supabase, Stripe | service role key in a client component, table without RLS in a migration, `NEXT_PUBLIC_STRIPE_SECRET_KEY`, unverified Stripe webhook, open redirect in the login callback, SSRF in an OG image route |
| `vite-supabase-spa` | Vite, React, Supabase (the shape Lovable exports) | permissive insert policy, public storage bucket with a write policy, `VITE_OPENAI_API_KEY` with `dangerouslyAllowBrowser: true`; the anon key in client code is present and correctly not reported |
| `ai-chat-tools` | Next.js, Vercel AI SDK with tools | a tool that runs shell commands with model arguments, model output passed to `eval`, request data in the system prompt, a public chat route with no auth, rate limit, or token cap |
| `hono-workers-api` | Hono on Cloudflare Workers, Drizzle | `sql.raw()` with a query parameter (the safe `sql` template next to it is not reported), credentialed CORS wildcard, `jwt.decode` used for authorization, `Math.random()` invite codes |
| `express-legacy` | Express, pg | path traversal in a download route, `exec` with a query parameter, `md5` password hashing, session cookie without `httpOnly` |
| `sveltekit-blog` | SvelteKit | `{@html}` of a form field, form action without auth that writes to the database |
| `agent-config` | no app; agent files only | hidden Unicode tag characters in `AGENTS.md`, `curl ... \| sh` in a skill script, a literal token in `.mcp.json`, an unpinned `npx -y` MCP server, `bypassPermissions` in committed settings, a misspelled hook event |

### 10.3 Recorded sessions

A scenario is a sequence of hook payloads plus the file changes between them, recorded from a real session and trimmed. Example, `fixtures/sessions/claude-code/ssrf-then-fix.jsonl`:

1. `SessionStart`: Ubon records the base.
2. `PreToolUse` Write of `app/api/preview/route.ts` with a request-derived `fetch`: allowed (the file check happens after the write).
3. `PostToolUse` for that write: Ubon returns the `web/ssrf` finding to the agent.
4. `Stop`: blocked, with the finding in the reason.
5. `PostToolUse` Edit that adds a host allowlist: no finding.
6. `Stop`: allowed.

The same scenario exists for every supported agent. When an agent changes its payload format, recording the scenario again shows the difference in review. Recording uses the `--record <file>` flag of `ubon hook`, which appends each payload with secrets masked.

Other scenarios: `rm -rf ~/` asked, `npm install` of a nonexistent package denied, `git commit --no-verify` denied, `.skip` added to a test then Stop blocked, a key pasted in a prompt blocked, `.env` read asked, an agent editing `.claude/settings.json` to remove Ubon's hooks asked and then reported at Stop.

### 10.4 Corpus and published precision

`corpus/repos.json` pins about 25 public repositories by commit: reference apps (`vercel/ai-chatbot`), mature products (`documenso`, `dub`, `formbricks`, parts of `cal.com`), templates (`create-t3-app` output, Supabase examples), and a sample of public apps exported from Lovable, Bolt, and v0 (found through markers such as the `lovable-tagger` dev dependency). Intentionally vulnerable apps (OWASP Juice Shop, NodeGoat) measure recall.

A scheduled job runs `ubon check --all` on each, and every finding is triaged in `corpus/triage.jsonl` as a true or false positive with a one-line note. Any untriaged finding fails the job. `docs/precision.md` is generated from the triage file: findings, true positives, and precision per rule. The README links to it instead of making claims.

### 10.5 Agent evaluations

`scripts/eval-agents.mjs` runs real agents in headless mode (Claude Code with `claude -p`, Codex with `codex exec`, Gemini CLI) on tasks in the fixture apps (for example, "add a link preview endpoint"), with and without Ubon installed, several runs each. It records how many `block`-level problems remain in the final diff, how often the agent edited tests, and how long the task took. It needs API keys, costs money, and is run by the maintainer before releases, not in CI. Results go into `docs/evals.md` as they are.

### 10.6 Demo

`npm run demo` replays a recorded Claude Code session against a copy of `next-supabase-saas` in the terminal and shows each hook decision as it happens. It needs no API key and no network. The README screenshot and recording come from it, so the demo cannot drift from the product.

## 11. Security of Ubon itself

Ubon reads untrusted input by design: the repositories it scans (including pull requests from strangers in CI) and hook payloads that a prompt-injected agent may have shaped. The threat model is written down in `docs/security.md` and each mitigation below has a test.

| Threat | Mitigation |
| --- | --- |
| A scanned repo makes Ubon execute code | Config is JSON only. Ubon never `require`s or `import`s project files and never runs project scripts. Git runs with `-c core.fsmonitor=false` and, for diffs, `--no-ext-diff --no-textconv`, so repository or user git config cannot make Ubon run a command. |
| Command injection through file names, refs, or payloads | Every child process uses `execFile` with an argument array and `--` before paths. Refs are validated with `git check-ref-format`. No shell strings anywhere. |
| Secrets leak through Ubon's output | Masking at finding creation, one shared code path for all outputs, property tests (section 10.1). Recorded sessions mask secrets before writing. |
| Resource exhaustion | File size cap (1 MB default, configurable), per-file time budget, stdin cap for hooks, linear-time regular expressions tested with adversarial inputs, bounded AST depth. |
| Path traversal and symlink escapes | Paths resolved and checked against the repository root or MCP roots; symlinks are not followed outside the root. |
| Network surprises | No network unless `--online` or `packages.online`. Only the configured npm registry and `api.osv.dev` are contacted. Proxies respected (`HTTPS_PROXY`, `NODE_EXTRA_CA_CERTS`), failures reported as "not checked", never as clean. |
| Writes to the user's project | Only `init --yes`, `baseline`, and explicit output files write inside the project. Session state and cache live in the git directory or the user cache directory. |
| Ubon's own supply chain | No install-time dependencies, vendored libraries pinned and license-checked, trusted publishing with provenance, pinned actions, protected release environment (section 8). |
| An agent disables Ubon | Edits to Ubon's config and to agent hook config are asked (`agent/protected-path-write`), removals are reported (`agent/guardrail-removed`), CI runs independently of the agent. |
| Ubon crashes during an agent session | Hooks fail open with a visible message; CI fails closed. |

`SECURITY.md` gives a private reporting address, supported versions, and a response time. Security fixes are released from the main branch only.

## 12. Staying relevant as models improve

The question behind this plan is what a deterministic checker is for when the model writing the code is very capable. The answer shapes what Ubon checks and what it leaves alone.

Some things stop mattering. Rules about idioms that models learn and frameworks enforce: React key props, hook ordering, `'use client'` placement, Next.js config shapes. Linters and compilers do this, and models rarely get it wrong now. Ubon 4 drops these (see [rules.md](rules.md#rules-removed-from-v3-and-what-to-use-instead)).

Other things keep mattering:

1. Separation of duties. A capable author still should not certify its own work. Ubon is a checker the agent cannot talk into a different answer, with the same result every time, for every agent.
2. Context the model does not have. Whether a table is exposed, whether a key is a service role key, whether a route is public: these are facts about the project that the code alone does not show. Ubon reads migrations, env files, lockfiles, and config that the model often never opens.
3. Incentives. Reward hacking (editing tests, skipping checks, suppressing warnings) grows with capability. The `integrity` pack makes those moves visible regardless of how good the model is.
4. A hostile environment. Slopsquatted packages, compromised releases, poisoned skills, and prompt injection in fetched content do not depend on model quality. A good model that installs a two-hour-old package is still installing it.
5. Cost and speed. A deterministic check costs nothing and takes milliseconds, so it can run on every edit and every command. A model review costs tokens and minutes and runs once.
6. Accountability. When an agent opens a pull request, reviewers need a record of what was checked and what was waved through (suppressions, unresolved findings). Ubon writes that record.

How the design keeps up:

- Rules target invariants (a service role key must not reach the browser) instead of patterns tied to one framework version, so they age slowly.
- Everything that changes quickly is data: provider key formats, agent event names, command policies, popular package names. Updating them is a reviewed data change, not a code change.
- Adapters isolate agent formats. A payload change breaks one adapter and one set of recorded sessions, visibly, instead of failing silently the way v3's Cursor hook did.
- Skills carry the parts that should evolve with models (how to review, how to finish work) and can be rewritten without touching the engine.
- `ubon map` hands the model an exhaustive inventory, so as models get better at judgment, Ubon's contribution (completeness and facts) becomes more useful.
- A yearly review retires rules that no longer find anything on the corpus or in agent evaluations.

## 13. What the rewrite deletes

The maintainer asked for a fresh start inside the same repository. The history stays; the tree is replaced.

1. Keep v3 reachable: the `v3.2.3` tag already exists; also create a `legacy/v3` branch from `main` before the rewrite lands.
2. On the rewrite branch, delete everything except `LICENSE` and `.git`: `src/`, `vscode-extension/`, `branding/` (including `lovable.svg`), `examples/`, `docs/`, `scripts/`, `MIGRATION-v3.md`, `CHANGELOG.md` (the history moves to `docs/history.md` with a short summary per major version), `.cursor/`, `ubon.config.json`, Jest and ESLint configs, `.npmignore`, `package-lock.json`.
3. Close the 10 open Dependabot pull requests with a comment pointing to the rewrite; none of those dependencies survive.
4. Update the GitHub repository: description, topics (remove `python`, add `claude-code`, `codex`, `agent-skills`, `hooks`, `mcp`, `supply-chain`), homepage.
5. Carry over knowledge, not code: provider key formats (re-verified with fixtures), agent config file lists, the fixture ideas, the bug list in section 2 as regression tests.
6. The Lovable profile, the `LOVABLE*` rule names, the posture score, interactive mode, the LSP server, the VS Code extension, link checking, the Puppeteer crawler, watch mode, `--create-pr`, presets, profiles, the Homebrew formula, and emoji output do not come back.
7. On npm, after 4.0.0 is published: deprecate `ubon@<3` immediately and `ubon@3` after 60 days, with a message that points to the upgrade notes.

## 14. Roadmap

Milestones are ordered by dependency. Each ends with exit criteria that can be checked, and nothing moves to the next milestone with a failing criterion. Sizes are rough and assume one maintainer working with coding agents.

### M0. Reset (small)

- Create `legacy/v3`, start the rewrite branch, delete the v3 tree (section 13).
- Skeleton: `package.json` with zero dependencies, TypeScript config, build to one ESM file, `node:test` runner, lint and format.
- CI on Linux, macOS, Windows with Node 22, 24, 26: lint, type check, test, pack check, prose lint.
- Release pipeline with npm trusted publishing and a protected `release` environment, tested by publishing `4.0.0-alpha.0` under the `next` tag.
- `AGENTS.md` and `CLAUDE.md` for contributors, `docs/style.md` from [writing-style.md](writing-style.md).

Exit: an empty `ubon --version` installs from npm with a provenance attestation, on all three operating systems.

### M1. Engine (large)

- Scope resolution with all git scenarios from section 10.1, config loading and validation, file contexts including the client module graph, parser wrapper, findings, masking, fingerprints, suppressions, baseline, and the five output formats.
- First rules: `secret/*` (file rules), `agent/hidden-unicode`, `agent/pipe-to-shell`, `agent/secret-in-config`, `web/sql-injection`, `web/ssrf`, `web/command-injection`, `data/rls-disabled`, `data/service-role-in-client`.
- RuleTester and fixture format; corpus runner and triage file; first precision report.

Exit: `ubon check` and `ubon check --all` pass the git scenario suite; every shipped rule has its fixtures; the corpus has zero untriaged findings; `vercel/ai-chatbot` produces no `block` findings unless a triaged true positive says otherwise.

### M2. Agent loop (large)

- Hook runtime, session state, loop guard, command tokenizer and command checks, path checks, write-content checks.
- Adapters and generated integrations for Claude Code (plugin and settings), Codex, Cursor, then Gemini CLI and GitHub Copilot as far as their hook support allows (details in [integrations.md](integrations.md)).
- Git hooks (`pre-commit` on staged content), the pre-commit framework manifest, the GitHub Action with SARIF upload and a job summary.
- MCP server.
- Recorded sessions for every adapter; `ubon doctor` reporting hook activity from the session log.

Exit: every recorded scenario passes for every adapter; generated configs validate; a manual run of each agent confirms the hooks fire (recorded in `docs/compatibility.md` with agent versions).

### M3. Coverage (medium)

- The remaining 4.0 rules in [rules.md](rules.md): `web`, `data`, `llm`, `deps` (offline, plus `ubon vet` online), `agent` command checks, `integrity`, `hygiene`.
- `ubon map` in JSON and Markdown.
- `ubon init` with agent detection and `auth` proposals.

Exit: every 4.0 rule meets the precision gate or ships at `warn`; each fixture app's `EXPECTED.json` matches exactly and each fixed twin is clean.

### M4. Proof and beta (medium)

- Skills and playbooks, generated for each agent; static and trigger tests.
- Documentation (section 9), generated rule pages, `llms.txt`, precision report, compatibility matrix.
- Demo and README recording.
- Agent evaluations, published.
- `4.0.0-beta.1` under the `next` tag. Ask 5 to 10 people who build with agents to use it for two weeks; fix what they hit.

Exit: no open bug labelled `beta-blocker`; docs checks pass; evaluation results published.

### M5. 4.0.0 (small)

- Publish `4.0.0` as `latest`, GitHub release with notes, plugin marketplace entry live, `npx skills add luisfer/ubon` verified, Codex and Copilot install paths verified.
- Deprecate old versions on npm (section 13).
- Announcement post: what changed and why, with the precision and evaluation numbers.

### 4.1 (after 4.0)

- Done gate: `"done": ["npm test", "npm run typecheck"]` in `ubon.json`; the Stop hook checks from the session log that each command ran and passed after the last edit, and asks the agent to run it otherwise.
- Receipts: `ubon receipt` writes a JSON and Markdown record of a change (checks run and their results, findings fixed, findings suppressed and by whom, tests changed), for pull request descriptions or git notes.
- 4.1 rules from [rules.md](rules.md), the `prose` pack, `deps/known-vulnerable`.
- Package vetting for Python installs (`pip`, `uv`) in hooks.
- Agents added or upgraded as their hook support matures.

### 4.2 and later (to be decided with 4.1 feedback)

- Agent Trace export and import, so receipts can say which lines an agent wrote.
- Declarative custom checks in `ubon.json`.
- Organization policy files shared across repositories.
- An ESLint plugin that exposes Ubon's per-file rules in editors, if users ask for editor feedback.

## 15. Success measures

| Measure | Target for 4.0 |
| --- | --- |
| Precision of every `block` rule on the corpus | at least 95 percent, published |
| `block` findings on the fixed twins of the fixture apps | 0 |
| Planted problems found in the fixture apps | 100 percent of `EXPECTED.json` |
| Install-time dependencies | 0 |
| Unpacked package size | under 1 MB |
| Cold `npx ubon@4 --version` | under 2 s |
| Hook decision for a shell command | under 150 ms |
| Stop check on a 50-file session | under 3 s |
| Supported agents with passing recorded sessions | Claude Code, Codex, Cursor at 4.0; Gemini CLI and Copilot as soon as their hooks allow |
| Agent evaluations | fewer `block`-level problems left in final diffs with Ubon than without, on every task, reported with raw numbers |
| Docs | every command example tested; prose lint clean; every README claim linked to a test, fixture, or measurement |

Adoption numbers (stars, downloads) are not targets. They follow from the measures above or they do not.

## 16. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Agent hook formats change without notice | High | Adapters isolated, recorded sessions per agent version, `ubon doctor` checks installed configs, hooks fail open. |
| Heuristic rules produce noise and people uninstall | Medium | Precision gate, `warn` for anything below it, one config line to turn a rule off, published triage. |
| Scope grows back to v3's size | Medium | Ten commands, a written list of non-goals (section 4), milestone exit criteria, rules must earn their place on the corpus. |
| Users read "no findings" as "secure" | Medium | Every report states what was not checked; the README has a "What Ubon does not do" section near the top. |
| Command checks are bypassed by a determined or injected agent | High | Documented as a second line of defense; the docs point to agent sandboxes and containers for containment. |
| Online checks fail behind corporate proxies | Medium | Offline by default, proxy support, "not checked" reported explicitly. This sandbox itself blocks `api.npmjs.org`, which is why download counts are not used in any `block` rule. |
| A single maintainer cannot keep up with five agents | Medium | Claude Code, Codex, and Cursor first; Gemini CLI and Copilot through the same adapter layer; community adapters accepted with recorded sessions as the entry requirement. |
| Overlap with other tools (Anthropic's security plugins, Trail of Bits skills, SkillSpector, Socket) | Medium | Stay deterministic, cross-agent, zero-dependency, and diff-aware; document how Ubon runs next to each of them. |

## 17. Decisions needed from the maintainer

These change the plan. The recommendation comes first in each row.

| # | Decision | Recommended | Alternative | Why the recommendation |
| --- | --- | --- | --- | --- |
| 1 | Positioning | "Ubon checks the work of coding agents" | Keep "security scanner for AI-generated apps" | Matches where the checks run and what they cover; the old line undersells the agent loop and oversells completeness. |
| 2 | Minimum Node version | 22.18 | 24 only | Node 22 is maintained until April 2027 and many CI images still use it. |
| 3 | Stop behavior by default | `block`, with the loop guard | `warn` until the user opts in | Blocking at Stop is the point of the tool; the loop guard prevents a stuck agent. |
| 4 | Prompts containing keys | Block | Warn | A key sent to a model provider cannot be recalled. |
| 5 | Suppressions added by agents | Allow, and list every one | `human-only` | Listing is enough for most teams; strict teams can switch. |
| 6 | Agents at 4.0 | Claude Code, Codex, Cursor, git hooks, GitHub Action | Also Gemini CLI and Copilot | Ship the three most used agents well; add the other two when their recorded sessions pass. |
| 7 | MCP in the Claude Code plugin | Off by default | On | The CLI is on the agent's PATH already, and tool definitions cost context on every turn. |
| 8 | Built file in the repository | Commit `dist/ubon.mjs` on release tags, verified against a fresh build | Install from npm at run time | The GitHub Action and the plugin then run with no install step and no network. |
| 9 | npm deprecation | v1 and v2 at 4.0.0, v3 after 60 days | All at once | Gives v3 users time to move. |
| 10 | Name and lotus | Keep the name; drop the lotus emoji from output and headings; one sentence about the name in the README | Rename | The name is short, the npm name is taken by you, and the emoji is noise in agent output. |
