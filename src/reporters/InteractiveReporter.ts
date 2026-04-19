import { ScanOptions, ScanResult } from '../types';
import chalk from '../utils/colors';
import type { Styler } from '../utils/colors';
import { RULES } from '../rules';
import { getCodeContext } from './HumanReporter';

/**
 * Walks the user through issues one at a time. Optimized for triage
 * sessions where the user wants to *understand* a finding before deciding
 * to fix, suppress, or ignore it. Output uses a fixed 65-column box so it
 * renders consistently across terminal widths.
 */
export class InteractiveReporter {
  private useColor: boolean;

  constructor(colorMode: 'auto' | 'always' | 'never' = 'auto') {
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

  async run(results: ScanResult[], options: ScanOptions): Promise<void> {
    console.log(`\n${this.brand('🪷')} Found ${results.length} issues. Let's walk through them together...\n`);
    if (results.length === 0) {
      console.log(`${this.brand('🪷')} Perfect! No issues found. Your app is ready to bloom! ✨\n`);
      return;
    }
    const sorted = [...results].sort((a, b) => {
      const sev = { high: 3, medium: 2, low: 1 } as Record<string, number>;
      const type = { error: 3, warning: 2, info: 1 } as Record<string, number>;
      const sevDiff = sev[b.severity] - sev[a.severity];
      if (sevDiff !== 0) return sevDiff;
      return type[b.type] - type[a.type];
    });

    for (let i = 0; i < sorted.length; i++) {
      const result = sorted[i];
      const choice = await this.presentIssue(result, i + 1, sorted.length, options);
      if (choice === 'quit') {
        console.log(`\n${this.brand('🪷')} Interactive session ended. Remaining issues can be viewed with normal scan.\n`);
        break;
      }
    }
    console.log(`\n${this.brand('🪷')} Interactive walkthrough complete! ✨\n`);
  }

  private async presentIssue(result: ScanResult, current: number, total: number, _options: ScanOptions): Promise<string> {
    const severityColor = this.getSeverityColor(result.severity);
    const typeIcon = result.type === 'error' ? '❌' : '⚠️';

    console.log(`┌${'─'.repeat(65)}┐`);
    console.log(`│ Issue ${current} of ${total} ${' '.repeat(Math.max(0, 65 - (`Issue ${current} of ${total} `).length))}│`);
    console.log(`│ ${typeIcon} ${severityColor} - ${result.ruleId} ${' '.repeat(Math.max(0, 65 - (`${typeIcon} ${result.severity.toUpperCase()} - ${result.ruleId} `).length))}│`);
    console.log(`│ ${result.message} ${' '.repeat(Math.max(0, 65 - (result.message.length + 1)))}│`);
    if (result.file) {
      const location = `${result.file}${result.line ? `:${result.line}` : ''}`;
      console.log(`│ ${this.colorize(chalk.gray, location)} ${' '.repeat(Math.max(0, 65 - (location.length + 1)))}│`);
    }
    console.log(`├${'─'.repeat(65)}┤`);

    const meta = RULES[result.ruleId];
    if (meta?.impact) {
      console.log(`│ ${this.colorize(chalk.blue, '💡 Why this matters:')} ${' '.repeat(65 - '💡 Why this matters: '.length)}│`);
      this.wrapText(meta.impact, 63).forEach((line) => {
        console.log(`│ ${line} ${' '.repeat(Math.max(0, 65 - (line.length + 1)))}│`);
      });
      console.log(`├${'─'.repeat(65)}┤`);
    }
    if (result.fix) {
      console.log(`│ ${this.colorize(chalk.green, '🔧 Suggested fix:')} ${' '.repeat(65 - '🔧 Suggested fix: '.length)}│`);
      this.wrapText(result.fix, 63).forEach((line) => {
        console.log(`│ ${line} ${' '.repeat(Math.max(0, 65 - (line.length + 1)))}│`);
      });
      console.log(`├${'─'.repeat(65)}┤`);
    }

    if (result.file && result.line) {
      const context = getCodeContext(result.file, result.line);
      if (context) {
        console.log(`│ ${this.colorize(chalk.gray, '📋 Code context:')} ${' '.repeat(65 - '📋 Code context: '.length)}│`);
        context.slice(0, 3).forEach((line, idx) => {
          const lineNum = (result.line! - 2 + idx).toString().padStart(3);
          const isTarget = idx === 1;
          const marker = isTarget ? this.colorize(chalk.red, '►') : ' ';
          const display = `${marker} ${lineNum} ${line}`.slice(0, 63);
          console.log(`│ ${display} ${' '.repeat(Math.max(0, 65 - (display.length + 1)))}│`);
        });
        console.log(`├${'─'.repeat(65)}┤`);
      }
    }

    console.log(`│ [${this.colorize(chalk.green, 'f')}]ix automatically  [${this.colorize(chalk.yellow, 's')}]kip  [${this.colorize(chalk.blue, 'b')}]aseline  [${this.colorize(chalk.cyan, 'n')}]ext ${' '.repeat(24)}│`);
    console.log(`│ [${this.colorize(chalk.red, 'q')}]uit  [${this.colorize(chalk.gray, '?')}]help ${' '.repeat(50)}│`);
    console.log(`└${'─'.repeat(65)}┘`);

    return await this.promptUserChoice();
  }

  private getSeverityColor(severity: string): string {
    const colors: Record<string, string> = {
      high: this.colorize(chalk.red, 'HIGH'),
      medium: this.colorize(chalk.yellow, 'MEDIUM'),
      low: this.colorize(chalk.green, 'LOW'),
    };
    return colors[severity] || severity.toUpperCase();
  }

  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + w).length <= maxWidth) cur += (cur ? ' ' : '') + w;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  private async promptUserChoice(): Promise<string> {
    return new Promise((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('Choose an action: ', (answer: string) => {
        rl.close();
        const choice = answer.toLowerCase().trim();
        switch (choice) {
          case 'f': case 'fix': resolve('fix'); break;
          case 's': case 'skip': resolve('skip'); break;
          case 'b': case 'baseline': resolve('baseline'); break;
          case 'n': case 'next': resolve('next'); break;
          case 'q': case 'quit': resolve('quit'); break;
          case '?': case 'help':
            console.log('\nAvailable actions:');
            console.log('  f, fix      - Apply automatic fix if available');
            console.log('  s, skip     - Skip this issue');
            console.log('  b, baseline - Add to baseline (suppress)');
            console.log('  n, next     - Continue to next issue');
            console.log('  q, quit     - Exit interactive mode');
            console.log('  ?, help     - Show this help\n');
            resolve('help');
            break;
          default:
            console.log('Invalid choice. Press ? for help.');
            resolve('help');
            break;
        }
      });
    });
  }
}
