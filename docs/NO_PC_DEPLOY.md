# No-PC Deployment

This is the production shape when your computer is off:

```text
User browser
  -> Cloudflare Pages static web app
  -> Cloudflare Worker /api cache and free-tier guard
  -> Supabase Edge Function amunet-api only on cache miss
  -> Supabase Postgres cache
  -> Eggnet-compatible feed
```

Your PC is not part of the request path.

## 1. Create Supabase Project

Create a Supabase project and copy:

- Project ref
- Project URL
- anon public key

## 2. Push Database

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

If `db push` asks for a database password, use the DB password from the
Supabase project settings.

## 3. Deploy Edge API

```bash
npx supabase secrets set AMUNET_FEED_URL=https://eggnet.space/api/servers/list3
npx supabase secrets set AMUNET_PRESENCE_URL=https://eggnet.space/api/hosts/presence
npx supabase secrets set AMUNET_SUPABASE_STALE_MS=120000
npx supabase secrets set AMUNET_SUPABASE_FEED_LIMIT=900
npx supabase secrets set AMUNET_SUPABASE_RETENTION_MS=21600000
npm run supabase:functions:deploy
```

Your API base becomes:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/amunet-api
```

## 4. Deploy Cloudflare Worker

Use `docs/FREE_SCALE.md` for the Worker/KV setup. This is the preferred no-PC
path because it keeps most traffic away from Supabase.

## 5. Deploy Frontend

Use Cloudflare Pages for the strongest free path.

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

Leaving `VITE_STATUS_API_URL` empty makes the app call same-origin `/api/*`,
which the Cloudflare Worker handles.

## 6. Test After Turning Off Your PC

Open the deployed frontend URL from your phone or another device.

Expected:

- server list loads
- provider shows `Eggnet`
- join button opens/copies `minecraft://activityHandleJoin/?handle=...`
- profile Supabase login works

Expected disabled:

- LAN/Friends bridge
- Bedrock UDP ping
- Xbox device-code login from the Edge backend

Those disabled items need a Node helper because Supabase Edge Functions are HTTP
functions, not long-running UDP processes.
