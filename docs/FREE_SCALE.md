# Free-Tier Lockdown Plan

The goal is not "infinite free traffic"; that does not exist. The goal is to
keep the public runtime inside free-tier guardrails by default, and to fail
closed when a guard is missing or a daily budget is spent.

For alternate static hosts, see `docs/FREE_DEPLOY_OPTIONS.md`.

## Request Path

```text
User browser
  -> Cloudflare Pages static app
  -> Cloudflare Worker /api cache
  -> Supabase Edge Function only on cache miss
  -> Supabase Postgres cache
  -> Eggnet-compatible feed only on refresh
```

This means most users never hit Supabase directly.

## Layers Added

1. Browser localStorage cache
   - `worlds/live`: 45 seconds
   - `community/presence`: 120 seconds

2. Cloudflare Worker edge cache
   - `worlds/live`: 300 seconds
   - `community/presence`: 600 seconds
   - `targets/featured`, `health`, handle-only `join/simple`: handled without Supabase
   - unknown `/api/*` proxying is blocked by default
   - public `force=1` refresh is ignored unless an admin key is configured
   - Supabase upstream calls stop after `MAX_SUPABASE_UPSTREAM_PER_DAY`
   - stale KV data is returned when the daily budget is spent

3. Supabase Postgres cache
   - stores `world_sessions`
   - refreshes from Eggnet only when cache is stale/missing
   - prunes old Eggnet rows after `AMUNET_SUPABASE_RETENTION_MS`
   - direct public `force=1` refresh is also ignored unless the admin key matches

Current official references:

- Cloudflare Workers Free plan has a daily Worker request limit. See
  <https://developers.cloudflare.com/workers/platform/limits/>.
- Cloudflare Workers KV Free plan has daily read/write limits. See
  <https://developers.cloudflare.com/kv/platform/limits/>.
- Supabase Edge Functions Free plan includes a fixed invocation quota. See
  <https://supabase.com/docs/guides/functions/pricing>.

## Deploy Cloudflare Worker

Create the KV namespace first. This is required for the hard free-tier guards:

```bash
npx wrangler kv namespace create AMUNET_LIMITS
npx wrangler kv namespace create AMUNET_LIMITS --preview
```

Edit `wrangler.toml`:

```toml
SUPABASE_API_BASE = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/amunet-api"
MAX_SUPABASE_UPSTREAM_PER_DAY = "400"
MAX_REQUESTS_PER_IP_PER_HOUR = "0"
ALLOW_FORCE_REFRESH = "0"
ALLOW_API_PROXY = "0"
DISABLE_JOIN_UPSTREAM = "1"
REQUIRE_KV_GUARD = "1"
USE_KV_REFRESH_LOCK = "0"

[[kv_namespaces]]
binding = "AMUNET_LIMITS"
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_KV_NAMESPACE_ID"
```

If `REQUIRE_KV_GUARD=1` and the KV binding is missing, the Worker refuses to
call Supabase upstream. That is intentional.

`MAX_REQUESTS_PER_IP_PER_HOUR` and `USE_KV_REFRESH_LOCK` are disabled by
default because they spend KV writes. Turn them on only after abuse starts and
lower `MAX_SUPABASE_UPSTREAM_PER_DAY` accordingly.

Deploy:

```bash
npx wrangler login
npm run cloudflare:deploy
```

Route it to your frontend domain:

```text
your-domain.com/api/*
```

Then the frontend can leave `VITE_STATUS_API_URL` empty and call same-origin
`/api/...`, which Cloudflare handles.

## Frontend Hosting

Cloudflare Pages is preferred for the free path.

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Environment variables:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_STATUS_API_URL=
```

If you do not use a same-origin Worker route, set:

```bash
VITE_STATUS_API_URL=https://YOUR_WORKER_SUBDOMAIN.workers.dev
```

## Cost Controls

- Keep `AMUNET_SUPABASE_FEED_LIMIT` around `900`.
- Keep world retention short, e.g. 6 hours: `AMUNET_SUPABASE_RETENTION_MS=21600000`.
- Keep `ALLOW_API_PROXY=0`; only explicitly supported API routes should exist.
- Keep `ALLOW_FORCE_REFRESH=0` publicly. If manual refresh is needed, set a
  Worker secret named `ADMIN_REFRESH_KEY` and a Supabase secret named
  `AMUNET_ADMIN_REFRESH_KEY`, then send `x-amunet-admin-key`.
- Keep `DISABLE_JOIN_UPSTREAM=1`; joining by `handleId` does not need Supabase.
- Do not proxy avatars or media through Supabase.
- Put Cloudflare WAF/rate rules in front of `/api/*` if the app is public.
- Keep `--no-verify-jwt` only for read-only public endpoints.

Useful secret commands:

```bash
npx wrangler secret put ADMIN_REFRESH_KEY
npx supabase secrets set AMUNET_ADMIN_REFRESH_KEY=your-long-random-key
```

## Failure Behavior

- If the edge cache is fresh, users get a cache hit.
- If the edge cache is stale and the Supabase daily budget remains, one request
  refreshes it while other users receive stale KV data.
- If the Supabase daily budget is spent, users receive stale KV data.
- If no stale data exists, users receive `429` instead of spending more upstream
  calls.
- If the KV guard is missing, cache-refreshing endpoints return `503`.

## What Still Costs Eventually

If the service becomes large enough, one of these will run out:

- Cloudflare Worker daily/monthly request limits
- Supabase Edge Function invocations
- Supabase database size/egress
- Abuse-defense budget

This setup delays that point, but it does not make a large public platform
literally free forever.
