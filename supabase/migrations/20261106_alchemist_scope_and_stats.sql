-- One definition of "an Alchemist account", used by the admin stats, the funnel and the People list.
-- The login system is shared with SpinQuest, so every account is classified: alchemist / spinquest / unknown.
-- Supersedes 20261105_signup_funnel_accounts.sql (run this one instead; it includes that change).
create table if not exists public.fma_internal_users (email text primary key, note text);
alter table public.fma_internal_users enable row level security;
insert into public.fma_internal_users (email, note) values
  ('brad@unitedpress.media', 'owner'),
  ('unitedpress.media@gmail.com', 'owner'),
  ('vanboxmeer.bradley@gmail.com', 'owner'),
  ('watchcrypto.media@gmail.com', 'own brand'),
  ('evrylife.org@gmail.com', 'own brand'),
  ('spinquest.app@gmail.com', 'own brand'),
  ('vaporsmooth.com@gmail.com', 'own brand')
on conflict (email) do nothing;

create or replace view public.fma_accounts as
select u.id, lower(coalesce(u.email, '')) as email, u.created_at, u.last_sign_in_at,
  coalesce(u.raw_app_meta_data->>'provider', 'email') as provider,
  case
    when u.raw_user_meta_data->>'signup_app' = 'alchemist'
      or exists (select 1 from public.cc_terms_acceptance t where t.user_id = u.id)
      or exists (select 1 from public.cc_user_brands b where b.user_id = u.id)
      or exists (select 1 from public.ar_accounts a where a.user_id = u.id) then 'alchemist'
    when exists (select 1 from public.analytics_events e where e.user_id = u.id) then 'spinquest'
    else 'unknown' end as app,
  (lower(coalesce(u.email, '')) in (select i.email from public.fma_internal_users i)
    or exists (select 1 from auth.identities x where x.user_id = u.id
               and lower(coalesce(x.identity_data->>'email', '')) in (select i.email from public.fma_internal_users i))) as internal
from auth.users u
where coalesce(u.email, '') not like 'zz-pentest%';
revoke all on public.fma_accounts from anon, authenticated;

create or replace function public.site_report(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days,30), 365)));
  out jsonb;
  acct int := 0;
begin
  select count(*) into acct from public.fma_accounts a where a.app = 'alchemist' and not a.internal and a.created_at >= since;
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
    'landing', coalesce((select jsonb_agg(jsonb_build_object('path', landing, 'visits', v, 'signups', su, 'pricing', pr) order by v desc) from (
        select landing, count(*) v, count(*) filter (where signup) su, count(*) filter (where pricing) pr from per group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device', device, 'visits', v, 'signups', su) order by v desc) from (
        select coalesce(nullif(device,''),'unknown') device, count(*) v, count(*) filter (where signup) su from per group by 1) x), '[]'::jsonb),
    'referrers', coalesce((select jsonb_agg(jsonb_build_object('host', ref_host, 'visits', v) order by v desc) from (
        select ref_host, count(*) v from sess where ref_host <> '' group by 1 order by 2 desc limit 15) x), '[]'::jsonb),
    'signup_sources', coalesce((select jsonb_agg(jsonb_build_object('channel', ch, 'n', n) order by n desc) from (
        select coalesce(ch, 'unknown') ch, count(*) n from (
          select a.id, (select p.channel from ev e join per p on p.sid = e.sid where e.event = 'signup' and e.extra->>'uid' = a.id::text limit 1) ch
          from public.fma_accounts a where a.app = 'alchemist' and not a.internal and a.created_at >= since) q group by 1) x), '[]'::jsonb)
  ) into out;
  return out;
end $$;

