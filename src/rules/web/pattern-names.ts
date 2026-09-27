/**
 * Name classification shared by the pattern rules in this pack. Identifiers,
 * object keys, storage keys, and cookie names are split into lowercase words
 * (`resetToken` -> reset, token; `x-api-key` -> x, api, key), and the last
 * word (the head noun) decides what the value is: `tokenCount` is a count,
 * `resetToken` is a token. Each rule has its own tight list, because the same
 * word means different things in different places (`session` in a cookie
 * name is almost always auth; in a localStorage key it is often a chat).
 */

export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => {
      const lower = w.toLowerCase();
      return /^[a-z]{2,}\d+$/.test(lower) ? lower.replace(/\d+$/, '') : lower;
    });
}

/** Words that mark a name as not a real credential (mock data, tests, placeholders). */
const NOT_REAL = new Set(['mock', 'mocked', 'fake', 'dummy', 'test', 'sample', 'example', 'placeholder', 'demo', 'stub', 'fixture']);

/** Names of sample-data code: createFakeUsers, mockSession, seedDatabase, generateDemoData. */
export function isSampleName(name: string): boolean {
  return words(name).some((w) => NOT_REAL.has(w) || w === 'seed' || w === 'seeds' || w === 'faker' || w === 'fakes' || w === 'mocks');
}

/** Leading words of boolean flags and hooks: isToken, hasSession, showPassword, useToken. */
const FLAG_PREFIX = new Set(['is', 'has', 'show', 'hide', 'should', 'can', 'did', 'will', 'toggle', 'enable', 'disable', 'needs', 'use', 'with', 'on', 'handle', 'validate', 'check', 'verify', 'compare', 'hash', 'hashed', 'encrypt', 'encrypted', 'mask', 'masked', 'strip', 'parse', 'decode', 'decoded', 'format']);

/** Trailing words that describe how a credential is represented, not what it is: tokenHex, rawPassword. */
const REPRESENTATION = new Set(['str', 'string', 'value', 'val', 'hex', 'raw', 'plain', 'plaintext', 'text', 'digits', 'chars', 'bytes', 'buffer', 'buf', 'b64', 'base64', 'encoded']);

/** Qualifiers that make "token" something other than a credential. */
const NON_AUTH_TOKEN = new Set([
  'design', 'color', 'colour', 'theme', 'style', 'font', 'spacing', 'css', 'lexer', 'syntax', 'parse', 'parser', 'push', 'fcm', 'device',
  'notification', 'notifications', 'apns', 'expo', 'captcha', 'recaptcha', 'hcaptcha', 'turnstile', 'cancel', 'cancellation', 'page', 'next',
  'prev', 'previous', 'continuation', 'sync', 'cursor', 'pagination', 'llm', 'gpt', 'model', 'max', 'min', 'num', 'total', 'prompt',
  'completion', 'input', 'output', 'stop', 'special', 'eos', 'bos', 'pad', 'unk', 'sep', 'cls', 'start', 'end', 'word', 'char', 'last', 'first',
  'string', 'number', 'operator', 'keyword', 'punctuation', 'whitespace', 'regex', 'template', 'expression', 'literal', 'identifier', 'erc',
  'nft', 'crypto', 'coin', 'game', 'player', 'board', 'reasoning', 'cached', 'usage', 'bucket', 'rate', 'limit', 'limiter',
]);

function trimmed(name: string): string[] {
  const w = words(name);
  while (w.length > 1 && REPRESENTATION.has(w[w.length - 1] as string)) w.pop();
  return w;
}

// ---------------------------------------------------------------------------
// Credentials produced by a random generator (web/weak-token-randomness)

const RANDOM_SIMPLE: Record<string, string> = {
  token: 'token',
  secret: 'secret',
  secrets: 'secret',
  password: 'password',
  passwords: 'password',
  passwd: 'password',
  passphrase: 'passphrase',
  passcode: 'passcode',
  passcodes: 'passcode',
  otp: 'one-time password',
  otps: 'one-time password',
  totp: 'one-time password',
  hotp: 'one-time password',
  nonce: 'nonce',
  nonces: 'nonce',
  salt: 'salt',
  salts: 'salt',
  pin: 'PIN',
  pincode: 'PIN',
  apikey: 'API key',
  apikeys: 'API key',
  sessionid: 'session ID',
  sessiontoken: 'session token',
  authtoken: 'auth token',
  accesstoken: 'access token',
  refreshtoken: 'refresh token',
  csrftoken: 'CSRF token',
  secretkey: 'secret key',
  privatekey: 'private key',
  otpcode: 'one-time password',
  csrf: 'CSRF token',
  xsrf: 'CSRF token',
};

