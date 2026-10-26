-- ORBITA — esquema para um Postgres/Supabase futuro. NÃO FOI EXECUTADO E NÃO ESTÁ ACTIVO.
--
-- A base de dados em uso é SQLite, versionada em src/ops/db.mjs (SCHEMA_VERSION 5); este ficheiro
-- é o desenho da migração, não uma prova de que ela correu. Só depois de aplicar isto num projecto
-- real, com leitura e escrita testadas, é legítimo dizer «Supabase activo».
--
-- Regras: nada de políticas para anon/authenticated — o Órbita acede só do servidor, com a chave
-- service_role. Essa chave nunca vai para o browser.
create table if not exists public.orbita_leads (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  company_name text not null,
  website text,
  category text,
  address text,
  city text,
  phone text,
  public_email text,
  osm_type text,
  osm_id text,
  source text not null default 'manual',
  source_url text,
  digital_presence text not null default 'unknown',
  lead_status text not null default 'new'
    check (lead_status in ('new','qualified','contacted','meeting','proposal','won','lost','suppressed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbita_leads enable row level security;
revoke all on table public.orbita_leads from anon, authenticated;
grant select, insert, update, delete on table public.orbita_leads to service_role;

create index if not exists orbita_leads_status_created_idx on public.orbita_leads (lead_status, created_at desc);
create index if not exists orbita_leads_city_idx on public.orbita_leads (city);

-- ---------- projetos, auditorias e entregas (espelha o esquema v5 do SQLite) ----------

create table if not exists public.orbita_projects (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.orbita_leads (id) on delete restrict,
  slug text not null unique,
  name text not null,
  kind text not null default 'landing' check (kind in ('landing','institucional','loja','dashboard')),
  stack text not null default 'html' check (stack in ('html')),
  status text not null default 'rascunho'
    check (status in ('rascunho','gerado','qa_falhou','qa_passou','aprovado','entregue')),
  brief text,
  goals jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,
  features jsonb not null default '[]'::jsonb,
  acceptance jsonb not null default '[]'::jsonb,
  dir text,
  preview_url text,
  production_url text,
  qa_run_id uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- um negócio, um projeto
create unique index if not exists orbita_projects_lead_uidx on public.orbita_projects (lead_id);

alter table public.orbita_projects enable row level security;
revoke all on table public.orbita_projects from anon, authenticated;
grant select, insert, update, delete on table public.orbita_projects to service_role;

create table if not exists public.orbita_qa_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.orbita_projects (id) on delete cascade,
  at timestamptz not null default now(),
  total integer not null default 0,
  critical integer not null default 0,
  important integer not null default 0,
  minor integer not null default 0,
  passed boolean not null default false,
  manifest jsonb not null default '{}'::jsonb,
  report jsonb not null default '[]'::jsonb
);

alter table public.orbita_qa_runs enable row level security;
revoke all on table public.orbita_qa_runs from anon, authenticated;
grant select, insert on table public.orbita_qa_runs to service_role;

create index if not exists orbita_qa_runs_project_idx on public.orbita_qa_runs (project_id, at desc);

create table if not exists public.orbita_deliveries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.orbita_projects (id) on delete cascade,
  at timestamptz not null default now(),
  target text not null check (target in ('preview','zip','github','vercel')),
  status text not null check (status in ('pedido','a_correr','concluido','falhou')),
  url text,
  detail text
);

alter table public.orbita_deliveries enable row level security;
revoke all on table public.orbita_deliveries from anon, authenticated;
grant select, insert, update on table public.orbita_deliveries to service_role;

create index if not exists orbita_deliveries_project_idx on public.orbita_deliveries (project_id, at desc);

-- ---------- contas e sessões (espelha o esquema v7 do SQLite) ----------

create table if not exists public.orbita_users (
  id text primary key,
  email citext not null unique,
  name text not null default '',
  role text not null default 'leitor' check (role in ('dono','gestor','operador','leitor')),
  password_hash text not null,
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.orbita_users enable row level security;
revoke all on table public.orbita_users from anon, authenticated;
-- Ninguém lê a tabela de contas pelo browser, nem com a chave anon: só o servidor, com service_role.
grant select, insert, update, delete on table public.orbita_users to service_role;

create table if not exists public.orbita_sessions (
  id text primary key,
  user_id text not null references public.orbita_users (id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  revoked_by text not null default '',
  agent text not null default ''
);
create index if not exists orbita_sessions_user_idx on public.orbita_sessions (user_id, created_at desc);

alter table public.orbita_sessions enable row level security;
revoke all on table public.orbita_sessions from anon, authenticated;
grant select, insert, update on table public.orbita_sessions to service_role;

create table if not exists public.orbita_auth_attempts (
  id bigserial primary key,
  at timestamptz not null default now(),
  email_hash text not null,
  outcome text not null,
  reason text not null default ''
);
create index if not exists orbita_auth_attempts_idx on public.orbita_auth_attempts (email_hash, at desc);

alter table public.orbita_auth_attempts enable row level security;
revoke all on table public.orbita_auth_attempts from anon, authenticated;
grant select, insert on table public.orbita_auth_attempts to service_role;

-- ---------- tarefas dos departamentos (espelha o esquema v6 do SQLite) ----------

create table if not exists public.orbita_tasks (
  id text primary key,
  kind text not null,
  dept text not null check (dept in ('command','prospect','sales','design','engineering','media')),
  title text not null default '',
  entity text not null default '',
  entity_id text not null default '',
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued'
    check (state in ('queued','running','succeeded','failed','awaiting_approval','cancelled')),
  result jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  timeout_ms integer not null default 300000,
  needs_approval boolean not null default false,
  approved_by text not null default '',
  approved_at timestamptz,
  dedupe text not null default '',
  parent_id text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- UMA tarefa aberta por chave e departamento: o índice parcial impede execuções duplicadas
create unique index if not exists orbita_tasks_open_uidx on public.orbita_tasks (dedupe)
  where state in ('queued','running','awaiting_approval');
create index if not exists orbita_tasks_dept_idx on public.orbita_tasks (dept, state);
create index if not exists orbita_tasks_entity_idx on public.orbita_tasks (entity_id, created_at desc);

alter table public.orbita_tasks enable row level security;
revoke all on table public.orbita_tasks from anon, authenticated;
grant select, insert, update, delete on table public.orbita_tasks to service_role;

-- Sem políticas, de propósito: o servidor usa a chave service_role e protege /api/ops com
-- ORBITA_ADMIN_TOKEN. Ver OPS.md → «A guarda da porta».
