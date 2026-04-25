const FEATURED_TARGETS = [
  {
    id: 'nethergames',
    name: 'NetherGames',
    host: 'play.nethergames.org',
    port: 19132,
    region: 'Global',
    language: 'en',
    category: 'Public Server',
    tags: ['minigame', 'pvp', 'skywars'],
  },
  {
    id: 'cubecraft',
    name: 'CubeCraft',
    host: 'mco.cubecraft.net',
    port: 19132,
    region: 'Global',
    language: 'en',
    category: 'Public Server',
    tags: ['featured', 'minigame', 'party'],
  },
  {
    id: 'hive',
    name: 'The Hive',
    host: 'geo.hivebedrock.network',
    port: 19132,
    region: 'Global',
    language: 'en',
    category: 'Public Server',
    tags: ['bedwars', 'skywars', 'arcade'],
  },
];

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-amunet-admin-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function buildJoinUri(handleId) {
  return `minecraft://activityHandleJoin/?handle=${encodeURIComponent(handleId)}`;
}

function cacheSecondsFor(pathname, env) {
  if (pathname === '/api/worlds/live' || pathname === '/api/worlds/eggnet') {
    return Number(env.WORLDS_CACHE_SECONDS || 30);
  }

  if (pathname === '/api/community/presence') {
    return Number(env.PRESENCE_CACHE_SECONDS || 120);
  }

  return Number(env.SHORT_CACHE_SECONDS || 60);
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hourKey() {
  return new Date().toISOString().slice(0, 13);
}

async function hashText(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function kvGetJson(env, key) {
  if (!env.AMUNET_LIMITS) return null;

  try {
    const value = await env.AMUNET_LIMITS.get(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

async function kvPutJson(env, key, value, options = {}) {
  if (!env.AMUNET_LIMITS) return;
  await env.AMUNET_LIMITS.put(key, JSON.stringify(value), options);
}

async function incrementKvCounter(env, key, ttlSeconds) {
  if (!env.AMUNET_LIMITS) return 0;
  const current = Number((await env.AMUNET_LIMITS.get(key)) || 0);
  const next = current + 1;
  await env.AMUNET_LIMITS.put(key, String(next), { expirationTtl: ttlSeconds });
  return next;
}

async function enforceIpBudget(request, env, pathname) {
  const limit = Number(env.MAX_REQUESTS_PER_IP_PER_HOUR || 0);
  if (!limit || !env.AMUNET_LIMITS || !pathname.startsWith('/api/')) {
    return null;
  }

  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const hash = (await hashText(ip)).slice(0, 20);
  const count = await incrementKvCounter(env, `ip:${hourKey()}:${hash}`, 7200);

  if (count > limit) {
    return json(
      {
        ok: false,
        error: '무료 한도 보호를 위해 요청이 일시 제한되었습니다.',
        retryAfterSeconds: 3600,
      },
      429,
      {
        'Retry-After': '3600',
        'X-Amunet-Free-Guard': 'IP_HOURLY_CAP',
      },
    );
  }

  return null;
}

async function takeSupabaseBudget(env) {
  const max = Number(env.MAX_SUPABASE_UPSTREAM_PER_DAY || 400);
  if (!env.AMUNET_LIMITS) return { ok: true, count: 0, max, untracked: true };

  const key = `upstream:supabase:${todayKey()}`;
  const current = Number((await env.AMUNET_LIMITS.get(key)) || 0);
  if (current >= max) {
    return { ok: false, count: current, max, untracked: false };
  }

  const next = await incrementKvCounter(env, key, 172800);
  return { ok: true, count: next, max, untracked: false };
}

function requiresKvGuard(env) {
  return (env.REQUIRE_KV_GUARD ?? '1') !== '0' && !env.AMUNET_LIMITS;
}

function normalizedCacheKey(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  url.searchParams.delete('force');
  return `cache:${url.pathname}:${url.searchParams.toString()}`;
}

async function readKvCache(env, key, maxAgeMs, allowExpired = false) {
  const item = await kvGetJson(env, key);
  if (!item?.body) return null;

  const ageMs = Date.now() - Number(item.savedAtMs || 0);
  if (!allowExpired && ageMs > maxAgeMs) return null;

  return { ...item, ageMs };
}

async function writeKvCache(env, key, responseText, status, contentType, ttlSeconds) {
  await kvPutJson(
    env,
    key,
    {
      savedAtMs: Date.now(),
      status,
      contentType,
      body: responseText,
    },
    { expirationTtl: Math.max(ttlSeconds * 12, 3600) },
  );
}

function responseFromKv(item, cacheStatus) {
  return new Response(item.body, {
    status: item.status || 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': item.contentType || 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'X-Amunet-Edge-Cache': cacheStatus,
      'X-Amunet-Cache-Age-Ms': String(item.ageMs || 0),
    },
  });
}

async function acquireRefreshLock(env, key) {
  if (!env.AMUNET_LIMITS || env.USE_KV_REFRESH_LOCK !== '1') return true;
  const lockKey = `lock:${key}`;
  const locked = await env.AMUNET_LIMITS.get(lockKey);
  if (locked) return false;
  await env.AMUNET_LIMITS.put(lockKey, '1', { expirationTtl: 20 });
  return true;
}

function upstreamBase(env) {
  const base = env.SUPABASE_API_BASE || '';
  if (!base) {
    throw new Error('SUPABASE_API_BASE is not configured');
  }
  return base.replace(/\/$/, '');
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function handleJoin(request) {
  const url = new URL(request.url);
  const body = request.method === 'POST' ? await parseJsonBody(request) : {};
  const handleId = String(
    body.handleId || body.handle || url.searchParams.get('handleId') || url.searchParams.get('handle') || '',
  ).trim();

  if (handleId) {
    return json({
      ok: true,
      mode: 'cloudflare_handle',
      handleId,
      joinUri: buildJoinUri(handleId),
      ts: Date.now(),
    });
  }

  return null;
}

function directHealth() {
  return json(
    {
      ok: true,
      product: 'Luma Cloudflare Edge Cache',
      bridge: { running: false, target: null, bridgePort: 19132, version: '', lanAddresses: [], clients: [], events: [] },
      xbox: {
        signedIn: false,
        xuid: null,
        expiresOn: null,
        pending: false,
        code: null,
        verificationUri: null,
        message: null,
        error: null,
      },
      providers: { eggnet: true, xboxSessionDirectory: false },
      capabilities: {
        supabaseCache: true,
        supabaseEdge: true,
        static: true,
        bridge: false,
        xboxLogin: false,
        bedrockPing: false,
      },
    },
    200,
    { 'Cache-Control': 'public, max-age=60' },
  );
}

function directDiscover() {
  return json(
    {
      ok: true,
      source: 'cloudflare_edge',
      count: 0,
      requiresLogin: true,
      worlds: [],
    },
    200,
    { 'Cache-Control': 'public, max-age=60' },
  );
}

function directUnsupported(name) {
  return json(
    {
      ok: false,
      error: `${name}은 무료 Edge 모드에서 비활성화했습니다.`,
    },
    501,
    { 'X-Amunet-Free-Guard': 'UNSUPPORTED_EDGE_FEATURE' },
  );
}

async function proxyCached(request, env, ctx, pathname) {
  if (requiresKvGuard(env)) {
    return json(
      {
        ok: false,
        error: '무료 한도 보호 KV가 설정되지 않아 Supabase upstream 호출을 차단했습니다.',
      },
      503,
      { 'X-Amunet-Free-Guard': 'KV_GUARD_REQUIRED' },
    );
  }

  const url = new URL(request.url);
  const forceRequested = url.searchParams.get('force') === '1';
  const force =
    forceRequested &&
    env.ALLOW_FORCE_REFRESH === '1' &&
    env.ADMIN_REFRESH_KEY &&
    request.headers.get('x-amunet-admin-key') === env.ADMIN_REFRESH_KEY;
  if (forceRequested && !force) {
    url.searchParams.delete('force');
  }
  const ttl = cacheSecondsFor(pathname, env);
  const kvKey = normalizedCacheKey(request, pathname);
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete('force');
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
  const cache = caches.default;

  if (!force) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const response = new Response(cached.body, cached);
      response.headers.set('X-Amunet-Edge-Cache', 'HIT');
      return response;
    }
  }

  const kvFresh = !force ? await readKvCache(env, kvKey, ttl * 1000) : null;

  if (kvFresh) {
    return responseFromKv(kvFresh, 'KV-HIT');
  }

  const kvStale = !force ? await readKvCache(env, kvKey, Number(env.STALE_FALLBACK_SECONDS || 86400) * 1000, true) : null;
  const hasLock = await acquireRefreshLock(env, kvKey);
  if (!hasLock && kvStale) {
    return responseFromKv(kvStale, 'KV-STALE-LOCK');
  }

  const budget = await takeSupabaseBudget(env);
  if (!budget.ok) {
    if (kvStale) {
      const response = responseFromKv(kvStale, 'KV-STALE-BUDGET-CAP');
      response.headers.set('X-Amunet-Free-Guard', 'SUPABASE_DAILY_CAP');
      response.headers.set('X-Amunet-Supabase-Upstream-Count', String(budget.count));
      return response;
    }

    return json(
      {
        ok: false,
        error: 'Supabase 무료 호출 예산을 넘겨서 오늘은 새 데이터를 가져오지 않습니다.',
        cap: budget.max,
        count: budget.count,
      },
      429,
      {
        'Retry-After': '3600',
        'X-Amunet-Free-Guard': 'SUPABASE_DAILY_CAP',
      },
    );
  }

  const upstreamUrl = `${upstreamBase(env)}${pathname}${url.search}`;
  const upstream = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  const responseText = await upstream.text();
  const headers = new Headers(upstream.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', `public, max-age=${ttl}, stale-while-revalidate=${Math.max(ttl * 4, 120)}`);
  headers.set('X-Amunet-Edge-Cache', 'MISS');
  headers.set('X-Amunet-Supabase-Upstream-Count', String(budget.count));
  const finalResponse = new Response(responseText, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });

  if (upstream.ok && request.method === 'GET') {
    ctx.waitUntil(cache.put(cacheKey, finalResponse.clone()));
    ctx.waitUntil(writeKvCache(env, kvKey, responseText, upstream.status, headers.get('Content-Type'), ttl));
  }

  if (!upstream.ok && kvStale) {
    return responseFromKv(kvStale, 'KV-STALE-UPSTREAM-ERROR');
  }

  return finalResponse;
}

async function proxy(request, env, pathname) {
  const url = new URL(request.url);
  const upstreamUrl = `${upstreamBase(env)}${pathname}${url.search}`;
  return fetch(upstreamUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return directHealth();
      }

      if (request.method === 'GET' && pathname === '/api/targets/featured') {
        return json({ ok: true, targets: FEATURED_TARGETS }, 200, { 'Cache-Control': 'public, max-age=3600' });
      }

      if (request.method === 'GET' && pathname === '/api/worlds/discover') {
        return directDiscover();
      }

      if (pathname.startsWith('/api/status/bedrock')) {
        return directUnsupported('Bedrock UDP ping');
      }

      if (pathname.startsWith('/api/bridge/')) {
        return directUnsupported('LAN/Friends bridge');
      }

      if (pathname.startsWith('/api/xbox/')) {
        return directUnsupported('Xbox device-code login');
      }

      if ((request.method === 'GET' || request.method === 'POST') && pathname === '/api/join/simple') {
        const direct = await handleJoin(request.clone());
        if (direct) return direct;
        if (env.DISABLE_JOIN_UPSTREAM !== '0') {
          return json(
            {
              ok: false,
              error: '무료 모드에서는 handleId 없는 join 조회를 비활성화했습니다.',
            },
            400,
            { 'X-Amunet-Free-Guard': 'JOIN_UPSTREAM_DISABLED' },
          );
        }
        return proxy(request, env, pathname);
      }

      const limited = await enforceIpBudget(request, env, pathname);
      if (limited) return limited;

      if (
        request.method === 'GET' &&
        (pathname === '/api/worlds/live' || pathname === '/api/worlds/eggnet' || pathname === '/api/community/presence')
      ) {
        return proxyCached(request, env, ctx, pathname);
      }

      if (pathname.startsWith('/api/')) {
        if (env.ALLOW_API_PROXY !== '1') {
          return json(
            {
              ok: false,
              error: '무료 보호 모드에서는 등록되지 않은 API 프록시를 차단합니다.',
            },
            404,
            { 'X-Amunet-Free-Guard': 'UNKNOWN_API_BLOCKED' },
          );
        }
        return proxy(request, env, pathname);
      }

      return json({ ok: false, error: 'Not found' }, 404);
    } catch (error) {
      return json({ ok: false, error: error instanceof Error ? error.message : 'request failed' }, 500);
    }
  },
};
