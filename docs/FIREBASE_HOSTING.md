# Firebase Hosting

Firebase Hosting is used only for the static web app. Supabase remains the
backend for Auth, Postgres, and Edge Functions.

## Required Firebase Project

Create or select a Firebase project. This workspace is configured for:

```text
luma-arcade-skyrpg8957
```

If you use another project id, update `.firebaserc`.

```json
{
  "projects": {
    "default": "YOUR_FIREBASE_PROJECT_ID"
  }
}
```

## Deploy

```bash
npx firebase-tools login
npx firebase-tools use luma-arcade-skyrpg8957
npm run firebase:deploy
```

The app must be built with these environment variables:

```text
VITE_SUPABASE_URL=https://qozyhwylyimgrquhennv.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable__4_DyWUHQkjGkIUWldkjaw_7NDhcarH
VITE_STATUS_API_URL=https://qozyhwylyimgrquhennv.supabase.co/functions/v1/amunet-api
```

The deploy URL will look like:

```text
https://luma-arcade-skyrpg8957.web.app
https://luma-arcade-skyrpg8957.firebaseapp.com
```
