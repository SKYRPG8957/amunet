import type { TrackedXuid } from '../types';
import { isBackendConfigured, supabase } from './supabase';

export type OAuthProvider = 'google' | 'azure' | 'discord' | 'github';

const LOCAL_TRACKED_XUIDS = 'amunet:tracked-xuids:v1';
const LOCAL_CHAT_MESSAGES = 'luma:community-chat:v1';
const LOCAL_GUEST_USER = 'luma:guest-user:v1';

export type CloudUser = {
  id: string;
  email: string | null;
  displayName: string | null;
};

export type CommunityMessage = {
  id: string;
  room: string;
  authorId: string | null;
  authorName: string;
  body: string;
  country: string;
  createdAt: string;
};

function readLocalTracked(): TrackedXuid[] {
  const raw = window.localStorage.getItem(LOCAL_TRACKED_XUIDS);

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as TrackedXuid[];
  } catch {
    return [];
  }
}

function writeLocalTracked(items: TrackedXuid[]) {
  window.localStorage.setItem(LOCAL_TRACKED_XUIDS, JSON.stringify(items));
}

function readLocalMessages(): CommunityMessage[] {
  const raw = window.localStorage.getItem(LOCAL_CHAT_MESSAGES);

  if (!raw) {
    return [
      {
        id: 'welcome-global',
        room: 'global',
        authorId: null,
        authorName: 'Luma',
        body: '서버 홍보, 파티 모집, 질문은 여기서 하면 됩니다.',
        country: 'GLOBAL',
        createdAt: new Date().toISOString(),
      },
    ];
  }

  try {
    return JSON.parse(raw) as CommunityMessage[];
  } catch {
    return [];
  }
}

function writeLocalMessages(items: CommunityMessage[]) {
  window.localStorage.setItem(LOCAL_CHAT_MESSAGES, JSON.stringify(items.slice(-120)));
}

function normalizeXuid(value: string) {
  const xuid = value.trim();

  if (!/^[0-9]{6,20}$/.test(xuid)) {
    throw new Error('XUID는 숫자 6-20자리여야 합니다.');
  }

  return xuid;
}

function normalizeGamertag(value?: string | null) {
  const gamertag = String(value || '').trim();
  return gamertag ? gamertag.slice(0, 32) : null;
}

function mapTrackedRow(row: Record<string, unknown>): TrackedXuid {
  return {
    id: String(row.id),
    xuid: String(row.xuid),
    gamertag: row.gamertag ? String(row.gamertag) : null,
    note: row.note ? String(row.note) : null,
    createdAt: String(row.created_at),
  };
}

async function getSessionUser(): Promise<CloudUser | null> {
  const guest = readGuestUser();

  if (!supabase) {
    return guest;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw error;
  }

  const user = data.session?.user;
  return user
    ? {
        id: user.id,
        email: user.email ?? null,
        displayName:
          typeof user.user_metadata?.display_name === 'string'
            ? user.user_metadata.display_name
            : typeof user.user_metadata?.name === 'string'
              ? user.user_metadata.name
              : null,
      }
    : guest;
}

function readGuestUser(): CloudUser | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_GUEST_USER);
    return raw ? (JSON.parse(raw) as CloudUser) : null;
  } catch {
    return null;
  }
}

function writeGuestUser(user: CloudUser | null) {
  if (user) {
    window.localStorage.setItem(LOCAL_GUEST_USER, JSON.stringify(user));
  } else {
    window.localStorage.removeItem(LOCAL_GUEST_USER);
  }
}

export { isBackendConfigured };

export async function getCloudUser() {
  return getSessionUser();
}

export function signInGuestCloud() {
  const user = {
    id: `guest-${crypto.randomUUID()}`,
    email: null,
    displayName: `Guest${Math.floor(1000 + Math.random() * 9000)}`,
  };
  writeGuestUser(user);
  return user;
}

export function onCloudAuthChange(callback: (user: CloudUser | null) => void) {
  if (!supabase) {
    return null;
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    callback(
      user
        ? {
            id: user.id,
            email: user.email ?? null,
            displayName:
              typeof user.user_metadata?.display_name === 'string'
                ? user.user_metadata.display_name
                : typeof user.user_metadata?.name === 'string'
                  ? user.user_metadata.name
                  : null,
          }
        : null,
    );
  });

  return data.subscription;
}

export async function signInCloud(email: string) {
  if (!supabase) {
    throw new Error('클라우드 계정 환경 변수가 비어 있습니다.');
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: window.location.origin,
    },
  });

  if (error) {
    throw error;
  }
}

export async function signInPasswordCloud(email: string, password: string) {
  if (!supabase) {
    throw new Error('클라우드 계정 환경 변수가 비어 있습니다.');
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw error;
  }
}

export async function signUpCloud(email: string, password: string, displayName: string) {
  if (!supabase) {
    throw new Error('클라우드 계정 환경 변수가 비어 있습니다.');
  }

  const name = displayName.trim();
  const { error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: window.location.origin,
      data: {
        display_name: name || email.trim().split('@')[0],
      },
    },
  });

  if (error) {
    throw error;
  }
}

export async function signInOAuthCloud(provider: OAuthProvider) {
  if (!supabase) {
    throw new Error('클라우드 계정 환경 변수가 비어 있습니다.');
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
    },
  });

  if (error) {
    throw error;
  }
}

