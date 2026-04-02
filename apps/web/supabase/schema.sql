create table if not exists public.users (
  id uuid primary key,
  email text not null unique,
  name text,
  avatar_url text,
  default_output_language text not null default 'zh',
  default_duration_minutes int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_default_output_language_check check (default_output_language in ('zh', 'en')),
  constraint users_default_duration_minutes_check check (default_duration_minutes in (3, 5, 8))
);

create table if not exists public.sources (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  source_type text not null check (source_type in ('feishu_doc', 'webpage')),
  source_url text not null,
  domain text,
  title text,
  detected_language text,
  raw_html text,
  raw_text text not null,
  cleaned_text text,
  content_hash text not null,
  extraction_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sources_user_created_idx on public.sources(user_id, created_at desc);
create index if not exists sources_content_hash_idx on public.sources(content_hash);

create table if not exists public.jobs (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  status text not null check (status in ('queued', 'extracting', 'writing', 'synthesizing', 'succeeded', 'failed')),
  output_language text not null check (output_language in ('zh', 'en')),
  target_duration_minutes int not null check (target_duration_minutes in (3, 5, 8)),
  script_style text not null default 'host_explainer',
  voice_id text,
  title text,
  summary text,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_user_created_idx on public.jobs(user_id, created_at desc);
create index if not exists jobs_status_created_idx on public.jobs(status, created_at asc);

create table if not exists public.scripts (
  id uuid primary key,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  output_language text not null,
  outline_json jsonb not null default '{}'::jsonb,
  script_text text not null,
  word_count int not null default 0,
  llm_provider text not null,
  llm_model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.audios (
  id uuid primary key,
  job_id uuid not null unique references public.jobs(id) on delete cascade,
  storage_path text not null,
  public_url text,
  format text not null default 'mp3',
  duration_seconds int not null,
  size_bytes bigint,
  tts_provider text not null,
  tts_voice_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  entry_type text not null check (entry_type in ('grant_monthly_free', 'consume_generation', 'adjustment')),
  minutes_delta numeric(10,2) not null,
  note text,
  period_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists usage_ledger_user_period_idx on public.usage_ledger(user_id, period_key);

alter table public.users enable row level security;
alter table public.sources enable row level security;
alter table public.jobs enable row level security;
alter table public.scripts enable row level security;
alter table public.audios enable row level security;
alter table public.usage_ledger enable row level security;

drop policy if exists "users_select_self" on public.users;
create policy "users_select_self" on public.users
for select using (auth.uid() = id);

drop policy if exists "users_insert_self" on public.users;
create policy "users_insert_self" on public.users
for insert with check (auth.uid() = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users
for update using (auth.uid() = id);

drop policy if exists "sources_owner_access" on public.sources;
create policy "sources_owner_access" on public.sources
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "jobs_owner_access" on public.jobs;
create policy "jobs_owner_access" on public.jobs
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "usage_owner_access" on public.usage_ledger;
create policy "usage_owner_access" on public.usage_ledger
for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "scripts_owner_select" on public.scripts;
create policy "scripts_owner_select" on public.scripts
for select using (
  exists (
    select 1
    from public.jobs
    where public.jobs.id = scripts.job_id
      and public.jobs.user_id = auth.uid()
  )
);

drop policy if exists "scripts_owner_insert" on public.scripts;
create policy "scripts_owner_insert" on public.scripts
for insert with check (
  exists (
    select 1
    from public.jobs
    where public.jobs.id = scripts.job_id
      and public.jobs.user_id = auth.uid()
  )
);

drop policy if exists "audios_owner_select" on public.audios;
create policy "audios_owner_select" on public.audios
for select using (
  exists (
    select 1
    from public.jobs
    where public.jobs.id = audios.job_id
      and public.jobs.user_id = auth.uid()
  )
);

drop policy if exists "audios_owner_insert" on public.audios;
create policy "audios_owner_insert" on public.audios
for insert with check (
  exists (
    select 1
    from public.jobs
    where public.jobs.id = audios.job_id
      and public.jobs.user_id = auth.uid()
  )
);
