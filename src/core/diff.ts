import type { LineChange } from '../rules/types.ts';

/**
 * Line diff for diff rules. Myers' algorithm on trimmed-end lines, with a cap
 * on the edit distance; past the cap it falls back to a multiset comparison,
 * which is less exact about positions but never slow.
 */

export interface LineDiff {
  added: LineChange[];
  removed: LineChange[];
}

export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string;
    if (l.endsWith('\r')) lines[i] = l.slice(0, -1);
  }
  return lines;
}

const MAX_EDITS = 1000;

export function diffLines(before: string | null, after: string | null): LineDiff {
  const a = before === null ? [] : splitLines(before);
  const b = after === null ? [] : splitLines(after);
  if (before === null) return { added: b.map((text, i) => ({ line: i + 1, text })), removed: [] };
  if (after === null) return { added: [], removed: a.map((text, i) => ({ line: i + 1, text })) };

  // Trim the common prefix and suffix first: most edits are local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const script = myers(midA, midB);
  if (script) {
    return {
      added: script.added.map((i) => ({ line: start + i + 1, text: midB[i] as string })),
      removed: script.removed.map((i) => ({ line: start + i + 1, text: midA[i] as string })),
    };
  }
  return multisetDiff(midA, midB, start);
}

function myers(a: string[], b: string[]): { added: number[]; removed: number[] } | null {
  const n = a.length;
  const m = b.length;
  if (n === 0) return { added: b.map((_, i) => i), removed: [] };
  if (m === 0) return { added: [], removed: a.map((_, i) => i) };
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) x = v[offset + k + 1] as number;
      else x = (v[offset + k - 1] as number) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, v, a.length, b.length, offset, d);
    }
  }
  return null;
}

function backtrack(trace: Int32Array[], last: Int32Array, n: number, m: number, offset: number, dEnd: number): { added: number[]; removed: number[] } {
  const added: number[] = [];
  const removed: number[] = [];
  let x = n;
  let y = m;
  let v = last;
  for (let d = dEnd; d > 0; d--) {
    const prev = trace[d] as Int32Array;
    v = prev;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (v[offset + k - 1] as number) < (v[offset + k + 1] as number))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v[offset + prevK] as number;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (x === prevX) added.push(prevY);
    else removed.push(prevX);
    x = prevX;
    y = prevY;
  }
  return { added: added.reverse(), removed: removed.reverse() };
}

function multisetDiff(a: string[], b: string[], start: number): LineDiff {
  const counts = new Map<string, number>();
  for (const l of a) counts.set(l, (counts.get(l) ?? 0) + 1);
  const added: LineChange[] = [];
  b.forEach((l, i) => {
    const c = counts.get(l) ?? 0;
    if (c > 0) counts.set(l, c - 1);
    else added.push({ line: start + i + 1, text: l });
  });
  const countsB = new Map<string, number>();
  for (const l of b) countsB.set(l, (countsB.get(l) ?? 0) + 1);
  const removed: LineChange[] = [];
  a.forEach((l, i) => {
    const c = countsB.get(l) ?? 0;
    if (c > 0) countsB.set(l, c - 1);
    else removed.push({ line: start + i + 1, text: l });
  });
  return { added, removed };
}
