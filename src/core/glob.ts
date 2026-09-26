/**
 * Minimal glob matching for config `ignore` patterns and rule file filters.
 * Supports `**`, `*`, `?`, `{a,b}`, and `[abc]`. Paths use forward slashes.
 * A pattern without a slash matches at any depth (like .gitignore).
 */

const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let p = pattern.trim().replace(/\\/g, '/');
  if (p.startsWith('./')) p = p.slice(2);
  const anchored = p.includes('/') && !p.startsWith('**/');
  if (p.endsWith('/')) p += '**';
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const ch = p[i] as string;
    if (ch === '*') {
      if (p[i + 1] === '*') {
        const atSegmentStart = i === 0 || p[i - 1] === '/';
        const atSegmentEnd = i + 2 === p.length || p[i + 2] === '/';
        if (atSegmentStart && atSegmentEnd) {
          if (p[i + 2] === '/') {
            re += '(?:[^/]*/)*';
            i += 2;
          } else {
            re += '.*';
            i += 1;
          }
          continue;
        }
        re += '[^/]*';
        i += 1;
        continue;
      }
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else if (ch === '{') {
      const end = p.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
      } else {
        const options = p.slice(i + 1, end).split(',').map((o) => o.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'));
        re += `(?:${options.join('|')})`;
        i = end;
      }
    } else if (ch === '[') {
      const end = p.indexOf(']', i);
      if (end === -1) re += '\\[';
      else {
        re += p.slice(i, end + 1).replace(/^\[!/, '[^');
        i = end;
      }
    } else if ('.+^$()|\\'.includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  const regex = new RegExp(anchored ? `^${re}$` : `(?:^|/)${re}$`);
  cache.set(pattern, regex);
  return regex;
}

export function matchesAny(path: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    const re = globToRegExp(pattern);
    if (re.test(path)) return true;
    // Like .gitignore, a pattern that names a directory also covers everything below it.
    let prefix = path;
    while (prefix.includes('/')) {
      prefix = prefix.slice(0, prefix.lastIndexOf('/'));
      if (re.test(prefix)) return true;
    }
  }
  return false;
}
