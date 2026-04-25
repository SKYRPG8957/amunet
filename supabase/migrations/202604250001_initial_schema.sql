create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  gamer_tag text,
  xbox_xuid text,
  avatar_url text,
  preferred_region text not null default 'KR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tracked_xuids (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  xuid text not null check (xuid ~ '^[0-9]{6,20}$'),
  gamertag text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, xuid)
);

create table if not exists public.world_sessions (
  handle_id text primary key check (char_length(handle_id) between 8 and 512),
  owner_xuid text check (owner_xuid is null or owner_xuid ~ '^[0-9]{6,20}$'),
  owner_gamertag text,
  title text not null default 'Minecraft World',
  world_type text,
  version text,
  protocol integer check (protocol is null or protocol >= 0),
  member_count integer not null default 0 check (member_count >= 0),
  max_member_count integer not null default 0 check (max_member_count >= 0),
  join_restriction text,
  visibility text,
  source text not null default 'xbox_activity',
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bridge_targets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  host text not null check (char_length(host) between 3 and 255),
  port integer not null default 19132 check (port between 1 and 65535),
  region text not null default 'Global',
  language text not null default 'en',
  category text not null default 'Public Server',
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.favorite_worlds (
  user_id uuid not null references auth.users (id) on delete cascade,
  handle_id text not null references public.world_sessions (handle_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, handle_id)
);

create table if not exists public.favorite_targets (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references public.bridge_targets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, target_id)
);

