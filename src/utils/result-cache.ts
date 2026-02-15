import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { CacheRunStats, ScanResult } from '../types';

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
  private hits = 0;
  private misses = 0;

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
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.hash === contentHash) {
      this.hits++;
      return entry.results;
    }
    this.misses++;
    return null;
  }

  set(file: string, contentHash: string, results: ScanResult[]): void {
    this.data.files[file] = { hash: contentHash, results };
  }

  clear(): void {
    this.data.files = {};
    this.save();
  }

  getStats(): CacheRunStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0
    };
  }
}


