-- Problem reports: a reply the reporter can see, and a "Claude is handling this" state.
alter table public.cc_support_tickets
  add column if not exists reply text,
  add column if not exists replied_at timestamptz,
  add column if not exists claude_state text not null default '',
  add column if not exists claude_note text,
  add column if not exists claude_at timestamptz;

-- A real thread on each report (reporter, team, Claude) and a log of admin account actions.
create table if not exists public.cc_support_messages (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.cc_support_tickets(id) on delete cascade,
  role text not null check (role in ('user','team','claude')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists cc_support_messages_ticket_idx on public.cc_support_messages (ticket_id, created_at);
alter table public.cc_support_messages enable row level security;

create table if not exists public.admin_actions (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  admin_email text not null,
  action text not null,
  client_id uuid,
  detail jsonb
);
alter table public.admin_actions enable row level security;
