import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanOptions, ScanResult } from '../types';
import { ResultCache } from '../utils/result-cache';

export interface FileContext {
  file: string;
  content: string;
  lines: string[];
  contentHash: string;
}

export abstract class BaseScanner implements Scanner {
  abstract name: string;
  abstract scan(options: ScanOptions): Promise<ScanResult[]>;
  protected resultCache: ResultCache | null = null;

  protected initCache(options: ScanOptions, signature: string): void {
    this.resultCache = options.noResultCache ? null : new ResultCache(options.directory, signature);
  }

  protected getCached(file: string, contentHash: string): ScanResult[] | null {
    return this.resultCache?.get(file, contentHash) ?? null;
  }

  protected setCached(file: string, contentHash: string, results: ScanResult[]): void {
    this.resultCache?.set(file, contentHash, results);
  }

  protected saveCache(): void {
    this.resultCache?.save();
  }

  protected async *iterateFiles(options: ScanOptions, pattern: string, ignore: string[]): AsyncGenerator<FileContext> {
    const files = await glob(pattern, {
      cwd: options.directory,
      ignore: [...ignore, ...(options.exclude || [])]
    });
    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        const contentHash = ResultCache.hashContent(content);
        yield { file, content, lines: content.split('\n'), contentHash };
      } catch (error) {
        if (options.verbose) {
          console.error(`🪷 ${this.name}: failed to read ${file}:`, error);
        }
      }
    }
  }

  protected hasFileSuppression(lines: string[]): boolean {
    return lines.some((line) => /ubon-disable-file/.test(line));
  }

  protected isSuppressed(lines: string[], lineIndex: number, ruleId: string): boolean {
    const disableNext = /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[lineIndex] || '');
    const prevDisable = lineIndex > 0 ? /ubon-disable-next-line\s+([A-Z0-9_,\s-]+)/.exec(lines[lineIndex - 1]) : null;
    const disabledList = new Set<string>([
      ...(disableNext && disableNext[1] ? disableNext[1].split(/[,\s]+/).filter(Boolean) : []),
      ...(prevDisable && prevDisable[1] ? prevDisable[1].split(/[,\s]+/).filter(Boolean) : [])
    ]);
    return disabledList.has(ruleId);
  }

  protected createResult(partial: Omit<ScanResult, 'range'> & { range?: ScanResult['range'] }, lineText?: string): ScanResult {
    const range = partial.range || (partial.line
      ? {
          startLine: partial.line,
          startColumn: 1,
          endLine: partial.line,
          endColumn: Math.max(1, (lineText || '').length)
        }
      : undefined);
    return {
      ...partial,
      range
    };
  }
}
