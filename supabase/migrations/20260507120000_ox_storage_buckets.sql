-- Storage buckets referenced by ox-backend (see .env.example and services:
-- avatars, evidences, documents, signatures, project-reports, tool-images).

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('evidences', 'evidences', true),
  ('documents', 'documents', true),
  ('signatures', 'signatures', true),
  ('project-reports', 'project-reports', true),
  ('tool-images', 'tool-images', true)
on conflict (id) do nothing;

-- Client avatar uploads (Flutter): authenticated users only under avatars/{auth.uid()}/...
drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
on storage.objects for select
to public
using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_insert" on storage.objects;
create policy "avatars_owner_insert"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_update" on storage.objects;
create policy "avatars_owner_update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_owner_delete" on storage.objects;
create policy "avatars_owner_delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
