create table if not exists public.prize_keys (
  rank int primary key,
  file text,
  key text,
  item text not null
);

alter table public.prize_keys enable row level security;
revoke all on public.prize_keys from anon, authenticated;

create or replace function public.my_prize()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.event_config;
  my_rank int;
  pk public.prize_keys;
begin
  if auth.uid() is null then
    raise exception 'NOT_LOGGED_IN';
  end if;

  select * into cfg from public.event_config where id = 1;
  if now() < cfg.reveal_at then
    raise exception 'NOT_YET';
  end if;

  select t.r into my_rank
  from (
    select p.user_id, row_number() over (order by p.total desc, p.played_at asc) as r
    from public.players p
  ) t
  where t.user_id = auth.uid();

  if my_rank is null then
    raise exception 'NOT_PLAYED';
  end if;

  select * into pk from public.prize_keys where rank = my_rank;
  if not found then
    return jsonb_build_object('rank', my_rank, 'item', null);
  end if;

  return jsonb_build_object('rank', my_rank, 'item', pk.item, 'file', pk.file, 'key', pk.key);
end;
$$;

revoke all on function public.my_prize() from public, anon;
grant execute on function public.my_prize() to authenticated;
