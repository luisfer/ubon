import { baseName, dirName, joinPath } from '../integrity/shared.ts';
import type { Rule } from '../types.ts';

/**
 * A new file named like a copy of a file next to it: `Header-new.tsx` next to
 * `Header.tsx`, `utils.ts.bak`, `page copy.tsx`, `api_v2.ts`, `Card2.tsx`.
 * Agents keep the old version "just in case" or write a second version
 * instead of editing the first, and both end up in the repository.
 * Versioned folders (`/v2/`) and migrations are ignored.
 */

const BACKUP_EXT = /^(.+)\.(bak|backup|orig|old|save|tmp)$|^(.+)~$/i;
const COPY_SUFFIX = [
  /^(.+?)[-_. ](?:old|new|copy|backup|bak|orig|final|tmp|temp|updated|fixed|working|original)$/i,
  /^(.+?)[-_. ]v\d+$/i,
  /^(.+?)[-_ ]copy[-_ ]?\d+$/i,
  /^(.+?) copy(?: \d+)?$/i,
  /^(.+?) \(\d+\)$/,
  /^(.+?[a-z])V\d+$/,
];
/** `Card2.tsx` next to `Card.tsx`, but not `http2`, `oauth2`, `vec2`, `step2` and other names where the digit is meaningful. */
const TWO = /^(.+?[A-Za-z])2$/;
const MEANINGFUL_TWO = /^(?:.*[-_.])?(http|oauth|h|ec|s|sha|md|utf|vec|mat|float|int|uint|ipv|web|es|py|python|phase|step|level|tier|layer|round|part|chapter|version|v|base|bcrypt|argon|scrypt|pbkdf|ed|curve|x|y|z|p|n|l|t|col|row|stage|slot|arg|param|option|player|team|screen|region|zone|node|item|section|image|img|icon|logo|hero|banner|feature|plan|quarter|q|week|day|month|year|gen|mk|win|oracle|bytes)$/i;
const VERSIONED_DIR = /(^|\/)v\d+(\/|$)/;
const MIGRATION = /(^|\/)(migrations?|migrate|db\/migrate|alembic|versions)\//i;

/** The file a new file looks like a copy of, if it exists next to it. */
export function copyOf(path: string, exists: (p: string) => boolean): string | null {
  const dir = dirName(path);
  const name = baseName(path);
  const backup = BACKUP_EXT.exec(name);
  if (backup) {
    const original = joinPath(dir, (backup[1] ?? backup[3]) as string);
    return exists(original) ? original : null;
  }
  // Try the last extension and a double extension (Header-new.test.tsx -> Header.test.tsx).
  const parts = name.split('.');
  if (parts.length < 2) return null;
  for (const extCount of [1, 2]) {
    if (parts.length <= extCount) continue;
    const head = parts.slice(0, parts.length - extCount).join('.');
    const ext = parts.slice(parts.length - extCount).join('.');
    for (const re of COPY_SUFFIX) {
      const m = re.exec(head);
      if (!m) continue;
      const original = joinPath(dir, `${m[1]}.${ext}`);
      if (original !== path && exists(original)) return original;
    }
    const two = TWO.exec(head);
    if (two && !MEANINGFUL_TWO.test(two[1] as string)) {
      const original = joinPath(dir, `${two[1]}.${ext}`);
      if (exists(original)) return original;
    }
  }
  return null;
}

export const variantFile: Rule = {
  meta: {
    id: 'hygiene/variant-file',
    level: 'warn',
    scope: 'diff',
    title: 'New file named like a copy',
    summary: 'A file added in the change with a copy-like name (`-old`, `-new`, `_v2`, ` copy`, `.bak`, `.orig`, `-final`, a trailing `2`) next to an existing file with the base name.',
    why: 'Agents often write a second version of a file instead of editing the first, or keep the old one as a backup. The copy drifts, gets imported by mistake, or ships dead code.',
    fix: 'Merge the changes into the original file and delete the copy, or give the new file a name that says what it does.',
  },
  appliesTo: (file) => !file.generated && !VERSIONED_DIR.test(file.path) && !MIGRATION.test(file.path) && !file.contexts.has('migration'),
  diff(ctx) {
    if (ctx.status !== 'added' && ctx.status !== 'renamed') return;
    const original = copyOf(ctx.file.path, (p) => ctx.project.has(p));
    if (!original) return;
    if (ctx.status === 'renamed' && ctx.oldPath === original) return;
    ctx.report({
      line: 1,
      message: `${ctx.file.path} looks like a copy of ${original}.`,
      fix: `Merge the changes into ${original} and delete ${baseName(ctx.file.path)}, or rename the new file to say what it does.`,
      evidence: ctx.file.path,
    });
  },
};
