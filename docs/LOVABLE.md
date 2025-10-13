# 🪷 Ubon for Lovable Apps - Integration Guide

## Why Ubon for Lovable?

Lovable's built-in security scanner is a great first line of defense, but Ubon goes deeper with specialized rules for the exact stack Lovable generates (React + Vite + Supabase + Tailwind CSS).

### How Ubon Complements Lovable Scanner

| Feature | Lovable Scanner | Ubon |
|---------|----------------|------|
| **RLS Check** | ✅ Checks existence | ✅ Validates implementation |
| **SQL Injection** | ❌ Not covered | ✅ Query analysis |
| **Vite Security** | ❌ Not covered | ✅ Specialized rules |
| **API Keys** | ⚠️ Blocks ~1200/day | ✅ Finds missed ones |
| **Accessibility** | ❌ Not covered | ✅ 7 a11y rules |
| **Link Validation** | ❌ Not covered | ✅ External + Internal |
| **Interactive Debugging** | ❌ Not covered | ✅ Step-by-step walkthrough |

**Recommendation**: Use both scanners together for maximum coverage.

## Quick Start

```bash
# Install globally
npm install -g ubon@latest

# Scan your Lovable app (auto-detects profile)
cd your-lovable-app
ubon scan --interactive

# Or explicitly use Lovable profile
ubon scan --profile lovable --interactive
```

## Auto-Detection

Ubon automatically detects Lovable apps by checking for:
1. Vite configuration (`vite.config.ts` or `vite.config.js`)
2. Supabase integration (`@supabase/supabase-js` in dependencies)
3. React framework
4. Tailwind CSS setup

If all are present, Ubon automatically applies the `lovable` profile with all 10 specialized rules.

## The 10 Lovable-Specific Rules

### 🔐 Supabase Security (6 rules)

#### LOVABLE001: Missing RLS Policy
**What it detects**: Supabase table access without Row Level Security (RLS) policy validation.

**Why it matters**: Missing RLS can expose all table data to any authenticated user, including PII, financial records, and sensitive information.

**Example**:
```typescript
// ❌ Bad - No RLS documentation
const { data } = await supabase.from('users').select('*');

// ✅ Good - RLS documented
// RLS enabled for users table - restricts to auth.uid()
const { data } = await supabase.from('users').select('*');
```

**Fix**: 
1. Enable RLS in Supabase dashboard
2. Create appropriate RLS policies
3. Document with a comment near the query

#### LOVABLE002: Exposed Supabase Keys
**What it detects**: Hardcoded Supabase URLs and anon keys in source code.

**Why it matters**: Exposed credentials in client-side code allow attackers to abuse your API quota and access data if RLS is misconfigured.

**Example**:
```typescript
// ❌ Bad
const supabase = createClient(
  'https://abc123.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
);

// ✅ Good
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

**Fix**: Move credentials to `.env` file and access via `import.meta.env.VITE_*`

#### LOVABLE003: Anonymous Auth Without RLS
**What it detects**: Anonymous authentication enabled without proper RLS validation.

**Why it matters**: Anonymous users may access tables intended for authenticated users if RLS is not properly configured.

**Example**:
```typescript
// ❌ Bad - No RLS mentioned
const { data } = await supabase.auth.signInAnonymously();

// ✅ Good - RLS documented
// RLS policies restrict anonymous users to read-only public data
const { data } = await supabase.auth.signInAnonymously();
```

**Fix**: Ensure RLS policies properly restrict anonymous users, or disable anonymous auth if not needed.

#### LOVABLE004: SQL Injection in Supabase Queries
**What it detects**: String interpolation in Supabase queries (SQL injection risk).

**Why it matters**: SQL injection can allow attackers to bypass RLS, access unauthorized data, or modify database contents.

**Example**:
```typescript
// ❌ Bad - String interpolation
const { data } = await supabase
  .from('users')
  .select(`name, email WHERE name LIKE '%${query}%'`);

// ✅ Good - Use query builder
const { data } = await supabase
  .from('users')
  .select('name, email')
  .ilike('name', `%${query}%`);
```

**Fix**: Use Supabase's query builder methods (`.eq()`, `.filter()`, `.ilike()`) instead of string interpolation.

#### LOVABLE005: Weak RLS Policy Patterns
**What it detects**: Common weak RLS patterns in SQL policy definitions.

**Why it matters**: Weak RLS policies may allow users to access other users' data, violating privacy and security.

**Example**:
```sql
-- ❌ Bad - Always true
CREATE POLICY "public_access" ON users FOR SELECT USING (true);

-- ❌ Bad - Missing auth.uid() check
CREATE POLICY "user_policy" ON profiles USING (user_id IS NOT NULL);

-- ✅ Good - Proper auth.uid() check
CREATE POLICY "user_policy" ON profiles 
  USING (auth.uid() = user_id);
