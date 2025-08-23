import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ScanOptions } from '../types';

export function loadConfig(directory: string): Partial<ScanOptions> {
  try {
    const jsonPath = join(directory, 'ubon.config.json');
    if (existsSync(jsonPath)) {
      const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Partial<ScanOptions>;
      return data;
    }
    const jsPath = join(directory, 'ubon.config.js');
    if (existsSync(jsPath)) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const data = require(jsPath);
      return (data && data.default) ? data.default : data;
    }
    const pkgPath = join(directory, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as any;
      if (pkg.ubon && typeof pkg.ubon === 'object') {
        return pkg.ubon as Partial<ScanOptions>;
      }
    }
  } catch {
    // ignore config errors, fall back to defaults/CLI
  }
  return {};
}

export function mergeOptions(config: Partial<ScanOptions>, cli: Partial<ScanOptions>): ScanOptions {
  const merged: any = { ...config, ...cli };
  // For arrays, prefer CLI if provided, else config
  merged.enabledRules = cli.enabledRules !== undefined ? cli.enabledRules : config.enabledRules;
  merged.disabledRules = cli.disabledRules !== undefined ? cli.disabledRules : config.disabledRules;
  merged.changedFiles = cli.changedFiles !== undefined ? cli.changedFiles : config.changedFiles;
  // For numbers and booleans, CLI undefined means use config
  merged.minConfidence = cli.minConfidence !== undefined ? cli.minConfidence : config.minConfidence;
  merged.useBaseline = cli.useBaseline !== undefined ? cli.useBaseline : config.useBaseline;
  merged.baselinePath = cli.baselinePath !== undefined ? cli.baselinePath : config.baselinePath;
  merged.failOn = (cli as any).failOn !== undefined ? (cli as any).failOn : (config as any).failOn;
  return merged as ScanOptions;
}


