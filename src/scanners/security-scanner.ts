import { glob } from 'glob';
import { readFileSync } from 'fs';
import { Scanner, ScanResult, ScanOptions, ScannerRunStats } from '../types';
import { getRule } from '../rules';
import { ResultCache } from '../utils/result-cache';
import { runNetworkAndCookieChecks } from './security/executors/network-cookie-executor';
import { runModularPatternRules } from './security/executors/modular-rule-executor';
import { runSecretSignalChecks } from './security/executors/secret-signal-executor';
import { runNextStructureChecks, NextStructureState } from './security/executors/next-structure-executor';
import { runNextRuntimeChecks } from './security/executors/next-runtime-executor';
import { runVueSecurityChecks } from './security/executors/vue-executor';

export class SecurityScanner implements Scanner {
  name = 'Security Scanner';
  private lastRunStats: ScannerRunStats | null = null;

  // Rule IDs that have been migrated to modular rules with patterns
  private readonly modularRuleIds = [
    'SEC001', 'SEC002', 'SEC003', 'SEC004', 'SEC005', 'SEC006', 'SEC007',
    'SEC008', 'SEC009', 'SEC010', 'SEC011', 'SEC012', 'SEC013', 'SEC014',
    'SEC015', 'SEC016', 'SEC017'
  ];

  // Confidence reasons for each rule
  private readonly confidenceReasons: Record<string, string> = {
    'SEC001': 'Pattern matches known API key prefixes (sk-, pk_test_, etc.)',
    'SEC002': 'URL matches Supabase project pattern',
    'SEC003': 'String matches JWT token structure (three base64 segments)',
    'SEC004': 'Pattern matches Firebase config keys',
    'SEC005': 'Pattern matches Stripe key prefixes',
    'SEC006': 'Variable name contains "password" with non-empty string value',
    'SEC007': 'Pattern matches private key header',
    'SEC008': 'Environment variable with hardcoded fallback string',
    'SEC009': 'Pattern matches AWS Access Key ID format (AKIA...)',
    'SEC010': 'Pattern matches Slack webhook URL structure',
    'SEC011': 'Pattern matches GitHub token prefixes (ghp_, gho_, etc.)',
    'SEC012': 'Pattern matches Twilio Account SID format',
    'SEC013': 'Pattern matches SendGrid API key format',
    'SEC014': 'Pattern matches OpenAI API key format (sk-...)',
    'SEC015': 'Console statement detected in production code',
    'SEC016': 'Direct eval() call detected - code execution risk',
    'SEC017': 'dangerouslySetInnerHTML usage - XSS risk if content unsanitized',
    'SEC018': 'High Shannon entropy suggests random/secret data',
    'NEXT201': 'Missing 404/not-found page in Next.js app',
    'NEXT202': 'Missing error boundary in Next.js app',
    'JSNET001': 'HTTP request without timeout can hang indefinitely',
    'COOKIE001': 'Cookie missing security attributes (HttpOnly, Secure, SameSite)'
  };

  getLastRunStats(): ScannerRunStats | null {
    return this.lastRunStats;
  }

  async scan(options: ScanOptions): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    let filesScanned = 0;
    let filesReadErrors = 0;
    const ignorePatterns = ['node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**', 'coverage/**', '.git/**', '.tmp*/**', 'tmp/**'];
    if (!options.detailed) {
      ignorePatterns.push('**/__tests__/**', '**/*.test.{js,jsx,ts,tsx}', '**/*.spec.{js,jsx,ts,tsx}');
    }

    const files = await glob('**/*.{js,jsx,ts,tsx,vue,env}', {
      cwd: options.directory,
      ignore: ignorePatterns
    });
    const signature = `sec:2:profile:${options.profile || 'auto'}`;
    const resultCache = options.noResultCache ? null : new ResultCache(options.directory, signature);
    let processed = 0;

    // Load modular rules
    const modularRules = this.modularRuleIds
      .map((id) => getRule(id))
      .filter((rule): rule is NonNullable<typeof rule> => Boolean(rule));

    const nextStructureState: NextStructureState = {
      hasAppDir: files.some((f) => /^app\//.test(f)),
      hasPagesDir: files.some((f) => /^pages\//.test(f)),
      hasNotFoundApp: files.some((f) => /^app\/not-found\.(js|jsx|ts|tsx)$/.test(f)),
      has404Pages: files.some((f) => /^pages\/404\.(js|jsx|ts|tsx)$/.test(f)),
      hasErrorApp: files.some((f) => /^app\/error\.(js|jsx|ts|tsx)$/.test(f)),
      hasErrorPages: files.some((f) => /^pages\/_error\.(js|jsx|ts|tsx)$/.test(f)),
      hasDocumentPages: files.some((f) => /^pages\/_document\.(js|jsx|ts|tsx)$/.test(f)),
      emittedMissing404: false,
      emittedMissingErrorBoundary: false,
      emittedMissingDocument: false
    };

    for (const file of files) {
      try {
        const content = readFileSync(`${options.directory}/${file}`, 'utf-8');
        filesScanned++;
        const contentHash = ResultCache.hashContent(content);
        const cached = resultCache?.get(file, contentHash);
        if (cached) {
          results.push(...cached);
          processed++;
          if (options.verbose && processed % 25 === 0) {
            console.log('🪷', `Scanning... (${processed}/${files.length} files)`);
          }
          continue;
        }
        const lines = content.split('\n');
        processed++;
        if (options.verbose && processed % 25 === 0) {
          console.log('🪷', `Scanning... (${processed}/${files.length} files)`);
        }
        const fileExt = file.split('.').pop()?.toLowerCase() || '';

        let ubonDisableAll = false;
        lines.forEach((line) => {
          if (/ubon-disable-file/.test(line)) { ubonDisableAll = true; }
        });
        if (ubonDisableAll) continue;

        results.push(...runModularPatternRules({
          file,
          fileExt,
          lines,
          rules: modularRules,
          confidenceReasons: this.confidenceReasons
        }));

        results.push(...runNextStructureChecks({
          file,
          content,
          state: nextStructureState,
          confidenceReasons: this.confidenceReasons
        }));

        results.push(...runNetworkAndCookieChecks({ file, lines }));

        results.push(...runSecretSignalChecks({ file, lines }));

        results.push(...runVueSecurityChecks({ file, lines }));

        results.push(...runNextRuntimeChecks({ file, content, lines }));

        // store per-file results for this file only
        const fileResults = results.filter(r => r.file === file);
        resultCache?.set(file, contentHash, fileResults);
      } catch (error) {
        filesReadErrors++;
        if (options.verbose) {
          console.error(`🪷 SecurityScanner: failed to read ${file}:`, error);
        }
      }
    }
    const cacheStats = resultCache?.getStats();
    this.lastRunStats = {
      filesScanned,
      filesReadErrors,
      findings: results.length,
      ...(cacheStats ? { cache: cacheStats } : {})
    };
    resultCache?.save();
    return results;
  }
}
