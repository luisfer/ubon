#!/usr/bin/env node

import { Command } from 'commander';
import { UbonScan } from './index';
import pkg from '../package.json';
import { ScanResult } from './types';
import { toSarif } from './utils/sarif';
import { getChangedFilesSince } from './utils/git';
import { loadConfig, mergeOptions } from './utils/config';
import { applyFixes } from './utils/fix';
import { installPreCommitHooks } from './utils/hooks';
import { initializeConfig } from './utils/init';
function redact(value?: string): string | undefined {
  if (!value) return value;
  if (/sk-[A-Za-z0-9_-]{8,}/.test(value)) return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-********');
  if (/eyJ[A-Za-z0-9._-]{20,}/.test(value)) return value.replace(/eyJ[A-Za-z0-9._-]{20,}/g, 'eyJ********');
  return value;
}

function generateRecommendations(results: ScanResult[]): string[] {
  const recommendations: string[] = [];
  const categories = results.reduce((acc, result) => {
    acc[result.category] = (acc[result.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (categories.security > 0) {
    recommendations.push('Review and secure all API keys, passwords, and sensitive data');
    recommendations.push('Remove or properly guard console.log statements before production');
  }
  
  if (categories.accessibility > 0) {
    recommendations.push('Add alt attributes to all images for screen readers');
    recommendations.push('Ensure all form inputs have proper labels');
    recommendations.push('Replace clickable divs with semantic button elements');
  }
  
  if (categories.links > 0) {
    recommendations.push('Test all navigation links and fix broken routes');
    recommendations.push('Verify all image assets exist and are accessible');
  }

  const errorCount = results.filter(r => r.type === 'error').length;
  if (errorCount > 0) {
    recommendations.unshift(`🚨 ${errorCount} critical issues require immediate attention`);
  }

  return recommendations;
}

const program = new Command();

program
  .name('ubon')
  .description('Ubon 🪷 — peace of mind for vibe-coded apps')
  .version((pkg as any).version);

program
  .command('scan')
  .description('Scan your React/Next.js application for issues')
  .option('-d, --directory <path>', 'Directory to scan', process.cwd())
  .option('-p, --port <number>', 'Development server port for link checking', '3000')
  .option('--skip-build', 'Skip link checking (only run static analysis)')
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
  .option('--apply-fixes', 'Apply available safe auto-fixes to the codebase')
  .option('--profile <name>', 'Scan profile: auto|react|next|python', 'auto')
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
  .option('--min-severity <level>', 'Minimum severity to show: low|medium|high')
  .option('--max-issues <number>', 'Limit output to N most critical issues')
  .option('--show-context', 'Show code context around findings (3-5 lines)')
  .option('--explain', 'Show "why it matters" explanations for findings')
  .option('--show-suppressed', 'Include suppressed results in output')
  .option('--ignore-suppressed', 'Completely ignore suppressed results (default: hide but count)')
  .action(async (options) => {
    const scanner = new UbonScan(options.verbose, options.json, options.color as 'auto' | 'always' | 'never');
    
    const config = loadConfig(options.directory);
    const cliOptions = {
      directory: options.directory,
      port: options.port ? parseInt(options.port) : undefined,
      skipBuild: options.skipBuild,
      verbose: options.verbose,
      minConfidence: options.minConfidence ? parseFloat(options.minConfidence) : undefined,
      enabledRules: options.enableRule,
      disabledRules: options.disableRule,
      baselinePath: options.baseline,
      updateBaseline: options.updateBaseline,
      useBaseline: options.baseline !== false,
      changedFiles: options.changedFiles,
      gitChangedSince: options.gitChangedSince,
      profile: options.profile,
      gitHistoryDepth: options.gitHistoryDepth ? parseInt(options.gitHistoryDepth) : undefined,
      fast: !!options.fast,
      crawlInternal: !!options.crawlInternal,
      crawlStartUrl: options.crawlStartUrl,
      crawlDepth: options.crawlDepth ? parseInt(options.crawlDepth) : undefined,
      crawlTimeoutMs: options.crawlTimeout ? parseInt(options.crawlTimeout) : undefined,
      detailed: !!options.detailed,
      focusCritical: !!options.focusCritical,
      focusSecurity: !!options.focusSecurity,
      focusNew: !!options.focusNew,
      color: options.color as 'auto' | 'always' | 'never',
      groupBy: options.groupBy as 'category' | 'file' | 'rule' | 'severity',
      minSeverity: options.minSeverity as 'low' | 'medium' | 'high' | undefined,
      maxIssues: options.maxIssues ? parseInt(options.maxIssues) : undefined,
      showContext: !!options.showContext,
      explain: !!options.explain,
      showSuppressed: !!options.showSuppressed,
      ignoreSuppressed: !!options.ignoreSuppressed
    };
    const scanOptions = mergeOptions(config, cliOptions);

    try {
      if (scanOptions.gitChangedSince && (!scanOptions.changedFiles || scanOptions.changedFiles.length === 0)) {
        scanOptions.changedFiles = getChangedFilesSince(scanOptions.gitChangedSince, scanOptions.directory);
      }
      const results = await scanner.diagnose(scanOptions);
      
      if (options.json) {
        // JSON output for AI agents
        const payload = {
          schemaVersion: '1.0.0',
          toolVersion: (pkg as any).version,
          summary: {
            total: results.length,
            errors: results.filter(r => r.type === 'error').length,
            warnings: results.filter(r => r.type === 'warning').length,
            info: results.filter(r => r.type === 'info').length
          },
          issues: results.map(r => ({ ...r, match: redact(r.match) })),
          recommendations: generateRecommendations(results)
        };
        if (options.output) {
          const fs = await import('fs');
          fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
        } else {
          console.log(JSON.stringify(payload, null, 2));
        }
      } else {
        // Human-readable output
        scanner.printResults(results, scanOptions);
      }

      if (options.sarif) {
        const sarif = toSarif(results, options.directory);
        const fs = await import('fs');
        fs.writeFileSync(options.sarif, JSON.stringify(sarif, null, 2));
        console.log(`SARIF report written to ${options.sarif}`);
      }

      if (options.fixDryRun || options.applyFixes) {
        const dryRun = !!options.fixDryRun && !options.applyFixes;
        const { changedFiles, appliedEditCount } = applyFixes(results, options.directory, dryRun);
        if (dryRun) {
          console.log(JSON.stringify({ fixPlan: { files: changedFiles, edits: appliedEditCount } }, null, 2));
        } else {
          console.log(JSON.stringify({ fixesApplied: { files: changedFiles, edits: appliedEditCount } }, null, 2));
        }
      }
      
      // Exit codes based on fail-on (applies to both human and JSON modes)
      {
        const errorCount = results.filter(r => r.type === 'error').length;
        const warningCount = results.filter(r => r.type === 'warning').length;
        const failOn: 'none' | 'warning' | 'error' = (options.failOn || 'error');
        const shouldFail = (failOn === 'error' && errorCount > 0) || (failOn === 'warning' && (errorCount + warningCount) > 0);
        if (shouldFail) process.exit(1);
      }
    } catch (error: any) {
      if (options.json) {
        console.log(JSON.stringify({ error: error?.message || 'Unknown error' }));
      } else {
        console.error('❌ Scan failed:', error);
      }
      process.exit(1);
    }
  });

program
  .command('check')
  .description('Quick health check (static analysis only)')
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
  .option('--apply-fixes', 'Apply available safe auto-fixes to the codebase')
  .option('--profile <name>', 'Scan profile: auto|react|next|python', 'auto')
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
  .option('--min-severity <level>', 'Minimum severity to show: low|medium|high')
  .option('--max-issues <number>', 'Limit output to N most critical issues')
  .option('--show-context', 'Show code context around findings (3-5 lines)')
  .option('--explain', 'Show "why it matters" explanations for findings')
  .option('--show-suppressed', 'Include suppressed results in output')
  .option('--ignore-suppressed', 'Completely ignore suppressed results (default: hide but count)')
  .action(async (options) => {
    const scanner = new UbonScan(options.verbose, options.json, options.color as 'auto' | 'always' | 'never');
    
    const config = loadConfig(options.directory);
    const cliOptions = {
      directory: options.directory,
      skipBuild: true,
      verbose: options.verbose,
      minConfidence: options.minConfidence ? parseFloat(options.minConfidence) : undefined,
      enabledRules: options.enableRule,
      disabledRules: options.disableRule,
      baselinePath: options.baseline,
      updateBaseline: options.updateBaseline,
      useBaseline: options.baseline !== false,
      changedFiles: options.changedFiles,
      gitChangedSince: options.gitChangedSince,
      profile: options.profile,
      gitHistoryDepth: options.gitHistoryDepth ? parseInt(options.gitHistoryDepth) : undefined,
      fast: !!options.fast,
      crawlInternal: !!options.crawlInternal,
      crawlStartUrl: options.crawlStartUrl,
      crawlDepth: options.crawlDepth ? parseInt(options.crawlDepth) : undefined,
      crawlTimeoutMs: options.crawlTimeout ? parseInt(options.crawlTimeout) : undefined,
      detailed: !!options.detailed,
      focusCritical: !!options.focusCritical,
      focusSecurity: !!options.focusSecurity,
      focusNew: !!options.focusNew,
      color: options.color as 'auto' | 'always' | 'never',
      groupBy: options.groupBy as 'category' | 'file' | 'rule' | 'severity',
      minSeverity: options.minSeverity as 'low' | 'medium' | 'high' | undefined,
      maxIssues: options.maxIssues ? parseInt(options.maxIssues) : undefined,
      showContext: !!options.showContext,
      explain: !!options.explain,
      showSuppressed: !!options.showSuppressed,
      ignoreSuppressed: !!options.ignoreSuppressed
    };
    const scanOptions = mergeOptions(config, cliOptions);

    try {
      if (scanOptions.gitChangedSince && (!scanOptions.changedFiles || scanOptions.changedFiles.length === 0)) {
        scanOptions.changedFiles = getChangedFilesSince(scanOptions.gitChangedSince, scanOptions.directory);
      }
      const results = await scanner.diagnose(scanOptions);
      
      if (options.json) {
        // JSON output for AI agents
        const payload = {
          schemaVersion: '1.0.0',
          toolVersion: (pkg as any).version,
          summary: {
            total: results.length,
            errors: results.filter(r => r.type === 'error').length,
            warnings: results.filter(r => r.type === 'warning').length,
            info: results.filter(r => r.type === 'info').length
          },
          issues: results.map(r => ({ ...r, match: redact(r.match) })),
          recommendations: generateRecommendations(results)
        };
        if (options.output) {
          const fs = await import('fs');
          fs.writeFileSync(options.output, JSON.stringify(payload, null, 2));
        } else {
          console.log(JSON.stringify(payload, null, 2));
        }
      } else {
        // Human-readable output
        scanner.printResults(results, scanOptions);
      }
      if (options.sarif) {
        const sarif = toSarif(results, options.directory);
        const fs = await import('fs');
        fs.writeFileSync(options.sarif, JSON.stringify(sarif, null, 2));
        console.log(`SARIF report written to ${options.sarif}`);
      }
      if (options.fixDryRun || options.applyFixes) {
        const dryRun = !!options.fixDryRun && !options.applyFixes;
        const { changedFiles, appliedEditCount } = applyFixes(results, options.directory, dryRun);
        if (dryRun) {
          console.log(JSON.stringify({ fixPlan: { files: changedFiles, edits: appliedEditCount } }, null, 2));
        } else {
          console.log(JSON.stringify({ fixesApplied: { files: changedFiles, edits: appliedEditCount } }, null, 2));
        }
      }
      {
        const errorCount = results.filter(r => r.type === 'error').length;
        const warningCount = results.filter(r => r.type === 'warning').length;
        const failOn: 'none' | 'warning' | 'error' = (options.failOn || 'error');
        const shouldFail = (failOn === 'error' && errorCount > 0) || (failOn === 'warning' && (errorCount + warningCount) > 0);
        if (shouldFail) process.exit(1);
      }
    } catch (error: any) {
      if (options.json) {
        console.log(JSON.stringify({ error: error?.message || 'Unknown error' }));
      } else {
        console.error('❌ Health check failed:', error);
      }
      process.exit(1);
    }
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

program.parse();