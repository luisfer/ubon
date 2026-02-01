# Cursor Integration

Ubon is designed to work seamlessly with Cursor and other AI-assisted development tools. This guide covers how to integrate Ubon into your Cursor workflow.

## Quick Start

```bash
# Install globally
npm install -g ubon

# Run in your project
cd your-project
ubon check --ai-friendly
```

## AI-Friendly Output

The `--ai-friendly` flag optimizes output for AI consumption:

```bash
ubon check --ai-friendly
```

This enables:
- JSON output format
- Code context around findings
- "Why it matters" explanations
- Severity-based grouping
- Capped at 15 issues to avoid overwhelming context

## Cursor Rules Integration

Add Ubon to your project's Cursor rules for automatic scanning guidance.

Create `.cursor/rules/ubon.mdc`:

```markdown
---
description: Ubon security scanner integration
globs: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"]
---

# Ubon Security Scanner

When working on this codebase, use Ubon to check for security issues:

## Quick Commands

- `ubon check` - Fast static analysis
- `ubon check --ai-friendly` - Output optimized for AI review
- `ubon check --preview-fixes` - See what auto-fixes are available
- `ubon check --apply-fixes` - Apply safe auto-fixes

## Before Committing

Run `ubon check --focus-critical` to ensure no high-severity issues.

## Understanding Results

Each finding includes:
- **ruleId**: The rule that triggered (e.g., SEC001, VIBE001)
- **confidence**: 0.0-1.0 likelihood this is a real issue
- **confidenceReason**: Why this confidence was assigned
- **fix**: Suggested remediation

## Common Issues in AI-Generated Code

Ubon's VIBE rules detect common AI-generated code problems:
- VIBE001: Hallucinated imports (packages that don't exist)
- VIBE002: Copy-paste artifacts (repeated code blocks)
- VIBE003: Incomplete implementations (placeholders, stubs)
- VIBE004: Orphaned exports (unused exports)
```

## Programmatic Usage

For advanced Cursor workflows, use Ubon programmatically:

```typescript
import { UbonScan } from 'ubon';

const scanner = new UbonScan(false, true); // verbose=false, json=true
const results = await scanner.diagnose({
  directory: process.cwd(),
  profile: 'auto',
  minConfidence: 0.8
});

// Results include confidenceReason for AI context
results.forEach(r => {
  console.log(`${r.ruleId}: ${r.message}`);
  if (r.confidenceReason) {
    console.log(`  Reason: ${r.confidenceReason}`);
  }
});
```

## MCP Server (Experimental)

Ubon can run as an MCP server for direct Cursor integration:

```bash
ubon lsp
```

This provides:
- Real-time diagnostics as you type
- Code actions for auto-fixes
- Hover information with rule explanations

## Workflow Recommendations

### 1. Initial Scan
When starting work on a codebase:
```bash
ubon check --ai-friendly --explain
```

### 2. During Development
After making changes:
```bash
ubon check --git-changed-since HEAD~1
```

### 3. Before PR
Final check before creating a PR:
```bash
ubon check --focus-critical --fail-on error
```

### 4. Fix Preview
See what can be auto-fixed:
```bash
ubon check --preview-fixes
```

### 5. Apply Fixes
Apply safe auto-fixes:
```bash
ubon check --apply-fixes
```

## Security Posture Score

Ubon v2.0 includes a security posture score (0-100) in human output:

```
🪷 Security Posture: 85/100 [████████████████░░░░]
   Good security posture with some areas for improvement.
```

This helps quickly assess the overall security health of a codebase.

## Suppressing False Positives

Add inline comments to suppress specific findings:

```typescript
// ubon-disable-next-line SEC015
console.log('Debug output'); // Intentional logging

// ubon-disable-file
// Disables all Ubon checks for this file
```

## CI Integration

For CI pipelines that feed into Cursor:

```yaml
# .github/workflows/ubon.yml
- name: Ubon Security Check
  run: |
    npm install -g ubon
    ubon check --json --output ubon-results.json --fail-on error
```

The JSON output can be parsed by Cursor for inline annotations.
