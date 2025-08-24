import { ScanOptions, ScanResult } from './types';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SecurityScanner } from './scanners/security-scanner';
import { LinkScanner } from './scanners/link-scanner';
import { AccessibilityScanner } from './scanners/accessibility-scanner';
import { EnvScanner } from './scanners/env-scanner';
import { PythonSecurityScanner } from './scanners/python-security-scanner';
import { OSVScanner } from './scanners/osv-scanner';
import { GitHistoryScanner } from './scanners/git-history-scanner';
import { AstSecurityScanner } from './scanners/ast-security-scanner';
import { InternalCrawler } from './scanners/internal-crawler';
import { IacScanner } from './scanners/iac-scanner';
import { glob } from 'glob';
import { Logger } from './utils/logger';
import chalk from 'chalk';
import { RULES } from './types/rules';

export class UbonScan {
  private scanners: any[] = [];

  private linkScanner = new LinkScanner();
  private logger: Logger;
  private useColor: boolean;

  constructor(verbose: boolean = false, silent: boolean = false, colorMode: 'auto' | 'always' | 'never' = 'auto') {
    this.logger = new Logger(verbose, silent, colorMode);
    this.useColor = this.shouldUseColor(colorMode);
  }

  private shouldUseColor(mode: 'auto' | 'always' | 'never'): boolean {
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return process.stdout.isTTY && !process.env.NO_COLOR;
  }

  private colorize(fn: typeof chalk.red, text: string): string {
    return this.useColor ? fn(text) : text;
  }

  private brand(text: string): string {
    return this.useColor ? chalk.hex('#c99cb3')(text) : text;
  }

  async diagnose(options: ScanOptions): Promise<ScanResult[]> {
    this.logger.title('Starting Ubon');
    
    // Auto-detect profile if needed (Python if .py files present)
    let profile = options.profile || 'auto';
    if (profile === 'auto') {
      const py = await glob('**/*.py', { cwd: options.directory, ignore: ['.venv/**', 'venv/**', 'node_modules/**', 'dist/**', 'build/**', '.next/**', 'examples/**'] });
      if (py.length > 0) profile = 'python';
    }
    // Select scanners based on profile
    this.scanners = this.resolveScanners(profile as any, options.fast);

    // Runtime, non-persistent defaults for human-friendly noise reduction
    if (!options.json && options.profile !== 'python') {
      // If user didn't set minConfidence, prefer a gentle default
      if (typeof options.minConfidence !== 'number') {
        (options as any).minConfidence = 0.8;
      }
    }
    const allResults: ScanResult[] = [];

    // Run static file scanners
    for (const scanner of this.scanners) {
      this.logger.info(`Running ${scanner.name}...`);
      try {
        const results = await scanner.scan(options);
        allResults.push(...results);
        this.logger.success(`${scanner.name} completed (${results.length} issues found)`);
      } catch (error) {
        this.logger.error(`${scanner.name} failed: ${error}`);
      }
    }

    // Fast mode skips link and OSV scanners
    if (!options.fast) {
      this.logger.info(`Running ${this.linkScanner.name}...`);
      try {
        const linkResults = await this.linkScanner.scan(options);
        allResults.push(...linkResults);
        this.logger.success(`${this.linkScanner.name} completed (${linkResults.length} issues found)`);
      } catch (error) {
        this.logger.error(`${this.linkScanner.name} failed: ${error}`);
      }
    } else {
      this.logger.info('⚡ Fast mode: Skipping external link checks');
    }

    // Internal crawler (opt-in)
    if (options.crawlInternal && !options.fast) {
      const crawler = new InternalCrawler();
      this.logger.info(`Running ${crawler.name}...`);
      try {
        const cres = await crawler.scan(options);
        allResults.push(...cres);
        this.logger.success(`${crawler.name} completed (${cres.length} issues found)`);
      } catch (e) {
        this.logger.error(`${crawler.name} failed: ${e}`);
      }
    }

    // Git history scanner if enabled
    if (options.gitHistoryDepth && options.gitHistoryDepth > 0) {
      const hist = new GitHistoryScanner();
      this.logger.info(`Running ${hist.name}...`);
      try {
        const hres = await hist.scan(options);
        allResults.push(...hres);
        this.logger.success(`${hist.name} completed (${hres.length} issues found)`);
      } catch (e) {
        this.logger.error(`${hist.name} failed: ${e}`);
      }
    }

    const filtered = this.filterResults(allResults, options);
    const withFingerprints = filtered.map(r => ({ ...r, fingerprint: this.computeFingerprint(r) }));
    const afterBaseline = await this.applyBaseline(withFingerprints, options);
    const finalResults = this.applyFocusFilters(afterBaseline, options);
    return this.sortResults(finalResults);
  }

