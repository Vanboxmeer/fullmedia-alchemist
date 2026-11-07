-- Tracking tags on page links are off unless the user turns them on.
alter table public.fma_link_settings alter column tag_urls set default false;
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
