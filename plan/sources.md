# Sources

References for the claims in this plan, grouped by topic. Measurements marked "measured" were taken for this plan on 2026-09-26 in a Linux sandbox with Node 22.22.2 and npm 10.9.7; the commands are described where the numbers appear. Some documentation sites were blocked by the sandbox's network policy; in those cases the facts come from the documentation's source repositories or from the vendor's source code, as noted.

Back to the main plan: [README.md](README.md).

## Ubon v3 measurements (measured)

- Build, tests (230 passing), `npm audit --omit=dev` (8 advisories), package counts (168 production, 529 total), and install size: run in this repository at commit `c0d9480`.
- `npx --yes ubon@3.2.3 --version`: 7.2 s and 128 MB npm cache cold, 0.74 s warm.
- Provenance: `npm view ubon@<version> dist --json` for 3.0.0, 3.1.0, 3.2.0, 3.2.3 (no `attestations` field).
- False positives: `ubon check --fast` and `--detailed` on `vercel/ai-chatbot` (shallow clone of the default branch on 2026-09-26).
- Parser timings: `@babel/parser` 7.29.9, `oxc-parser` 0.151.0, `typescript` 5.9.3 on the same 155 files; bundled size of `@babel/parser` with esbuild 0.28.2.
- Hook launch overhead: `node <file>` 33 ms, bin shim 35 ms, `npx --no-install` 287 ms, averaged over 10 calls.
- Package counts: `@modelcontextprotocol/sdk` 1.30.1 installs 94 packages (29 MB), `update-notifier` 7.3.1 installs 54, `jest` 29 with `ts-jest` 280.

## AI-written code

- Veracode, 2025 GenAI Code Security Report: https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/
- Zhong et al., ImpossibleBench: Measuring LLMs' Propensity of Exploiting Test Cases (2025): https://arxiv.org/abs/2510.20270
- Spracklen et al., We Have a Package for You! A Comprehensive Analysis of Package Hallucinations by Code Generating LLMs, USENIX Security 2025: https://arxiv.org/abs/2406.10279
- GitClear, AI code quality research (2026): https://www.gitclear.com/the_ai_code_quality_maintainability_gap
- Escape, state of security of vibe-coded apps: https://escape.tech/state-of-security-of-vibe-coded-apps

## Incidents

- Lovable apps and missing row level security, CVE-2025-48757 (May 2025): https://mattpalmer.io/posts/2025/05/CVE-2025-48757/
- Moltbook database exposure (January to February 2026), Wiz: https://www.wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys
- tj-actions/changed-files compromise (March 2025), CISA: https://www.cisa.gov/news-events/alerts/2025/03/18/supply-chain-compromise-third-party-tj-actionschanged-files-cve-2025-30066-and-reviewdogaction
- s1ngularity, the Nx compromise that used AI coding CLIs (August 2025): https://github.com/nrwl/nx/security/advisories/GHSA-cxm3-wv7p-598c and https://nx.dev/blog/s1ngularity-postmortem
- chalk and debug maintainer phishing (September 2025), Sygnia: https://www.sygnia.co/threat-reports-and-advisories/npm-supply-chain-attack-september-2025/
- Shai-Hulud (September 2025), CISA: https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
- Shai-Hulud 2.0 (November 2025), Datadog: https://securitylabs.datadoghq.com/articles/shai-hulud-2.0-npm-worm/
- Hallucinated `npx` commands spreading through agent skills (January 2026), Aikido: https://www.aikido.dev/blog/agent-skills-spreading-hallucinated-npx-commands
- ClawHavoc, malicious skills on ClawHub (February 2026), Koi Security: https://www.koi.ai/blog/clawhavoc-341-malicious-clawedbot-skills-found-by-the-bot-they-were-targeting and The Hacker News: https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html
- axios compromise (March 2026), post-mortem: https://github.com/axios/axios/issues/10636
- TanStack compromise with valid provenance (May 2026), Snyk: https://snyk.io/blog/tanstack-npm-packages-compromised/
- ChainDrop worm and persistence through `.claude/settings.json` hooks (August 2026), Datadog: https://securitylabs.datadoghq.com/articles/npm-worm-compromises-popular-npm-packages/ and StepSecurity: https://www.stepsecurity.io/blog/chaindrop-npm-worm
- WEL1DROPPER slopsquatting wave (August 2026), The Hacker News: https://thehackernews.com/2026/08/nearly-800-malicious-npm-packages.html
- Rules File Backdoor, hidden Unicode in agent rules files (March 2025), Pillar Security: https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents
- Trojan Source, CVE-2021-42574: https://trojansource.codes/

## npm, Node.js, and toolchain