  private resolveScanners(profile: ScanOptions['profile'], fast?: boolean): any[] {
    const p = profile || 'auto';
    if (p === 'python') {
      const arr: any[] = [new PythonSecurityScanner(), new EnvScanner()];
      if (!fast) arr.push(new OSVScanner());
      return arr;
    }
    // vue/react/next fall through to JS scanners
    // auto/react/next default to JS scanners
    const jsArr: any[] = [new SecurityScanner(), new AstSecurityScanner(), new AccessibilityScanner(), new EnvScanner(), new IacScanner()];
    if (!fast) jsArr.push(new OSVScanner());
    return jsArr;
  }

  printResults(results: ScanResult[], options?: ScanOptions): void {
    if (results.length === 0) {
      this.logger.success('No issues found! Your app is looking healthy! 🎉');
      return;
    }

    // Apply filters and limits
    let filteredResults = this.applyResultFilters(results, options);
    
    // Severity-first header
    const errorCount = filteredResults.filter(r => r.type === 'error').length;
    const warnCount = filteredResults.filter(r => r.type === 'warning').length;
    const criticalCount = filteredResults.filter(r => r.severity === 'high').length;
    const highText = criticalCount > 0 ? this.colorize(chalk.bgRed.white, ` ${criticalCount} CRITICAL `) : '';
    console.log(`\n${this.brand('🪷')} ${this.colorize(chalk.bold, 'Triage')}: ${highText} ${this.colorize(chalk.red, errorCount + ' errors')}, ${this.colorize(chalk.yellow, warnCount + ' warnings')}`);

    if (filteredResults.length !== results.length) {
      console.log(`${this.colorize(chalk.gray, `  (showing ${filteredResults.length} of ${results.length} total issues)`)}`);
    }

    this.logger.separator();
    this.logger.title(`Found ${filteredResults.length} issues:`);

    const groupedResults = this.groupResults(filteredResults, options?.groupBy || 'category');

    Object.entries(groupedResults).forEach(([groupKey, groupResults]) => {
      const icon = this.getGroupIcon(groupKey, options?.groupBy || 'category');
      const lotus = this.brand(icon);
      const count = this.colorize(chalk.gray, `(${groupResults.length})`);
      console.log(`\n${lotus} ${this.colorize(chalk.bold, groupKey.toUpperCase())} ${count}:`);
      groupResults.forEach(result => {
        const isError = result.type === 'error';
        const icon = isError ? this.colorize(chalk.red, '●') : this.colorize(chalk.yellow, '●');
        const location = result.file ? this.colorize(chalk.gray, ` (${result.file}:${result.line})`) : '';
        const sev = (result.severity || '').toLowerCase();
        const badge = sev === 'high'
          ? this.colorize(chalk.bgRed.white, ' HIGH ')
          : sev === 'medium'
            ? this.colorize(chalk.bgYellow.black, ' MED ')
            : sev === 'low'
              ? this.colorize(chalk.bgBlue.white, ' LOW ')
              : '';
        const rule = result.ruleId ? this.colorize(chalk.gray, ` {${result.ruleId}}`) : '';
        const msgColor = isError ? chalk.red : chalk.yellow;
        console.log(`  ${icon} ${badge} ${this.colorize(msgColor, result.message)}${location}${rule}`);
        if (result.fix) {
          console.log(`      ${this.brand('🪷')} ${this.colorize(chalk.green, result.fix)}`);
        }
        
        // Show "why it matters" explanation if enabled
        if (options?.explain && result.ruleId) {
          const ruleMeta = RULES[result.ruleId];
          if (ruleMeta?.impact) {
            console.log(`      ${this.colorize(chalk.blue, '💡')} ${this.colorize(chalk.italic, ruleMeta.impact)}`);
          }
        }
        
        // Show code context if enabled and available
        if (options?.showContext && result.file && result.line) {
          const context = this.getCodeContext(result.file, result.line);
          if (context) {
            console.log(`      ${this.colorize(chalk.gray, '┌─ Code context:')}`);
            context.forEach((line, idx) => {
              const lineNum = (result.line! - 2 + idx).toString().padStart(3);
              const isTarget = idx === 2; // middle line (0-indexed)
              const marker = isTarget ? this.colorize(chalk.red, '►') : this.colorize(chalk.gray, ' ');
              const lineColor = isTarget ? chalk.yellow : chalk.gray;
              console.log(`      ${this.colorize(chalk.gray, '│')} ${marker} ${this.colorize(lineColor, lineNum)} ${this.colorize(lineColor, line)}`);
            });
            console.log(`      ${this.colorize(chalk.gray, '└─')}`);
          }
        }
      });
    });

    this.logger.separator();
    this.printSummary(results);
  }

