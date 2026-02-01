#!/usr/bin/env node

import { Command } from 'commander';
import pkg from '../package.json';
import { installPreCommitHooks } from './utils/hooks';
import { initializeConfig } from './utils/init';
import { runScanCommand, runCheckCommand, CliOptions } from './cli/shared';

const program = new Command();

program
  .name('ubon')
  .description('Ubon 🪷 — peace of mind for vibe-coded apps\n  • Run "ubon guide" for integration documentation\n  • Try "ubon scan --interactive" for guided debugging')
  .version((pkg as any).version);

// Shared options for scan and check commands
const addCommonOptions = (cmd: Command): Command => {
  return cmd
    .option('-d, --directory <path>', 'Directory to scan', process.cwd())
    .option('-v, --verbose', 'Enable verbose output')
    .option('--fail-on <level>', 'Fail on: none|warning|error', 'error')
    .option('--min-confidence <number>', 'Minimum confidence threshold (0.0-1.0)')
    .option('--enable-rule <id...>', 'Only enable these ruleIds (can be repeated)')
    .option('--disable-rule <id...>', 'Disable these ruleIds (can be repeated)')
    .option('--baseline <path>', 'Path to baseline file')
    .option('--update-baseline', 'Update baseline with current findings and exit')
    .option('--no-baseline', 'Do not apply baseline filtering')
    .option('--json', 'Output results as JSON (for AI agents)')
    .option('--sarif <path>', 'Write results as SARIF 2.1.0 to given path')
    .option('--output <path>', 'Write JSON output to file')
    .option('--changed-files <paths...>', 'Limit scanning to these files (relative paths)')
    .option('--git-changed-since <ref>', 'Limit scanning to files changed since Git ref')
    .option('--fix-dry-run', 'Compute and print auto-fix plan without writing files')
    .option('--preview-fixes', 'Show diff-like preview of fixes without applying')
    .option('--apply-fixes', 'Apply available safe auto-fixes to the codebase')
    .option('--profile <name>', 'Scan profile: auto|lovable|react|next|vue|python|rails', 'auto')
    .option('--git-history-depth <n>', 'Scan last N commits for leaked secrets')
    .option('--fast', 'Skip expensive checks (OSV, links) for faster results')
    .option('--crawl-internal', 'Crawl internal links with a headless browser')
    .option('--crawl-start-url <url>', 'Starting URL for internal crawl')
    .option('--crawl-depth <n>', 'Max crawl depth', '2')
    .option('--crawl-timeout <ms>', 'Per-page timeout in ms', '10000')
    .option('--detailed', 'Show all findings including lower-confidence/noisy ones')
    .option('--focus-critical', 'Only show critical (high severity) issues')
    .option('--focus-security', 'Only show security issues (hide a11y/links/etc)')
    .option('--focus-new', 'Only show issues not in baseline')
    .option('--color <mode>', 'Colorize output: auto|always|never', 'auto')
    .option('--group-by <mode>', 'Group results by: category|file|rule|severity', 'category')
    .option('--format <mode>', 'Output format in human mode: human|table', 'human')
    .option('--min-severity <level>', 'Minimum severity to show: low|medium|high')
    .option('--max-issues <number>', 'Limit output to N most critical issues')
    .option('--show-context', 'Show code context around findings (3-5 lines)')
    .option('--explain', 'Show "why it matters" explanations for findings')
    .option('--show-confidence', 'Show per-finding confidence score in human output')
    .option('--show-suppressed', 'Include suppressed results in output')
    .option('--ignore-suppressed', 'Completely ignore suppressed results (default: hide but count)')
    .option('--clear-cache', 'Clear OSV vulnerability cache before scanning')
    .option('--no-cache', 'Disable OSV caching for this scan')
    .option('--no-result-cache', 'Disable per-file result caching')
    .option('--pr-comment', 'Output a Markdown summary suitable for PR comments')
    .option('--interactive', 'Walk through issues interactively with explanations and fix options');
};

