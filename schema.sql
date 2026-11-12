-- Run this entire script in Supabase Dashboard > SQL Editor.
-- Authentication is handled by Supabase Auth. Usernames are stored in profiles.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (char_length(username) between 3 and 24),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  content text,
  image_url text,
  created_at timestamptz not null default now(),
  constraint message_has_content check (
    (content is not null and char_length(content) <= 4000) or image_url is not null
  ),
  constraint no_self_message check (sender_id <> receiver_id)
);

create index if not exists messages_pair_created_idx
on public.messages (sender_id, receiver_id, created_at desc);
create index if not exists messages_receiver_created_idx
on public.messages (receiver_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.messages enable row level security;

drop policy if exists "Authenticated users can view profiles" on public.profiles;
create policy "Authenticated users can view profiles"
on public.profiles for select to authenticated using (true);

drop policy if exists "Users can create own profile" on public.profiles;
create policy "Users can create own profile"
on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Chat participants can read messages" on public.messages;
create policy "Chat participants can read messages"
on public.messages for select to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "Users can send messages as themselves" on public.messages;
create policy "Users can send messages as themselves"
on public.messages for insert to authenticated
with check (auth.uid() = sender_id and sender_id <> receiver_id);

-- Create a PUBLIC bucket named chat-images. Image URLs are intentionally public
-- so recipients can view them without expiring signed links. Do not upload sensitive images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

drop policy if exists "Authenticated users can upload own chat images" on storage.objects;
create policy "Authenticated users can upload own chat images"
on storage.objects for insert to authenticated
with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Anyone can view chat images" on storage.objects;
create policy "Anyone can view chat images"
on storage.objects for select to public
using (bucket_id = 'chat-images');
