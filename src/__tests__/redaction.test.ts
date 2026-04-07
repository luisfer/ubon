import { redactSensitiveTokens } from '../utils/redaction';

describe('redaction utility', () => {
  it('redacts secret key tokens', () => {
    const input = 'token=sk-abcdefghijklmnopqrstuvwxyz0123456789';
    expect(redactSensitiveTokens(input)).toContain('sk-********');
    expect(redactSensitiveTokens(input)).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('redacts jwt-like tokens', () => {
    const input = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdefghijklmnopqrstuv';
    expect(redactSensitiveTokens(input)).toContain('eyJ********');
  });

  it('keeps non-secret values unchanged', () => {
    expect(redactSensitiveTokens('hello-world')).toBe('hello-world');
  });
});
