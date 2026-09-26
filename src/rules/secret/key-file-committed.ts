import type { Rule } from '../types.ts';

/** Private key and credential files that git tracks (or would commit). */

const KEY_NAME = /(^|\/)(id_rsa|id_dsa|id_ecdsa|id_ed25519|id_ecdsa_sk|id_ed25519_sk)$|\.(pem|key|p12|pfx|ppk|jks|keystore|p8)$/i;
const CREDENTIAL_FILES = /(^|\/)(\.npmrc|\.yarnrc\.yml|\.pypirc|\.netrc|_netrc|\.git-credentials|\.dockercfg|\.docker\/config\.json|credentials\.json|service[-_]?account[\w.-]*\.json|[\w-]+-firebase-adminsdk-[\w-]+\.json|gcp[-_]?key\.json|\.htpasswd)$/i;
const BINARY_KEY = /\.(p12|pfx|jks|keystore)$/i;

function credentialInside(path: string, text: string | null): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  if (text === null) return BINARY_KEY.test(path) ? 'a binary keystore' : null;
  if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/.test(text)) return 'a private key';
  if (base === '.npmrc' && /_auth(Token)?\s*=\s*(?!\$\{)[^\s$]{8,}/.test(text)) return 'an npm auth token';
  if (base === '.yarnrc.yml' && /npmAuth(Token|Ident)\s*:\s*["']?(?!\$\{)[^\s"'$]{8,}/.test(text)) return 'an npm auth token';
  if (base === '.pypirc' && /^\s*password\s*[:=]\s*(?!\$\{)\S{8,}/m.test(text)) return 'a PyPI password or token';
  if ((base === '.netrc' || base === '_netrc') && /\bpassword\s+\S+/.test(text)) return 'a login password';
  if (base === '.git-credentials' && /:\/\/[^:\s]+:[^@\s]+@/.test(text)) return 'git credentials';
  if ((base === '.dockercfg' || base === 'config.json') && /"auth"\s*:\s*"[A-Za-z0-9+/=]{12,}"/.test(text)) return 'registry credentials';
  if (/"type"\s*:\s*"service_account"/.test(text) && /"private_key"\s*:/.test(text)) return 'a cloud service account key';
  if (base === 'credentials.json' && /"client_secret"\s*:\s*"[^"]{10,}"/.test(text)) return 'an OAuth client secret';
  if (base === '.htpasswd' && /^[^:\s]+:\$?[^\s]{10,}/m.test(text)) return 'password hashes';
  return null;
}

function credentialLine(text: string): number {
  const lines = text.split('\n');
  for (const re of [/-----BEGIN [A-Z ]*PRIVATE KEY/, /"private_key"\s*:/, /_auth|npmAuth|password|client_secret|"auth"|:\/\//]) {
    const index = lines.findIndex((l) => re.test(l));
    if (index >= 0) return index + 1;
  }
  return 1;
}

export const keyFileCommitted: Rule = {
  meta: {
    id: 'secret/key-file-committed',
    level: 'block',
    scope: 'project',
    title: 'Private key or credential file in git',
    summary: 'Private keys (`*.pem`, `*.key`, `id_rsa`, `*.p12`), service account JSON, and config files with literal tokens (`.npmrc`, `.pypirc`, `.netrc`) that git tracks or does not ignore.',
    why: 'Key files give direct access to servers, cloud accounts, and package registries. Once committed they stay in git history even after the file is deleted.',
    fix: 'Remove the file from git (`git rm --cached <file>`), add it to .gitignore, and revoke or rotate the credential.',
    cwe: ['CWE-798', 'CWE-321'],
    owasp: ['A04:2025'],
    levels: 'warn for keys under test, fixture, and example folders, which are usually throwaway keys.',
  },
  project(ctx) {
    if (ctx.tracked === null) return;
    for (const view of ctx.scopeFiles) {
      if (view.status === 'deleted') continue;
      const path = view.path;
      if (!KEY_NAME.test(path) && !CREDENTIAL_FILES.test(path) && !/\.json$/i.test(path)) continue;
      if (/\.pub$/i.test(path)) continue;
      const text = ctx.read(path);
      if (/\.json$/i.test(path) && !CREDENTIAL_FILES.test(path) && !(text && /"type"\s*:\s*"service_account"/.test(text))) continue;
      const what = credentialInside(path, text);
      if (!what) continue;
      const info = ctx.info(path);
      const throwaway = info.contexts.has('test') || info.contexts.has('example');
      const line = text ? credentialLine(text) : 1;
      ctx.report(path, {
        line,
        level: throwaway ? 'warn' : 'block',
        message: `${path} contains ${what} and ${ctx.tracked.has(path) ? 'is tracked by git' : 'is not ignored by git'}.${throwaway ? ' It is in a test or example folder; make sure it is a throwaway key.' : ''}`,
        evidence: path,
      });
    }
  },
};
