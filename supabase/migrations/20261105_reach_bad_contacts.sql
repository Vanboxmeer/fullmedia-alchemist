-- Reach: shared "bad contacts" list. An email (or whole domain) that bounced for ANY user is never offered or sent again, for every user.
-- Service role writes; signed-in users can only ASK "are any of these bad?" (they can't read the list).
create table if not exists public.ar_bad_contacts (
  value text primary key,                       -- lowercase email address or domain
  kind text not null check (kind in ('email','domain')),
  reason text,
  first_client uuid,
  hits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.ar_bad_contacts enable row level security;

create or replace function public.ar_bad_contact_check(vals text[])
returns table(value text, kind text, reason text)
language sql security definer set search_path = public as $$
  select b.value, b.kind, b.reason
  from public.ar_bad_contacts b
  where b.value in (
    select lower(trim(v)) from unnest(vals) v
    union
    select lower(split_part(trim(v), '@', 2)) from unnest(vals) v where position('@' in v) > 0
  );
$$;
revoke all on function public.ar_bad_contact_check(text[]) from public;
grant execute on function public.ar_bad_contact_check(text[]) to authenticated;

-- First known bounce (Nov 5): the domain doesn't exist.
insert into public.ar_bad_contacts(value, kind, reason)
values ('gosociallydigital.ca','domain','Domain not found (bounced)'),
       ('lisajain@gosociallydigital.ca','email','Bounced: domain not found')
on conflict (value) do nothing;

-- Clean every existing list. Order matters: fix the deals first (they find the address through their option), then drop it from the options.
update public.ar_deals d
   set contact_email = null,
       outreach_status = 'Bounced - Email Invalid',
       data = (coalesce(d.data,'{}'::jsonb) - 'sentDate' - 'lastSentDate' - 'sentVia' - 'followUpDue' - 'autoOk' - 'agentClaim')
              || jsonb_build_object('outreachStatus','Bounced - Email Invalid','followUps',0,
                   'agentFlag', jsonb_build_object('kind','bounced','reason','The email bounced (the address or its domain does not exist). It was never delivered, and the address is now blocked for everyone. Find another way to reach them.','at', (extract(epoch from now())*1000)::bigint),
                   'updatedAt', (extract(epoch from now())*1000)::bigint)
 where coalesce(d.data->>'sentVia','') in ('email','')
   and exists (
     select 1 from public.ar_bad_contacts b
     left join public.ar_targets t on t.id = d.target_id
     where b.value in (
       lower(trim(coalesce(d.contact_email, t.contact_email, d.data->>'contactEmail', ''))),
       lower(split_part(trim(coalesce(d.contact_email, t.contact_email, d.data->>'contactEmail', '')),'@',2))));

update public.ar_targets t
   set data = coalesce(t.data,'{}'::jsonb) || jsonb_build_object('badEmail', lower(t.contact_email)), contact_email = null, updated_at = now()
 where t.contact_email is not null
   and (lower(trim(t.contact_email)) in (select value from public.ar_bad_contacts)
        or lower(split_part(trim(t.contact_email),'@',2)) in (select value from public.ar_bad_contacts));
