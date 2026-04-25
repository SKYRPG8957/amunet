import {
  BadgeCheck,
  CheckCircle2,
  Clipboard,
  Copy,
  Dice5,
  Download,
  ExternalLink,
  Filter,
  Gamepad2,
  KeyRound,
  Loader2,
  LogOut,
  MessageSquare,
  MoonStar,
  Play,
  Power,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Square,
  Sun,
  UserRound,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Capacitor } from '@capacitor/core';
import type {
  ActivityWorld,
  BedrockStatus,
  BridgeStatus,
  FeaturedTarget,
  HostPresence,
  ProxyPassStatus,
  TrackedXuid,
  WorldProviderStatus,
  XboxStatus,
} from './types';
import {
  addTrackedXuid,
  loadCommunityMessages,
  getCloudUser,
  isBackendConfigured,
  loadTrackedXuids,
  onCloudAuthChange,
  removeTrackedXuid,
  sendCommunityMessage,
  signInCloud,
  signInGuestCloud,
  signInOAuthCloud,
  signInPasswordCloud,
  signOutCloud,
  type CommunityMessage,
  type CloudUser,
  type OAuthProvider,
} from './lib/cloudStore';
import { supabaseAnonKey, supabaseUrl } from './lib/supabase';
import { APP_VERSION } from './version';
import './styles.css';

type Tab = 'servers' | 'community' | 'profile' | 'admin';
type SortMode = 'recommended' | 'latest' | 'players' | 'korean';
type SourceMode = 'all' | 'eggnet' | 'luma';
type CountryMode = 'all' | 'KR' | 'US' | 'JP' | 'CN' | 'GLOBAL' | 'OTHER';
type AuthMode = 'login' | 'signup';
type OAuthButton = {
  id: OAuthProvider;
  label: string;
  short: string;
};
type OAuthAvailability = Record<OAuthProvider, boolean>;
type ReleaseInfo = {
  loading: boolean;
  error: string | null;
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string;
  windowsUrl: string;
  androidUrl: string;
  updateAvailable: boolean;
  currentBuildPending: boolean;
};
type BridgeTargetInput = {
  id?: string;
  name: string;
  host: string;
  port: number;
  protocol?: number;
  version?: string;
};
type ApiState<T> = {
  loading: boolean;
  error: string | null;
  value: T;
};
type ResolvedXboxProfile = {
  xuid: string;
  gamertag: string;
  source?: string;
  title?: string;
};
type RuntimeCapabilities = {
  supabaseCache: boolean;
  supabaseEdge: boolean;
  static: boolean;
  bridge: boolean;
  proxyPass: boolean;
  xboxLogin: boolean;
  bedrockPing: boolean;
};

const emptyBridge: BridgeStatus = {
  running: false,
  target: null,
  bridgePort: 19132,
  version: '',
  lanAddresses: [],
  clients: [],
  events: [],
};

const emptyProxyPass: ProxyPassStatus = {
  running: false,
  ready: false,
  phase: 'idle',
  error: null,
  target: null,
  proxyHost: '127.0.0.1',
  proxyPort: 19132,
  joinUri: null,
  authUri: null,
  authCode: null,
  javaPath: null,
  jarPath: null,
  workDir: null,
  localAddresses: [],
  logs: [],
};

const emptyXbox: XboxStatus = {
  signedIn: false,
  xuid: null,
  expiresOn: null,
  pending: false,
  code: null,
  verificationUri: null,
  message: null,
  error: null,
};

const defaultCapabilities: RuntimeCapabilities = {
  supabaseCache: false,
  supabaseEdge: false,
  static: false,
  bridge: false,
  proxyPass: false,
  xboxLogin: false,
  bedrockPing: false,
};

const defaultTarget = {
  name: 'Custom Server',
  host: '',
  port: 19132,
};

const WORLD_CACHE_KEY = 'luma:world-feed:v1';
const PRESENCE_CACHE_KEY = 'luma:presence-feed:v1';
const ADMIN_KEY_STORAGE_KEY = 'luma:admin-key:v1';
const THEME_STORAGE_KEY = 'luma:theme:v2';
const WORLD_CACHE_MS = 45_000;
const PRESENCE_CACHE_MS = 120_000;
const LOCAL_API_BASE = 'http://127.0.0.1:8787';
const isNativeShellRuntime =
  typeof window !== 'undefined' && (window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
    ? true
    : typeof window !== 'undefined' && Boolean((window as typeof window & { __TAURI__?: unknown }).__TAURI__);
const configuredApiBase = (import.meta.env.VITE_STATUS_API_URL?.trim() || '').replace(/\/$/, '');
const supabaseEdgeApiBase = isBackendConfigured ? `${supabaseUrl.replace(/\/$/, '')}/functions/v1/amunet-api` : '';
const apiBase = (configuredApiBase || supabaseEdgeApiBase).replace(/\/$/, '');
const defaultReleaseAssets = {
  windows: 'https://github.com/SKYRPG8957/amunet/releases/latest/download/luma-arcade-windows-setup.exe',
  android: 'https://github.com/SKYRPG8957/amunet/releases/latest/download/luma-arcade-android-debug.apk',
  releases: 'https://github.com/SKYRPG8957/amunet/releases/latest',
};
const downloadLinks = {
  windows: import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim() || defaultReleaseAssets.windows,
  android: import.meta.env.VITE_ANDROID_DOWNLOAD_URL?.trim() || defaultReleaseAssets.android,
  releases: import.meta.env.VITE_RELEASES_URL?.trim() || defaultReleaseAssets.releases,
};

const COUNTRY_OPTIONS: Array<{ id: CountryMode; label: string }> = [
  { id: 'all', label: '전체 국가' },
  { id: 'KR', label: '한국' },
  { id: 'US', label: '영미권' },
  { id: 'JP', label: '일본' },
  { id: 'CN', label: '중국어권' },
  { id: 'GLOBAL', label: '글로벌' },
  { id: 'OTHER', label: '기타' },
];

const OAUTH_BUTTONS: OAuthButton[] = [
  { id: 'google', label: 'Google로 계속', short: 'G' },
  { id: 'azure', label: 'Microsoft로 계속', short: 'M' },
  { id: 'discord', label: 'Discord로 계속', short: 'D' },
  { id: 'github', label: 'GitHub로 계속', short: 'GH' },
];

const defaultOAuthAvailability: OAuthAvailability = {
  google: false,
  azure: false,
  discord: false,
  github: false,
};

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : '요청 처리 중 오류가 발생했습니다.';
}

function withTimeout(init?: RequestInit, timeoutMs = 2500): RequestInit {
  if (init?.signal) return init;
  return {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  };
}

function prefersLocalApi(url: string) {
  return /^\/api\/(health|bridge|proxypass|xbox|status\/bedrock|worlds\/discover|join\/simple)/.test(url);
}

function localOnlyApi(url: string) {
  return /^\/api\/(bridge|proxypass|xbox|status\/bedrock|worlds\/discover)/.test(url);
}

function shouldProbeLocalApi(url: string) {
  if (url.startsWith('http')) return false;
  if (localOnlyApi(url)) return true;
  return isNativeShellRuntime && prefersLocalApi(url);
}

function requestTimeoutMs(url: string, endpoint: string) {
  if (!endpoint.startsWith(LOCAL_API_BASE)) return 10_000;
  if (url.startsWith('/api/proxypass/start')) return 240_000;
  if (url.startsWith('/api/bridge/start')) return 12_000;
  if (url.startsWith('/api/status/bedrock')) return 10_000;
  if (url.startsWith('/api/worlds/')) return 20_000;
  return 2500;
}

function localOnlyError(url: string, reason: string) {
  if (url.startsWith('/api/proxypass')) {
    return `PC 앱 브리지가 구버전이거나 꺼져 있습니다. 최신 Windows 앱을 설치한 뒤 앱을 완전히 다시 열어주세요. (${reason})`;
  }
  return `PC 앱 브리지에서만 실행할 수 있는 기능입니다. 최신 앱을 실행해 주세요. (${reason})`;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = {
    Accept: 'application/json',
    ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers || {}),
  };
  const isLocalOnly = !url.startsWith('http') && localOnlyApi(url);
  const useLocalApi = shouldProbeLocalApi(url);
  const endpoints = url.startsWith('http')
    ? [url]
    : isLocalOnly
      ? [`${LOCAL_API_BASE}${url}`]
    : [
        ...(useLocalApi && `${LOCAL_API_BASE}${url}` !== `${apiBase}${url}` ? [`${LOCAL_API_BASE}${url}`] : []),
        apiBase ? `${apiBase}${url}` : url,
      ];
  let lastError: unknown = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        ...withTimeout(init, requestTimeoutMs(url, endpoint)),
        headers,
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok || payload.ok === false) {
        if (isLocalOnly && endpoint.startsWith(LOCAL_API_BASE)) {
          throw new Error(localOnlyError(url, response.status === 404 ? '앱 API 업데이트 필요' : payload.error || response.statusText));
        }
        throw new Error(payload.error || response.statusText);
      }

      return payload as T;
    } catch (error) {
      lastError = error;
      if (isLocalOnly) break;
      if (!endpoint.startsWith(LOCAL_API_BASE)) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('요청 처리 중 오류가 발생했습니다.');
}

function parseVersion(version: string) {
  return version
    .replace(/^v/i, '')
    .split(/[+-]/)[0]
    .split('.')
    .map((part) => Number(part) || 0);
}

function compareVersions(a: string, b: string) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function assetUrl(assets: Array<{ name: string; browser_download_url: string }>, pattern: RegExp, fallback: string) {
  return assets.find((asset) => pattern.test(asset.name))?.browser_download_url || fallback;
}

