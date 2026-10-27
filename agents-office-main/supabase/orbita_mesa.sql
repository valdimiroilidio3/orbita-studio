-- ===========================================================================
-- ORBITA — o esquema da MESA (30 out 2026)
--
-- Ao contrário de `orbita_schema.sql` (que é o desenho da migração do SQLite e
-- nunca foi executado), este ficheiro é o que a mesa publicada usa: as tabelas
-- que as funções de `/api` leem e escrevem na Vercel.
--
-- Como aplicar (uma vez, no painel do Supabase):
--   SQL Editor → New query → colar tudo → Run.
-- É idempotente: pode correr duas vezes sem estragar nada.
--
-- Regras, iguais às do resto do Órbita:
--   · RLS ligado em todas as tabelas e NENHUMA política para `anon` ou
--     `authenticated` — o browser não fala com a base, fala com `/api`;
--   · só o `service_role` (a chave secreta, que vive na Vercel) toca nos dados;
--   · nada de dados de demonstração: as tabelas nascem vazias.
-- ===========================================================================

-- ---------- leads ----------
create table if not exists public.orbita_leads (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,          -- nome+cidade sem acentos: impede duplicados
  name text not null,
  category text,
  city text,
  phone text,
  email text,
  website text,
  source text not null default 'manual',
  status text not null default 'novo'
    check (status in ('novo', 'contactado', 'respondeu', 'ganho', 'perdido')),
  score int,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orbita_leads enable row level security;
revoke all on table public.orbita_leads from anon, authenticated;
grant select, insert, update, delete on table public.orbita_leads to service_role;
create index if not exists orbita_leads_status_idx on public.orbita_leads (status, created_at desc);
create index if not exists orbita_leads_city_idx on public.orbita_leads (city);

-- ---------- projetos ----------
create table if not exists public.orbita_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text,
  niche text,
  city text,
  kind text not null default 'landing',
  status text not null default 'rascunho'
    check (status in ('rascunho', 'em_qa', 'aprovado', 'entregue')),
  lead_id uuid references public.orbita_leads (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.orbita_projects enable row level security;
revoke all on table public.orbita_projects from anon, authenticated;
grant select, insert, update, delete on table public.orbita_projects to service_role;
create index if not exists orbita_projects_status_idx on public.orbita_projects (status, updated_at desc);

-- ---------- tarefas (o que os agentes haviam de fazer) ----------
create table if not exists public.orbita_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  entity_id text,
  entidade text,
  state text not null default 'failed',
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.orbita_tasks enable row level security;
revoke all on table public.orbita_tasks from anon, authenticated;
grant select, insert, update, delete on table public.orbita_tasks to service_role;
create index if not exists orbita_tasks_created_idx on public.orbita_tasks (created_at desc);

-- ---------- mensagens (o que espera o teu OK) ----------
create table if not exists public.orbita_messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.orbita_leads (id) on delete cascade,
  channel text not null default 'whatsapp',
  body text not null,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'aprovada', 'rejeitada', 'enviada')),
  created_at timestamptz not null default now(),
  aprovada_at timestamptz
);
alter table public.orbita_messages enable row level security;
revoke all on table public.orbita_messages from anon, authenticated;
grant select, insert, update, delete on table public.orbita_messages to service_role;
create index if not exists orbita_messages_status_idx on public.orbita_messages (status, created_at desc);

-- ---------- receitas (o dinheiro que entrou, escrito por ti) ----------
create table if not exists public.orbita_receitas (
  id uuid primary key default gen_random_uuid(),
  amount_cents int not null check (amount_cents > 0),
  campaign text,
  at timestamptz not null default now()
);
alter table public.orbita_receitas enable row level security;
revoke all on table public.orbita_receitas from anon, authenticated;
grant select, insert, update, delete on table public.orbita_receitas to service_role;
create index if not exists orbita_receitas_at_idx on public.orbita_receitas (at desc);

-- ---------- atividade (o rasto do que foi feito) ----------
create table if not exists public.orbita_atividade (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  texto text not null,
  at timestamptz not null default now()
);
alter table public.orbita_atividade enable row level security;
revoke all on table public.orbita_atividade from anon, authenticated;
grant select, insert, update, delete on table public.orbita_atividade to service_role;
create index if not exists orbita_atividade_at_idx on public.orbita_atividade (at desc);

-- ---------- a prova de que correu ----------
-- Depois de aplicar, isto tem de devolver 6. É o que `/api/health` vai ler.
select count(*) as tabelas_da_mesa
from information_schema.tables
where table_schema = 'public'
  and table_name in ('orbita_leads', 'orbita_projects', 'orbita_tasks',
                     'orbita_messages', 'orbita_receitas', 'orbita_atividade');