```

**Fix**: Use `auth.uid()` checks to restrict access to user's own data.

#### LOVABLE006: Storage Access Without Validation
**What it detects**: Supabase storage access without file size/type validation.

**Why it matters**: Unvalidated file uploads can lead to storage abuse, malware hosting, or unauthorized data access.

**Example**:
```typescript
// ❌ Bad - No validation
const { data } = await supabase.storage
  .from('avatars')
  .upload('public/' + file.name, file);

// ✅ Good - With validation
const MAX_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png'];

if (file.size > MAX_SIZE) {
  throw new Error('File too large');
}
if (!ALLOWED_TYPES.includes(file.type)) {
  throw new Error('Invalid file type');
}

const { data } = await supabase.storage
  .from('avatars')
  .upload('public/' + file.name, file);
```

**Fix**: Add file size/type validation and ensure storage RLS policies are configured.

### ⚡ Vite Security (3 rules)

#### VITE001: Client-Side Environment Variable Exposure
**What it detects**: Environment variables without `VITE_` prefix used in client code.

**Why it matters**: Exposed secrets in client bundles can be extracted by anyone viewing your JavaScript.

**Example**:
```typescript
// ❌ Bad - Won't work and indicates confusion
const apiSecret = import.meta.env.API_SECRET;

// ✅ Good - VITE_ prefix for public vars
const apiUrl = import.meta.env.VITE_API_URL;
```

**Fix**: Rename to `VITE_*` in `.env` if safe to expose, or keep server-side only.

#### VITE002: Development-Only Code Without Fallback
**What it detects**: Development checks without production fallback.

**Why it matters**: Missing production configuration can cause app failures or expose development-only debugging information.

**Example**:
```typescript
// ❌ Bad - No production fallback
if (import.meta.env.DEV) {
  console.log('Debug info:', userData);
}

// ✅ Good - Proper fallback
if (import.meta.env.DEV) {
  console.log('Debug info');
} else {
  logger.info('Production logging');
}
```

**Fix**: Add production fallback or remove development-only code.

#### VITE003: Unsafe Dynamic Imports
**What it detects**: Dynamic imports with user input or path traversal risks.

**Why it matters**: Unvalidated dynamic imports can allow attackers to load arbitrary modules or traverse the file system.

**Example**:
```typescript
// ❌ Bad - User input in dynamic import
const module = await import(`./modules/${userInput}.js`);

// ✅ Good - Validated whitelist
const allowedModules = ['user', 'admin', 'guest'];
if (allowedModules.includes(moduleName)) {
  const module = await import(`./modules/${moduleName}.js`);
}
```

**Fix**: Use a whitelist of allowed module names before dynamic import.

### 🎨 Tailwind Security (1 rule)

#### TAILWIND001: Dynamic className Injection
**What it detects**: User input directly in className (CSS injection risk).

**Why it matters**: CSS injection can be used for UI spoofing, clickjacking, or exfiltrating data through CSS selectors.

**Example**:
```tsx
// ❌ Bad - Direct user input
<div className={userStyle}>Content</div>

// ❌ Bad - Template literal with user input
<div className={`alert alert-${userType}`}>Message</div>

// ✅ Good - Validated against whitelist
const validClasses = ['bg-red-500', 'bg-blue-500', 'bg-green-500'];
const className = validClasses.includes(color) ? color : 'bg-gray-500';
<div className={className}>Content</div>
```

**Fix**: Validate className input against a whitelist of allowed Tailwind classes.

## Common Lovable App Workflows

### 1. Pre-Deployment Scan
```bash
# Run before pushing to production
ubon scan --fail-on error --min-severity high
```

### 2. Interactive Debugging Session
```bash
# Step through issues one by one
ubon scan --interactive --min-severity medium
```

### 3. CI/CD Integration
```yaml
# .github/workflows/ubon.yml
name: Ubon Security Scan
on: [push, pull_request]
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm install -g ubon@latest
      - run: ubon check --profile lovable --fail-on error
```

### 4. Fix Common Issues Automatically
```bash
# Apply safe autofixes
ubon scan --apply-fixes --interactive
```

## Best Practices for Lovable Apps

1. **Always enable RLS in Supabase dashboard** before production
2. **Use environment variables** for all Supabase credentials (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
3. **Validate file uploads** (size, type) before storing in Supabase Storage
4. **Use Supabase query builder methods** instead of string interpolation
5. **Whitelist dynamic className values** when using user input
6. **Run Ubon before every deployment** to catch new issues
7. **Use both Lovable scanner + Ubon** for comprehensive coverage

## Suppressing False Positives

If Ubon flags something that's actually safe:

```typescript
// ubon-disable-next-line LOVABLE001
const { data } = await supabase.from('public_posts').select('*');
// This table is intentionally public, no RLS needed
```

Or create a `.ubon.baseline.json`:
```bash
ubon scan --create-baseline
```

## Getting Help

- **Documentation**: https://github.com/luisfer/ubon#readme
- **Rules Reference**: See `docs/RULES.md`
- **Issues**: https://github.com/luisfer/ubon/issues

## Changelog

See `CHANGELOG.md` for v1.2.0 release notes.

