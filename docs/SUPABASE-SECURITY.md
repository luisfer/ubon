# 🛡️ Supabase Security Detection

Ubon includes specialized detection for Supabase-specific security issues commonly found in vibe-coded applications.

## 🎯 What We Detect

### 1. Hardcoded Supabase URLs
```typescript
❌ BAD - Hardcoded in code:
const supabaseUrl = 'https://abc123.supabase.co';

✅ GOOD - Use environment variable:
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
```

### 2. Exposed Supabase Keys
```typescript
❌ BAD - JWT token in code:
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

✅ GOOD - Use environment variable:
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
```

### 3. Service Role Keys (Critical!)
```typescript
❌ CRITICAL - Service role key exposed:
const serviceKey = 'eyJ...service_role...';

✅ SECURE - Server-side only, environment variable:
// Only use in API routes or server-side code
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
```

### 4. Environment File Issues
```bash
❌ BAD - .env file not in .gitignore:
.env  # Contains real secrets, gets committed

✅ GOOD - Proper env file setup:
.env          # Local secrets (in .gitignore)
.env.example  # Template for team (committed)
```

## 🔍 Detection Patterns

Ubon identifies:
- **Supabase URLs**: `https://*.supabase.co`
- **JWT tokens**: `eyJ[A-Za-z0-9_-]*` patterns
- **Variable assignments**: `supabaseUrl =`, `supabaseKey =`
- **Missing .gitignore**: .env files not properly ignored
- **Hardcoded fallbacks**: `process.env.VAR || 'hardcoded'`

## 🚨 Common Vibe-Coding Mistakes

### Mistake 1: Copy-paste from Supabase dashboard
```typescript
// People copy this directly from Supabase dashboard
export const supabase = createClient(
  'https://xxxxxxxxx.supabase.co',  // ❌ Exposed
  'eyJhbGciOiJIUzI1NiIsInR5cCI6...' // ❌ Exposed
);
```

### Mistake 2: .env files in git
```bash
# .env file gets accidentally committed with:
SUPABASE_URL=https://realproject.supabase.co
SUPABASE_ANON_KEY=eyJ...real_key...
```

### Mistake 3: Environment fallbacks
```typescript
// "Just in case" fallbacks that leak secrets
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://backup.supabase.co';
```

## ✅ Best Practices

### 1. Environment Variables
```typescript
// supabase.ts
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

### 2. Proper .env Setup
```bash
# .env (local only, in .gitignore)
NEXT_PUBLIC_SUPABASE_URL=https://yourproject.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...service_role...

# .env.example (committed to git)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

### 3. .gitignore Protection
```bash
# .gitignore
.env
.env.local
.env*.local
```

## 🤖 AI Agent Integration

When AI agents detect Supabase issues, they can automatically:

1. **Move hardcoded values to environment variables**
2. **Create .env.example templates**
3. **Update .gitignore files** 
4. **Replace hardcoded client creation**

```json
{
  "issues": [
    {
      "type": "error",
      "category": "security",
      "message": "Supabase anon key hardcoded (JWT token pattern)",
      "file": "lib/supabase.ts",
      "line": 7,
      "fix": "Use NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable"
    }
  ]
}
```

Ubon helps ensure your Supabase apps are production-ready.