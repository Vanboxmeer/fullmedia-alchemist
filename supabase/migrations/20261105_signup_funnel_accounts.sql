-- Funnel: sign-ups = the larger of tracked browser events and real Alchemist accounts (signup_app = 'alchemist'), so a lost browser event no longer shows 0%.
create or replace function public.site_report(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,30), 365)));
  out jsonb;
  acct int := 0;
begin
  -- real accounts made on Alchemist (tagged signup_app) in this window: the browser event misses people who open the magic link in a new tab
  select count(*) into acct from auth.users u where u.created_at >= since and u.raw_user_meta_data->>'signup_app' = 'alchemist';
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
    'signups', greatest((select count(*) from per where signup), acct),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'visits', v, 'signups', su) order by d) from (
        select date_trunc('day', first_at)::date as d, count(*) as v, count(*) filter (where signup) as su from per group by 1) x), '[]'::jsonb),
    'funnel', jsonb_build_object(
        'visits', (select count(*) from per),
        'pricing', (select count(*) from per where pricing),
        'tried', (select count(*) from per where tried),
        'signup_click', greatest((select count(*) from per where sclick or signup), acct),
        'signup', greatest((select count(*) from per where signup), acct),
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
