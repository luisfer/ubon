import type { DiffContext, Rule } from '../types.ts';
import { isFixtureData } from './shared.ts';
import { workflowWeakenings } from './weakened-ci.ts';
import {
  type ValueAt,
  type Weakening,
  biomeWeakenings,
  eslintFlatRules,
  eslintRulesFromValues,
  jsConfigValues,
  lintRuleWeakenings,
  pythonCoverageWeakenings,
  scriptWeakenings,
  structuredValues,
  thresholdWeakenings,
  thresholds,
  tsconfigWeakenings,
} from './weakened-config.ts';

/**
 * The project's own checks made weaker: TypeScript strictness turned off,
 * coverage thresholds lowered, test scripts that swallow failures, CI checks
 * removed or allowed to fail, and lint rules moved from error to warn or off.
 * Raising strictness or thresholds is never reported. Config files are
 * parsed and compared by value.
 */

const TSCONFIG = /(^|\/)(tsconfig|jsconfig)[\w.-]*\.json$/;
const WORKFLOW = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/;
const JEST_CONFIG = /(^|\/)jest\.config\.([cm]?[jt]s|json)$/;
const VITEST_CONFIG = /(^|\/)(vitest|vite)\.config\.[cm]?[jt]s$|(^|\/)vitest\.(workspace|projects)\.[cm]?[jt]s$/;
const NYC = /(^|\/)(\.nycrc(\.json|\.ya?ml)?|\.c8rc(\.json)?)$/;
const ESLINTRC = /(^|\/)\.eslintrc(\.json|\.ya?ml|\.[cm]?js)?$/;
const ESLINT_FLAT = /(^|\/)eslint\.config\.[cm]?[jt]s$/;
const BIOME = /(^|\/)biome\.jsonc?$/;
const OXLINT = /(^|\/)\.?oxlintrc\.json$/;
const PY_COVERAGE = /(^|\/)(\.coveragerc|pyproject\.toml|setup\.cfg|tox\.ini|pytest\.ini)$/;
const PACKAGE = /(^|\/)package\.json$/;

const ALL = [TSCONFIG, WORKFLOW, JEST_CONFIG, VITEST_CONFIG, NYC, ESLINTRC, ESLINT_FLAT, BIOME, OXLINT, PY_COVERAGE, PACKAGE];

function kindOf(path: string): 'json' | 'yaml' | 'js' {
  if (/\.ya?ml$/.test(path)) return 'yaml';
  if (/\.[cm]?[jt]s$/.test(path)) return 'js';
  return 'json';
}

function valuesOf(text: string, ctx: DiffContext, root: string[] = []): Map<string, ValueAt> | null {
  const kind = kindOf(ctx.file.path);
  if (kind === 'js') return jsConfigValues(text, ctx.file.lang);
  // .nycrc and .eslintrc without an extension may be JSON or YAML.
  const json = structuredValues(text, kind, root);
  return json ?? (kind === 'json' ? structuredValues(text, 'yaml', root) : null);
}

function otherWorkflows(ctx: DiffContext): string[] {
  const out: string[] = [];
  for (const f of ctx.project.files) {
    if (f === ctx.file.path || !WORKFLOW.test(f)) continue;
    const text = ctx.project.read(f);
    if (text) out.push(text);
  }
  return out;
}

