import { JWT_PATTERN, SECRET_FORMATS, decodeJwtPayload } from '../data/secrets.ts';

/**
 * Mask a secret value for display: keep the known prefix and the last four
 * characters so a person can tell which credential to rotate, hide the rest.
 */
export function maskValue(value: string, prefix = ''): string {
  const safePrefix = prefix && value.startsWith(prefix) ? prefix : '';
  if (value.length < 20) return `${safePrefix}****`;
  return `${safePrefix}...${value.slice(-4)}`;
}

/**
 * Replace every known credential format in a piece of text with its masked
 * form. Every string that leaves Ubon (evidence, messages, MCP results, hook
 * output, logs) passes through this function.
 */
export function maskSecrets(text: string): string {
  let out = text;
  for (const format of SECRET_FORMATS) {
    out = out.replace(new RegExp(format.pattern.source, format.pattern.flags), (match) => maskValue(match, format.prefix));
  }
  out = out.replace(new RegExp(JWT_PATTERN.source, JWT_PATTERN.flags), (match) => {
    const payload = decodeJwtPayload(match);
    const role = payload && typeof payload.role === 'string' ? payload.role : '';
    // Anon keys are public by design; still shorten them so evidence stays readable.
    return role === 'anon' ? `${match.slice(0, 12)}...` : maskValue(match, 'eyJ');
  });
  // Passwords inside connection strings: scheme://user:password@host
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:)([^\s@'"`]+)(@)/gi, (_m, head: string, _pw: string, at: string) => `${head}****${at}`);
  return out;
}

/** Remove characters that could hide or reorder text when shown to a model or a terminal. */
export function stripControlCharacters(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]|[\u{E0000}-\u{E007F}]/gu, '');
}

/** Everything that is shown to people or agents goes through here. */
export function safeText(text: string, maxLength = 240): string {
  const cleaned = stripControlCharacters(maskSecrets(text));
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 3)}...` : cleaned;
}
