-- Reach automation: keys for a user's OWN agent (Claude Cowork etc.) + audit log. Service role only (RLS on, no policies).
create table if not exists public.ar_agent_keys (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.cc_clients(id) on delete cascade,
  brand_id uuid,
  label text,
  key_hash text not null unique,
  key_prefix text,
  created_by uuid,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.ar_agent_keys enable row level security;

create table if not exists public.ar_agent_log (
  id bigserial primary key,
  client_id uuid not null,
  brand_id uuid,
  deal_id uuid,
  key_id uuid,
  action text,
  outcome text,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.ar_agent_log enable row level security;
create index if not exists ar_agent_log_client_time on public.ar_agent_log (client_id, created_at desc);
create index if not exists ar_agent_log_deal on public.ar_agent_log (deal_id);