- Node.js release schedule: https://raw.githubusercontent.com/nodejs/Release/main/schedule.json
- Node.js release schedule change from Node 27: https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule
- Node.js API docs for `util.parseArgs`, `util.styleText`, `fs.glob`: https://nodejs.org/api/util.html and https://nodejs.org/api/fs.html
- npm trusted publishing GA (July 2025): https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
- npm token and 2FA changes (November 2025): https://github.com/orgs/community/discussions/178140
- Classic token revocation (December 2025): https://github.com/orgs/community/discussions/179562
- npm 11.10 (`min-release-age`, `npm trust`): https://github.com/orgs/community/discussions/187403
- Staged publishing GA (May 2026): https://github.com/orgs/community/discussions/196675
- npm 12 (install scripts opt-in, July 2026): https://github.com/orgs/community/discussions/198547
- pnpm `trustPolicy: no-downgrade`: https://pnpm.io/blog/releases/10.21 and pnpm 11 defaults: https://pnpm.io/blog/releases/11.0
- OpenSSF malicious packages database: https://github.com/ossf/malicious-packages
- TypeScript 7.1 iteration plan (API stabilization): https://github.com/microsoft/TypeScript/issues/63703
- knip 6 moving to oxc-parser: https://knip.dev/blog/knip-v6
- Semgrep Rules License: https://semgrep.dev/legal/rules-license/
- gitleaks: https://github.com/gitleaks/gitleaks and Betterleaks: https://www.aikido.dev/blog/betterleaks-gitleaks-successor
- lockfile-lint: https://github.com/lirantal/lockfile-lint
- OpenSSF Scorecard: https://github.com/ossf/scorecard
- zizmor: https://github.com/zizmorcore/zizmor

## Agents and their extension points

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code plugins and marketplaces: https://code.claude.com/docs/en/plugins/marketplace-reference
- Claude Code skills: https://code.claude.com/docs/en/skills
- Claude Code memory and `AGENTS.md`: https://code.claude.com/docs/en/memory
- Claude Code security guidance plugin: https://code.claude.com/docs/en/security-guidance
- Codex source (hooks, skills, plugins): https://github.com/openai/codex
- Cursor hooks reference: https://cursor.com/docs/reference/hooks (not reachable from the sandbox; behavior taken from live runs recorded in https://github.com/griddynamics/rosetta)
- Cursor plugins specification: https://github.com/cursor/plugins
- Gemini CLI hooks and extensions docs: https://github.com/google-gemini/gemini-cli/tree/main/docs
- GitHub Copilot hooks reference: https://docs.github.com/en/copilot/reference/hooks-reference (read from https://github.com/github/docs)
- VS Code agent hooks: https://github.com/microsoft/vscode-docs
- AGENTS.md: https://agents.md
- Agent Skills specification: https://agentskills.io/specification and https://github.com/agentskills/agentskills
- Agent Plugins specification: https://github.com/agentplugins/agent-plugins-spec
- `npx skills` installer: https://github.com/vercel-labs/skills
- MCP specification 2026-07-28 changelog: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/changelog.mdx
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- MCP registry: https://registry.modelcontextprotocol.io
- OWASP MCP Top 10: https://owasp.org/www-project-mcp-top-10/
- Agent Trace: https://agent-trace.dev/ and InfoQ coverage: https://www.infoq.com/news/2026/02/agent-trace-cursor/

## Standards

- OWASP Top 10:2025: https://owasp.org/Top10/2025/
- OWASP Top 10 for LLM Applications 2025: https://genai.owasp.org/llm-top-10/
- OWASP Top 10 for Agentic Applications 2026: https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/
- CWE: https://cwe.mitre.org/

## Projects that informed the design

- impeccable, design skills with a deterministic detector: https://github.com/pbakaus/impeccable
- obra/superpowers: https://github.com/obra/superpowers
- anthropics/skills: https://github.com/anthropics/skills
- Anthropic's Claude Code security review action: https://github.com/anthropics/claude-code-security-review
- Trail of Bits skills: https://github.com/trailofbits/skills
- OpenAI plugins (including Codex Security skills): https://github.com/openai/plugins
- addyosmani/agent-skills: https://github.com/addyosmani/agent-skills
- vercel-labs/agent-skills: https://github.com/vercel-labs/agent-skills
- Vercel deepsec: https://github.com/vercel-labs/deepsec
- Sentry warden: https://github.com/getsentry/warden
- dmmulroy/anti-slop: https://github.com/dmmulroy/anti-slop
- NVIDIA SkillSpector: https://github.com/NVIDIA/SkillSpector
- tdd-guard: https://github.com/nizos/tdd-guard

## Writing

See [writing-style.md](writing-style.md), which cites its own sources.
