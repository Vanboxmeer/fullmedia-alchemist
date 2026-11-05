-- Daily Journal posts (2026-11-03). Run once in the Supabase SQL editor.
-- journal-writer (edge function) writes 1 post per call; two calls a day => up to 2 posts a day.
-- The site serves them at /blog/<slug>/ through the Vercel function api/journal.

create table if not exists public.journal_posts (
  slug text primary key,
  title text not null,
  dek text not null,
  tag text not null default 'Playbook',
  cat text not null default 'playbook' check (cat in ('playbook','reach','features','workshop')),
  body text not null,
  read_label text not null default '5 min read',
  topic_key text,
  published_at date not null default current_date,
  status text not null default 'published' check (status in ('published','draft','hidden')),
  model text,
  created_at timestamptz not null default now()
);
create index if not exists journal_posts_pub_idx on public.journal_posts (status, published_at desc, created_at desc);
alter table public.journal_posts enable row level security;
drop policy if exists journal_public_read on public.journal_posts;
create policy journal_public_read on public.journal_posts for select to anon, authenticated
  using (status = 'published' and published_at <= current_date);
grant select on public.journal_posts to anon, authenticated;

-- Two calls a day (UTC). The function itself refuses a third post on the same day.
select cron.unschedule(jobid) from cron.job where jobname in ('journal-writer-am', 'journal-writer-pm');
select cron.schedule('journal-writer-am', '23 7 * * *', $$select net.http_post(url:='https://tpqvvrdglnsdljdpzwfl.supabase.co/functions/v1/journal-writer', headers:=jsonb_build_object('content-type','application/json','x-cc-key',(select btrim(decrypted_secret) from vault.decrypted_secrets where name='CC_RENDER_KEY' limit 1)), body:='{}'::jsonb, timeout_milliseconds:=150000)$$);
select cron.schedule('journal-writer-pm', '41 16 * * *', $$select net.http_post(url:='https://tpqvvrdglnsdljdpzwfl.supabase.co/functions/v1/journal-writer', headers:=jsonb_build_object('content-type','application/json','x-cc-key',(select btrim(decrypted_secret) from vault.decrypted_secrets where name='CC_RENDER_KEY' limit 1)), body:='{}'::jsonb, timeout_milliseconds:=150000)$$);
