import { commandName, parseShell } from '../../lang/shell.ts';
import type { Rule } from '../types.ts';
import { MCP_KINDS, type McpServer, configKind, mcpServers, parseConfig } from './config-files.ts';
import { hostOf, isLocalHost } from './shell-analysis.ts';

/**
 * MCP servers that update themselves: `npx -y pkg` without an exact version or
 * with `@latest`, `uvx pkg` without a version, container images without a tag
 * or with `:latest`, and remote servers over plain http.
 */

const EXACT_NPM = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;

function npmVersion(spec: string): string | null {
  const at = spec.indexOf('@', spec.startsWith('@') ? 1 : 0);
  return at > 0 ? spec.slice(at + 1) : null;
}

function describeVersion(version: string | null): string {
  if (version === null) return 'without a version';
  if (/^(latest|next|beta|alpha|canary|rc|nightly|dev|experimental)$/i.test(version)) return `with the moving tag @${version}`;
  return `with the version range @${version}`;
}

interface Problem {
  message: string;
  fix: string;
  line: number;
  key: string;
}

/** npx, npm exec, and bunx run a package the project installs (pinned by its lockfile) before fetching one. */
const LOCAL_FIRST = new Set(['npx', 'npm exec', 'bunx']);

function checkServer(s: McpServer, localDeps: ReadonlySet<string>): Problem | null {
  if (s.url) {
    const host = hostOf(s.url);
    if (/^http:\/\//i.test(s.url) && host && !isLocalHost(host)) {
      return {
        message: `MCP server "${s.name}" connects to ${host} over plain http, so its tools and any tokens travel unencrypted.`,
        fix: 'Use the https URL of the server.',
        line: s.urlLine,
        key: `http:${s.name}`,
      };
    }
    return null;
  }
  if (!s.command) return null;
  // "command": "npx -y pkg" with no args array: split the command line.
  let argv = [s.command, ...s.args];
  if (s.args.length === 0 && /\s/.test(s.command.trim())) {
    // The words as written (the parser's package-runner handling would drop the version).
    const parsed = parseShell(s.command).commands[0];
    argv = parsed ? [...parsed.wrappers.flatMap((w) => w.argv), ...parsed.words.map((w, i) => (i === 0 ? w.raw.replace(/^['"]|['"]$/g, '') : w.value))] : s.command.trim().split(/\s+/);
  }
  const name = commandName(argv[0] ?? '').toLowerCase();
  const args = argv.slice(1);
  const unpinned = (spec: string, runner: string, version: string | null, fix: string): Problem => ({
    message: `MCP server "${s.name}" runs ${spec} through ${runner} ${describeVersion(version)}, so a new release runs on the next start, with access to your tokens.`,
    fix,
    line: s.commandLine,
    key: `pkg:${s.name}`,
  });
  // npx, pnpm dlx, bunx, yarn dlx, npm exec
  const runner =
    name === 'npx' || name === 'pnpx' || name === 'bunx'
      ? { name, start: 0 }
      : (name === 'pnpm' || name === 'yarn') && args[0] === 'dlx'
        ? { name: `${name} dlx`, start: 1 }
        : name === 'npm' && (args[0] === 'exec' || args[0] === 'x')
          ? { name: 'npm exec', start: 1 }
          : name === 'bun' && args[0] === 'x'
            ? { name: 'bunx', start: 1 }
            : null;
  if (runner) {
    const rest = args.slice(runner.start);
    if (rest.some((a) => a === '--no-install' || a === '--offline' || a === '--prefer-offline')) return null;
    const specs: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i] as string;
      if (a === '-p' || a === '--package') {
        specs.push(rest[i + 1] ?? '');
        i++;
        continue;
      }
      if (a.startsWith('--package=')) {
        specs.push(a.slice('--package='.length));
        continue;
      }
      if (a === '--') continue;
      if (a.startsWith('-')) continue;
      if (specs.length === 0) specs.push(a);
      break;
    }
    for (const spec of specs) {
      if (!spec || /^(\.{0,2}\/|file:|git\+|github:|https?:)/.test(spec) || /\.(tgz|js|mjs|cjs)$/.test(spec)) continue;
      const version = npmVersion(spec);
      if (version !== null && EXACT_NPM.test(version)) continue;
      const bare = version === null ? spec : spec.slice(0, spec.length - version.length - 1);
      if (version === null && LOCAL_FIRST.has(runner.name) && localDeps.has(bare)) continue;
      return unpinned(bare, runner.name, version, `Pin an exact version, for example ${bare}@1.2.3, and update it on purpose.`);
    }
    return null;
  }
  // uvx pkg, uv tool run pkg, pipx run pkg
  const py = name === 'uvx' ? { start: 0, runner: 'uvx' } : name === 'uv' && args[0] === 'tool' && args[1] === 'run' ? { start: 2, runner: 'uv tool run' } : name === 'pipx' && args[0] === 'run' ? { start: 1, runner: 'pipx run' } : null;
  if (py) {
    const rest = args.slice(py.start);
    let spec: string | null = null;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i] as string;
      if (a === '--from' || a === '--spec') {
        spec = rest[i + 1] ?? null;
        break;
      }
      if (a.startsWith('--from=') || a.startsWith('--spec=')) {
        spec = a.slice(a.indexOf('=') + 1);
        break;
      }
      if (['--with', '--python', '-p', '--index', '--index-url', '--extra-index-url'].includes(a)) {
        i++;
        continue;
      }
      if (a.startsWith('-')) continue;
      spec = a;
      break;
    }
    if (!spec || /^(\.{0,2}\/|file:)/.test(spec)) return null;
    if (/==\d|@\d|@v?[0-9a-f]{7,}$/.test(spec) || /^git\+.+@[\w.-]+$/.test(spec)) return null;
    const bare = spec.replace(/[<>=~!].*$/, '').replace(/@.*$/, '');
    const version = /@latest$/.test(spec) ? 'latest' : null;
    return unpinned(bare, py.runner, version, `Pin an exact version, for example ${bare}==1.2.3.`);
  }
  // docker run image
  if ((name === 'docker' || name === 'podman') && args[0] === 'run') {
    const withValue = new Set(['-e', '--env', '-v', '--volume', '-p', '--publish', '--name', '--network', '--net', '-w', '--workdir', '-u', '--user', '--entrypoint', '--env-file', '--mount', '--platform', '-l', '--label', '-m', '--memory', '--cpus', '--add-host', '--device', '--cap-add', '--cap-drop', '--security-opt', '--restart', '--pull', '--log-driver', '--log-opt', '--tmpfs', '--ulimit', '-h', '--hostname', '--dns', '--gpus', '--ipc', '--pid', '--shm-size', '--runtime', '--stop-signal', '--stop-timeout', '--health-cmd', '--label-file', '--cidfile']);
    let image: string | null = null;
    for (let i = 1; i < args.length; i++) {
      const a = args[i] as string;
      if (withValue.has(a)) {
        i++;
        continue;
      }
      if (a.startsWith('-')) continue;
      image = a;
      break;
    }
    if (!image || /\$\{?\w/.test(image) || /@sha256:[0-9a-f]{64}$/.test(image)) return null;
    const lastPart = image.slice(image.lastIndexOf('/') + 1);
    const tag = lastPart.includes(':') ? lastPart.slice(lastPart.indexOf(':') + 1) : null;
    if (tag !== null && tag !== 'latest' && !/^(main|master|edge|nightly|dev)$/.test(tag)) return null;
    const bare = tag === null ? image : image.slice(0, image.length - tag.length - 1);
    return {
      message: `MCP server "${s.name}" runs the container image ${bare}${tag ? ` with the moving tag :${tag}` : ' without a tag'}, so it runs whatever image is pushed next, with access to your tokens.`,
      fix: `Pin a version tag or a digest, for example ${bare}:1.2.3 or ${bare}@sha256:<digest>.`,
      line: s.commandLine,
      key: `image:${s.name}`,
    };
  }
  return null;
}

export const unpinnedMcpServer: Rule = {
  meta: {
    id: 'agent/unpinned-mcp-server',
    level: 'warn',
    scope: 'file',
    title: 'MCP server without a pinned version',
    summary: 'MCP servers started with `npx -y <pkg>` or `@latest` without an exact version, `uvx <pkg>` without a version, container images without a tag, or remote MCP URLs over plain http on non-local hosts.',
    why: 'An unpinned server is code that updates itself on the next start, with access to the tokens and files the agent can reach. A compromised release reaches every developer at once, without a change in the repository.',
    fix: 'Pin an exact version (pkg@1.2.3, pkg==1.2.3, image:1.2.3 or a digest) and update it deliberately.',
    cwe: ['CWE-494', 'CWE-1357'],
    owasp: ['A03:2025', 'ASI04'],
  },
  appliesTo: (file) => !file.generated && MCP_KINDS.has(configKind(file.path) as never) && !file.contexts.has('test'),
  text(ctx) {
    const doc = parseConfig(ctx.file.path, ctx.text);
    if (!doc?.data) return;
    for (const s of mcpServers(doc)) {
      const problem = checkServer(s, ctx.project.depsFor(ctx.file.path));
      if (problem) ctx.report({ line: problem.line, message: problem.message, fix: problem.fix, key: problem.key });
    }
  },
};
