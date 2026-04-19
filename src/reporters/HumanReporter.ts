import { readFileSync } from 'fs';
import { ScanOptions, ScanResult } from '../types';
import { Logger } from '../utils/logger';
import chalk from '../utils/colors';
import type { Styler } from '../utils/colors';
import { RULES } from '../rules';
import { filterSuppressedResults } from '../utils/suppressions';
import { calculateSecurityPosture } from '../core/Posture';

type SeverityBand = 'high' | 'medium' | 'low';

/**
 * Render scan results as colorized terminal output. Pure presentation: no
 * scanning, no filtering of suppressions/baselines (the orchestrator does
 * that). Kept in its own module so the orchestrator can stay focused on
 * running scanners and so a future TerminalReporter / CompactReporter can
 * live next to this one.
 */
export class HumanReporter {
  private useColor: boolean;

  constructor(private logger: Logger, colorMode: 'auto' | 'always' | 'never' = 'auto') {
    this.useColor = this.shouldUseColor(colorMode);
  }

  private shouldUseColor(mode: 'auto' | 'always' | 'never'): boolean {
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  }

  private colorize(fn: Styler, text: string): string {
    return this.useColor ? fn(text) : text;
  }

  private brand(text: string): string {
    return this.useColor ? chalk.hex('#c99cb3')(text) : text;
  }

  private getSeverityBand(severity: SeverityBand, count: number): string {
    if (count === 0) return '';
    const bands = {
      high: chalk.hex('#ff6b7d').bgHex('#ff6b7d').white,
      medium: chalk.hex('#ffa502').bgHex('#ffa502').black,
      low: chalk.hex('#7bed9f').bgHex('#7bed9f').black,
    } as const;
    const colorFn = this.useColor ? bands[severity] : ((t: string) => t);
    return colorFn(` ${count} ${severity.toUpperCase()} `);
  }

  print(results: ScanResult[], options?: ScanOptions): void {
    const suppressedCount = results.filter((r) => r.suppressed).length;
    const activeResults = filterSuppressedResults(results, {
      showSuppressed: options?.showSuppressed,
      ignoreSuppressed: options?.ignoreSuppressed,
    });

    const quiet = !!options?.quiet;
    if (activeResults.length === 0 && suppressedCount === 0) {
      if (!quiet) this.logger.success('🪷 No issues found! Your app is blooming beautifully! ✨');
      return;
    }
    if (activeResults.length === 0 && suppressedCount > 0) {
      if (!quiet) this.logger.success(`🪷 No active issues found! ${suppressedCount} issues suppressed. ✨`);
      return;
    }

    const filteredResults = this.applyResultFilters(activeResults, options);
    const totalActive = activeResults.length;
    if (!quiet && !options?.maxIssues && totalActive > 50) {
      this.logger.info(this.colorize(chalk.gray, `Found ${totalActive} issues. Tip: use --max-issues 10 to focus on critical items first.`));
    }

    const highCount = filteredResults.filter((r) => r.severity === 'high').length;
    const mediumCount = filteredResults.filter((r) => r.severity === 'medium').length;
    const lowCount = filteredResults.filter((r) => r.severity === 'low').length;

    const bands = [
      this.getSeverityBand('high', highCount),
      this.getSeverityBand('medium', mediumCount),
      this.getSeverityBand('low', lowCount),
    ].filter(Boolean).join(' ');
    const suppressedText = suppressedCount > 0
      ? this.colorize(chalk.gray, ` ${suppressedCount} suppressed`)
      : '';

    console.log(`\n${this.brand('🪷')} ${this.colorize(chalk.bold, 'Triage')}: ${bands}${suppressedText}`);

    if (filteredResults.length !== activeResults.length) {
      console.log(`${this.colorize(chalk.gray, `  (showing ${filteredResults.length} of ${activeResults.length} active issues)`)}`);
    }

    this.logger.separator();
    this.logger.title(`Found ${filteredResults.length} issues:`);

    const grouped = this.groupResults(filteredResults, options?.groupBy || 'severity');
    Object.entries(grouped).forEach(([groupKey, groupResults]) => {
      const icon = this.getGroupIcon(groupKey, options?.groupBy || 'category');
      const lotus = this.brand(icon);
      const count = this.colorize(chalk.gray, `(${groupResults.length})`);
      console.log(`\n${lotus} ${this.colorize(chalk.bold, groupKey.toUpperCase())} ${count}:`);

      if (options?.format === 'table') {
        this.renderTableGroup(groupResults);
        return;
      }
      this.renderListGroup(groupResults, options);
    });

    this.logger.separator();
    this.printSummary(results);
    this.printContextualGuidance(results, options);
  }

