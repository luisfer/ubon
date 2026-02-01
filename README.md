# 🪷 Ubon

<p align="center">
  <img src="branding/Ubon.png" alt="Ubon — Peace of mind for vibe‑coded apps" width="100%" />
</p>

> **TL;DR**
>
> Fed up with "You're absolutely right!" when debugging vibe‑coded apps with AI?
>
> ```bash
> npm i -g ubon@latest
> ubon scan --interactive  # Guided issue walkthrough
> ```
>
> 🪷 Peace of mind for vibe‑coded apps.

[![npm version](https://badge.fury.io/js/ubon.svg)](https://badge.fury.io/js/ubon)
[![npm downloads](https://img.shields.io/npm/dm/ubon.svg)](https://npmjs.com/package/ubon)
[![Test Coverage](https://img.shields.io/badge/coverage-70%25-green.svg)](./coverage)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Contents

- [What is Ubon?](#what-is-ubon)
- [How Ubon Compares](#how-ubon-compares)
- [The Problem](#the-reality-of-debugging-ai-generated-code)
- [About](#about-me-and-ubon)
- [Quick Start](#quick-start)
- [What's New in v2.0.0](#whats-new-in-v200)
- [Commands](#commands)
- [Configuration](#configuration)
- [Documentation](#documentation)

## What is Ubon?

**Ubon is a security scanner designed for AI-generated code.** It catches the issues that traditional linters miss: hardcoded secrets, accessibility failures, broken links, and those subtle vulnerabilities that only surface in production.

Ubon is a fast static analysis tool for modern, AI‑generated "vibe‑coded" apps. It finds real, shippable issues—secrets, insecure cookies/redirects, accessibility problems, broken links, and config mistakes—and explains how to fix them with file:line context.

Use the colorized triage in the terminal or JSON/SARIF for CI and AI. Profiles cover Next.js/React, Python, and Rails (experimental). See profiles in `docs/PROFILES.md` and the full capability matrix in `docs/FEATURES.md`.

### At a glance

- Security, accessibility, links, and config checks across Next.js/React, Python, Vue, and Rails (experimental)
- Human-friendly triage: grouping, color, context, explanations, confidence scores
- Baselines and inline suppressions for low-noise adoption
- JSON and SARIF outputs for CI and AI; OSV caching for speed
- Safe autofixes and optional PR creation; watch mode and changed-files gates

## How Ubon Compares

| Feature | Ubon 🪷 | ESLint | npm audit | Lovable Scanner |
|---------|---------|--------|-----------|-----------------|
| **Hardcoded Secrets** | ✅ High accuracy | ❌ No | ❌ No | ⚠️ Basic patterns |
| **Supabase RLS Validation** | ✅ Deep analysis | ❌ No | ❌ No | ⚠️ Shallow check |
| **Vite Security** | ✅ Specialized | ❌ No | ❌ No | ❌ No |
| **Accessibility (a11y)** | ✅ Comprehensive | ⚠️ Plugin only | ❌ No | ❌ No |
| **AI-Generated Code Issues** | ✅ Purpose-built | ❌ No | ❌ No | ⚠️ Limited |
| **Link Validation** | ✅ External + Internal | ❌ No | ❌ No | ❌ No |
| **Placeholder Detection** | ✅ DEV001-005 | ❌ No | ❌ No | ❌ No |
| **Auto-Fix** | ✅ Safe fixes | ⚠️ Some rules | ❌ No | ❌ No |
| **Interactive Mode** | ✅ Guided debugging | ❌ No | ❌ No | ❌ No |
| **CI/CD Integration** | ✅ SARIF, JSON | ✅ Yes | ✅ Yes | ⚠️ Limited |
| **SQL Injection (Supabase)** | ✅ Query analysis | ❌ No | ❌ No | ❌ No |

**TL;DR**: Use ESLint for code style, npm audit for known CVEs, and Ubon for AI-generated code security.

## The Reality of Debugging AI-Generated Code

### Without Ubon

> **User**: "The payment button doesn't work"
>
> **AI**: "You're absolutely right! Let me fix that for you..."
>
> _regenerates the component_
>
> **User**: "Still broken"
>
> **AI**: "I apologize! Let me try a different approach..."
>
> _adds more event handlers_
>
> **User**: "Nothing happens when I click"
>
> **AI**: "I see the issue now! Let me update the onClick handler..."
>
> _rewrites the same broken logic_
>
> _[3 hours later...]_
>
> **User**: "PLEASE JUST MAKE IT WORK"
>
> **AI**: "I understand your frustration! Let me completely refactor..."

### With Ubon

```bash
$ ubon check --group-by severity --min-severity medium

🪷 Ubon — Triage
High: 1 error   Medium: 1 warning

HIGH
  ❌ SEC003 Hardcoded OpenAI key (lib/ai.ts:12)
     fix: Move key to OPENAI_API_KEY env var

MEDIUM
  ⚠️ A11Y001 Image without alt attribute (components/Hero.tsx:22)
     fix: Add alt="" or a short descriptive text
```

**Result**: Issues fixed in minutes, not hours.

## About me and Ubon

Hi, I'm [Luisfer Romero Calero](https://lfrc.me), an experienced software engineer passionate about building products and being creative. I created Ubon in six days, obsessed with solving a problem I kept seeing everywhere: the current wave of AI-generated "vibe-coded" apps that, while incredibly quick to build, are frustrating to deploy and use because AI overlooks so many essential details.

The explosion of AI-generated apps through tools like Lovable, Replit, Cursor and Windsurf has democratized software creation. But it's also created a quiet reliability crisis. Non-technical users prompt AI with "this doesn't work!!!" without knowing what to check, they don't have the vocabulary to prompt precisely, and AI assistants miss the non‑obvious issues that slip past linters: hardcoded secrets, broken links, accessibility failures, and those subtle security vulnerabilities that only surface in production.

I built Ubon after realizing that instead of fighting this AI-powered wave, we should embrace it and make it better. Think of Ubon as a safety net for the age of AI-generated code, a gentle guardian that catches what traditional tools miss. It works seamlessly with the standard Next.js/React repos that agentic AI tools create by default, as well as Python projects and Vue.js ones.

My hope is that Ubon becomes so essential it gets baked into Cursor, Windsurf, and other AI coding tools, automatically scanning every vibe-coded creation before it hits production. Because when anyone can ship software, everyone needs peace of mind.

_Ubon_ means lotus in Thai, inspired by Ubon Ratchathani province where someone very special to me is from. The lotus represents the clarity and peace of mind this tool brings to debugging.

## Quick Start

### Installation

```bash
npm install -g ubon
```

### Basic Usage

```bash
ubon check                    # Quick static analysis
ubon scan --interactive       # Guided issue walkthrough
ubon check --ai-friendly      # JSON output for AI agents
ubon explain SEC001           # Learn about a specific rule
```

## What's New in v2.0.0

**Vibe Code Detection** — 4 new rules for AI-generated code:
- **VIBE001**: Hallucinated imports — packages not in package.json
- **VIBE002**: Copy-paste artifacts — repeated code blocks
- **VIBE003**: Incomplete implementations — placeholders, stubs, "Not implemented"
- **VIBE004**: Orphaned exports — unused exports

**New Features:**
- **Security Posture Score**: 0-100 score with visual bar
- **`--preview-fixes`**: See diff-like preview before applying fixes
- **`confidenceReason`**: Each finding explains its confidence level
- **`ubon explain <rule>`**: Get detailed info about any rule
- **Cursor Integration**: `docs/CURSOR.md` guide and `.cursor/rules/`
- **All scanners exported**: Use any scanner programmatically

```bash
# Preview what would be fixed
ubon check --preview-fixes

# See security posture score
ubon check
# 🪷 Security Posture: 85/100 [████████████████░░░░]

# Learn about a specific rule
ubon explain SEC001
ubon explain VIBE003
```

See `docs/CURSOR.md` for Cursor integration guide and `CHANGELOG.md` for previous releases.

## Commands

```bash
ubon check                              # Quick static analysis
ubon scan                               # Full scan with link checking
ubon scan --interactive                 # Guided issue walkthrough
ubon check --git-changed-since main     # Scan only changed files (CI)
ubon check --apply-fixes                # Apply safe auto-fixes
ubon check --preview-fixes              # Preview fixes before applying
ubon explain <rule>                     # Detailed info about a rule
```

Output formats:
```bash
ubon check --json                       # JSON for AI agents
ubon check --sarif results.sarif        # SARIF for GitHub code scanning
ubon check --format table               # Table for quick triage
```

See `docs/CLI.md` for full reference.

## Configuration

```bash
ubon init                    # Generate project config
ubon check --update-baseline # Suppress existing issues, focus on new code
```

Config file (`ubon.config.json`):
```json
{
  "profile": "next",
  "minConfidence": 0.8,
  "failOn": "error",
  "disabledRules": ["SEC018"]
}
```

See `docs/CONFIG.md` for full options.

## Documentation

- [Integration Guide](GUIDE.md) — Comprehensive reference
- [Cursor Integration](docs/CURSOR.md) — AI-assisted development
- [CLI Reference](docs/CLI.md) — All commands and flags
- [Features Matrix](docs/FEATURES.md) — What Ubon checks
- [Rules Glossary](docs/RULES.md) — All rules with descriptions
- [Configuration](docs/CONFIG.md) — Setup and customization

## Requirements

- Node.js 16+
- Git (for `--git-changed-since`)
- Python 3.x (for Python scanning)

## License

MIT — see `LICENSE`.