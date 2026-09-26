import type { Rule } from '../types.ts';
import { isDefaultPassword, isEnvFileName, isLocalHost } from './names.ts';

/**
 * Connection strings with a literal password. Local development setups are
 * not reported: loopback hosts, and single-label hosts (docker service names)
 * with a default password. A default password on a real host, or a
 * single-label host with any other password, is a warning.
 */

const CONN = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|cockroachdb|clickhouse)(?:\+[a-z0-9]+)?:\/\/([^\s:/@'"`<>{}]*):([^\s@'"`<>]+)@(\[[0-9a-f:.%]+\]|[^\s/:'"`?<>]+)/gi;
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1?\]|::1|host\.docker\.internal)$/i;
// example.com and friends, "your-db-host", and the IP ranges reserved for documentation (RFC 5737, RFC 3849).
const PLACEHOLDER_HOST = /(^|\.)example\.(com|org|net)$|\.example$|^(host|hostname)$|(^|[-_.])your([-_.]|$)|^\[?2001:db8:|^(192\.0\.2|198\.51\.100|203\.0\.113)\./i;

export const dbUrlPassword: Rule = {
  meta: {
    id: 'secret/db-url-password',
    level: 'block',
    scope: 'file',
    title: 'Database URL with a password',
    summary: 'A connection string with an inline password (`postgres://user:pass@host`, `mongodb+srv://`, `mysql://`, `redis://:pass@`).',
    why: 'A database URL with a password is a credential: anyone who reads the file can connect to the database with the rights of that user.',
    fix: 'Read the URL from an environment variable (DATABASE_URL) and rotate the password.',
    cwe: ['CWE-798'],
    owasp: ['A07:2025'],
    levels: 'Not reported for local development: loopback hosts, and docker service names with a default password. warn for a default password on another host, and for a single-label host (a local or internal service) with any other password.',
  },
  appliesTo: (file) => !file.generated && !isEnvFileName(file.path),
  text(ctx) {
    if (!/:\/\//.test(ctx.text)) return;
    ctx.lines.forEach((line, i) => {
      if (!line.includes('://')) return;
      CONN.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = CONN.exec(line))) {
        const password = m[3] ?? '';
        const host = m[4] ?? '';
        if (!password || /^\$|\$\{|%\(|\{\{|^%[sdv]$/.test(password)) continue; // interpolated from the environment or a template
        if (/^%[sdv]$|\{\{|^\$/.test(host)) continue;
        if (/^(<.*>|\[.*\]|\*+|x{3,}|\.{3})$|your[-_]?|[-_]here$|placeholder|example/i.test(password)) continue;
        if (PLACEHOLDER_HOST.test(host) || LOOPBACK.test(host)) continue;
        const singleLabel = !host.includes('.') && !host.startsWith('[');
        const defaultPassword = isDefaultPassword(password);
        if (singleLabel && (defaultPassword || isLocalHost(host))) continue;
        let message = `${m[1]} URL with an inline password for ${host}.`;
        if (defaultPassword) message = `${m[1]} URL with a common default password for ${host}.`;
        else if (singleLabel) message = `${m[1]} URL with an inline password for ${host}, which looks like a local or internal service.`;
        ctx.report({
          line: i + 1,
          column: (m.index ?? 0) + 1,
          endColumn: (m.index ?? 0) + m[0].length + 1,
          level: defaultPassword || singleLabel ? 'warn' : 'block',
          message,
          key: `${m[1]}@${host}`,
        });
      }
    });
  },
};
