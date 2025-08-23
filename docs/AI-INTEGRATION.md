# 🤖 AI Agent Integration Guide

Ubon is designed to work seamlessly with both human developers and AI agents. Here's how to integrate it:

## 🔧 For AI Agents (Cursor, Windsurf, Claude, etc.)

### JSON Output Mode
Use the `--json` flag to get structured data perfect for programmatic analysis:

```bash
ubon check --directory ./project --json
```

You can also tailor results for agents:

```bash
# Only include findings with confidence >= 0.8 and specific rules
ubon check --json --min-confidence 0.8 --enable-rule SEC003 --enable-rule A11Y001

# Fail CI on any warning or error
ubon check --json --fail-on warning
```

### Expected JSON Response
```json
{
  "summary": {
    "total": 37,
    "errors": 10,
    "warnings": 27,
    "info": 0
  },
  "issues": [
    {
      "type": "error",
      "category": "security", 
      "message": "Hardcoded password detected",
      "file": "src/utils/helpers.ts",
      "line": 8,
      "severity": "high",
      "ruleId": "SEC006",
      "confidence": 0.85,
      "fix": "Use environment variables for passwords"
    }
  ],
  "recommendations": [
    "🚨 10 critical issues require immediate attention",
    "Review and secure all API keys, passwords, and sensitive data",
    "Remove or properly guard console.log statements before production",
    "Add alt attributes to all images for screen readers"
  ]
}
```

## 🛠 Integration Examples

### Cursor/Windsurf Integration
```typescript
// Add this as a custom tool/command
import { execSync } from 'child_process';

export async function runUbon(projectPath: string) {
  try {
    const result = execSync(
      `ubon check --directory ${projectPath} --json`,
      { encoding: 'utf8' }
    );
    
    const analysis = JSON.parse(result);
    
    if (analysis.summary.errors > 0) {
      console.log(`🚨 Found ${analysis.summary.errors} critical issues`);
      // Auto-fix or suggest fixes based on analysis.issues
      return analysis;
    }
  } catch (error) {
    console.log('Ubon scan failed:', error);
  }
}
```

### Claude Code Integration
```bash
# Add to your workflow
ubon check --json > scan-results.json
# Process results and apply fixes
```

### CI/CD Integration
```yaml
# GitHub Actions
- name: Run Ubon
  run: |
    npm install -g ubon
    ubon check --json --min-confidence 0.8 --fail-on error --sarif ubon.sarif > ubon-results.json
    
- name: Process Results
  run: |
    # Parse JSON and create PR comments or fail build
    node scripts/process-ubon-results.js

- name: Upload SARIF to GitHub Code Scanning
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: ubon.sarif
```

## 📋 Issue Categories

### Security Issues
- `security`: API keys, passwords, eval(), XSS vulnerabilities
- **Priority**: High - Fix immediately

### Accessibility Issues  
- `accessibility`: Missing alt text, unlabeled inputs, keyboard navigation
- **Priority**: Medium - Important for compliance

### Link Issues
- `links`: Broken links, missing images
- **Priority**: Medium - Affects user experience

## 🎯 AI Agent Workflow

1. **Run Scan**: `ubon check --json`
2. **Parse Results**: Process JSON response
3. **Categorize Issues**: Group by severity, category, and ruleId; use `confidence` to prioritize auto-fixes
4. **Auto-fix**: Apply fixes for common patterns
5. **Report**: Summarize remaining manual fixes needed

### Baseline Workflow for Agents

- Generate baseline once to silence legacy noise:
  - `ubon check --update-baseline`
- On subsequent runs, baseline is applied automatically (can be disabled with `--no-baseline`).

### Suggested AI Prompts

When an AI agent detects issues, it can use these prompts:

```
Based on ubon scan results, I found:
- ${errorCount} critical security issues
- ${warningCount} accessibility problems

I'll fix the following automatically:
- Move hardcoded secrets to environment variables
- Add alt attributes to images
- Replace div buttons with proper button elements

Please review these changes and the remaining ${manualFixCount} issues that need manual attention.
```

## 📦 Installation for AI Environments

### Global Installation
```bash
npm install -g ubon
```

### Project-specific
```bash
npm install --save-dev ubon
```

### Docker/Container
```dockerfile
RUN npm install -g ubon
```

## ⚡ Performance Notes

- **Fast scanning**: Static analysis only (no server required)
- **Lightweight**: ~2MB package size
- **Zero config**: Works out of the box
- **Exit codes**: 0 = clean, 1 = issues found (perfect for CI/CD)

---

Ubon bridges the gap between AI-generated code and production-ready applications!