function readCachedPayload<T>(key: string): { savedAtMs: number; payload: T } | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as { savedAtMs: number; payload: T }) : null;
  } catch {
    return null;
  }
}

function writeCachedPayload<T>(key: string, payload: T) {
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        savedAtMs: Date.now(),
        payload,
      }),
    );
  } catch {
    // Storage can be unavailable in private browsing.
  }
}

function relativeTime(ms: number) {
  const diff = Math.max(0, Date.now() - ms);
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s 전`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function formatAddress(target: { host: string; port: number }) {
  return `${target.host}:${target.port}`;
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`status-dot ${active ? 'active' : ''}`} />;
}

function sourceLabel(source?: string) {
  const value = (source || '').toLowerCase();
  if (value.includes('amunet') || value.includes('luma') || value.includes('sessiondirectory')) return 'Luma';
  if (value.includes('eggnet')) return 'Eggnet';
  return source || 'feed';
}

function providerLabel(name: string) {
  return name.replace(/Amunet/gi, 'Luma');
}

function countryForWorld(world: ActivityWorld): CountryMode {
  const langs = [world.language, ...(world.languages || [])].filter(Boolean).map((item) => String(item).toLowerCase());
  const text = `${world.title} ${world.ownerGamertag || ''} ${world.hostName || ''}`.toLowerCase();

  if (langs.some((lang) => lang.startsWith('ko')) || /한국|한성|서버|야생/.test(text)) return 'KR';
  if (langs.some((lang) => lang.startsWith('ja')) || /日本|にほん|サーバ/.test(text)) return 'JP';
  if (langs.some((lang) => lang.startsWith('zh')) || /中国|中國|汉|漢/.test(text)) return 'CN';
  if (langs.some((lang) => lang.startsWith('en'))) return 'US';
  if (!langs.length || langs.includes('unknown')) return 'GLOBAL';
  return 'OTHER';
}

function countryLabel(country: string) {
  return COUNTRY_OPTIONS.find((item) => item.id === country)?.label || country || '글로벌';
}

function isAdminRoute() {
  const url = new URL(window.location.href);
  return url.pathname === '/admin' || url.searchParams.get('admin') === '1' || url.hash === '#admin';
}

function isTauriDesktop() {
  return Boolean((window as typeof window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function platformDownload() {
  const ua = window.navigator.userAgent;
  if (/Android/i.test(ua)) {
    return {
      platform: 'Android',
      href: downloadLinks.android,
      label: 'Android APK 다운로드',
    };
  }
  return {
    platform: 'Windows',
    href: downloadLinks.windows,
    label: 'Windows 앱 다운로드',
  };
}

function worldBridgeTarget(world: ActivityWorld): BridgeTargetInput | null {
  if (!world.host || !world.port) return null;
  return {
    id: world.id || world.handleId || `${world.host}:${world.port}`,
    name: world.title || world.hostName || world.host,
    host: world.host,
    port: world.port,
    protocol: world.protocol || undefined,
    version: world.version || undefined,
  };
}

function worldProxyTarget(world: ActivityWorld) {
  const nethernetId = String(world.nethernetId || '').trim();
  if (!nethernetId) return null;
  return {
    id: world.id || world.handleId || nethernetId,
    name: world.title || world.ownerGamertag || 'Minecraft World',
    handleId: world.handleId,
    nethernetId,
    protocol: world.protocol || undefined,
    version: world.version || undefined,
  };
}

function minecraftLocalServerUri(name: string, port: number) {
  return `minecraft://?addExternalServer=${encodeURIComponent(`${name || 'Luma Proxy'}|127.0.0.1:${port}`)}`;
}

function minecraftLaunchUri() {
  return 'minecraft://';
}

