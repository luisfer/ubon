import { readFileSync } from 'fs';
import { join } from 'path';

export interface IssueContext {
  before: string[];
  line: string;
  after: string[];
}

export function buildIssueContext(
  directory: string,
  file: string | undefined,
  line: number | undefined,
  radius: number = 2
): IssueContext | undefined {
  if (!file || !line || line < 1) return undefined;
  try {
    const lines = readFileSync(join(directory, file), 'utf-8').split(/\r?\n/);
    const index = line - 1;
    if (index < 0 || index >= lines.length) return undefined;
    return {
      before: lines.slice(Math.max(0, index - radius), index),
      line: lines[index],
      after: lines.slice(index + 1, index + 1 + radius)
    };
  } catch {
    return undefined;
  }
}