function weakenings(ctx: DiffContext, before: string, after: string | null): Weakening[] {
  const path = ctx.file.path;
  if (WORKFLOW.test(path)) return workflowWeakenings(path, before, after, otherWorkflows(ctx));
  if (after === null) return [];
  if (TSCONFIG.test(path)) return tsconfigWeakenings(path, before, after, (p) => ctx.project.read(p));
  if (PY_COVERAGE.test(path)) return pythonCoverageWeakenings(path, before, after);
  if (PACKAGE.test(path)) {
    const out = scriptWeakenings(path, before, after);
    const b = { jest: valuesOf(before, ctx, ['jest']), nyc: valuesOf(before, ctx, ['nyc']), c8: valuesOf(before, ctx, ['c8']), eslint: valuesOf(before, ctx, ['eslintConfig']) };
    const a = { jest: valuesOf(after, ctx, ['jest']), nyc: valuesOf(after, ctx, ['nyc']), c8: valuesOf(after, ctx, ['c8']), eslint: valuesOf(after, ctx, ['eslintConfig']) };
    if (b.jest && a.jest) out.push(...thresholdWeakenings(path, thresholds(b.jest, 'jest'), thresholds(a.jest, 'jest'), a.jest, 'coverageThreshold'));
    for (const tool of ['nyc', 'c8'] as const) {
      const bv = b[tool];
      const av = a[tool];
      if (bv && av) out.push(...thresholdWeakenings(`${path} (${tool})`, thresholds(bv, 'nyc'), thresholds(av, 'nyc'), av, ''));
    }
    if (b.eslint && a.eslint) out.push(...lintRuleWeakenings(path, 'ESLint', eslintRulesFromValues(b.eslint), eslintRulesFromValues(a.eslint)));
    return out;
  }
  if (JEST_CONFIG.test(path) || VITEST_CONFIG.test(path) || NYC.test(path)) {
    const tool = JEST_CONFIG.test(path) ? 'jest' : VITEST_CONFIG.test(path) ? 'vitest' : 'nyc';
    const bv = valuesOf(before, ctx);
    const av = valuesOf(after, ctx);
    if (!bv || !av) return [];
    return thresholdWeakenings(path, thresholds(bv, tool), thresholds(av, tool), av, tool === 'jest' ? 'coverageThreshold' : tool === 'vitest' ? 'test.coverage' : '');
  }
  if (ESLINT_FLAT.test(path)) {
    const bv = eslintFlatRules(before, ctx.file.lang);
    const av = eslintFlatRules(after, ctx.file.lang);
    return bv && av ? lintRuleWeakenings(path, 'ESLint', bv, av) : [];
  }
  if (ESLINTRC.test(path) || OXLINT.test(path)) {
    const bv = valuesOf(before, ctx);
    const av = valuesOf(after, ctx);
    return bv && av ? lintRuleWeakenings(path, OXLINT.test(path) ? 'oxlint' : 'ESLint', eslintRulesFromValues(bv), eslintRulesFromValues(av)) : [];
  }
  if (BIOME.test(path)) {
    const bv = valuesOf(before, ctx);
    const av = valuesOf(after, ctx);
    return bv && av ? biomeWeakenings(path, bv, av) : [];
  }
  return [];
}

export const checksWeakened: Rule = {
  meta: {
    id: 'integrity/checks-weakened',
    level: 'block',
    scope: 'diff',
    title: 'Project checks weakened in the change',
    summary:
      'TypeScript strictness turned off, coverage thresholds lowered, test scripts changed to swallow failures, CI steps that run tests, linters, or type checks removed or allowed to fail, and lint rules moved from error to warn or off.',
    why: 'An agent that cannot make a check pass can make the check weaker instead, and the run turns green without the problem being fixed. Changes like these deserve a person\'s review.',
    fix: 'Restore the check and fix what it reports; if the change is intended, ask the user to confirm it.',
    references: ['https://arxiv.org/abs/2510.20270'],
  },
  appliesTo: (file) => !file.generated && !isFixtureData(file.path) && (!file.contexts.has('example') || WORKFLOW.test(file.path)) && ALL.some((re) => re.test(file.path)),
  diff(ctx) {
    if (ctx.before === null || ctx.status === 'added') return;
    if (ctx.after === null && !WORKFLOW.test(ctx.file.path)) return;
    for (const w of weakenings(ctx, ctx.before, ctx.after)) {
      ctx.report({ line: w.line, message: w.message, fix: w.fix, key: w.key, ...(w.level ? { level: w.level } : {}) });
    }
  },
};
