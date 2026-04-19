#!/usr/bin/env node

import { Command } from 'commander';
import pkg from '../package.json';
import { installPreCommitHooks } from './utils/hooks';
import { initializeConfig } from './utils/init';
import { runScanCommand, runCheckCommand, CliOptions } from './cli/shared';

const program = new Command();

program
  .name('ubon')
  .description('Ubon 🪷 — peace of mind for AI-generated apps\n  • Try "ubon scan --interactive" for guided debugging\n  • Try "ubon mcp" to expose the scanner to your AI assistant')
  .version((pkg as any).version);

// One-shot, best-effort update notifier. Runs after the command completes
// so it never blocks the user; fails silently in air-gapped environments.
function maybeNotifyUpdate(): void {
  if (process.env.UBON_DISABLE_UPDATE_NOTIFIER === '1') return;
  if (process.env.CI || process.env.NODE_ENV === 'test') return;
  process.on('exit', () => {
    try {
      // Lazy-require so the dep stays optional and doesn't slow down startup.
      const updateNotifier = require('update-notifier');
      updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 24 }).notify({ defer: false });
    } catch {
      /* ignore — notifier is best-effort */
    }
  });
}
maybeNotifyUpdate();

program
  .command('doctor')
  .description('Diagnose the local Ubon environment (Node version, optional deps, git, etc.)')
  .option('-d, --directory <path>', 'Project directory', process.cwd())
  .action(async (opts: { directory: string }) => {
    const { runDoctor } = await import('./cli/doctor');
    await runDoctor(opts.directory);
  });

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
    .option('--profile <name>', 'Scan profile: auto|lovable|react|next|sveltekit|astro|remix|hono', 'auto')
    .option('--git-history-depth <n>', 'Scan last N commits for leaked secrets')
    .option('--fast', 'Skip expensive checks (OSV, links) for faster results')
    .option('--crawl-internal', '[deprecated v3] Crawl internal links with a headless browser (puppeteer)')
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
    .option('--interactive', 'Walk through issues interactively with explanations and fix options')
    .option('--ndjson', 'Output one JSON-encoded finding per line (streaming-friendly)')
    .option('--quiet', 'Suppress banners, suggestions, and contextual guidance (CI-friendly)')
    .option('--allow-config-js', 'Permit loading ubon.config.js (executes user-supplied code)')
    .option('--schema', 'Print the JSON Schema for --json output and exit');
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
  .description('[deprecated in v3] Print pointer to the docs site')
  .action(async () => {
    // The interactive `guide` command shipped a lot of duplicated copy
    // and the rotating "tip of the day" suggestion. v3 collapses both
    // into a single pointer; the canonical content lives in docs/ and on
    // the README so we don't have three sources of truth.
    console.error('🪷 `ubon guide` is deprecated and will be removed in v3.1.');
    console.error('   See: https://github.com/luisfer/ubon#readme');
    console.error('   Or: https://github.com/luisfer/ubon/tree/main/docs');
  });

program
  .command('lsp')
  .description('Start the Ubon language server')
  .action(async () => {
    const { startServer } = await import('./lsp/server');
    startServer();
  });

const hooksCmd = program.command('hooks').description('Manage Ubon editor hook integrations');
hooksCmd
  .command('install')
  .description('Install a Cursor hooks template that runs Ubon on every file edit and prompt')
  .option('--cursor', 'Install Cursor hooks (.cursor/hooks.json + scripts) — default', true)
  .option('-d, --directory <path>', 'Project directory', process.cwd())
  .option('--force', 'Overwrite existing files instead of merging', false)
  .action(async (opts: { cursor?: boolean; directory: string; force?: boolean }) => {
    if (!opts.cursor) {
      console.error('🪷 Only --cursor hooks are supported right now.');
      process.exit(1);
    }
    const { installCursorHooks } = await import('./cli/hooks');
    const { wrote, skipped } = installCursorHooks({
      directory: opts.directory,
      cursor: true,
      force: !!opts.force
    });
    for (const file of wrote) console.log('🪷 wrote   ', file);
    for (const file of skipped) console.log('🪷 skipped ', file, '(exists; use --force to overwrite)');
    console.log('\n🪷 Cursor will pick up hooks.json automatically. Restart Cursor if not.');
  });

program
  .command('mcp')
  .description('Start the Ubon MCP (Model Context Protocol) server over stdio')
  .action(async () => {
    const { startMcpServer } = await import('./mcp/server');
    await startMcpServer();
  });

program
  .command('completion <shell>')
  .description('Print shell completion script (bash | zsh | fish)')
  .action(async (shell: string) => {
    const { emit } = await import('./cli/completion');
    const { ok, output } = emit(shell);
    if (ok) {
      process.stdout.write(output);
    } else {
      process.stderr.write(output);
      process.exit(1);
    }
  });

program
  .command('explain <ruleId>')
  .description('Show detailed information about a rule')
  .action(async (ruleId: string) => {
    const { getRule, RULES } = await import('./rules');
    const { default: chalk } = await import('./utils/colors');
    
    const rule = getRule(ruleId.toUpperCase());
    const legacyRule = RULES[ruleId.toUpperCase() as keyof typeof RULES];
    
    if (!rule && !legacyRule) {
      console.error(chalk.red(`❌ Rule "${ruleId}" not found`));
      console.log('');
      console.log('💡 Available rule prefixes:');
      const ids = Object.keys(RULES);
      const buckets = new Map<string, string[]>();
      for (const id of ids) {
        const m = id.match(/^([A-Z]+)\d+/);
        const prefix = m ? m[1] : id;
        const arr = buckets.get(prefix) || [];
        arr.push(id);
        buckets.set(prefix, arr);
      }
      const sorted = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const pad = sorted.reduce((max, [p]) => Math.max(max, p.length), 0);
      const numericTail = (id: string) => parseInt(id.replace(/^[A-Z]+/, ''), 10) || 0;
      for (const [prefix, list] of sorted) {
        const nums = list.map(numericTail).filter(n => n > 0).sort((a, b) => a - b);
        const range = nums.length === 0
          ? `(${list.length} rules)`
          : nums.length === 1 ? `${prefix}${String(nums[0]).padStart(3, '0')}`
            : `${prefix}${String(nums[0]).padStart(3, '0')}-${String(nums[nums.length - 1]).padStart(3, '0')} (${list.length})`;
        console.log(`   ${prefix.padEnd(pad)}  ${range}`);
      }
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
