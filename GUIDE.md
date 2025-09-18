# Ubon Integration Guide

> **Quick Start**: Ubon is a security scanner for AI-generated code. Run `ubon scan --json` for machine-readable output, or `ubon scan --interactive` for guided issue resolution.

## Quick Start

### Essential Commands
```bash
# Quick static analysis with JSON output
ubon check --json

# Full scan with external link checking
ubon scan --json

# Interactive mode for guided debugging
ubon scan --interactive

# Focus on high-severity security issues only
ubon check --focus-critical --focus-security --json

# Scan only files changed since main branch
ubon check --git-changed-since origin/main --json

# AI-optimized output with context and explanations
ubon check --ai-friendly
```

### Common Workflows
```bash
# Pre-commit scanning
ubon check --fast --json --fail-on error

# CI/CD integration with SARIF output
ubon check --sarif results.sarif --git-changed-since origin/main

# Apply safe auto-fixes
ubon check --apply-fixes --json

# Generate baseline to suppress existing issues
ubon check --update-baseline
```

## Real Output Examples

### JSON Output Sample
```json
{
  "schemaVersion": "1.0.0",
  "toolVersion": "1.1.3",
  "summary": {
    "total": 3,
    "errors": 1,
    "warnings": 2,
    "info": 0
  },
  "issues": [
    {
      "type": "error",
      "category": "security",
      "message": "Hardcoded OpenAI API key detected",
      "file": "lib/ai.ts",
      "line": 12,
      "range": {
        "startLine": 12,
        "startColumn": 15,
        "endLine": 12,
        "endColumn": 47
      },
      "severity": "high",
      "ruleId": "SEC014",
      "confidence": 0.95,
      "fix": "Move API key to environment variable (OPENAI_API_KEY)",
      "match": "sk-********",
      "fingerprint": "abc123def456"
    },
    {
      "type": "warning",
      "category": "accessibility",
      "message": "Image missing alt attribute",
      "file": "components/Hero.tsx",
      "line": 22,
      "range": {
        "startLine": 22,
        "startColumn": 1,
        "endLine": 22,
        "endColumn": 34
      },
      "severity": "medium",
      "ruleId": "A11Y001",
      "confidence": 0.9,
      "fix": "Add alt attribute with descriptive text",
      "match": "<img src=\"/banner.png\" />",
      "fingerprint": "def456ghi789",
      "fixEdits": [
        {
          "startLine": 22,
          "startColumn": 26,
          "endLine": 22,
          "endColumn": 26,
          "newText": " alt=\"Hero banner image\""
        }
      ]
    }
  ],
  "recommendations": [
    "🚨 1 critical issues require immediate attention",
    "Review and secure all API keys, passwords, and sensitive data",
    "Add alt attributes to all images for screen readers"
  ]
}
```

### SARIF Output Sample
```json
{
  "$schema": "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
  "version": "2.1.0",
  "runs": [
    {
      "tool": {
        "driver": {
          "name": "Ubon",
          "version": "1.1.3",
          "informationUri": "https://github.com/luisfer/ubon"
        }
      },
      "results": [
        {
          "ruleId": "SEC014",
          "level": "error",
          "message": {
            "text": "Hardcoded OpenAI API key detected"
          },
          "locations": [
            {
              "physicalLocation": {
                "artifactLocation": {
                  "uri": "lib/ai.ts"
                },
                "region": {
                  "startLine": 12,
                  "startColumn": 15,
                  "endLine": 12,
                  "endColumn": 47
                }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

### CLI Output Sample
```bash
$ ubon check --show-context --explain

🪷 Ubon — Triage: 1 HIGH  2 MEDIUM