  private renderTableGroup(rows: ScanResult[]): void {
    const header = `${this.colorize(chalk.gray, 'SEV'.padEnd(6))}  ${this.colorize(chalk.gray, 'RULE'.padEnd(8))}  ${this.colorize(chalk.gray, 'FILE:LINE'.padEnd(32))}  ${this.colorize(chalk.gray, 'CONF'.padEnd(6))}  ${this.colorize(chalk.gray, 'MESSAGE')}`;
    console.log(`  ${header}`);
    rows.forEach((result) => {
      const sev = (result.severity || '').toUpperCase().padEnd(6);
      const rule = (result.ruleId || '').padEnd(8);
      const loc = result.file ? `${result.file}${result.line ? `:${result.line}` : ''}` : '';
      const locCol = (loc.length > 32 ? loc.slice(0, 29) + '…' : loc).padEnd(32);
      const conf = (result.confidence ?? 0).toFixed(2).padEnd(6);
      console.log(`  ${sev}  ${rule}  ${locCol}  ${conf}  ${result.message}`);
    });
  }

  private renderListGroup(rows: ScanResult[], options?: ScanOptions): void {
    rows.forEach((result) => {
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
      const suppressedIndicator = result.suppressed ? this.colorize(chalk.gray, ' [SUPPRESSED]') : '';
      const confText = (options?.showConfidence || options?.verbose)
        ? this.colorize(chalk.gray, ` (confidence: ${(result.confidence ?? 0).toFixed(2)})`)
        : '';
      console.log(`  ${icon} ${badge} ${this.colorize(msgColor, result.message)}${location}${rule}${confText}${suppressedIndicator}`);

      if (result.fix) {
        console.log(`      ${this.brand('🪷')} ${this.colorize(chalk.green, result.fix)}`);
      }
      if (result.suppressed && result.suppressionReason) {
        console.log(`      ${this.colorize(chalk.gray, '🔇')} ${this.colorize(chalk.italic, 'Suppressed: ' + result.suppressionReason)}`);
      }
      if (options?.explain && result.ruleId) {
        const ruleMeta = RULES[result.ruleId];
        if (ruleMeta?.impact) {
          console.log(`      ${this.colorize(chalk.blue, '💡')} ${this.colorize(chalk.italic, ruleMeta.impact)}`);
        }
      }
      if (options?.showContext && result.file && result.line) {
        const context = getCodeContext(result.file, result.line);
        if (context) {
          console.log(`      ${this.colorize(chalk.gray, '┌─ Code context:')}`);
          context.forEach((line, idx) => {
            const lineNum = (result.line! - 2 + idx).toString().padStart(3);
            const isTarget = idx === 2;
            const marker = isTarget ? this.colorize(chalk.red, '►') : this.colorize(chalk.gray, ' ');
            const lineColor = isTarget ? chalk.yellow : chalk.gray;
            console.log(`      ${this.colorize(chalk.gray, '│')} ${marker} ${this.colorize(lineColor, lineNum)} ${this.colorize(lineColor, line)}`);
          });
          console.log(`      ${this.colorize(chalk.gray, '└─')}`);
        }
      }
    });
  }