create or replace function public.admin_stats(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'auth' as $function$
declare
  d int := greatest(1, least(coalesce(p_days,30), 365));
  since timestamptz := now() - make_interval(days => d);
  prev  timestamptz := now() - make_interval(days => 2*d);
  out jsonb;
begin
  with
  u as (select id, email, created_at, last_sign_in_at, provider as prov from public.fma_accounts where app = 'alchemist' and not internal),
  days as (select generate_series(date_trunc('day', since)::date, current_date, interval '1 day')::date as day),
  ub as (select x.user_id, b.client_id from public.cc_user_brands x join public.cc_brands b on b.name = x.brand and b.client_id is not null),
  mine as (select distinct ub.client_id from ub join public.fma_accounts a on a.id = ub.user_id where a.internal),
  gen_all as (select client_id, created_at, credits_consumed from public.cc_usage_events
          where event_type = 'content_generated' and coalesce(credits_consumed,0) > 0 and coalesce(metadata->>'is_admin_run','') <> 'true'),
  gen as (select * from gen_all where client_id not in (select client_id from mine)),
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
  aru_all as (select * from public.ar_usage_events where created_at >= since),
  aru as (select * from aru_all where client_id not in (select client_id from mine))
  select jsonb_build_object(
    'days', d,
    'generated_at', now(),
    'accounts', jsonb_build_object(
      'total', (select count(*) from u),
      'new', (select count(*) from newu),
      'new_prev', (select count(*) from u where created_at >= prev and created_at < since),
      'active_7d', (select count(*) from u where last_sign_in_at >= now() - interval '7 days'),
      'active_30d', (select count(*) from u where last_sign_in_at >= now() - interval '30 days'),
      'internal', (select count(*) from public.fma_accounts where app = 'alchemist' and internal),
      'other_apps', (select count(*) from public.fma_accounts where app = 'spinquest' and not internal),
      'unsure', (select count(*) from public.fma_accounts where app = 'unknown' and not internal and created_at >= since),
      'providers', coalesce((select jsonb_agg(jsonb_build_object('provider', prov, 'n', n) order by n desc) from (select prov, count(*) n from newu group by 1) x), '[]'::jsonb),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'n', n) order by day) from (
          select days.day, count(u.id) n from days left join u on u.created_at::date = days.day group by 1) x), '[]'::jsonb)),
    'activation', jsonb_build_object(
      'signed_up', (select count(*) from newu),
      'returned', (select count(*) from newu where last_sign_in_at >= created_at + interval '1 day'),
      'brand', (select count(*) from newu where exists(select 1 from ub where ub.user_id = newu.id)),
      'generated', (select count(*) from newu where exists(select 1 from ub join gen on gen.client_id = ub.client_id where ub.user_id = newu.id)),
      'paying', (select count(*) from newu where exists(select 1 from ub join cc_price c on c.client_id = ub.client_id where ub.user_id = newu.id and not coalesce(c.is_comp,false) and c.list > 0))),
    'recent', coalesce((select jsonb_agg(r order by (r->>'created_at') desc) from (
        select jsonb_build_object('email', a.email, 'created_at', a.created_at, 'last_seen', a.last_sign_in_at, 'provider', a.prov,
          'comped', exists(select 1 from ub join cc_price c on c.client_id = ub.client_id where ub.user_id = a.id and coalesce(c.is_comp,false) and c.list > 0),
          'stage', case
            when exists(select 1 from ub join cc_price c on c.client_id = ub.client_id where ub.user_id = a.id and not coalesce(c.is_comp,false) and c.list > 0) then 'paying'
            when exists(select 1 from ub join gen_all g on g.client_id = ub.client_id where ub.user_id = a.id) then 'made_content'
            when exists(select 1 from ub where ub.user_id = a.id) then 'added_brand'
            else 'signed_up' end) r
        from u a order by a.created_at desc limit 15) q), '[]'::jsonb),
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
      'credits_yours', (select coalesce(sum(credits_consumed),0) from gen_all where created_at >= since and client_id in (select client_id from mine)),
      'active_brands', (select count(distinct client_id) from gen where created_at >= since),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'credits', c) order by day) from (
          select days.day, coalesce(sum(g.credits_consumed),0) c from days left join gen g on g.created_at::date = days.day group by 1) x), '[]'::jsonb)),
    'reach', jsonb_build_object(
      'calls', (select count(*) from aru_all),
      'calls_customers', (select count(*) from aru),
      'failed', (select count(*) from aru_all where ok is false),
      'active_workspaces', (select count(distinct client_id) from aru),
      'tokens_in', (select coalesce(sum(tokens_in),0) from aru_all),
      'tokens_out', (select coalesce(sum(tokens_out),0) from aru_all),
      'web_searches', (select count(*) from aru_all where feature = 'web_search'),
      'est_cost_cents', (select round(coalesce(sum(tokens_in),0) * 0.0001 + coalesce(sum(tokens_out),0) * 0.0005 + count(*) filter (where feature = 'web_search') * 1.0, 1) from aru_all),
      'by_feature', coalesce((select jsonb_agg(jsonb_build_object('feature', feature, 'n', n) order by n desc) from (select feature, count(*) n from aru_all group by 1) x), '[]'::jsonb),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'n', c) order by day) from (
          select days.day, count(a.id) c from days left join aru_all a on a.created_at::date = days.day group by 1) x), '[]'::jsonb),
      'workspaces_total', (select count(*) from public.ar_subscriptions),
      'deals_total', (select count(*) from public.ar_deals)),
    'site', public.site_report(d)
  ) into out;
  return out;
end $function$;
