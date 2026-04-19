/**
 * Shell completion scripts for `ubon`.
 *
 * Implementation note: keep these as static template strings rather than
 * dynamically introspecting Commander. Static scripts (a) work without
 * loading the JS runtime on every <Tab>, and (b) survive when commander
 * options are renamed across releases (a slightly stale completion is
 * better than a broken one).
 */

const SHARED_OPTS = [
  '--directory', '--verbose', '--fail-on', '--min-confidence', '--enable-rule',
  '--disable-rule', '--baseline', '--update-baseline', '--no-baseline',
  '--json', '--ndjson', '--sarif', '--output', '--changed-files', '--git-changed-since',
  '--fix-dry-run', '--preview-fixes', '--apply-fixes', '--profile', '--git-history-depth',
  '--fast', '--crawl-internal', '--crawl-start-url', '--crawl-depth', '--crawl-timeout',
  '--detailed', '--focus-critical', '--focus-security', '--focus-new', '--color',
  '--group-by', '--format', '--min-severity', '--max-issues', '--show-context',
  '--explain', '--show-confidence', '--show-suppressed', '--ignore-suppressed',
  '--clear-cache', '--no-cache', '--no-result-cache', '--pr-comment',
  '--interactive', '--quiet', '--allow-config-js', '--schema',
];

const TOP_COMMANDS = ['scan', 'check', 'explain', 'init', 'install-hooks', 'cache', 'lsp', 'completion', 'doctor', 'mcp', 'hooks'];

const PROFILES = ['auto', 'lovable', 'react', 'next', 'sveltekit', 'astro', 'remix', 'hono'];

export function bashCompletion(): string {
  return `# bash completion for ubon
_ubon_complete() {
  local cur prev words cword
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local cmd="\${COMP_WORDS[1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${TOP_COMMANDS.join(' ')}" -- "\$cur") )
    return 0
  fi

  case "\$prev" in
    --profile) COMPREPLY=( $(compgen -W "${PROFILES.join(' ')}" -- "\$cur") ); return 0 ;;
    --color) COMPREPLY=( $(compgen -W "auto always never" -- "\$cur") ); return 0 ;;
    --group-by) COMPREPLY=( $(compgen -W "category file rule severity" -- "\$cur") ); return 0 ;;
    --format) COMPREPLY=( $(compgen -W "human table" -- "\$cur") ); return 0 ;;
    --min-severity) COMPREPLY=( $(compgen -W "low medium high" -- "\$cur") ); return 0 ;;
    --fail-on) COMPREPLY=( $(compgen -W "none warning error" -- "\$cur") ); return 0 ;;
    --directory|--baseline|--output|--sarif) COMPREPLY=( $(compgen -d -- "\$cur") ); return 0 ;;
  esac

  if [[ "\$cur" == --* ]]; then
    COMPREPLY=( $(compgen -W "${SHARED_OPTS.join(' ')}" -- "\$cur") )
    return 0
  fi
}
complete -F _ubon_complete ubon
`;
}

export function zshCompletion(): string {
  return `#compdef ubon
# zsh completion for ubon
_ubon() {
  local -a commands
  commands=(
    'scan:Run a full scan'
    'check:Quick health check (static analysis only)'
    'explain:Show details for a rule'
    'init:Generate ubon.config.json'
    'install-hooks:Install git pre-commit hooks'
    'cache:Manage Ubon cache'
    'lsp:Start the Ubon language server'
    'completion:Print shell completion script'
    'doctor:Check Ubon environment health'
    'mcp:Run Ubon as an MCP server'
    'hooks:Manage Cursor / git hooks'
  )

  if (( CURRENT == 2 )); then
    _describe -t commands 'ubon command' commands
    return
  fi

  _arguments \
    '--profile=[Scan profile]:profile:(${PROFILES.join(' ')})' \
    '--color=[Color mode]:mode:(auto always never)' \
    '--group-by=[Group results]:by:(category file rule severity)' \
    '--format=[Output format]:fmt:(human table)' \
    '--min-severity=[Minimum severity]:level:(low medium high)' \
    '--fail-on=[Fail on level]:level:(none warning error)' \
    '--directory=[Directory]:_directories' \
    '--json[Output as JSON]' '--ndjson[Stream NDJSON]' '--sarif=[SARIF path]' \
    '--quiet[Suppress banners]' '--schema[Print JSON schema]' \
    '--allow-config-js[Allow ubon.config.js]' \
    '--fast[Fast mode]' '--interactive[Interactive triage]'
}
_ubon "$@"
`;
}

export function fishCompletion(): string {
  return `# fish completion for ubon
complete -c ubon -f
${TOP_COMMANDS.map((c) => `complete -c ubon -n '__fish_use_subcommand' -a '${c}'`).join('\n')}
complete -c ubon -l profile -xa '${PROFILES.join(' ')}'
complete -c ubon -l color -xa 'auto always never'
complete -c ubon -l group-by -xa 'category file rule severity'
complete -c ubon -l format -xa 'human table'
complete -c ubon -l min-severity -xa 'low medium high'
complete -c ubon -l fail-on -xa 'none warning error'
complete -c ubon -l json
complete -c ubon -l ndjson
complete -c ubon -l quiet
complete -c ubon -l schema
complete -c ubon -l allow-config-js
complete -c ubon -l fast
complete -c ubon -l interactive
`;
}

export function emit(shell: string): { ok: boolean; output: string } {
  switch (shell) {
    case 'bash': return { ok: true, output: bashCompletion() };
    case 'zsh': return { ok: true, output: zshCompletion() };
    case 'fish': return { ok: true, output: fishCompletion() };
    default:
      return {
        ok: false,
        output: `Unknown shell: ${shell}. Supported: bash, zsh, fish.\n`,
      };
  }
}