create table if not exists public.host_presence (
  xuid text primary key check (xuid ~ '^[0-9]{6,20}$'),
  gamertag text,
  country text,
  presence text not null default 'unknown',
  raw jsonb not null default '{}'::jsonb,
  last_seen_ms bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.community_messages (
  id uuid primary key default gen_random_uuid(),
  room text not null default 'global' check (char_length(room) between 2 and 40),
  author_id uuid references auth.users (id) on delete set null,
  author_name text not null default 'Luma 유저' check (char_length(author_name) between 1 and 40),
  body text not null check (char_length(body) between 1 and 500),
  country text not null default 'GLOBAL' check (char_length(country) between 2 and 16),
  created_at timestamptz not null default now()
);

create table if not exists public.provider_snapshots (
  provider text primary key,
  status text not null default 'ok',
  item_count integer not null default 0 check (item_count >= 0),
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tracked_xuids_owner_idx on public.tracked_xuids (owner_id);
create index if not exists tracked_xuids_xuid_idx on public.tracked_xuids (xuid);
create index if not exists world_sessions_owner_idx on public.world_sessions (owner_xuid);
create index if not exists world_sessions_updated_idx on public.world_sessions (updated_at desc);
create index if not exists world_sessions_members_idx on public.world_sessions (member_count desc);
create index if not exists bridge_targets_owner_idx on public.bridge_targets (owner_id);
create index if not exists bridge_targets_host_idx on public.bridge_targets (host, port);
create index if not exists bridge_targets_tags_idx on public.bridge_targets using gin (tags);
create index if not exists host_presence_presence_idx on public.host_presence (presence);
create index if not exists host_presence_seen_idx on public.host_presence (last_seen_ms desc);
create index if not exists community_messages_room_created_idx on public.community_messages (room, created_at desc);
create index if not exists community_messages_country_idx on public.community_messages (country);
create index if not exists provider_snapshots_fetched_idx on public.provider_snapshots (fetched_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists tracked_xuids_set_updated_at on public.tracked_xuids;
create trigger tracked_xuids_set_updated_at
before update on public.tracked_xuids
for each row execute function public.set_updated_at();

drop trigger if exists world_sessions_set_updated_at on public.world_sessions;
create trigger world_sessions_set_updated_at
before update on public.world_sessions
for each row execute function public.set_updated_at();

drop trigger if exists bridge_targets_set_updated_at on public.bridge_targets;
create trigger bridge_targets_set_updated_at
before update on public.bridge_targets
for each row execute function public.set_updated_at();

drop trigger if exists host_presence_set_updated_at on public.host_presence;
create trigger host_presence_set_updated_at
before update on public.host_presence
for each row execute function public.set_updated_at();

drop trigger if exists provider_snapshots_set_updated_at on public.provider_snapshots;
create trigger provider_snapshots_set_updated_at
before update on public.provider_snapshots
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.tracked_xuids enable row level security;
alter table public.world_sessions enable row level security;
alter table public.bridge_targets enable row level security;
alter table public.favorite_worlds enable row level security;
alter table public.favorite_targets enable row level security;
alter table public.host_presence enable row level security;
alter table public.community_messages enable row level security;
alter table public.provider_snapshots enable row level security;

drop policy if exists "Profiles are visible" on public.profiles;
create policy "Profiles are visible"
on public.profiles for select
using (true);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Users can read own tracked xuids" on public.tracked_xuids;
create policy "Users can read own tracked xuids"
on public.tracked_xuids for select
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Users can create own tracked xuids" on public.tracked_xuids;
create policy "Users can create own tracked xuids"
on public.tracked_xuids for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update own tracked xuids" on public.tracked_xuids;
create policy "Users can update own tracked xuids"
on public.tracked_xuids for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete own tracked xuids" on public.tracked_xuids;
create policy "Users can delete own tracked xuids"
on public.tracked_xuids for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "World sessions are visible" on public.world_sessions;
create policy "World sessions are visible"
on public.world_sessions for select
using (true);

drop policy if exists "Host presence is visible" on public.host_presence;
create policy "Host presence is visible"
on public.host_presence for select
using (true);

drop policy if exists "Community messages are visible" on public.community_messages;
create policy "Community messages are visible"
on public.community_messages for select
using (true);

drop policy if exists "Authenticated users can send community messages" on public.community_messages;
create policy "Authenticated users can send community messages"
on public.community_messages for insert
to authenticated
with check ((select auth.uid()) = author_id);

drop policy if exists "Provider snapshots are visible" on public.provider_snapshots;
create policy "Provider snapshots are visible"
on public.provider_snapshots for select
using (true);

drop policy if exists "Authenticated users can cache world sessions" on public.world_sessions;
drop policy if exists "Authenticated users can refresh world sessions" on public.world_sessions;

drop policy if exists "Bridge targets are visible" on public.bridge_targets;
create policy "Bridge targets are visible"
on public.bridge_targets for select
using (owner_id is null or (select auth.uid()) = owner_id);

drop policy if exists "Users can create own bridge targets" on public.bridge_targets;
create policy "Users can create own bridge targets"
on public.bridge_targets for insert
to authenticated
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can update own bridge targets" on public.bridge_targets;
create policy "Users can update own bridge targets"
on public.bridge_targets for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

drop policy if exists "Users can delete own bridge targets" on public.bridge_targets;
create policy "Users can delete own bridge targets"
on public.bridge_targets for delete
to authenticated
using ((select auth.uid()) = owner_id);

drop policy if exists "Users can read own favorite worlds" on public.favorite_worlds;
create policy "Users can read own favorite worlds"
on public.favorite_worlds for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own favorite worlds" on public.favorite_worlds;
create policy "Users can create own favorite worlds"
on public.favorite_worlds for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own favorite worlds" on public.favorite_worlds;
create policy "Users can delete own favorite worlds"
on public.favorite_worlds for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can read own favorite targets" on public.favorite_targets;
create policy "Users can read own favorite targets"
on public.favorite_targets for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own favorite targets" on public.favorite_targets;
create policy "Users can create own favorite targets"
on public.favorite_targets for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own favorite targets" on public.favorite_targets;
create policy "Users can delete own favorite targets"
on public.favorite_targets for delete
to authenticated
using ((select auth.uid()) = user_id);
