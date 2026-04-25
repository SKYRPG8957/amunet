grant usage on schema public to anon, authenticated, service_role;

grant select on public.profiles to anon, authenticated;
grant update on public.profiles to authenticated;

grant select, insert, update, delete on public.tracked_xuids to authenticated;

grant select on public.world_sessions to anon, authenticated;

grant select on public.host_presence to anon, authenticated;

grant select, insert, update, delete on public.bridge_targets to authenticated;

grant select, insert, delete on public.favorite_worlds to authenticated;
grant select, insert, delete on public.favorite_targets to authenticated;

grant select on public.community_messages to anon, authenticated;
grant insert on public.community_messages to authenticated;

grant select on public.provider_snapshots to anon, authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all routines in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
