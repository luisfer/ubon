import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ScanOptions } from '../types';

/**
 * Load Ubon configuration. Order of precedence:
 *   1. `ubon.config.json` (always loaded — pure data)
 *   2. `ubon.config.js`   (only loaded if `--allow-config-js` was passed or
 *                          `UBON_ALLOW_CONFIG_JS=1` is set; executes user code)
 *   3. `package.json` "ubon" field (always loaded — pure data)
 *
 * Gating the JS variant matters because Ubon is frequently invoked in CI
 * against untrusted PR branches; loading arbitrary user JS at config time
 * would expand the supply-chain attack surface.
 */
export function loadConfig(
  directory: string,
  opts: { allowConfigJs?: boolean } = {}
): Partial<ScanOptions> {
  try {
    const jsonPath = join(directory, 'ubon.config.json');
    if (existsSync(jsonPath)) {
      const data = JSON.parse(readFileSync(jsonPath, 'utf-8')) as Partial<ScanOptions>;
      return data;
    }
    const jsPath = join(directory, 'ubon.config.js');
    if (existsSync(jsPath)) {
      const allowed = opts.allowConfigJs === true || process.env.UBON_ALLOW_CONFIG_JS === '1';
      if (!allowed) {
        if (process.env.UBON_VERBOSE) {
          console.error(
            `🪷 ubon: ignoring ubon.config.js (untrusted code). Pass --allow-config-js or set UBON_ALLOW_CONFIG_JS=1 to opt in.`
          );
        }
      } else {
         
        const data = require(jsPath);
        return (data && data.default) ? data.default : data;
      }
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


