import { glob } from 'glob';
import { statSync } from 'fs';
import { join } from 'path';
import type ts from 'typescript';
import { Scanner, ScanOptions, ScanResult } from '../types';
import { RULES } from '../rules';
import { FileSourceCache, DEFAULT_MAX_FILE_SIZE } from '../utils/file-source-cache';

export class AstSecurityScanner implements Scanner {
  name = 'AST Security Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    // Lazily require TypeScript at runtime; if unavailable (global install without dev deps), skip AST checks gracefully
    let tsReal: typeof import('typescript');
    try {
       
      tsReal = require('typescript') as typeof import('typescript');
    } catch {
      return [];
    }

    const results: ScanResult[] = [];
    const files = await glob('**/*.{js,jsx,ts,tsx}', {
      cwd: options.directory,
      ignore: ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**']
    });

    const sourceCache = FileSourceCache.forDirectory(options.directory);
    const maxSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    for (const file of files) {
      const absolute = join(options.directory, file);
      try {
        if (statSync(absolute).size > maxSize) continue;
      } catch {
        continue;
      }
      const sourceText = sourceCache.read(absolute);
      if (sourceText === undefined) {
        if (options.verbose) {
          console.error(`🪷 AstSecurityScanner: failed to read ${file}`);
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
        'SEC020': 'SQL sink receives a template literal with interpolations or a string concatenation — classic injection pattern',
        'NEXT004': 'Dynamic import() with non-literal argument - potential code injection',
        'JSNET001': 'fetch() call without AbortController signal in options',
        'SEC017': 'dangerouslySetInnerHTML attribute detected in JSX',
        'SEC008': 'process.env.X || "fallback" pattern detected via AST'
      };

      // JSNET001 fires per-fetch, which was loud for files with several
      // calls. Collapse to one finding per file; the count is unchanged in
      // aggregate but a single badge is enough for the user to act on.
      let jsNetEmittedForFile = false;

      // SQL sinks we consider. Property access `.prepare(` / `.query(` etc.
      // on ANY receiver (db, knex, pool, conn, prisma, supabase, ...) plus
      // bare calls that some ORMs expose.
      const sqlSinkNames = new Set([
        'prepare', 'query', 'exec', 'execute', 'run', 'raw',
        '$queryRawUnsafe', '$executeRawUnsafe', 'unsafe'
      ]);
      const isTaintedArg = (arg: ts.Node): boolean => {
        // Template literal with at least one interpolation span.
        if (tsReal.isTemplateExpression(arg) && arg.templateSpans.length > 0) return true;
        // Binary `+` concatenation anywhere on the left/right spine.
        if (tsReal.isBinaryExpression(arg) && arg.operatorToken.kind === tsReal.SyntaxKind.PlusToken) {
          return true;
        }
        return false;
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
          if (tsReal.isIdentifier(expr) && expr.text === 'fetch' && !jsNetEmittedForFile) {
            const second = node.arguments[1];
            let hasSignal = false;
            if (second && tsReal.isObjectLiteralExpression(second)) {
              hasSignal = second.properties.some(p => tsReal.isPropertyAssignment(p) && tsReal.isIdentifier(p.name) && p.name.text === 'signal');
            }
            if (!hasSignal) {
              add('JSNET001', node, RULES.JSNET001.message);
              jsNetEmittedForFile = true;
            }
          }

          // SEC020: SQL sinks called with a template literal (containing
          // interpolations) or a string concatenation. Covers the generic
          // shape that complements DRIZZLE001/PRISMA001: better-sqlite3
          // `.prepare()`, pg `.query()`, mysql2 `.execute()`, knex `.raw()`,
          // Prisma `$queryRawUnsafe()`, etc.
          let sinkName: string | undefined;
          if (tsReal.isIdentifier(expr) && sqlSinkNames.has(expr.text)) sinkName = expr.text;
          else if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name) && sqlSinkNames.has(expr.name.text)) sinkName = expr.name.text;
          if (sinkName) {
            const firstArg = node.arguments[0];
            if (firstArg && isTaintedArg(firstArg)) {
              add('SEC020', node, `SQL sink .${sinkName}() called with interpolated/concatenated string — possible SQL injection`);
            }
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


