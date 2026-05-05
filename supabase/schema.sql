-- Optional audit table for owner actions. Authentication itself is handled by Supabase Auth.
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,
  target_server_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_events enable row level security;

create policy "signed in users can read audit events"
  on public.audit_events
  for select
  to authenticated
  using (true);