const KEY_QUALIFIERS = new Set(['api', 'secret', 'private', 'access', 'session', 'signing', 'encryption', 'auth', 'master', 'admin', 'license', 'hmac', 'jwt', 'invite', 'reset', 'recovery', 'activation']);
const CODE_QUALIFIERS = new Set([
  'invite', 'invitation', 'reset', 'verification', 'verify', 'confirmation', 'confirm', 'otp', 'auth', 'authorization', 'login', 'signin',
  'magic', 'recovery', 'backup', 'access', 'security', 'mfa', '2fa', 'factor', 'activation', 'sms', 'email', 'pin', 'unlock', 'time', 'passcode',
]);
const LINK_QUALIFIERS = new Set(['magic', 'reset', 'invite', 'invitation', 'verification', 'verify', 'confirmation', 'confirm', 'login', 'signin', 'activation']);
const PLURAL_TOKEN_QUALIFIERS = new Set(['access', 'refresh', 'auth', 'api', 'reset', 'invite', 'csrf', 'session', 'verification', 'bearer']);
/** Qualifiers that make a token a credential wherever it is: resetToken, accessToken, inviteToken, shareToken. */
const CREDENTIAL_TOKEN_QUALIFIERS = new Set([
  'access', 'refresh', 'auth', 'authentication', 'authorization', 'api', 'reset', 'invite', 'invitation', 'verification', 'verify', 'confirm',
  'confirmation', 'bearer', 'magic', 'login', 'signin', 'email', 'id', 'jwt', 'oauth', 'share', 'sharing', 'download', 'upload', 'secret',
  'security', 'activation', 'recovery', 'unsubscribe', 'personal', 'service', 'admin', 'user', 'client', 'app', 'bot', 'webhook', 'signup',
]);
const PIN_NOT_CREDENTIAL = new Set(['map', 'marker', 'location', 'geo', 'drop', 'board', 'pos', 'position', 'hair', 'safety', 'push', 'tab']);

/**
 * Labels that are credentials only in some code: a session ID or a nonce in a
 * request handler protects something, while the same names in a CLI, a chat
 * UI, or a temp-file helper are plain identifiers.
 */
export function isContextualCredential(label: string): boolean {
  return label === 'token' || label === 'session ID' || label === 'nonce';
}

/**
 * The credential a name refers to, for values built by a random generator:
 * `resetToken` -> 'reset token', `inviteCode` -> 'invite code', `sessionId` -> 'session ID'.
 * Null for everything else, including `id`, `key`, `code`, and `tokens` on
 * their own, counts (`maxTokens`), flags (`isToken`), and mock data.
 */
export function randomCredentialLabel(name: string): string | null {
  const w = trimmed(name);
  if (w.length === 0) return null;
  if (w.some((x) => NOT_REAL.has(x))) return null;
  if (w.length > 1 && FLAG_PREFIX.has(w[0] as string)) return null;
  const head = w[w.length - 1] as string;
  const prev = w.length > 1 ? (w[w.length - 2] as string) : '';
  if (head === 'token' || head === 'tokens') {
    if (prev && NON_AUTH_TOKEN.has(prev)) return null;
    if (head === 'tokens' && !PLURAL_TOKEN_QUALIFIERS.has(prev)) return null;
    if (prev === 'csrf' || prev === 'xsrf') return 'CSRF token';
    if (prev === 'session') return 'session token';
    // A bare token (token, _token, randomToken) is often a marker or a correlation ID; see isContextualCredential.
    if (CREDENTIAL_TOKEN_QUALIFIERS.has(prev)) return prev === 'api' ? 'API token' : prev === 'id' ? 'ID token' : `${prev} token`;
    return 'token';
  }
  if (head === 'pin' && PIN_NOT_CREDENTIAL.has(prev)) return null;
  const simple = RANDOM_SIMPLE[head];
  if (simple) return simple;
  if ((head === 'key' || head === 'keys') && KEY_QUALIFIERS.has(prev)) return prev === 'api' ? 'API key' : `${prev} key`;
  if (head === 'id' && prev === 'session') return 'session ID';
  if ((head === 'code' || head === 'codes') && CODE_QUALIFIERS.has(prev)) {
    if (prev === 'factor' || prev === '2fa' || prev === 'mfa') return 'two-factor code';
    if (prev === 'time') return 'one-time code';
    return `${prev} code`;
  }
  if ((head === 'link' || head === 'url') && LINK_QUALIFIERS.has(prev)) return `${prev} ${head}`;
  if (head === 'verifier' && prev === 'code') return 'PKCE code verifier';
  if (head === 'state' && (prev === 'oauth' || prev === 'oidc' || prev === 'csrf')) return 'OAuth state';
  return null;
}

