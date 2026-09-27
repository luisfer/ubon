export function readConfig(raw: string) {
  const parsed = JSON.parse(raw) as any;
  return parsed.settings;
}
