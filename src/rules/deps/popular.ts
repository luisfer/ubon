import { POPULAR_LOOKALIKES, POPULAR_PACKAGES } from '../../data/popular-packages.ts';
import { type SquatIndex, type SquatMatch, buildSquatIndex, isKnownName, matchSquat } from './squat.ts';

/** The bundled popular package list, decoded and indexed on first use. */

let index: SquatIndex | null = null;

/** Decode the data format: one name per line, or "@scope/ a b c" for several names of one scope. */
export function decodeNames(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    if (line.startsWith('@')) {
      const [scope, ...names] = line.split(' ');
      for (const name of names) if (name) out.push(`${scope}${name}`);
    } else {
      out.push(line);
    }
  }
  return out;
}

function load(): SquatIndex {
  index ??= buildSquatIndex(decodeNames(POPULAR_PACKAGES), decodeNames(POPULAR_LOOKALIKES));
  return index;
}

/** True for names on the bundled popular list, including known lookalikes (case-insensitive). */
export function isPopularPackage(name: string): boolean {
  return isKnownName(load(), name);
}

/** The popular package that `name` imitates, or null. */
export function typosquatOf(name: string): SquatMatch | null {
  return matchSquat(load(), name);
}
