create extension if not exists pgcrypto;

create table if not exists public.qauto_flows (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_url text,
  created_at timestamptz not null default now()
);

alter table public.qauto_flows
  add column if not exists start_url text,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.qauto_scenarios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.qauto_scenarios
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.qauto_scenario_flows (
  id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null references public.qauto_scenarios(id) on delete cascade,
  flow_id uuid not null references public.qauto_flows(id) on delete cascade,
  order_index integer,
  created_at timestamptz not null default now()
);

alter table public.qauto_scenario_flows
  add column if not exists scenario_id uuid,
  add column if not exists flow_id uuid,
  add column if not exists order_index integer,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qauto_scenario_flows_scenario_id_fkey'
      and conrelid = 'public.qauto_scenario_flows'::regclass
  ) then
    alter table public.qauto_scenario_flows
      add constraint qauto_scenario_flows_scenario_id_fkey
      foreign key (scenario_id) references public.qauto_scenarios(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qauto_scenario_flows_flow_id_fkey'
      and conrelid = 'public.qauto_scenario_flows'::regclass
  ) then
    alter table public.qauto_scenario_flows
      add constraint qauto_scenario_flows_flow_id_fkey
      foreign key (flow_id) references public.qauto_flows(id) on delete cascade;
  end if;
end $$;

create table if not exists public.qauto_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid references public.qauto_flows(id) on delete cascade,
  kind text not null,
  value text,
  locators jsonb not null default '[]'::jsonb,
  meta jsonb,
  title text,
  expected_result jsonb,
  type_delay_ms integer,
  order_index integer,
  created_at timestamptz not null default now(),
  constraint qauto_steps_type_delay_ms_check check (type_delay_ms is null or type_delay_ms >= 0)
);

alter table public.qauto_steps
  add column if not exists flow_id uuid,
  add column if not exists kind text,
  add column if not exists value text,
  add column if not exists locators jsonb not null default '[]'::jsonb,
  add column if not exists meta jsonb,
  add column if not exists title text,
  add column if not exists type_delay_ms integer,
  add column if not exists order_index integer,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qauto_steps'
      and column_name = 'expected_result'
  ) then
    alter table public.qauto_steps
      add column expected_result jsonb;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'qauto_steps'
      and column_name = 'expected_result'
      and data_type <> 'jsonb'
  ) then
    alter table public.qauto_steps
      rename column expected_result to expected_result_legacy;
    alter table public.qauto_steps
      add column expected_result jsonb;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qauto_steps_flow_id_fkey'
      and conrelid = 'public.qauto_steps'::regclass
  ) then
    alter table public.qauto_steps
      add constraint qauto_steps_flow_id_fkey
      foreign key (flow_id) references public.qauto_flows(id) on delete cascade;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'qauto_steps_type_delay_ms_check'
      and conrelid = 'public.qauto_steps'::regclass
  ) then
    alter table public.qauto_steps
      add constraint qauto_steps_type_delay_ms_check
      check (type_delay_ms is null or type_delay_ms >= 0);
  end if;
end $$;

create index if not exists qauto_scenario_flows_scenario_order_idx
  on public.qauto_scenario_flows (scenario_id, order_index, created_at);

create index if not exists qauto_scenario_flows_flow_idx
  on public.qauto_scenario_flows (flow_id);

create index if not exists qauto_steps_flow_order_idx
  on public.qauto_steps (flow_id, order_index, created_at);

create index if not exists qauto_steps_kind_idx
  on public.qauto_steps (kind);
