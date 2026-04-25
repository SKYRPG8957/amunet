# Supabase Backend

Supabase is the primary hosted backend path for Amunet.

It handles:

- Auth and profiles
- Postgres cache for world sessions
- Host presence cache
- Provider snapshots
- Edge Function API for the public world feed and join URI generation

It does not handle:

- Bedrock UDP ping
- LAN/Friends bridge
- `prismarine-auth` Xbox device-code login

Those need a Node helper or VPS because Supabase Edge Functions are short-lived
HTTP functions, not long-running UDP processes.

## Database

Run this SQL in the Supabase SQL editor:

```bash
supabase/migrations/202604250001_initial_schema.sql
```

The important cache tables are:

- `world_sessions`
- `host_presence`
- `provider_snapshots`

## Edge Function

Function path:

```bash
supabase/functions/amunet-api/index.ts
```

Deploy:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy amunet-api
```

Set function secrets:

```bash
npx supabase secrets set AMUNET_FEED_URL=https://eggnet.space/api/servers/list3
npx supabase secrets set AMUNET_PRESENCE_URL=https://eggnet.space/api/hosts/presence
npx supabase secrets set AMUNET_SUPABASE_STALE_MS=120000
npx supabase secrets set AMUNET_SUPABASE_FEED_LIMIT=900
npx supabase secrets set AMUNET_SUPABASE_RETENTION_MS=21600000
```

Supabase automatically provides:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Frontend Env

Build the web app with:

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_ANON_KEY
VITE_STATUS_API_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/amunet-api
```

Then the frontend calls:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/amunet-api/api/worlds/live
https://YOUR_PROJECT_REF.supabase.co/functions/v1/amunet-api/api/join/simple
```

## API Routes

Implemented on Supabase Edge:

- `GET /api/health`
- `GET /api/worlds/live`
- `GET /api/worlds/eggnet`
- `GET|POST /api/join/simple`
- `GET /api/community/presence`
- `GET /api/targets/featured`

Unsupported on Supabase Edge:

- `/api/status/bedrock`
- `/api/bridge/*`
- `/api/xbox/*`

The frontend reads `/api/health` capabilities and disables unsupported buttons
when running in Supabase Edge mode.

## Free-Tier Guard

For a public deployment, put Cloudflare Worker/KV in front of this function and
use `docs/FREE_SCALE.md`. The Edge Function also ignores public `force=1`
refreshes unless `AMUNET_ADMIN_REFRESH_KEY` is set and the request includes a
matching `x-amunet-admin-key` header.