HIGH
  ❌ SEC014 Hardcoded OpenAI API key detected (lib/ai.ts:12)
     💡 why it matters: API keys in code can be exposed in version control
     🔧 fix: Move API key to environment variable (OPENAI_API_KEY)
     📋 context:
       10 | import { openai } from './config'
       11 |
       12 | const apiKey = "sk-********************************"
          |                ^ hardcoded API key detected
       13 | 
       14 | export async function generateText() {

MEDIUM
  ⚠️ A11Y001 Image missing alt attribute (components/Hero.tsx:22)
     🔧 fix: Add alt attribute with descriptive text
```

## Complete Capabilities Matrix

### Security Detection by Framework

| Framework | Capabilities | Rule Count | Key Rules |
|-----------|-------------|------------|-----------|
| **React/Next.js** | API keys, JWT tokens, XSS, CORS, env leaks, cookies | 25+ | SEC001-019, NEXT001-011, COOKIE001-004 |
| **Python** | exec/eval, subprocess, YAML, pickle, requests | 10+ | PYSEC001-010, PYNET001 |
| **Vue.js** | XSS via v-html, accessibility | 5+ | VUE001, A11Y001-007 |
| **Rails** | SQL injection, YAML.load, mass assignment | 5+ | RAILS001-005 (experimental) |
| **Development** | AI placeholders, TODOs, mock data | 5+ | DEV001-005 |

### Detection Categories

| Category | What It Finds | Confidence | Auto-Fix Available |
|----------|---------------|------------|-------------------|
| **Secrets** | API keys, tokens, passwords, DB URLs | 0.8-0.95 | ❌ (flagging only) |
| **Code Injection** | eval(), innerHTML, React injection | 0.9-0.95 | ❌ (flagging only) |
| **Accessibility** | Missing alt, labels, semantic issues | 0.8-0.9 | ✅ (add alt, roles) |
| **Environment** | Hardcoded fallbacks, .env issues | 0.7-0.9 | ✅ (remove fallbacks) |
| **Links** | Broken external/internal links | 0.9 | ❌ (flagging only) |
| **Dependencies** | Vulnerable packages (OSV.dev) | 0.95 | ❌ (flagging only) |
| **Development** | TODOs, placeholders, mock data | 0.8-0.9 | ❌ (flagging only) |

## File Types & Scope

### Supported File Extensions
| Language | Extensions | Frameworks Detected |
|----------|------------|-------------------|
| **JavaScript** | `.js`, `.jsx`, `.mjs` | React, Vue, Express |
| **TypeScript** | `.ts`, `.tsx` | React, Next.js, Angular |
| **Python** | `.py` | Django, Flask, FastAPI |
| **Ruby** | `.rb`, `.erb` | Rails (experimental) |
| **Vue** | `.vue` | Vue.js |
| **Config** | `.env`, `.json`, `.yaml`, `.yml` | Various |

### Ignored Directories (Default)
```
node_modules/**, dist/**, build/**, .next/**, 
.venv/**, venv/**, __pycache__/**, 
.git/**, .DS_Store, *.log
```

### Performance Considerations
- **Small projects** (< 100 files): ~1-2 seconds
- **Medium projects** (100-1000 files): ~5-10 seconds  
- **Large projects** (1000+ files): Use `--fast` or `--git-changed-since`
- **Network checks**: Add ~2-5 seconds for external link validation

## Command Reference

### Core Commands

| Command | Purpose | Speed | Use Case |
|---------|---------|-------|----------|
| `ubon check` | Static analysis only | Fast | Pre-commit, CI/CD |
| `ubon scan` | Full scan + link checking | Slow | Complete audit |
| `ubon guide` | Show this guide | N/A | Documentation |
| `ubon cache` | Manage OSV cache | N/A | Cache maintenance |
| `ubon init` | Generate config | Fast | Project setup |

### Essential Flags

| Flag | Purpose | Example | Use Case |
|------|---------|---------|----------|
| `--json` | Machine-readable output | `ubon check --json` | Parsing results |
| `--interactive` | Guided issue walkthrough | `ubon scan --interactive` | User debugging |
| `--fast` | Skip network checks | `ubon check --fast` | Quick feedback |
| `--apply-fixes` | Auto-fix safe issues | `ubon check --apply-fixes` | Code improvement |
| `--git-changed-since` | Scan changed files only | `ubon check --git-changed-since origin/main` | CI optimization |
| `--focus-critical` | High-severity only | `ubon check --focus-critical` | Priority triage |
| `--sarif` | SARIF output | `ubon check --sarif results.sarif` | GitHub code scanning |

### Output Control

| Flag | Purpose | Values | Benefit |
|------|---------|--------|---------|
| `--group-by` | Organize results | `category\|file\|rule\|severity` | Structured analysis |
| `--format` | Output format | `human\|table` | Readability |
| `--min-severity` | Filter by severity | `low\|medium\|high` | Focus on critical |
| `--max-issues` | Limit output | `N` (number) | Prevent overwhelm |
| `--show-context` | Code context | Boolean | Understanding issues |
| `--explain` | Why it matters | Boolean | Learning/explanation |

## Complete Rule Catalog

### Security Rules (SEC001-019)

| Rule ID | Confidence | Description | Framework | Severity |
|---------|------------|-------------|-----------|----------|
| SEC001 | 0.9 | API key/secret token exposed | All | High |
| SEC002 | 0.8 | Supabase URL hardcoded | JS/TS | Medium |
| SEC003 | 0.95 | Supabase anon key hardcoded (JWT) | JS/TS | High |
| SEC006 | 0.85 | Hardcoded password | All | High |
| SEC007 | 0.85 | Database URL hardcoded | All | High |
| SEC009 | 0.95 | AWS Access Key ID exposed | All | High |
| SEC014 | 0.95 | OpenAI API key exposed | All | High |
| SEC016 | 0.9 | eval() usage | JS/TS | High |
| SEC017 | 0.9 | dangerouslySetInnerHTML | React | High |
| SEC018 | 0.6-0.9 | High-entropy string (possible secret) | All | Medium |

### Development Rules (DEV001-005) - AI Code Detection

| Rule ID | Confidence | Description | Typical in AI Code | Auto-Fix |
|---------|------------|-------------|-------------------|----------|
| DEV001 | 0.8 | TODO/FIXME comments | ✅ Very common | ❌ |
| DEV002 | 0.9 | "Not implemented" stubs | ✅ Very common | ❌ |
| DEV003 | 0.85 | Placeholder URLs (localhost, example.com) | ✅ Common | ❌ |
| DEV004 | 0.8 | Mock/example data in responses | ✅ Common | ❌ |
| DEV005 | 0.8 | Empty returns/unimplemented | ✅ Very common | ❌ |

### Accessibility Rules (A11Y001-007)

| Rule ID | Confidence | Description | Auto-Fix Available |
|---------|------------|-------------|-------------------|
| A11Y001 | 0.9 | Image without alt attribute | ✅ |
| A11Y002 | 0.8 | Input without label | ✅ |
| A11Y004 | 0.8 | Clickable div (not accessible) | ✅ |
| A11Y005 | 0.8 | Link without href | ✅ |

### Framework-Specific Rules

#### Next.js (NEXT001-011, NEXT201-210)
| Rule ID | Confidence | Description | Severity |
|---------|------------|-------------|----------|
| NEXT007 | 0.9 | JWT in API response | High |
| NEXT008 | 0.8 | Missing security headers | Medium |
| NEXT009 | 0.85 | Unsafe redirect | High |
| NEXT011 | 0.85 | Env var leaked to client | High |
| NEXT210* | 0.8 | Server→client secret bleed | High |

*Experimental rules - enable with `--enable-rule NEXT210`

#### Python (PYSEC001-010)
| Rule ID | Confidence | Description | Severity |
|---------|------------|-------------|----------|
| PYSEC002 | 0.9 | exec() usage | High |
| PYSEC003 | 0.9 | eval() usage | High |
| PYSEC004 | 0.85 | subprocess with shell=True | High |
| PYSEC007 | 0.9 | TLS verification disabled | High |

## Framework-Specific Integration

### Next.js Projects
```bash
# App Router vs Pages Router detection
ubon check --profile next

# Check for SSR prop leaks
ubon check --enable-rule NEXT210

# Focus on routing issues
ubon check --enable-rule NEXT201,NEXT202,NEXT203
```

### Python Projects  
```bash
# Auto-detect Django/Flask/FastAPI
ubon check --profile python

# Check for Django DEBUG=True
ubon check --enable-rule PYSEC009

# Include dependency vulnerabilities
ubon check --profile python --json
```

### Monorepo Projects
```bash
# Scan specific app
ubon check --directory ./apps/web --profile next

# Use separate baselines
ubon check --baseline ./apps/web/.ubon.baseline.json

# Scan multiple apps
ubon check --directory ./apps/api --profile python
```

## Troubleshooting

### Common Issues & Solutions

| Problem | Symptoms | Solution |
|---------|----------|----------|
| **No files found** | "No files to scan" | Check `--directory` path, ensure file extensions supported |
| **Git not found** | `--git-changed-since` fails | Ensure git is installed and directory is a git repo |
| **Network timeouts** | OSV/link checks hang | Use `--fast` or `--no-cache` |
| **Permission denied** | File read errors | Check file permissions, run as appropriate user |
| **Too many false positives** | High SEC018 noise | Use `--min-confidence 0.9` or disable SEC018 |

### Exit Codes
| Code | Meaning | When It Happens |
|------|---------|-----------------|
| `0` | Success | No issues above fail threshold |
| `1` | Issues found | Issues exceed `--fail-on` threshold |
| `2` | Tool error | Invalid arguments, file not found, etc. |

### Environment Variables
| Variable | Effect | Example |
|----------|--------|---------|
| `NO_COLOR` | Disable colored output | `NO_COLOR=1 ubon check` |
| `CI` | Auto-detected CI environment | Set by GitHub Actions |
| `UBON_CONFIG` | Override config file path | `UBON_CONFIG=./custom.json` |

### Performance Optimization

#### For Large Codebases
```bash
# Use git filtering for speed
ubon check --git-changed-since origin/main

# Skip expensive checks
ubon check --fast --no-cache

# Focus on specific file types
ubon check --changed-files "src/**/*.ts"

# Use lower confidence threshold
ubon check --min-confidence 0.9
```

#### For CI/CD
```bash
# Fail fast on critical issues only
ubon check --fast --fail-on error --focus-critical

# Cache results between runs
ubon check --sarif results.sarif

# Progressive scanning
ubon check --git-changed-since ${{ github.event.pull_request.base.sha }}
```

## Integration Patterns

### 1. Pre-commit Analysis
```bash
# Quick security and quality check
ubon check --fast --focus-critical --json --fail-on error
```

### 2. Code Review Assistant  
```bash
# Generate human-readable report
ubon check --show-context --explain --group-by severity

# Interactive walkthrough
ubon scan --interactive --max-issues 10
```

### 3. CI/CD Pipeline
```yaml
# GitHub Actions example
- name: Security Scan
  run: |
    npm install -g ubon
    ubon check --sarif results.sarif --fail-on error --git-changed-since origin/main
    
- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

### 4. Development Iteration
```bash
# Watch mode for real-time feedback
ubon check --watch --fast --max-issues 5

# Focus on new issues only
ubon check --git-changed-since HEAD~1
```

### 5. Fix Application
```bash
# Preview fixes
ubon check --fix-dry-run --json

# Apply safe fixes
ubon check --apply-fixes --json
```

## Configuration Guide

### Project Configuration (ubon.config.json)
```json
{
  "profile": "next",
  "minConfidence": 0.8,
  "failOn": "error",
  "enabledRules": ["SEC*", "A11Y*", "DEV*"],
  "disabledRules": ["SEC018"],
  "baselinePath": ".ubon.baseline.json",
  "fast": true,
  "showContext": true,
  "explain": true
}
```

### CI-Specific Configuration
```json
{
  "profile": "auto",
  "failOn": "error",
  "fast": true,
  "enabledRules": ["SEC*", "A11Y001", "A11Y002"],
  "minConfidence": 0.9,
  "maxIssues": 20
}
```

### Development Configuration  
```json
{
  "profile": "next",
  "enabledRules": ["DEV*", "SEC001", "SEC003", "SEC014"],
  "showContext": true,
  "interactive": false,
  "fast": true
}
```

## Advanced Usage

### Custom Rule Selection
```bash
# Security audit focus
ubon check --enable-rule "SEC*,PYSEC*" --disable-rule "SEC018"

# Accessibility audit
ubon check --enable-rule "A11Y*" --apply-fixes

# Development cleanup
ubon check --enable-rule "DEV*" --show-context
```

### Baseline Management
```bash
# Create baseline for legacy project
ubon check --update-baseline --baseline ./legacy.baseline.json

# Scan against baseline
ubon check --baseline ./legacy.baseline.json

# Show what's suppressed
ubon check --show-suppressed --baseline ./legacy.baseline.json
```

### Multi-Environment Scanning
```bash
# Production readiness check
ubon check --profile next --disable-rule "DEV*" --min-confidence 0.9

# Development environment check  
ubon check --enable-rule "DEV*" --fast

# Security-focused audit
ubon check --focus-security --explain --show-context
```

---

## Version Information

- **Current Version**: 1.1.4
- **Schema Version**: 1.0.0
- **Node.js Requirement**: 16.0.0+
- **Last Updated**: 2025-09-18

## Quick Reference

### Most Common Commands
```bash
# Quick check with JSON output
ubon check --json

# Interactive debugging session
ubon scan --interactive

# CI/CD with SARIF
ubon check --sarif results.sarif --fail-on error

# Apply safe fixes
ubon check --apply-fixes

# Show this guide
ubon guide
```

### Getting Help
- **CLI Help**: `ubon --help`, `ubon scan --help`, `ubon check --help`
- **Issues**: https://github.com/luisfer/ubon/issues
- **Documentation**: All `docs/*.md` files in repository
- **Guide Command**: `ubon guide` (shows this file location)