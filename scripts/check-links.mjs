#!/usr/bin/env node
// Checks internal links in every tracked Markdown file: relative file links
// must point to files that exist, and #anchors must match a heading in the
// target file. External links are not fetched (no network in the build).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

const root = join(import.meta.dirname, '..');
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  // plan/readme-draft.md was written with links for the repository root, where README.md now lives.
  .filter((f) => f && !f.startsWith('fixtures/') && !f.startsWith('node_modules/') && f !== 'plan/readme-draft.md');

function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const text = readFileSync(join(root, file), 'utf8').replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, '');
  const counts = new Map();
  const anchors = new Set();
  for (const m of text.matchAll(/^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    const base = slug(m[1]);
    const n = counts.get(base) ?? 0;
    counts.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  for (const m of text.matchAll(/<a\s+(?:name|id)="([^"]+)"/g)) anchors.add(m[1]);
  anchorCache.set(file, anchors);
  return anchors;
}

let broken = 0;
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8').replace(/^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, (m) => m.replace(/[^\n]/g, ' ')).replace(/`[^`\n]+`/g, (m) => ' '.repeat(m.length));
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, https:, mailto:
      const [pathPart, anchor] = target.split('#');
      const resolved = pathPart ? normalize(join(dirname(file), decodeURIComponent(pathPart))) : file;
      const abs = join(root, resolved);
      if (pathPart && !existsSync(abs)) {
        console.log(`${file}:${i + 1}: missing file ${target}`);
        broken++;
        continue;
      }
      if (anchor && existsSync(abs) && statSync(abs).isFile() && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) {
        console.log(`${file}:${i + 1}: missing anchor ${target}`);
        broken++;
      }
    }
  });
}
console.log(`links: ${broken} broken in ${files.length} files`);
process.exit(broken ? 1 : 0);
