-- "My own content": posts made elsewhere (video, pictures) where the user only wants copy, hashtags and scheduling.
-- No files are stored. external_id is the user's own optional ID; own_note is a few words about what the content is.
alter table public.content_calendar add column if not exists external_id text;
alter table public.content_calendar add column if not exists own_note text;
create index if not exists content_calendar_brand_external_id_idx on public.content_calendar (brand, external_id) where external_id is not null;
