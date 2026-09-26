/**
 * Examples shown by `ubon explain`, extracted from the rule fixtures by
 * scripts/gen-docs.mjs. Do not edit by hand; run `npm run gen`.
 */

export interface RuleExample {
  file: string;
  code: string;
  note?: string;
}

export const EXAMPLES: Record<string, { flagged: RuleExample[]; safe: RuleExample[] }> = {
  "secret/provider-key": {
    "flagged": [
      {
        "file": ".env.example",
        "code": "OPENAI_API_KEY=sk-proj-...8nPa"
      },
      {
        "file": "docs/setup.md",
        "code": "export GITHUB_TOKEN=ghp_...1BTx"
      },
      {
        "file": "lib/anthropic.js",
        "code": "apiKey: \"sk-ant-...MmAA\","
      }
    ],
    "safe": [
      {
        "file": ".env",
        "code": "OPENAI_API_KEY=sk-proj-...jIbX",
        "note": "real .env files are covered by secret/env-file-committed"
      },
      {
        "file": "dist/bundle.min.js",
        "code": "var k=\"sk-proj-...m16V\";",
        "note": "build output is generated and skipped"
      },
      {
        "file": "docs/setup.md",
        "code": "Or use a placeholder while you wait for access: `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.",
        "note": "placeholder token in docs"
      }
    ]
  },
  "secret/db-url-password": {
    "flagged": [
      {
        "file": "lib/db.ts",
        "code": "export const prod = postgres('postgres://app:<db-password>@db.prod.internal:5432/app');"
      },
      {
        "file": "lib/db.ts",
        "code": "export const weak = postgres('postgres://postgres:postgres@db.prod.internal:5432/app');"
      },
      {
        "file": "lib/db.ts",
        "code": "export const internal = postgres('postgres://app:<db-password>@pgbouncer:6432/app');"
      }
    ],
    "safe": [
      {
        "file": ".env",
        "code": "DATABASE_URL=postgres://app:<db-password>@db.prod.internal:5432/app",
        "note": ".env files are covered by secret/env-file-committed"
      },
      {
        "file": "docker-compose.yml",
        "code": "DATABASE_URL: postgres://postgres:postgres@db:5432/app",
        "note": "docker service with a default password"
      },
      {
        "file": "docker-compose.yml",
        "code": "CACHE_URL: redis://:<db-password>@cache.example.net:6379",
        "note": "example host from documentation"
      }
    ]
  },
  "secret/public-env-name": {
    "flagged": [
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_OPENAI_API_KEY="
      },
      {
        "file": ".github/workflows/deploy.yml",
        "code": "NEXT_PUBLIC_DATABASE_URL: ${{ secrets.DATABASE_URL }}"
      },
      {
        "file": "app/checkout.tsx",
        "code": "const secret = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY;"
      }
    ],
    "safe": [
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_SUPABASE_URL=",
        "note": "URLs are public"
      },
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
        "note": "the anon key is public by design"
      },
      {
        "file": ".env.example",
        "code": "NEXT_PUBLIC_POSTHOG_KEY=",
        "note": "PostHog project keys are public"
      }
    ]
  },
  "secret/env-file-committed": {
    "flagged": [
      {
        "file": ".env",
        "code": "OPENAI_API_KEY=sk-proj-...MsGg"
      },
      {
        "file": ".env.local",
        "code": "STRIPE_SECRET_KEY=sk_live_...DIMR"
      },
      {
        "file": "apps/web/.env",
        "code": "SUPABASE_SERVICE_ROLE_KEY=eyJ...8PcX"
      }
    ],
    "safe": [
      {
        "file": ".env.development",
        "code": "OPENAI_API_KEY=your-openai-key-here",
        "note": "placeholders only"
      },
      {
        "file": ".env.example",
        "code": "OPENAI_API_KEY=",
        "note": "example files are meant to be committed"
      },
      {
        "file": ".env.production",
        "code": "NEXT_PUBLIC_SITE_URL=https://acme.dev",
        "note": "only public values"
      }
    ]
  },
  "secret/key-file-committed": {
    "flagged": [
      {
        "file": "deploy/id_rsa",
        "code": "-----BEGIN PRIVATE KEY-----...GW/Q\nyRNGWkm1YHVNOwvGD48UbyfFxc1AJvDBj7a8f8/delYCFG5r1B057LwOkr7ZLxQU\n8W/6R+nVD3LFVNJ+I4Mw6XFxPjfw1EDwYh2bZaJ0FsD2T2aWBg5bfN+FDBt2I2CY\nr2ypDoh4FPrawAT0ViKPYMvCZitebyOHqjzKj2Fiypje8Cr+y4jd+l59wnyUilPQ\nvuC1qX68RsnbeKamay2zfBjqWUszAxJmSmrniczBitkPfSlizcG7v0pB5rlB+KS0\njyL28z+W4unCsgylyjoVeYl1x/Q/z8MlcBUKUgDgxXEfrnHkQngDmZHOuGCrviAY\n-----END PRIVATE KEY-----"
      },
      {
        "file": "certs/server.key",
        "code": "-----BEGIN PRIVATE KEY-----...bdwD\n73K8hFZamwK9H1KvoLKdjEvYvZMnrqG9i38GYmNZm1ltgITBnSYcUzCPTjfvdWZn\nUcJarcslzg9hubq+junkfjclF8uFRwDORV+iJru5tlafFUOkXK7C2/3EcMt5TSLi\nRjl1G1jHSDnIS3w7EYr7M2HKLRWEp8R6egY1alF/DGRg03CSLaXdka2OhlPiFByz\nZ3n41vn4Hu4yWqy5RMhkdPDQ1eZuIO2qf7ZthfsmVtklPjMQjsG+9LuGMIHusavi\nn71+Gr3u3ACYN5Hk9Py89PIs8eY4ue/MRGvr2cZz+YiosSFhtg54RbaYAR5Gk+Cp\n-----END PRIVATE KEY-----"
      },
      {
        "file": ".npmrc",
        "code": "//registry.npmjs.org/:_authToken=npm_...XKOJ"
      }
    ],
    "safe": []
  },
  "secret/server-env-in-client": {
    "flagged": [
      {
        "file": "app/components/Chat.tsx",
        "code": "const key = process.env.OPENAI_API_KEY;"
      },
      {
        "file": "app/components/Chat.tsx",
        "code": "const token = import.meta.env.GITHUB_TOKEN;"
      },
      {
        "file": "lib/config.ts",
        "code": "export const stripeKey = process.env.STRIPE_SECRET_KEY;"
      }
    ],
    "safe": [
      {
        "file": "app/api/chat/route.ts",
        "code": "const key = process.env.OPENAI_API_KEY;",
        "note": "route handlers run on the server"
      },
      {
        "file": "app/api/chat/route.ts",
        "code": "return Response.json({ ok: Boolean(key) });",
        "note": "Boolean(key) });"
      },
      {
        "file": "app/components/Chat.tsx",
        "code": "const site = process.env.NEXT_PUBLIC_SITE_URL;",
        "note": "public prefix"
      }
    ]
  },
  "secret/in-prompt": {
    "flagged": [],
    "safe": []
  },
  "secret/in-tool-output": {
    "flagged": [],
    "safe": []
  },
  "secret/read-sensitive-file": {
    "flagged": [],
    "safe": []
  },
  "integrity/invalid-suppression": {
    "flagged": [],
    "safe": []
  },
  "integrity/unused-suppression": {
    "flagged": [],
    "safe": []
  }
};
