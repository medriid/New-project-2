-- Optional audit table for owner actions. Authentication itself is handled by Supabase Auth.
create table if not exists public.panel_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.panel_settings (key, value)
values ('owner_email', 'logeshms.cbe@gmail.com')
on conflict (key) do nothing;

alter table public.panel_settings enable row level security;

create or replace function public.is_panel_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = lower(coalesce((
    select value from public.panel_settings where key = 'owner_email'
  ), ''));
$$;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  action text not null,
  target_server_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_events enable row level security;

drop policy if exists "signed in users can read audit events" on public.audit_events;
drop policy if exists "panel owner can read audit events" on public.audit_events;
drop policy if exists "panel owner can insert audit events" on public.audit_events;
drop policy if exists "panel owner can read settings" on public.panel_settings;

create policy "panel owner can read settings"
  on public.panel_settings
  for select
  to authenticated
  using (public.is_panel_owner());

create policy "panel owner can read audit events"
  on public.audit_events
  for select
  to authenticated
  using (public.is_panel_owner());

create policy "panel owner can insert audit events"
  on public.audit_events
  for insert
  to authenticated
  with check (public.is_panel_owner() and lower(actor_email) = lower(auth.jwt() ->> 'email'));
