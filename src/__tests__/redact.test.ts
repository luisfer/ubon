import { redact } from '../utils/redact';

describe('redact', () => {
  it('returns input unchanged when undefined or short', () => {
    expect(redact(undefined)).toBeUndefined();
    expect(redact('')).toBe('');
    expect(redact('hello')).toBe('hello');
  });

  it('masks OpenAI-style keys', () => {
    const masked = redact('sk-' + 'a'.repeat(48));
    expect(masked).not.toContain('a'.repeat(48));
    expect(masked).toMatch(/sk-/);
  });

  it('masks Anthropic-style keys', () => {
    const out = redact('sk-ant-api03-' + 'b'.repeat(95));
    expect(out).not.toContain('b'.repeat(95));
  });

  it('masks AWS access keys', () => {
    const out = redact('AKIAIOSFODNN7EXAMPLE');
    expect(out).not.toBe('AKIAIOSFODNN7EXAMPLE');
  });

  it('masks GitHub PATs', () => {
    const tok = 'ghp_' + 'x'.repeat(36);
    const out = redact(tok);
    expect(out).not.toContain('x'.repeat(36));
  });

  it('masks JWT-shaped tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiMSJ9.abc123signature_value';
    const out = redact(jwt);
    expect(out).not.toBe(jwt);
  });

  it('passes through non-secret values unchanged', () => {
    expect(redact('hello-world')).toBe('hello-world');
    expect(redact('console.log("x")')).toBe('console.log("x")');
  });
});
