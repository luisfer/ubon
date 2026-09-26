import type { Rule } from '../types.ts';
import { isDefaultPassword, isEnvFileName, isLocalHost } from './names.ts';

/** Connection strings with a literal password. */

const CONN = /\b(postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|mssql|sqlserver|cockroachdb|clickhouse)(?:\+[a-z0-9]+)?:\/\/([^\s:/@'"`<>{}]*):([^\s@'"`<>]+)@([^\s/:'"`?<>]+)/gi;

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
    levels: 'warn for local development hosts (localhost, docker service names) and for common default passwords.',
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
        if (!password || /^\$|\$\{|%\(|\{\{/.test(password)) continue; // interpolated from the environment
        if (/^(<.*>|\[.*\]|\*+|x{3,}|\.{3})$|your[-_]?|[-_]here$|placeholder|example/i.test(password)) continue;
        if (/example\.(com|org|net)$|\.example$|^host$|^hostname$|^your[-_]?host/i.test(host)) continue;
        const local = isLocalHost(host) || isDefaultPassword(password);
        ctx.report({
          line: i + 1,
          column: (m.index ?? 0) + 1,
          endColumn: (m.index ?? 0) + m[0].length + 1,
          level: local ? 'warn' : 'block',
          message: local
            ? `${m[1]} URL with an inline password for a local or default setup (${host}). Fine for local development only; keep production URLs out of files.`
            : `${m[1]} URL with an inline password for ${host}.`,
          key: `${m[1]}@${host}`,
        });
      }
    });
  },
};
