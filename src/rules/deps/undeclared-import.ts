import { isBuiltin } from 'node:module';
import { posix } from 'node:path';
import type { Node } from '@babel/types';
import { SCRIPT_LANGS } from '../../core/files.ts';
import { globToRegExp } from '../../core/glob.ts';
import type { PackageInfo, Project } from '../../core/project.ts';
import { isRecord } from './text.ts';
import { stringValue } from '../../lang/js.ts';
import { isFunctionNode } from '../../lang/walk.ts';
import type { JsContext, Rule } from '../types.ts';
import { isValidPackageName, packageNameOfImport } from './spec.ts';

/**
 * A bare import of a package that the nearest package.json, the root
 * package.json, and the workspace packages do not declare.
 *
 * Not reported: Node built-ins, workspace packages, tsconfig and bundler
 * aliases, directories used as import roots, subpath imports (#x), framework
 * virtual modules ($app/, astro:, virtual:, ~icons/), modules declared with
 * `declare module`, runtime-provided modules (vscode, bun, k6, Next's
 * server-only), type-only imports covered by @types/*, and optional imports
 * inside try blocks or with .catch().
 */

interface ProjectFacts {
  aliases: string[];
  ambientExact: Set<string>;
  ambientPatterns: RegExp[];
  /** Directories with a Deno import map (deno.json, deno.jsonc, import_map.json) to the names it maps. */
  denoMaps: Map<string, string[]>;
  /** Package directory to the directory names that code can import by bare name. */
  localRoots: Map<string, Set<string>>;
  /** Dependencies of workspace members, when the package manager hoists them where every member resolves them. */
  hoisted: Set<string>;
}

const memo = new WeakMap<Project, ProjectFacts>();

/**
 * npm, Yarn with node_modules, and Bun hoist workspace dependencies to the
 * root node_modules, so a member can import what another member declares.
 * pnpm and Yarn Plug'n'Play do not, so there such an import fails.
 */
