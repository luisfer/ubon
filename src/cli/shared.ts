import { UbonScan } from '../index';
import { ScanResult, ScanOptions } from '../types';
import { toSarif } from '../utils/sarif';
import { getChangedFilesSince, createBranchCommitPush, tryOpenPullRequest, ensureGitRepo } from '../utils/git';
import { loadConfig, mergeOptions } from '../utils/config';
import { applyFixes, previewFixes, printFixPreviews } from '../utils/fix';
import { redact as sharedRedact } from '../utils/redact';
import { REMOVED_PROFILES } from '../core/profiles';
import pkg from '../../package.json';

/**
 * Strip undefined fields and let `stableStringify` sort the rest. Keeping
 * undefined out of the payload prevents non-deterministic key churn (a key
 * present in some issues but absent in others would otherwise change the
 * sorted output's shape).
 */
function normaliseIssue(issue: ScanResult & { match?: string | undefined }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(issue)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Deterministic JSON serialiser: sorts keys alphabetically at every level so
 * the output is byte-for-byte identical across runs. Required for CI diffs,
 * baseline files, and the upcoming MCP transport.
 */
function stableStringify(value: unknown, indent: number = 2): string {
  const replacer = (_key: string, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as object)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(value, replacer, indent);
}

export function renderPrMarkdown(results: ScanResult[]): string {
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

// Re-export the centralized redactor so existing imports keep working.
export const redact = sharedRedact;

export function generateRecommendations(results: ScanResult[]): string[] {
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

export interface CliOptions {
  directory: string;
  port?: string;
  skipBuild?: boolean;
  verbose?: boolean;
  failOn?: string;
  minConfidence?: string;
  enableRule?: string[];
  disableRule?: string[];
  baseline?: string | false;
  updateBaseline?: boolean;
  changedFiles?: string[];
  gitChangedSince?: string;
  baseSha?: string;
  fixDryRun?: boolean;
  previewFixes?: boolean;
  applyFixes?: boolean;
  createPr?: boolean;
  profile?: string;
  gitHistoryDepth?: string;
  fast?: boolean;
  watch?: boolean;
  crawlInternal?: boolean;
  crawlStartUrl?: string;
  crawlDepth?: string;
  crawlTimeout?: string;
  detailed?: boolean;
  focusCritical?: boolean;
  focusSecurity?: boolean;
  focusNew?: boolean;
  color?: string;
  groupBy?: string;
  format?: string;
  minSeverity?: string;
  maxIssues?: string;
  showContext?: boolean;
  explain?: boolean;
  showConfidence?: boolean;
  showSuppressed?: boolean;
  ignoreSuppressed?: boolean;
  clearCache?: boolean;
  noCache?: boolean;
  noResultCache?: boolean;
  aiFriendly?: boolean;
  prComment?: boolean;
  interactive?: boolean;
  json?: boolean;
  ndjson?: boolean;
  sarif?: string;
  output?: string;
  quiet?: boolean;
  allowConfigJs?: boolean;
  schema?: boolean;
}

export function buildScanOptions(options: CliOptions, defaults: Partial<ScanOptions> = {}): ScanOptions {
  const config = loadConfig(options.directory, { allowConfigJs: !!options.allowConfigJs });
  const cliOptions: Partial<ScanOptions> = {
    directory: options.directory,
    port: options.port ? parseInt(options.port) : undefined,
    skipBuild: options.skipBuild ?? defaults.skipBuild,
    verbose: options.verbose,
    minConfidence: options.minConfidence ? parseFloat(options.minConfidence) : undefined,
    enabledRules: options.enableRule,
    disabledRules: options.disableRule,
    baselinePath: options.baseline === false ? undefined : options.baseline,
    updateBaseline: options.updateBaseline,
    useBaseline: options.baseline !== false,
    changedFiles: options.changedFiles,
    gitChangedSince: options.gitChangedSince,
    profile: ((): ScanOptions['profile'] => {
      const raw = options.profile as string | undefined;
      if (raw && Object.prototype.hasOwnProperty.call(REMOVED_PROFILES, raw)) {
        process.stderr.write(
          `🪷 ubon: profile "${raw}" was removed in v3.0.0. ` +
          `${REMOVED_PROFILES[raw]} See MIGRATION-v3.md.\n`
        );
        process.exit(2);
      }
      return raw as ScanOptions['profile'];
    })(),
    gitHistoryDepth: options.gitHistoryDepth ? parseInt(options.gitHistoryDepth) : undefined,
    fast: !!options.fast,
    crawlInternal: ((): boolean => {
      if (options.crawlInternal) {
        process.stderr.write(
          '🪷 `--crawl-internal` (puppeteer) is deprecated and will be removed in v3.1. ' +
          'Use a dedicated link checker (e.g. lychee, linkinator) instead.\n'
        );
      }
      return !!options.crawlInternal;
    })(),
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
    noResultCache: !!options.noResultCache,
    interactive: !!options.interactive,
    quiet: !!options.quiet,
    ndjson: !!options.ndjson,
    json: !!options.json,
    allowConfigJs: !!options.allowConfigJs
  };
  return mergeOptions(config, cliOptions);
}

export function applyAiFriendlyPreset(scanOptions: ScanOptions, forceJson: boolean): void {
  if (forceJson) (scanOptions as any).json = true;
  if (typeof scanOptions.showContext === 'undefined') (scanOptions as any).showContext = true;
  if (typeof scanOptions.explain === 'undefined') (scanOptions as any).explain = true;
  if (typeof scanOptions.groupBy === 'undefined') (scanOptions as any).groupBy = 'severity';
  if (!scanOptions.maxIssues) (scanOptions as any).maxIssues = 15;
}

export async function outputResults(
  scanner: UbonScan,
  results: ScanResult[],
  scanOptions: ScanOptions,
  options: CliOptions
): Promise<void> {
  if (options.prComment) {
    const md = renderPrMarkdown(results);
    console.log(md);
  } else if (options.json || options.ndjson) {
    // Sort by severity → file → line → ruleId for byte-deterministic output.
    // Agents and CI diff tools rely on stable ordering.
    const sevOrder = { high: 0, medium: 1, low: 2 } as Record<string, number>;
    const sorted = [...results].sort((a, b) =>
      (sevOrder[a.severity] - sevOrder[b.severity]) ||
      (a.file || '').localeCompare(b.file || '') ||
      ((a.line || 0) - (b.line || 0)) ||
      a.ruleId.localeCompare(b.ruleId)
    );

    const issues = sorted.map(r => normaliseIssue({ ...r, match: redact(r.match) }));

    if (options.ndjson) {
      // Each finding must serialise on a single line so consumers can
      // splitOnLine and JSON.parse incrementally. Pass indent=0 to stableStringify.
      const lines = issues.map(i => stableStringify(i, 0)).join('\n');
      if (options.output) {
        const fs = await import('fs');
        fs.writeFileSync(options.output, lines + '\n');
      } else {
        process.stdout.write(lines + '\n');
      }
    } else {
      const payload = {
        schemaVersion: '2.0.0',
        toolVersion: (pkg as any).version,
        summary: {
          total: sorted.length,
          errors: sorted.filter(r => r.type === 'error').length,
          warnings: sorted.filter(r => r.type === 'warning').length,
          info: sorted.filter(r => r.type === 'info').length
        },
        issues,
        recommendations: generateRecommendations(sorted)
      };
      const serialised = stableStringify(payload, 2);
      if (options.output) {
        const fs = await import('fs');
        fs.writeFileSync(options.output, serialised + '\n');
      } else {
        process.stdout.write(serialised + '\n');
      }
    }
  } else {
    await scanner.printResults(results, scanOptions);
  }

  if (options.sarif) {
    const sarif = toSarif(results, options.directory);
    const fs = await import('fs');
    fs.writeFileSync(options.sarif, JSON.stringify(sarif, null, 2));
    console.log(`SARIF report written to ${options.sarif}`);
  }
}

export async function handleFixes(
  results: ScanResult[],
  options: CliOptions
): Promise<void> {
  // Handle preview-fixes first (read-only)
  if (options.previewFixes) {
    const previews = previewFixes(results, options.directory);
    printFixPreviews(previews);
    return;
  }

  if (!options.fixDryRun && !options.applyFixes) return;

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

export function checkExitCondition(
  results: ScanResult[],
  options: CliOptions
): boolean {
  let considered = results;
  
  if (options.baseSha) {
    const changed = getChangedFilesSince(options.baseSha, options.directory);
    if (Array.isArray(changed) && changed.length > 0) {
      const changedSet = new Set(changed.map(p => p.replace(/^\.\//, '')));
      considered = results.filter(r => r.file && changedSet.has(r.file));
    }
  }
  
  const errorCount = considered.filter(r => r.type === 'error').length;
  const warningCount = considered.filter(r => r.type === 'warning').length;
  const failOn: 'none' | 'warning' | 'error' = (options.failOn as any) || 'error';
  
  return (failOn === 'error' && errorCount > 0) || (failOn === 'warning' && (errorCount + warningCount) > 0);
}

export async function runScanCommand(
  options: CliOptions,
  defaults: Partial<ScanOptions> = {}
): Promise<void> {
  if (options.schema) {
    if (await dumpSchema()) return;
  }
  // --ndjson and --json both require stdout to contain only the JSON payload.
  // Force quiet mode in that case so progress chatter doesn't corrupt parsing.
  const effectiveQuiet = options.quiet || options.ndjson || options.json;
  const scanner = new UbonScan(options.verbose, options.json, options.color as 'auto' | 'always' | 'never', effectiveQuiet);
  const scanOptions = buildScanOptions(options, defaults);
  if (effectiveQuiet) scanOptions.quiet = true;

  if (options.aiFriendly) {
    applyAiFriendlyPreset(scanOptions, true);
  } else {
    applyAiFriendlyPreset(scanOptions, false);
  }

  try {
    if (scanOptions.gitChangedSince && (!scanOptions.changedFiles || scanOptions.changedFiles.length === 0)) {
      scanOptions.changedFiles = getChangedFilesSince(scanOptions.gitChangedSince, scanOptions.directory);
    }
    
    const runOnce = async () => await scanner.diagnose(scanOptions);
    let results = await runOnce();

    await outputResults(scanner, results, scanOptions, options);
    await handleFixes(results, options);

    if (checkExitCondition(results, options)) {
      process.exit(1);
    }

    if (options.watch) {
      const chokidar = await import('chokidar');
      const watcher = chokidar.watch(['**/*.{js,jsx,ts,tsx,svelte,astro}'], {
        cwd: options.directory,
        ignored: ['node_modules/**', 'dist/**', 'build/**', '.next/**']
      });
      console.log('👀 Watching for changes...');
      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let isScanning = false;
      watcher.on('change', async () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
          if (isScanning) return;
          isScanning = true;
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
          isScanning = false;
        }, 300);
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
}

export async function dumpSchema(): Promise<boolean> {
  const path = await import('path');
  const fs = await import('fs');
  const schemaPath = path.join(__dirname, '..', '..', 'docs', 'schema', 'ubon-finding.schema.json');
  if (fs.existsSync(schemaPath)) {
    process.stdout.write(fs.readFileSync(schemaPath, 'utf8'));
    return true;
  }
  return false;
}

export async function runCheckCommand(options: CliOptions): Promise<void> {
  if (options.schema) {
    if (await dumpSchema()) return;
  }
  const effectiveQuiet = options.quiet || options.ndjson || options.json;
  const scanner = new UbonScan(options.verbose, options.json, options.color as 'auto' | 'always' | 'never', effectiveQuiet);
  const scanOptions = buildScanOptions(options, { skipBuild: true });
  if (effectiveQuiet) scanOptions.quiet = true;

  try {
    if (scanOptions.gitChangedSince && (!scanOptions.changedFiles || scanOptions.changedFiles.length === 0)) {
      scanOptions.changedFiles = getChangedFilesSince(scanOptions.gitChangedSince, scanOptions.directory);
    }
    
    const results = await scanner.diagnose(scanOptions);

    await outputResults(scanner, results, scanOptions, options);
    await handleFixes(results, options);

    if (checkExitCondition(results, options)) {
      process.exit(1);
    }
  } catch (error: any) {
    if (options.json) {
      console.log(JSON.stringify({ error: error?.message || 'Unknown error' }));
    } else {
      console.error('❌ Health check failed:', error);
    }
    process.exit(1);
  }
}
