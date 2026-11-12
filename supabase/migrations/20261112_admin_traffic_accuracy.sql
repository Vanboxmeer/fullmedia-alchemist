-- Admin accuracy pass (2026-11-12). Additive: new columns/functions, one new event name. Nothing is deleted.
-- 1) real vs bot traffic: the visit counter now records an "engaged" signal (scroll/click/touch/keys) and the server tags bot-like requests
-- 2) activity from real sessions (auth.sessions), not last_sign_in_at (people who stay signed in were counted as inactive)
-- 3) site_report: people vs unconfirmed vs bots; page groups (home / blog / pricing ...); blog posts; funnel
-- 4) admin_stats: conversion + activity + support + team numbers

alter table public.site_events add column if not exists bot boolean not null default false;
alter table public.site_events add column if not exists bot_reason text;
create index if not exists site_events_sid_event_idx on public.site_events (sid, event);

-- user-agent check done server-side from the request headers (the browser's own text; we store only the verdict, never the text)
create or replace function public.site_ua_reason(ua text)
returns text language sql immutable set search_path = public as $$
  select case
    when coalesce(ua,'') = '' then 'no user agent'
    when ua ~* '(bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptime|monitor|preview|scanner|checker|fetch|curl|wget|python|go-http|java/|okhttp|axios|node-|scrapy|phantom|selenium|playwright|puppeteer|httpclient|libwww|facebookexternalhit|embedly|whatsapp|telegram|discord|slack|skype|vkshare|bytespider|gptbot|claudebot|perplexity|ahrefs|semrush|mj12|dotbot|petal|yandex|baidu|duckduck|applebot|bingpreview|google-read-aloud|chrome-lighthouse)' then 'bot user agent'
    else null end
$$;

create or replace function public.site_track(p_sid text, p_event text, p_path text, p_ref text, p_src text, p_medium text, p_campaign text, p_device text, p_extra jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
declare ua text := ''; why text;
begin
  if p_sid is null or length(p_sid) < 8 or length(p_sid) > 40 then return; end if;
  if p_event is null or p_event not in ('view','cta','pricing','signup_click','try','try_ok','signup','app_open','first_brand','first_campaign','checkout','engaged') then return; end if;
  if (select count(*) from public.site_events e where e.sid = p_sid and e.at > now() - interval '10 minutes') >= 60 then return; end if;
  begin ua := coalesce((current_setting('request.headers', true))::json ->> 'user-agent', ''); exception when others then ua := ''; end;
  why := public.site_ua_reason(ua);
  insert into public.site_events(sid, event, path, ref_host, src, medium, campaign, device, extra, bot, bot_reason)
  values (p_sid, p_event, left(coalesce(p_path,'/'),200), left(coalesce(p_ref,''),100), left(coalesce(p_src,''),60), left(coalesce(p_medium,''),60), left(coalesce(p_campaign,''),80), left(coalesce(p_device,''),12),
          case when p_extra is not null and length(p_extra::text) < 500 then p_extra else null end, why is not null, why);
end $$;

-- page group for a path
create or replace function public.site_page_group(p text)
returns text language sql immutable set search_path = public as $$
  select case
    when p = '/' or p = '' or p like '/index%' then 'Homepage'
    when p like '/blog%' then 'Blog'
    when p like '/pricing%' then 'Pricing'
    when p like '/reach%' then 'Reach pages'
    when p like '/for/%' or p like '/compare%' or p like '/resources%' or p like '/tools%' then 'Use-case & compare'
    when p like '/help%' or p like '/terms%' or p like '/privacy%' then 'Help & legal'
    when p like '/login%' or p like '/dashboard%' or p like '/app%' then 'Sign-in / app'
    else 'Other' end
$$;

-- last real activity per account (a refresh of the sign-in session means the app was open); service role only
create or replace function public.admin_last_active()
returns table(user_id uuid, last_active timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select s.user_id, max(coalesce(s.refreshed_at, s.updated_at, s.created_at)) from auth.sessions s group by s.user_id
$$;
revoke all on function public.admin_last_active() from public, anon, authenticated;
grant execute on function public.admin_last_active() to service_role;

create or replace function public.site_report(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d int := greatest(1, least(coalesce(p_days,30), 365));
  since timestamptz := now() - make_interval(days => d);
  out jsonb; acct int := 0;
begin
  select count(*) into acct from public.fma_accounts a where a.app = 'alchemist' and not a.internal and a.created_at >= since;
  with ev as (select * from public.site_events where at >= since),
  views as (select * from ev where event = 'view'),
  sess as (
    select distinct on (sid) sid, at as first_at, path as landing, device, public.site_channel(ref_host, src) as channel, campaign, ref_host
    from views order by sid, at, id),
  agg as (
    select sid,
      count(*) filter (where event = 'view') pv,
      bool_or(bot) bot,
      bool_or(event = 'engaged') engaged,
      bool_or(event = 'pricing') pricing,
      bool_or(event in ('try','try_ok')) tried,
      bool_or(event = 'signup_click') sclick,
      bool_or(event = 'signup') signup,
      bool_or(event = 'first_brand') brand,
      bool_or(event = 'first_campaign') camp,
      bool_or(event = 'checkout') paid,
      count(distinct path) filter (where event = 'view') pages
    from ev group by sid),
  per as (
    select s.sid, s.first_at, s.landing, s.device, s.channel, s.campaign, s.ref_host, public.site_page_group(s.landing) as grp,
      a.pv, a.pages, a.bot, a.engaged, a.pricing, a.tried, a.sclick, a.signup, a.brand, a.camp, a.paid,
      case when a.bot then 'bot'
           when a.engaged or a.pv > 1 or a.pricing or a.tried or a.sclick or a.signup then 'person'
           else 'unconfirmed' end as kind
    from sess s join agg a using (sid)),
  vkind as (select v.*, p.kind, p.grp as landing_grp from views v join per p on p.sid = v.sid)
  select jsonb_build_object(
    'days', d,
    'engaged_since', (select min(at) from public.site_events where event = 'engaged'),
    'visits_all', (select count(*) from per),
    'visits_people', (select count(*) from per where kind = 'person'),
    'visits_unconfirmed', (select count(*) from per where kind = 'unconfirmed'),
    'visits_bots', (select count(*) from per where kind = 'bot'),
    'pageviews_people', (select count(*) from vkind where kind = 'person'),
    'pageviews_all', (select count(*) from views),
    'bounce_people', (select count(*) from per where kind = 'person' and pv = 1 and not (pricing or tried or sclick or signup)),
    'signups', greatest((select count(*) from per where signup and kind <> 'bot'), acct),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', dd, 'people', pe, 'unconfirmed', un, 'bots', bo, 'signups', su) order by dd) from (
        select date_trunc('day', first_at)::date dd, count(*) filter (where kind='person') pe, count(*) filter (where kind='unconfirmed') un, count(*) filter (where kind='bot') bo, count(*) filter (where signup) su from per group by 1) x), '[]'::jsonb),
    'funnel', jsonb_build_object(
        'visits', (select count(*) from per where kind = 'person'),
        'pricing', (select count(*) from per where kind = 'person' and pricing),
        'tried', (select count(*) from per where kind = 'person' and tried),
        'signup_click', (select count(*) from per where kind = 'person' and (sclick or signup)),
        'signup', greatest((select count(*) from per where kind <> 'bot' and signup), acct)),
    'groups', coalesce((select jsonb_agg(jsonb_build_object('group', grp, 'people', pe, 'unconfirmed', un, 'views', vw, 'signup_clicks', sc, 'signups', su) order by pe desc, un desc) from (
        select p.grp, count(*) filter (where p.kind='person') pe, count(*) filter (where p.kind='unconfirmed') un,
          (select count(*) from vkind v where v.landing_grp = p.grp and v.kind <> 'bot') vw,
          count(*) filter (where p.kind='person' and (p.sclick or p.signup)) sc, count(*) filter (where p.kind<>'bot' and p.signup) su
        from per p where p.kind <> 'bot' group by p.grp) x), '[]'::jsonb),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'group', public.site_page_group(path), 'views', n, 'visits', u, 'people', pe) order by n desc) from (
        select v.path, count(*) n, count(distinct v.sid) u, count(distinct v.sid) filter (where v.kind='person') pe from vkind v where v.kind <> 'bot' group by 1 order by 2 desc limit 30) x), '[]'::jsonb),
    'blog', jsonb_build_object(
        'visits', (select count(distinct v.sid) from vkind v where v.kind <> 'bot' and v.path like '/blog%'),
        'people', (select count(distinct v.sid) from vkind v where v.kind = 'person' and v.path like '/blog%'),
        'views', (select count(*) from vkind v where v.kind <> 'bot' and v.path like '/blog%'),
        'landed', (select count(*) from per where kind <> 'bot' and landing like '/blog%'),
        'landed_signup_clicks', (select count(*) from per where kind <> 'bot' and landing like '/blog%' and (sclick or signup)),
        'landed_signups', (select count(*) from per where kind <> 'bot' and landing like '/blog%' and signup),
        'posts', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'views', n, 'visits', u, 'people', pe, 'landed', ld, 'signup_clicks', sc) order by n desc) from (
            select v.path, count(*) n, count(distinct v.sid) u, count(distinct v.sid) filter (where v.kind='person') pe,
              count(distinct v.sid) filter (where (select p.landing from per p where p.sid = v.sid) = v.path) ld,
              count(distinct v.sid) filter (where exists(select 1 from per p where p.sid = v.sid and (p.sclick or p.signup))) sc
            from vkind v where v.kind <> 'bot' and v.path like '/blog/_%' group by 1 order by 2 desc limit 25) x), '[]'::jsonb)),
    'channels', coalesce((select jsonb_agg(jsonb_build_object('channel', channel, 'people', pe, 'unconfirmed', un, 'pricing', pr, 'signups', su) order by pe desc, un desc) from (
        select channel, count(*) filter (where kind='person') pe, count(*) filter (where kind='unconfirmed') un, count(*) filter (where kind='person' and pricing) pr, count(*) filter (where kind<>'bot' and signup) su
        from per where kind <> 'bot' group by 1 order by 2 desc, 3 desc limit 25) x), '[]'::jsonb),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('campaign', campaign, 'channel', channel, 'visits', v, 'signups', su) order by v desc) from (
        select campaign, channel, count(*) v, count(*) filter (where signup) su from per where campaign <> '' and kind <> 'bot' group by 1,2 order by 3 desc limit 20) x), '[]'::jsonb),
    'landing', coalesce((select jsonb_agg(jsonb_build_object('path', landing, 'people', pe, 'unconfirmed', un, 'signups', su, 'pricing', pr) order by pe desc, un desc) from (
        select landing, count(*) filter (where kind='person') pe, count(*) filter (where kind='unconfirmed') un, count(*) filter (where kind<>'bot' and signup) su, count(*) filter (where kind='person' and pricing) pr
        from per where kind <> 'bot' group by 1 order by 2 desc, 3 desc limit 15) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device', dv, 'people', pe, 'unconfirmed', un) order by pe desc, un desc) from (
        select coalesce(nullif(device,''),'unknown') dv, count(*) filter (where kind='person') pe, count(*) filter (where kind='unconfirmed') un from per where kind <> 'bot' group by 1) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(jsonb_build_object('host', ref_host, 'visits', v) order by v desc) from (
        select ref_host, count(*) v from per where ref_host <> '' and kind <> 'bot' group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'bot_reasons', coalesce((select jsonb_agg(jsonb_build_object('reason', r, 'n', n) order by n desc) from (
        select coalesce(bot_reason,'flagged') r, count(distinct sid) n from ev where bot group by 1) x), '[]'::jsonb),
    'signup_sources', coalesce((select jsonb_agg(jsonb_build_object('channel', ch, 'n', n) order by n desc) from (
        select coalesce(ch, 'unknown') ch, count(*) n from (
          select a.id, (select p.channel from ev e join per p on p.sid = e.sid where e.event = 'signup' and e.extra->>'uid' = a.id::text limit 1) ch
          from public.fma_accounts a where a.app = 'alchemist' and not a.internal and a.created_at >= since) q group by 1) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;

-- extra admin numbers that were missing or wrong: activity from real sessions, free -> paid conversion, support, team usage
create or replace function public.admin_stats_plus(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
declare
  d int := greatest(1, least(coalesce(p_days,30), 365));
  since timestamptz := now() - make_interval(days => d);
  out jsonb;
begin
  with
  u as (select a.id, a.email, a.created_at, a.internal, la.last_active
        from public.fma_accounts a left join public.admin_last_active() la on la.user_id = a.id where a.app = 'alchemist'),
  ub as (select x.user_id, b.client_id from public.cc_user_brands x join public.cc_brands b on b.name = x.brand and b.client_id is not null),
  mine as (select distinct ub.client_id from ub join public.fma_accounts a on a.id = ub.user_id where a.internal),
  gen_all as (select client_id, created_at, credits_consumed from public.cc_usage_events where event_type = 'content_generated' and coalesce(credits_consumed,0) > 0 and coalesce(metadata->>'is_admin_run','') <> 'true'),
  cc_s as (select s.client_id, s.is_comp, s.status, s.created_at, s.cancelled_at, s.cancel_at_period_end, coalesce(p.price_cents,0) list from public.cc_subscriptions s join public.cc_plans p on p.id = s.plan_id),
  ar_s as (select s.client_id, s.is_comp, s.status, s.created_at, s.cancel_at_period_end, coalesce(p.price_cents,0) list from public.ar_subscriptions s join public.ar_plans p on p.key = s.plan_key),
  ext as (select * from u where not internal)
  select jsonb_build_object(
    'activity', jsonb_build_object(
      'ext_total', (select count(*) from ext),
      'ext_active_today', (select count(*) from ext where last_active >= now() - interval '1 day'),
      'ext_active_7d', (select count(*) from ext where last_active >= now() - interval '7 days'),
      'ext_active_30d', (select count(*) from ext where last_active >= now() - interval '30 days'),
      'team_total', (select count(*) from u where internal),
      'team_active_7d', (select count(*) from u where internal and last_active >= now() - interval '7 days'),
      'dormant', (select count(*) from ext where last_active is null or last_active < now() - interval '30 days'),
      'signed_in_but_stale', (select count(*) from ext e join public.fma_accounts a on a.id = e.id where e.last_active >= now() - interval '7 days' and (a.last_sign_in_at is null or a.last_sign_in_at < now() - interval '7 days'))),
    'conversion', jsonb_build_object(
      'ext_accounts', (select count(*) from ext),
      'activated', (select count(*) from ext e where exists(select 1 from ub join gen_all g on g.client_id = ub.client_id where ub.user_id = e.id)),
      'paying', (select count(*) from ext e where exists(select 1 from ub join cc_s c on c.client_id = ub.client_id where ub.user_id = e.id and c.status = 'active' and not coalesce(c.is_comp,false) and c.list > 0)
                                                 or exists(select 1 from ub join ar_s c on c.client_id = ub.client_id where ub.user_id = e.id and c.status = 'active' and not coalesce(c.is_comp,false) and c.list > 0)),
      'comped', (select count(*) from ext e where exists(select 1 from ub join cc_s c on c.client_id = ub.client_id where ub.user_id = e.id and c.status = 'active' and coalesce(c.is_comp,false) and c.list > 0)
                                                 or exists(select 1 from ub join ar_s c on c.client_id = ub.client_id where ub.user_id = e.id and c.status = 'active' and coalesce(c.is_comp,false) and c.list > 0)),
      'new_paid_in_range', (select count(*) from cc_s where created_at >= since and not coalesce(is_comp,false) and list > 0 and status = 'active') + (select count(*) from ar_s where created_at >= since and not coalesce(is_comp,false) and list > 0 and status = 'active'),
      'cancelled_in_range', (select count(*) from cc_s where cancelled_at >= since and not coalesce(is_comp,false)) ,
      'cancelling', (select count(*) from cc_s where cancel_at_period_end and status = 'active' and not coalesce(is_comp,false)) + (select count(*) from ar_s where cancel_at_period_end and status = 'active' and not coalesce(is_comp,false)),
      'signed_up_in_range', (select count(*) from ext where created_at >= since),
      'paid_from_range', (select count(*) from ext e where e.created_at >= since and (exists(select 1 from ub join cc_s c on c.client_id = ub.client_id where ub.user_id = e.id and c.status = 'active' and not coalesce(c.is_comp,false) and c.list > 0)
                                                 or exists(select 1 from ub join ar_s c on c.client_id = ub.client_id where ub.user_id = e.id and c.status = 'active' and not coalesce(c.is_comp,false) and c.list > 0)))),
    'support', jsonb_build_object(
      'open_tickets', (select count(*) from public.cc_support_tickets where coalesce(status,'open') not in ('resolved','wont_fix','closed')),
      'open_feedback', (select count(*) from public.cc_client_feedback where status = 'open'),
      'total_tickets', (select count(*) from public.cc_support_tickets)),
    'team', jsonb_build_object(
      'credits', (select coalesce(sum(credits_consumed),0) from gen_all where created_at >= since and client_id in (select client_id from mine)),
      'generations', (select count(*) from gen_all where created_at >= since and client_id in (select client_id from mine))),
    'customers_usage', jsonb_build_object(
      'generations', (select count(*) from gen_all where created_at >= since and client_id not in (select client_id from mine)),
      'last_generation', (select max(created_at) from gen_all where client_id not in (select client_id from mine)))
  ) into out;
  return out;
end $$;
revoke all on function public.admin_stats_plus(integer) from public, anon, authenticated;
grant execute on function public.admin_stats_plus(integer) to service_role;
