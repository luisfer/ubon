import { readFileSync } from 'fs';
import { ScanResult } from '../types';

export interface SuppressionMatch {
  ruleId: string;
  reason?: string;
  line: number;
}

/**
 * Detects inline suppression comments in a file
 * Supports formats:
 * - // ubon-disable-next-line RULEID
 * - // ubon-disable-next-line RULEID reason goes here
 * - comment: ubon-disable-next-line RULEID
 * - comment: ubon-disable-next-line RULEID reason goes here
 */
export function detectSuppressions(filePath: string): SuppressionMatch[] {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const suppressions: SuppressionMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;

      // Match both // and /* */ style comments
      const patterns = [
        // Single line: // ubon-disable-next-line RULEID optional reason
        /\/\/\s*ubon-disable-next-line\s+([A-Z0-9]+)(?:\s+(.+))?$/,
        // Multi line: /* ubon-disable-next-line RULEID optional reason */
        /\/\*\s*ubon-disable-next-line\s+([A-Z0-9]+)(?:\s+([^*]+))?\s*\*\//
      ];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match) {
          const ruleId = match[1];
          const reason = match[2]?.trim();
          
          suppressions.push({
            ruleId,
            reason,
            line: lineNumber
          });
          break; // Only one suppression per line
        }
      }
    }

    return suppressions;
  } catch (error) {
    // File doesn't exist or can't be read
    return [];
  }
}

/**
 * Applies suppressions to scan results
 */
export function applySuppressions(results: ScanResult[]): ScanResult[] {
  const suppressionCache = new Map<string, SuppressionMatch[]>();

  return results.map(result => {
    if (!result.file || !result.line) {
      return result;
    }

    // Cache suppressions per file
    // Try both the relative and absolute path
    const filePath = result.file;
    let cacheKey = filePath;
    
    if (!suppressionCache.has(cacheKey)) {
      // Try to resolve the file path - could be relative or absolute
      let suppressions: SuppressionMatch[] = [];
      
      try {
        suppressions = detectSuppressions(filePath);
      } catch (error) {
        // If direct path fails, try with current working directory
        try {
          const path = require('path');
          const fullPath = path.resolve(filePath);
          suppressions = detectSuppressions(fullPath);
        } catch (error2) {
          suppressions = [];
        }
      }
      
      suppressionCache.set(cacheKey, suppressions);
    }

    const suppressions = suppressionCache.get(cacheKey)!;
    
    // Check if this result is suppressed
    // Look for suppression on the line before the issue
    const suppressionLine = result.line - 1;
    const suppression = suppressions.find(s => 
      s.line === suppressionLine && 
      (s.ruleId === result.ruleId || s.ruleId === 'ALL')
    );

    if (suppression) {
      return {
        ...result,
        suppressed: true,
        suppressionReason: suppression.reason
      };
    }

    return result;
  });
}

/**
 * Filters results based on suppression options
 */
export function filterSuppressedResults(results: ScanResult[], options: {
  showSuppressed?: boolean;
  ignoreSuppressed?: boolean;
}): ScanResult[] {
  if (options.ignoreSuppressed) {
    // Completely ignore suppressed results
    return results.filter(r => !r.suppressed);
  }

  if (options.showSuppressed) {
    // Show all results including suppressed ones
    return results;
  }

  // Default: hide suppressed results but include them in counts
  return results.filter(r => !r.suppressed);
}
