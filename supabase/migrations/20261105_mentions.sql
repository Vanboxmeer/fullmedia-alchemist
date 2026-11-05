-- Mentions: people/brands a campaign tags, with a different handle per network.
alter table public.cc_campaigns add column if not exists mentions jsonb not null default '[]'::jsonb;
alter table public.content_calendar add column if not exists mention_names jsonb;

create or replace function public.cc_mentions_get(p_brand text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not public.cc_can_brand(p_brand) then raise exception 'no access'; end if;
  return jsonb_build_object(
    'campaigns', coalesce((select jsonb_object_agg(c.id::text, c.mentions) from cc_campaigns c join cc_brands b on b.id=c.brand_id where b.name=p_brand and jsonb_array_length(c.mentions)>0), '{}'::jsonb),
    'posts', coalesce((select jsonb_object_agg(x.sku, x.mention_names) from content_calendar x where x.brand=p_brand and x.mention_names is not null), '{}'::jsonb)
  );
end $$;

create or replace function public.cc_campaign_set_mentions(p_campaign uuid, p_mentions jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_brand text; v_out jsonb := '[]'::jsonb; e jsonb; k text; h jsonb; nm text; v text;
begin
  select b.name into v_brand from cc_campaigns c join cc_brands b on b.id=c.brand_id where c.id=p_campaign;
  if v_brand is null or not public.cc_can_brand(v_brand) then raise exception 'no access'; end if;
  if jsonb_typeof(p_mentions) <> 'array' or jsonb_array_length(p_mentions) > 20 then raise exception 'bad input'; end if;
  for e in select * from jsonb_array_elements(p_mentions) loop
    nm := left(btrim(coalesce(e->>'name','')), 60);
    if nm = '' then continue; end if;
    h := '{}'::jsonb;
    foreach k in array array['instagram','x','tiktok','facebook'] loop
      v := btrim(coalesce(e->'handles'->>k,''));
      v := regexp_replace(v, '^(https?://)?(www\.)?[a-z0-9.-]+\.[a-z]+/@?', '', 'i');
      v := regexp_replace(v, '^@', '');
      v := regexp_replace(v, '[/?#].*$', '');
      if v ~ '^[A-Za-z0-9._]{1,50}$' then h := h || jsonb_build_object(k, v); end if;
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object('name', nm, 'handles', h));
  end loop;
  update cc_campaigns set mentions = v_out where id = p_campaign;
  return v_out;
end $$;

create or replace function public.cc_post_set_mentions(p_sku text, p_names jsonb) returns boolean
language plpgsql security definer set search_path to 'public' as $$
declare v_brand text;
begin
  select brand into v_brand from content_calendar where sku = p_sku;
  if v_brand is null or not public.cc_can_brand(v_brand) then raise exception 'no access'; end if;
  if p_names is not null and jsonb_typeof(p_names) <> 'array' then raise exception 'bad input'; end if;
  update content_calendar set mention_names = p_names where sku = p_sku;
  return true;
end $$;

grant execute on function public.cc_mentions_get(text), public.cc_campaign_set_mentions(uuid, jsonb), public.cc_post_set_mentions(text, jsonb) to authenticated;
