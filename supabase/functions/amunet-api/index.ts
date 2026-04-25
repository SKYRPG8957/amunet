import { createClient } from 'npm:@supabase/supabase-js@2';

type JsonMap = Record<string, unknown>;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-amunet-admin-key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const eggnetFeedUrl = Deno.env.get('AMUNET_FEED_URL') ?? 'https://eggnet.space/api/servers/list3';
const eggnetPresenceUrl = Deno.env.get('AMUNET_PRESENCE_URL') ?? 'https://eggnet.space/api/hosts/presence';
const cacheStaleMs = Number(Deno.env.get('AMUNET_SUPABASE_STALE_MS') ?? 120_000);
const feedLimit = Number(Deno.env.get('AMUNET_SUPABASE_FEED_LIMIT') ?? 900);
const retentionMs = Number(Deno.env.get('AMUNET_SUPABASE_RETENTION_MS') ?? 21_600_000);
const adminRefreshKey = Deno.env.get('AMUNET_ADMIN_REFRESH_KEY') ?? Deno.env.get('ADMIN_REFRESH_KEY') ?? '';

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const featuredTargets = [
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

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanMinecraftText(value: unknown) {
  return String(value || '').replace(/§./g, '').trim();
}

function parseJsonNote(note: unknown): JsonMap {
  if (!note || typeof note !== 'string') return {};

  try {
    return JSON.parse(note) as JsonMap;
  } catch {
    return {};
  }
}

function buildJoinUri(handleId: string) {
  return `minecraft://activityHandleJoin/?handle=${encodeURIComponent(handleId)}`;
}

function nullableXuid(value: unknown) {
  const xuid = String(value || '').trim();
  return /^[0-9]{6,20}$/.test(xuid) ? xuid : null;
}

function normalizeGamertag(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeEggnetWorld(entry: JsonMap) {
  const note = parseJsonNote(entry.note);
  const world = (note.world || {}) as JsonMap;
  const handle = (world.handle || {}) as JsonMap;
  const languageSchema = (entry.languageSchema || {}) as JsonMap;
  const handleId = String(handle.handleId || entry.handleId || entry.activityHandleId || '').trim();

  if (!handleId) return null;

  const title = cleanMinecraftText(entry.title || handle.worldName || 'Minecraft World');
  const ownerGamertag = String(entry.ownerGamertag || ((note.host || {}) as JsonMap).gamertag || '');
  const hostName = String(entry.hostName || handle.hostName || ownerGamertag || '');

  return {
    id: String(entry.serverId || handleId),
    serverId: String(entry.serverId || ''),
    handleId,
    title,
    hostName,
    ownerXuid: String(entry.ownerXuid || handle.ownerId || handle.ownerXuid || ((note.host || {}) as JsonMap).xuid || ''),
    ownerGamertag,
    source: `eggnet:${String(entry.source || 'feed')}`,
    language: String(languageSchema.primary || 'unknown'),
    languages: Array.isArray(languageSchema.languages) ? languageSchema.languages : [],
    avatarTinyBase64: String(entry.avatar_tiny_b64 || ''),
    worldType: String(handle.worldType || entry.worldType || ''),
    version: String(handle.version || entry.version || ''),
    protocol: Number(handle.protocol || entry.protocol || 0),
    members: Number(handle.memberCount ?? handle.membersCount ?? entry.memberCount ?? entry.membersCount ?? 0),
    maxMembers: Number(handle.maxMemberCount ?? handle.maxMembersCount ?? entry.maxMemberCount ?? entry.maxMembersCount ?? 0),
    joinRestriction: String(handle.joinRestriction || entry.joinRestriction || ''),
    visibility: String(handle.visibility || entry.visibility || ''),
    nethernetId: String(entry.nethernetId || entry.netherNetId || handle.netherNetId || ''),
    closed: Boolean(handle.closed),
    updatedAtMs: Number(entry.updatedAtMs || Date.now()),
    uri: buildJoinUri(handleId),
  };
}

function worldSessionRow(world: ReturnType<typeof normalizeEggnetWorld> & JsonMap) {
  return {
    handle_id: world.handleId,
    owner_xuid: nullableXuid(world.ownerXuid),
    owner_gamertag: world.ownerGamertag || world.hostName || null,
    title: world.title || 'Minecraft World',
    world_type: world.worldType || null,
    version: world.version || null,
    protocol: Number(world.protocol || 0),
    member_count: Number(world.members || 0),
    max_member_count: Number(world.maxMembers || 0),
    join_restriction: world.joinRestriction || null,
    visibility: world.visibility || null,
    source: world.source || 'eggnet',
    raw: world,
  };
}

function rowToWorld(row: JsonMap) {
  const raw = ((row.raw || {}) as JsonMap);
  const handleId = String(row.handle_id || raw.handleId || '');

  return {
    id: String(raw.id || handleId),
    serverId: String(raw.serverId || ''),
    handleId,
    title: String(row.title || raw.title || 'Minecraft World'),
    hostName: String(raw.hostName || row.owner_gamertag || ''),
    ownerXuid: String(row.owner_xuid || raw.ownerXuid || ''),
    ownerGamertag: String(row.owner_gamertag || raw.ownerGamertag || ''),
    source: String(row.source || raw.source || 'supabase'),
    language: String(raw.language || 'unknown'),
    languages: Array.isArray(raw.languages) ? raw.languages : [],
    avatarTinyBase64: String(raw.avatarTinyBase64 || ''),
    avatarUrl: String(raw.avatarUrl || ''),
    worldType: String(row.world_type || raw.worldType || ''),
    version: String(row.version || raw.version || ''),
    protocol: Number(row.protocol || raw.protocol || 0),
    members: Number(row.member_count || raw.members || 0),
    maxMembers: Number(row.max_member_count || raw.maxMembers || 0),
    joinRestriction: String(row.join_restriction || raw.joinRestriction || ''),
    visibility: String(row.visibility || raw.visibility || ''),
    nethernetId: String(raw.nethernetId || ''),
    closed: Boolean(raw.closed),
    updatedAtMs: Number(raw.updatedAtMs || new Date(String(row.updated_at || Date.now())).getTime()),
    uri: buildJoinUri(handleId),
  };
}

async function readCachedWorlds() {
  const cutoff = new Date(Date.now() - cacheStaleMs).toISOString();
  const { data, error } = await supabase
    .from('world_sessions')
    .select(
      'handle_id,owner_xuid,owner_gamertag,title,world_type,version,protocol,member_count,max_member_count,join_restriction,visibility,source,raw,updated_at',
    )
    .gte('updated_at', cutoff)
    .order('member_count', { ascending: false })
    .limit(feedLimit);

  if (error) throw error;
  return (data ?? []).map((row) => rowToWorld(row as JsonMap));
}

async function refreshEggnetFeed() {
  const response = await fetch(eggnetFeedUrl, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();

  if (!response.ok || payload?.ok === false) {
    throw new Error(`Eggnet feed ${response.status}`);
  }

  const worlds = ((Array.isArray(payload.servers) ? payload.servers : []) as JsonMap[])
    .map((entry) => normalizeEggnetWorld(entry))
    .filter(Boolean) as Array<ReturnType<typeof normalizeEggnetWorld> & JsonMap>;

  if (worlds.length) {
    const { error } = await supabase.from('world_sessions').upsert(worlds.map((world) => worldSessionRow(world)), {
      onConflict: 'handle_id',
    });
    if (error) throw error;
  }

  await supabase
    .from('world_sessions')
    .delete()
    .like('source', 'eggnet:%')
    .lt('updated_at', new Date(Date.now() - retentionMs).toISOString());

  await supabase.from('provider_snapshots').upsert(
    {
      provider: 'eggnet',
      status: 'ok',
      item_count: worlds.length,
      payload: {
        source: payload.source || 'list3',
        mode: payload.mode || 'full',
        version: payload.version || 0,
        fetchedAtMs: Date.now(),
      },
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'provider' },
  );

  return worlds.sort((a, b) => Number(b.members || 0) - Number(a.members || 0));
}

function waitUntil(promise: Promise<unknown>) {
  const runtime = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  };
  runtime.EdgeRuntime?.waitUntil?.(promise);
}

async function worldsLive(req: Request) {
  const url = new URL(req.url);
  const force =
    url.searchParams.get('force') === '1' &&
    Boolean(adminRefreshKey) &&
    req.headers.get('x-amunet-admin-key') === adminRefreshKey;
  let worlds = force ? [] : await readCachedWorlds();
  let cache = worlds.length ? 'hit' : 'miss';

  if (!worlds.length || force) {
    worlds = await refreshEggnetFeed();
    cache = 'miss';
  } else {
    waitUntil(refreshEggnetFeed().catch((error) => console.error('background refresh failed', error)));
  }

  return json({
    ok: true,
    source: 'supabase_edge',
    mode: 'unified',
    cache,
    count: worlds.length,
    fetchedAtMs: Date.now(),
    providers: [
      {
        id: 'eggnet',
        name: 'Eggnet',
        ok: true,
        count: worlds.filter((world) => String(world.source || '').includes('eggnet')).length || worlds.length,
        error: null,
        requiresLogin: false,
      },
      {
        id: 'xbox-sessiondirectory',
        name: 'Luma Xbox',
        ok: true,
        count: 0,
        error: null,
        requiresLogin: true,
      },
    ],
    worlds,
  });
}

async function joinSimple(req: Request) {
  const url = new URL(req.url);
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  const handleId = String(body.handleId || body.handle || url.searchParams.get('handleId') || url.searchParams.get('handle') || '').trim();

  if (handleId) {
    return json({
      ok: true,
      mode: 'handle',
      handleId,
      joinUri: buildJoinUri(handleId),
      ts: Date.now(),
    });
  }

  const serverId = String(body.serverId || body.id || url.searchParams.get('serverId') || '').trim();
  if (!serverId) {
    return json({ ok: false, error: 'serverId 또는 handleId가 필요합니다.' }, 400);
  }

  const { data, error } = await supabase.from('world_sessions').select('handle_id,raw').contains('raw', { serverId }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.handle_id) {
    return json({ ok: false, error: '월드 세션을 찾을 수 없습니다.' }, 404);
  }

  return json({
    ok: true,
    mode: 'supabase_handle',
    serverId,
    handleId: data.handle_id,
    joinUri: buildJoinUri(data.handle_id),
    ts: Date.now(),
  });
}

async function communityPresence(req: Request) {
  const url = new URL(req.url);
  const force =
    url.searchParams.get('force') === '1' &&
    Boolean(adminRefreshKey) &&
    req.headers.get('x-amunet-admin-key') === adminRefreshKey;

  if (force) {
    const response = await fetch(eggnetPresenceUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json();
    const hosts = Array.isArray(payload.hosts) ? payload.hosts : [];
    const rows = hosts
      .map((host: JsonMap) => ({
        xuid: nullableXuid(host.xuid),
        gamertag: String(host.gamertag || ''),
        country: String(host.country || ''),
        presence: String(host.presence || 'unknown'),
        last_seen_ms: Number(host.lastSeenMs || 0),
        raw: host,
      }))
      .filter((host: JsonMap) => host.xuid);

    if (rows.length) {
      await supabase.from('host_presence').upsert(rows, { onConflict: 'xuid' });
    }

    return json({ ok: true, count: rows.length, hosts });
  }

  const { data, error } = await supabase
    .from('host_presence')
    .select('xuid,gamertag,country,presence,last_seen_ms')
    .order('last_seen_ms', { ascending: false })
    .limit(500);
  if (error) throw error;

  return json({
    ok: true,
    count: data?.length || 0,
    hosts: (data ?? []).map((host) => ({
      xuid: host.xuid,
      gamertag: host.gamertag,
      country: host.country,
      presence: host.presence,
      lastSeenMs: host.last_seen_ms,
    })),
  });
}

function profileCandidateScore(gamertag: string, query: string) {
  const value = normalizeGamertag(gamertag);
  if (!value || !query) return 0;
  if (value === query) return 100;
  if (value.replace(/\s/g, '') === query.replace(/\s/g, '')) return 95;
  if (value.startsWith(query)) return 75;
  if (value.includes(query)) return 45;
  return 0;
}

async function resolveXboxProfile(req: Request) {
  const url = new URL(req.url);
  const query = normalizeGamertag(url.searchParams.get('gamertag') || url.searchParams.get('q'));

  if (query.length < 2) {
    return json({ ok: false, error: '게이머태그를 2자 이상 입력하세요.' }, 400);
  }

  const worlds = await readCachedWorlds().catch(() => []);
  const liveWorlds = worlds.length ? worlds : await refreshEggnetFeed();
  const candidates = liveWorlds
    .map((world) => {
      const gamertag = String(world.ownerGamertag || world.hostName || '').trim();
      const xuid = nullableXuid(world.ownerXuid);
      const score = profileCandidateScore(gamertag, query);
      return {
        xuid,
        gamertag,
        source: String(world.source || 'world-feed'),
        title: String(world.title || ''),
        updatedAtMs: Number(world.updatedAtMs || 0),
        score,
      };
    })
    .filter((candidate) => candidate.xuid && candidate.gamertag && candidate.score > 0)
    .sort((a, b) => b.score - a.score || b.updatedAtMs - a.updatedAtMs);

  const unique = new Map<string, (typeof candidates)[number]>();
  for (const candidate of candidates) {
    if (candidate.xuid && !unique.has(candidate.xuid)) unique.set(candidate.xuid, candidate);
  }
  const matches = Array.from(unique.values()).slice(0, 8);

  if (!matches.length) {
    return json(
      {
        ok: false,
        error: '현재 공개 월드 피드에서 해당 게이머태그를 찾지 못했습니다.',
        query,
        matches: [],
      },
      404,
    );
  }

  return json({
    ok: true,
    query,
    profile: matches[0],
    matches,
    source: 'public-world-feed',
  });
}

function unsupported(name: string) {
  return json(
    {
      ok: false,
      error: `${name}은 Supabase Edge Function에서 실행할 수 없습니다. Node/VPS 헬퍼가 필요합니다.`,
    },
    501,
  );
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const functionPrefixIndex = url.pathname.indexOf('/amunet-api');
  const pathname =
    functionPrefixIndex >= 0
      ? url.pathname.slice(functionPrefixIndex + '/amunet-api'.length) || '/'
      : url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      return json({
        ok: true,
        product: 'Luma Edge API',
        bridge: { running: false, target: null, bridgePort: 19132, version: '', lanAddresses: [], clients: [], events: [] },
        xbox: { signedIn: false, xuid: null, expiresOn: null, pending: false, code: null, verificationUri: null, message: null, error: null },
        providers: { eggnet: true, xboxSessionDirectory: false },
        capabilities: {
          supabaseCache: true,
          supabaseEdge: true,
          static: false,
          bridge: false,
          xboxLogin: false,
          bedrockPing: false,
        },
      });
    }

    if (req.method === 'GET' && pathname === '/api/worlds/live') return worldsLive(req);
    if (req.method === 'GET' && pathname === '/api/worlds/eggnet') return worldsLive(req);
    if (req.method === 'GET' && pathname === '/api/worlds/discover') {
      return json({ ok: true, source: 'supabase_edge', count: 0, requiresLogin: true, worlds: [] });
    }
    if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/join/simple') return joinSimple(req);
    if (req.method === 'GET' && pathname === '/api/community/presence') return communityPresence(req);
    if (req.method === 'GET' && pathname === '/api/xbox/resolve') return resolveXboxProfile(req);
    if (req.method === 'GET' && pathname === '/api/targets/featured') return json({ ok: true, targets: featuredTargets });

    if (pathname.startsWith('/api/status/bedrock')) return unsupported('Bedrock UDP ping');
    if (pathname.startsWith('/api/bridge/')) return unsupported('LAN/Friends bridge');
    if (pathname.startsWith('/api/xbox/')) return unsupported('Xbox device-code login');

    return json({ ok: false, error: 'Not found' }, 404);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'request failed' }, 500);
  }
});
