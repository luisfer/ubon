#!/usr/bin/env node

import { Command } from 'commander';
import { UbonScan } from './index';
import pkg from '../package.json';
import { ScanResult } from './types';
import { toSarif } from './utils/sarif';
import { getChangedFilesSince, createBranchCommitPush, tryOpenPullRequest, ensureGitRepo } from './utils/git';
import { loadConfig, mergeOptions } from './utils/config';
import { applyFixes } from './utils/fix';
import { installPreCommitHooks } from './utils/hooks';
import { initializeConfig } from './utils/init';
function renderPrMarkdown(results: ScanResult[]): string {
  const groups: Record<string, ScanResult[]> = { high: [], medium: [], low: [] } as any;
  results.forEach(r => { (groups[r.severity] = groups[r.severity] || []).push(r); });
  const lines: string[] = [];
  const counts = {
    high: groups.high?.length || 0,
    medium: groups.medium?.length || 0,
    low: groups.low?.length || 0
  };
  lines.push(`# Ubon Findings`);
  lines.push(`- High: ${counts.high}  •  Medium: ${counts.medium}  •  Low: ${counts.low}`);
  const order: Array<'high'|'medium'|'low'> = ['high','medium','low'];
  order.forEach(sev => {
    const arr = (groups as any)[sev] || [];
    if (arr.length === 0) return;
    const title = sev === 'high' ? 'High' : sev === 'medium' ? 'Medium' : 'Low';
    lines.push(`\n## ${title}`);
    arr.forEach((r: ScanResult) => {
      const loc = r.file ? `${r.file}${r.line ? `:${r.line}` : ''}` : '';
      const conf = (r.confidence ?? 0).toFixed(2);
      const fix = r.fix ? ` — ${r.fix}` : '';
      lines.push(`- [${title}] ${r.ruleId}: ${r.message}${loc ? ` (${loc})` : ''} (confidence: ${conf})${fix}`);
    });
  });
  return lines.join('\n');
}
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
  .description('Ubon 🪷 — peace of mind for vibe-coded apps\n  • Run "ubon guide" for integration documentation\n  • Try "ubon scan --interactive" for guided debugging')
  .version((pkg as any).version);