// Scan command
const scanCmd = program
  .command('scan')
  .description('Full scan with link checking (try --interactive for guided debugging)')
  .option('-p, --port <number>', 'Development server port for link checking', '3000')
  .option('--skip-build', 'Skip link checking (only run static analysis)')
  .option('--base-sha <ref>', 'In CI, compare against this base ref and only fail on new issues')
  .option('--create-pr', 'After applying fixes, create a PR (uses gh if available)')
  .option('--watch', 'Watch files and re-run on changes (fast mode recommended)')
  .option('--ai-friendly', 'Optimize output for AI consumption (json + context + explain + grouping + cap)');

addCommonOptions(scanCmd).action(async (options: CliOptions) => {
  await runScanCommand(options);
});

// Check command
const checkCmd = program
  .command('check')
  .description('Quick health check (static analysis only, try --ai-friendly for AI assistants)');

addCommonOptions(checkCmd).action(async (options: CliOptions) => {
  await runCheckCommand(options);
});

program
  .command('install-hooks')
  .description('Install git pre-commit hooks for Ubon scanning')
  .option('--mode <type>', 'Hook mode: fast|full', 'fast')
  .option('--fail-on <level>', 'Fail on: error|warning', 'error')
  .action(async (options) => {
    try {
      installPreCommitHooks({ mode: options.mode, failOn: options.failOn });
    } catch (e: any) {
      console.error('❌ Failed to install hooks:', e?.message || e);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Generate ubon.config.json with project-specific settings')
  .option('--profile <type>', 'Override auto-detected profile')
  .option('--interactive', 'Interactive configuration')
  .action(async (options) => {
    try {
      await initializeConfig({ profile: options.profile, interactive: !!options.interactive });
    } catch (e: any) {
      console.error('❌ Init failed:', e?.message || e);
      process.exit(1);
    }
  });

program
  .command('cache')
  .description('Manage Ubon cache')
  .option('--clear', 'Clear all cached data')
  .option('--cleanup', 'Remove expired cache entries')
  .option('--info', 'Show cache information')
  .action(async (options) => {
    const { FileCache } = await import('./utils/cache');
    const osvCache = new FileCache('osv');
    
    if (options.clear) {
      osvCache.clear();
      console.log('🧹 Cache cleared successfully');
    } else if (options.cleanup) {
      osvCache.cleanup();
      console.log('🧹 Expired cache entries removed');
    } else if (options.info) {
      const { join } = await import('path');
      const { homedir } = await import('os');
      const cacheDir = join(homedir(), '.ubon', 'cache');
      console.log(`📁 Cache directory: ${cacheDir}`);
      console.log('💡 Use --clear to remove all cached data');
      console.log('💡 Use --cleanup to remove expired entries');
    } else {
      console.log('Use --clear, --cleanup, or --info');
    }
  });

program
  .command('guide')
  .description('Show integration guide for developers and AI agents')
  .action(async () => {
    const { join } = await import('path');
    const { existsSync } = await import('fs');
    
    const guidePaths = [
      join(__dirname, '..', 'GUIDE.md'),
      join(process.cwd(), 'node_modules', 'ubon', 'GUIDE.md'),
      join(process.cwd(), 'GUIDE.md')
    ];
    
    let guidePath = null;
    for (const path of guidePaths) {
      if (existsSync(path)) {
        guidePath = path;
        break;
      }
    }
    
    if (guidePath) {
      console.log(`🪷 Ubon Integration Guide location:`);
      console.log(`📍 ${guidePath}`);
      console.log('');
      console.log('💡 Quick commands:');
      console.log('   ubon check --json          # Quick analysis');
      console.log('   ubon scan --interactive    # Guided debugging');  
      console.log('   ubon check --apply-fixes   # Auto-fix issues');
      console.log('');
      console.log('🔗 Online: https://github.com/luisfer/ubon/blob/main/GUIDE.md');
    } else {
      console.log('🪷 Ubon Integration Guide');
      console.log('');
      console.log('💡 Essential commands:');
      console.log('   ubon check --json          # Quick static analysis');
      console.log('   ubon scan --interactive    # Guided issue walkthrough');
      console.log('   ubon check --apply-fixes   # Apply safe auto-fixes');
      console.log('   ubon check --focus-critical --focus-security  # Security focus');
      console.log('');
      console.log('🤖 AI workflow:');
      console.log('   1. Run: ubon check --ai-friendly');
      console.log('   2. Share output with AI assistant');
      console.log('   3. Ask: "Help me fix these issues, starting with high severity"');
      console.log('');
      console.log('🔗 Full guide: https://github.com/luisfer/ubon/blob/main/GUIDE.md');
    }
  });

program
  .command('lsp')
  .description('Start the Ubon language server')
  .action(async () => {
    const { startServer } = await import('./lsp/server');
    startServer();
  });

program
  .command('explain <ruleId>')
  .description('Show detailed information about a rule')
  .action(async (ruleId: string) => {
    const { getRule, RULES } = await import('./rules');
    const chalk = (await import('chalk')).default;
    
    const rule = getRule(ruleId.toUpperCase());
    const legacyRule = RULES[ruleId.toUpperCase() as keyof typeof RULES];
    
    if (!rule && !legacyRule) {
      console.error(chalk.red(`❌ Rule "${ruleId}" not found`));
      console.log('');
      console.log('💡 Available rule prefixes:');
      console.log('   SEC001-019   Security rules');
      console.log('   A11Y001-007  Accessibility rules');
      console.log('   DEV001-005   Development rules');
      console.log('   VIBE001-004  Vibe code detection');
      console.log('   NEXT001-203  Next.js specific');
      console.log('   ENV001-005   Environment variables');
      console.log('   LINK001-002  Broken links');
      process.exit(1);
    }
    
    const meta = rule?.meta || legacyRule;
    const impl = rule?.impl;
    
    console.log('');
    console.log(chalk.bold.cyan(`🪷 ${meta.id}: ${meta.message}`));
    console.log('');
    console.log(chalk.bold('Category:'), meta.category);
    console.log(chalk.bold('Severity:'), meta.severity === 'high' ? chalk.red(meta.severity) : meta.severity === 'medium' ? chalk.yellow(meta.severity) : chalk.gray(meta.severity));
    console.log(chalk.bold('Fix:'), meta.fix);
    
    if (meta.impact) {
      console.log(chalk.bold('Impact:'), meta.impact);
    }
    
    if (meta.helpUri) {
      console.log(chalk.bold('Documentation:'), chalk.underline(meta.helpUri));
    }
    
    // Confidence scale explanation
    console.log('');
    console.log(chalk.bold('Confidence Scale:'));
    console.log('  0.9-1.0  Very high - AST-confirmed or exact pattern match');
    console.log('  0.8-0.9  High - Strong pattern match with context');
    console.log('  0.7-0.8  Medium - Pattern match, may need verification');
    console.log('  0.5-0.7  Lower - Heuristic detection, review recommended');
    
    // Show patterns if available
    if (impl?.patterns && impl.patterns.length > 0) {
      console.log('');
      console.log(chalk.bold('Detection Patterns:'));
      impl.patterns.forEach((p: any, i: number) => {
        console.log(`  ${i + 1}. ${p.pattern.toString().slice(0, 60)}...`);
      });
    }
    
    // Examples
    console.log('');
    console.log(chalk.bold('Example triggers:'));
    const examples: Record<string, string[]> = {
      'SEC001': ['const key = "sk-abc123xyz"', 'const stripe = "pk_test_..."'],
      'SEC003': ['const token = "eyJhbGciOiJIUzI1..."'],
      'SEC006': ['const password = "secret123"'],
      'SEC016': ['eval(userInput)'],
      'SEC017': ['<div dangerouslySetInnerHTML={{__html: content}} />'],
      'A11Y001': ['<img src="photo.jpg" />  // missing alt'],
      'VIBE001': ['import { foo } from "non-existent-package"'],
      'VIBE003': ['throw new Error("Not implemented")'],
      'VIBE004': ['export function unusedHelper() {}  // never imported']
    };
    
    const ruleExamples = examples[meta.id.toUpperCase()];
    if (ruleExamples) {
      ruleExamples.forEach(ex => console.log(chalk.gray(`  ${ex}`)));
    } else {
      console.log(chalk.gray('  (No examples available)'));
    }
    
    console.log('');
    console.log(chalk.bold('Suppression:'));
    console.log(chalk.gray(`  // ubon-disable-next-line ${meta.id}`));
    console.log(chalk.gray(`  // ubon-disable-file`));
  });

program.parse();
