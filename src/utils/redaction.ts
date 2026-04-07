export function redactSensitiveTokens(value?: string): string | undefined {
  if (!value) return value;
  if (/sk-[A-Za-z0-9_-]{8,}/.test(value)) {
    return value.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-********');
  }
  if (/eyJ[A-Za-z0-9._-]{20,}/.test(value)) {
    return value.replace(/eyJ[A-Za-z0-9._-]{20,}/g, 'eyJ********');
  }
  return value;
}