program
  .command('scan')
  .description('Full scan with link checking (try --interactive for guided debugging)')
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
  .option('--base-sha <ref>', 'In CI, compare against this base ref and only fail on new issues')
  .option('--fix-dry-run', 'Compute and print auto-fix plan without writing files')
  .option('--apply-fixes', 'Apply available safe auto-fixes to the codebase')
  .option('--create-pr', 'After applying fixes, create a PR (uses gh if available)')
  .option('--profile <name>', 'Scan profile: auto|react|next|python', 'auto')
  .option('--git-history-depth <n>', 'Scan last N commits for leaked secrets')
  .option('--fast', 'Skip expensive checks (OSV, links) for faster results')
  .option('--watch', 'Watch files and re-run on changes (fast mode recommended)')
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
  .option('--ai-friendly', 'Optimize output for AI consumption (json + context + explain + grouping + cap)')
  .option('--pr-comment', 'Output a Markdown summary suitable for PR comments')
  .option('--interactive', 'Walk through issues interactively with explanations and fix options')
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
      format: options.format as 'human' | 'table',
      minSeverity: options.minSeverity as 'low' | 'medium' | 'high' | undefined,
      maxIssues: options.maxIssues ? parseInt(options.maxIssues) : undefined,
      showContext: !!options.showContext,
      explain: !!options.explain,
      showConfidence: !!options.showConfidence,
      showSuppressed: !!options.showSuppressed,
      ignoreSuppressed: !!options.ignoreSuppressed,
      clearCache: !!options.clearCache,
      noCache: !!options.noCache,
      interactive: !!options.interactive
    };
    const scanOptions = mergeOptions(config, cliOptions);

    // AI-friendly preset: by default apply human-friendly settings; when flag is present, also force JSON
    const applyAiFriendly = (forceJson: boolean) => {
      if (forceJson) (scanOptions as any).json = true;
      if (typeof scanOptions.showContext === 'undefined') (scanOptions as any).showContext = true;
      if (typeof scanOptions.explain === 'undefined') (scanOptions as any).explain = true;
      if (typeof scanOptions.groupBy === 'undefined') (scanOptions as any).groupBy = 'severity';
      if (!scanOptions.maxIssues) (scanOptions as any).maxIssues = 15;
    };
    if (options.aiFriendly) {
      applyAiFriendly(true);
    } else {
      // default human preset
      applyAiFriendly(false);
    }

    try {
      if (scanOptions.gitChangedSince && (!scanOptions.changedFiles || scanOptions.changedFiles.length === 0)) {
        scanOptions.changedFiles = getChangedFilesSince(scanOptions.gitChangedSince, scanOptions.directory);
      }
      const runOnce = async () => await scanner.diagnose(scanOptions);
      let results = await runOnce();
      
      if (options.prComment) {
        const md = renderPrMarkdown(results);
        console.log(md);
      } else if (options.json) {
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
        await scanner.printResults(results, scanOptions);
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
          if (options.createPr && appliedEditCount > 0 && ensureGitRepo(options.directory)) {
            const branchName = `ubon/fixes-${Date.now()}`;
            const title = `chore(ubon): apply safe autofixes (${appliedEditCount} edits)`;
            const body = `Automated safe fixes applied by Ubon.\n\nFiles changed: ${changedFiles.length}`;
            const pushRes = createBranchCommitPush({ cwd: options.directory, baseBranch: 'main', featureBranch: branchName, title, body });
            if (pushRes.pushed) {
              const prRes = tryOpenPullRequest(options.directory, 'main', branchName, title, body);
              if (prRes.created) {
                console.log('✅ Pull request created');
              } else if (prRes.url) {
                console.log(`➡️  Open PR: ${prRes.url}`);
              }
            }
          }
        }
      }
      
      // Exit codes based on fail-on (applies to both human and JSON modes)
      {
        let considered = results;
        // CI gate: new issues only vs base SHA using fingerprints
        if (options.baseSha) {
          const changed = getChangedFilesSince(options.baseSha, options.directory);
          if (Array.isArray(changed) && changed.length > 0) {
            const changedSet = new Set(changed.map(p => p.replace(/^\.\//, '')));
            considered = results.filter(r => r.file && changedSet.has(r.file));
          }
        }
        const errorCount = considered.filter(r => r.type === 'error').length;
        const warningCount = considered.filter(r => r.type === 'warning').length;
        const failOn: 'none' | 'warning' | 'error' = (options.failOn || 'error');
        const shouldFail = (failOn === 'error' && errorCount > 0) || (failOn === 'warning' && (errorCount + warningCount) > 0);
        if (shouldFail) process.exit(1);
      }

      if (options.watch) {
        const chokidar = await import('chokidar');
        const watcher = chokidar.watch(['**/*.{js,jsx,ts,tsx,vue}'], {
          cwd: options.directory,
          ignored: ['node_modules/**', 'dist/**', 'build/**', '.next/**']
        });
        console.log('👀 Watching for changes...');
        watcher.on('change', async () => {
          try {
            const t0 = Date.now();
            results = await runOnce();
            const dt = Date.now() - t0;
            if (options.json) {
              console.log(JSON.stringify({ summary: { total: results.length }, durationMs: dt }, null, 2));
            } else {
              console.log(`🪷 Re-scan complete in ${dt}ms. Issues: ${results.length}`);
            }
          } catch {}
        });
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
  .description('Quick health check (static analysis only, try --ai-friendly for AI assistants)')
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
  .option('--pr-comment', 'Output a Markdown summary suitable for PR comments')
  .option('--interactive', 'Walk through issues interactively with explanations and fix options')
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
      format: options.format as 'human' | 'table',
      minSeverity: options.minSeverity as 'low' | 'medium' | 'high' | undefined,
      maxIssues: options.maxIssues ? parseInt(options.maxIssues) : undefined,
      showContext: !!options.showContext,
      explain: !!options.explain,
      showConfidence: !!options.showConfidence,
      showSuppressed: !!options.showSuppressed,
      ignoreSuppressed: !!options.ignoreSuppressed,
      clearCache: !!options.clearCache,
      noCache: !!options.noCache,
      interactive: !!options.interactive
    };
    const scanOptions = mergeOptions(config, cliOptions);

    try {
      if (scanOptions.gitChangedSince && (!scanOptions.changedFiles || scanOptions.changedFiles.length === 0)) {
        scanOptions.changedFiles = getChangedFilesSince(scanOptions.gitChangedSince, scanOptions.directory);
      }
      const results = await scanner.diagnose(scanOptions);
      
      if (options.prComment) {
        const md = renderPrMarkdown(results);
        console.log(md);
      } else if (options.json) {
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
        await scanner.printResults(results, scanOptions);
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
    
    // Try to find the guide file
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

program.parse();