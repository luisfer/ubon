export function readConfig(raw: string) {
  const parsed = JSON.parse(raw) as any;
  // ok: this file already used `as any` at the base, so one more is not reported
  const extra = JSON.parse(raw).extra as any;
  return { ...parsed.settings, ...extra };
}
