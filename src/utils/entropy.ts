export function shannonEntropy(input: string): number {
  if (!input || input.length === 0) return 0;
  const map: Record<string, number> = {};
  for (const ch of input) map[ch] = (map[ch] || 0) + 1;
  let entropy = 0;
  const len = input.length;
  for (const k in map) {
    const p = map[k] / len;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Extract quoted string-like tokens from a line
export function extractQuotedLiterals(line: string): string[] {
  const matches: string[] = [];
  const regex = /(['"]).*?\1/g; // simple non-greedy quoted
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    const raw = m[0];
    if (raw.length >= 3) {
      matches.push(raw.slice(1, -1));
    }
  }
  return matches;
}