  private applyResultFilters(results: ScanResult[], options?: ScanOptions): ScanResult[] {
    let filtered = [...results];
    if (options?.minSeverity) {
      const order: Record<string, number> = { low: 1, medium: 2, high: 3 };
      const min = order[options.minSeverity];
      filtered = filtered.filter((r) => order[r.severity] >= min);
    }
    filtered.sort((a, b) => {
      const sev: Record<string, number> = { high: 3, medium: 2, low: 1 };
      const type: Record<string, number> = { error: 3, warning: 2, info: 1 };
      const sevDiff = sev[b.severity] - sev[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return type[b.type] - type[a.type];
    });
    if (options?.maxIssues && options.maxIssues > 0) {
      filtered = filtered.slice(0, options.maxIssues);
    }
    return filtered;
  }

  private groupResults(results: ScanResult[], groupBy: 'category' | 'file' | 'rule' | 'severity'): Record<string, ScanResult[]> {
    return results.reduce((acc, result) => {
      let key: string;
      switch (groupBy) {
        case 'file': key = result.file || 'unknown'; break;
        case 'rule': key = result.ruleId || 'unknown'; break;
        case 'severity': key = result.severity || 'unknown'; break;
        case 'category':
        default: key = result.category; break;
      }
      (acc[key] = acc[key] || []).push(result);
      return acc;
    }, {} as Record<string, ScanResult[]>);
  }

  private getGroupIcon(groupKey: string, groupBy: 'category' | 'file' | 'rule' | 'severity'): string {
    if (groupBy === 'category') {
      const icons: Record<string, string> = {
        security: '🔒', links: '🔗', accessibility: '♿', performance: '⚡', seo: '🔍', development: '🛠️', config: '⚙️',
      };
      return icons[groupKey] || '📋';
    }
    if (groupBy === 'file') return '📄';
    if (groupBy === 'rule') return '⚖️';
    if (groupBy === 'severity') {
      const sev: Record<string, string> = { high: '🚨', medium: '⚠️', low: 'ℹ️' };
      return sev[groupKey] || '📊';
    }
    return '📋';
  }

  private printSummary(results: ScanResult[]): void {
    const errors = results.filter((r) => r.type === 'error').length;
    const warnings = results.filter((r) => r.type === 'warning').length;
    console.log(`\n${this.brand('🪷')} ${this.colorize(chalk.bold, 'Summary')}: ${this.colorize(chalk.red, errors + ' errors')}, ${this.colorize(chalk.yellow, warnings + ' warnings')}`);

    const posture = calculateSecurityPosture(results);
    const postureColor: Styler = posture.score >= 80 ? chalk.green : posture.score >= 60 ? chalk.yellow : chalk.red;
    const postureBar = this.renderPostureBar(posture.score);
    console.log(`${this.brand('🪷')} ${this.colorize(chalk.bold, 'Security Posture')}: ${this.colorize(postureColor, posture.score + '/100')} ${postureBar}`);
    console.log(`   ${this.colorize(chalk.gray, posture.summary)}`);

    if (errors > 0) this.logger.error('Critical issues found that should be fixed immediately');
    else this.logger.success('No critical issues found');
  }

  private renderPostureBar(score: number): string {
    const width = 20;
    const filled = Math.round((score / 100) * width);
    const empty = width - filled;
    const filledChar = this.useColor ? chalk.green('█') : '█';
    const emptyChar = this.useColor ? chalk.gray('░') : '░';
    return `[${filledChar.repeat(filled)}${emptyChar.repeat(empty)}]`;
  }

  private printContextualGuidance(results: ScanResult[], options?: ScanOptions): void {
    if (options?.json || options?.interactive || options?.quiet) return;

    const active = results.filter((r) => !r.suppressed);
    const total = active.length;
    const high = active.filter((r) => r.severity === 'high').length;
    const criticalErrors = active.filter((r) => r.type === 'error' && r.severity === 'high').length;
    const lowConfidence = active.filter((r) => (r.confidence ?? 1) < 0.8).length;
    const suppressed = results.filter((r) => r.suppressed).length;

    const suggestions: string[] = [];
    if (total === 0) {
      if (suppressed > 0) {
        suggestions.push(`${this.brand('🪷')} All issues suppressed. Use ${this.colorize(chalk.cyan, '--show-suppressed')} to review.`);
      } else {
        suggestions.push(`${this.brand('🪷')} No issues found! For complete analysis: ${this.colorize(chalk.cyan, 'ubon scan')}`);
      }
    } else {
      if (criticalErrors > 0) {
        suggestions.push(`${this.colorize(chalk.red, '🚨')} Critical issues need immediate attention! Try: ${this.colorize(chalk.cyan, 'ubon scan --interactive')}`);
      } else if (high > 0) {
        suggestions.push(`${this.colorize(chalk.yellow, '⚠️')} High severity issues found. Focus first: ${this.colorize(chalk.cyan, 'ubon check --focus-critical')}`);
      }
      if (total > 20) {
        suggestions.push(`${this.colorize(chalk.blue, '💡')} Found ${total} issues. Focus on most critical: ${this.colorize(chalk.cyan, 'ubon check --max-issues 5 --group-by severity')}`);
      }
      if (lowConfidence > total * 0.5) {
        suggestions.push(`${this.colorize(chalk.blue, '💡')} Many low-confidence findings. Try: ${this.colorize(chalk.cyan, 'ubon check --min-confidence 0.9')}`);
      }
      if (total > 0 && total <= 15) {
        suggestions.push(`${this.colorize(chalk.green, '🤖')} Share with AI: Copy output and ask "Help me fix these ${total} issues, starting with high severity"`);
      }
      const fixable = active.filter((r) => r.fixEdits && r.fixEdits.length > 0).length;
      if (fixable > 0) {
        suggestions.push(`${this.colorize(chalk.green, '🔧')} ${fixable} issues can be auto-fixed: ${this.colorize(chalk.cyan, 'ubon check --apply-fixes')}`);
      }
    }
    if (suggestions.length > 0) {
      console.log('');
      suggestions.forEach((s) => console.log(s));
    }
  }
}

export function getCodeContext(filePath: string, lineNumber: number): string[] | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const startLine = Math.max(0, lineNumber - 3);
    const endLine = Math.min(lines.length - 1, lineNumber + 1);
    const out: string[] = [];
    for (let i = startLine; i <= endLine; i++) out.push(lines[i] || '');
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}
