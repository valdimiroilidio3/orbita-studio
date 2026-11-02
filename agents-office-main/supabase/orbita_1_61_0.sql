-- ===========================================================================
-- Órbita Studio · 1.61.0 · EXECUÇÃO TRANSPARENTE (2 nov 2026)
--
-- O que esta migração acrescenta à base que já existe (orbita_ia.sql):
--   · `autorizacoes` — quem autorizou o quê, quando e porquê (histórico, não log);
--   · `cancelamento` — o pedido de paragem com nome, hora e se foi efectivo;
--   · `pendente`     — a acção sensível parada à espera de uma pessoa;
--   · `repeticao_de` + `chave` — repetir abre uma execução nova, ligada à antiga,
--     e a chave impede que um duplo clique crie duas.
--
-- É idempotente: pode correr duas vezes sem estragar nada.
-- Sem esta migração a mesa continua a funcionar; o que não persiste são as
-- autorizações e o pedido de cancelamento (ficam só na resposta da chamada).
-- ===========================================================================

alter table public.orbita_ai_runs
  add column if not exists autorizacoes jsonb not null default '[]'::jsonb,
  add column if not exists cancelamento jsonb,
  add column if not exists pendente jsonb,
  add column if not exists repeticao_de uuid references public.orbita_ai_runs(id) on delete set null,
  add column if not exists chave text;

-- Um pedido de repetição por execução original: dois separadores a clicar ao
-- mesmo tempo não abrem duas execuções.
create unique index if not exists orbita_ai_runs_chave_uidx
  on public.orbita_ai_runs (chave) where chave is not null;

create index if not exists orbita_ai_runs_repeticao_idx
  on public.orbita_ai_runs (repeticao_de) where repeticao_de is not null;

-- O estado `aguarda_aprovacao` já estava previsto no check original; a pausa
-- por acção destrutiva usa-o e não precisa de constraint nova.
alter table public.orbita_ai_runs enable row level security;
revoke all on table public.orbita_ai_runs from anon, authenticated;
grant select, insert, update, delete on table public.orbita_ai_runs to service_role;

comment on column public.orbita_ai_runs.autorizacoes is
  'Histórico de autorizações: [{por, em, o_que, motivo, decisao}]';
comment on column public.orbita_ai_runs.cancelamento is
  'Pedido de paragem: {pedido, por, em, efectivo, porque}';
comment on column public.orbita_ai_runs.pendente is
  'Acção sensível à espera de aprovação: {ordem, agente, ferramenta, argumentos, resumo}';
