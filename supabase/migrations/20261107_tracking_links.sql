-- Tracking links (2026-11-07): per-brand tagged URLs (Step 1) and short links on the brand's OWN domain (Step 2).
-- Growth and Agency plans only (cc_plans.sort_order >= 2). Access is only through the links-api / reach-agent edge functions and the
-- redirect function; tables have RLS on and no policies.
create table if not exists public.fma_link_settings (
  client_id uuid not null, brand text not null,
  tag_urls boolean not null default false,
  short_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (client_id, brand)
);
create table if not exists public.fma_link_domains (
  hostname text primary key,
  client_id uuid not null, brand text not null,
  status text not null default 'pending',        -- pending | active | error
  note text, home_url text,
  created_at timestamptz not null default now(), verified_at timestamptz
);
create unique index if not exists fma_link_domains_brand on public.fma_link_domains (client_id, brand);
create table if not exists public.fma_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null, brand text not null,
  host text not null, code text not null,
  target_url text not null,
  kind text not null default 'content',          -- content | reach
  ref text not null default '', network text not null default '', campaign text not null default '',
  created_at timestamptz not null default now(),
  unique (host, code)
);
create unique index if not exists fma_links_dedupe on public.fma_links (client_id, brand, kind, ref, network, target_url);
create index if not exists fma_links_brand on public.fma_links (client_id, brand);
-- daily rows older than 90 days are rolled into this running total, so storage stays flat however many years of posts a brand has
alter table public.fma_links add column if not exists clicks_total bigint not null default 0;
-- one row per link per day, not one per click (a brand with millions of clicks stays cheap)
create table if not exists public.fma_link_daily (
  link_id uuid not null references public.fma_links(id) on delete cascade,
  day date not null,
  clicks integer not null default 0,
  bot_clicks integer not null default 0,
  primary key (link_id, day)
);
-- monthly counted clicks per account (cost guard): past the cap links still redirect but are served from the CDN cache and not counted
create table if not exists public.fma_link_month (
  client_id uuid not null, month date not null, clicks integer not null default 0,
  primary key (client_id, month)
);
alter table public.fma_link_month enable row level security;
revoke all on public.fma_link_month from anon, authenticated;
alter table public.fma_link_settings enable row level security;
alter table public.fma_link_domains  enable row level security;
alter table public.fma_links         enable row level security;
alter table public.fma_link_daily    enable row level security;
revoke all on public.fma_link_settings, public.fma_link_domains, public.fma_links, public.fma_link_daily from anon, authenticated;

create or replace function public.fma_paid(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_subscriptions s join cc_plans p on p.id = s.plan_id
                 where s.client_id = p_client and s.status in ('active','trialing') and p.sort_order >= 2);
$$;

create or replace function public.fma_track_info(p_client uuid, p_brand text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_paid boolean; v_tag boolean; v_short boolean; v_host text;
begin
  v_paid := fma_paid(p_client);
  select tag_urls, short_enabled into v_tag, v_short from fma_link_settings where client_id = p_client and brand = p_brand;
  if not found then v_tag := false; v_short := false; end if;
  select hostname into v_host from fma_link_domains where client_id = p_client and brand = p_brand and status = 'active';
  return jsonb_build_object('eligible', v_paid, 'tag', v_paid and v_tag,
    'short', v_paid and v_short and v_host is not null, 'host', v_host);
end $$;

create or replace function public.fma_make_link(p_client uuid, p_brand text, p_kind text, p_ref text, p_network text, p_campaign text, p_target text)
returns text language plpgsql security definer set search_path = public as $$
declare info jsonb; v_host text; v_code text; v_i int; v_chars text := 'abcdefghjkmnpqrstuvwxyz23456789';
begin
  info := fma_track_info(p_client, p_brand);
  if not coalesce((info->>'short')::boolean, false) then return null; end if;
  v_host := info->>'host';
  select code into v_code from fma_links where client_id = p_client and brand = p_brand and kind = p_kind and ref = p_ref and network = p_network and target_url = p_target;
  if found then return 'https://' || v_host || '/' || v_code; end if;
  if (select count(*) from fma_links where client_id = p_client) >= fma_link_cap(p_client) then return null; end if;
  for v_i in 1..8 loop
    v_code := '';
    for k in 1..7 loop v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::int, 1); end loop;
    begin
      insert into fma_links (client_id, brand, host, code, target_url, kind, ref, network, campaign)
      values (p_client, p_brand, v_host, v_code, p_target, p_kind, p_ref, p_network, left(coalesce(p_campaign, ''), 80));
      return 'https://' || v_host || '/' || v_code;
    exception when unique_violation then
      select code into v_code from fma_links where client_id = p_client and brand = p_brand and kind = p_kind and ref = p_ref and network = p_network and target_url = p_target;
      if found then return 'https://' || v_host || '/' || v_code; end if;
    end;
  end loop;
  return null;
end $$;

create or replace function public.fma_click_cap(p_client uuid) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select case p.sort_order when 2 then 100000 when 3 then 1000000 else 0 end
                   from cc_subscriptions s join cc_plans p on p.id = s.plan_id
                   where s.client_id = p_client and s.status in ('active','trialing') and p.sort_order >= 2
                   order by p.sort_order desc limit 1), 0);
