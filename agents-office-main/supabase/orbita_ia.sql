-- ===========================================================================
-- ORBITA — a memória da IA (1.18.0 · 30 out 2026)
--
-- O que o Control Center e o orquestrador precisam de guardar: execuções,
-- passos, uso (latência/tokens/erros) e configuração (fornecedores desligados,
-- modelo preferido por agente, resultado dos testes reais).
--
-- Mesmas regras do resto do Órbita:
--   · RLS ligado e NENHUMA política para `anon`/`authenticated` — o browser não
--     fala com a base, fala com `/api`;
--   · só o `service_role` (a chave da Vercel) toca nestes dados;
--   · nenhuma chave de API é guardada aqui. As chaves vivem no ambiente da
--     Vercel; aqui só entra o resultado dos testes e as preferências.
-- É idempotente: pode correr duas vezes.
-- ===========================================================================

create table if not exists public.orbita_ai_config (
  chave text primary key,
  valor jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);
alter table public.orbita_ai_config enable row level security;
revoke all on table public.orbita_ai_config from anon, authenticated;
grant select, insert, update, delete on table public.orbita_ai_config to service_role;

create table if not exists public.orbita_ai_runs (
  id uuid primary key default gen_random_uuid(),
  objetivo text not null,
  estado text not null default 'novo'
    check (estado in ('novo', 'a_planear', 'a_executar', 'aguarda_aprovacao', 'concluido', 'parcial', 'falhou', 'cancelado')),
  plano jsonb,
  agente text,
  modelo text,
  fornecedor text,
  resultado text,
  artefactos jsonb,
  revisao jsonb,
  erro text,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  custo_centimos int not null default 0,
  criado timestamptz not null default now(),
  fim timestamptz
);
alter table public.orbita_ai_runs enable row level security;
revoke all on table public.orbita_ai_runs from anon, authenticated;
grant select, insert, update, delete on table public.orbita_ai_runs to service_role;
create index if not exists orbita_ai_runs_criado_idx on public.orbita_ai_runs (criado desc);

create table if not exists public.orbita_ai_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.orbita_ai_runs(id) on delete cascade,
  ordem int not null default 1,
  agente text,
  titulo text,
  estado text not null default 'a_correr'
    check (estado in ('a_correr', 'concluido', 'vazio', 'falhou', 'aguarda_aprovacao', 'cancelado')),
  modelo text,
  fornecedor text,
  entrada text,
  saida text,
  ferramentas jsonb,
  duracao_ms int,
  erro text,
  criado timestamptz not null default now()
);
alter table public.orbita_ai_steps enable row level security;
revoke all on table public.orbita_ai_steps from anon, authenticated;
grant select, insert, update, delete on table public.orbita_ai_steps to service_role;
create index if not exists orbita_ai_steps_run_idx on public.orbita_ai_steps (run_id, ordem);

create table if not exists public.orbita_ai_uso (
  id uuid primary key default gen_random_uuid(),
  fornecedor text,
  modelo text,
  agente text,
  tipo text,
  ok boolean not null default false,
  ms int not null default 0,
  tokens_in int not null default 0,
  tokens_out int not null default 0,
  erro text,
  criado timestamptz not null default now()
);
alter table public.orbita_ai_uso enable row level security;
revoke all on table public.orbita_ai_uso from anon, authenticated;
grant select, insert, update, delete on table public.orbita_ai_uso to service_role;
create index if not exists orbita_ai_uso_criado_idx on public.orbita_ai_uso (criado desc);
create index if not exists orbita_ai_uso_fornec_idx on public.orbita_ai_uso (fornecedor, ok);

-- a prova de que correu: tem de devolver 4
select count(*) as tabelas_ia
from information_schema.tables
where table_schema = 'public' and table_name like 'orbita_ai_%';
