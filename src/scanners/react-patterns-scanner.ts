import { ScanOptions, ScanResult } from '../types';
import { BaseScanner } from './base-scanner';
import { getRule } from '../rules';
import { redact } from '../utils/redact';

/**
 * ReactPatternsScanner — the "vibe-coded React" class of bugs.
 *
 * Targets AI-generated React output: array-index keys, render-time handler
 * calls, in-place state mutation, useEffect hazards (missing cleanup, async
 * body, no AbortController, stale closures), lazy-init mistakes, conditional
 * hooks, and JWTs in localStorage.
 *
 * All detections are regex/heuristic. Each finding carries a confidence in
 * [0.6, 0.95] and a `confidenceReason` so the reporter can triage noise.
 */
export class ReactPatternsScanner extends BaseScanner {
  name = 'React Patterns Scanner';

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    this.initCache(options, 'react-patterns:1');

    for await (const ctx of this.iterateFiles(
      options,
      '**/*.{jsx,tsx}',
      ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'coverage/**']
    )) {
      if (this.hasFileSuppression(ctx.lines)) continue;
      const cached = this.getCached(ctx.file, ctx.contentHash);
      if (cached) {
        results.push(...cached);
        continue;
      }

      const fileResults: ScanResult[] = [];
      fileResults.push(...this.detectIndexAsKey(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectHandlerInvokedAtRender(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectStateMutation(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectUseEffectHazards(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectUseStateEagerInit(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectConditionalHook(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectRefAssignDuringRender(ctx.file, ctx.content, ctx.lines));
      fileResults.push(...this.detectTokenInLocalStorage(ctx.file, ctx.content, ctx.lines));

      this.setCached(ctx.file, ctx.contentHash, fileResults);
      results.push(...fileResults);
    }

    this.saveCache();
    return results;
  }

  private push(
    out: ScanResult[],
    ruleId: string,
    file: string,
    lineIndex: number,
    lines: string[],
    confidence: number,
    confidenceReason: string,
    extraMessage?: string
  ): void {
    if (this.isSuppressed(lines, lineIndex, ruleId)) return;
    const meta = getRule(ruleId)?.meta;
    if (!meta) return;
    const lineText = lines[lineIndex] ?? '';
    out.push(
      this.createResult(
        {
          type: meta.severity === 'high' ? 'error' : 'warning',
          category: meta.category,
          severity: meta.severity,
          ruleId: meta.id,
          message: extraMessage ? `${meta.message} — ${extraMessage}` : meta.message,
          fix: meta.fix,
          file,
          line: lineIndex + 1,
          match: redact((lineText).trim().slice(0, 200)),
          confidence,
          confidenceReason
        },
        lineText
      )
    );
  }

  // ---- REACT001: `key={i}` / `key={index}` inside .map((_, i) => …) -----

  private detectIndexAsKey(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Find .map((x, i) => …). Treat the identifier captured in position 2
    // as the index variable; if a later `key={ident}` appears before the
    // closing `)`, flag it.
    const mapRegex = /\.map\s*\(\s*(?:\(|)\s*[^,)]+?\s*,\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>/g;
    let m: RegExpExecArray | null;
    while ((m = mapRegex.exec(content))) {
      const indexVar = m[1];
      // Scan forward until we find a matching `)` at depth 0 — good enough
      // for JSX which nests `<Comp key={i} />` inside the arrow body.
      const start = m.index + m[0].length;
      let depth = 1;
      let j = start;
      while (j < content.length && depth > 0) {
        const ch = content[j];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        j++;
      }
      const chunk = content.slice(start, j);
      const keyRegex = new RegExp(`\\bkey\\s*=\\s*\\{\\s*${indexVar}\\s*\\}`, 'g');
      let km: RegExpExecArray | null;
      while ((km = keyRegex.exec(chunk))) {
        const abs = start + km.index;
        const lineIndex = content.slice(0, abs).split('\n').length - 1;
        this.push(out, 'REACT001', file, lineIndex, lines, 0.9,
          `React.map callback exposes index \`${indexVar}\` and uses it as \`key={${indexVar}}\`.`
        );
      }
    }
    return out;
  }

  // ---- REACT002: onClick={fn()} / onChange={fn()} -----------------------
  // Event attribute value is a call, not an identifier or arrow function.

  private detectHandlerInvokedAtRender(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    const handlerRegex = /\bon(?:Click|Change|Submit|Blur|Focus|MouseEnter|MouseLeave|KeyDown|KeyUp|KeyPress|Input|Scroll|Touch[A-Z]\w*)\s*=\s*\{\s*([^}]+)\s*\}/g;
    let m: RegExpExecArray | null;
    while ((m = handlerRegex.exec(content))) {
      const inner = m[1].trim();
      // Ignore: identifier, property access (this.foo), arrow functions, `()=>…`, bind/call forms.
      if (!inner.includes('(')) continue;
      if (/^[A-Za-z_$][\w$.]*$/.test(inner)) continue;
      if (/=>/.test(inner)) continue;
      if (/\.bind\(/.test(inner)) continue;
      // Pattern: identifier(optionalArgs) with no arrow
      if (!/^[A-Za-z_$][\w$.]*\s*\(/.test(inner)) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      this.push(out, 'REACT002', file, lineIndex, lines, 0.85,
        'Event attribute binds a call expression (invoked at render) instead of a function reference.'
      );
    }
    return out;
  }

  // ---- REACT003: arr.push(x); setArr(arr) or obj.foo = …; setObj(obj) ---

  private detectStateMutation(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Find `const [arr, setArr] = useState(...)` pairs, then look for
    // `arr.push(...)` / `arr[i] = ...` / `arr.foo = ...` followed by a
    // setArr(arr) call within ~20 lines.
    const pairRegex = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\b/g;
    let m: RegExpExecArray | null;
    while ((m = pairRegex.exec(content))) {
      const value = m[1];
      const setter = m[2];
      const searchStart = m.index + m[0].length;
      const searchEnd = Math.min(content.length, searchStart + 4000);
      const window = content.slice(searchStart, searchEnd);
      const mutationRegex = new RegExp(
        `\\b${value}\\.(push|pop|shift|unshift|splice|sort|reverse)\\(|` +
        `\\b${value}\\[[^\\]]+\\]\\s*=|` +
        `\\b${value}\\.[A-Za-z_$][\\w$]*\\s*=(?!=)`,
        'g'
      );
      let mut: RegExpExecArray | null;
      while ((mut = mutationRegex.exec(window))) {
        const after = window.slice(mut.index, Math.min(window.length, mut.index + 1000));
        const setterRegex = new RegExp(`\\b${setter}\\(\\s*${value}\\b`);
        if (!setterRegex.test(after)) continue;
        const abs = searchStart + mut.index;
        const lineIndex = content.slice(0, abs).split('\n').length - 1;
        this.push(out, 'REACT003', file, lineIndex, lines, 0.8,
          `\`${value}\` is mutated in place, then passed to its own setter \`${setter}\` — React will not re-render.`
        );
      }
    }
    return out;
  }

  // ---- REACT004-007: useEffect hazards ---------------------------------

  private detectUseEffectHazards(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Walk each `useEffect(` and capture the callback + dep array (best-effort).
    // Not full AST — good enough for flagging the common shapes.
    const effectRegex = /\buseEffect\s*\(\s*/g;
    let m: RegExpExecArray | null;
    while ((m = effectRegex.exec(content))) {
      const startBody = m.index + m[0].length;

      // REACT007: async function passed directly. Check the first ~20 chars.
      const lead = content.slice(startBody, startBody + 40).trim();
      if (/^async\s*(\(|function)/.test(lead)) {
        const lineIndex = content.slice(0, m.index).split('\n').length - 1;
        this.push(out, 'REACT007', file, lineIndex, lines, 0.95,
          'Callback starts with `async` — useEffect treats the returned Promise as a cleanup function.'
        );
      }

      // Find the matching close-paren of the useEffect(...) call.
      let depth = 1;
      let j = startBody;
      let inString: string | null = null;
      let inTemplate = false;
      while (j < content.length && depth > 0) {
        const ch = content[j];
        const prev = content[j - 1];
        if (inString) {
          if (ch === inString && prev !== '\\') inString = null;
        } else if (inTemplate) {
          if (ch === '`' && prev !== '\\') inTemplate = false;
        } else {
          if (ch === '"' || ch === "'") inString = ch;
          else if (ch === '`') inTemplate = true;
          else if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        j++;
      }
      const body = content.slice(startBody, j - 1);

      // Split into `callback, deps` by walking the top-level comma.
      const callbackEnd = this.findTopLevelComma(body);
      const callback = callbackEnd >= 0 ? body.slice(0, callbackEnd) : body;
      const depsRaw = callbackEnd >= 0 ? body.slice(callbackEnd + 1).trim() : '';
      const hasEmptyDeps = /^\[\s*\]/.test(depsRaw);
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;

      // REACT005: timer/listener without cleanup.
      const startsTimer = /\b(setInterval|setTimeout|addEventListener)\s*\(/.test(callback);
      if (startsTimer) {
        const returnsCleanup = /\breturn\s*(?:\(\s*\)\s*=>|function\s*\()/.test(callback)
          || /\breturn\s+[A-Za-z_$][\w$]*\s*;?\s*[}\n]/.test(callback); // return handlerRef
        if (!returnsCleanup) {
          this.push(out, 'REACT005', file, lineIndex, lines, 0.85,
            'Effect starts a timer or listener but the callback does not return a cleanup function.'
          );
        }
      }

      // REACT006: fetch without AbortController signal.
      if (/\bfetch\s*\(/.test(callback) && !/\bsignal\s*:/.test(callback) && !/AbortController/.test(callback)) {
        this.push(out, 'REACT006', file, lineIndex, lines, 0.8,
          'Effect issues fetch without an AbortController signal — stray responses after unmount.'
        );
      }

      // REACT004: stale closure — empty deps, callback reads an identifier
      // that looks like a state/prop captured from scope (simple heuristic:
      // any identifier also referenced by a `const [x, setX] = useState(...)`
      // in this file).
      if (hasEmptyDeps) {
        const statePairs = new Set<string>();
        const pairRegex = /const\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*[A-Za-z_$][\w$]*\s*\]\s*=\s*useState\b/g;
        let pm: RegExpExecArray | null;
        while ((pm = pairRegex.exec(content))) statePairs.add(pm[1]);
        for (const name of statePairs) {
          const isReferenced = new RegExp(`\\b${name}\\b`).test(callback);
          const isSet = new RegExp(`\\bset${name[0].toUpperCase()}${name.slice(1)}\\s*\\(\\s*(?:prev|p|c)\\s*=>`).test(callback);
          if (isReferenced && !isSet) {
            this.push(out, 'REACT004', file, lineIndex, lines, 0.65,
              `Empty deps, but callback reads state \`${name}\` — effect snapshots the first-render value.`
            );
            break;
          }
        }
      }
    }
    return out;
  }

  private findTopLevelComma(src: string): number {
    let depth = 0;
    let inString: string | null = null;
    let inTemplate = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      const prev = src[i - 1];
      if (inString) {
        if (ch === inString && prev !== '\\') inString = null;
        continue;
      }
      if (inTemplate) {
        if (ch === '`' && prev !== '\\') inTemplate = false;
        continue;
      }
      if (ch === '"' || ch === "'") { inString = ch; continue; }
      if (ch === '`') { inTemplate = true; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (ch === ',' && depth === 0) return i;
    }
    return -1;
  }

  // ---- REACT008: useState(call()) (non-lazy initializer) ----------------

  private detectUseStateEagerInit(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Flag `useState(<identifier>(...))` or `useState(<expr>.<fn>(...))`.
    // Skip literals, template literals, arrow-wrapped initializers.
    const regex = /useState\s*\(\s*([^)]+?)\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      const arg = m[1].trim();
      if (!arg) continue;
      if (/^\(\s*\)\s*=>/.test(arg)) continue; // () => ...
      if (/^\w+\s*=>/.test(arg)) continue; // x => ...
      if (/^function\b/.test(arg)) continue;
      if (/^['"`]/.test(arg)) continue; // string literal
      if (/^[0-9]/.test(arg)) continue; // numeric
      if (/^(true|false|null|undefined)\b/.test(arg)) continue;
      if (/^\[/.test(arg) || /^\{/.test(arg)) continue; // array / object literal
      // Heuristic: looks like an identifier-call (`x()` / `x.y()` / `new X()`).
      if (!/[A-Za-z_$][\w$.]*\s*\(/.test(arg)) continue;
      // Exclude readonly pure calls commonly seen as initializers (e.g. `Math.min(...)`)?
      // We still flag — it's noise-but-correct, and we can suppress via confidence.
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      this.push(out, 'REACT008', file, lineIndex, lines, 0.65,
        'Initializer is a function call — use `useState(() => ...)` so it runs only on mount.'
      );
    }
    return out;
  }

  // ---- REACT009: conditional hook call ----------------------------------

  private detectConditionalHook(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Very targeted: find `if (...) <ws> useX(` / `else if (...) <ws> useX(`.
    // Also flag ternary hooks: `cond ? useX(...) : useY(...)`.
    const ifRegex = /\b(?:if|else if|while|for)\b[^{]*?{[^}]*?\buse[A-Z]\w*\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = ifRegex.exec(content))) {
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      this.push(out, 'REACT009', file, lineIndex, lines, 0.85,
        'Hook is called inside a conditional/loop block — React requires hooks to run in the same order every render.'
      );
    }
    const ternaryRegex = /\?\s*use[A-Z]\w*\s*\(/g;
    while ((m = ternaryRegex.exec(content))) {
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      this.push(out, 'REACT009', file, lineIndex, lines, 0.85,
        'Hook is called inside a ternary — React requires hooks to run in the same order every render.'
      );
    }
    return out;
  }

  // ---- REACT010: ref.current = … during render --------------------------

  private detectRefAssignDuringRender(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // Find function components (`function Foo(...) { ... }` / `const Foo = (...) => { ... }`)
    // and look for `<ident>.current = ` outside any useEffect/handler.
    // Simpler heuristic: find `.current = ` lines and check that the
    // nearest enclosing arrow or function on the same scope doesn't start
    // with a `useEffect(` wrapper within 200 chars above.
    const regex = /\b([A-Za-z_$][\w$]*)\.current\s*=(?!=)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      // Look backwards up to 400 chars for a enclosing callback marker.
      const look = content.slice(Math.max(0, m.index - 400), m.index);
      const inEffect = /useEffect\s*\(/.test(look) && !/useEffect\s*\([\s\S]*?\)\s*$/.test(look);
      const inHandler = /on[A-Z]\w*\s*=\s*\{/.test(look) || /=>\s*{[^}]*$/.test(look);
      const inRef = /useRef\s*\(/.test(lines[lineIndex] || '');
      if (inEffect || inHandler || inRef) continue;
      // Also skip module-level top-level code (not inside a component function).
      // Heuristic: must be inside a function whose body contains JSX (`return (`).
      const after = content.slice(m.index, Math.min(content.length, m.index + 2000));
      if (!/return\s*\(/.test(after) && !/<\w/.test(after)) continue;
      this.push(out, 'REACT010', file, lineIndex, lines, 0.6,
        `Write to \`${m[1]}.current\` appears to run during render — mutate refs inside handlers or effects instead.`
      );
    }
    return out;
  }

  // ---- REACT011: JWT / token in localStorage ---------------------------

  private detectTokenInLocalStorage(file: string, content: string, lines: string[]): ScanResult[] {
    const out: ScanResult[] = [];
    // localStorage.setItem('token', x) / sessionStorage.setItem('authToken', …)
    const regex = /(?:local|session)Storage\.setItem\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content))) {
      const key = m[1].toLowerCase();
      if (!/(token|jwt|access|refresh|bearer|authorization|auth)/.test(key)) continue;
      const lineIndex = content.slice(0, m.index).split('\n').length - 1;
      this.push(out, 'REACT011', file, lineIndex, lines, 0.9,
        `Token-shaped key "${m[1]}" written to storage — move to an HttpOnly cookie.`
      );
    }
    return out;
  }
}
