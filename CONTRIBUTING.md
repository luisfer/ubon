# Contributing to Ubon

Thank you for your interest in contributing to Ubon! This guide will help you get started.

## 🎯 Ways to Contribute

### 🐛 Report Bugs
- Use the [GitHub issue tracker](https://github.com/luisfer/ubon/issues)
- Include steps to reproduce the issue
- Provide example code or files when possible
- Mention your OS, Node.js version, and Ubon version

### 💡 Suggest Features
- Open a feature request issue
- Describe the use case and expected behavior
- Explain why this would be valuable to vibe-coders

### 🔍 Add New Scanners or Rules
Ubon's scope as of v3.0.0 is **modern JavaScript/TypeScript web stacks**:
Next.js, React, Vite, SvelteKit, Astro, Remix, Hono, Lovable, plus
cross-cutting concerns (env files, Docker/GHA, AI/LLM patterns, vibe
hygiene, accessibility, links). New rules and scanners that fall in
that scope are very welcome:

1. **Security rules**: new vulnerability patterns relevant to JS/TS apps
2. **AI-era rules**: prompt-injection, model-routing, MCP misconfig, etc.
3. **Framework rules**: Next 15/16, Remix v2/RR7, Astro 5, SvelteKit 2
4. **Accessibility rules**: additional a11y checks for JSX/Svelte/Astro

> **Out of scope** in v3: Python, Ruby on Rails, and Vue. Those profiles
> were removed — see [`MIGRATION-v3.md`](./MIGRATION-v3.md). For those
> ecosystems, prefer Bandit, Brakeman, or `eslint-plugin-vue`.

## 🛠 Development Setup

### Prerequisites
- Node.js **20 or newer** (v3 dropped Node 16/18; both are EOL)
- npm 10+ recommended (provenance + workspace overrides)

### Getting Started
```bash
git clone https://github.com/luisfer/ubon.git
cd ubon
npm install
npm run build
```

### Running Tests
```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
npm run lint            # Run ESLint
npm run lint:fix        # Fix ESLint issues
```

### Testing Your Changes
```bash
# Build the project
npm run build

# Test on a sample project
./dist/cli.js scan --directory ../some-test-app
```

## 📁 Project Structure

```
src/
├── types/           # TypeScript interfaces
├── scanners/        # Individual scanner implementations
├── utils/           # Utility functions (logger, etc.)
├── index.ts         # Main Ubon class
└── cli.ts           # Command-line interface
```

## 🔍 Creating a New Scanner

1. **Create the scanner file**: `src/scanners/your-scanner.ts` and
   extend `BaseScanner` (gives you `iterateFiles`, `redact`, the
   `maxFileSize` guard, and result-cache integration for free).

```typescript
import { BaseScanner } from './base-scanner';
import type { ScanOptions, ScanResult } from '../types';

export class YourScanner extends BaseScanner {
  name = 'Your Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    for await (const { path, content } of this.iterateFiles(
      options,
      '**/*.{js,jsx,ts,tsx,svelte,astro}'
    )) {
      // your scanning logic — push ScanResult objects into `results`
    }
    return results;
  }
}
```

2. **Wire it into the profile registry**: add an entry in
   [`src/core/profiles.ts`](./src/core/profiles.ts). That's the single
   source of truth for "what runs under this profile" — no other file
   needs touching to expose your scanner.
3. **Register the rules** in `src/rules/<bucket>/<RULE_ID>.ts` (one
   file per rule) and re-export them from `src/rules/index.ts`. Run
   `npm run rules:gen` to refresh `docs/RULES.md` — the file is
   generated from the live registry.
4. **Write tests**: add `src/__tests__/your-scanner.test.ts` covering
   both true positives and false positives. Snapshot tests for the
   human reporter are encouraged.
5. **Update docs**: most user-facing docs (`docs/RULES.md`,
   integration tables) are generated; you only need to touch
   `CHANGELOG.md` and, if the rule is opt-in, `docs/CONFIG.md`.

### Scanner Best Practices

- **Clear, actionable messages**: Users should understand what's wrong
- **Provide fixes**: Include `fix` suggestions when possible
- **Appropriate severity**: Use `high` for security/breaking issues
- **Handle errors gracefully**: Skip files that can't be read
- **Performance**: Avoid unnecessary file reads or heavy operations

## 🎨 Code Style

- Use TypeScript
- Follow existing ESLint configuration
- Write clear, descriptive variable names
- Add comments for complex logic
- Keep functions focused and small

## 📝 Commit Messages

Use clear, descriptive commit messages:

```
feat: add performance scanner for bundle size
fix: handle missing package.json gracefully  
docs: update scanner API examples
test: add security scanner edge cases
```

## 🔄 Pull Request Process

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature`
3. **Make your changes**
4. **Add tests** for new functionality
5. **Update documentation** as needed
6. **Run tests**: `npm test`
7. **Submit pull request**

### PR Checklist
- [ ] Tests pass
- [ ] New features have tests
- [ ] Documentation updated
- [ ] No breaking changes (or clearly documented)
- [ ] Follows existing code style

## 🤔 Questions?

- Open a GitHub issue for technical questions
- Tag @luisfer for urgent matters
- Check existing issues and PRs first

## 📜 Code of Conduct

- Be respectful and constructive
- Focus on the code, not the person
- Help newcomers learn and contribute
- Keep discussions relevant to Ubon

Thank you for contributing to making vibe-coded apps healthier!