export async function signOutCloud() {
  writeGuestUser(null);
  if (!supabase) {
    return;
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    throw error;
  }
}

function mapMessageRow(row: Record<string, unknown>): CommunityMessage {
  return {
    id: String(row.id),
    room: String(row.room || 'global'),
    authorId: row.author_id ? String(row.author_id) : null,
    authorName: String(row.author_name || 'Luma 유저'),
    body: String(row.body || ''),
    country: String(row.country || 'GLOBAL'),
    createdAt: String(row.created_at),
  };
}

export async function loadCommunityMessages(room = 'global'): Promise<CommunityMessage[]> {
  if (!supabase) {
    return readLocalMessages().filter((message) => message.room === room).slice(-80);
  }

  const { data, error } = await supabase
    .from('community_messages')
    .select('id,room,author_id,author_name,body,country,created_at')
    .eq('room', room)
    .order('created_at', { ascending: false })
    .limit(80);

  if (error) {
    throw error;
  }

  return (data ?? []).reverse().map((row) => mapMessageRow(row as Record<string, unknown>));
}

export async function sendCommunityMessage(body: string, country = 'GLOBAL', room = 'global'): Promise<CommunityMessage[]> {
  const trimmed = body.trim();

  if (trimmed.length < 1 || trimmed.length > 500) {
    throw new Error('메시지는 1-500자여야 합니다.');
  }

  if (!supabase) {
    const current = readLocalMessages();
    const next = [
      ...current,
      {
        id: `local-${Date.now()}`,
        room,
        authorId: null,
        authorName: '로컬 유저',
        body: trimmed,
        country,
        createdAt: new Date().toISOString(),
      },
    ];
    writeLocalMessages(next);
    return next.filter((message) => message.room === room).slice(-80);
  }

  const user = await getSessionUser();

  if (!user) {
    throw new Error('Luma 계정 로그인이 필요합니다.');
  }

  if (user.id.startsWith('guest-')) {
    const current = readLocalMessages();
    const next = [
      ...current,
      {
        id: `local-${Date.now()}`,
        room,
        authorId: user.id,
        authorName: user.displayName || '게스트',
        body: trimmed,
        country,
        createdAt: new Date().toISOString(),
      },
    ];
    writeLocalMessages(next);
    return next.filter((message) => message.room === room).slice(-80);
  }

  const { error } = await supabase.from('community_messages').insert({
    room,
    author_id: user.id,
    author_name: user.displayName || user.email?.split('@')[0] || 'Luma 유저',
    body: trimmed,
    country,
  });

  if (error) {
    throw error;
  }

  return loadCommunityMessages(room);
}

export async function loadTrackedXuids(): Promise<TrackedXuid[]> {
  if (!supabase) {
    return readLocalTracked();
  }

  const user = await getSessionUser();

  if (!user) {
    return [];
  }

  if (user.id.startsWith('guest-')) {
    return readLocalTracked();
  }

  const { data, error } = await supabase
    .from('tracked_xuids')
    .select('id,xuid,gamertag,note,created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => mapTrackedRow(row as Record<string, unknown>));
}

export async function addTrackedXuid(value: string, gamertag?: string | null): Promise<TrackedXuid[]> {
  const xuid = normalizeXuid(value);
  const cleanGamertag = normalizeGamertag(gamertag);

  if (!supabase) {
    const current = readLocalTracked();
    const next = [
      {
        id: xuid,
        xuid,
        gamertag: cleanGamertag,
        note: null,
        createdAt: new Date().toISOString(),
      },
      ...current.filter((item) => item.xuid !== xuid),
    ];
    writeLocalTracked(next);
    return next;
  }

  const user = await getSessionUser();

  if (!user) {
    throw new Error('XUID 저장은 Luma 계정 로그인이 필요합니다.');
  }

  if (user.id.startsWith('guest-')) {
    const current = readLocalTracked();
    const next = [
      {
        id: xuid,
        xuid,
        gamertag: cleanGamertag,
        note: null,
        createdAt: new Date().toISOString(),
      },
      ...current.filter((item) => item.xuid !== xuid),
    ];
    writeLocalTracked(next);
    return next;
  }

  const { error } = await supabase
    .from('tracked_xuids')
    .upsert(
      {
        owner_id: user.id,
        xuid,
        gamertag: cleanGamertag,
      },
      {
        onConflict: 'owner_id,xuid',
      },
    );

  if (error) {
    throw error;
  }

  return loadTrackedXuids();
}

export async function removeTrackedXuid(item: TrackedXuid): Promise<TrackedXuid[]> {
  if (!supabase) {
    const next = readLocalTracked().filter((entry) => entry.xuid !== item.xuid);
    writeLocalTracked(next);
    return next;
  }

  const user = await getSessionUser();

  if (!user) {
    throw new Error('XUID 삭제는 Luma 계정 로그인이 필요합니다.');
  }

  if (user.id.startsWith('guest-')) {
    const next = readLocalTracked().filter((entry) => entry.xuid !== item.xuid);
    writeLocalTracked(next);
    return next;
  }

  const { error } = await supabase.from('tracked_xuids').delete().eq('id', item.id).eq('owner_id', user.id);

  if (error) {
    throw error;
  }

  return loadTrackedXuids();
}
