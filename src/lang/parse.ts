import { parse, type ParserOptions, type ParserPlugin } from '@babel/parser';
import type { File as BabelFile } from '@babel/types';
import type { Lang } from '../core/files.ts';

/**
 * JavaScript and TypeScript parsing with Babel (bundled). Error recovery is on,
 * so a file with a syntax error still yields a partial tree. Vue, Svelte, and
 * Astro files are split into script blocks whose line numbers map back to the
 * original file.
 */

export interface ScriptBlock {
  program: BabelFile;
  /** Where this block runs: Astro frontmatter is server code, <script> tags are client code. */
  side: 'server' | 'client' | 'both';
  errors: number;
}

export interface ParseOutcome {
  blocks: ScriptBlock[];
  /** Set when the file could not be parsed at all. */
  failed?: string;
}

const COMMON: ParserOptions = {
  sourceType: 'module',
  errorRecovery: true,
  allowReturnOutsideFunction: true,
  allowAwaitOutsideFunction: true,
  allowImportExportEverywhere: true,
  allowUndeclaredExports: true,
  allowSuperOutsideMethod: true,
  attachComment: false,
  tokens: false,
  ranges: false,
};

function pluginsFor(kind: 'js' | 'jsx' | 'ts' | 'tsx'): ParserPlugin[] {
  const base: ParserPlugin[] = ['decorators-legacy', 'explicitResourceManagement'];
  if (kind === 'ts') return ['typescript', ...base];
  if (kind === 'tsx') return ['typescript', 'jsx', ...base];
  return ['jsx', ...base];
}

function parseOne(code: string, kind: 'js' | 'jsx' | 'ts' | 'tsx', startLine = 1): { program: BabelFile; errors: number } | null {
  // Plain .js files may contain JSX (React) or, rarely, type annotations; keep the attempt with fewer errors.
  const attempts: Array<'js' | 'jsx' | 'ts' | 'tsx'> = kind === 'js' ? ['js', 'tsx'] : [kind];
  let best: { program: BabelFile; errors: number } | null = null;
  for (const attempt of attempts) {
    try {
      const program = parse(code, { ...COMMON, startLine, plugins: pluginsFor(attempt) }) as BabelFile & { errors?: unknown[] };
      const errors = Array.isArray(program.errors) ? program.errors.length : 0;
      if (!best || errors < best.errors) best = { program, errors };
      if (errors === 0) break;
    } catch {
      // try the next dialect
    }
  }
  return best;
}

export function parseSource(text: string, lang: Lang): ParseOutcome {
  if (lang === 'js' || lang === 'jsx' || lang === 'ts' || lang === 'tsx') {
    const kind = lang === 'js' ? 'js' : lang;
    const result = parseOne(text, kind);
    return result ? { blocks: [{ program: result.program, side: 'both', errors: result.errors }] } : { blocks: [], failed: 'syntax error' };
  }
  if (lang === 'vue' || lang === 'svelte' || lang === 'astro') {
    const blocks: ScriptBlock[] = [];
    let failed: string | undefined;
    for (const block of extractScriptBlocks(text, lang)) {
      const result = parseOne(block.code, block.ts ? 'ts' : 'js', block.startLine);
      if (result) blocks.push({ program: result.program, side: block.side, errors: result.errors });
      else failed = 'syntax error in a script block';
    }
    return failed ? { blocks, failed } : { blocks };
  }
  return { blocks: [] };
}

interface RawBlock {
  code: string;
  startLine: number;
  ts: boolean;
  side: ScriptBlock['side'];
}

export function extractScriptBlocks(text: string, lang: 'vue' | 'svelte' | 'astro'): RawBlock[] {
  const blocks: RawBlock[] = [];
  const lineOf = (offset: number) => text.slice(0, offset).split('\n').length;
  if (lang === 'astro') {
    const fm = /^\s*---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    if (fm && fm[1] !== undefined) {
      const start = (fm.index ?? 0) + fm[0].indexOf(fm[1]);
      blocks.push({ code: fm[1], startLine: lineOf(start), ts: true, side: 'server' });
    }
  }
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const attrs = m[1] ?? '';
    const code = m[2] ?? '';
    if (/\btype\s*=\s*["'](?:application\/(?:ld\+)?json|text\/template|importmap)["']/i.test(attrs)) continue;
    if (/\bsrc\s*=/.test(attrs) && code.trim() === '') continue;
    const start = (m.index ?? 0) + m[0].indexOf('>') + 1;
    const ts = /\blang\s*=\s*["']ts["']/.test(attrs) || lang === 'astro';
    const side: ScriptBlock['side'] = lang === 'astro' ? 'client' : /context\s*=\s*["']module["']|\bmodule\b/.test(attrs) ? 'both' : 'both';
    blocks.push({ code, startLine: lineOf(start), ts, side });
  }
  return blocks;
}
