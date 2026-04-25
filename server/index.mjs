import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { URL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import bedrock from 'bedrock-protocol';
import prismarineAuth from 'prismarine-auth';
import WebSocket from 'ws';

const { Authflow, Titles } = prismarineAuth;

function loadDotenvFile(file = '.env') {
  try {
    const text = fsSync.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;

      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;

      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

loadDotenvFile();

const apiPort = Number(process.env.PORT || process.env.AMUNET_STATUS_PORT || 8787);
const apiHost = process.env.HOST || process.env.AMUNET_HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const bridgePort = Number(process.env.AMUNET_BRIDGE_PORT || 19132);
const bridgeVersion = process.env.AMUNET_BEDROCK_VERSION || '26.10';
const bridgeProtocol = Number(process.env.AMUNET_BEDROCK_PROTOCOL || 944);
const allowPrivateHosts = process.env.AMUNET_ALLOW_PRIVATE_HOSTS === '1';
const distDir = path.resolve(process.env.AMUNET_DIST_DIR || 'dist');
const serveStaticEnabled = process.env.AMUNET_SERVE_STATIC !== '0';
const prewarmEnabled = process.env.AMUNET_PREWARM !== '0';
const publicFeedUrl = process.env.AMUNET_FEED_URL || 'https://eggnet.space/api/servers/list3';
const publicFeedCacheMs = Number(process.env.AMUNET_FEED_CACHE_MS || 12_000);
const xboxDiscoverCacheMs = Number(process.env.AMUNET_XBOX_DISCOVER_CACHE_MS || 20_000);
const unifiedFeedCacheMs = Number(process.env.AMUNET_UNIFIED_CACHE_MS || 5_000);
const unifiedFeedStaleMs = Number(process.env.AMUNET_UNIFIED_STALE_MS || 120_000);
const providerEggnetEnabled = process.env.AMUNET_PROVIDER_EGGNET !== '0';
const providerXboxEnabled = process.env.AMUNET_PROVIDER_XBOX
  ? process.env.AMUNET_PROVIDER_XBOX !== '0'
  : process.env.NODE_ENV !== 'production';
const prewarmXboxEnabled = providerXboxEnabled && process.env.AMUNET_PREWARM_XBOX === '1';
const adminRefreshKey = process.env.AMUNET_ADMIN_REFRESH_KEY || process.env.ADMIN_REFRESH_KEY || '';
const trustLocalApi = process.env.AMUNET_TRUST_LOCAL_API === '1' || process.env.NODE_ENV !== 'production';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseCacheEnabled = Boolean(supabaseUrl && supabaseServiceRoleKey);
const serverSupabase = supabaseCacheEnabled
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

let activeBridge = null;
let eventLog = [];
let xboxLogin = null;
let xboxToken = null;
let minecraftToken = null;
let publicFeedCache = null;
let hostPresenceCache = null;
let xboxDiscoverCache = null;
let unifiedFeedCache = null;
let unifiedRefreshPromise = null;
let activeXboxBroadcast = null;

const emptyBridge = {
  running: false,
  target: null,
  bridgePort,
  version: bridgeVersion,
  lanAddresses: [],
  clients: [],
  events: [],
};

const emptyXbox = {
  signedIn: false,
  xuid: null,
  expiresOn: null,
  pending: false,
  code: null,
  verificationUri: null,
  message: null,
  error: null,
};

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
  {
    id: 'lifeboat',
    name: 'Lifeboat',
    host: 'play.lbsg.net',
    port: 19132,
    region: 'Global',
    language: 'en',
    category: 'Public Server',
    tags: ['smp', 'survival', 'mobile'],
  },
  {
    id: 'galaxite',
    name: 'Galaxite',
    host: 'play.galaxite.net',
    port: 19132,
    region: 'Global',
    language: 'en',
    category: 'Public Server',
    tags: ['minigame', 'arcade', 'party'],
  },
  {
    id: 'venity',
    name: 'Venity Network',
    host: 'play.venitymc.com',
    port: 19132,
    region: 'Global',
    language: 'en',
    category: 'Public Server',
    tags: ['network', 'pvp', 'smp'],
  },
];

function pushEvent(type, message, detail = {}) {
  eventLog = [
    {
      type,
      message,
      detail,
      at: new Date().toISOString(),
    },
    ...eventLog,
  ].slice(0, 80);
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 64_000) {
        reject(new Error('요청 본문이 너무 큽니다.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('JSON 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-amunet-admin-key',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requestAddress(req) {
  return String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

function isLoopbackRequest(req) {
  const address = requestAddress(req);
  return address === '::1' || address === '127.0.0.1' || address.startsWith('127.');
}

function hasOperatorAccess(req) {
  const headerValue = String(req.headers['x-amunet-admin-key'] || '');

  if (adminRefreshKey) {
    return headerValue === adminRefreshKey;
  }

  return trustLocalApi && isLoopbackRequest(req);
}

function assertOperator(req, action = '이 기능') {
  if (!hasOperatorAccess(req)) {
    throw new ApiError(403, `${action}에는 운영 키가 필요합니다.`);
  }
}

const staticTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function acceptsGzip(req) {
  return String(req.headers['accept-encoding'] || '').includes('gzip');
}

function canGzip(contentType) {
  return /text|javascript|json|svg|css/.test(contentType);
}

async function sendStatic(req, res, filePath, { fallback = false } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const contentType = fallback ? staticTypes['.html'] : staticTypes[extension] || 'application/octet-stream';
  const immutable = !fallback && filePath.includes(`${path.sep}assets${path.sep}`);
  const cacheControl = immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=60';
  const data = await fs.readFile(filePath);
  const headers = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
  };
  let body = data;

  if (acceptsGzip(req) && canGzip(contentType)) {
    body = zlib.gzipSync(data);
    headers['Content-Encoding'] = 'gzip';
  }

  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  res.end(body);
}

async function serveStatic(req, res, url) {
  if (!serveStaticEnabled || !['GET', 'HEAD'].includes(req.method || '')) {
    return false;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    writeJson(res, 400, { ok: false, error: 'Bad path' });
    return true;
  }

  const requested = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(distDir, `.${requested}`);
  const rootWithSep = `${distDir}${path.sep}`;

  if (target !== distDir && !target.startsWith(rootWithSep)) {
    writeJson(res, 403, { ok: false, error: 'Forbidden' });
    return true;
  }

  try {
    const stat = await fs.stat(target);
    if (stat.isFile()) {
      await sendStatic(req, res, target);
      return true;
    }
  } catch {
    // Fall through to SPA fallback.
  }

  const indexPath = path.join(distDir, 'index.html');
  try {
    await sendStatic(req, res, indexPath, { fallback: true });
    return true;
  } catch {
    return false;
  }
}

function isPrivateHost(host) {
  const normalized = host.toLowerCase();

  if (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.endsWith('.local')
  ) {
    return true;
  }

  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return false;
  }

  const [, aRaw, bRaw] = match;
  const a = Number(aRaw);
  const b = Number(bRaw);

  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

function normalizeTarget(input) {
  const host = String(input.host || '').trim();
  const port = Number(input.port || 19132);
  const name = String(input.name || host || 'Luma Bridge').trim();

  if (!host || host.length > 255 || !/^[a-zA-Z0-9.-]+$/.test(host)) {
    throw new Error('대상 주소가 올바르지 않습니다.');
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('포트는 1-65535 사이여야 합니다.');
  }

  if (!allowPrivateHosts && isPrivateHost(host)) {
    throw new Error('사설/로컬 주소는 기본 차단됩니다. 필요한 경우 AMUNET_ALLOW_PRIVATE_HOSTS=1을 설정하세요.');
  }

  return {
    id: String(input.id || `${host}:${port}`).trim(),
    name: name.slice(0, 48),
    host,
    port,
    protocol: Number(input.protocol || bridgeProtocol),
    version: String(input.version || bridgeVersion),
  };
}

function bridgeStatus() {
  return {
    running: Boolean(activeBridge),
    target: activeBridge?.target ?? null,
    bridgePort,
    version: bridgeVersion,
    lanAddresses: getLanAddresses(),
    clients: activeBridge?.clients ?? [],
    xboxBroadcast: activeXboxBroadcast
      ? {
          running: true,
          sessionId: activeXboxBroadcast.sessionId,
          handleId: activeXboxBroadcast.handleId,
          netherNetId: activeXboxBroadcast.netherNetId,
          startedAt: activeXboxBroadcast.startedAt,
        }
      : { running: false },
    events: eventLog,
  };
}

function xboxAuthHeader(token = xboxToken) {
  if (!token?.userHash || !token?.XSTSToken) {
    throw new Error('Xbox 로그인이 필요합니다.');
  }

  return `XBL3.0 x=${token.userHash};${token.XSTSToken}`;
}

function xboxStatus() {
  return {
    signedIn: Boolean(xboxToken?.XSTSToken),
    xuid: xboxToken?.userXUID ?? null,
    expiresOn: xboxToken?.expiresOn ?? null,
    pending: Boolean(xboxLogin && !xboxToken),
    code: xboxLogin?.code ?? null,
    verificationUri: xboxLogin?.verificationUri ?? null,
    message: xboxLogin?.message ?? null,
    error: xboxLogin?.error ?? null,
  };
}

async function getXboxToken(forceRefresh = false) {
  if (!forceRefresh && xboxToken?.XSTSToken && new Date(xboxToken.expiresOn).getTime() > Date.now() + 60_000) {
    return xboxToken;
  }

  const flow = new Authflow(
    'amunet-xbox',
    path.resolve('.amunet-auth'),
    {
      authTitle: Titles.MinecraftNintendoSwitch,
      deviceType: 'Nintendo',
      flow: 'live',
      forceRefresh,
    },
    (data) => {
      xboxLogin = {
        pending: true,
        code: data.user_code,
        verificationUri: data.verification_uri,
        message: data.message,
        error: null,
        startedAt: new Date().toISOString(),
      };
      pushEvent('xbox', 'Xbox device-code 로그인이 필요합니다.', {
        code: data.user_code,
        verificationUri: data.verification_uri,
      });
    },
  );

  const token = await flow.getXboxToken('http://xboxlive.com', forceRefresh);
  xboxToken = token;
  xboxLogin = null;
  pushEvent('xbox', 'Xbox Live 로그인이 완료되었습니다.', { xuid: token.userXUID });
  return token;
}

async function getMinecraftToken(forceRefresh = false) {
  if (!forceRefresh && minecraftToken?.XSTSToken && new Date(minecraftToken.expiresOn).getTime() > Date.now() + 60_000) {
    return minecraftToken;
  }

  if (!xboxToken?.XSTSToken) {
    throw new Error('Xbox 로그인이 필요합니다.');
  }

  const flow = new Authflow(
    'amunet-xbox',
    path.resolve('.amunet-auth'),
    {
      authTitle: Titles.MinecraftNintendoSwitch,
      deviceType: 'Nintendo',
      flow: 'live',
      forceRefresh,
    },
    (data) => {
      xboxLogin = {
        pending: true,
        code: data.user_code,
        verificationUri: data.verification_uri,
        message: data.message,
        error: null,
        startedAt: new Date().toISOString(),
      };
    },
  );

  minecraftToken = await flow.getXboxToken('https://multiplayer.minecraft.net/', forceRefresh);
  return minecraftToken;
}

async function startXboxLogin() {
  if (xboxLogin?.promise) {
    return xboxStatus();
  }

  xboxLogin = {
    pending: true,
    code: null,
    verificationUri: null,
    message: null,
    error: null,
    startedAt: new Date().toISOString(),
  };

  xboxLogin.promise = getXboxToken(true).catch((error) => {
    xboxLogin = {
      pending: false,
      code: null,
      verificationUri: null,
      message: null,
      error: error.message || 'Xbox 로그인 실패',
      startedAt: new Date().toISOString(),
    };
    pushEvent('error', 'Xbox 로그인 실패.', { message: error.message });
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (xboxLogin?.code || xboxToken) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  return xboxStatus();
}

function randomNetherNetId() {
  const high = BigInt(Math.floor(Math.random() * 0x7fffffff));
  const low = BigInt(Math.floor(Math.random() * 0xffffffff));
  return (high << 32n) | low;
}

function buildSessionDirectoryPayload({ connectionId, subscriptionId, xuid, netherNetId, target }) {
  const sessionName = `Luma - ${target?.name || 'Minecraft World'}`;
  return {
    properties: {
      system: {
        joinRestriction: 'followed',
        readRestriction: 'followed',
        closed: false,
      },
      custom: {
        hostName: sessionName,
        ownerId: xuid,
        worldName: sessionName,
        version: String(target?.version || bridgeVersion),
        MemberCount: 1,
        MaxMemberCount: 20,
        Joinability: 'joinable_by_friends',
        rakNetGUID: '',
        worldType: 'Survival',
        protocol: Number(target?.protocol || bridgeProtocol),
        BroadcastSetting: 3,
        OnlineCrossPlatformGame: true,
        CrossPlayDisabled: false,
        TitleId: 0,
        TransportLayer: 2,
        LanGame: false,
        isHardcore: false,
        isEditorWorld: false,
        levelId: `luma-${String(target?.id || target?.host || 'bridge').replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        SupportedConnections: [
          {
            ConnectionType: 3,
            HostIpAddress: '',
            HostPort: 0,
            NetherNetId: netherNetId.toString(),
          },
        ],
      },
    },
    members: {
      me: {
        constants: {
          system: {
            xuid,
            initialize: true,
          },
        },
        properties: {
          system: {
            active: true,
            connection: connectionId,
            subscription: {
              id: subscriptionId,
              changeTypes: ['everything'],
            },
          },
        },
      },
    },
  };
}

async function xboxSessionFetch(url, { method = 'GET', body = null, contractVersion = '107' } = {}) {
  const token = await getXboxToken(false);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: xboxAuthHeader(token),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-xbl-contract-version': contractVersion,
    },
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Xbox Session API ${response.status}: ${payload?.message || payload?.raw || text || response.statusText}`);
  }
  return payload;
}

function connectRtaAndGetConnectionId() {
  return new Promise(async (resolve, reject) => {
    const token = await getXboxToken(false).catch(reject);
    if (!token) return;
    const timeout = setTimeout(() => reject(new Error('RTA connection timeout')), 20_000);
    let settled = false;
    let socket = null;

    try {
      socket = new WebSocket('wss://rta.xboxlive.com/connect', {
        headers: {
          Authorization: xboxAuthHeader(token),
        },
      });
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
      return;
    }

    socket.on('open', () => {
      socket.send('[1,1,"https://sessiondirectory.xboxlive.com/connections/"]');
    });
    socket.on('message', (dataRaw) => {
      try {
        const data = JSON.parse(String(dataRaw || '[]'));
        const connectionId = data?.[4]?.ConnectionId;
        if (!connectionId || settled) return;
        settled = true;
        clearTimeout(timeout);
        const xuid = token.userXUID;
        socket.send(`[1,2,"https://social.xboxlive.com/users/xuid(${xuid})/friends"]`);
        resolve({ connectionId, socket });
      } catch {
        // Ignore non-matching RTA frames.
      }
    });
    socket.on('error', (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`RTA websocket error: ${event.message || 'unknown'}`));
    });
  });
}

async function publishXboxBridgeSession(target = activeBridge?.target) {
  if (!target) {
    throw new Error('브리지 대상이 필요합니다.');
  }
  if (!xboxToken?.XSTSToken) {
    throw new Error('Xbox 로그인이 필요합니다.');
  }

  await stopXboxBroadcast('restarting broadcast');

  const { connectionId, socket } = await connectRtaAndGetConnectionId();
  const sessionId = crypto.randomUUID();
  const subscriptionId = crypto.randomUUID();
  const netherNetId = randomNetherNetId();
  const xuid = xboxToken.userXUID;
  const scid = '4fc10100-5f7a-4470-899b-280835760c07';
  const template = 'MinecraftLobby';
  const sessionPayload = buildSessionDirectoryPayload({
    connectionId,
    subscriptionId,
    xuid,
    netherNetId,
    target,
  });

  await xboxSessionFetch(
    `https://sessiondirectory.xboxlive.com/serviceconfigs/${scid}/sessionTemplates/${template}/sessions/${sessionId}`,
    { method: 'PUT', body: sessionPayload, contractVersion: '107' },
  );
  const handle = await xboxSessionFetch('https://sessiondirectory.xboxlive.com/handles', {
    method: 'POST',
    contractVersion: '107',
    body: {
      version: 1,
      type: 'activity',
      sessionRef: {
        scid,
        templateName: template,
        name: sessionId,
      },
    },
  });
  await xboxSessionFetch(`https://userpresence.xboxlive.com/users/xuid(${xuid})/devices/current/titles/current`, {
    method: 'POST',
    body: { state: 'active' },
    contractVersion: '3',
  });

  const heartbeat = setInterval(async () => {
    try {
      await xboxSessionFetch(`https://userpresence.xboxlive.com/users/xuid(${xuid})/devices/current/titles/current`, {
        method: 'POST',
        body: { state: 'active' },
        contractVersion: '3',
      });
      await xboxSessionFetch(
        `https://sessiondirectory.xboxlive.com/serviceconfigs/${scid}/sessionTemplates/${template}/sessions/${sessionId}`,
        { method: 'PUT', body: sessionPayload, contractVersion: '107' },
      );
    } catch (error) {
      pushEvent('xbox-session', 'Xbox 세션 heartbeat 실패.', { message: error.message });
    }
  }, 30_000);
  heartbeat.unref?.();

  activeXboxBroadcast = {
    sessionId,
    handleId: handle?.id || handle?.handleId || null,
    netherNetId: netherNetId.toString(),
    socket,
    heartbeat,
    startedAt: new Date().toISOString(),
  };
  pushEvent('xbox-session', 'Xbox Live 친구 탭 세션을 방송했습니다.', {
    sessionId,
    handleId: activeXboxBroadcast.handleId,
    netherNetId: activeXboxBroadcast.netherNetId,
  });
  return activeXboxBroadcast;
}

async function stopXboxBroadcast(reason = 'stopped') {
  if (!activeXboxBroadcast) return;
  const current = activeXboxBroadcast;
  activeXboxBroadcast = null;
  clearInterval(current.heartbeat);
  try {
    current.socket?.close?.();
  } catch {
    // Ignore close failure.
  }
  pushEvent('xbox-session', 'Xbox Live 세션 방송을 중지했습니다.', { reason });
}

async function xboxFetch(url, options = {}) {
  const token = await getXboxToken(false);
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: xboxAuthHeader(token),
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-xbl-contract-version': '1',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Xbox API ${response.status}: ${payload?.message || payload?.raw || text || response.statusText}`);
  }

  return payload;
}

function xblHeaders(token, contractVersion = '107') {
  return {
    Authorization: xboxAuthHeader(token),
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-xbl-contract-version': contractVersion,
  };
}

async function fetchXboxJson(url, { token = xboxToken, contractVersion = '107', method = 'GET', body = null } = {}) {
  const response = await fetch(url, {
    method,
    headers: xblHeaders(token, contractVersion),
    body: body ? JSON.stringify(body) : null,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`Xbox API ${response.status}: ${payload?.message || text || response.statusText}`);
  }

  return payload;
}

async function getPeopleXuids(limit = 100) {
  const payload = await xboxFetch(
    `https://social.xboxlive.com/users/me/people?maxItems=${Math.max(1, Math.min(1000, Number(limit) || 100))}`,
  );

  const xuids = (payload?.people || [])
    .map((person) => String(person.xuid || '').trim())
    .filter(Boolean);

  if (xboxToken?.userXUID) {
    xuids.unshift(String(xboxToken.userXUID));
  }

  return Array.from(new Set(xuids));
}

function cleanMinecraftText(value) {
  return String(value || '').replace(/§./g, '').trim();
}

function parseJsonNote(note) {
  if (!note || typeof note !== 'string') {
    return {};
  }

  try {
    return JSON.parse(note);
  } catch {
    return {};
  }
}

function collectConnections(...sources) {
  return sources
    .flatMap((source) => {
      if (!source) return [];
      if (Array.isArray(source)) return source;
      return source.SupportedConnections || source.supportedConnections || source.connections || [];
    })
    .filter(Boolean);
}

function pickIpConnection(...sources) {
  const connections = collectConnections(...sources);
  const match = connections.find((connection) => {
    const host = String(connection.HostIpAddress || connection.host || '').trim();
    const port = Number(connection.HostPort || connection.port || 0);
    return host && port > 0;
  });

  if (!match) return null;
  return {
    host: String(match.HostIpAddress || match.host).trim(),
    port: Number(match.HostPort || match.port),
  };
}

function buildJoinUri(handleId) {
  return `minecraft://activityHandleJoin/?handle=${encodeURIComponent(handleId)}`;
}

function nullableXuid(value) {
  const xuid = String(value || '').trim();
  return /^[0-9]{6,20}$/.test(xuid) ? xuid : null;
}

function worldSessionRow(world) {
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
    source: world.source || 'amunet',
    raw: world,
  };
}

async function cacheWorldsInSupabase(worlds) {
  if (!serverSupabase || !worlds?.length) {
    return;
  }

  const rows = worlds.filter((world) => world.handleId).map((world) => worldSessionRow(world));
  if (!rows.length) {
    return;
  }

  const { error } = await serverSupabase.from('world_sessions').upsert(rows, {
    onConflict: 'handle_id',
  });

  if (error) {
    pushEvent('supabase', '월드 세션 Supabase 캐시 실패.', { message: error.message });
  }
}

function normalizePublicWorld(entry) {
  const note = parseJsonNote(entry?.note);
  const handle = note?.world?.handle || {};
  const handleId = String(
    handle.handleId ||
      entry?.handleId ||
      entry?.activityHandleId ||
      '',
  ).trim();

  if (!handleId) {
    return null;
  }

  const languageSchema = entry?.languageSchema || {};
  const title = cleanMinecraftText(entry?.title || handle.worldName || 'Minecraft World');
  const ipConnection = pickIpConnection(
    handle,
    entry,
    note?.world?.handle,
    note?.world?.raw?.properties?.custom,
    note?.raw?.properties?.custom,
  );
  const ownerXuid = String(entry?.ownerXuid || handle.ownerId || handle.ownerXuid || note?.host?.xuid || '');
  const ownerGamertag = String(entry?.ownerGamertag || note?.host?.gamertag || '');
  const hostName = String(entry?.hostName || handle.hostName || ownerGamertag || '');
  const members = Number(
    handle.memberCount ??
      handle.membersCount ??
      entry?.memberCount ??
      entry?.membersCount ??
      0,
  );
  const maxMembers = Number(
    handle.maxMemberCount ??
      handle.maxMembersCount ??
      entry?.maxMemberCount ??
      entry?.maxMembersCount ??
      0,
  );
  const updatedAtMs = Number(entry?.updatedAtMs || Date.now());

  return {
    id: String(entry?.serverId || handleId),
    serverId: String(entry?.serverId || ''),
    handleId,
    title,
    hostName,
    ...(ipConnection
      ? {
          host: ipConnection.host,
          port: ipConnection.port,
        }
      : {}),
    ownerXuid,
    ownerGamertag,
    source: `eggnet:${String(entry?.source || 'feed')}`,
    language: String(languageSchema.primary || 'unknown'),
    languages: Array.isArray(languageSchema.languages) ? languageSchema.languages : [],
    avatarTinyBase64: String(entry?.avatar_tiny_b64 || ''),
    worldType: String(handle.worldType || entry?.worldType || ''),
    version: String(handle.version || entry?.version || ''),
    protocol: Number(handle.protocol || entry?.protocol || 0),
    members,
    maxMembers,
    joinRestriction: String(handle.joinRestriction || entry?.joinRestriction || ''),
    visibility: String(handle.visibility || entry?.visibility || ''),
    nethernetId: String(entry?.nethernetId || entry?.netherNetId || handle.netherNetId || ''),
    closed: Boolean(handle.closed),
    updatedAtMs,
    uri: buildJoinUri(handleId),
  };
}

async function fetchPublicFeed({ force = false } = {}) {
  const now = Date.now();

  if (!providerEggnetEnabled) {
    return {
      ok: true,
      source: 'eggnet_disabled',
      mode: 'disabled',
      version: 0,
      count: 0,
      feedCount: 0,
      fetchedAtMs: now,
      xbl: null,
      worlds: [],
    };
  }

  if (!force && publicFeedCache && now - publicFeedCache.fetchedAtMs < publicFeedCacheMs) {
    return publicFeedCache.payload;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(publicFeedUrl, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok || payload?.ok === false) {
      throw new Error(`feed ${response.status}: ${payload?.error || text || response.statusText}`);
    }

    const worlds = (Array.isArray(payload.servers) ? payload.servers : [])
      .map((entry) => normalizePublicWorld(entry))
      .filter(Boolean)
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

    const result = {
      ok: true,
      source: payload.source || 'public_feed',
      mode: payload.mode || 'full',
      version: payload.version || 0,
      count: worlds.length,
      feedCount: payload.count || worlds.length,
      fetchedAtMs: now,
      xbl: payload.xbl || null,
      worlds,
    };

    publicFeedCache = {
      fetchedAtMs: now,
      payload: result,
    };
    cacheWorldsInSupabase(worlds).catch((error) => {
      pushEvent('supabase', 'Eggnet 월드 Supabase 캐시 실패.', { message: error.message });
    });
    pushEvent('feed', '공개 월드 피드를 갱신했습니다.', { count: worlds.length });
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getAllPeopleDetailed(limit = 1000) {
  const urls = [
    'https://peoplehub.xboxlive.com/users/me/people/social',
    'https://peoplehub.xboxlive.com/users/me/people/following',
  ];
  const responses = await Promise.allSettled(
    urls.map((endpoint) => fetchXboxJson(endpoint, { contractVersion: '5' })),
  );
  const people = [];

  for (const response of responses) {
    if (response.status === 'fulfilled') {
      people.push(...(response.value?.people || []));
    }
  }

  const deduped = new Map();
  for (const person of people) {
    const xuid = String(person?.xuid || '').trim();
    if (xuid) {
      deduped.set(xuid, person);
    }
  }

  return [...deduped.values()].slice(0, Math.max(1, Math.min(1000, Number(limit) || 1000)));
}

async function getMcbeOnlinePeople(xuids) {
  const mcbeTitleIds = new Set(['1739947436', '896928775', '1810924247', '2044456598', '1828326430']);
  const online = [];

  for (let i = 0; i < xuids.length; i += 100) {
    const users = xuids.slice(i, i + 100);
    if (!users.length) continue;

    try {
      const payload = await fetchXboxJson('https://userpresence.xboxlive.com/users/batch', {
        method: 'POST',
        contractVersion: '3',
        body: {
          users,
          onlineOnly: true,
          deviceTypes: ['XboxOne', 'WindowsOneCore', 'Android', 'iOS', 'Nintendo'],
        },
      });
      const items = Array.isArray(payload) ? payload : [];
      online.push(
        ...items.filter((person) =>
          person.devices?.some((device) => device.titles?.some((title) => mcbeTitleIds.has(String(title.id)))),
        ),
      );
    } catch (error) {
      pushEvent('xbox', 'presence 배치 조회를 건너뛰었습니다.', { message: error.message });
    }
  }

  return online;
}

async function getActivityHandlesForXuid(xuid) {
  try {
    const payload = await fetchXboxJson(
      'https://sessiondirectory.xboxlive.com/handles/query?include=relatedInfo,customProperties',
      {
        method: 'POST',
        contractVersion: '107',
        body: {
          type: 'activity',
          scid: '4fc10100-5f7a-4470-899b-280835760c07',
          owners: {
            people: {
              moniker: 'people',
              monikerXuid: String(xuid),
            },
          },
        },
      },
    );

    return payload?.results || [];
  } catch (error) {
    pushEvent('xbox', 'activity handle 조회를 건너뛰었습니다.', { xuid, message: error.message });
    return [];
  }
}

async function getSessionDetail(scid, templateName, sessionName) {
  const url = `https://sessiondirectory.xboxlive.com/serviceconfigs/${scid}/sessiontemplates/${templateName}/sessions/${String(
    sessionName,
  ).toLowerCase()}`;

  try {
    return await fetchXboxJson(url, { contractVersion: '107' });
  } catch (error) {
    if (!String(error.message || '').includes('403')) {
      return null;
    }
  }

  try {
    const token = await getMinecraftToken(false);
    return await fetchXboxJson(url, { token, contractVersion: '107' });
  } catch {
    return null;
  }
}

async function getProfileMap(xuids) {
  const unique = [...new Set(xuids.map((xuid) => String(xuid || '').trim()).filter(Boolean))];
  const map = {};

  for (let i = 0; i < unique.length; i += 100) {
    const userIds = unique.slice(i, i + 100);
    try {
      const payload = await fetchXboxJson('https://profile.xboxlive.com/users/batch/profile/settings', {
        method: 'POST',
        contractVersion: '2',
        body: {
          userIds,
          settings: [
            'GameDisplayName',
            'GameDisplayPicRaw',
            'Gamerscore',
            'XboxOneRep',
            'Bio',
            'ModernGamertag',
            'UniqueModernGamertag',
          ],
        },
      });

      for (const user of payload?.profileUsers || []) {
        const settings = {};
        for (const item of user.settings || []) {
          settings[item.id] = item.value;
        }
        map[user.id] = {
          xuid: user.id,
          gamertag: settings.ModernGamertag || settings.GameDisplayName || '',
          uniqueGamertag: settings.UniqueModernGamertag || '',
          profilePicUrl: settings.GameDisplayPicRaw || '',
        };
      }
    } catch (error) {
      pushEvent('xbox', '프로필 배치 조회를 건너뛰었습니다.', { message: error.message });
    }
  }

  return map;
}

function classifyMinecraftSession(custom) {
  if (custom.RealmId) return 'realm';
  const broadcast = Number(custom.BroadcastSetting ?? 0);
  const joinability = String(custom.Joinability || '');

  if (broadcast === 3) return 'public';
  if (broadcast === 2 && joinability === 'joinable_by_friends') return 'public';
  return 'local';
}

function parseSupportedConnections(custom) {
  return (custom.SupportedConnections || []).map((connection) => ({
    connectionType: connection.ConnectionType,
    host: connection.HostIpAddress || null,
    port: connection.HostPort || null,
    netherNetId: connection.NetherNetId || null,
    pmsgId: connection.PmsgId || null,
  }));
}

function parseActivityHandle(handle) {
  const custom = handle?.customProperties || {};
  if (!custom.worldName) return null;

  const connections = parseSupportedConnections(custom);
  return {
    handleId: handle.id || '',
    ownerXuid: String(handle.ownerXuid || ''),
    hostXuid: String(custom.ownerId || handle.ownerXuid || ''),
    hostName: String(custom.hostName || ''),
    worldName: cleanMinecraftText(custom.worldName || ''),
    worldType: String(custom.worldType || ''),
    version: String(custom.version || ''),
    currentPlayers: Number(custom.MemberCount ?? 0),
    maxPlayers: Number(custom.MaxMemberCount ?? 0),
    broadcastSetting: Number(custom.BroadcastSetting ?? 0),
    joinability: String(custom.Joinability || ''),
    serverType: classifyMinecraftSession(custom),
    realmId: custom.RealmId || null,
    levelId: String(custom.levelId || ''),
    ipConn: connections.find((connection) => connection.connectionType === 1 || connection.connectionType === 2) || null,
    nnConn: connections.find((connection) => connection.connectionType === 6 || connection.connectionType === 7) || null,
    realmConn: connections.find((connection) => connection.connectionType === 3) || null,
    members: [],
  };
}

function parseActivitySession(session, handle) {
  const custom = session?.properties?.custom || {};
  if (!custom.worldName) return null;

  const members = Object.values(session?.members || {}).map((member) => ({
    xuid: String(member?.constants?.system?.xuid || ''),
    gamertag: String(member?.constants?.system?.gamertag || ''),
  }));
  const connections = parseSupportedConnections(custom);

  return {
    handleId: handle?.id || '',
    ownerXuid: String(handle?.ownerXuid || ''),
    hostXuid: String(custom.ownerId || handle?.ownerXuid || ''),
    hostName: String(custom.hostName || ''),
    worldName: cleanMinecraftText(custom.worldName || ''),
    worldType: String(custom.worldType || ''),
    version: String(custom.version || ''),
    currentPlayers: Number(custom.MemberCount ?? members.length),
    maxPlayers: Number(custom.MaxMemberCount ?? 0),
    broadcastSetting: Number(custom.BroadcastSetting ?? 0),
    joinability: String(custom.Joinability || ''),
    serverType: classifyMinecraftSession(custom),
    realmId: custom.RealmId || null,
    levelId: String(custom.levelId || ''),
    ipConn: connections.find((connection) => connection.connectionType === 1 || connection.connectionType === 2) || null,
    nnConn: connections.find((connection) => connection.connectionType === 6 || connection.connectionType === 7) || null,
    realmConn: connections.find((connection) => connection.connectionType === 3) || null,
    members,
  };
}

function activityServerKey(server) {
  if (server.levelId) return server.levelId;
  if (server.hostXuid && server.worldName) return `${server.hostXuid}:${server.worldName}`;
  return server.handleId;
}

async function processActivityHandles(handles, serverMap, xuidSet) {
  for (const handle of handles) {
    let parsed = parseActivityHandle(handle);

    if (!parsed) {
      const ref = handle?.sessionRef || {};
      if (!ref.scid || !ref.templateName || !ref.name) continue;
      const session = await getSessionDetail(ref.scid, ref.templateName, ref.name);
      parsed = session ? parseActivitySession(session, handle) : null;
    }

    if (!parsed?.handleId || !parsed.worldName) continue;

    const key = activityServerKey(parsed);
    if (!serverMap.has(key)) {
      serverMap.set(key, parsed);
      if (parsed.hostXuid) xuidSet.add(parsed.hostXuid);
      if (parsed.ownerXuid) xuidSet.add(parsed.ownerXuid);
      for (const member of parsed.members || []) {
        if (member.xuid) xuidSet.add(member.xuid);
      }
    }
  }
}

function normalizeXboxSessionWorld(server, profileMap) {
  const hostProfile = profileMap[server.hostXuid] || profileMap[server.ownerXuid] || {};
  const handleId = String(server.handleId || '').trim();

  if (!handleId) return null;

  return {
    id: `xbox:${handleId}`,
    serverId: '',
    handleId,
    title: server.worldName || 'Minecraft World',
    hostName: server.hostName || hostProfile.gamertag || '',
    ...(server.ipConn?.host && server.ipConn?.port
      ? {
          host: server.ipConn.host,
          port: Number(server.ipConn.port),
        }
      : {}),
    ownerXuid: server.hostXuid || server.ownerXuid || '',
    ownerGamertag: hostProfile.gamertag || server.hostName || '',
    source: 'amunet:xbox-sessiondirectory',
    language: 'unknown',
    languages: [],
    avatarTinyBase64: '',
    avatarUrl: hostProfile.profilePicUrl || '',
    worldType: server.worldType || 'World',
    version: server.version || '',
    protocol: 0,
    members: Number(server.currentPlayers || 0),
    maxMembers: Number(server.maxPlayers || 0),
    joinRestriction: server.joinability || '',
    visibility: server.serverType,
    nethernetId: server.nnConn?.netherNetId || '',
    closed: server.serverType !== 'public',
    updatedAtMs: Date.now(),
    uri: buildJoinUri(handleId),
  };
}

function featuredTargetWorlds(now = Date.now()) {
  return featuredTargets.map((target) => ({
    id: `featured:${target.id}`,
    serverId: '',
    handleId: `featured:${target.id}`,
    title: target.name,
    hostName: target.host,
    host: target.host,
    port: target.port,
    ownerXuid: '',
    ownerGamertag: target.name,
    source: 'luma:featured',
    language: target.language,
    languages: [target.language],
    avatarTinyBase64: '',
    avatarUrl: '',
    worldType: target.category,
    version: '',
    protocol: bridgeProtocol,
    members: 0,
    maxMembers: 0,
    joinRestriction: 'open',
    visibility: 'public',
    nethernetId: '',
    closed: false,
    updatedAtMs: now,
    uri: `minecraft://?addExternalServer=${encodeURIComponent(`${target.name}|${target.host}:${target.port}`)}`,
  }));
}

async function discoverXboxSessionWorlds({ force = false, limit = 250 } = {}) {
  const now = Date.now();

  if (!providerXboxEnabled) {
    return {
      ok: true,
      source: 'xbox_provider_disabled',
      count: 0,
      fetchedAtMs: now,
      peopleCount: 0,
      mcbeOnlineCount: 0,
      worlds: [],
    };
  }

  if (!xboxToken?.XSTSToken) {
    return {
      ok: true,
      source: 'xbox_sessiondirectory',
      count: 0,
      fetchedAtMs: now,
      peopleCount: 0,
      mcbeOnlineCount: 0,
      requiresLogin: true,
      worlds: [],
    };
  }

  if (!force && xboxDiscoverCache && now - xboxDiscoverCache.fetchedAtMs < xboxDiscoverCacheMs) {
    return xboxDiscoverCache.payload;
  }

  const people = await getAllPeopleDetailed(limit);
  const peopleXuids = people.map((person) => String(person.xuid || '').trim()).filter(Boolean);
  const mcbeOnline = await getMcbeOnlinePeople(peopleXuids);
  const serverMap = new Map();
  const xuidSet = new Set([xboxToken.userXUID]);
  const handleCache = new Map();

  async function handlesFor(xuid) {
    if (!handleCache.has(xuid)) {
      handleCache.set(xuid, await getActivityHandlesForXuid(xuid));
    }
    return handleCache.get(xuid);
  }

  for (const presence of mcbeOnline) {
    const handles = await handlesFor(presence.xuid);
    await processActivityHandles(handles, serverMap, xuidSet);
  }

  const discoveredHosts = new Set([...serverMap.values()].map((server) => server.hostXuid).filter(Boolean));
  for (const presence of mcbeOnline) {
    const handles = await handlesFor(presence.xuid);
    for (const handle of handles) {
      const ownerId = String(handle?.customProperties?.ownerId || '').trim();
      if (!ownerId || discoveredHosts.has(ownerId)) continue;
      discoveredHosts.add(ownerId);
      await processActivityHandles(await handlesFor(ownerId), serverMap, xuidSet);
    }
  }

  const profileMap = await getProfileMap([...xuidSet]);
  const worlds = [...serverMap.values()]
    .filter((server) => server.serverType === 'public')
    .map((server) => normalizeXboxSessionWorld(server, profileMap))
    .filter(Boolean)
    .sort((a, b) => b.members - a.members || a.title.localeCompare(b.title));

  const result = {
    ok: true,
    source: 'xbox_sessiondirectory',
    count: worlds.length,
    fetchedAtMs: now,
    peopleCount: people.length,
    mcbeOnlineCount: mcbeOnline.length,
    worlds,
  };

  xboxDiscoverCache = {
    fetchedAtMs: now,
    payload: result,
  };
  cacheWorldsInSupabase(worlds).catch((error) => {
    pushEvent('supabase', 'Xbox 월드 Supabase 캐시 실패.', { message: error.message });
  });
  pushEvent('xbox', 'Xbox SessionDirectory 월드 탐색을 완료했습니다.', {
    people: people.length,
    online: mcbeOnline.length,
    worlds: worlds.length,
  });

  return result;
}

function mergeWorldFeeds(feeds) {
  const map = new Map();

  for (const feed of feeds) {
    for (const world of feed.worlds || []) {
      const key = world.handleId || world.serverId || world.id;
      if (!key) continue;
      const existing = map.get(key);

      if (!existing || (world.members || 0) > (existing.members || 0) || world.updatedAtMs > existing.updatedAtMs) {
        map.set(key, {
          ...existing,
          ...world,
          source: existing && existing.source !== world.source ? `${existing.source}+${world.source}` : world.source,
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    return b.members - a.members || b.updatedAtMs - a.updatedAtMs;
  });
}

async function fetchUnifiedWorlds({ force = false, includeXbox = true, xboxLimit = 250 } = {}) {
  const cacheKey = JSON.stringify({ includeXbox, xboxLimit });
  const now = Date.now();

  if (!force && unifiedFeedCache?.key === cacheKey) {
    const age = now - unifiedFeedCache.fetchedAtMs;
    if (age < unifiedFeedCacheMs) {
      return {
        ...unifiedFeedCache.payload,
        cache: 'hit',
        cacheAgeMs: age,
      };
    }

    if (age < unifiedFeedStaleMs) {
      refreshUnifiedFeed({ includeXbox, xboxLimit });
      return {
        ...unifiedFeedCache.payload,
        cache: 'stale',
        cacheAgeMs: age,
      };
    }
  }

  const providers = [];
  const feeds = [];

  const lumaFeatured = {
    ok: true,
    source: 'luma_featured',
    count: featuredTargets.length,
    worlds: featuredTargetWorlds(now),
  };
  providers.push({
    id: 'luma-featured',
    name: 'Luma Featured',
    ok: true,
    count: lumaFeatured.count,
    error: null,
    requiresLogin: false,
  });
  feeds.push(lumaFeatured);

  const eggnet = await fetchPublicFeed({ force }).catch((error) => ({
    ok: false,
    source: 'eggnet',
    count: 0,
    worlds: [],
    error: error.message,
  }));
  providers.push({
    id: 'eggnet',
    name: 'Eggnet',
    ok: eggnet.ok !== false,
    count: eggnet.count || 0,
    error: eggnet.error || null,
    requiresLogin: false,
  });
  feeds.push(eggnet);

  if (includeXbox) {
    const xbox = await discoverXboxSessionWorlds({ force, limit: xboxLimit }).catch((error) => ({
      ok: false,
      source: 'xbox_sessiondirectory',
      count: 0,
      worlds: [],
      error: error.message,
    }));
    providers.push({
      id: 'xbox-sessiondirectory',
      name: 'Luma Xbox',
      ok: xbox.ok !== false,
      count: xbox.count || 0,
      error: xbox.error || null,
      requiresLogin: Boolean(xbox.requiresLogin),
      peopleCount: xbox.peopleCount || 0,
      mcbeOnlineCount: xbox.mcbeOnlineCount || 0,
    });
    feeds.push(xbox);
  }

  const worlds = mergeWorldFeeds(feeds);
  const result = {
    ok: true,
    source: 'amunet_unified',
    mode: 'unified',
    count: worlds.length,
    fetchedAtMs: Date.now(),
    cache: 'miss',
    cacheAgeMs: 0,
    providers,
    worlds,
  };
  unifiedFeedCache = {
    key: cacheKey,
    fetchedAtMs: result.fetchedAtMs,
    payload: result,
  };
  return result;
}

function refreshUnifiedFeed({ includeXbox = true, xboxLimit = 250 } = {}) {
  if (unifiedRefreshPromise) {
    return unifiedRefreshPromise;
  }

  unifiedRefreshPromise = fetchUnifiedWorlds({
    force: true,
    includeXbox,
    xboxLimit,
  })
    .catch((error) => {
      pushEvent('feed', '백그라운드 통합 피드 갱신 실패.', { message: error.message });
    })
    .finally(() => {
      unifiedRefreshPromise = null;
    });

  return unifiedRefreshPromise;
}

async function resolveJoinTarget(input) {
  const handleId = String(input?.handleId || input?.handle || '').trim();
  const serverId = String(input?.serverId || input?.id || '').trim();

  if (serverId) {
    const feed = await fetchPublicFeed({ force: true });
    const world = feed.worlds.find((item) => item.serverId === serverId || item.id === serverId);

    if (world?.handleId) {
      return {
        ok: true,
        mode: 'server',
        serverId: world.serverId,
        joinerXuid: String(input?.joinerXuid || input?.xuid || ''),
        handleId: world.handleId,
        joinUri: world.uri,
        nethernetId: world.nethernetId,
        ts: Date.now(),
      };
    }
  }

  if (handleId) {
    return {
      ok: true,
      mode: 'handle',
      serverId: String(input?.serverId || ''),
      handleId,
      joinUri: buildJoinUri(handleId),
      ts: Date.now(),
    };
  }

  if (!serverId) {
    throw new Error('serverId 또는 handleId가 필요합니다.');
  }

  const feed = await fetchPublicFeed();
  const world = feed.worlds.find((item) => item.serverId === serverId || item.id === serverId);

  if (!world) {
    throw new Error('월드 세션을 찾을 수 없습니다.');
  }

  return {
    ok: true,
    mode: 'feed_handle',
    serverId: world.serverId,
    joinerXuid: String(input?.joinerXuid || input?.xuid || ''),
    handleId: world.handleId,
    joinUri: world.uri,
    nethernetId: world.nethernetId,
    ts: Date.now(),
  };
}

async function fetchHostPresence({ force = false } = {}) {
  const now = Date.now();

  if (!force && hostPresenceCache && now - hostPresenceCache.fetchedAtMs < 20_000) {
    return hostPresenceCache.payload;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://eggnet.space/api/hosts/presence', {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok || payload?.ok === false) {
      throw new Error(`presence ${response.status}: ${payload?.error || text || response.statusText}`);
    }

    const hosts = (Array.isArray(payload.hosts) ? payload.hosts : []).map((host) => ({
      xuid: String(host.xuid || ''),
      gamertag: String(host.gamertag || ''),
      country: String(host.country || ''),
      presence: String(host.presence || 'unknown'),
      lastSeenMs: Number(host.lastSeenMs || 0),
    }));
    const result = {
      ok: true,
      count: hosts.length,
      fetchedAtMs: now,
      hosts,
    };

    hostPresenceCache = {
      fetchedAtMs: now,
      payload: result,
    };
    return result;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractActivities(payload) {
  const rawItems =
    payload?.activities ||
    payload?.activityItems ||
    payload?.results ||
    payload?.items ||
    payload?.users ||
    [];

  const list = Array.isArray(rawItems) ? rawItems : Object.values(rawItems);

  return list.flatMap((item) => {
    const candidates = [
      item,
      ...(Array.isArray(item.activities) ? item.activities : []),
      ...(Array.isArray(item.activityItems) ? item.activityItems : []),
    ];

    return candidates
      .map((activity) => {
        const handle =
          activity.handle ||
          activity.handleId ||
          activity.activityHandle ||
          activity.activityHandleId ||
          activity.sessionHandleId ||
          activity.multiplayerActivityDetails?.handleId ||
          activity.multiplayerActivityDetails?.HandleId;
        const note = parseJsonNote(activity.note);
        const worldHandle = note?.world?.handle || {};
        const handleId = String(handle || worldHandle.handleId || '').trim();

        if (!handleId) {
          return null;
        }

        const title =
          activity.title ||
          activity.name ||
          activity.description ||
          worldHandle.worldName ||
          note?.world?.handle?.worldName ||
          'Minecraft World';
        const hostName =
          activity.ownerGamertag ||
          activity.hostName ||
          worldHandle.hostName ||
          note?.host?.gamertag ||
          '';
        const members = Number(
          activity.memberCount ??
            activity.membersCount ??
            worldHandle.memberCount ??
            worldHandle.membersCount ??
            0,
        );
        const maxMembers = Number(
          activity.maxMemberCount ??
            activity.maxMembersCount ??
            worldHandle.maxMemberCount ??
            worldHandle.maxMembersCount ??
            0,
        );

        return {
          id: handleId,
          handleId,
          title: cleanMinecraftText(title),
          hostName,
          ownerXuid: String(activity.ownerXuid || activity.ownerXUID || worldHandle.ownerXuid || ''),
          worldType: worldHandle.worldType || activity.worldType || '',
          version: worldHandle.version || activity.version || '',
          protocol: Number(worldHandle.protocol || activity.protocol || 0),
          members,
          maxMembers,
          joinRestriction: worldHandle.joinRestriction || activity.joinRestriction || '',
          visibility: worldHandle.visibility || activity.visibility || '',
          updatedAtMs: Number(activity.updatedAtMs || Date.now()),
          uri: buildJoinUri(handleId),
        };
      })
      .filter(Boolean);
  });
}

async function queryActivitiesForXuids(xuids) {
  if (!xuids.length) {
    return [];
  }

  const payload = await xboxFetch('https://multiplayeractivity.xboxlive.com/activities/query/dashboard', {
    method: 'POST',
    headers: {
      'x-xbl-contract-version': '1',
    },
    body: JSON.stringify({
      users: xuids,
    }),
  });

  const activities = extractActivities(payload);
  const unique = new Map();

  for (const activity of activities) {
    unique.set(activity.handleId, activity);
  }

  return Array.from(unique.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

async function stopBridge(reason = 'Bridge stopped') {
  if (!activeBridge) {
    return;
  }

  await stopXboxBroadcast(reason);
  const bridge = activeBridge;
  activeBridge = null;
  await bridge.server.close(reason).catch(() => {});
  pushEvent('bridge', '브리지를 중지했습니다.', { reason });
}

async function startBridge(targetInput) {
  const target = normalizeTarget(targetInput);

  await stopBridge('Restarting bridge');

  const clients = [];
  const server = bedrock.createServer({
    host: '0.0.0.0',
    port: bridgePort,
    version: bridgeVersion,
    offline: true,
    maxPlayers: 16,
    raknetBackend: 'jsp-raknet',
    motd: {
      motd: `Luma -> ${target.name}`,
      levelName: `${target.host}:${target.port}`,
    },
  });

  activeBridge = { server, target, clients };
  pushEvent('bridge', '브리지를 시작했습니다.', target);
  if (xboxToken?.XSTSToken) {
    publishXboxBridgeSession(target).catch((error) => {
      pushEvent('xbox-session', 'Xbox Live 세션 방송 실패.', { message: error.message });
    });
  }

  server.on('connect', (client) => {
    const address = client.connection?.address || 'unknown';
    const item = { address, name: '', joinedAt: new Date().toISOString() };
    clients.push(item);
    pushEvent('client', 'Minecraft 클라이언트가 브리지에 접속했습니다.', { address });

    client.on('login', () => {
      item.name = client.profile?.name || '';
      pushEvent('client', '클라이언트 로그인 확인.', {
        address,
        name: item.name,
      });
    });

    client.on('join', () => {
      pushEvent('transfer', '선택한 Bedrock 서버로 transfer 패킷을 보냈습니다.', {
        address,
        target,
      });

      windowlessTransfer(client, target);
    });

    client.on('close', () => {
      const index = clients.indexOf(item);
      if (index >= 0) {
        clients.splice(index, 1);
      }
      pushEvent('client', '클라이언트 연결이 종료되었습니다.', { address });
    });
  });

  return bridgeStatus();
}

function windowlessTransfer(client, target) {
  setTimeout(() => {
    try {
      client.queue('transfer', {
        server_address: target.host,
        port: target.port,
        reload_world: false,
      });
    } catch (error) {
      pushEvent('error', 'transfer 패킷 전송 실패.', { message: error.message });
      client.disconnect(`Luma transfer failed: ${error.message}`);
      return;
    }

    setTimeout(() => {
      try {
        client.disconnect(`Transferred to ${target.host}:${target.port}`, true);
      } catch {
        client.close();
      }
    }, 1800);
  }, 350);
}

function normalizePingResponse(target, ping) {
  return {
    id: target.id || `${target.host}:${target.port}`,
    name: target.name,
    host: target.host,
    port: target.port,
    online: true,
    motd: ping.motd || ping.name || '',
    levelName: ping.levelName || '',
    version: ping.version || '',
    protocol: Number(ping.protocol || 0),
    playersOnline: ping.playersOnline ?? 0,
    playersMax: ping.playersMax ?? 0,
    serverId: ping.serverId || '',
    gamemode: ping.gamemode || '',
    retrievedAt: new Date().toISOString(),
  };
}

async function pingTarget(targetInput) {
  const target = normalizeTarget(targetInput);
  const ping = await Promise.race([
    bedrock.ping({
      host: target.host,
      port: target.port,
      raknetBackend: 'jsp-raknet',
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('status timeout')), 6500)),
  ]);

  return normalizePingResponse(target, ping);
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    writeJson(res, 200, { ok: true });
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const operator = hasOperatorAccess(req);
      writeJson(res, 200, {
        ok: true,
        product: 'Luma Bridge API',
        bridge: operator ? bridgeStatus() : emptyBridge,
        xbox: operator ? xboxStatus() : emptyXbox,
        providers: {
          eggnet: providerEggnetEnabled,
          xboxSessionDirectory: providerXboxEnabled && operator,
        },
        capabilities: {
          supabaseCache: supabaseCacheEnabled,
          supabaseEdge: false,
          static: serveStaticEnabled,
          bridge: operator,
          xboxLogin: providerXboxEnabled && operator,
          bedrockPing: operator,
        },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/targets/featured') {
      writeJson(res, 200, { ok: true, targets: featuredTargets });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/worlds/live') {
      const force = url.searchParams.get('force') === '1';
      if (force) {
        assertOperator(req, '피드 강제 갱신');
      }
      const feed = await fetchUnifiedWorlds({
        force,
        includeXbox: providerXboxEnabled && url.searchParams.get('includeXbox') !== '0' && hasOperatorAccess(req),
        xboxLimit: Number(url.searchParams.get('limit') || 250),
      });
      writeJson(res, 200, feed);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/worlds/eggnet') {
      const force = url.searchParams.get('force') === '1';
      if (force) {
        assertOperator(req, 'Eggnet 피드 강제 갱신');
      }
      const feed = await fetchPublicFeed({ force });
      writeJson(res, 200, feed);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/worlds/discover') {
      assertOperator(req, 'Xbox SessionDirectory 탐색');
      const feed = await discoverXboxSessionWorlds({
        force: url.searchParams.get('force') === '1',
        limit: Number(url.searchParams.get('limit') || 250),
      });
      writeJson(res, 200, feed);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/join/simple') {
      const body = await readJson(req);
      const target = await resolveJoinTarget(body);
      writeJson(res, 200, target);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/join/simple') {
      const target = await resolveJoinTarget({
        serverId: url.searchParams.get('serverId'),
        handleId: url.searchParams.get('handleId') || url.searchParams.get('handle'),
        joinerXuid: url.searchParams.get('joinerXuid') || url.searchParams.get('xuid'),
      });
      writeJson(res, 200, target);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/community/presence') {
      const force = url.searchParams.get('force') === '1';
      if (force) {
        assertOperator(req, '프레즌스 강제 갱신');
      }
      const presence = await fetchHostPresence({ force });
      writeJson(res, 200, presence);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/bridge/status') {
      assertOperator(req, '브리지 상태 조회');
      writeJson(res, 200, { ok: true, bridge: bridgeStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/xbox/login/start') {
      assertOperator(req, 'Xbox 로그인');
      const status = await startXboxLogin();
      writeJson(res, 200, { ok: true, xbox: status });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/xbox/login/status') {
      assertOperator(req, 'Xbox 로그인 상태 조회');
      if (xboxToken?.XSTSToken && activeBridge && !activeXboxBroadcast) {
        publishXboxBridgeSession(activeBridge.target).catch((error) => {
          pushEvent('xbox-session', 'Xbox Live 세션 방송 실패.', { message: error.message });
        });
      }
      writeJson(res, 200, { ok: true, xbox: xboxStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/xbox/logout') {
      assertOperator(req, 'Xbox 로그아웃');
      await stopXboxBroadcast('Xbox logout');
      xboxToken = null;
      xboxLogin = null;
      writeJson(res, 200, { ok: true, xbox: xboxStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/xbox/broadcast/start') {
      assertOperator(req, 'Xbox 세션 방송');
      const broadcast = await publishXboxBridgeSession(activeBridge?.target);
      writeJson(res, 200, { ok: true, broadcast: bridgeStatus().xboxBroadcast || broadcast });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/xbox/broadcast/stop') {
      assertOperator(req, 'Xbox 세션 방송 중지');
      await stopXboxBroadcast('Stopped by user');
      writeJson(res, 200, { ok: true, broadcast: bridgeStatus().xboxBroadcast });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/xbox/people') {
      assertOperator(req, 'Xbox 친구 목록 조회');
      const xuids = await getPeopleXuids(Number(url.searchParams.get('limit') || 100));
      writeJson(res, 200, { ok: true, xuids, count: xuids.length });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/xbox/worlds') {
      assertOperator(req, 'Xbox 월드 조회');
      const limit = Number(url.searchParams.get('limit') || 100);
      const xuids = await getPeopleXuids(limit);
      const worlds = await queryActivitiesForXuids(xuids);
      writeJson(res, 200, { ok: true, xuids: xuids.length, worlds });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/xbox/worlds/query') {
      assertOperator(req, 'Xbox 월드 직접 조회');
      const body = await readJson(req);
      const input = Array.isArray(body.xuids) ? body.xuids : [];
      const xuids = input.map((xuid) => String(xuid).trim()).filter(Boolean);
      const worlds = await queryActivitiesForXuids(xuids);
      writeJson(res, 200, { ok: true, xuids: xuids.length, worlds });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bridge/start') {
      assertOperator(req, '브리지 시작');
      const body = await readJson(req);
      const bridge = await startBridge(body.target || body);
      writeJson(res, 200, { ok: true, bridge });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/bridge/stop') {
      assertOperator(req, '브리지 중지');
      await stopBridge('Stopped by user');
      writeJson(res, 200, { ok: true, bridge: bridgeStatus() });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/status/bedrock') {
      assertOperator(req, 'Bedrock UDP 핑');
      const body = await readJson(req);
      const status = await pingTarget(body.target || body);
      writeJson(res, 200, { ok: true, status });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status/bedrock') {
      assertOperator(req, 'Bedrock UDP 핑');
      const status = await pingTarget({
        host: url.searchParams.get('host'),
        port: Number(url.searchParams.get('port') || 19132),
        name: url.searchParams.get('name') || url.searchParams.get('host'),
      });
      writeJson(res, 200, { ok: true, status });
      return;
    }

    if (!url.pathname.startsWith('/api/') && (await serveStatic(req, res, url))) {
      return;
    }

    writeJson(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    pushEvent('error', error.message || 'request failed');
    writeJson(res, error.status || 400, { ok: false, error: error.message || '요청 처리 실패' });
  }
}

function startPrewarm() {
  if (!prewarmEnabled) {
    return;
  }

  refreshUnifiedFeed({ includeXbox: prewarmXboxEnabled, xboxLimit: 250 });
  const interval = setInterval(() => {
    refreshUnifiedFeed({ includeXbox: prewarmXboxEnabled, xboxLimit: 250 });
  }, Math.max(5_000, publicFeedCacheMs));

  interval.unref?.();
}

const api = http.createServer(route);

api.listen(apiPort, apiHost, () => {
  console.log(`Luma listening on http://${apiHost}:${apiPort}`);
  console.log(`Static dist: ${serveStaticEnabled ? distDir : 'disabled'}`);
  console.log(`Bedrock LAN bridge port: ${bridgePort}/udp`);
  startPrewarm();
});

process.on('SIGINT', async () => {
  await stopBridge('SIGINT');
  api.close(() => process.exit(0));
});