// ---------------------------------------------------------------------------
// Auth values in localStorage and sessionStorage (web/token-in-web-storage)

const SESSION_QUALIFIERS = new Set(['auth', 'user', 'login', 'supabase', 'firebase', 'current', 'active']);

/** What an auth-shaped storage key or variable holds, or null. `theme`, `locale`, `chatSession`, and `maxTokens` never match. */
export function storageCredentialLabel(name: string): string | null {
  const w = trimmed(name);
  if (w.length === 0) return null;
  if (w.some((x) => NOT_REAL.has(x))) return null;
  if (w.length > 1 && FLAG_PREFIX.has(w[0] as string)) return null;
  const head = w[w.length - 1] as string;
  const prev = w.length > 1 ? (w[w.length - 2] as string) : '';
  if (head === 'token' || head === 'tokens') {
    if (prev && NON_AUTH_TOKEN.has(prev)) return null;
    if (prev === 'csrf' || prev === 'xsrf') return null;
    if (head === 'tokens' && !PLURAL_TOKEN_QUALIFIERS.has(prev)) return null;
    if (prev === 'id') return 'ID token';
    if (prev === 'refresh') return 'refresh token';
    if (prev === 'access') return 'access token';
    if (prev === 'session') return 'session token';
    return 'token';
  }
  if (head === 'jwt' || head === 'jwts') return 'JWT';
  if (['authtoken', 'accesstoken', 'refreshtoken', 'idtoken', 'bearertoken', 'sessiontoken'].includes(head)) return 'token';
  if (head === 'apikey' || head === 'apikeys' || ((head === 'key' || head === 'keys') && (prev === 'api' || prev === 'secret' || prev === 'private' || prev === 'access'))) return 'API key';
  if (head === 'password' || head === 'passwd' || head === 'passphrase') return 'password';
  if (head === 'secret' || head === 'secretkey' || head === 'clientsecret') return 'secret';
  if (head === 'credentials' || head === 'credential') return 'credentials';
  if (head === 'session' && (w.length === 1 || SESSION_QUALIFIERS.has(prev))) return 'session';
  if (head === 'sessionid' || ((head === 'id' || head === 'key' || head === 'secret') && prev === 'session')) return 'session ID';
  return null;
}

// ---------------------------------------------------------------------------
// Auth cookies (web/insecure-cookie)

/** What an auth-shaped cookie name holds, or null. CSRF cookies are meant to be readable by scripts and never match. */
export function authCookieLabel(name: string): string | null {
  const w = words(name);
  if (w.length === 0) return null;
  if (w.some((x) => x === 'csrf' || x === 'xsrf' || NOT_REAL.has(x))) return null;
  const head = w[w.length - 1] as string;
  const prev = w.length > 1 ? (w[w.length - 2] as string) : '';
  if (head === 'token' || head === 'tokens') {
    if (prev && NON_AUTH_TOKEN.has(prev)) return null;
    return prev === 'refresh' ? 'refresh token' : prev === 'access' ? 'access token' : prev === 'session' ? 'session token' : 'token';
  }
  if (['session', 'sid', 'sessionid', 'sess'].includes(head)) return 'session';
  if (head === 'id' && prev === 'session') return 'session';
  if (['auth', 'authtoken', 'accesstoken', 'refreshtoken'].includes(head)) return 'auth';
  if (head === 'jwt') return 'JWT';
  if (head === 'remember' || head === 'rememberme' || (head === 'me' && prev === 'remember')) return 'remember-me';
  return null;
}