  private groupByCategory(results: ScanResult[]): Record<string, ScanResult[]> {
    return results.reduce((acc, result) => {
      if (!acc[result.category]) {
        acc[result.category] = [];
      }
      acc[result.category].push(result);
      return acc;
    }, {} as Record<string, ScanResult[]>);
  }

  private applyResultFilters(results: ScanResult[], options?: ScanOptions): ScanResult[] {
    let filtered = [...results];

    // Apply severity filter
    if (options?.minSeverity) {
      const severityOrder: Record<string, number> = { low: 1, medium: 2, high: 3 };
      const minLevel = severityOrder[options.minSeverity];
      filtered = filtered.filter(r => severityOrder[r.severity] >= minLevel);
    }

    // Sort by priority: severity (high->low), then type (error->warning->info)
    filtered.sort((a, b) => {
      const severityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const typeOrder: Record<string, number> = { error: 3, warning: 2, info: 1 };
      
      const sevDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (sevDiff !== 0) return sevDiff;
      
      return typeOrder[b.type] - typeOrder[a.type];
    });

    // Apply max issues limit
    if (options?.maxIssues && options.maxIssues > 0) {
      filtered = filtered.slice(0, options.maxIssues);
    }

    return filtered;
  }

  private groupResults(results: ScanResult[], groupBy: 'category' | 'file' | 'rule' | 'severity'): Record<string, ScanResult[]> {
    return results.reduce((acc, result) => {
      let key: string;
      
      switch (groupBy) {
        case 'file':
          key = result.file || 'unknown';
          break;
        case 'rule':
          key = result.ruleId || 'unknown';
          break;
        case 'severity':
          key = result.severity || 'unknown';
          break;
        case 'category':
        default:
          key = result.category;
          break;
      }
      
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(result);
      return acc;
    }, {} as Record<string, ScanResult[]>);
  }

  private getCategoryIcon(category: string): string {
    const icons: Record<string, string> = {
      security: '🔒',
      links: '🔗',
      accessibility: '♿',
      performance: '⚡',
      seo: '🔍'
    };
    return icons[category] || '📋';
  }

  private getGroupIcon(groupKey: string, groupBy: 'category' | 'file' | 'rule' | 'severity'): string {
    switch (groupBy) {
      case 'category':
        return this.getCategoryIcon(groupKey);
      case 'file':
        return '📄';
      case 'rule':
        return '⚖️';
      case 'severity':
        const severityIcons: Record<string, string> = {
          high: '🚨',
          medium: '⚠️', 
          low: 'ℹ️'
        };
        return severityIcons[groupKey] || '📊';
      default:
        return '📋';
    }
  }

