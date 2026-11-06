-- Tracking links (2026-11-07): per-brand tagged URLs (Step 1) and short links on the brand's OWN domain (Step 2).
-- Paid plans only (cc_plans.sort_order >= 1). Access is only through the links-api / reach-agent edge functions and the
-- redirect function; tables have RLS on and no policies.
create table if not exists public.fma_link_settings (
  client_id uuid not null, brand text not null,
  tag_urls boolean not null default true,
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
-- one row per link per day, not one per click (a brand with millions of clicks stays cheap)
create table if not exists public.fma_link_daily (
  link_id uuid not null references public.fma_links(id) on delete cascade,
  day date not null,
  clicks integer not null default 0,
  bot_clicks integer not null default 0,
  primary key (link_id, day)
);
alter table public.fma_link_settings enable row level security;
alter table public.fma_link_domains  enable row level security;
alter table public.fma_links         enable row level security;
alter table public.fma_link_daily    enable row level security;
revoke all on public.fma_link_settings, public.fma_link_domains, public.fma_links, public.fma_link_daily from anon, authenticated;

create or replace function public.fma_paid(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from cc_subscriptions s join cc_plans p on p.id = s.plan_id
                 where s.client_id = p_client and s.status in ('active','trialing') and p.sort_order >= 1);
$$;

create or replace function public.fma_track_info(p_client uuid, p_brand text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_paid boolean; v_tag boolean; v_short boolean; v_host text;
begin
  v_paid := fma_paid(p_client);
  select tag_urls, short_enabled into v_tag, v_short from fma_link_settings where client_id = p_client and brand = p_brand;
  if not found then v_tag := true; v_short := false; end if;
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

-- called by the redirect function with the public key: returns where to send the visitor and counts the visit
create or replace function public.fma_link_resolve(p_host text, p_code text, p_bot boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_target text;
begin
  if coalesce(p_code, '') = '' then
    select home_url into v_target from fma_link_domains where hostname = lower(p_host);
    return v_target;
  end if;
  select id, target_url into v_id, v_target from fma_links where host = lower(p_host) and code = p_code;
  if not found then return null; end if;
  insert into fma_link_daily (link_id, day, clicks, bot_clicks)
  values (v_id, (now() at time zone 'utc')::date, case when p_bot then 0 else 1 end, case when p_bot then 1 else 0 end)
  on conflict (link_id, day) do update set clicks = fma_link_daily.clicks + excluded.clicks, bot_clicks = fma_link_daily.bot_clicks + excluded.bot_clicks;
  return v_target;
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

revoke all on function public.fma_paid(uuid), public.fma_track_info(uuid, text), public.fma_make_link(uuid, text, text, text, text, text, text), public.fma_link_stats(uuid, text, int), public.fma_link_resolve(text, text, boolean) from public, anon, authenticated;
grant execute on function public.fma_paid(uuid), public.fma_track_info(uuid, text), public.fma_make_link(uuid, text, text, text, text, text, text), public.fma_link_stats(uuid, text, int) to service_role;
grant execute on function public.fma_link_resolve(text, text, boolean) to anon, authenticated, service_role;
