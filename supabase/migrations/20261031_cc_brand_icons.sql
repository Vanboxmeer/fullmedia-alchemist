create or replace function public.cc_brand_icons()
returns table(brand text, icon_url text)
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_admin boolean := lower(coalesce(auth.jwt()->>'email','')) in ('brad@unitedpress.media');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return query
  select b.name,
    coalesce(
      nullif((select a->>'url' from jsonb_array_elements(case when jsonb_typeof(b.design_system->'assets') = 'array' then b.design_system->'assets' else '[]'::jsonb end) a where a->>'kind' = 'icon' and coalesce(a->>'url','') <> '' order by a->>'added_at' limit 1), ''),
      nullif(b.design_system->>'logo_url', ''),
      nullif(b.logo_url, '')
    )
  from cc_brands b
  where v_admin or exists (select 1 from cc_user_brands ub where ub.user_id = auth.uid() and ub.brand = b.name);
end $$;
revoke all on function public.cc_brand_icons() from public, anon;
grant execute on function public.cc_brand_icons() to authenticated;
