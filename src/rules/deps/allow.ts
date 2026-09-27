/**
 * packages.allow in ubon.json: exact names ("lodash", "@acme/ui"), whole
 * scopes ("@acme/*"), and simple wildcards ("eslint-plugin-*"). Case-insensitive.
 */
export function isAllowedPackage(name: string, allow: readonly string[]): boolean {
  const lower = name.toLowerCase();
  for (const raw of allow) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === lower) return true;
    if (!entry.includes('*')) continue;
    const pattern = new RegExp(`^${entry.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    if (pattern.test(lower)) return true;
  }
  return false;
}
