# Free Hosting Options

This project is built so the same frontend can run on several free static hosts.
For a real public service, keep Cloudflare Worker/KV in front of Supabase unless
traffic is tiny.

## Recommended Production Path

```text
Cloudflare Pages
  -> same-origin /api/*
  -> Cloudflare Worker + KV free guard
  -> Supabase Edge Function only on cache miss
  -> Supabase Postgres cache
```

Why this is the default:

- Static frontend traffic stays on Cloudflare Pages.
- `/api/worlds/live` and `/api/community/presence` are cached at the edge.
- Unknown `/api/*` routes are blocked by default.
- Supabase upstream calls stop at `MAX_SUPABASE_UPSTREAM_PER_DAY`.
- If the budget is spent, stale KV data is returned before failing with `429`.

Deploy:

```bash
npx wrangler kv namespace create AMUNET_LIMITS
npx wrangler kv namespace create AMUNET_LIMITS --preview
npm run supabase:functions:deploy
npm run cloudflare:deploy
npm run cloudflare:pages:deploy
```

GitHub Actions workflow:

```text
.github/workflows/deploy-cloudflare.yml
```

Required GitHub secrets:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

Optional GitHub variable:

```text
CLOUDFLARE_PAGES_PROJECT=amunet
```

## Static Host Alternatives

These are valid when the frontend host is free, but `/api/*` should still point
to the Worker or Supabase function.

| Host | Backend setting | Notes |
| --- | --- | --- |
| GitHub Pages | `VITE_STATUS_API_URL=https://YOUR_WORKER.workers.dev` | Cheapest static fallback. Use the included Pages workflow. |
| Netlify | `VITE_STATUS_API_URL=https://YOUR_WORKER.workers.dev` | `netlify.toml` and `public/_redirects` are included. |
| Vercel | `VITE_STATUS_API_URL=https://YOUR_WORKER.workers.dev` | `vercel.json` is included. Force static builds only. |
| Cloudflare Pages | `VITE_STATUS_API_URL=` | Best path because `/api/*` can be same-origin Worker routes. |
| Supabase direct | `VITE_STATUS_API_URL=https://PROJECT.supabase.co/functions/v1/amunet-api` | Use only for small tests; it bypasses the Worker budget guard. |

GitHub Pages deploy workflow:

```text
.github/workflows/deploy-github-pages.yml
```

Set this repository variable when using GitHub Pages, Netlify, or Vercel:

```text
VITE_STATUS_API_URL=https://YOUR_WORKER_SUBDOMAIN.workers.dev
```

## Free-Limit Rules

- Do not attach a paid billing method unless you intentionally want overage.
- Keep Supabase Spend Cap enabled if your plan supports it.
- Keep `ALLOW_API_PROXY=0`.
- Keep `ALLOW_FORCE_REFRESH=0` publicly.
- Keep `DISABLE_JOIN_UPSTREAM=1`.
- Keep `REQUIRE_KV_GUARD=1`.
- Keep media and avatars out of Supabase Storage unless you add a separate quota
  plan.
- Use the Worker route fail mode as fail closed for `/api/*`.

## Service-Ready Checklist

Before sharing the link publicly:

1. Supabase migration is applied.
2. `amunet-api` Edge Function is deployed.
3. Cloudflare KV IDs in `wrangler.toml` are real, not placeholders.
4. Worker deploy succeeds and `/api/health` returns `Amunet Cloudflare Edge Cache`.
5. Pages build has `VITE_STATUS_API_URL=` for same-origin Worker routing.
6. `https://YOUR_DOMAIN/api/worlds/live` returns cached worlds.
7. `https://YOUR_DOMAIN/api/unknown` returns `UNKNOWN_API_BLOCKED`.
8. `https://YOUR_DOMAIN/api/worlds/live?force=1` does not refresh unless the
   admin key header matches.
9. Public `https://YOUR_DOMAIN/` does not show the admin console.
10. Operator-only `https://YOUR_DOMAIN/admin` shows the console, and force
    refresh still requires the admin key.

## What Still Needs Non-Free Compute

Supabase Edge Functions and static hosts cannot run long-lived UDP services.
These features need a Node helper, VPS, home server, or a separate native app:

- Bedrock UDP ping
- LAN/Friends bridge
- Xbox device-code login through `prismarine-auth`

The public web service remains usable without them because Eggnet-compatible
world listing and `minecraft://activityHandleJoin/?handle=...` joining are HTTP
only.
