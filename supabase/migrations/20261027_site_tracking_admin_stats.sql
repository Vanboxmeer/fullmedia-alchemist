-- First-party, cookie-free visit tracking for the Alchemist site (no IP stored, no third party, no cost)
create table if not exists public.site_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  sid text not null,
  event text not null,
  path text not null default '/',
  ref_host text not null default '',
  src text not null default '',
  medium text not null default '',
  campaign text not null default '',
  device text not null default '',
  extra jsonb
);
create index if not exists site_events_at_idx on public.site_events (at desc);
create index if not exists site_events_sid_idx on public.site_events (sid, at);
alter table public.site_events enable row level security;
-- no policies: written only through site_track(), read only through site_report() (service role)

create or replace function public.site_track(p_sid text, p_event text, p_path text, p_ref text, p_src text, p_medium text, p_campaign text, p_device text, p_extra jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_sid is null or length(p_sid) < 8 or length(p_sid) > 40 then return; end if;
  if p_event is null or p_event not in ('view','cta','pricing','signup_click','try','try_ok','signup','app_open','first_brand','first_campaign','checkout') then return; end if;
  if (select count(*) from public.site_events e where e.sid = p_sid and e.at > now() - interval '10 minutes') >= 60 then return; end if;
  insert into public.site_events(sid, event, path, ref_host, src, medium, campaign, device, extra)
  values (p_sid, p_event, left(coalesce(p_path,'/'),200), left(coalesce(p_ref,''),100), left(coalesce(p_src,''),60), left(coalesce(p_medium,''),60), left(coalesce(p_campaign,''),80), left(coalesce(p_device,''),12),
          case when p_extra is not null and length(p_extra::text) < 500 then p_extra else null end);
end $$;
revoke all on function public.site_track(text,text,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.site_track(text,text,text,text,text,text,text,text,jsonb) to anon, authenticated;

create or replace function public.site_channel(ref text, src text)
returns text language sql immutable as $$
  select case
    when coalesce(src,'') <> '' then lower(src)
    when coalesce(ref,'') = '' or ref ~* 'fullmediaalchemist\.com$' then 'Direct'
    when ref ~* '(^|\.)(google|bing|duckduckgo|ecosia|yahoo|brave|startpage|baidu|yandex)\.' then 'Search'
    when ref ~* '(claude\.ai|chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com)' then 'AI assistants'
    when ref ~* '(^|\.)(x\.com|twitter\.com|t\.co)$' then 'X'
    when ref ~* '(^|\.)reddit\.com$' then 'Reddit'
    when ref ~* '(linkedin\.com|lnkd\.in)$' then 'LinkedIn'
    when ref ~* '(facebook\.com|fb\.com|instagram\.com|threads\.net)$' then 'Facebook / Instagram'
    when ref ~* '(youtube\.com|youtu\.be)$' then 'YouTube'
    when ref ~* 'tiktok\.com$' then 'TikTok'
    else 'Referral: ' || ref
  end $$;

create or replace function public.site_report(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,30), 365)));
  out jsonb;
