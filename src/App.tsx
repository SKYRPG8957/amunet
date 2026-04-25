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
  Play,
  Power,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  Square,
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
  signInOAuthCloud,
  signInPasswordCloud,
  signOutCloud,
  signUpCloud,
  type CommunityMessage,
  type CloudUser,
  type OAuthProvider,
} from './lib/cloudStore';
import { supabaseAnonKey, supabaseUrl } from './lib/supabase';
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
  bridge: true,
  xboxLogin: true,
  bedrockPing: true,
};

const defaultTarget = {
  name: 'Custom Server',
  host: '',
  port: 19132,
};

const WORLD_CACHE_KEY = 'luma:world-feed:v1';
const PRESENCE_CACHE_KEY = 'luma:presence-feed:v1';
const ADMIN_KEY_STORAGE_KEY = 'luma:admin-key:v1';
const WORLD_CACHE_MS = 45_000;
const PRESENCE_CACHE_MS = 120_000;
const apiBase = (import.meta.env.VITE_STATUS_API_URL?.trim() || '').replace(/\/$/, '');
const downloadLinks = {
  windows: import.meta.env.VITE_WINDOWS_DOWNLOAD_URL?.trim() || '',
  android: import.meta.env.VITE_ANDROID_DOWNLOAD_URL?.trim() || '',
  releases: import.meta.env.VITE_RELEASES_URL?.trim() || '',
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

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const endpoint = url.startsWith('http') ? url : `${apiBase}${url}`;
  const response = await fetch(endpoint, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || response.statusText);
  }

  return payload as T;
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