  private getCodeContext(filePath: string, lineNumber: number): string[] | null {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      
      // Get 2 lines before and 2 lines after the target line (5 total)
      const startLine = Math.max(0, lineNumber - 3); // -3 because lineNumber is 1-indexed
      const endLine = Math.min(lines.length - 1, lineNumber + 1); // +1 for 2 lines after
      
      const contextLines: string[] = [];
      for (let i = startLine; i <= endLine; i++) {
        contextLines.push(lines[i] || '');
      }
      
      return contextLines.length > 0 ? contextLines : null;
    } catch (error) {
      // File might not exist or be readable
      return null;
    }
  }

  private printSummary(results: ScanResult[]): void {
    const errors = results.filter(r => r.type === 'error').length;
    const warnings = results.filter(r => r.type === 'warning').length;
    
    console.log(`\n${this.brand('🪷')} ${this.colorize(chalk.bold, 'Summary')}: ${this.colorize(chalk.red, errors + ' errors')}, ${this.colorize(chalk.yellow, warnings + ' warnings')}`);
    
    if (errors > 0) {
      this.logger.error('Critical issues found that should be fixed immediately');
    } else {
      this.logger.success('No critical issues found');
    }
  }

  private filterResults(results: ScanResult[], options: ScanOptions): ScanResult[] {
    let filtered = results;
    if (options.changedFiles && options.changedFiles.length > 0) {
      const set = new Set(options.changedFiles.map(f => f.replace(/^[./]+/, '')));
      filtered = filtered.filter(r => !r.file || set.has(r.file));
    }
    if (typeof options.minConfidence === 'number') {
      filtered = filtered.filter(r => (r.confidence ?? 1) >= (options.minConfidence as number));
    }
    if (options.enabledRules && options.enabledRules.length > 0) {
      const set = new Set(options.enabledRules);
      filtered = filtered.filter(r => set.has(r.ruleId));
    }
    if (options.disabledRules && options.disabledRules.length > 0) {
      const set = new Set(options.disabledRules);
      filtered = filtered.filter(r => !set.has(r.ruleId));
    }
    return filtered;
  }

  private applyFocusFilters(results: ScanResult[], options: ScanOptions): ScanResult[] {
    let out = results;
    if (options.focusNew) {
      // already applied baseline; no-op here since baseline removed old issues
    }
    if (options.focusSecurity) {
      out = out.filter(r => r.category === 'security');
    }
    if (options.focusCritical) {
      out = out.filter(r => r.severity === 'high');
    }
    if (!options.detailed && typeof options.minConfidence !== 'number') {
      // gentle noise reduction when not detailed: default minConfidence 0.8 for human runs
      out = out.filter(r => (r.confidence ?? 1) >= 0.8);
    }
    return out;
  }

  private computeFingerprint(result: ScanResult): string {
    const hash = createHash('sha256');
    const normalizedPath = (result.file || '').replace(/\\/g, '/');
    const snippet = (result.match || '').slice(0, 200);
    hash.update([result.ruleId, normalizedPath, snippet].join('|'));
    return hash.digest('hex').slice(0, 16);
  }

  private sortResults(results: ScanResult[]): ScanResult[] {
    const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2 };
    return [...results].sort((a, b) => {
      if (severityRank[a.type] !== severityRank[b.type]) return severityRank[a.type] - severityRank[b.type];
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      if ((a.file || '') !== (b.file || '')) return (a.file || '').localeCompare(b.file || '');
      if ((a.line || 0) !== (b.line || 0)) return (a.line || 0) - (b.line || 0);
      return a.ruleId.localeCompare(b.ruleId);
    });
  }

  private async applyBaseline(results: ScanResult[], options: ScanOptions): Promise<ScanResult[]> {
    const baselinePath = options.baselinePath || join(options.directory, '.ubon.baseline.json');

    // Update baseline mode
    if (options.updateBaseline) {
      const fingerprints = Array.from(new Set(results.map(r => r.fingerprint))).sort();
      const payload = { generatedAt: new Date().toISOString(), fingerprints };
      try {
        writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
        this.logger.success(`Baseline updated at ${baselinePath}`);
      } catch (err) {
        this.logger.error(`Failed to write baseline: ${err}`);
      }
      return [];
    }

    const useBaseline = options.useBaseline !== false; // default true
    if (!useBaseline) return results;

    // Load baseline fingerprints if exists
    if (!existsSync(baselinePath)) return results;
    try {
      const content = readFileSync(baselinePath, 'utf-8');
      const data = JSON.parse(content);
      const set = new Set<string>(data.fingerprints || []);
      return results.filter(r => !set.has(r.fingerprint as string));
    } catch {
      return results;
    }
  }
}

export * from './types';
export { SecurityScanner } from './scanners/security-scanner';
export { LinkScanner } from './scanners/link-scanner';
export { AccessibilityScanner } from './scanners/accessibility-scanner';
export { EnvScanner } from './scanners/env-scanner';