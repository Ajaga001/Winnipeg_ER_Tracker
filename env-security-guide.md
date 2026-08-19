# Environment Variable Security Guide
## Manitoba ER Wait Times Project

This doc covers every place a secret could leak and how to stop it.
Three environments to think about: **local dev**, **backend API (Node)**, **frontend (Vite/React)**.

---

## The Golden Rule

> A secret that reaches the browser is a public secret.

Supabase gives you two keys:
- `anon` key — safe to expose in the browser (RLS protects data)
- `service_role` key — bypasses RLS, **never goes near the frontend**

---

## 1. Local Development

### File layout
```
mb-er-tracker/
├── api/
│   ├── .env              ← API secrets (git-ignored)
│   └── .env.example      ← committed template (no real values)
└── frontend/
    ├── .env.local        ← Vite secrets (git-ignored)
    └── .env.example      ← committed template
```

### `api/.env` — server-side only, never committed
```bash
# Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...   # service_role

# API config
PORT=4000
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:5173
```

### `frontend/.env.local` — Vite dev, never committed
```bash
# ONLY the anon key goes here — safe because Supabase RLS controls access
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...  # anon key

# Points to your local API server
VITE_API_BASE_URL=http://localhost:4000
```

### Why `VITE_` prefix matters
Vite statically replaces `import.meta.env.VITE_*` at build time.
Any variable WITHOUT the `VITE_` prefix is **invisible to the browser bundle** — use this for anything you never want exposed:

```js
// ✅ Safe – never reaches the browser
const secret = process.env.SUPABASE_SERVICE_KEY;

// ⚠️  Will be baked into the JS bundle
const exposed = import.meta.env.VITE_SUPABASE_ANON_KEY;
```

---

## 2. `.gitignore` — stop secrets reaching GitHub

Add this to your root `.gitignore` before your first `git push`:

```gitignore
# Environment files – all variants
.env
.env.local
.env.*.local
.env.development
.env.production

# Python scraper
__pycache__/
*.pyc
.venv/

# Node
node_modules/
dist/

# Logs
logs/
*.log
```

**Run this to verify nothing secret is tracked:**
```bash
git ls-files | grep -E "\.env$|\.env\." 
# Should return nothing. If it does, run:
git rm --cached .env
```

---

## 3. Netlify — Frontend Environment Variables

### Setting variables in Netlify UI
1. Open your site → **Site configuration → Environment variables**
2. Add each variable with the `VITE_` prefix:

| Key | Value | Scopes |
|-----|-------|--------|
| `VITE_SUPABASE_URL` | `https://xyz.supabase.co` | All deploys |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` (anon key only) | All deploys |
| `VITE_API_BASE_URL` | `https://your-api.render.com` | All deploys |

**Never add `SUPABASE_SERVICE_KEY` here** — it would end up in the JS bundle.

### Via Netlify CLI (repeatable, scriptable)
```bash
npm install -g netlify-cli
netlify link   # connects to your site

netlify env:set VITE_SUPABASE_URL "https://xyz.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "eyJ..."
netlify env:set VITE_API_BASE_URL "https://your-api.render.com"

# Verify (shows keys, not values)
netlify env:list
```

---

## 4. Backend API — Render/Railway Environment Variables

Your Node API should be deployed separately (Render free tier works).
Set variables in the Render dashboard under **Environment**:

| Key | Value |
|-----|-------|
| `SUPABASE_URL` | `https://xyz.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key |
| `PORT` | `4000` |
| `NODE_ENV` | `production` |
| `FRONTEND_ORIGIN` | `https://your-site.netlify.app` |

No `VITE_` prefix — these are Node env vars, never sent to the browser.

---

## 5. Accessing Variables in Code

### Node (API server)
```js
// api/server.js
import dotenv from "dotenv";
dotenv.config(); // loads api/.env in development; ignored on Render (uses dashboard vars)

const supabase = createClient(
  process.env.SUPABASE_URL,          // ✅ server-side only
  process.env.SUPABASE_SERVICE_KEY   // ✅ never exposed to browser
);
```

### Vite/React (Frontend)
```js
// frontend/src/lib/supabase.js
import { createClient } from "@supabase/supabase-js";

// import.meta.env is Vite's env object — only VITE_* vars are available here
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase env variables. Check your .env.local file.");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

```js
// frontend/src/lib/api.js
// All calls to your Express API go through this wrapper
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

export async function fetchLatestWaitTimes() {
  const res = await fetch(`${API_BASE}/api/wait-times/latest`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

export async function fetchTrends(hours = 24) {
  const res = await fetch(`${API_BASE}/api/wait-times/trends?hours=${hours}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
```

---

## 6. Pre-deploy Security Checklist

Run through this before every deploy:

```bash
# 1. No .env files tracked in git
git ls-files | grep "\.env" && echo "⚠️  LEAK RISK" || echo "✅ Clean"

# 2. No hardcoded keys in source (searches for Supabase JWT prefix)
grep -r "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" src/ api/ scraper/ \
  && echo "⚠️  HARDCODED KEY FOUND" || echo "✅ No hardcoded keys"

# 3. Build the frontend and confirm service key is absent from the bundle
npm run build
grep -r "service_role\|SUPABASE_SERVICE_KEY" dist/ \
  && echo "⚠️  SERVICE KEY IN BUNDLE" || echo "✅ Bundle is clean"
```

---

## 7. If a Key Gets Leaked

1. **Rotate immediately** — Supabase dashboard → Settings → API → Regenerate key
2. Update the value in Netlify/Render env vars
3. Redeploy both frontend and API
4. If the repo is public: assume the key was compromised the moment it was pushed — rotation is the only fix