function App() {
  const [adminMode] = useState(() => isAdminRoute());
  const [tab, setTab] = useState<Tab>(() => (isAdminRoute() ? 'admin' : 'servers'));
  const runtimeClass = Capacitor.isNativePlatform()
    ? `native-${Capacitor.getPlatform()}`
    : /Android/i.test(window.navigator.userAgent)
      ? 'web-android'
      : 'web-desktop';
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
  const [xbox, setXbox] = useState<XboxStatus>(emptyXbox);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities>(defaultCapabilities);
  const [cloudUser, setCloudUser] = useState<CloudUser | null>(null);
  const [oauthEnabled, setOauthEnabled] = useState<OAuthAvailability>(defaultOAuthAvailability);
  const [oauthChecked, setOauthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
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
    const id = adminMode ? window.setInterval(refreshBridge, 2200) : null;
    return () => {
      if (id) window.clearInterval(id);
    };
  }, [adminMode]);

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
      return b.members - a.members || b.updatedAtMs - a.updatedAtMs;
    });
  }, [countryMode, query, sort, sourceMode, worlds.value]);

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
  const hasOAuthProvider = OAUTH_BUTTONS.some((provider) => oauthEnabled[provider.id]);

  async function refreshHealth(operatorKey = adminKey) {
    try {
      const payload = await requestJson<{
        bridge: BridgeStatus;
        xbox: XboxStatus;
        capabilities?: Partial<RuntimeCapabilities>;
      }>('/api/health', {
        headers: operatorHeaders(operatorKey),
      });
      setBridge(payload.bridge);
      setXbox(payload.xbox);
      setCapabilities({ ...defaultCapabilities, ...(payload.capabilities || {}) });
    } catch (error) {
      setToast(messageFrom(error));
    }
  }

  async function refreshBridge() {
    try {
      const payload = await requestJson<{ bridge: BridgeStatus }>('/api/bridge/status', {
        headers: operatorHeaders(),
      });
      setBridge(payload.bridge);
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
      const payload = await requestJson<{ joinUri: string }>('/api/join/simple', {
        method: 'POST',
        body: JSON.stringify({
          serverId: world.serverId || world.id,
          handleId: world.handleId,
        }),
      });
      window.location.href = payload.joinUri || world.uri;
    } catch (error) {
      setToast(messageFrom(error));
    } finally {
      setBusyAction(null);
      setJoinTarget(null);
    }
  }

  async function randomJoin() {
    if (!filteredWorlds.length) {
      setToast('참가 가능한 월드가 없습니다.');
      return;
    }

    setJoinTarget(filteredWorlds[Math.floor(Math.random() * filteredWorlds.length)]);
  }

  async function startXboxLogin() {
    if (isBackendConfigured && !cloudUser) {
      setToast('먼저 Luma 계정으로 로그인하세요.');
      return;
    }

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

    if (password.length < 6) {
      setToast('비밀번호는 6자 이상이어야 합니다.');
      return;
    }

    setBusyAction(`cloud-${authMode}`);

    try {
      if (authMode === 'signup') {
        await signUpCloud(email, password, displayName);
        setToast('회원가입 완료. 메일 확인이 켜져 있으면 인증 후 로그인됩니다.');
      } else {
        await signInPasswordCloud(email, password);
        setToast('Luma 계정 로그인 완료');
      }
      setCloudUser(await getCloudUser());
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

  async function copyText(value: string, label = '복사 완료') {
    await navigator.clipboard?.writeText(value);
    setToast(label);
  }

  function handleDownloadFallback(platform: 'Windows' | 'Android') {
    setToast(`${platform} 빌드 파일은 GitHub Release 연결 후 바로 내려받을 수 있습니다.`);
  }

  return (
    <div className={`luma-app eggnet-app ${runtimeClass}`}>
      <aside className="rail">
        <div className="rail-brand">
          <span className="brand-mark">L</span>
          <div>
            <strong>Luma Arcade</strong>
            <small>Bedrock arcade</small>
          </div>
        </div>
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
        <div className="rail-status">
          <StatusDot active={!worlds.error} />
          <span>{capabilities.supabaseEdge ? 'Edge online' : 'Local mode'}</span>
        </div>
      </aside>

      <main className="shell">
        {tab === 'servers' ? (
          <>
            <section className="intro server-hero">
              <div className="intro-title">
                <Gamepad2 size={18} />
                <div>
                  <strong>Bedrock 월드 탐색</strong>
                  <span>Eggnet 라이브 피드와 Luma 세션을 한 화면에서 정리합니다.</span>
                  <span>참가 버튼은 Minecraft activity handle 링크를 열어 친구 탭 참가 흐름에 맞춥니다.</span>
                </div>
              </div>
              <div className="hero-metrics">
                <span>
                  <strong>{worlds.value.length.toLocaleString()}</strong>
                  월드
                </span>
                <span>
                  <strong>{visiblePlayers.toLocaleString()}</strong>
                  접속자
                </span>
                <span>
                  <strong>{activeCountryCount}</strong>
                  국가권
                </span>
              </div>
            </section>

            <section className="provider-strip" aria-label="연결된 월드 제공자">
              {providers.map((provider) => (
                <div className={provider.ok ? '' : 'error'} key={provider.id}>
                  <strong>{providerLabel(provider.name)}</strong>
                  <span>
                    {provider.requiresLogin
                      ? '로그인 필요'
                      : `${provider.count}개${provider.mcbeOnlineCount ? ` · MCBE ${provider.mcbeOnlineCount}명` : ''}`}
                  </span>
                </div>
              ))}
            </section>

            {!xbox.signedIn ? (
              <section className="login-banner">
                <strong>Luma 계정에서 Xbox를 연동하세요.</strong>
                <span>
                  {capabilities.supabaseEdge
                    ? '클라우드 백엔드로 공개 피드와 참가 URI를 제공합니다.'
                    : '공개 월드 탐색은 바로 가능하고, 계정 연동 후 개인화 기능을 사용할 수 있습니다.'}
                </span>
                <a href="https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow" target="_blank" rel="noreferrer">
                  Xbox 연동 방식
                  <ExternalLink size={14} />
                </a>
              </section>
            ) : null}

            <div className="search-row">
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
              <select value={sourceMode} onChange={(event) => setSourceMode(event.target.value as SourceMode)} aria-label="소스">
                <option value="all">전체 소스</option>
                <option value="eggnet">Eggnet</option>
                <option value="luma">Luma</option>
              </select>
              <select value={countryMode} onChange={(event) => setCountryMode(event.target.value as CountryMode)} aria-label="국가">
                {COUNTRY_OPTIONS.map((country) => (
                  <option key={country.id} value={country.id}>
                    {country.label}
                    {country.id !== 'all' && countryCounts.get(country.id) ? ` ${countryCounts.get(country.id)}개` : ''}
                  </option>
                ))}
              </select>
              <button className="icon-button" type="button" onClick={() => loadWorlds(false)} disabled={worlds.loading}>
                {worlds.loading ? <Loader2 className="spin" size={17} /> : <RefreshCw size={17} />}
              </button>
              <button className="icon-button" type="button" onClick={randomJoin}>
                <Dice5 size={17} />
              </button>
              <button className="icon-button" type="button" aria-label="필터">
                <Filter size={17} />
              </button>
            </div>

            {worlds.error ? <div className="notice danger">{worlds.error}</div> : null}

            <section className="server-list">
              {filteredWorlds.map((world) => (
                <article className="server-card" key={world.handleId}>
                  <div className="server-avatar">
                    {world.avatarTinyBase64 ? (
                      <img alt="" src={`data:image/webp;base64,${world.avatarTinyBase64}`} />
                    ) : world.avatarUrl ? (
                      <img alt="" src={world.avatarUrl} />
                    ) : (
                      <Gamepad2 size={22} />
                    )}
                  </div>

                  <div className="server-info">
                    <h2>{world.title || 'Minecraft World'}</h2>
                    <p>
                      <Users size={13} />
                      {world.ownerGamertag || world.hostName || world.ownerXuid || 'Unknown'}
                    </p>
                    <div className="chips">
                      <span>{world.worldType || '월드'}</span>
                      <span>{world.version || '?'}</span>
                      <span>{relativeTime(world.updatedAtMs)}</span>
                      <span>{countryLabel(countryForWorld(world))}</span>
                      <span>{sourceLabel(world.source)}</span>
                    </div>
                  </div>

                  <div className="server-side">
                    <span className="players">
                      <Users size={13} />
                      {world.members}/{world.maxMembers || '?'}
                    </span>
                    <button className="join-button" type="button" onClick={() => setJoinTarget(world)}>
                      참가
                    </button>
                    <span className="bars" aria-label="connection">
                      <i />
                      <i />
                      <i className={world.closed ? 'muted' : ''} />
                    </span>
                  </div>
                </article>
              ))}

              {!worlds.loading && filteredWorlds.length === 0 ? (
                <div className="empty-state">
                  <strong>검색 결과가 없습니다.</strong>
                  <span>다른 월드명, 게이머태그, 언어로 검색해 보세요.</span>
                </div>
              ) : null}
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
                  placeholder={isBackendConfigured && !cloudUser ? 'Luma 계정으로 로그인하면 채팅할 수 있습니다.' : '메시지 입력...'}
                  disabled={isBackendConfigured && !cloudUser}
                  maxLength={500}
                />
                <button type="submit" disabled={!chatInput.trim() || busyAction === 'chat-send' || (isBackendConfigured && !cloudUser)}>
                  {busyAction === 'chat-send' ? <Loader2 className="spin" size={16} /> : <Send size={16} />}
                  전송
                </button>
              </form>
            </section>
          </>
        ) : null}

        {tab === 'profile' ? (
          <>
            <section className="intro compact profile-top">
              <div className="intro-title">
                <Download size={18} />
                <div>
                  <strong>앱 설치</strong>
                  <span>PC에서 실제 참가와 LAN/Friends 브리지를 쓰려면 Windows 앱이 필요합니다.</span>
                </div>
              </div>
              <span className={Capacitor.isNativePlatform() ? 'profile-chip on' : 'profile-chip'}>{Capacitor.isNativePlatform() ? '앱' : '웹'}</span>
            </section>

            <section className="install-panel">
              <div className="install-copy">
                <span className="eyebrow">DESKTOP REQUIRED</span>
                <h2>Luma Windows 앱으로 참가</h2>
                <p>웹은 서버 목록, 채팅, 계정 관리용입니다. Minecraft에 Friends/LAN 형태로 붙이는 브리지는 PC 앱에서 로컬 네트워크와 Xbox 세션을 처리합니다.</p>
              </div>
              <div className="install-actions">
                <a
                  className="download-button primary"
                  href={downloadLinks.windows || downloadLinks.releases || '#release-builds'}
                  onClick={(event) => {
                    if (!downloadLinks.windows && !downloadLinks.releases) {
                      event.preventDefault();
                      handleDownloadFallback('Windows');
                    }
                  }}
                >
                  <Download size={18} />
                  Windows 다운로드
                </a>
                <a
                  className="download-button"
                  href={downloadLinks.android || downloadLinks.releases || '#release-builds'}
                  onClick={(event) => {
                    if (!downloadLinks.android && !downloadLinks.releases) {
                      event.preventDefault();
                      handleDownloadFallback('Android');
                    }
                  }}
                >
                  <Download size={18} />
                  Android APK
                </a>
              </div>
              <div className="install-steps">
                <span>
                  <strong>1</strong>
                  앱 설치
                </span>
                <span>
                  <strong>2</strong>
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

            <section className="profile-layout clean-profile">
              <span id="release-builds" className="anchor-target" aria-hidden="true" />
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
                            className={`oauth-button ${provider.id} ${oauthEnabled[provider.id] ? '' : 'disabled'}`}
                            type="button"
                            key={provider.id}
                            onClick={() => startOAuth(provider.id)}
                            disabled={!oauthChecked || !oauthEnabled[provider.id] || busyAction === `oauth-${provider.id}`}
                          >
                            <span>{provider.short}</span>
                            {busyAction === `oauth-${provider.id}` ? '연결 중...' : provider.label}
                          </button>
                        ))}
                      </div>
                      {oauthChecked && !hasOAuthProvider ? (
                        <p className="oauth-note">소셜 로그인은 운영자가 Provider 설정을 켜면 자동으로 표시됩니다.</p>
                      ) : null}

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
                        <button
                          className="primary-button full"
                          type="submit"
                          disabled={!email.trim() || password.length < 6 || busyAction === `cloud-${authMode}`}
                        >
                          {busyAction === `cloud-${authMode}` ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />}
                          {authMode === 'signup' ? '계정 만들기' : '로그인'}
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
                    disabled={isBackendConfigured && !cloudUser}
                  />
                  <button type="submit" disabled={!trackInput.trim() || busyAction === 'track-profile' || (isBackendConfigured && !cloudUser)}>
                    {busyAction === 'track-profile' ? <Loader2 className="spin" size={15} /> : <Search size={15} />}
                    찾기
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
                    disabled={busyAction === 'xbox-login' || (isBackendConfigured && !cloudUser)}
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
                {isBackendConfigured && !cloudUser ? <p className="muted-text">Luma 계정 로그인 후 사용할 수 있습니다.</p> : null}
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
                친구 추가 없이 선택한 월드 참가 링크를 엽니다.
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

      {toast ? (
        <button className="toast" type="button" onClick={() => setToast(null)}>
          {toast}
        </button>
      ) : null}
    </div>
  );
}

export default App;
