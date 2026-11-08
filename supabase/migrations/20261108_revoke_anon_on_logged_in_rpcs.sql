-- Logged-in-only helpers were callable without logging in. Applied live 2026-11-08.
revoke execute on function public.ar_bad_contact_check(text[]) from anon, public;
revoke execute on function public.cc_campaign_set_mentions(uuid, jsonb) from anon, public;
revoke execute on function public.cc_mentions_get(text) from anon, public;
revoke execute on function public.cc_post_set_mentions(text, jsonb) from anon, public;
grant execute on function public.ar_bad_contact_check(text[]) to authenticated;
grant execute on function public.cc_campaign_set_mentions(uuid, jsonb) to authenticated;
grant execute on function public.cc_mentions_get(text) to authenticated;
grant execute on function public.cc_post_set_mentions(text, jsonb) to authenticated;