$$;

-- how many short links one account may hold (cost guard); past it the app falls back to the tagged long link, which costs nothing
create or replace function public.fma_link_cap(p_client uuid) returns integer
language sql stable security definer set search_path = public as $$
  select case when fma_click_cap(p_client) >= 1000000 then 50000 when fma_click_cap(p_client) > 0 then 5000 else 0 end;
$$;

create or replace function public.fma_link_rollup(p_client uuid) returns void
language sql security definer set search_path = public as $$
  with old as (
    select d.link_id, sum(d.clicks)::bigint c from fma_link_daily d join fma_links l on l.id = d.link_id
    where l.client_id = p_client and d.day < (now() at time zone 'utc')::date - 90 group by d.link_id),
  upd as (update fma_links l set clicks_total = l.clicks_total + o.c from old o where l.id = o.link_id returning l.id)
  delete from fma_link_daily d using fma_links l
  where l.id = d.link_id and l.client_id = p_client and d.day < (now() at time zone 'utc')::date - 90;
$$;

create or replace function public.fma_link_usage(p_client uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('used', coalesce((select clicks from fma_link_month where client_id = p_client and month = date_trunc('month', now() at time zone 'utc')::date), 0),
                            'cap', fma_click_cap(p_client));
$$;

-- called by the redirect function with the public key: returns where to send the visitor, and whether the visit was counted.
-- Bots and link-preview fetches are never counted or written. Past the monthly cap the redirect still works (links never break)
-- but is not counted, so the redirect function lets the CDN cache it.
drop function if exists public.fma_link_resolve(text, text, boolean);
create or replace function public.fma_link_resolve(p_host text, p_code text, p_bot boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid; v_target text; v_cap int; v_used int; v_month date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if coalesce(p_code, '') = '' then
    select home_url into v_target from fma_link_domains where hostname = lower(p_host);
    if v_target is null then return null; end if;
    return jsonb_build_object('url', v_target, 'counted', false);
  end if;
  select id, client_id, target_url into v_id, v_client, v_target from fma_links where host = lower(p_host) and code = p_code;
  if not found then return null; end if;
  if p_bot then return jsonb_build_object('url', v_target, 'counted', false); end if;
  v_cap := fma_click_cap(v_client);
  select clicks into v_used from fma_link_month where client_id = v_client and month = v_month;
  if coalesce(v_used, 0) >= v_cap then return jsonb_build_object('url', v_target, 'counted', false, 'over', true); end if;
  insert into fma_link_month (client_id, month, clicks) values (v_client, v_month, 1)
    on conflict (client_id, month) do update set clicks = fma_link_month.clicks + 1;
  insert into fma_link_daily (link_id, day, clicks) values (v_id, (now() at time zone 'utc')::date, 1)
    on conflict (link_id, day) do update set clicks = fma_link_daily.clicks + 1;
  return jsonb_build_object('url', v_target, 'counted', true);
end $$;

create or replace function public.fma_link_stats(p_client uuid, p_brand text, p_days int default 30) returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (
    select l.id, l.kind, l.ref, l.network, l.campaign, l.code, l.host, coalesce(sum(x.clicks), 0)::int as clicks
    from fma_links l left join fma_link_daily x on x.link_id = l.id and x.day >= (now() at time zone 'utc')::date - greatest(p_days, 1)
    where l.client_id = p_client and l.brand = p_brand
    group by l.id)
  select jsonb_build_object(
    'total', coalesce((select sum(clicks) from d), 0),
    'links', (select count(*) from d),
    'top', coalesce((select jsonb_agg(t) from (select kind, ref, network, campaign, code, host, clicks from d where clicks > 0 order by clicks desc limit 15) t), '[]'::jsonb),
    'byNetwork', coalesce((select jsonb_object_agg(network, c) from (select network, sum(clicks)::int c from d where clicks > 0 group by network) n), '{}'::jsonb),
    'byCampaign', coalesce((select jsonb_object_agg(campaign, c) from (select campaign, sum(clicks)::int c from d where clicks > 0 and campaign <> '' group by campaign) n), '{}'::jsonb));
$$;

revoke all on function public.fma_link_cap(uuid), public.fma_link_rollup(uuid), public.fma_click_cap(uuid), public.fma_link_usage(uuid), public.fma_paid(uuid), public.fma_track_info(uuid, text), public.fma_make_link(uuid, text, text, text, text, text, text), public.fma_link_stats(uuid, text, int), public.fma_link_resolve(text, text, boolean) from public, anon, authenticated;
grant execute on function public.fma_link_cap(uuid), public.fma_link_rollup(uuid), public.fma_click_cap(uuid), public.fma_link_usage(uuid), public.fma_paid(uuid), public.fma_track_info(uuid, text), public.fma_make_link(uuid, text, text, text, text, text, text), public.fma_link_stats(uuid, text, int) to service_role;
grant execute on function public.fma_link_resolve(text, text, boolean) to anon, authenticated, service_role;
