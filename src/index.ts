import { ScanOptions, ScanResult } from './types';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

import { LinkScanner } from './scanners/link-scanner';
import { GitHistoryScanner } from './scanners/git-history-scanner';
import { InternalCrawler } from './scanners/internal-crawler';
import { Scanner } from './types';
import { resolveScanners as resolveProfileScanners } from './core/profiles';

import { Logger } from './utils/logger';
import { applySuppressions } from './utils/suppressions';
import { FileSourceCache } from './utils/file-source-cache';
import { HumanReporter } from './reporters/HumanReporter';
import { InteractiveReporter } from './reporters/InteractiveReporter';

/**
 * `UbonScan` is the orchestration layer: it picks scanners based on the
 * profile, runs them concurrently, applies fingerprinting / suppressions /
 * baseline, and hands the final list of `ScanResult`s to a reporter.
 *
 * It deliberately knows nothing about *how* results are rendered — that's
 * the job of `HumanReporter` / `InteractiveReporter` / the JSON writers in
 * `cli/shared.ts` / the upcoming MCP tools.
 */
export class UbonScan {
  private scanners: Scanner[] = [];
  private linkScanner = new LinkScanner();
  private logger: Logger;
  private colorMode: 'auto' | 'always' | 'never';
  private humanReporter: HumanReporter;
  private interactiveReporter: InteractiveReporter;

  constructor(verbose: boolean = false, silent: boolean = false, colorMode: 'auto' | 'always' | 'never' = 'auto', quiet: boolean = false) {
    this.logger = new Logger(verbose, silent, colorMode, quiet);
    this.colorMode = colorMode;
    this.humanReporter = new HumanReporter(this.logger, colorMode);
    this.interactiveReporter = new InteractiveReporter(colorMode);
  }

  /**
   * Toggle quiet mode after construction. Used by `cli/shared.ts` when the
   * CLI flag `--quiet` is observed but the orchestrator was constructed
   * earlier (e.g. by the MCP server). Keeps the public ctor signature stable.
   */
  setQuiet(quiet: boolean): void {
    (this.logger as unknown as { quiet: boolean }).quiet = quiet;
  }

  async diagnose(options: ScanOptions): Promise<ScanResult[]> {
    if (options.quiet) this.setQuiet(true);
    this.logger.title('Starting Ubon');

    const profile = await this.detectProfile(options);
    this.scanners = this.resolveScanners(profile, options.fast);

    if (!options.json) {
      if (typeof options.minConfidence !== 'number') {
        (options as any).minConfidence = 0.8;
      }
    }

    const allResults: ScanResult[] = [];

    const scannerRuns = this.scanners.map(async (scanner) => {
      this.logger.info(`Running ${scanner.name}...`);
      try {
        const results = await scanner.scan(options);
        this.logger.success(`🪷 ${scanner.name} completed (${results.length} issues found)`);
        return results;
      } catch (error) {
        this.logger.error(`${scanner.name} failed: ${error}`);
        return [];
      }
    });
    const scannerResults = await Promise.all(scannerRuns);
    scannerResults.forEach((r) => allResults.push(...r));

    if (!options.fast) {
      this.logger.info(`Running ${this.linkScanner.name}...`);
      try {
        const linkResults = await this.linkScanner.scan(options);
        allResults.push(...linkResults);
        this.logger.success(`🪷 ${this.linkScanner.name} completed (${linkResults.length} issues found)`);
      } catch (error) {
        this.logger.error(`${this.linkScanner.name} failed: ${error}`);
      }
    } else {
      this.logger.info('⚡ Fast mode: Skipping external link checks');
    }

    if (options.crawlInternal && !options.fast) {
      const crawler = new InternalCrawler();
      this.logger.info(`Running ${crawler.name}...`);
      try {
        const cres = await crawler.scan(options);
        allResults.push(...cres);
        this.logger.success(`🪷 ${crawler.name} completed (${cres.length} issues found)`);
      } catch (e) {
        this.logger.error(`${crawler.name} failed: ${e}`);
      }
    }

    if (options.gitHistoryDepth && options.gitHistoryDepth > 0) {
      const hist = new GitHistoryScanner();
      this.logger.info(`Running ${hist.name}...`);
      try {
        const hres = await hist.scan(options);
        allResults.push(...hres);
        this.logger.success(`🪷 ${hist.name} completed (${hres.length} issues found)`);
      } catch (e) {
        this.logger.error(`${hist.name} failed: ${e}`);
      }
    }

    const deduped = this.dedupeResults(allResults);
    const filtered = this.filterResults(deduped, options);
    const withFingerprints = filtered.map((r) => ({ ...r, fingerprint: this.computeFingerprint(r) }));
    const withSuppressions = applySuppressions(withFingerprints);
    const afterBaseline = await this.applyBaseline(withSuppressions, options);
    const finalResults = this.applyFocusFilters(afterBaseline, options);

    // Drop the in-memory file cache so a long-running process (LSP / MCP
    // server) doesn't accumulate stale source between scans.
    FileSourceCache.clear(options.directory);

    return this.sortResults(finalResults);
  }