begin
  with ev as (select * from public.site_events where at >= since),
  views as (select * from ev where event = 'view'),
  sess as (
    select distinct on (sid) sid, at as first_at, path as landing, device, public.site_channel(ref_host, src) as channel, campaign, medium, ref_host
    from views order by sid, at, id
  ),
  per as (
    select s.sid, s.channel, s.landing, s.device, s.campaign, s.first_at,
      (select count(*) from views v where v.sid = s.sid) as pv,
      exists(select 1 from ev e where e.sid = s.sid and e.event = 'pricing') as pricing,
      exists(select 1 from ev e where e.sid = s.sid and e.event in ('try','try_ok')) as tried,
      exists(select 1 from ev e where e.sid = s.sid and e.event = 'signup_click') as sclick,
      exists(select 1 from ev e where e.sid = s.sid and e.event = 'signup') as signup,
      exists(select 1 from ev e where e.sid = s.sid and e.event = 'first_brand') as brand,
      exists(select 1 from ev e where e.sid = s.sid and e.event = 'first_campaign') as camp,
      exists(select 1 from ev e where e.sid = s.sid and e.event = 'checkout') as paid
    from sess s
  )
  select jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days,30), 365)),
    'visits', (select count(*) from per),
    'pageviews', (select count(*) from views),
    'bounce', (select count(*) from per where pv = 1 and not (pricing or tried or sclick or signup)),
    'signups', (select count(*) from per where signup),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'visits', v, 'signups', su) order by d) from (
        select date_trunc('day', first_at)::date as d, count(*) as v, count(*) filter (where signup) as su from per group by 1) x), '[]'::jsonb),
    'funnel', jsonb_build_object(
        'visits', (select count(*) from per),
        'pricing', (select count(*) from per where pricing),
        'tried', (select count(*) from per where tried),
        'signup_click', (select count(*) from per where sclick or signup),
        'signup', (select count(*) from per where signup),
        'first_brand', (select count(*) from per where brand),
        'first_campaign', (select count(*) from per where camp),
        'paid', (select count(*) from per where paid)),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'visits', v, 'pricing', pr, 'tried', tr, 'signups', su) order by v desc) from (
        select channel, count(*) v, count(*) filter (where pricing) pr, count(*) filter (where tried) tr, count(*) filter (where signup) su from per group by 1 order by 2 desc limit 25) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', campaign, 'channel', channel, 'visits', v, 'signups', su) order by v desc) from (
        select s.campaign, s.channel, count(*) v, count(*) filter (where p.signup) su from sess s join per p using (sid) where s.campaign <> '' group by 1,2 order by 3 desc limit 20) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'views', n, 'visits', u) order by n desc) from (
        select path, count(*) n, count(distinct sid) u from views group by 1 order by 2 desc limit 20) x), '[]'::jsonb),
    'landing', coalesce((select jsonb_agg(jsonb_build_object('path', landing, 'visits', v, 'signups', su) order by v desc) from (
        select landing, count(*) v, count(*) filter (where signup) su from per group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device', device, 'visits', v) order by v desc) from (
        select coalesce(nullif(device,''),'unknown') device, count(*) v from per group by 1) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(jsonb_build_object('host', ref_host, 'visits', v) order by v desc) from (
        select ref_host, count(*) v from sess where ref_host <> '' group by 1 order by 2 desc limit 15) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;
revoke all on function public.site_report(int) from public, anon, authenticated;
grant execute on function public.site_report(int) to service_role;

-- Whole-business numbers for the admin page (accounts, activation, revenue, usage, Reach AI cost estimate)
create or replace function public.admin_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  d int := greatest(1, least(coalesce(p_days,30), 365));
  since timestamptz := now() - make_interval(days => d);
  prev  timestamptz := now() - make_interval(days => 2*d);
  admins text[] := array['brad@unitedpress.media'];
  out jsonb;
begin
  with
  u as (select id, created_at, last_sign_in_at, coalesce(raw_app_meta_data->>'provider','email') as prov
        from auth.users where coalesce(email,'') <> all(admins)),
  days as (select generate_series(date_trunc('day', since)::date, current_date, interval '1 day')::date as day),
  ub as (select x.user_id, b.client_id from public.cc_user_brands x join public.cc_brands b on b.name = x.brand and b.client_id is not null),
  gen as (select client_id, created_at, credits_consumed from public.cc_usage_events
          where event_type = 'content_generated' and coalesce(credits_consumed,0) > 0 and coalesce(metadata->>'is_admin_run','') <> 'true'),
  newu as (select * from u where created_at >= since),
  cc_price as (
    select s.client_id, s.is_comp, s.status,
      case when s.billing_interval ilike 'y%' or s.billing_interval ilike 'a%' then coalesce(p.annual_price_cents,0)/12.0 else coalesce(p.price_cents,0) end as mrr,
      coalesce(p.price_cents,0) as list, p.key as plan
    from public.cc_subscriptions s join public.cc_plans p on p.id = s.plan_id where s.status = 'active'),
  ar_price as (
    select s.client_id, s.is_comp, s.status,
      case when s.billing_interval ilike 'y%' or s.billing_interval ilike 'a%' then coalesce(p.annual_price_cents,0)/12.0 else coalesce(p.price_cents,0) end as mrr,
      coalesce(p.price_cents,0) as list, p.key as plan
    from public.ar_subscriptions s join public.ar_plans p on p.key = s.plan_key where s.status = 'active'),
  aru as (select * from public.ar_usage_events where created_at >= since)
  select jsonb_build_object(
    'days', d,
    'generated_at', now(),
    'accounts', jsonb_build_object(
      'total', (select count(*) from u),
      'new', (select count(*) from newu),
      'new_prev', (select count(*) from u where created_at >= prev and created_at < since),
      'active_7d', (select count(*) from u where last_sign_in_at >= now() - interval '7 days'),
      'active_30d', (select count(*) from u where last_sign_in_at >= now() - interval '30 days'),
      'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', prov, 'n', n) order by n desc) from (select prov, count(*) n from newu group by 1) x), '[]'::jsonb),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'n', n) order by day) from (
          select days.day, count(u.id) n from days left join u on u.created_at::date = days.day group by 1) x), '[]'::jsonb)),
    'activation', jsonb_build_object(
      'signed_up', (select count(*) from newu),
      'brand', (select count(*) from newu where exists(select 1 from ub where ub.user_id = newu.id)),
      'generated', (select count(*) from newu where exists(select 1 from ub join gen on gen.client_id = ub.client_id where ub.user_id = newu.id)),
      'paying', (select count(*) from newu where exists(select 1 from ub join cc_price c on c.client_id = ub.client_id where ub.user_id = newu.id and not coalesce(c.is_comp,false) and c.list > 0))),
    'revenue', jsonb_build_object(
      'content_mrr_cents', (select round(coalesce(sum(mrr),0)) from cc_price where not coalesce(is_comp,false)),
      'reach_mrr_cents', (select round(coalesce(sum(mrr),0)) from ar_price where not coalesce(is_comp,false)),
      'content_paying', (select count(*) from cc_price where not coalesce(is_comp,false) and list > 0),
      'reach_paying', (select count(*) from ar_price where not coalesce(is_comp,false) and list > 0),
      'comped', (select (select count(*) from cc_price where coalesce(is_comp,false)) + (select count(*) from ar_price where coalesce(is_comp,false))),
      'content_by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'n', n) order by n desc) from (select plan, count(*) n from cc_price group by 1) x), '[]'::jsonb),
      'reach_by_plan', coalesce((select jsonb_agg(jsonb_build_object('plan', plan, 'n', n) order by n desc) from (select plan, count(*) n from ar_price group by 1) x), '[]'::jsonb)),
    'content', jsonb_build_object(
      'credits', (select coalesce(sum(credits_consumed),0) from gen where created_at >= since),
      'active_brands', (select count(distinct client_id) from gen where created_at >= since),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'credits', c) order by day) from (
          select days.day, coalesce(sum(g.credits_consumed),0) c from days left join gen g on g.created_at::date = days.day group by 1) x), '[]'::jsonb)),
    'reach', jsonb_build_object(
      'calls', (select count(*) from aru),
      'failed', (select count(*) from aru where ok is false),
      'active_workspaces', (select count(distinct client_id) from aru),
      'tokens_in', (select coalesce(sum(tokens_in),0) from aru),
      'tokens_out', (select coalesce(sum(tokens_out),0) from aru),
      'web_searches', (select count(*) from aru where feature = 'web_search'),
      'est_cost_cents', (select round(coalesce(sum(tokens_in),0) * 0.0001 + coalesce(sum(tokens_out),0) * 0.0005 + count(*) filter (where feature = 'web_search') * 1.0, 1) from aru),
      'by_feature', coalesce((select jsonb_agg(jsonb_build_object('feature', feature, 'n', n) order by n desc) from (select feature, count(*) n from aru group by 1) x), '[]'::jsonb),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'n', c) order by day) from (
          select days.day, count(a.id) c from days left join aru a on a.created_at::date = days.day group by 1) x), '[]'::jsonb),
      'workspaces_total', (select count(*) from public.ar_subscriptions),
      'deals_total', (select count(*) from public.ar_deals)),
    'site', public.site_report(d)
  ) into out;
  return out;
end $$;
revoke all on function public.admin_stats(int) from public, anon, authenticated;
grant execute on function public.admin_stats(int) to service_role;
