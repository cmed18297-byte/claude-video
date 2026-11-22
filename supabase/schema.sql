-- Umrah Ops Room: run this once in Supabase → SQL Editor → New query → Run.

-- 1. One table holds every record (groups, rooms, progress, complaints, pilgrims, train boarding).
create table if not exists public.docs (
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);
alter table public.docs replica identity full;

-- 2. Only signed-in staff can read or change it.
alter table public.docs enable row level security;
drop policy if exists "staff read" on public.docs;
drop policy if exists "staff insert" on public.docs;
drop policy if exists "staff update" on public.docs;
drop policy if exists "staff delete" on public.docs;
create policy "staff read" on public.docs for select to authenticated using (true);
create policy "staff insert" on public.docs for insert to authenticated with check (true);
create policy "staff update" on public.docs for update to authenticated using (true) with check (true);
create policy "staff delete" on public.docs for delete to authenticated using (true);

-- 3. Live updates between phones.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;

-- 4. Private storage for pilgrim photos.
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "staff photos read" on storage.objects;
drop policy if exists "staff photos add" on storage.objects;
drop policy if exists "staff photos delete" on storage.objects;
create policy "staff photos read" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "staff photos add" on storage.objects for insert to authenticated with check (bucket_id = 'photos');
create policy "staff photos delete" on storage.objects for delete to authenticated using (bucket_id = 'photos');