function hoistedWorkspaceDeps(project: Project): Set<string> {
  const out = new Set<string>();
  const root = project.rootPackage();
  if (!root) return out;
  const yarnrc = project.read('.yarnrc.yml');
  const strict =
    project.has('pnpm-lock.yaml') ||
    project.has('pnpm-workspace.yaml') ||
    (typeof root.raw.packageManager === 'string' && root.raw.packageManager.startsWith('pnpm@')) ||
    project.has('.pnp.cjs') ||
    (yarnrc !== null && !/^\s*nodeLinker:\s*["']?node-modules/m.test(yarnrc));
  if (strict || root.workspaces.length === 0) return out;
  const include = root.workspaces.filter((w) => !w.startsWith('!')).map((w) => globToRegExp(w.replace(/\/+$/, '')));
  const exclude = root.workspaces.filter((w) => w.startsWith('!')).map((w) => globToRegExp(w.slice(1).replace(/\/+$/, '')));
  for (const pkg of project.packages.values()) {
    if (!pkg.dir || !include.some((re) => re.test(pkg.dir)) || exclude.some((re) => re.test(pkg.dir))) continue;
    for (const dep of pkg.allDeps) out.add(dep);
  }
  return out;
}

const CONFIG_WITH_ALIASES =
  /(^|\/)((vite|vitest|webpack|rspack|rsbuild|rollup|next|nuxt|astro|svelte|quasar|craco|metro|babel|jest|electron\.vite|electron-vite|tsup|remix|react-router|storybook\/main)\.config\.[cm]?[jt]s|\.babelrc(\.json)?|babel\.config\.json|\.storybook\/main\.[cm]?[jt]s)$/;

/** The text of the balanced {...} or [...] block that starts at `open`. */
function balanced(text: string, open: number, max: number): string {
  const close = text[open] === '{' ? '}' : ']';
  const start = text[open] as string;
  let depth = 0;
  for (let i = open; i < Math.min(text.length, open + max); i++) {
    const ch = text[i];
    if (ch === start) depth++;
    else if (ch === close && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open, open + max);
}

/** Alias keys from bundler, Babel, and Jest config: alias, moduleNameMapper, resolveAlias. */
export function aliasKeys(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(alias|moduleNameMapper|resolveAlias|moduleNameMapping)\s*:\s*([[{])/g)) {
    const block = balanced(text, (m.index ?? 0) + m[0].length - 1, 20_000);
    for (const k of block.matchAll(/(['"`])([^'"`\n]{1,120})\1\s*:/g)) out.push(k[2] as string);
    for (const k of block.matchAll(/(?:^|[{,\s])([A-Za-z_$~@#][\w$~@#.-]*)\s*:(?!\/)/g)) out.push(k[1] as string);
    for (const k of block.matchAll(/\bfind\s*:\s*(['"`])([^'"`\n]{1,120})\1/g)) out.push(k[2] as string);
  }
  // Regex keys (Jest): ^components/(.*)$ is the prefix components/.
  return out
    .map((k) => k.replace(/^\^/, '').replace(/\$$/, ''))
    .map((k) => {
      const cut = k.search(/[()[\]*+?\\|$]/);
      return cut === -1 ? k : k.slice(0, cut);
    })
    .filter((k) => k.length > 0 && !/^(find|replacement|customResolver|__dirname)$/.test(k));
}

function projectFacts(project: Project): ProjectFacts {
  const cached = memo.get(project);
  if (cached) return cached;
  const aliases = new Set<string>();
  const ambientExact = new Set<string>();
  const ambientPatterns: RegExp[] = [];
  const denoMaps = new Map<string, string[]>();
  let dts = 0;
  for (const file of project.files) {
    if (file.includes('node_modules/')) continue;
    if (CONFIG_WITH_ALIASES.test(file)) {
      for (const key of aliasKeys(project.read(file) ?? '')) aliases.add(key);
    } else if (/\.d\.[cm]?ts$/.test(file) && dts++ < 2000) {
      const text = project.read(file) ?? '';
      for (const m of text.matchAll(/\bdeclare\s+module\s+(['"])([^'"\n]+)\1/g)) {
        const name = m[2] as string;
        if (!name.includes('*')) ambientExact.add(name);
        else ambientPatterns.push(new RegExp(`^${name.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`));
      }
    } else if (/(^|\/)(deno\.jsonc?|import_map\.json)$/.test(file)) {
      const dir = posix.dirname(file) === '.' ? '' : posix.dirname(file);
      const keys = denoMaps.get(dir) ?? [];
      try {
        const data = JSON.parse((project.read(file) ?? '{}').replace(/^\s*\/\/.*$/gm, '')) as unknown;
        if (isRecord(data) && isRecord(data.imports)) keys.push(...Object.keys(data.imports));
      } catch {
        // unreadable import map: the directory still counts as Deno code
      }
      denoMaps.set(dir, keys);
    }
  }
  const pkg = project.rootPackage()?.raw;
  // package.json "alias" (Parcel) and "_moduleAliases" (module-alias).
  for (const field of ['alias', '_moduleAliases']) {
    const value = pkg?.[field];
    if (isRecord(value)) for (const key of Object.keys(value)) aliases.add(key);
  }
  const hoisted = hoistedWorkspaceDeps(project);
  // A local package without a name field is known by its folder name.
  for (const p of project.packages.values()) if (!p.name && p.dir) hoisted.add(posix.basename(p.dir));
  const facts: ProjectFacts = { aliases: [...aliases], ambientExact, ambientPatterns, denoMaps, localRoots: new Map(), hoisted };
  memo.set(project, facts);
  return facts;
}

/** Every package.json from the file's directory up to the root, nearest first. */
function ancestorManifests(project: Project, path: string): PackageInfo[] {
  const out: PackageInfo[] = [];
  let dir = posix.dirname(path);
  while (true) {
    const key = dir === '.' ? '' : dir;
    const found = project.packages.get(key);
    if (found) out.push(found);
    if (key === '') return out;
    dir = posix.dirname(dir);
  }
}

/** Directory names at a package root and under its src/ that a bare import could name. */
function localRoots(project: Project, facts: ProjectFacts, pkgDir: string): Set<string> {
  const cached = facts.localRoots.get(pkgDir);
  if (cached) return cached;
  const out = new Set<string>();
  const prefixes = [pkgDir ? `${pkgDir}/` : '', pkgDir ? `${pkgDir}/src/` : 'src/'];
  for (const file of project.files) {
    for (const prefix of prefixes) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash > 0) out.add(rest.slice(0, slash));
    }
  }
  facts.localRoots.set(pkgDir, out);
  return out;
}

function denoMapFor(facts: ProjectFacts, path: string): string[] | null {
  let dir = posix.dirname(path);
  while (true) {
    const key = dir === '.' ? '' : dir;
    const map = facts.denoMaps.get(key);
    if (map) return map;
    if (key === '') break;
    dir = posix.dirname(dir);
  }
  return /(^|\/)supabase\/functions\//.test(path) ? [] : null;
}

/**
 * The examples, templates, or docs folder a file is in, when that folder has
 * no package.json of its own: its code belongs to projects generated or
 * copied from it (create-* templates, doc snippets), not to this package.
 */
function foreignFolder(path: string, pkgDir: string): boolean {
  const m = /(^|\/)(examples?|samples?|demos?|templates?|docs|documentation)(\/|$)/.exec(path);
  if (!m) return false;
  const root = path.slice(0, m.index + m[0].length).replace(/\/$/, '');
  return !(pkgDir === root || pkgDir.startsWith(`${root}/`));
}

function typesPackage(name: string): string {
  return name.startsWith('@') ? `@types/${name.slice(1).replace('/', '__')}` : `@types/${name}`;
}

/** Modules a runtime or framework provides without a package.json entry. */
function providedByRuntime(pkg: string, declared: ReadonlySet<string>, project: Project): boolean {
  if (pkg === 'bun') return declared.has('@types/bun') || declared.has('bun-types') || project.has('bun.lock') || project.has('bun.lockb');
  if (pkg === 'vscode') {
    const engines = project.rootPackage()?.raw.engines;
    return declared.has('@types/vscode') || (isRecord(engines) && 'vscode' in engines);
  }
  if (pkg === 'k6') return declared.has('@types/k6');
  if (pkg === 'server-only' || pkg === 'client-only') return declared.has('next');
  if (/^@(theme|theme-original|theme-init|site|generated)$/.test(pkg.split('/')[0] ?? '')) return declared.has('@docusaurus/core');
  return false;
}

/** An import inside a try block (in the same function) or followed by .catch(): the code expects it to fail. */
function isOptional(parents: readonly Node[], node: Node): boolean {
  let child: Node = node;
  for (let i = parents.length - 1; i >= 0; i--) {
    const p = parents[i] as Node;
    if (p.type === 'TryStatement' && p.block === child) return true;
    if ((p.type === 'MemberExpression' || p.type === 'OptionalMemberExpression') && p.object === child && p.property.type === 'Identifier' && p.property.name === 'catch') return true;
    if (isFunctionNode(p)) return false;
    child = p;
  }
  return false;
}

/** `import { type A, type B } from 'x'`: every specifier is type-only (default and namespace specifiers cannot be). */
function allTypeSpecifiers(specifiers: ReadonlyArray<{ type: string; importKind?: string | null; exportKind?: string | null }>, key: 'importKind' | 'exportKind'): boolean {
  return specifiers.length > 0 && specifiers.every((s) => (s.type === 'ImportSpecifier' || s.type === 'ExportSpecifier') && s[key] === 'type');
}

export const undeclaredImport: Rule = {
  meta: {
    id: 'deps/undeclared-import',
    level: 'warn',
    scope: 'project',
    title: 'Import of a package that package.json does not declare',
    summary:
      'A bare import (import, export from, require, or dynamic import) of a package that the nearest package.json, the root package.json, and the workspace packages do not declare.',
    why: 'An undeclared package works only by accident, because another dependency installed it, or not at all. Agents often import packages they never added, and installing such a name later without checking it is how invented package names get installed.',
    fix: 'Add the package with your package manager after checking it with `ubon vet <name>`, or import something the project already depends on.',
    cwe: ['CWE-1357'],
    owasp: ['A03:2025'],
    levels:
      'block in diff mode when node_modules exists and the package is not in it, because the import cannot resolve; warn when the package is installed through another dependency, when there is no node_modules, for type-only imports, and in examples, docs, and Deno code. Example, template, and docs folders without their own package.json are skipped, and so are dependencies of other workspace members when npm, Yarn (node_modules), or Bun hoists them.',
  },
  appliesTo: (file) => SCRIPT_LANGS.has(file.lang) && !file.generated,
  js(ctx: JsContext) {
    const project = ctx.project;
    // Node resolves from the node_modules of every ancestor, so every package.json above the file counts.
    const ancestors = ancestorManifests(project, ctx.file.path);
    // The package the file belongs to, skipping stubs such as {"type": "module"}.
    const pkgInfo = ancestors.find((p) => p.name !== undefined || p.allDeps.size > 0) ?? ancestors[0];
    if (!pkgInfo) return {}; // no package.json governs this file
    if (foreignFolder(ctx.file.path, pkgInfo.dir)) return {};
    // Generator headers the shared check does not know: "This file has been generated by Sanity TypeGen".
    if (/\b(?:has been|was) (?:auto-?)?generated\b|\bgenerated by\b|\bcode ?gen(?:erated)?\b/i.test(ctx.text.slice(0, 600))) return {};
    const declared = project.depsFor(ctx.file.path);
    for (const p of ancestors) p.allDeps.forEach((d) => declared.add(d));
    const facts = projectFacts(project);
    const deno = denoMapFor(facts, ctx.file.path);
    const manifest = pkgInfo.dir ? `${pkgInfo.dir}/package.json` : 'package.json';
    const diffMode = ctx.mode === 'diff' || ctx.mode === 'staged' || ctx.mode === 'session';
    const cappedAtWarn = deno !== null || ctx.file.contexts.has('example') || ctx.file.contexts.has('docs');
    const seen = new Set<string>();

    const check = (node: Node, source: Node | null | undefined, typeOnly: boolean) => {
      const spec = stringValue(source);
      if (!spec || spec.startsWith('.') || spec.startsWith('/') || spec.includes(':')) return;
      if (/^[#$~]/.test(spec) || spec.startsWith('@/') || spec.includes('!')) return;
      const pkg = packageNameOfImport(spec);
      // One finding per package and file; a value import is still reported after a type-only one.
      const seenKey = typeOnly ? `type:${pkg}` : `value:${pkg}`;
      if (!pkg || !isValidPackageName(pkg) || seen.has(seenKey) || seen.has(`value:${pkg}`)) return;
      if (isBuiltin(spec) || isBuiltin(pkg)) return;
      if (declared.has(pkg) || facts.hoisted.has(pkg)) return;
      if (typeOnly && declared.has(typesPackage(pkg))) return;
      if (providedByRuntime(pkg, declared, project)) return;
      if (project.isAliased(ctx.file.path, spec) || project.resolveImport(ctx.file.path, spec) !== null) return;
      if (facts.aliases.some((a) => spec === a || spec.startsWith(a.endsWith('/') ? a : `${a}/`))) return;
      if (facts.ambientExact.has(spec) || facts.ambientExact.has(pkg) || facts.ambientPatterns.some((re) => re.test(spec))) return;
      if (deno?.some((key) => spec === key || (key.endsWith('/') && spec.startsWith(key)))) return;
      const first = spec.split('/')[0] as string;
      if (!first.startsWith('@') && localRoots(project, facts, pkgInfo.dir).has(first)) return;
      if (isOptional(ctx.parents, node)) return;
      seen.add(seenKey);

      if (typeOnly) {
        ctx.report(node, {
          message: `Types are imported from ${pkg}, but neither ${pkg} nor ${typesPackage(pkg)} is declared in ${manifest}.`,
          fix: `Add ${pkg} to ${manifest} (or its @types package, if it has one), or remove the import.`,
          key: pkg,
        });
        return;
      }
      const installed = project.nodeModulesHas(ctx.file.path, pkg);
      if (diffMode && !cappedAtWarn && installed === false) {
        ctx.report(node, {
          level: 'block',
          message: `${pkg} is imported but not declared in ${manifest}, and it is not installed in node_modules.`,
          fix: `Remove the import, or check the package with \`ubon vet ${pkg}\` and add it with your package manager.`,
          key: pkg,
        });
        return;
      }
      ctx.report(node, {
        message:
          installed === true
            ? `${pkg} is imported but not declared in ${manifest}; it resolves only because another package installed it.`
            : `${pkg} is imported but not declared in ${manifest}.`,
        fix: `Add ${pkg} to ${manifest} with your package manager, after checking it with \`ubon vet ${pkg}\`.`,
        key: pkg,
      });
    };

    return {
      ImportDeclaration(node) {
        check(node, node.source, node.importKind === 'type' || allTypeSpecifiers(node.specifiers, 'importKind'));
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source, node.exportKind === 'type' || allTypeSpecifiers(node.specifiers, 'exportKind'));
      },
      ExportAllDeclaration(node) {
        check(node, node.source, node.exportKind === 'type');
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference?.type === 'TSExternalModuleReference') check(node, node.moduleReference.expression, node.importKind === 'type');
      },
      ImportExpression(node) {
        check(node, node.source, false);
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee?.type === 'Import') check(node, node.arguments?.[0], false);
        else if (callee?.type === 'Identifier' && callee.name === 'require' && node.arguments?.length === 1) check(node, node.arguments[0], false);
      },
    };
  },
};
