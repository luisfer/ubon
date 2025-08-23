import { glob } from 'glob';
import { readFileSync } from 'fs';
import ts from 'typescript';
import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../types/rules';

export class AstSecurityScanner implements Scanner {
  name = 'AST Security Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    const files = await glob('**/*.{js,jsx,ts,tsx}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });

    for (const file of files) {
      let sourceText = '';
      try { sourceText = readFileSync(`${options.directory}/${file}`, 'utf-8'); } catch { continue; }
      const sf = ts.createSourceFile(file, sourceText, ts.ScriptTarget.ES2020, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS);

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
          fix: meta.fix
        });
      };

      const visit = (node: ts.Node) => {
        // eval(...)
        if (ts.isCallExpression(node)) {
          const expr = node.expression;
          if (ts.isIdentifier(expr) && expr.text === 'eval') {
            add('SEC016', node);
          }
          // React.createElement(userInput)
          if (ts.isPropertyAccessExpression(expr)) {
            if (ts.isIdentifier(expr.expression) && expr.expression.text === 'React' && expr.name.text === 'createElement') {
              const first = node.arguments[0];
              if (first && !ts.isStringLiteralLike(first)) {
                add('SEC019', node);
              }
            }
          }
          // dynamic import(userControlled)
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const arg = node.arguments[0];
            if (arg && !ts.isStringLiteralLike(arg)) {
              add('NEXT004', node);
            }
          }
          // fetch(...)
          if (ts.isIdentifier(expr) && expr.text === 'fetch') {
            const second = node.arguments[1];
            let hasSignal = false;
            if (second && ts.isObjectLiteralExpression(second)) {
              hasSignal = second.properties.some(p => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'signal');
            }
            if (!hasSignal) add('JSNET001', node, RULES.JSNET001.message);
          }
        }

        // dangerouslySetInnerHTML
        if (ts.isIdentifier(node) && node.text === 'dangerouslySetInnerHTML') {
          add('SEC017', node);
        }

        // process.env.X || 'fallback'
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
          const left = node.left;
          const right = node.right;
          const isEnv = ts.isPropertyAccessExpression(left) && ts.isPropertyAccessExpression(left.expression) && ts.isIdentifier(left.expression.expression) && left.expression.expression.text === 'process' && ts.isIdentifier(left.expression.name) && left.expression.name.text === 'env';
          const isLiteral = ts.isStringLiteralLike(right);
          if (isEnv && isLiteral) {
            add('SEC008', node);
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(sf);
    }

    return results;
  }
}