  private async detectProfile(options: ScanOptions): Promise<NonNullable<ScanOptions['profile']>> {
    let profile = options.profile || 'auto';
    if (profile !== 'auto') return profile;

    const hasVite = existsSync(join(options.directory, 'vite.config.ts'))
      || existsSync(join(options.directory, 'vite.config.js'));
    if (hasVite) {
      try {
        const pkg = JSON.parse(readFileSync(join(options.directory, 'package.json'), 'utf-8'));
        const hasSupabase = pkg.dependencies?.['@supabase/supabase-js']
          || pkg.devDependencies?.['@supabase/supabase-js']
          || existsSync(join(options.directory, 'supabase'));
        const hasReact = pkg.dependencies?.['react'];
        const hasTailwind = pkg.dependencies?.['tailwindcss'] || pkg.devDependencies?.['tailwindcss'];
        if (hasSupabase && hasReact && hasTailwind) profile = 'lovable';
      } catch {
        // package.json missing — fall through to other heuristics
      }
    }
    return profile;
  }

  private resolveScanners(profile: ScanOptions['profile'], fast?: boolean): Scanner[] {
    return resolveProfileScanners(profile, fast);
  }

  async printResults(results: ScanResult[], options?: ScanOptions): Promise<void> {
    if (options?.interactive) {
      await this.interactiveReporter.run(results, options);
      return;
    }
    this.humanReporter.print(results, options);
  }

  /** @deprecated Use the InteractiveReporter directly. Kept for back-compat. */
  async runInteractive(results: ScanResult[], options: ScanOptions): Promise<void> {
    await this.interactiveReporter.run(results, options);
  }

  private filterResults(results: ScanResult[], options: ScanOptions): ScanResult[] {
    let filtered = results;
    if (options.changedFiles && options.changedFiles.length > 0) {
      const set = new Set(options.changedFiles.map((f) => f.replace(/^[./]+/, '')));
      filtered = filtered.filter((r) => !r.file || set.has(r.file));
    }
    if (typeof options.minConfidence === 'number') {
      filtered = filtered.filter((r) => (r.confidence ?? 1) >= (options.minConfidence as number));
    }
    if (options.enabledRules && options.enabledRules.length > 0) {
      const set = new Set(options.enabledRules);
      filtered = filtered.filter((r) => set.has(r.ruleId));
    }
    if (options.disabledRules && options.disabledRules.length > 0) {
      const set = new Set(options.disabledRules);
      filtered = filtered.filter((r) => !set.has(r.ruleId));
    }
    return filtered;
  }

  private applyFocusFilters(results: ScanResult[], options: ScanOptions): ScanResult[] {
    let out = results;
    if (options.focusSecurity) out = out.filter((r) => r.category === 'security');
    if (options.focusCritical) out = out.filter((r) => r.severity === 'high');
    if (!options.detailed && typeof options.minConfidence !== 'number') {
      out = out.filter((r) => (r.confidence ?? 1) >= 0.8);
    }
    return out;
  }

