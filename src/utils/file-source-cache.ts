/**
 * In-memory file content cache shared across scanners during a single scan.
 *
 * Multiple scanners (security, AST, vibe, react, lovable, ...) traverse the
 * same files and used to read each file independently. With ~10 scanners and
 * a few thousand files this is the dominant source of I/O. The cache is
 * scoped to a `directory` so concurrent scans on different roots don't
 * collide, and is cleared at the end of `UbonScan.diagnose`.
 */
import { readFileSync } from 'fs';

export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024; // 1 MB

export class FileSourceCache {
  private static cachesByDirectory = new Map<string, FileSourceCache>();

  private cache = new Map<string, string>();

  static forDirectory(directory: string): FileSourceCache {
    let existing = FileSourceCache.cachesByDirectory.get(directory);
    if (!existing) {
      existing = new FileSourceCache();
      FileSourceCache.cachesByDirectory.set(directory, existing);
    }
    return existing;
  }

  static clear(directory?: string): void {
    if (directory) {
      FileSourceCache.cachesByDirectory.delete(directory);
    } else {
      FileSourceCache.cachesByDirectory.clear();
    }
  }

  read(absolutePath: string): string | undefined {
    const cached = this.cache.get(absolutePath);
    if (cached !== undefined) return cached;
    try {
      const content = readFileSync(absolutePath, 'utf-8');
      this.cache.set(absolutePath, content);
      return content;
    } catch {
      return undefined;
    }
  }

  set(absolutePath: string, content: string): void {
    this.cache.set(absolutePath, content);
  }
}
