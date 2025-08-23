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

### 🔍 Add New Scanners
We're always looking for new types of issues to detect:

1. **Security scanners**: New vulnerability patterns
2. **Accessibility scanners**: Additional a11y checks
3. **Performance scanners**: Bundle analysis, optimization opportunities
4. **Framework-specific scanners**: Next.js, Remix, etc.

## 🛠 Development Setup

### Prerequisites
- Node.js 16+
- npm or yarn

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

1. **Create the scanner file**: `src/scanners/your-scanner.ts`
2. **Implement the Scanner interface**:

```typescript
import { Scanner, ScanResult, ScanOptions } from '../types';

export class YourScanner implements Scanner {
  name = 'Your Scanner Name';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    // Your scanning logic here
    
    return results;
  }
}
```

3. **Add to main class**: Update `src/index.ts` to include your scanner
4. **Write tests**: Create `src/scanners/__tests__/your-scanner.test.ts`
5. **Update documentation**: Add scanner details to README.md

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