function App() {
  const [adminMode] = useState(() => isAdminRoute());
  const [tab, setTab] = useState<Tab>(() => (isAdminRoute() ? 'admin' : 'servers'));
  const isDesktopApp = isTauriDesktop();
  const runtimeClass = isDesktopApp
    ? 'native-windows'
    : Capacitor.isNativePlatform()
    ? `native-${Capacitor.getPlatform()}`
    : /Android/i.test(window.navigator.userAgent)
      ? 'web-android'
      : 'web-desktop';
  const preferredDownload = platformDownload();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recommended');
  const [sourceMode, setSourceMode] = useState<SourceMode>('all');
  const [countryMode, setCountryMode] = useState<CountryMode>('all');
  const [providers, setProviders] = useState<WorldProviderStatus[]>([]);
  const [worlds, setWorlds] = useState<ApiState<ActivityWorld[]>>({
    loading: true,
    error: null,
    value: [],
  });
  const [presence, setPresence] = useState<ApiState<HostPresence[]>>({
    loading: true,
    error: null,
    value: [],
  });
  const [chat, setChat] = useState<ApiState<CommunityMessage[]>>({
    loading: true,
    error: null,
    value: [],
  });
  const [chatInput, setChatInput] = useState('');
  const [chatCountry, setChatCountry] = useState<CountryMode>('KR');
  const [featured, setFeatured] = useState<ApiState<FeaturedTarget[]>>({
    loading: true,
    error: null,
    value: [],
  });
  const [bridge, setBridge] = useState<BridgeStatus>(emptyBridge);
  const [proxyPass, setProxyPass] = useState<ProxyPassStatus>(emptyProxyPass);
  const [autoOpenProxyJoin, setAutoOpenProxyJoin] = useState(false);
  const [xbox, setXbox] = useState<XboxStatus>(emptyXbox);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities>(defaultCapabilities);
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [oauthEnabled, setOauthEnabled] = useState<OAuthAvailability>(defaultOAuthAvailability);
  const [oauthChecked, setOauthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authOpen, setAuthOpen] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo>({
    loading: true,
    error: null,
    currentVersion: APP_VERSION,
    latestVersion: null,
    latestUrl: downloadLinks.releases,
    windowsUrl: downloadLinks.windows,
    androidUrl: downloadLinks.android,
    updateAvailable: false,
    currentBuildPending: false,
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      // Ignore storage failures.
    }
    return 'light';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [trackInput, setTrackInput] = useState('');
  const [tracked, setTracked] = useState<TrackedXuid[]>([]);
  const [target, setTarget] = useState(defaultTarget);
  const [statusByTarget, setStatusByTarget] = useState<Record<string, BedrockStatus | null>>({});
  const [joinTarget, setJoinTarget] = useState<ActivityWorld | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [adminKey, setAdminKey] = useState(() => {
    try {
      return window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const activeDownload = {
    platform: preferredDownload.platform,
    href: preferredDownload.platform === 'Android' ? release.androidUrl : release.windowsUrl,
    label: preferredDownload.label,
  };
  const alternateDownload = {
    platform: preferredDownload.platform === 'Android' ? 'Windows' : 'Android',
    href: preferredDownload.platform === 'Android' ? release.windowsUrl : release.androidUrl,
    label: preferredDownload.platform === 'Android' ? 'Windows 파일' : 'Android APK',
  } as const;

  useEffect(() => {
    refreshHealth();
    refreshCloud();
    if (adminMode) {
      loadFeatured();
      loadPresence();
    }
    loadWorlds();
    loadChat();
    loadOAuthAvailability();
    loadReleaseInfo();
    const id = isDesktopApp ? window.setInterval(refreshBridge, 2200) : null;
    return () => {
      if (id) window.clearInterval(id);
    };
  }, [adminMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage failures.
    }
  }, [theme]);

  useEffect(() => {
    const subscription = onCloudAuthChange((user) => {
      setCloudUser(user);
      if (user || adminMode) {
        loadTracked().catch((error) => setToast(messageFrom(error)));
      }
    });

    return () => subscription?.unsubscribe();
  }, [adminMode]);

  useEffect(() => {
    if (!xbox.pending || xbox.signedIn) return;
    const id = window.setInterval(refreshXbox, 2500);
    return () => window.clearInterval(id);
  }, [xbox.pending, xbox.signedIn]);

  useEffect(() => {
    if (!autoOpenProxyJoin) return;

    if (proxyPass.error) {
      setAutoOpenProxyJoin(false);
      return;
    }

    if (proxyPass.ready && proxyPass.joinUri) {
      setAutoOpenProxyJoin(false);
      window.location.assign(minecraftLaunchUri());
      setToast('Minecraft 친구 탭의 LAN 월드에서 Luma를 선택하세요.');
    }
  }, [autoOpenProxyJoin, proxyPass.error, proxyPass.joinUri, proxyPass.ready]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const filteredWorlds = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const sourced =
      sourceMode === 'all'
        ? worlds.value
        : worlds.value.filter((world) =>
            sourceMode === 'eggnet'
              ? (world.source || '').toLowerCase().includes('eggnet') || world.serverId
              : (world.source || '').toLowerCase().includes('amunet') ||
                (world.source || '').toLowerCase().includes('luma') ||
                (world.source || '').toLowerCase().includes('sessiondirectory'),
          );

    const countried =
      countryMode === 'all'
        ? sourced
        : sourced.filter((world) => {
            const country = countryForWorld(world);
            return countryMode === country;
          });

    const searched = needle
      ? countried.filter((world) =>
          [
            world.title,
            world.hostName,
            world.ownerGamertag,
            world.worldType,
            world.version,
            world.ownerXuid,
            world.language,
            world.source,
            countryLabel(countryForWorld(world)),
          ]
            .join(' ')
            .toLowerCase()
            .includes(needle),
        )
      : countried;

    return [...searched].sort((a, b) => {
      if (sort === 'latest') return b.updatedAtMs - a.updatedAtMs;
      if (sort === 'players') return b.members - a.members;
      if (sort === 'korean') {
        const ak = a.language === 'ko' ? 1 : 0;
        const bk = b.language === 'ko' ? 1 : 0;
        if (ak !== bk) return bk - ak;
      }

      const aKo = a.language === 'ko' ? 1 : 0;
      const bKo = b.language === 'ko' ? 1 : 0;
      if (aKo !== bKo) return bKo - aKo;
      if (a.closed !== b.closed) return a.closed ? 1 : -1;
      const aBridgeable = a.host && a.port ? 1 : 0;
      const bBridgeable = b.host && b.port ? 1 : 0;
      if (aBridgeable !== bBridgeable) return bBridgeable - aBridgeable;
      return b.members - a.members || b.updatedAtMs - a.updatedAtMs;
    });
  }, [countryMode, query, sort, sourceMode, worlds.value]);

  const selectedWorld = useMemo(() => filteredWorlds[0] || worlds.value[0] || null, [filteredWorlds, worlds.value]);
  const countryCounts = useMemo(() => {
    const counts = new Map<CountryMode, number>();
    for (const world of worlds.value) {
      const country = countryForWorld(world);
      counts.set(country, (counts.get(country) || 0) + 1);
    }
    return counts;
  }, [worlds.value]);

  const visiblePlayers = useMemo(() => worlds.value.reduce((sum, world) => sum + Math.max(0, world.members || 0), 0), [worlds.value]);
  const openWorlds = useMemo(() => worlds.value.filter((world) => !world.closed).length, [worlds.value]);
  const activeCountryCount = useMemo(() => Array.from(countryCounts.values()).filter((count) => count > 0).length, [countryCounts]);
  const accountName = cloudUser?.displayName || cloudUser?.email?.split('@')[0] || '게스트';
  const profileSignedIn = Boolean(cloudUser) || xbox.signedIn;
  const profileName = cloudUser ? accountName : xbox.signedIn ? 'Xbox 연동됨' : '로그아웃됨';
  const profileStatus = cloudUser ? 'Luma 로그인됨' : xbox.signedIn ? 'Xbox 연동됨' : '로그아웃됨';
  const hasOAuthProvider = OAUTH_BUTTONS.some((provider) => oauthEnabled[provider.id]);

  async function refreshHealth(operatorKey = adminKey) {
    try {
      const payload = await requestJson<{
        bridge: BridgeStatus;
        proxypass?: ProxyPassStatus;
        xbox: XboxStatus;
        capabilities?: Partial<RuntimeCapabilities>;
      }>('/api/health', {
        headers: operatorHeaders(operatorKey),
      });
      setBridge(payload.bridge);
      if (payload.proxypass) setProxyPass(payload.proxypass);
      setXbox(payload.xbox);
      setCapabilities({ ...defaultCapabilities, ...(payload.capabilities || {}) });
    } catch (error) {
      setToast(messageFrom(error));
    }
  }

  async function refreshBridge() {
    try {
      const payload = await requestJson<{ bridge: BridgeStatus; proxypass?: ProxyPassStatus }>('/api/health', {
        headers: operatorHeaders(),
      });
      setBridge(payload.bridge);
      if (payload.proxypass) setProxyPass(payload.proxypass);
    } catch {
      // Local API may still be booting.
    }
  }

  async function refreshXbox() {
    try {
      const payload = await requestJson<{ xbox: XboxStatus }>('/api/xbox/login/status', {
        headers: operatorHeaders(),
      });
      setXbox(payload.xbox);
    } catch (error) {
      setToast(messageFrom(error));
    }
  }

  async function refreshCloud() {
    try {
      const user = await getCloudUser();
      setCloudUser(user);
      if (user || adminMode) {
        await loadTracked();
      }
    } catch (error) {
      setToast(messageFrom(error));
    }
  }

  async function loadTracked() {
    const items = await loadTrackedXuids();
    setTracked(items);
    return items;
  }

  async function loadOAuthAvailability() {
    if (!isBackendConfigured) {
      setOauthChecked(true);
      return;
    }

    try {
      const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
      });
      const payload = (await response.json()) as { external?: Partial<Record<OAuthProvider, boolean>> };
      setOauthEnabled({
        google: Boolean(payload.external?.google),
        azure: Boolean(payload.external?.azure),
        discord: Boolean(payload.external?.discord),
        github: Boolean(payload.external?.github),
      });
    } catch {
      setOauthEnabled(defaultOAuthAvailability);
    } finally {
      setOauthChecked(true);
    }
  }

  async function loadReleaseInfo() {
    setRelease((current) => ({ ...current, loading: true, error: null }));

    try {
      const response = await fetch('https://api.github.com/repos/SKYRPG8957/amunet/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        tag_name?: string;
        html_url?: string;
        assets?: Array<{ name: string; browser_download_url: string }>;
      };

      if (!response.ok) {
        throw new Error(`GitHub Release ${response.status}`);
      }

      const latestVersion = (payload.tag_name || '').replace(/^v/i, '') || null;
      const assets = payload.assets || [];
      const windowsUrl = assetUrl(assets, /windows.*(setup|installer).*\.exe$/i, downloadLinks.windows);
      const androidUrl = assetUrl(assets, /android.*\.apk$/i, downloadLinks.android);
      const versionDiff = latestVersion ? compareVersions(latestVersion, APP_VERSION) : 0;

      setRelease({
        loading: false,
        error: null,
        currentVersion: APP_VERSION,
        latestVersion,
        latestUrl: payload.html_url || downloadLinks.releases,
        windowsUrl,
        androidUrl,
        updateAvailable: versionDiff > 0,
        currentBuildPending: versionDiff < 0,
      });
    } catch (error) {
      setRelease((current) => ({
        ...current,
        loading: false,
        error: messageFrom(error),
      }));
    }
  }

  function openAuth(mode: AuthMode = 'login') {
    setAuthMode(mode);
    setAuthOpen(true);
    setTab('profile');
  }

  function requireCloudAuth(message = 'Luma 계정으로 로그인하세요.') {
    if (!isBackendConfigured || cloudUser) return false;
    setToast(message);
    openAuth('login');
    return true;
  }

  async function loadWorlds(force = false, refreshKey = '') {
    type WorldsPayload = { worlds: ActivityWorld[]; count?: number; providers?: WorldProviderStatus[] };
    const cached = !force ? readCachedPayload<WorldsPayload>(WORLD_CACHE_KEY) : null;

    if (cached?.payload.worlds?.length) {
      setWorlds({ loading: false, error: null, value: cached.payload.worlds });
      setProviders(cached.payload.providers || []);

      if (Date.now() - cached.savedAtMs < WORLD_CACHE_MS) {
        return;
      }
    }

    setWorlds((current) => ({ ...current, loading: true, error: null }));

    try {
      const payload = await requestJson<WorldsPayload>(`/api/worlds/live${force ? '?force=1' : ''}`, {
        headers: refreshKey ? { 'x-amunet-admin-key': refreshKey } : undefined,
      });
      setWorlds({ loading: false, error: null, value: payload.worlds });
      setProviders(payload.providers || []);
      writeCachedPayload(WORLD_CACHE_KEY, payload);
    } catch (error) {
      setWorlds({ loading: false, error: messageFrom(error), value: [] });
    }
  }

  async function loadPresence() {
    type PresencePayload = { hosts: HostPresence[] };
    const cached = readCachedPayload<PresencePayload>(PRESENCE_CACHE_KEY);

    if (cached?.payload.hosts?.length) {
      setPresence({ loading: false, error: null, value: cached.payload.hosts });

      if (Date.now() - cached.savedAtMs < PRESENCE_CACHE_MS) {
        return;
      }
    }

    setPresence((current) => ({ ...current, loading: true, error: null }));

    try {
      const payload = await requestJson<{ hosts: HostPresence[] }>('/api/community/presence');
      setPresence({ loading: false, error: null, value: payload.hosts });
      writeCachedPayload(PRESENCE_CACHE_KEY, payload);
    } catch (error) {
      setPresence({ loading: false, error: messageFrom(error), value: [] });
    }
  }

  async function loadChat() {
    setChat((current) => ({ ...current, loading: true, error: null }));

    try {
      setChat({ loading: false, error: null, value: await loadCommunityMessages('global') });
    } catch (error) {
      setChat({ loading: false, error: messageFrom(error), value: [] });
    }
  }

  async function sendChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requireCloudAuth('채팅은 Luma 계정 로그인 후 사용할 수 있습니다.')) return;
    setBusyAction('chat-send');

    try {
      setChat({ loading: false, error: null, value: await sendCommunityMessage(chatInput, chatCountry, 'global') });
      setChatInput('');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function forceRefreshWorlds() {
    if (!adminKey.trim()) {
      setToast('관리자 키를 먼저 입력하세요.');
      return;
    }

    setBusyAction('admin-refresh-worlds');
    try {
      await loadWorlds(true, adminKey.trim());
    } finally {
      setBusyAction(null);
    }
  }

  function saveAdminKey(value: string) {
    setAdminKey(value);
    try {
      if (value.trim()) {
        window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, value.trim());
      } else {
        window.localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
      }
    } catch {
      // Ignore local storage failures.
    }
    if (adminMode) {
      refreshHealth(value.trim()).catch((error) => setToast(messageFrom(error)));
    }
  }

  function operatorHeaders(value = adminKey): HeadersInit | undefined {
    const key = value.trim();
    return key ? { 'x-amunet-admin-key': key } : undefined;
  }

  async function loadFeatured() {
    setFeatured((current) => ({ ...current, loading: true, error: null }));

    try {
      const payload = await requestJson<{ targets: FeaturedTarget[] }>('/api/targets/featured');
      setFeatured({ loading: false, error: null, value: payload.targets });
    } catch (error) {
      setFeatured({ loading: false, error: messageFrom(error), value: [] });
    }
  }

  async function continueJoin(world: ActivityWorld) {
    setBusyAction(`join:${world.handleId}`);

    try {
      const proxyTarget = worldProxyTarget(world);
      if (proxyTarget) {
        if (!capabilities.proxyPass) {
          setToast('Eggnet 월드 참가는 최신 Windows 앱 브리지가 필요합니다. 앱을 업데이트하고 다시 실행해 주세요.');
          setTab('profile');
          return;
        }

        const payload = await requestJson<{ proxypass: ProxyPassStatus }>('/api/proxypass/start', {
          method: 'POST',
          headers: operatorHeaders(),
          body: JSON.stringify({ target: proxyTarget, broadcastSession: true }),
        });
        setProxyPass(payload.proxypass);
        setAutoOpenProxyJoin(true);
        setJoinTarget(null);

        if (payload.proxypass.ready && payload.proxypass.joinUri) {
          window.location.assign(minecraftLaunchUri());
          setToast('Minecraft 친구 탭의 LAN 월드에서 Luma를 선택하세요.');
          return;
        }

        if (payload.proxypass.phase === 'auth') {
          if (payload.proxypass.authCode) {
            void navigator.clipboard?.writeText(payload.proxypass.authCode).catch(() => {});
          }
          window.open(payload.proxypass.authUri || 'https://www.microsoft.com/link', '_blank', 'noopener,noreferrer');
          setToast('Microsoft 인증 후 Minecraft 친구 탭의 LAN 월드로 표시됩니다.');
        } else {
          setToast('ProxyPass가 준비되면 Minecraft 친구 탭에 Luma가 표시됩니다.');
        }
        setTab('profile');
        return;
      }

      const bridgeTarget = worldBridgeTarget(world);
      if (bridgeTarget) {
        const payload = await requestJson<{ bridge: BridgeStatus }>('/api/bridge/start', {
          method: 'POST',
          headers: operatorHeaders(),
          body: JSON.stringify(bridgeTarget),
        });
        setBridge(payload.bridge);
        window.location.assign(minecraftLocalServerUri(`Luma - ${bridgeTarget.name}`, payload.bridge.bridgePort));
        setToast('Minecraft 로컬 브리지로 여는 중입니다.');
        setJoinTarget(null);
        return;
      }

      const joinUri = world.uri || `minecraft://activityHandleJoin/?handle=${encodeURIComponent(world.handleId)}`;
      window.location.assign(joinUri);
      window.setTimeout(() => {
        setToast('Minecraft가 열리지 않으면 설치 앱에서 Xbox 연동 후 다시 시도하세요.');
      }, 900);
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
      setJoinTarget(null);
    }
  }

  async function openJoinTarget(world: ActivityWorld) {
    setJoinTarget(world);

    try {
      const payload = await requestJson<{ handleId: string; joinUri: string }>('/api/join/simple', {
        method: 'POST',
        body: JSON.stringify({
          serverId: world.serverId || world.id,
        }),
      });
      if (payload.handleId || payload.joinUri) {
        setJoinTarget({
          ...world,
          handleId: payload.handleId || world.handleId,
          uri: payload.joinUri || world.uri,
        });
      }
    } catch {
      // Keep the selected feed item if refresh fails.
    }
  }

  async function randomJoin() {
    if (!filteredWorlds.length) {
      setToast('참가 가능한 월드가 없습니다.');
      return;
    }

    await openJoinTarget(filteredWorlds[Math.floor(Math.random() * filteredWorlds.length)]);
  }

  async function startXboxLogin() {
    if (!capabilities.xboxLogin) {
      setToast('클라우드 Edge 모드에서는 Xbox device-code 로그인을 실행할 수 없습니다.');
      return;
    }

    setBusyAction('xbox-login');

    try {
      const payload = await requestJson<{ xbox: XboxStatus }>('/api/xbox/login/start', {
        method: 'POST',
        headers: operatorHeaders(),
      });
      setXbox(payload.xbox);
      setToast(payload.xbox.signedIn ? 'Xbox 연동 완료' : 'Microsoft 로그인 코드를 확인하세요.');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function logoutXbox() {
    const payload = await requestJson<{ xbox: XboxStatus }>('/api/xbox/logout', {
      method: 'POST',
      headers: operatorHeaders(),
    });
    setXbox(payload.xbox);
  }

  async function submitCloudAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isBackendConfigured) {
      setToast('온라인 배포 환경에서 Luma 계정을 사용할 수 있습니다.');
      return;
    }

    setBusyAction(`cloud-${authMode}`);

    try {
      if (authMode === 'signup') {
        if (!email.trim()) {
          setToast('이메일을 먼저 입력하세요.');
          return;
        }
        await signInCloud(email);
        setToast('인증 메일을 보냈습니다. 메일 링크를 눌러야 가입/로그인이 완료됩니다.');
        setPassword('');
        return;
      } else {
        if (password.length < 6) {
          setToast('비밀번호는 6자 이상이어야 합니다.');
          return;
        }
        await signInPasswordCloud(email, password);
        setToast('Luma 계정 로그인 완료');
      }
      const nextUser = await getCloudUser();
      setCloudUser(nextUser);
      if (nextUser) setAuthOpen(false);
      setPassword('');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setToast('이메일을 먼저 입력하세요.');
      return;
    }

    setBusyAction('cloud-link');

    try {
      await signInCloud(email);
      setToast('로그인 링크를 메일로 보냈습니다.');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function continueAsGuest() {
    const user = signInGuestCloud();
    setCloudUser(user);
    setAuthOpen(false);
    setToast('게스트 로그인 완료');
    setTab('servers');
    setTracked(await loadTrackedXuids());
  }

  async function startOAuth(provider: OAuthProvider) {
    if (!oauthEnabled[provider]) {
      setToast('Supabase Auth에서 이 로그인 제공자를 먼저 켜야 합니다.');
      return;
    }

    setBusyAction(`oauth-${provider}`);

    try {
      await signInOAuthCloud(provider);
    } catch (error) {
      setToast(messageFrom(error));
      setBusyAction(null);
    }
  }

  async function signOutSupabase() {
    setBusyAction('supabase-logout');

    try {
      await signOutCloud();
      setCloudUser(null);
      setPassword('');
      setTracked(await loadTrackedXuids());
      setToast('Luma 계정 로그아웃 완료');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function saveTrackedXuid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requireCloudAuth('친구 프로필 저장은 Luma 계정 로그인 후 사용할 수 있습니다.')) return;
    const lookup = trackInput.trim();
    setBusyAction('track-profile');

    try {
      if (!lookup) return;

      if (/^[0-9]{6,20}$/.test(lookup)) {
        setTracked(await addTrackedXuid(lookup));
        setToast('프로필을 저장했습니다.');
        setTrackInput('');
        return;
      }

      const payload = await requestJson<{ profile: ResolvedXboxProfile }>(
        `/api/xbox/resolve?gamertag=${encodeURIComponent(lookup)}`,
      );
      setTracked(await addTrackedXuid(payload.profile.xuid, payload.profile.gamertag));
      setTrackInput('');
      setToast(`${payload.profile.gamertag} 프로필을 저장했습니다.`);
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function deleteTrackedXuid(item: TrackedXuid) {
    setBusyAction(`track-delete:${item.id}`);

    try {
      setTracked(await removeTrackedXuid(item));
      setToast('프로필을 삭제했습니다.');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function pingTarget(item: FeaturedTarget | typeof target) {
    if (!capabilities.bedrockPing) {
      setToast('클라우드 Edge 모드에서는 Bedrock UDP 핑을 실행할 수 없습니다.');
      return;
    }

    const key = formatAddress(item);
    setBusyAction(`ping:${key}`);

    try {
      const payload = await requestJson<{ status: BedrockStatus }>('/api/status/bedrock', {
        method: 'POST',
        headers: operatorHeaders(),
        body: JSON.stringify(item),
      });
      setStatusByTarget((current) => ({ ...current, [key]: payload.status }));
      setToast(`${item.name} 상태 확인 완료`);
    } catch (error) {
      setStatusByTarget((current) => ({ ...current, [key]: null }));
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function startBridge(item: FeaturedTarget | typeof target) {
    if (!capabilities.bridge) {
      setToast('LAN/Friends 브리지는 같은 네트워크의 Node/VPS 헬퍼가 필요합니다.');
      return;
    }

    setBusyAction(`bridge:${formatAddress(item)}`);

    try {
      const payload = await requestJson<{ bridge: BridgeStatus }>('/api/bridge/start', {
        method: 'POST',
        headers: operatorHeaders(),
        body: JSON.stringify(item),
      });
      setBridge(payload.bridge);
      setToast('LAN/Friends 브리지를 시작했습니다.');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function stopBridge() {
    setBusyAction('bridge-stop');

    try {
      const payload = await requestJson<{ bridge: BridgeStatus }>('/api/bridge/stop', {
        method: 'POST',
        headers: operatorHeaders(),
      });
      setBridge(payload.bridge);
      setToast('브리지를 중지했습니다.');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function stopProxyPass() {
    setBusyAction('proxypass-stop');

    try {
      const payload = await requestJson<{ proxypass: ProxyPassStatus }>('/api/proxypass/stop', {
        method: 'POST',
        headers: operatorHeaders(),
      });
      setProxyPass(payload.proxypass);
      setToast('ProxyPass를 중지했습니다.');
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function copyText(value: string, label = '복사 완료') {
    await navigator.clipboard?.writeText(value);
    setToast(label);
  }

  function downloadFile(href: string, platform: 'Windows' | 'Android') {
    if (!href) {
      setToast(`${platform} 다운로드 파일을 찾지 못했습니다.`);
      return;
    }
    if (release.currentBuildPending) {
      setToast(`v${release.currentVersion} 설치 파일 빌드가 아직 latest에 반영되지 않았습니다.`);
      return;
    }
    window.location.href = href;
  }

  return (
    <div className={`luma-app eggnet-app ${runtimeClass}`} data-theme={theme}>
      <aside className="rail">
        <button className="rail-brand" type="button" onClick={() => setTab('servers')} aria-label="Luma 홈">
          <span className="brand-mark" />
          <div>
            <strong>Luma Arcade</strong>
            <small>Bedrock arcade</small>
          </div>
        </button>
        <nav className="rail-nav" aria-label="Luma navigation">
          <button className={tab === 'servers' ? 'active' : ''} type="button" onClick={() => setTab('servers')}>
            <Server size={19} />
            <span>서버</span>
          </button>
          <button className={tab === 'community' ? 'active' : ''} type="button" onClick={() => setTab('community')}>
            <MessageSquare size={19} />
            <span>채팅</span>
          </button>
          <button className={tab === 'profile' ? 'active' : ''} type="button" onClick={() => setTab('profile')}>
            <UserRound size={19} />
            <span>계정</span>
          </button>
          {adminMode ? (
            <button className={tab === 'admin' ? 'active' : ''} type="button" onClick={() => setTab('admin')}>
              <ShieldCheck size={19} />
              <span>관리</span>
            </button>
          ) : null}
        </nav>
        <button
          className="theme-toggle"
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
        >
          {theme === 'dark' ? <Sun size={18} /> : <MoonStar size={18} />}
        </button>
        <div className="rail-status">
          <StatusDot active={!worlds.error} />
          <span>{capabilities.supabaseEdge ? 'Edge online' : 'Local mode'}</span>
        </div>
      </aside>

      <main className="shell">
        {tab === 'servers' ? (
          <>
            <section className="arcade-directory">
              <aside className="directory-filter">
                <label className="search-box">
                  <Search size={17} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="월드, 호스트, 태그 검색" />
                </label>
                <select value={countryMode} onChange={(event) => setCountryMode(event.target.value as CountryMode)} aria-label="국가">
                  {COUNTRY_OPTIONS.map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.label}
                    </option>
                  ))}
                </select>
                <select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)} aria-label="소스">
                  <option value="all">전체 피드</option>
                  <option value="eggnet">Eggnet 피드</option>
                  <option value="luma">Luma 피드</option>
                </select>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="정렬">
                  <option value="recommended">추천순</option>
                  <option value="latest">최근 갱신</option>
                  <option value="players">인원 많은순</option>
                  <option value="korean">한국어 우선</option>
                </select>
                <div className="quick-regions">
                  {COUNTRY_OPTIONS.filter((country) => country.id !== 'all').map((country) => (
                    <button key={country.id} type="button" onClick={() => setCountryMode(country.id)}>
                      {country.label}
                      <span>{countryCounts.get(country.id) || 0}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="directory-main">
                <div className="directory-topbar">
                  <div>
                    <span>SERVER DIRECTORY</span>
                    <h1>Bedrock 멀티플레이 월드</h1>
                  </div>
                  <div className="directory-actions">
                    <button className="secondary-button" type="button" onClick={() => loadWorlds(true)} disabled={worlds.loading}>
                      {worlds.loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                      새로고침
                    </button>
                    <button className="secondary-button" type="button" onClick={randomJoin}>
                      <Dice5 size={16} />
                      랜덤 참가
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => downloadFile(activeDownload.href, activeDownload.platform as 'Windows' | 'Android')}
                    >
                      <Download size={16} />
                      앱 받기
                    </button>
                  </div>
                </div>

                <div className="directory-stats">
                  <span>
                    <strong>{filteredWorlds.length.toLocaleString()}</strong>
                    표시 월드
                  </span>
                  <span>
                    <strong>{openWorlds.toLocaleString()}</strong>
                    참가 가능
                  </span>
                  <span>
                    <strong>{visiblePlayers.toLocaleString()}</strong>
                    온라인
                  </span>
                  <span>
                    <strong>{activeCountryCount}</strong>
                    국가권
                  </span>
                </div>

                <div className="provider-strip compact-providers" aria-label="연결된 월드 제공자">
                  {providers.map((provider) => (
                    <div className={provider.ok ? '' : 'error'} key={provider.id}>
                      <strong>{providerLabel(provider.name)}</strong>
                      <span>{provider.requiresLogin ? '연동 필요' : `${provider.count}개`}</span>
                    </div>
                  ))}
                </div>

                {!xbox.signedIn ? (
                  <section className="login-banner eggnet-oauth-banner">
                    <strong>프로필 탭에서 로그인하세요.</strong>
                    <span>Eggnet은 Microsoft 공식 OAuth만 사용하며, Luma는 공개 피드를 먼저 보여주고 계정 기능은 로그인 후 켭니다.</span>
                      <button className="text-button" type="button" onClick={() => openAuth('login')}>
                        로그인 / 앱 설치
                      </button>
                  </section>
                ) : null}

                <div className="search-row eggnet-search-row">
                  <label className="search-box">
                    <Search size={18} />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="서버 검색..." />
                  </label>
                  <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label="정렬">
                    <option value="recommended">추천</option>
                    <option value="latest">최신</option>
                    <option value="players">인원순</option>
                    <option value="korean">한국어 우선</option>
                  </select>
                  <button className="icon-button" type="button" aria-label="필터" onClick={() => setSourceMode(sourceMode === 'eggnet' ? 'all' : 'eggnet')}>
                    <Filter size={17} />
                  </button>
                </div>

                {worlds.error ? <div className="notice danger">{worlds.error}</div> : null}

                <section className="eggnet-card-grid">
                  {filteredWorlds.map((world) => (
                    <article className="egg-world-card" key={world.handleId}>
                      <div className="world-head">
                        <div className="server-avatar">
                          {world.avatarTinyBase64 ? (
                            <img alt="" src={`data:image/webp;base64,${world.avatarTinyBase64}`} />
                          ) : world.avatarUrl ? (
                            <img alt="" src={world.avatarUrl} />
                          ) : (
                            <Gamepad2 size={21} />
                          )}
                        </div>
                        <div>
                          <h2>{world.title || 'Minecraft World'}</h2>
                          <p>{world.ownerGamertag || world.hostName || 'Unknown host'}</p>
                        </div>
                      </div>
                      <div className="world-tags">
                        <span>{countryLabel(countryForWorld(world))}</span>
                        <span>{world.version || '?'}</span>
                        <span>{sourceLabel(world.source)}</span>
                      </div>
                      <div className="world-foot">
                        <span className={world.closed ? 'world-state closed' : 'world-state'}>
                          <Wifi size={13} />
                          {world.closed ? '닫힘' : '온라인'}
                        </span>
                        <span>{relativeTime(world.updatedAtMs)}</span>
                        <strong>
                          {world.members}/{world.maxMembers || '?'}
                        </strong>
                      </div>
                      <button className="join-button" type="button" onClick={() => openJoinTarget(world)}>
                        참가
                      </button>
                    </article>
                  ))}

                  {!worlds.loading && filteredWorlds.length === 0 ? (
                    <div className="empty-state">
                      <strong>검색 결과가 없습니다.</strong>
                      <span>지역이나 피드 필터를 바꿔보세요.</span>
                    </div>
                  ) : null}
                </section>
              </section>

              <aside className="directory-detail">
                {selectedWorld ? (
                  <>
                    <div className="detail-preview">
                      <span className="brand-mark" />
                    </div>
                    <span className="eyebrow">{countryLabel(countryForWorld(selectedWorld)).toUpperCase()} REGION</span>
                    <h2>{selectedWorld.title || 'Minecraft World'}</h2>
                    <p>{selectedWorld.ownerGamertag || selectedWorld.hostName || selectedWorld.ownerXuid}</p>
                    <div className="detail-grid">
                      <span>
                        상태
                        <strong>{selectedWorld.closed ? '닫힘' : '온라인'}</strong>
                      </span>
                      <span>
                        버전
                        <strong>{selectedWorld.version || '?'}</strong>
                      </span>
                      <span>
                        플레이어
                        <strong>
                          {selectedWorld.members}/{selectedWorld.maxMembers || '?'}
                        </strong>
                      </span>
                      <span>
                        피드
                        <strong>{sourceLabel(selectedWorld.source)}</strong>
                      </span>
                    </div>
                    <button className="primary-button full" type="button" onClick={() => openJoinTarget(selectedWorld)}>
                      <Play size={16} />
                      Minecraft로 참가
                    </button>
                    <button className="secondary-button full" type="button" onClick={() => copyText(selectedWorld.uri, '참가 링크 복사 완료')}>
                      <Copy size={16} />
                      참가 링크 복사
                    </button>
                  </>
                ) : (
                  <div className="empty-state">
                    <strong>월드를 선택하세요.</strong>
                  </div>
                )}
              </aside>
            </section>
          </>
        ) : null}

        {tab === 'community' ? (
          <>
            <section className="intro compact">
              <div className="intro-title">
                <MessageSquare size={18} />
                <div>
                  <strong>커뮤니티</strong>
                  <span>서버 홍보, 파티 모집, 질문을 한곳에서 주고받는 채팅입니다.</span>
                </div>
              </div>
              <button className="icon-button" type="button" onClick={loadChat} disabled={chat.loading}>
                {chat.loading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              </button>
            </section>

            {chat.error ? <div className="notice danger">{chat.error}</div> : null}

            <section className="chat-panel">
              <div className="chat-thread" aria-label="커뮤니티 채팅">
                {chat.value.map((message) => (
                  <article className="chat-message" key={message.id}>
                    <div className="chat-avatar">{message.authorName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <div className="chat-meta">
                        <strong>{message.authorName}</strong>
                        <span>{countryLabel(message.country)}</span>
                        <span>{relativeTime(new Date(message.createdAt).getTime())}</span>
                      </div>
                      <p>{message.body}</p>
                    </div>
                  </article>
                ))}

                {!chat.loading && chat.value.length === 0 ? (
                  <div className="empty-state">
                    <strong>아직 메시지가 없습니다.</strong>
                    <span>첫 서버 홍보나 파티 모집을 남겨보세요.</span>
                  </div>
                ) : null}
              </div>

              <form className="chat-composer" onSubmit={sendChat}>
                <select value={chatCountry} onChange={(event) => setChatCountry(event.target.value as CountryMode)} aria-label="채팅 국가">
                  {COUNTRY_OPTIONS.filter((country) => country.id !== 'all').map((country) => (
                    <option key={country.id} value={country.id}>
                      {country.label}
                    </option>
                  ))}
                </select>
                <input
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onFocus={() => {
                    if (isBackendConfigured && !cloudUser) openAuth('login');
                  }}
                  placeholder={isBackendConfigured && !cloudUser ? '로그인하고 채팅하기' : '메시지 입력...'}
                  readOnly={isBackendConfigured && !cloudUser}
                  maxLength={500}
                />
                <button
                  type={isBackendConfigured && !cloudUser ? 'button' : 'submit'}
                  onClick={() => {
                    if (isBackendConfigured && !cloudUser) openAuth('login');
                  }}
                  disabled={busyAction === 'chat-send' || (!chatInput.trim() && !(isBackendConfigured && !cloudUser))}
                >
                  {busyAction === 'chat-send' ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                  {isBackendConfigured && !cloudUser ? '로그인' : '전송'}
                </button>
              </form>
            </section>
          </>
        ) : null}

        {tab === 'profile' ? (
          <>
            <section className="intro compact profile-top">
              <div className="intro-title">
                <UserRound size={18} />
                <div>
                  <strong>프로필</strong>
                  <span>계정과 로그인 정보를 관리하세요.</span>
                </div>
              </div>
              <span className={isDesktopApp || Capacitor.isNativePlatform() ? 'profile-chip on' : 'profile-chip'}>
                {isDesktopApp ? 'PC 앱' : Capacitor.isNativePlatform() ? '앱' : '웹'}
              </span>
            </section>

            {!cloudUser ? (
              <section className="login-banner egg-profile-notice">
                <strong>프로필 탭에서 로그인하세요.</strong>
                <span>Microsoft 공식 OAuth만 사용하며 비밀번호 등 민감 정보는 수집하거나 접근하지 않습니다.</span>
                <a href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow" target="_blank" rel="noreferrer">
                  OAuth에 대해 자세히 알아보기
                  <ExternalLink size={14} />
                </a>
              </section>
            ) : null}

            <section className="egg-profile-card">
              <div className="egg-profile-avatar">
                <UserRound size={48} />
              </div>
              <div className="egg-profile-state">
                <h2>{profileName}</h2>
                <span className={profileSignedIn ? 'signed' : ''}>{profileStatus}</span>
                {cloudUser ? <p>{cloudUser.email || cloudUser.id}</p> : xbox.xuid ? <p>XUID {xbox.xuid}</p> : null}
              </div>
            </section>

            <section className="egg-profile-actions">
              {cloudUser ? (
                <>
                  <button className="primary-button" type="button" onClick={() => setTab('servers')}>
                    <Gamepad2 size={16} />
                    서버 보기
                  </button>
                  <button className="secondary-button" type="button" onClick={signOutSupabase} disabled={busyAction === 'supabase-logout'}>
                    {busyAction === 'supabase-logout' ? <Loader2 className="spin" size={16} /> : <LogOut size={16} />}
                    로그아웃
                  </button>
                </>
              ) : (
                <>
                  <button className="primary-button" type="button" onClick={() => openAuth('login')}>
                    <KeyRound size={16} />
                    로그인
                  </button>
                  <button className="secondary-button" type="button" onClick={continueAsGuest}>
                    게스트 로그인
                  </button>
                </>
              )}
            </section>

            {authOpen && !cloudUser ? (
              <section className="egg-inline-auth">
                <div className="auth-tabs" aria-label="계정 모드">
                  <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>
                    로그인
                  </button>
                  <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>
                    가입
                  </button>
                </div>
                <form className="account-form pretty-auth modal-auth-form" onSubmit={submitCloudAuth}>
                  {authMode === 'signup' ? (
                    <label className="field">
                      <span>닉네임</span>
                      <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="표시할 이름" maxLength={24} />
                    </label>
                  ) : null}
                  <label className="field">
                    <span>이메일</span>
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" type="email" />
                  </label>
                  {authMode === 'login' ? (
                    <label className="field">
                      <span>비밀번호</span>
                      <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" type="password" minLength={6} />
                    </label>
                  ) : null}
                  <button
                    className="primary-button full"
                    type="submit"
                    disabled={!email.trim() || (authMode === 'login' && password.length < 6) || busyAction === `cloud-${authMode}`}
                  >
                    {busyAction === `cloud-${authMode}` ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                    {authMode === 'signup' ? '인증 메일 보내기' : '로그인'}
                  </button>
                </form>
                <div className="inline-auth-actions">
                  <button className="link-button" type="button" onClick={sendMagicLink} disabled={!email.trim() || busyAction === 'cloud-link'}>
                    메일 링크 로그인
                  </button>
                  <button className="secondary-button" type="button" onClick={continueAsGuest}>
                    게스트로 시작
                  </button>
                </div>
              </section>
            ) : null}

            <section className="install-panel profile-install-panel">
              <div className="install-copy">
                <span className="eyebrow">{isDesktopApp ? 'APP MODE' : 'AUTO DOWNLOAD'}</span>
                <h2>{isDesktopApp ? 'PC 앱 설정' : `${preferredDownload.platform}용 파일 받기`}</h2>
                <p>
                  {isDesktopApp
                    ? '설치된 앱에서는 Minecraft 연결 준비 상태, Xbox 연동, 친구 프로필을 한 화면에서 관리합니다.'
                    : '접속 기기를 확인해서 Windows에서는 설치 파일, Android에서는 APK를 바로 내려받습니다.'}
                </p>
                <div className={release.currentBuildPending ? 'release-status pending' : release.updateAvailable ? 'release-status update' : 'release-status'}>
                  <span>현재 v{release.currentVersion}</span>
                  <span>
                    {release.loading
                      ? '릴리스 확인 중'
                      : release.currentBuildPending
                        ? `설치 파일 빌드 대기: latest v${release.latestVersion || '?'}`
                        : release.updateAvailable
                          ? `새 버전 v${release.latestVersion}`
                          : `설치 파일 v${release.latestVersion || release.currentVersion}`}
                  </span>
                </div>
              </div>
              <div className="install-actions">
                <button
                  className="download-button primary"
                  type="button"
                  onClick={() => downloadFile(activeDownload.href, activeDownload.platform as 'Windows' | 'Android')}
                >
                  <Download size={18} />
                  {activeDownload.label}
                </button>
                <button
                  className="download-button"
                  type="button"
                  onClick={() => downloadFile(alternateDownload.href, alternateDownload.platform)}
                >
                  <Download size={18} />
                  {alternateDownload.label}
                </button>
                <a className="download-link" href={release.latestUrl} target="_blank" rel="noreferrer">
                  릴리스 상태 보기
                  <ExternalLink size={14} />
                </a>
              </div>
              <div className="install-steps">
                <span>
                  <strong>{isDesktopApp ? 'ON' : '1'}</strong>
                  {isDesktopApp ? 'PC 앱 실행 중' : '파일 다운로드'}
                </span>
                <span>
                  <strong>{isDesktopApp ? '2' : '2'}</strong>
                  Luma 로그인
                </span>
                <span>
                  <strong>3</strong>
                  Xbox 연동
                </span>
                <span>
                  <strong>4</strong>
                  Minecraft 친구 탭 참가
                </span>
              </div>
            </section>

            <section className="profile-layout clean-profile legacy-profile-panels">
              <span id="release-builds" className="anchor-target" aria-hidden="true" />
              <article className="profile-panel app-settings-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">SETUP</span>
                    <h2>연결 설정</h2>
                  </div>
                  <ShieldCheck size={20} />
                </div>
                <div className="setting-list">
                  <div>
                    <span>실행 환경</span>
                    <strong>{isDesktopApp ? 'Windows 앱' : preferredDownload.platform === 'Android' ? 'Android 웹' : 'PC 웹'}</strong>
                  </div>
                  <div>
                    <span>브리지</span>
                    <strong>{capabilities.bridge ? '사용 가능' : isDesktopApp ? '앱 헬퍼 필요' : '앱 설치 필요'}</strong>
                  </div>
                  <div>
                    <span>Eggnet 참가</span>
                    <strong>
                      {proxyPass.ready
                        ? `${proxyPass.proxyPort} 포트 준비`
                        : proxyPass.running
                          ? proxyPass.phase === 'auth'
                            ? 'Microsoft 인증 중'
                            : '시작 중'
                          : capabilities.proxyPass
                            ? 'ProxyPass 가능'
                            : 'PC 앱 필요'}
                    </strong>
                  </div>
                  <div>
                    <span>월드 피드</span>
                    <strong>{worlds.value.length.toLocaleString()}개 로드</strong>
                  </div>
                  <div>
                    <span>앱 버전</span>
                    <strong>v{release.currentVersion}</strong>
                  </div>
                </div>
              </article>
              {proxyPass.running || proxyPass.error ? (
                <article className="profile-panel">
                  <div className="panel-heading">
                    <div>
                      <span className="eyebrow">PROXYPASS</span>
                      <h2>{proxyPass.ready ? '친구 탭에 표시됨' : proxyPass.phase === 'auth' ? 'Microsoft 인증 대기' : '연결 준비 중'}</h2>
                    </div>
                    <Wifi size={20} />
                  </div>
                  <div className="account-card signed">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>{proxyPass.target?.name || 'Luma Proxy'}</strong>
                      <span>
                        {proxyPass.ready
                          ? `Minecraft > 플레이 > 친구 > LAN 게임`
                          : proxyPass.authCode
                            ? `인증 코드 ${proxyPass.authCode}`
                            : proxyPass.error || proxyPass.logs[0]?.line || 'ProxyPass 초기화 중'}
                      </span>
                    </div>
                    {proxyPass.running ? (
                      <button className="secondary-button" type="button" onClick={stopProxyPass} disabled={busyAction === 'proxypass-stop'}>
                        <Square size={15} />
                        중지
                      </button>
                    ) : null}
                  </div>
                  {proxyPass.phase === 'auth' ? (
                    <div className="device-code">
                      <span>{proxyPass.authUri || 'https://www.microsoft.com/link'}</span>
                      <strong>{proxyPass.authCode || '코드 확인 중'}</strong>
                      <button type="button" onClick={() => copyText(proxyPass.authCode || '')} disabled={!proxyPass.authCode}>
                        <Copy size={15} />
                        코드 복사
                      </button>
                    </div>
                  ) : null}
                </article>
              ) : null}
              <article className="profile-panel auth-panel primary-auth">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">LUMA ACCOUNT</span>
                    <h2>{cloudUser ? accountName : '계정으로 계속'}</h2>
                  </div>
                  {cloudUser ? <BadgeCheck size={20} /> : <KeyRound size={20} />}
                </div>
                {!isBackendConfigured ? (
                  <div className="account-card signed">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>로컬 미리보기</strong>
                      <span>온라인 배포에서는 이메일/비밀번호 계정으로 로그인합니다.</span>
                    </div>
                  </div>
                ) : cloudUser ? (
                  <div className="account-card signed">
                    <div className="profile-avatar">{accountName.slice(0, 1).toUpperCase()}</div>
                    <div>
                      <strong>{accountName}</strong>
                      <span>{cloudUser.email || cloudUser.id}</span>
                      <small>ID {cloudUser.id.slice(0, 8)}</small>
                    </div>
                    <button className="secondary-button" type="button" onClick={signOutSupabase} aria-label="Luma 로그아웃">
                      <LogOut size={15} />
                      로그아웃
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="egg-auth compact-auth">
                      <div className="social-auth" aria-label="소셜 로그인">
                          {OAUTH_BUTTONS.map((provider) => (
                            <button
                              className={`oauth-button ${provider.id}${!oauthEnabled[provider.id] ? ' disabled' : ''}`}
                              type="button"
                              key={provider.id}
                              onClick={() => startOAuth(provider.id)}
                              disabled={!oauthChecked || busyAction === `oauth-${provider.id}`}
                              title={oauthEnabled[provider.id] ? provider.label : 'Supabase Auth Provider 설정 필요'}
                            >
                              <span>{provider.short}</span>
                              {busyAction === `oauth-${provider.id}` ? '연결 중...' : provider.label}
                            </button>
                          ))}
                      </div>
                      {!hasOAuthProvider ? <p className="oauth-note">소셜 로그인은 Supabase Auth Provider를 켜면 바로 활성화됩니다.</p> : null}

                      <div className="auth-tabs" aria-label="계정 모드">
                        <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>
                          로그인
                        </button>
                        <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>
                          가입
                        </button>
                      </div>

                      <form className="account-form pretty-auth" onSubmit={submitCloudAuth}>
                        {authMode === 'signup' ? (
                          <label className="field">
                            <span>닉네임</span>
                            <input
                              value={displayName}
                              onChange={(event) => setDisplayName(event.target.value)}
                              placeholder="표시할 이름"
                              maxLength={24}
                            />
                          </label>
                        ) : null}
                        <label className="field">
                          <span>이메일</span>
                          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" type="email" />
                        </label>
                        {authMode === 'login' ? (
                          <label className="field">
                            <span>비밀번호</span>
                            <input
                              value={password}
                              onChange={(event) => setPassword(event.target.value)}
                              placeholder="6자 이상"
                              type="password"
                              minLength={6}
                            />
                          </label>
                        ) : null}
                        <button
                          className="primary-button full"
                          type="submit"
                          disabled={!email.trim() || (authMode === 'login' && password.length < 6) || busyAction === `cloud-${authMode}`}
                        >
                          {busyAction === `cloud-${authMode}` ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                          {authMode === 'signup' ? '인증 메일 보내기' : '로그인'}
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </article>

              <article className="profile-panel xuid-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">FRIENDS</span>
                    <h2>게이머태그 저장</h2>
                  </div>
                  <Users size={20} />
                </div>
                <form className="track-form" onSubmit={saveTrackedXuid}>
                  <input
                    value={trackInput}
                    onChange={(event) => setTrackInput(event.target.value)}
                    placeholder={cloudUser ? 'Xbox 게이머태그 입력' : '로그인 후 검색 가능'}
                    readOnly={isBackendConfigured && !cloudUser}
                    onFocus={() => {
                      if (isBackendConfigured && !cloudUser) openAuth('login');
                    }}
                  />
                  <button
                    type={isBackendConfigured && !cloudUser ? 'button' : 'submit'}
                    onClick={() => {
                      if (isBackendConfigured && !cloudUser) openAuth('login');
                    }}
                    disabled={busyAction === 'track-profile' || (!trackInput.trim() && !(isBackendConfigured && !cloudUser))}
                  >
                    {busyAction === 'track-profile' ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
                    {isBackendConfigured && !cloudUser ? '로그인' : '찾기'}
                  </button>
                </form>
                <p className="lookup-hint">공개 월드 피드에 보이는 게이머태그를 찾아 자동으로 프로필을 저장합니다.</p>
                <div className="tracked-list empty-friendly">
                  {tracked.map((item) => (
                    <span className="tracked-chip" key={item.id}>
                      <strong>{item.gamertag || item.xuid}</strong>
                      {item.gamertag ? <small>{item.xuid.slice(0, 4)}...</small> : null}
                      <button type="button" onClick={() => deleteTrackedXuid(item)} aria-label={`${item.xuid} 삭제`}>
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                  {tracked.length === 0 ? <span className="muted-text">저장된 친구 프로필이 없습니다.</span> : null}
                </div>
              </article>

              <article className="profile-panel xbox-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">XBOX</span>
                    <h2>연동</h2>
                  </div>
                  <Wifi size={20} />
                </div>
                {xbox.signedIn ? (
                  <div className="account-card signed">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>연동됨</strong>
                      <span>XUID {xbox.xuid}</span>
                    </div>
                    <button className="secondary-button" type="button" onClick={logoutXbox} aria-label="Xbox 연동 해제">
                      <LogOut size={15} />
                      해제
                    </button>
                  </div>
                ) : (
                  <button
                    className="primary-button full"
                    type="button"
                    onClick={startXboxLogin}
                    disabled={busyAction === 'xbox-login'}
                  >
                    {busyAction === 'xbox-login' ? <Loader2 className="spin" size={17} /> : <KeyRound size={17} />}
                    {capabilities.xboxLogin ? 'Xbox 연동' : '앱에서 연동'}
                  </button>
                )}

                {xbox.code ? (
                  <div className="device-code">
                    <span>{xbox.verificationUri}</span>
                    <strong>{xbox.code}</strong>
                    <button type="button" onClick={() => copyText(xbox.code || '')}>
                      <Copy size={15} />
                      코드 복사
                    </button>
                  </div>
                ) : null}
                {xbox.error ? <p className="error-text">{xbox.error}</p> : null}
                {isBackendConfigured && !cloudUser ? <p className="muted-text">Xbox 연동은 PC 앱에서 Luma 계정 없이도 시작할 수 있습니다.</p> : null}
                {!capabilities.xboxLogin ? <p className="muted-text">PC 앱에서 Xbox 연동과 브리지를 실행합니다.</p> : null}
              </article>
            </section>
          </>
        ) : null}

        {adminMode && tab === 'admin' ? (
          <>
            <section className="admin-console">
              <div className="intro-title">
                <ShieldCheck size={18} />
                <div>
                  <strong>관리자 콘솔</strong>
                  <span>공개 유저 화면과 분리된 운영 도구입니다.</span>
                  <span>무료 배포에서는 Edge 캐시가 DB/API 호출 예산을 먼저 보호합니다.</span>
                </div>
              </div>
              <div className="admin-actions">
                <label className="admin-key">
                  <span>운영 키</span>
                  <input
                    value={adminKey}
                    onChange={(event) => saveAdminKey(event.target.value)}
                    placeholder="운영 키"
                    type="password"
                  />
                </label>
                <button
                  className="primary-button"
                  type="button"
                  onClick={forceRefreshWorlds}
                  disabled={busyAction === 'admin-refresh-worlds' || worlds.loading}
                >
                  {busyAction === 'admin-refresh-worlds' || worlds.loading ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
                  피드 강제 갱신
                </button>
              </div>
            </section>

            <section className="profile-grid admin-grid">
              <article className="profile-panel">
                <h2>서비스 상태</h2>
                <div className="admin-metric">
                  <StatusDot active={!worlds.error} />
                  <div>
                    <strong>{worlds.value.length.toLocaleString()}개</strong>
                    <span>현재 브라우저에 로드된 라이브 월드</span>
                  </div>
                </div>
                <div className="admin-metric">
                  <StatusDot active={!presence.error} />
                  <div>
                    <strong>{presence.value.length.toLocaleString()}명</strong>
                    <span>캐시된 호스트/프레즌스</span>
                  </div>
                </div>
              </article>

              <article className="profile-panel">
                <h2>백엔드 모드</h2>
                <div className="capability-list">
                  <span className={capabilities.supabaseEdge ? 'on' : ''}>Edge API</span>
                  <span className={capabilities.supabaseCache ? 'on' : ''}>DB Cache</span>
                  <span className={capabilities.static ? 'on' : ''}>Static Edge</span>
                  <span className={capabilities.bridge ? 'on' : ''}>LAN Bridge</span>
                  <span className={capabilities.bedrockPing ? 'on' : ''}>Bedrock Ping</span>
                  <span className={capabilities.xboxLogin ? 'on' : ''}>Xbox Login</span>
                </div>
              </article>

              <article className="profile-panel">
                <h2>클라우드 운영 계정</h2>
                {!isBackendConfigured ? (
                  <p className="muted-text">env 미설정</p>
                ) : cloudUser ? (
                  <div className="account-row">
                    <BadgeCheck size={18} />
                    <span>{cloudUser.email || cloudUser.id}</span>
                    <button type="button" onClick={signOutSupabase} aria-label="클라우드 로그아웃">
                      <LogOut size={16} />
                    </button>
                  </div>
                ) : (
                  <form className="account-form compact" onSubmit={submitCloudAuth}>
                    <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@example.com" type="email" />
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="비밀번호"
                      type="password"
                      minLength={6}
                    />
                    <button className="primary-button full" type="submit" disabled={!email.trim() || password.length < 6 || busyAction === 'cloud-login'}>
                      {busyAction === 'cloud-login' ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                      로그인
                    </button>
                  </form>
                )}
              </article>

              <article className="profile-panel">
                <h2>추적 XUID</h2>
                <form className="track-form" onSubmit={saveTrackedXuid}>
                  <input value={trackInput} onChange={(event) => setTrackInput(event.target.value)} placeholder="게이머태그 또는 XUID" />
                  <button type="submit" disabled={!trackInput.trim() || busyAction === 'track-profile'}>
                    {busyAction === 'track-profile' ? <Loader2 className="spin" size={15} /> : null}
                    저장
                  </button>
                </form>
                <div className="tracked-list">
                  {tracked.map((item) => (
                    <span className="tracked-chip" key={item.id}>
                      <strong>{item.gamertag || item.xuid}</strong>
                      <button type="button" onClick={() => deleteTrackedXuid(item)} aria-label={`${item.xuid} 삭제`}>
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </article>
            </section>

            <section className="bridge-section">
              <div className="bridge-head">
                <div>
                  <strong>LAN/Friends 브리지</strong>
                  <span>
                    {!capabilities.bridge
                      ? '클라우드 Edge 모드에서는 LAN 브리지가 비활성화됩니다.'
                      : bridge.running
                        ? `${bridge.target?.name || 'Bridge'} 광고 중 (${bridge.bridgePort}/udp)`
                        : '선택한 Bedrock 서버를 LAN 월드처럼 광고합니다.'}
                  </span>
                </div>
                {bridge.running ? (
                  <button className="danger-button" type="button" onClick={stopBridge} disabled={busyAction === 'bridge-stop'}>
                    <Square size={16} />
                    중지
                  </button>
                ) : null}
              </div>

              <form
                className="target-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  startBridge(target);
                }}
              >
                <input value={target.name} onChange={(event) => setTarget({ ...target, name: event.target.value })} placeholder="표시 이름" />
                <input value={target.host} onChange={(event) => setTarget({ ...target, host: event.target.value })} placeholder="host.example.com" />
                <input
                  value={target.port}
                  onChange={(event) => setTarget({ ...target, port: Number(event.target.value) || 19132 })}
                  type="number"
                  min={1}
                  max={65535}
                />
                <button className="primary-button" type="submit" disabled={!target.host.trim() || !capabilities.bridge}>
                  <Power size={17} />
                  시작
                </button>
              </form>

              <div className="target-grid">
                {featured.value.map((item) => {
                  const key = formatAddress(item);
                  const status = statusByTarget[key];

                  return (
                    <article className="target-card" key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <span>{formatAddress(item)}</span>
                      </div>
                      <span>{status ? `${status.playersOnline}/${status.playersMax}` : '상태 미확인'}</span>
                      <div className="button-row">
                        <button className="secondary-button" type="button" onClick={() => pingTarget(item)} disabled={!capabilities.bedrockPing}>
                          <RefreshCw size={15} />
                          핑
                        </button>
                        <button className="primary-button" type="button" onClick={() => startBridge(item)} disabled={!capabilities.bridge}>
                          <Wifi size={15} />
                          브리지
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        ) : null}
      </main>

      {joinTarget ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <section className="join-modal">
            <button className="modal-close" type="button" onClick={() => setJoinTarget(null)} aria-label="닫기">
              <X size={18} />
            </button>
            <div className="modal-title">
              <span className="egg-icon" />
              <div>
                <small>Luma Join</small>
                <h2>Minecraft로 바로 참가</h2>
              </div>
            </div>
            <div className="benefit-box">
              <span>
                <CheckCircle2 size={16} />
                {worldProxyTarget(joinTarget)
                  ? '설치 앱의 ProxyPass가 Eggnet NetherNet 월드로 실제 프록시 연결을 만듭니다.'
                  : worldBridgeTarget(joinTarget)
                    ? '설치 앱 브리지로 Minecraft 로컬 월드를 열고 선택한 서버로 이동합니다.'
                    : 'Xbox activity handle 참가 링크를 엽니다.'}
              </span>
              <span>
                <CheckCircle2 size={16} />
                Luma 계정을 연결하면 채팅, 국가 필터, 연동 기능을 함께 사용할 수 있습니다.
              </span>
              <span>
                <CheckCircle2 size={16} />
                현재 선택: {joinTarget.title} · {joinTarget.members}/{joinTarget.maxMembers || '?'}
              </span>
            </div>
            <div className="modal-actions">
              <button className="primary-button" type="button" onClick={() => continueJoin(joinTarget)} disabled={busyAction === `join:${joinTarget.handleId}`}>
                {busyAction === `join:${joinTarget.handleId}` ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
                Minecraft로 참가
              </button>
              <button className="secondary-button" type="button" onClick={() => copyText(joinTarget.uri, '참가 URI 복사 완료')}>
                <Clipboard size={16} />
                URI 복사
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => {
                  setJoinTarget(null);
                  setTab('profile');
                }}
              >
                <Download size={16} />
                앱/로그인 설정
              </button>
            </div>
            <p>웹에서는 게스트로 이용할 수 있지만, 실제 참가 안정성은 Minecraft 앱과 플랫폼 프로토콜 처리 상태에 좌우됩니다.</p>
          </section>
        </div>
      ) : null}

      {authOpen && !cloudUser && tab !== 'profile' ? (
        <div className="modal-backdrop auth-backdrop" role="dialog" aria-modal="true" aria-label="Luma 로그인">
          <section className="auth-modal">
            <button className="modal-close" type="button" onClick={() => setAuthOpen(false)} aria-label="닫기">
              <X size={18} />
            </button>
            <div className="modal-title">
              <span className="brand-mark small" />
              <div>
                <small>Luma Account</small>
                <h2>{authMode === 'signup' ? '계정 만들기' : '로그인'}</h2>
              </div>
            </div>
            <div className="social-auth" aria-label="소셜 로그인">
              {OAUTH_BUTTONS.map((provider) => (
                <button
                  className={`oauth-button ${provider.id}${!oauthEnabled[provider.id] ? ' disabled' : ''}`}
                  type="button"
                  key={provider.id}
                  onClick={() => startOAuth(provider.id)}
                  disabled={!oauthChecked || busyAction === `oauth-${provider.id}`}
                  title={oauthEnabled[provider.id] ? provider.label : 'Supabase Auth Provider 설정 필요'}
                >
                  <span>{provider.short}</span>
                  {busyAction === `oauth-${provider.id}` ? '연결 중...' : provider.label}
                </button>
              ))}
            </div>
            {!hasOAuthProvider ? <p className="oauth-note">소셜 로그인은 Provider 설정 후 켜지고, 가입은 메일 링크 인증으로 진행됩니다.</p> : null}
            <div className="auth-tabs" aria-label="계정 모드">
              <button className={authMode === 'login' ? 'active' : ''} type="button" onClick={() => setAuthMode('login')}>
                로그인
              </button>
              <button className={authMode === 'signup' ? 'active' : ''} type="button" onClick={() => setAuthMode('signup')}>
                가입
              </button>
            </div>
            <form className="account-form pretty-auth modal-auth-form" onSubmit={submitCloudAuth}>
              {authMode === 'signup' ? (
                <label className="field">
                  <span>닉네임</span>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="표시할 이름" maxLength={24} />
                </label>
              ) : null}
              <label className="field">
                <span>이메일</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@example.com" type="email" autoFocus />
              </label>
              {authMode === 'login' ? (
                <label className="field">
                  <span>비밀번호</span>
                  <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="6자 이상" type="password" minLength={6} />
                </label>
              ) : null}
              <button
                className="primary-button full"
                type="submit"
                disabled={!email.trim() || (authMode === 'login' && password.length < 6) || busyAction === `cloud-${authMode}`}
              >
                {busyAction === `cloud-${authMode}` ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                {authMode === 'signup' ? '인증 메일 보내기' : '로그인'}
              </button>
            </form>
            <button className="link-button" type="button" onClick={sendMagicLink} disabled={!email.trim() || busyAction === 'cloud-link'}>
              비밀번호 없이 메일 링크로 로그인
            </button>
            <button className="secondary-button full" type="button" onClick={continueAsGuest}>
              게스트로 바로 시작
            </button>
          </section>
        </div>
      ) : null}

      {toast ? (
        <button className="toast" type="button" onClick={() => setToast(null)}>
          {toast}
        </button>
      ) : null}
    </div>
  );
}

export default App;
