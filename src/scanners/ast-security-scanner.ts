import { glob } from 'glob';
import { readFileSync } from 'fs';
import type ts from 'typescript';
import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../rules';

export class AstSecurityScanner implements Scanner {
  name = 'AST Security Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    // Lazily require TypeScript at runtime; if unavailable (global install without dev deps), skip AST checks gracefully
    let tsReal: typeof import('typescript');
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      tsReal = require('typescript') as typeof import('typescript');
    } catch {
      return [];
    }

    const results: ScanResult[] = [];
    const ignorePatterns = ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**', 'coverage/**', '.git/**'];
    if (!options.detailed) {
      ignorePatterns.push('**/__tests__/**', '**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}');
    }
    const files = await glob('**/*.{js,jsx,ts,tsx}', {
      cwd: options.directory,
      ignore: ignorePatterns
    });

    for (const file of files) {
      let sourceText = '';
      try {
        sourceText = readFileSync(`${options.directory}/${file}`, 'utf-8');
      } catch (error) {
        if (options.verbose) {
          console.error(`🪷 AstSecurityScanner: failed to read ${file}:`, error);
        }
        continue;
      }
      const sf = tsReal.createSourceFile(
        file,
        sourceText,
        tsReal.ScriptTarget.ES2020,
        true,
        file.endsWith('.tsx') ? tsReal.ScriptKind.TSX : file.endsWith('.ts') ? tsReal.ScriptKind.TS : tsReal.ScriptKind.JS
      );

      // Confidence reasons for AST-detected issues
      const confidenceReasons: Record<string, string> = {
        'SEC016': 'AST confirms direct eval() call expression',
        'SEC019': 'React.createElement with non-literal component - potential injection',
        'NEXT004': 'Dynamic import() with non-literal argument - potential code injection',
        'JSNET001': 'fetch() call without AbortController signal in options',
        'SEC017': 'dangerouslySetInnerHTML attribute detected in JSX',
        'SEC008': 'process.env.X || "fallback" pattern detected via AST'
      };

      const add = (metaKey: keyof typeof RULES, node: ts.Node, message?: string) => {
        const meta = RULES[metaKey as string];
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart());
        const lineStart = sf.getPositionOfLineAndCharacter(line, 0);
        const lineEnd = sf.getLineEndOfPosition(node.getStart());
        const lineText = sourceText.slice(lineStart, lineEnd).trim();
        results.push({
          type: meta.severity === 'high' ? 'error' : 'warning',
          category: meta.category,
          message: message || meta.message,
          file,
          line: line + 1,
          range: { startLine: line + 1, startColumn: character + 1, endLine: line + 1, endColumn: character + 1 + Math.max(1, node.getWidth()) },
          severity: meta.severity,
          ruleId: meta.id,
          match: lineText.slice(0, 200),
          confidence: 0.9,
          confidenceReason: confidenceReasons[meta.id] || 'AST analysis confirms pattern',
          fix: meta.fix
        });
      };

      const visit = (node: ts.Node) => {
        // eval(...)
        if (tsReal.isCallExpression(node)) {
          const expr = node.expression;
          if (tsReal.isIdentifier(expr) && expr.text === 'eval') {
            add('SEC016', node);
          }
          // React.createElement(userInput)
          if (tsReal.isPropertyAccessExpression(expr)) {
            if (tsReal.isIdentifier(expr.expression) && expr.expression.text === 'React' && expr.name.text === 'createElement') {
              const first = node.arguments[0];
              if (first && !tsReal.isStringLiteralLike(first)) {
                add('SEC019', node);
              }
            }
          }
          // dynamic import(userControlled)
          if (tsReal.isCallExpression(node) && node.expression.kind === tsReal.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0];
            if (arg && !tsReal.isStringLiteralLike(arg)) {
              add('NEXT004', node);
            }
          }
          // fetch(...)
          if (tsReal.isIdentifier(expr) && expr.text === 'fetch') {
            const second = node.arguments[1];
            let hasSignal = false;
            if (second && tsReal.isObjectLiteralExpression(second)) {
              hasSignal = second.properties.some(p => tsReal.isPropertyAssignment(p) && tsReal.isIdentifier(p.name) && p.name.text === 'signal');
            }
            if (!hasSignal) add('JSNET001', node, RULES.JSNET001.message);
          }
        }

        // dangerouslySetInnerHTML
        if (tsReal.isIdentifier(node) && node.text === 'dangerouslySetInnerHTML') {
          add('SEC017', node);
        }

        // process.env.X || 'fallback'
        if (tsReal.isBinaryExpression(node) && node.operatorToken.kind === tsReal.SyntaxKind.BarBarToken) {
          const left = node.left;
          const right = node.right;
          const isEnv = tsReal.isPropertyAccessExpression(left) && tsReal.isPropertyAccessExpression(left.expression) && tsReal.isIdentifier(left.expression.expression) && left.expression.expression.text === 'process' && tsReal.isIdentifier(left.expression.name) && left.expression.name.text === 'env';
          const isLiteral = tsReal.isStringLiteralLike(right);
          if (isEnv && isLiteral) {
            add('SEC008', node);
          }
        }

        tsReal.forEachChild(node, visit);
      };

      visit(sf);
    }

    return results;
  }
}


