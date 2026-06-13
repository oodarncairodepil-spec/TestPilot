create table if not exists public.qauto_test_runs (
  id uuid primary key,
  script_id uuid,
  script_name text not null,
  status text not null,
  created_at timestamptz not null,
  start_time timestamptz,
  end_time timestamptz,
  duration_ms bigint,
  workspace_dir text not null,
  artifact_dir text not null,
  stdout_path text not null,
  stderr_path text not null,
  final_url text not null default '',
  console_logs jsonb not null default '[]'::jsonb,
  network_failures jsonb not null default '[]'::jsonb,
  metadata jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists qauto_test_runs_created_at_idx on public.qauto_test_runs (created_at desc);
create index if not exists qauto_test_runs_script_id_idx on public.qauto_test_runs (script_id);
create index if not exists qauto_test_runs_status_idx on public.qauto_test_runs (status);

create table if not exists public.qauto_test_run_logs (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.qauto_test_runs(id) on delete cascade,
  log_type text not null,
  stream text,
  message text not null,
  timestamp timestamptz not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists qauto_test_run_logs_run_id_idx on public.qauto_test_run_logs (run_id, timestamp asc);

create table if not exists public.qauto_test_run_artifacts (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.qauto_test_runs(id) on delete cascade,
  browser text not null,
  artifact_kind text not null,
  path text not null,
  file_name text not null,
  extension text,
  source_url text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (run_id, path)
);

create index if not exists qauto_test_run_artifacts_run_id_idx on public.qauto_test_run_artifacts (run_id, browser, artifact_kind);
