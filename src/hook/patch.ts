/**
 * Codex sends file edits as an apply_patch envelope in tool_input.command:
 *
 *   *** Begin Patch
 *   *** Add File: src/new.ts
 *   +export const a = 1
 *   *** Update File: src/old.ts
 *   *** Move to: src/renamed.ts
 *   @@ function f() {
 *   -  return 1
 *   +  return 2
 *   *** Delete File: src/gone.ts
 *   *** End Patch
 *
 * This extracts the files and the text each one gains, which is what the
 * pre-write checks need. It does not apply the patch.
 */

export interface PatchFile {
  path: string;
  /** Full content for added files. */
  content?: string;
  /** Lines added to an updated file, joined with newlines. */
  added?: string;
  deleted?: boolean;
  movedFrom?: string;
}

export function parseApplyPatch(text: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: (PatchFile & { lines: string[]; mode: 'add' | 'update' | 'delete' }) | null = null;
  const flush = () => {
    if (!current) return;
    const { lines, mode, ...file } = current;
    if (mode === 'add') file.content = lines.join('\n');
    else if (mode === 'update' && lines.length > 0) file.added = lines.join('\n');
    files.push(file);
    current = null;
  };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const header = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (header) {
      flush();
      const kind = header[1];
      const path = (header[2] as string).trim();
      current = { path, lines: [], mode: kind === 'Add' ? 'add' : kind === 'Delete' ? 'delete' : 'update', ...(kind === 'Delete' ? { deleted: true } : {}) };
      continue;
    }
    const move = /^\*\*\* Move to: (.+)$/.exec(line);
    if (move && current) {
      const target = current as PatchFile & { lines: string[]; mode: 'add' | 'update' | 'delete' };
      target.movedFrom = target.path;
      target.path = (move[1] as string).trim();
      continue;
    }
    if (/^\*\*\* (Begin|End) Patch/.test(line) || line === '*** End of File') continue;
    if (!current) continue;
    const c = current as PatchFile & { lines: string[]; mode: 'add' | 'update' | 'delete' };
    if (line.startsWith('+') && !line.startsWith('+++')) c.lines.push(line.slice(1));
  }
  flush();
  return files;
}

/** True when a string looks like an apply_patch envelope. */
export function isApplyPatch(text: string): boolean {
  return /^\s*\*\*\* Begin Patch/m.test(text) || /^\*\*\* (Add|Update|Delete) File: /m.test(text);
}
