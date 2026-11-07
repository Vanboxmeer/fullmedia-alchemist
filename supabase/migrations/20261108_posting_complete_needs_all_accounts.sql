-- "Posting Complete" now means every account the post is meant for has it posted.
-- Before: complete = posted on every account that had *something* entered, so 1 posted + nothing else
-- read as complete. Required accounts = the campaign's accounts that the brand has, else the brand's accounts.
-- Posts older than 7 days keep the old rule (adding an account later never reopens old posts).
create or replace function public.cc_status_from_lifecycle()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  links text[] := array[
    new.tiktok_post_link, new.instagram_post_link, new.x_post_link, new.linkedin_post_link,
    new.facebook_post_link, new.evrylife_post_link, new.pinterest_post_link, new.youtube_post_link, new.reddit_post_link];
  scheds text[] := array[
    new.tiktok_scheduled, new.instagram_scheduled, new.x_scheduled, new.linkedin_scheduled,
    new.facebook_scheduled, new.evrylife_scheduled, new.pinterest_scheduled, new.youtube_scheduled, new.reddit_scheduled];
  posted_ats timestamptz[];
  names text[] := array['tiktok','instagram','x','linkedin','facebook','evrylife','pinterest','youtube','reddit'];
  posted int := 0;
  active int := 0;
  i int;
  has_link boolean;
  has_stamp boolean;
  approval text := lower(btrim(coalesce(new.approval_status, 'Pending')));
  own text[];
  camp text[];
  req text[];
  missing boolean := false;
  n text;
  idx int;
begin
  if lower(btrim(coalesce(new.status, ''))) = 'archived' then
    return new;
  end if;

  if coalesce(btrim(new.reddit_post_link), '') <> '' and new.reddit_posted_at is null then new.reddit_posted_at := now(); end if;
  if coalesce(btrim(new.tiktok_post_link), '')    <> '' and new.tiktok_posted_at    is null then new.tiktok_posted_at    := now(); end if;
  if coalesce(btrim(new.instagram_post_link), '') <> '' and new.instagram_posted_at is null then new.instagram_posted_at := now(); end if;
  if coalesce(btrim(new.x_post_link), '')         <> '' and new.x_posted_at         is null then new.x_posted_at         := now(); end if;
  if coalesce(btrim(new.linkedin_post_link), '')  <> '' and new.linkedin_posted_at  is null then new.linkedin_posted_at  := now(); end if;
  if coalesce(btrim(new.facebook_post_link), '')  <> '' and new.facebook_posted_at  is null then new.facebook_posted_at  := now(); end if;
  if coalesce(btrim(new.evrylife_post_link), '')  <> '' and new.evrylife_posted_at  is null then new.evrylife_posted_at  := now(); end if;
  if coalesce(btrim(new.pinterest_post_link), '') <> '' and new.pinterest_posted_at is null then new.pinterest_posted_at := now(); end if;
  if coalesce(btrim(new.youtube_post_link), '')   <> '' and new.youtube_posted_at   is null then new.youtube_posted_at   := now(); end if;

  posted_ats := array[
    new.tiktok_posted_at, new.instagram_posted_at, new.x_posted_at, new.linkedin_posted_at,
    new.facebook_posted_at, new.evrylife_posted_at, new.pinterest_posted_at, new.youtube_posted_at, new.reddit_posted_at];

  for i in 1..9 loop
    has_link  := coalesce(btrim(links[i]), '') <> '';
    has_stamp := posted_ats[i] is not null;
    if has_link or has_stamp then
      posted := posted + 1;
      active := active + 1;
    elsif coalesce(btrim(scheds[i]), '') <> '' then
      active := active + 1;
    end if;
  end loop;

  -- Every account the post is meant for must be posted (recent posts only).
  if posted > 0 and posted = active and (new.scheduled_date is null or new.scheduled_date >= current_date - 7) then
    select array(select lower(btrim(x)) from unnest(b.default_platforms) x) into own
      from cc_brands b where b.name = new.brand limit 1;
    if own is not null and coalesce(array_length(own, 1), 0) > 0 then
      select array(select lower(btrim(x)) from unnest(c.target_platforms) x) into camp
        from cc_campaigns c where c.id = new.campaign_id limit 1;
      req := array(select o from unnest(own) o where camp is not null and o = any(camp));
      if coalesce(array_length(req, 1), 0) = 0 then req := own; end if;
      foreach n in array req loop
        idx := array_position(names, n);
        if idx is not null and not (coalesce(btrim(links[idx]), '') <> '' or posted_ats[idx] is not null) then
          missing := true;
        end if;
      end loop;
    end if;
  end if;

  if posted > 0 and posted = active and not missing then
    new.status := 'Posting Complete';
  elsif posted > 0 then
    new.status := 'Posting Started';
  elsif approval = 'approved' then
    new.status := 'Ready to Post';
  else
    new.status := 'Draft';
  end if;

  return new;
end
$function$;
