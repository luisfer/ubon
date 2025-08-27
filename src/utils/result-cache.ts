import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { ScanResult } from '../types';

export interface CachedFileEntry {
  hash: string;
  results: ScanResult[];
}

export interface ResultCacheData {
  signature: string; // rules/profile/version signature
  files: Record<string, CachedFileEntry>;
}

export class ResultCache {
  private cachePath: string;
  private data: ResultCacheData;

  constructor(private directory: string, signature: string) {
    const cacheDir = join(directory, '.ubon');
    try { if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true }); } catch {}
    this.cachePath = join(cacheDir, 'results-cache.json');
    this.data = { signature, files: {} };
    this.load(signature);
  }

  private load(signature: string) {
    try {
      if (existsSync(this.cachePath)) {
        const raw = JSON.parse(readFileSync(this.cachePath, 'utf-8')) as ResultCacheData;
        if (raw && raw.signature === signature && raw.files) {
          this.data = raw;
        }
      }
    } catch {}
  }

  save(): void {
    try {
      writeFileSync(this.cachePath, JSON.stringify(this.data, null, 2));
    } catch {}
  }

  static hashContent(content: string): string {
    const h = createHash('sha256');
    h.update(content);
    return h.digest('hex');
  }

  get(file: string, contentHash: string): ScanResult[] | null {
    const entry = this.data.files[file];
    if (!entry) return null;
    return entry.hash === contentHash ? entry.results : null;
  }

  set(file: string, contentHash: string, results: ScanResult[]): void {
    this.data.files[file] = { hash: contentHash, results };
  }

  clear(): void {
    this.data.files = {};
    this.save();
  }
}