  /**
   * Collapse findings that target the same `(ruleId, file, line)` tuple.
   * Multiple scanners (e.g. `security-scanner` + `react-security-scanner`)
   * sometimes match the same AST node and emit the same rule at the same
   * location; users see the redundancy as noise. Keep the highest-confidence
   * finding; tie-break on richer `match` context.
   */
  private dedupeResults(results: ScanResult[]): ScanResult[] {
    const keyed = new Map<string, ScanResult>();
    for (const r of results) {
      const key = [r.ruleId, r.file || '', r.line ?? 0].join('|');
      const existing = keyed.get(key);
      if (!existing) {
        keyed.set(key, r);
        continue;
      }
      const aConf = existing.confidence ?? 0;
      const bConf = r.confidence ?? 0;
      if (bConf > aConf) keyed.set(key, r);
      else if (bConf === aConf && (r.match?.length ?? 0) > (existing.match?.length ?? 0)) keyed.set(key, r);
    }
    return Array.from(keyed.values());
  }

  private computeFingerprint(result: ScanResult): string {
    const hash = createHash('sha256');
    const normalizedPath = (result.file || '').replace(/\\/g, '/');
    const snippet = (result.match || '').slice(0, 200);
    hash.update([result.ruleId, normalizedPath, snippet].join('|'));
    return hash.digest('hex').slice(0, 16);
  }

  private sortResults(results: ScanResult[]): ScanResult[] {
    const typeRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return [...results].sort((a, b) => {
      if (typeRank[a.type] !== typeRank[b.type]) return typeRank[a.type] - typeRank[b.type];
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      if ((a.file || '') !== (b.file || '')) return (a.file || '').localeCompare(b.file || '');
      if ((a.line || 0) !== (b.line || 0)) return (a.line || 0) - (b.line || 0);
      return a.ruleId.localeCompare(b.ruleId);
    });
  }

  private async applyBaseline(results: ScanResult[], options: ScanOptions): Promise<ScanResult[]> {
    const baselinePath = options.baselinePath || join(options.directory, '.ubon.baseline.json');
    if (options.updateBaseline) {
      const fingerprints = Array.from(new Set(results.map((r) => r.fingerprint))).sort();
      const payload = { generatedAt: new Date().toISOString(), fingerprints };
      try {
        writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
        this.logger.success(`Baseline updated at ${baselinePath}`);
      } catch (err) {
        this.logger.error(`Failed to write baseline: ${err}`);
      }
      return [];
    }
    const useBaseline = options.useBaseline !== false;
    if (!useBaseline) return results;
    if (!existsSync(baselinePath)) return results;
    try {
      const content = readFileSync(baselinePath, 'utf-8');
      const data = JSON.parse(content);
      const set = new Set<string>(data.fingerprints || []);
      return results.filter((r) => !set.has(r.fingerprint as string));
    } catch {
      return results;
    }
  }
}

export * from './types';
export { SecurityScanner } from './scanners/security-scanner';
export { AstSecurityScanner } from './scanners/ast-security-scanner';
export { LinkScanner } from './scanners/link-scanner';
export { AccessibilityScanner } from './scanners/accessibility-scanner';
export { DevelopmentScanner } from './scanners/development-scanner';
export { EnvScanner } from './scanners/env-scanner';
export { IacScanner } from './scanners/iac-scanner';
export { OSVScanner } from './scanners/osv-scanner';
export { ViteScanner } from './scanners/vite-scanner';
export { ReactSecurityScanner } from './scanners/react-security-scanner';
export { ReactPatternsScanner } from './scanners/react-patterns-scanner';
export { AgentSettingsScanner } from './scanners/agent-settings-scanner';
export { LovableSupabaseScanner } from './scanners/lovable-supabase-scanner';
export { VibeScanner } from './scanners/vibe-scanner';
export { AIScanner } from './scanners/ai-scanner';
export { FrameworkScanner } from './scanners/framework-scanner';
export { BaseScanner } from './scanners/base-scanner';
export { HumanReporter } from './reporters/HumanReporter';
export { InteractiveReporter } from './reporters/InteractiveReporter';
export { calculateSecurityPosture } from './core/Posture';
