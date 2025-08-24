import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

export class FileCache<T> {
  private cacheDir: string;

  constructor(name: string) {
    // Use ~/.ubon/cache/ directory
    this.cacheDir = join(homedir(), '.ubon', 'cache', name);
    this.ensureCacheDir();
  }

  private ensureCacheDir(): void {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
    } catch (error) {
      // Cache directory creation failed, will fall back to no caching
    }
  }

  private getCacheFilePath(key: string): string {
    // Create a safe filename from the key
    const hash = createHash('sha256').update(key).digest('hex');
    return join(this.cacheDir, `${hash}.json`);
  }

  /**
   * Get cached data if it exists and hasn't expired
   */
  get(key: string): T | null {
    try {
      const filePath = this.getCacheFilePath(key);
      if (!existsSync(filePath)) {
        return null;
      }

      const content = readFileSync(filePath, 'utf8');
      const entry: CacheEntry<T> = JSON.parse(content);
      
      // Check if expired
      const now = Date.now();
      if (now - entry.timestamp > entry.ttl) {
        return null;
      }

      return entry.data;
    } catch (error) {
      // Cache read failed, return null
      return null;
    }
  }

  /**
   * Store data in cache with TTL
   */
  set(key: string, data: T, ttlMs: number): void {
    try {
      const filePath = this.getCacheFilePath(key);
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttlMs
      };

      writeFileSync(filePath, JSON.stringify(entry), 'utf8');
    } catch (error) {
      // Cache write failed, silently continue
    }
  }

  /**
   * Clear all cached entries (cleanup utility)
   */
  clear(): void {
    try {
      const fs = require('fs');
      if (existsSync(this.cacheDir)) {
        const files = fs.readdirSync(this.cacheDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            fs.unlinkSync(join(this.cacheDir, file));
          }
        }
      }
    } catch (error) {
      // Clear failed, silently continue
    }
  }

  /**
   * Remove expired entries (maintenance utility)
   */
  cleanup(): void {
    try {
      const fs = require('fs');
      if (!existsSync(this.cacheDir)) return;

      const files = fs.readdirSync(this.cacheDir);
      const now = Date.now();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        try {
          const filePath = join(this.cacheDir, file);
          const content = readFileSync(filePath, 'utf8');
          const entry: CacheEntry<any> = JSON.parse(content);
          
          if (now - entry.timestamp > entry.ttl) {
            fs.unlinkSync(filePath);
          }
        } catch {
          // Skip invalid cache files
        }
      }
    } catch (error) {
      // Cleanup failed, silently continue
    }
  }
}

/**
 * Create a cache key for OSV queries
 */
export function createOSVCacheKey(queries: any[]): string {
  // Sort queries to ensure consistent cache keys
  const sortedQueries = queries
    .map(q => `${q.package.ecosystem}:${q.package.name}@${q.version}`)
    .sort()
    .join('|');
  
  return `osv-batch:${sortedQueries}`;
}

/**
 * Default TTL values
 */
export const CACHE_TTL = {
  OSV_VULNERABILITIES: 24 * 60 * 60 * 1000, // 24 hours
  SHORT: 60 * 60 * 1000, // 1 hour  
  MEDIUM: 6 * 60 * 60 * 1000, // 6 hours
  LONG: 7 * 24 * 60 * 60 * 1000 // 7 days
};
