-- /games 일일 랭킹용. 이벤트용 players / event_config / play() 등은 건드리지 않는다.
-- 이미 만들어 둔 public.slot_points()는 그대로 재사용한다.

create table if not exists public.daily_players (
  user_id uuid not null references auth.users(id) on delete cascade,
  play_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  discord_id text not null,
  display_name text not null,
  username text,
  avatar_url text,
  paths jsonb not null,
  slots int[] not null,
  total int not null,
  played_at timestamptz not null default clock_timestamp(),
  primary key (user_id, play_date),
  unique (discord_id, play_date)
);

alter table public.daily_players enable row level security;
revoke all on public.daily_players from anon, authenticated;

create index if not exists daily_players_rank_idx on public.daily_players (play_date, total desc, played_at);

create or replace function public.daily_today()
returns date language sql stable as $$
  select (now() at time zone 'Asia/Seoul')::date
$$;

create or replace function public.daily_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := public.daily_today();
  cnt int;
  me public.daily_players;
begin
  select count(*) into cnt from public.daily_players where play_date = today;
  if auth.uid() is not null then
    select * into me from public.daily_players where user_id = auth.uid() and play_date = today;
  end if;
  return jsonb_build_object(
    'now', now(),
    'today', today,
    'reset_at', (today + 1)::timestamp at time zone 'Asia/Seoul',
    'count', cnt,
    'points', public.slot_points(),
    'me', case when me.user_id is null then null
               else jsonb_build_object('display_name', me.display_name, 'paths', me.paths,
                                       'slots', me.slots, 'total', me.total, 'played_at', me.played_at) end
  );
end;
$$;

create or replace function public.daily_play()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  today date := public.daily_today();
  ident jsonb;
  d_id text;
  d_display text;
  d_username text;
  d_avatar text;
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
  rec public.daily_players;
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

  perform pg_advisory_xact_lock(31102027);

  select * into rec from public.daily_players
  where play_date = today and (user_id = uid or discord_id = d_id)
  limit 1;
  if found then
    raise exception 'ALREADY_PLAYED';
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

  insert into public.daily_players (user_id, play_date, discord_id, display_name, username, avatar_url, paths, slots, total)
  values (uid, today, d_id, d_display, d_username, d_avatar, all_paths, slot_list, total_pts)
  returning * into rec;

  return jsonb_build_object('display_name', rec.display_name, 'paths', rec.paths,
                            'slots', rec.slots, 'total', rec.total, 'played_at', rec.played_at);
end;
$$;

-- 오늘(KST) 상위 100명 + 내 순위
create or replace function public.daily_leaderboard()
returns table (rank int, display_name text, username text, avatar_url text, total int, played_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select (row_number() over (order by p.total desc, p.played_at asc))::int as rk,
           p.display_name, p.username, p.avatar_url, p.total, p.played_at,
           (p.user_id = auth.uid()) as me
    from public.daily_players p
    where p.play_date = public.daily_today()
  )
  select t.rk, t.display_name, t.username, t.avatar_url, t.total, t.played_at, coalesce(t.me, false)
  from t
  where t.rk <= 100 or t.me
  order by t.rk
$$;

revoke all on function public.daily_play() from public, anon;
grant execute on function public.daily_play() to authenticated;
grant execute on function public.daily_status() to anon, authenticated;
grant execute on function public.daily_leaderboard() to anon, authenticated;
grant execute on function public.daily_today() to anon, authenticated;
