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
    const files = await glob('**/*.{js,jsx,ts,tsx,mjs,cjs}', {
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
        'SEC021': 'Error stack serialised into an HTTP response body',
        'SEC022': 'Promise chain swallows errors with a stub value',
        'SEC023': 'Weak crypto hash (md5/sha1) used near a password/token identifier',
        'SEC024': 'Math.random() feeds a token/session-id identifier',
        'SEC025': 'redirect()/router.push()/NextResponse.redirect() takes user input directly',
        'SEC026': 'child_process.exec/execSync called with a template literal or string concat',
        'SEC027': 'path.join/resolve fed user input without a rootDir startsWith guard',
        'SEC028': 'localStorage/sessionStorage reads/writes a token-shaped key',
        'SEC029': 'Webhook route handler never verifies an incoming signature before mutating state',
        'SEC030': 'fetch() target is user-controlled in a server route — potential SSRF',
        'SEC031': 'Password/token compared with === / !== instead of a timing-safe compare',
        'NEXT004': 'Dynamic import() with non-literal argument - potential code injection',
        'JSNET001': 'fetch() call without AbortController signal in options',
        'SEC017': 'dangerouslySetInnerHTML attribute detected in JSX',
        'SEC008': 'process.env.X || "fallback" pattern detected via AST',
        'MOD001': 'Module-level side-effect call runs at import time',
        'MOD002': 'async function declared without any await/for await in body',
        'MOD003': 'Silent .catch(() => stub) hides DB/fetch errors',
        'MOD004': '≥3 `: any` annotations in a single file'
      };

      // Track named imports from 'path' / 'node:path' so bare `join(...)` /
      // `resolve(...)` calls inherit SEC027 coverage.
      const pathImportNames = new Set<string>();
      // Track bare-identifier exec-family calls imported from child_process.
      const execFamily = new Set(['exec', 'execSync', 'spawn', 'spawnSync', 'execFile', 'execFileSync']);
      const execImportNames = new Set<string>();
      // Track bare-identifier fs read/write sinks imported from fs / fs/promises.
      const fsReadFamily = new Set(['readFile', 'readFileSync', 'createReadStream']);
      const fsWriteFamily = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'createWriteStream']);
      const fsReadImportNames = new Set<string>();
      const fsWriteImportNames = new Set<string>();
      for (const stmt of sf.statements) {
        if (!tsReal.isImportDeclaration(stmt)) continue;
        if (!tsReal.isStringLiteralLike(stmt.moduleSpecifier)) continue;
        const spec = stmt.moduleSpecifier.text;
        const bindings = stmt.importClause?.namedBindings;
        if (!bindings || !tsReal.isNamedImports(bindings)) continue;
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          const local = el.name.text;
          if (spec === 'path' || spec === 'node:path') pathImportNames.add(local);
          if (spec === 'child_process' || spec === 'node:child_process') {
            if (execFamily.has(imported)) execImportNames.add(local);
          }
          if (spec === 'fs' || spec === 'node:fs' || spec === 'fs/promises' || spec === 'node:fs/promises') {
            if (fsReadFamily.has(imported)) fsReadImportNames.add(local);
            if (fsWriteFamily.has(imported)) fsWriteImportNames.add(local);
          }
        }
      }
      // Track `const pexec = promisify(exec)` aliases — treat `pexec(...)` as exec.
      for (const stmt of sf.statements) {
        if (!tsReal.isVariableStatement(stmt)) continue;
        for (const decl of stmt.declarationList.declarations) {
          if (!tsReal.isIdentifier(decl.name) || !decl.initializer) continue;
          const init = decl.initializer;
          if (!tsReal.isCallExpression(init)) continue;
          const callee = init.expression;
          const isPromisify =
            (tsReal.isIdentifier(callee) && callee.text === 'promisify') ||
            (tsReal.isPropertyAccessExpression(callee) && tsReal.isIdentifier(callee.name) && callee.name.text === 'promisify');
          if (!isPromisify) continue;
          const arg0 = init.arguments[0];
          if (arg0 && tsReal.isIdentifier(arg0) && execImportNames.has(arg0.text)) {
            execImportNames.add(decl.name.text);
          }
        }
      }

      const isRouteFile = /\/route\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file) ||
        /\/pages\/api\//.test(file) ||
        // Remix route files under app/routes/ (flat or nested).
        /(?:^|\/)app\/routes\/[^/]+\.(ts|tsx|js|jsx)$/.test(file) ||
        // SvelteKit: +server.ts / +server.js
        /(?:^|\/)\+server\.(ts|js|mjs)$/.test(file);
      const isWebhookFile = /\/webhook(?:s)?\//i.test(file) || /webhook/i.test(file);

      // JSNET001 fires per-fetch, which was loud for files with several
      // calls. Collapse to one finding per file; the count is unchanged in
      // aggregate but a single badge is enough for the user to act on.
      let jsNetEmittedForFile = false;
      let anyCount = 0;

      // SQL sinks we consider. Property access `.prepare(` / `.query(` etc.
      // on ANY receiver (db, knex, pool, conn, prisma, supabase, ...) plus
      // bare calls that some ORMs expose.
      const sqlSinkNames = new Set([
        'prepare', 'query', 'exec', 'execute', 'run', 'raw',
        '$queryRawUnsafe', '$executeRawUnsafe', 'unsafe'
      ]);
      const isTaintedArg = (arg: ts.Node): boolean => {
        if (tsReal.isTemplateExpression(arg) && arg.templateSpans.length > 0) return true;
        if (tsReal.isBinaryExpression(arg) && arg.operatorToken.kind === tsReal.SyntaxKind.PlusToken) {
          return true;
        }
        return false;
      };

      const credentialNameRe = /(password|passwd|pwd|token|secret|bearer|session|sessionid|apikey|api_key|jwt|nonce)/i;

      const add = (metaKey: keyof typeof RULES, node: ts.Node, message?: string, confidenceOverride?: number) => {
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
          confidence: confidenceOverride ?? 0.9,
          confidenceReason: confidenceReasons[meta.id] || 'AST analysis confirms pattern',
          fix: meta.fix
        });
      };

      // Helper: extract a target identifier name for variable-naming checks
      // (e.g. in `const sessionId = Math.random()`, pull `sessionId`).
      const targetName = (node: ts.Node): string | undefined => {
        let cur: ts.Node | undefined = node.parent;
        while (cur) {
          if (tsReal.isVariableDeclaration(cur) && tsReal.isIdentifier(cur.name)) return cur.name.text;
          if (tsReal.isPropertyAssignment(cur) && tsReal.isIdentifier(cur.name)) return cur.name.text;
          if (tsReal.isBinaryExpression(cur) && cur.operatorToken.kind === tsReal.SyntaxKind.EqualsToken) {
            if (tsReal.isIdentifier(cur.left)) return cur.left.text;
            if (tsReal.isPropertyAccessExpression(cur.left) && tsReal.isIdentifier(cur.left.name)) return cur.left.name.text;
          }
          cur = cur.parent;
        }
        return undefined;
      };

      // Broader credential-context check: scans ancestor chain (same statement,
      // enclosing function signature, surrounding chained call args) for any
      // identifier matching credentialNameRe. Catches patterns like
      //   return createHash('md5').update(password).digest('hex')
      // where there's no direct variable target.
      const credentialContextNearby = (node: ts.Node): boolean => {
        const tname = targetName(node);
        if (tname && credentialNameRe.test(tname)) return true;
        let stmt: ts.Node | undefined = node;
        while (stmt && !tsReal.isStatement(stmt)) stmt = stmt.parent;
        let hit = false;
        const stringIsCredential = (s: string): boolean => {
          // Only accept tight credential-keyname shapes (e.g. 'password',
          // 'api_key', 'authToken') — not sentences or dotted event names
          // like 'checkout.session.completed' that happen to contain 'session'.
          if (s.length > 32) return false;
          if (!credentialNameRe.test(s)) return false;
          if (/[\s/.]/.test(s)) return false;
          return true;
        };
        // Identifiers that happen to contain a credential-word but aren't
        // credentials — drops SEC031 false-positives in code that handles
        // storage or session infrastructure rather than the secret itself.
        const identIsCredential = (name: string): boolean => {
          if (/^(localStorage|sessionStorage|sessionId|SessionStorage)$/.test(name)) return false;
          if (/Storage$/.test(name)) return false;
          return credentialNameRe.test(name);
        };
        const walk = (n: ts.Node): void => {
          if (hit) return;
          if (tsReal.isIdentifier(n) && identIsCredential(n.text)) { hit = true; return; }
          if (tsReal.isStringLiteralLike(n) && stringIsCredential(n.text)) { hit = true; return; }
          tsReal.forEachChild(n, walk);
        };
        if (stmt) walk(stmt);
        if (hit) return true;
        let cur: ts.Node | undefined = node.parent;
        while (cur) {
          if (tsReal.isFunctionDeclaration(cur) || tsReal.isFunctionExpression(cur) ||
              tsReal.isArrowFunction(cur) || tsReal.isMethodDeclaration(cur)) {
            if ((cur as ts.SignatureDeclaration).name &&
                tsReal.isIdentifier((cur as any).name) &&
                credentialNameRe.test((cur as any).name.text)) return true;
            const params = (cur as ts.SignatureDeclaration).parameters;
            if (params) {
              for (const p of params) {
                if (tsReal.isIdentifier(p.name) && credentialNameRe.test(p.name.text)) return true;
              }
            }
            break;
          }
          cur = cur.parent;
        }
        return false;
      };

      const indicatorNames = new Set(['req', 'request', 'body', 'params', 'searchParams', 'query', 'formData', 'input', 'payload', 'ctx']);
      // Local bindings whose initializer came from an indicator-named source.
      // Pre-computed so taint propagates one hop through:
      //   const next = url.searchParams.get('next') ?? '/';
      //   redirect(next)  // still tainted
      const taintedLocalNames = new Set<string>();
      const rhsMentionsIndicator = (n: ts.Node): boolean => {
        const walk = (x: ts.Node): boolean => {
          if (tsReal.isIdentifier(x) && indicatorNames.has(x.text)) return true;
          let hit = false;
          tsReal.forEachChild(x, (c) => { if (!hit) hit = walk(c); });
          return hit;
        };
        return walk(n);
      };
      const collectTaintedLocals = (n: ts.Node): void => {
        if (tsReal.isVariableDeclaration(n) && n.initializer && tsReal.isIdentifier(n.name)) {
          if (rhsMentionsIndicator(n.initializer)) taintedLocalNames.add(n.name.text);
        }
        // Destructured: `const { foo } = body` — each property becomes tainted.
        if (tsReal.isVariableDeclaration(n) && n.initializer && tsReal.isObjectBindingPattern(n.name)) {
          if (rhsMentionsIndicator(n.initializer)) {
            for (const el of n.name.elements) {
              if (tsReal.isIdentifier(el.name)) taintedLocalNames.add(el.name.text);
            }
          }
        }
        tsReal.forEachChild(n, collectTaintedLocals);
      };
      collectTaintedLocals(sf);

      const callContainsUserInput = (args: readonly ts.Expression[]): boolean => {
        const walk = (n: ts.Node): boolean => {
          if (tsReal.isIdentifier(n) && (indicatorNames.has(n.text) || taintedLocalNames.has(n.text))) return true;
          if (tsReal.isPropertyAccessExpression(n)) {
            if (tsReal.isIdentifier(n.expression) && indicatorNames.has(n.expression.text)) return true;
            return walk(n.expression);
          }
          if (tsReal.isElementAccessExpression(n)) return walk(n.expression);
          if (tsReal.isCallExpression(n)) return n.arguments.some(walk) || walk(n.expression);
          let hit = false;
          tsReal.forEachChild(n, (c) => { if (!hit) hit = walk(c); });
          return hit;
        };
        return args.some(walk);
      };

      // Count top-level module statements that are standalone side-effect
      // calls. Requires the module to also export at least one symbol.
      const moduleStatements = sf.statements;
      const moduleExportsSomething = moduleStatements.some((s) =>
        (tsReal.isFunctionDeclaration(s) || tsReal.isVariableStatement(s) || tsReal.isClassDeclaration(s)) &&
        s.modifiers?.some((mod) => mod.kind === tsReal.SyntaxKind.ExportKeyword)
      ) || moduleStatements.some((s) => tsReal.isExportAssignment(s) || tsReal.isExportDeclaration(s));

      if (moduleExportsSomething) {
        for (const stmt of moduleStatements) {
          if (!tsReal.isExpressionStatement(stmt)) continue;
          const expr = stmt.expression;
          if (!tsReal.isCallExpression(expr)) continue;
          const callee = expr.expression;
          const sideEffectIdents = new Set(['fetch']);
          const sideEffectMembers = new Set([
            'exec', 'execSync', 'readFileSync', 'writeFileSync', 'appendFileSync',
            'unlinkSync', 'mkdirSync', 'rmSync',
            // DB / infra client lifecycle that ships data at import time.
            '$connect', '$disconnect', 'connect', 'authenticate', 'initialize',
            'sync', 'migrate', 'listen', 'subscribe'
          ]);
          let isSide = false;
          if (tsReal.isIdentifier(callee) && sideEffectIdents.has(callee.text)) isSide = true;
          if (tsReal.isPropertyAccessExpression(callee) && tsReal.isIdentifier(callee.name)) {
            if (sideEffectMembers.has(callee.name.text)) isSide = true;
            if (callee.name.text === 'exec' || callee.name.text === 'execute' || callee.name.text === 'run') isSide = true;
          }
          if (isSide) add('MOD001', expr);
        }
      }

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

          // SEC020: SQL sink called with interpolated/concatenated string.
          let sinkName: string | undefined;
          if (tsReal.isIdentifier(expr) && sqlSinkNames.has(expr.text)) sinkName = expr.text;
          else if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name) && sqlSinkNames.has(expr.name.text)) sinkName = expr.name.text;
          if (sinkName) {
            const firstArg = node.arguments[0];
            if (firstArg && isTaintedArg(firstArg)) {
              add('SEC020', node, `SQL sink .${sinkName}() called with interpolated/concatenated string — possible SQL injection`);
            }
          }

          // SEC023: crypto.createHash('md5'|'sha1') feeding a password/token identifier.
          if (tsReal.isIdentifier(expr) && expr.text === 'createHash') {
            const arg0 = node.arguments[0];
            if (arg0 && tsReal.isStringLiteralLike(arg0)) {
              const algo = arg0.text.toLowerCase();
              if (algo === 'md5' || algo === 'sha1') {
                if (credentialContextNearby(node)) add('SEC023', node);
              }
            }
          }
          if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name) && expr.name.text === 'createHash') {
            const arg0 = node.arguments[0];
            if (arg0 && tsReal.isStringLiteralLike(arg0)) {
              const algo = arg0.text.toLowerCase();
              if (algo === 'md5' || algo === 'sha1') {
                if (credentialContextNearby(node)) add('SEC023', node);
              }
            }
          }

          // SEC024: Math.random() assigned to a token/session identifier.
          // Require a tight credential-shaped name. `sessionsPerDay`,
          // `tokenPosition`, `bearerCount` are not credentials; a blanket
          // substring match caused false-positives on business-logic counters.
          if (tsReal.isPropertyAccessExpression(expr) &&
              tsReal.isIdentifier(expr.expression) && expr.expression.text === 'Math' &&
              tsReal.isIdentifier(expr.name) && expr.name.text === 'random') {
            const tname = targetName(node);
            const tight = /^(token|authToken|accessToken|refreshToken|sessionId|session_id|sessionToken|apiKey|api_key|password|secret|bearer|bearerToken|nonce|csrf|csrfToken|jwt|otp|resetToken|verificationToken|inviteToken|[a-zA-Z]+Id)$/;
            if (tname && tight.test(tname)) {
              add('SEC024', node);
            }
          }

          // SEC025: redirect()/router.push()/NextResponse.redirect() with user input.
          // `.push`/`.replace` are only treated as router navigation when the
          // receiver identifier looks like a router/history/navigation object —
          // `arr.push(x)` and `results.push(x)` must not fire.
          let isRedirect = false;
          if (tsReal.isIdentifier(expr) && expr.text === 'redirect') {
            isRedirect = true;
          } else if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name)) {
            if (expr.name.text === 'redirect') {
              isRedirect = true;
            } else if (expr.name.text === 'push' || expr.name.text === 'replace') {
              const receiver = tsReal.isIdentifier(expr.expression) ? expr.expression.text : '';
              if (/^(router|history|navigation|nav)$/i.test(receiver)) isRedirect = true;
            }
          }
          if (isRedirect && node.arguments.length > 0) {
            // Skip literals.
            const a0 = node.arguments[0];
            const isLiteral = tsReal.isStringLiteralLike(a0) ||
              (tsReal.isTemplateExpression(a0) && a0.templateSpans.length === 0) ||
              (tsReal.isNoSubstitutionTemplateLiteral(a0));
            if (!isLiteral && callContainsUserInput(node.arguments)) {
              add('SEC025', node);
            }
          }

          // SEC026: child_process.exec / execSync / spawn / spawnSync with a
          // tainted argument. Covers three call shapes:
          //   childProcess.exec(cmd)           — member access
          //   exec(cmd)                        — named import
          //   pexec(cmd) where pexec = promisify(exec)
          {
            let execLikeName: string | undefined;
            if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name)) {
              // Skip SQL clients — `db.exec(...)` / `knex.exec(...)` is a SQL
              // sink, not a shell. SEC020 already catches the interpolation.
              const receiver = tsReal.isIdentifier(expr.expression) ? expr.expression.text.toLowerCase() : '';
              const isSqlReceiver = /^(db|sqlite|database|knex|pool|conn|connection|client|pg|postgres|mysql|prisma|drizzle|sql|tx|trx|handle)$/.test(receiver);
              if (execFamily.has(expr.name.text) && !isSqlReceiver) execLikeName = expr.name.text;
            } else if (tsReal.isIdentifier(expr) && execImportNames.has(expr.text)) {
              execLikeName = expr.text;
            }
            if (execLikeName) {
              const a0 = node.arguments[0];
              const tainted = !!a0 && (isTaintedArg(a0) ||
                callContainsUserInput(node.arguments) ||
                // Promisified alias: the tainted value often arrives as a
                // plain identifier named like a user input (`cmd`, `path`,
                // `input`, `command`, `script`).
                (tsReal.isIdentifier(a0) && /^(cmd|command|script|input|args?|path|file|name)$/i.test(a0.text)));
              if (tainted) {
                if (execLikeName.startsWith('execFile') && node.arguments[1] && tsReal.isArrayLiteralExpression(node.arguments[1])) {
                  // execFile with an array args list is safe by construction.
                } else {
                  add('SEC026', node);
                }
              }
            }
          }

          // SEC027: path.join(...) fed with user input, without a nearby startsWith guard.
          // Also triggers for `join(...)` / `resolve(...)` when those names are
          // named-imported from 'path'.
          const isPathMember = tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.expression) &&
              expr.expression.text === 'path' && tsReal.isIdentifier(expr.name) &&
              (expr.name.text === 'join' || expr.name.text === 'resolve');
          const isPathBare = tsReal.isIdentifier(expr) &&
              (expr.text === 'join' || expr.text === 'resolve' || expr.text === 'normalize') &&
              pathImportNames.has(expr.text);
          if (isPathMember || isPathBare) {
            const directTaint = callContainsUserInput(node.arguments);
            const pos = node.getStart();
            const windowText = sourceText.slice(Math.max(0, pos - 500), Math.min(sourceText.length, pos + 500));
            const hasGuard = /\.startsWith\(|path\.normalize\(/.test(windowText);
            const fileTaint = isRouteFile && (
              /(?:formData|searchParams|body|query)[^;\n]*\.get\(/i.test(sourceText) ||
              /\breq\.(?:json|text|formData|body)\s*\(/i.test(sourceText)
            );
            if (!hasGuard && (directTaint || (fileTaint && node.arguments.some((a) => tsReal.isIdentifier(a))))) {
              add('SEC027', node, undefined, directTaint ? 0.9 : 0.75);
            }
          }

          // SEC027: direct fs.readFile / writeFile / readFileSync / writeFileSync
          // / createReadStream / createWriteStream with a tainted first argument
          // and no nearby allowlist guard. Catches the AI-tool shape:
          //   execute: async ({ path }) => readFile(path, 'utf-8')
          // Identifier-shape fallback (`readFileSync(file, …)` where `file` is
          // a plain local) is gated on the file clearly handling untrusted
          // request input — otherwise scripts iterating their own tree (a loop
          // variable called `file`) get flagged spuriously.
          {
            let fsSinkName: string | undefined;
            if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name)) {
              const n = expr.name.text;
              if (fsReadFamily.has(n) || fsWriteFamily.has(n)) fsSinkName = n;
            } else if (tsReal.isIdentifier(expr)) {
              if (fsReadImportNames.has(expr.text) || fsWriteImportNames.has(expr.text)) {
                fsSinkName = expr.text;
              }
            }
            if (fsSinkName) {
              const a0 = node.arguments[0];
              if (a0 && !tsReal.isStringLiteralLike(a0)) {
                const directTaint = callContainsUserInput([a0]);
                const pos = node.getStart();
                const windowText = sourceText.slice(Math.max(0, pos - 500), Math.min(sourceText.length, pos + 500));
                const hasGuard = /\.startsWith\(|path\.normalize\(|allow(?:ed)?[A-Z_]|ALLOWLIST/.test(windowText);
                // An AI SDK `tool({ execute: async ({ path }) => … })` is an
                // attacker-controlled surface even if the file never touches a
                // Request object — the LLM decides the argument.
                const importsAiSdk = /from\s+['"](?:ai|@ai-sdk\/|@anthropic-ai\/sdk)/.test(sourceText);
                const fileHandlesRequest = importsAiSdk ||
                  /\breq\.(?:json|text|formData|body)\s*\(|\bsearchParams\b|\bformData\s*\(\)|\brequest\.(?:json|text|formData)\s*\(/i.test(sourceText);
                const identShape = tsReal.isIdentifier(a0) && /^(path|file|filename|filepath|target|dest|destination)$/i.test(a0.text);
                const identTaint = identShape && fileHandlesRequest;
                if (!hasGuard && (directTaint || identTaint)) {
                  add('SEC027', node, undefined, directTaint ? 0.9 : 0.75);
                }
              }
            }
          }

          // SEC028: localStorage / sessionStorage with a credential-shaped key.
          // Matches both setItem (writing the token) and getItem (reading it
          // back for use in a bearer header, which still round-trips through
          // untrusted browser storage).
          if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.expression) &&
              (expr.expression.text === 'localStorage' || expr.expression.text === 'sessionStorage') &&
              tsReal.isIdentifier(expr.name) &&
              (expr.name.text === 'setItem' || expr.name.text === 'getItem')) {
            const a0 = node.arguments[0];
            if (a0 && tsReal.isStringLiteralLike(a0) && credentialNameRe.test(a0.text)) {
              add('SEC028', node);
            }
          }

          // SEC030: SSRF — fetch() in a server route where the URL comes from
          // a request-shaped identifier (req/body/params/searchParams/input),
          // or — weaker — where the file clearly destructures from req.json()
          // / req.body / searchParams and the fetch() arg isn't a literal.
          if (isRouteFile && tsReal.isIdentifier(expr) && expr.text === 'fetch' && node.arguments.length > 0) {
            const a0 = node.arguments[0];
            if (!tsReal.isStringLiteralLike(a0)) {
              const directTaint = callContainsUserInput([a0]);
              const fileTaint = /\breq\.(?:json|text|formData|body)\s*\(/i.test(sourceText) ||
                /\bsearchParams\s*\./.test(sourceText);
              if (directTaint) add('SEC030', node);
              else if (fileTaint && tsReal.isIdentifier(a0)) add('SEC030', node, undefined, 0.75);
            }
          }

          // SEC022 / MOD003: silent `.catch(() => [] | {} | null | undefined)`.
          if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name) && expr.name.text === 'catch') {
            const a0 = node.arguments[0];
            if (a0 && tsReal.isArrowFunction(a0)) {
              const body = a0.body;
              const isStub =
                tsReal.isArrayLiteralExpression(body) ||
                tsReal.isObjectLiteralExpression(body) ||
                (tsReal.isIdentifier(body) && (body.text === 'undefined' || body.text === 'null')) ||
                body.kind === tsReal.SyntaxKind.NullKeyword;
              if (isStub) {
                add('SEC022', node);
                add('MOD003', node);
              }
            }
          }

          // SEC021: err.stack / error.stack returned or serialised into a response.
          // Detect common patterns: NextResponse.json({ error: err.stack }), res.status(500).json(err),
          // res.send(err.stack), c.json({ error: err.stack }), JSON.stringify({ stack: err.stack }).
          const walkForStack = (n: ts.Node): boolean => {
            if (tsReal.isPropertyAccessExpression(n) && tsReal.isIdentifier(n.name) && n.name.text === 'stack') return true;
            let hit = false;
            tsReal.forEachChild(n, (c) => { if (!hit) hit = walkForStack(c); });
            return hit;
          };
          if (tsReal.isPropertyAccessExpression(expr) && tsReal.isIdentifier(expr.name)) {
            const name = expr.name.text;
            if (['json', 'send', 'stringify'].includes(name)) {
              if (node.arguments.some(walkForStack)) add('SEC021', node);
            }
          }
        }

        // dangerouslySetInnerHTML
        if (tsReal.isIdentifier(node) && node.text === 'dangerouslySetInnerHTML') {
          add('SEC017', node);
        }

        // SEC031: timing-unsafe password / token comparison using === / !==.
        // Fires when both sides are non-trivial identifiers/property-accesses
        // (not null/undefined/true/false/numeric literals) AND the enclosing
        // function / surrounding statement is credential-shaped.
        if (tsReal.isBinaryExpression(node) &&
            (node.operatorToken.kind === tsReal.SyntaxKind.EqualsEqualsEqualsToken ||
             node.operatorToken.kind === tsReal.SyntaxKind.ExclamationEqualsEqualsToken ||
             node.operatorToken.kind === tsReal.SyntaxKind.EqualsEqualsToken ||
             node.operatorToken.kind === tsReal.SyntaxKind.ExclamationEqualsToken)) {
          const isTrivialSentinel = (n: ts.Node): boolean => {
            if (n.kind === tsReal.SyntaxKind.NullKeyword) return true;
            if (n.kind === tsReal.SyntaxKind.UndefinedKeyword) return true;
            if (n.kind === tsReal.SyntaxKind.TrueKeyword) return true;
            if (n.kind === tsReal.SyntaxKind.FalseKeyword) return true;
            if (tsReal.isIdentifier(n) && (n.text === 'undefined' || n.text === 'null')) return true;
            if (tsReal.isNumericLiteral(n)) return true;
            if (tsReal.isStringLiteralLike(n) && n.text.length < 8) return true;
            return false;
          };
          const bothMeaningful = !isTrivialSentinel(node.left) && !isTrivialSentinel(node.right);
          // Require one operand to *itself* be credential-shaped. Nearby
          // context alone (e.g. an unrelated function that mentions
          // `sessionStorage` or AST nodes named `EqualsEqualsEqualsToken`)
          // produced heavy false-positives on non-credential code.
          const operandIsCredential = (op: ts.Node): boolean => {
            if (tsReal.isIdentifier(op)) {
              return /^(password|passwd|pwd|secret|apiKey|api_key|token|authToken|accessToken|refreshToken|bearerToken|sessionToken|jwt|hash|hashed|hashedPassword|hashed_password|digest|nonce)$/i.test(op.text);
            }
            if (tsReal.isPropertyAccessExpression(op) && tsReal.isIdentifier(op.name)) {
              return /^(password|passwd|pwd|secret|apiKey|api_key|token|authToken|accessToken|refreshToken|bearerToken|sessionToken|jwt|hash|hashed|hashedPassword|hashed_password|digest|nonce)$/i.test(op.name.text);
            }
            return false;
          };
          if (bothMeaningful && (operandIsCredential(node.left) || operandIsCredential(node.right))) {
            add('SEC031', node);
          }
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

        // MOD002: async function with no await / for-await in its body.
        if ((tsReal.isFunctionDeclaration(node) || tsReal.isFunctionExpression(node) || tsReal.isArrowFunction(node) || tsReal.isMethodDeclaration(node)) &&
            node.modifiers?.some((m) => m.kind === tsReal.SyntaxKind.AsyncKeyword) &&
            node.body) {
          const body: ts.Node = node.body;
          let hasAwait = false;
          const scan = (n: ts.Node) => {
            if (hasAwait) return;
            if (tsReal.isAwaitExpression(n)) { hasAwait = true; return; }
            if (tsReal.isForOfStatement(n) && n.awaitModifier) { hasAwait = true; return; }
            // Don't descend into nested functions — their awaits don't count.
            if (tsReal.isFunctionLike(n) && n !== node) return;
            tsReal.forEachChild(n, scan);
          };
          scan(body);
          if (!hasAwait) add('MOD002', node, undefined, 0.8);
        }

        // MOD004: count `: any` annotations in the file.
        if (tsReal.isTypeReferenceNode(node) && tsReal.isIdentifier(node.typeName) && node.typeName.text === 'any') {
          anyCount++;
        }
        if (node.kind === tsReal.SyntaxKind.AnyKeyword) {
          anyCount++;
        }

        tsReal.forEachChild(node, visit);
      };

      visit(sf);

      // SEC029: webhook route handler with no signature verification.
      // Heuristics: file path contains /webhook/, file exports async POST (or
      // default handler), and no signature-verifying call appears in source.
      if (isRouteFile && isWebhookFile) {
        const sigRe = /webhooks?\.constructEvent|constructEventAsync|verifyHeader|verify(?:Webhook)?Signature|svix|timingSafeEqual|createHmac|\.verify\(/;
        // Strip // line comments and /* */ block comments so a literal mention
        // of the API inside a comment doesn't mask a real missing call.
        const stripped = sourceText
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
        const hasPost = /export\s+(?:async\s+)?(?:const|function)\s+POST\b|export\s+\{\s*[^}]*\bPOST\b|as\s+POST\b|export\s+default\s+(?:async\s+)?function|export\s+(?:async\s+)?(?:const|function)\s+action\b/i.test(stripped);
        if (hasPost && !sigRe.test(stripped)) {
          const meta = RULES['SEC029'];
          if (meta) {
            results.push({
              type: 'error',
              category: meta.category,
              message: meta.message,
              file,
              line: 1,
              range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
              severity: meta.severity,
              ruleId: meta.id,
              match: '',
              confidence: 0.85,
              confidenceReason: confidenceReasons['SEC029'],
              fix: meta.fix
            });
          }
        }
      }

      if (anyCount >= 3) {
        const meta = RULES['MOD004'];
        if (meta) {
          results.push({
            type: 'warning',
            category: meta.category,
            message: `${meta.message} (${anyCount} occurrences)`,
            file,
            line: 1,
            range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 1 },
            severity: meta.severity,
            ruleId: meta.id,
            match: '',
            confidence: 0.7,
            confidenceReason: confidenceReasons['MOD004'],
            fix: meta.fix
          });
        }
      }
    }

    return results;
  }
}
