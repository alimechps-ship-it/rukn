-- =====================================================================
-- RUKN — Supabase Storage: public "media" bucket for marketing images.
-- Read: public (images are shown on the website).
-- Write: Super Administrators and Content Managers only.
-- NOTE: No bucket is created for clinical records (STL, radiographs,
-- patient photos). Those must never be collected through this website
-- without a dedicated, access-controlled and encrypted workflow.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "media_read" on storage.objects for select to anon, authenticated
  using (bucket_id = 'media');

create policy "media_insert_content_roles" on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and public.can_manage_content());

create policy "media_update_content_roles" on storage.objects for update to authenticated
  using (bucket_id = 'media' and public.can_manage_content())
  with check (bucket_id = 'media' and public.can_manage_content());

create policy "media_delete_content_roles" on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.can_manage_content());
