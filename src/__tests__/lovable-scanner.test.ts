import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { LovableSupabaseScanner } from '../scanners/lovable-supabase-scanner';

describe('LovableSupabaseScanner', () => {
  const tmp = join(process.cwd(), '.tmp-lovable-tests');

  beforeAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
    mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  describe('LOVABLE001: Missing RLS Policy Validation', () => {
    it('detects Supabase table access without RLS comment', async () => {
      const file = join(tmp, 'users.ts');
      writeFileSync(file, `
        import { supabase } from './supabase';

        export async function getUsers() {
          const { data } = await supabase
            .from('users')
            .select('*');
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const ruleIds = results.map(r => r.ruleId);
      expect(ruleIds).toContain('LOVABLE001');
    });

    it('does not flag when RLS comment is present', async () => {
      const file = join(tmp, 'users-safe.ts');
      writeFileSync(file, `
        import { supabase } from './supabase';

        export async function getUsers() {
          // RLS enabled for users
          const { data } = await supabase
            .from('users')
            .select('*');
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable001Results = results.filter(r => r.ruleId === 'LOVABLE001' && r.file?.includes('users-safe.ts'));
      expect(lovable001Results.length).toBe(0);
    });

    it('detects insert, update, and delete operations', async () => {
      const file = join(tmp, 'crud.ts');
      writeFileSync(file, `
        import { supabase } from './supabase';

        export async function createUser(user) {
          await supabase.from('users').insert(user);
        }

        export async function updateUser(id, updates) {
          await supabase.from('users').update(updates).eq('id', id);
        }

        export async function deleteUser(id) {
          await supabase.from('users').delete().eq('id', id);
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable001Results = results.filter(r => r.ruleId === 'LOVABLE001' && r.file?.includes('crud.ts'));
      expect(lovable001Results.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('LOVABLE002: Hardcoded Supabase Credentials', () => {
    it('detects hardcoded Supabase URL', async () => {
      const file = join(tmp, 'hardcoded-url.ts');
      writeFileSync(file, `
        import { createClient } from '@supabase/supabase-js';

        const supabase = createClient(
          'https://xyzabcdefgh.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
        );
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable002Results = results.filter(r => r.ruleId === 'LOVABLE002');
      expect(lovable002Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects hardcoded JWT tokens', async () => {
      const file = join(tmp, 'hardcoded-jwt.ts');
      writeFileSync(file, `
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ';
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable002Results = results.filter(r => r.ruleId === 'LOVABLE002' && r.file?.includes('hardcoded-jwt.ts'));
      expect(lovable002Results.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag environment variable usage', async () => {
      const file = join(tmp, 'env-safe.ts');
      writeFileSync(file, `
        import { createClient } from '@supabase/supabase-js';

        const supabase = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_ANON_KEY
        );
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable002Results = results.filter(r => r.ruleId === 'LOVABLE002' && r.file?.includes('env-safe.ts'));
      expect(lovable002Results.length).toBe(0);
    });
  });

  describe('LOVABLE003: Anonymous Authentication Without RLS', () => {
    it('detects signInAnonymously without RLS', async () => {
      const file = join(tmp, 'anon-auth.ts');
      writeFileSync(file, `
        import { supabase } from './supabase';

        export async function loginAnonymously() {
          const { data } = await supabase.auth.signInAnonymously();
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable003Results = results.filter(r => r.ruleId === 'LOVABLE003');
      expect(lovable003Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects enableAnonymousSignIn config', async () => {
      const file = join(tmp, 'anon-config.ts');
      writeFileSync(file, `
        const config = {
          auth: {
            enableAnonymousSignIn: true
          }
        };
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable003Results = results.filter(r => r.ruleId === 'LOVABLE003' && r.file?.includes('anon-config.ts'));
      expect(lovable003Results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('LOVABLE004: SQL Injection in Supabase Queries', () => {
    it('detects SQL injection in select with template literal', async () => {
      const file = join(tmp, 'sql-injection.ts');
      writeFileSync(file, `
        import { supabase } from './supabase';

        export async function searchUsers(query: string) {
          const { data } = await supabase
            .from('users')
            .select(\`name, email WHERE name LIKE '%\${query}%'\`);
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable004Results = results.filter(r => r.ruleId === 'LOVABLE004');
      expect(lovable004Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects SQL injection in filter', async () => {
      const file = join(tmp, 'filter-injection.ts');
      writeFileSync(file, `
        export async function filterUsers(condition: string) {
          const { data } = await supabase
            .from('users')
            .select('*')
            .filter(\`status = '\${condition}'\`);
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable004Results = results.filter(r => r.ruleId === 'LOVABLE004' && r.file?.includes('filter-injection.ts'));
      expect(lovable004Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects SQL injection in eq with template literal', async () => {
      const file = join(tmp, 'eq-injection.ts');
      writeFileSync(file, `
        export async function getUserByName(name: string) {
          const { data } = await supabase
            .from('users')
            .select('*')
            .eq('name', \`\${name}\`);
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable004Results = results.filter(r => r.ruleId === 'LOVABLE004' && r.file?.includes('eq-injection.ts'));
      expect(lovable004Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects SQL injection in rpc', async () => {
      const file = join(tmp, 'rpc-injection.ts');
      writeFileSync(file, `
        export async function callFunction(param: string) {
          const { data } = await supabase.rpc(\`my_function_\${param}\`, {});
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable004Results = results.filter(r => r.ruleId === 'LOVABLE004' && r.file?.includes('rpc-injection.ts'));
      expect(lovable004Results.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag safe parameterized queries', async () => {
      const file = join(tmp, 'safe-query.ts');
      writeFileSync(file, `
        export async function getUserByEmail(email: string) {
          const { data } = await supabase
            .from('users')
            .select('*')
            .eq('email', email);
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable004Results = results.filter(r => r.ruleId === 'LOVABLE004' && r.file?.includes('safe-query.ts'));
      expect(lovable004Results.length).toBe(0);
    });
  });

  describe('LOVABLE005: Weak RLS Policy Patterns', () => {
    it('detects USING (true) policy', async () => {
      const file = join(tmp, 'weak-rls.sql');
      writeFileSync(file, `
        CREATE POLICY "Allow all access"
          ON users
          FOR ALL
          USING (true);
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable005Results = results.filter(r => r.ruleId === 'LOVABLE005');
      expect(lovable005Results.length).toBeGreaterThanOrEqual(1);
    });

    it('detects policy without auth.uid() check', async () => {
      const file = join(tmp, 'no-auth-check.sql');
      writeFileSync(file, `
        CREATE POLICY "Public read"
          ON posts
          FOR SELECT
          USING (published = true);
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable005Results = results.filter(r => r.ruleId === 'LOVABLE005' && r.file?.includes('no-auth-check.sql'));
      expect(lovable005Results.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag proper RLS policy with auth.uid()', async () => {
      const file = join(tmp, 'proper-rls.sql');
      writeFileSync(file, `
        CREATE POLICY "Users can only access their own data"
          ON profiles
          FOR ALL
          USING (auth.uid() = user_id);
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable005Results = results.filter(r => r.ruleId === 'LOVABLE005' && r.file?.includes('proper-rls.sql'));
      expect(lovable005Results.length).toBe(0);
    });
  });

  describe('LOVABLE006: Storage Access Without Validation', () => {
    it('detects storage.from without validation', async () => {
      const file = join(tmp, 'storage-upload.ts');
      writeFileSync(file, `
        import { supabase } from './supabase';

        export async function uploadFile(file: File) {
          const { data } = await supabase.storage
            .from('avatars')
            .upload('public/' + file.name, file);
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable006Results = results.filter(r => r.ruleId === 'LOVABLE006');
      expect(lovable006Results.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag storage with validation', async () => {
      const file = join(tmp, 'storage-validated.ts');
      writeFileSync(file, `
        export async function uploadAvatar(file: File) {
          // Validate file size
          if (file.size > 5 * 1024 * 1024) throw new Error('File too large');
          // Validate file type
          if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Invalid type');

          const { data } = await supabase.storage
            .from('avatars')
            .upload('public/' + file.name, file);
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const lovable006Results = results.filter(r => r.ruleId === 'LOVABLE006' && r.file?.includes('storage-validated.ts'));
      expect(lovable006Results.length).toBe(0);
    });
  });

  describe('Integration Tests', () => {
    it('only scans files with Supabase usage', async () => {
      const noSupabaseFile = join(tmp, 'no-supabase.ts');
      writeFileSync(noSupabaseFile, `
        import React from 'react';

        export function Component() {
          return <div>Hello</div>;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const noSupabaseResults = results.filter(r => r.file?.includes('no-supabase.ts'));
      expect(noSupabaseResults.length).toBe(0);
    });

    it('scans multiple files and aggregates results', async () => {
      const file1 = join(tmp, 'multi1.ts');
      const file2 = join(tmp, 'multi2.ts');

      writeFileSync(file1, `
        import { supabase } from './supabase';
        export async function getUsers() {
          const { data } = await supabase.from('users').select('*');
          return data;
        }
      `);

      writeFileSync(file2, `
        import { supabase } from './supabase';
        export async function getPosts() {
          const { data } = await supabase.from('posts').select('*');
          return data;
        }
      `);

      const scanner = new LovableSupabaseScanner();
      const results = await scanner.scan({ directory: tmp });
      const multiResults = results.filter(r =>
        r.file?.includes('multi1.ts') || r.file?.includes('multi2.ts')
      );
      expect(multiResults.length).toBeGreaterThanOrEqual(2);
    });
  });
});
