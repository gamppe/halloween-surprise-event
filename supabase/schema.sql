create extension if not exists pgcrypto with schema extensions;

create table if not exists public.event_config (
  id int primary key default 1 check (id = 1),
  max_players int not null default 20,
  close_at timestamptz not null default '2026-10-31 20:50:00+09',
  reveal_at timestamptz not null default '2026-10-31 21:00:00+09'
);
insert into public.event_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.players (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discord_id text not null unique,
  display_name text not null,
  username text,
  avatar_url text,
  paths jsonb not null,
  slots int[] not null,
  total int not null,
  played_at timestamptz not null default clock_timestamp()
);

alter table public.event_config enable row level security;
alter table public.players enable row level security;
revoke all on public.event_config from anon, authenticated;
revoke all on public.players from anon, authenticated;

create or replace function public.slot_points()
returns int[] language sql immutable as $$
  select array[500,120,40,15,6,2,1,2,6,15,40,120,500]
$$;

create or replace function public.event_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.event_config;
  cnt int;
  me public.players;
begin
  select * into cfg from public.event_config where id = 1;
  select count(*) into cnt from public.players;
  if auth.uid() is not null then
    select * into me from public.players where user_id = auth.uid();
  end if;
  return jsonb_build_object(
    'now', now(),
    'max_players', cfg.max_players,
    'close_at', cfg.close_at,
    'reveal_at', cfg.reveal_at,
    'count', cnt,
    'points', public.slot_points(),
    'me', case when me.user_id is null then null
               else jsonb_build_object('display_name', me.display_name, 'paths', me.paths,
                                       'slots', me.slots, 'total', me.total, 'played_at', me.played_at) end
  );
end;
$$;

create or replace function public.play()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  cfg public.event_config;
  ident jsonb;
  d_id text;
  d_display text;
  d_username text;
  d_avatar text;
  cnt int;
  pts int[] := public.slot_points();
  rows_n constant int := 12;
  balls constant int := 5;
  all_paths jsonb := '[]'::jsonb;
  slot_list int[] := '{}';
  total_pts int := 0;
  rnd bytea;
  bits int;
  path jsonb;
  s int;
  b int;
  r int;
  rec public.players;
begin
  if uid is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select identity_data into ident
  from auth.identities
  where user_id = uid and provider = 'discord'
  limit 1;
  if ident is null then
    raise exception 'NOT_DISCORD';
  end if;

  d_id := coalesce(ident->>'provider_id', ident->>'sub');
  d_username := coalesce(ident->>'full_name', ident->>'name');
  d_display := coalesce(ident->'custom_claims'->>'global_name', d_username, 'unknown');
  d_avatar := ident->>'avatar_url';

  perform pg_advisory_xact_lock(31102026);

  select * into rec from public.players where user_id = uid or discord_id = d_id limit 1;
  if found then
    raise exception 'ALREADY_PLAYED';
  end if;

  select * into cfg from public.event_config where id = 1;
  if now() >= cfg.close_at then
    raise exception 'CLOSED';
  end if;

  select count(*) into cnt from public.players;
  if cnt >= cfg.max_players then
    raise exception 'FULL';
  end if;

  for b in 1..balls loop
    rnd := gen_random_bytes(2);
    bits := get_byte(rnd, 0) * 256 + get_byte(rnd, 1);
    path := '[]'::jsonb;
    s := 0;
    for r in 0..rows_n - 1 loop
      path := path || to_jsonb((bits >> r) & 1);
      s := s + ((bits >> r) & 1);
    end loop;
    all_paths := all_paths || jsonb_build_array(path);
    slot_list := slot_list || s;
    total_pts := total_pts + pts[s + 1];
  end loop;

  insert into public.players (user_id, discord_id, display_name, username, avatar_url, paths, slots, total)
  values (uid, d_id, d_display, d_username, d_avatar, all_paths, slot_list, total_pts)
  returning * into rec;

  return jsonb_build_object('display_name', rec.display_name, 'paths', rec.paths,
                            'slots', rec.slots, 'total', rec.total, 'played_at', rec.played_at);
end;
$$;

create or replace function public.leaderboard()
returns table (rank int, display_name text, username text, avatar_url text, total int, played_at timestamptz, is_me boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.event_config;
begin
  select * into cfg from public.event_config where id = 1;
  if now() < cfg.reveal_at then
    raise exception 'NOT_YET';
  end if;
  return query
    select (row_number() over (order by p.total desc, p.played_at asc))::int,
           p.display_name, p.username, p.avatar_url, p.total, p.played_at,
           (p.user_id = auth.uid())
    from public.players p
    order by 1;
end;
$$;

revoke all on function public.play() from public, anon;
grant execute on function public.play() to authenticated;
grant execute on function public.event_status() to anon, authenticated;
grant execute on function public.leaderboard() to anon, authenticated;
grant execute on function public.slot_points() to anon, authenticated;
