-- Only a NEW account with no sign of either app is "unknown" (shown to the admin so a fresh sign-up is never hidden).
-- Older accounts with no sign of Alchemist use belong to the other apps sharing this login, as do @spinquest addresses.
create or replace view public.fma_accounts as
select u.id, lower(coalesce(u.email, '')) as email, u.created_at, u.last_sign_in_at,
  coalesce(u.raw_app_meta_data->>'provider', 'email') as provider,
  case
    when u.raw_user_meta_data->>'signup_app' = 'alchemist'
      or exists (select 1 from public.cc_terms_acceptance t where t.user_id = u.id)
      or exists (select 1 from public.cc_user_brands b where b.user_id = u.id)
      or exists (select 1 from public.ar_accounts a where a.user_id = u.id) then 'alchemist'
    when u.email ilike '%@spinquest.app' or u.email ilike '%@spinquest.internal'
      or exists (select 1 from public.analytics_events e where e.user_id = u.id) then 'spinquest'
    when u.created_at < now() - interval '14 days' then 'spinquest'
    else 'unknown' end as app,
  (lower(coalesce(u.email, '')) in (select i.email from public.fma_internal_users i)
    or exists (select 1 from auth.identities x where x.user_id = u.id
               and lower(coalesce(x.identity_data->>'email', '')) in (select i.email from public.fma_internal_users i))) as internal
from auth.users u
where coalesce(u.email, '') not like 'zz-pentest%';
revoke all on public.fma_accounts from anon, authenticated;
