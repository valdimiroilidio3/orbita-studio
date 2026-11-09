-- ============================================================================
-- 1.79.0 · O TRABALHO ESCRITO À MÃO NO ESCRITÓRIO (9 nov 2026)
--
-- O dono escreveu na barra de tarefas do escritório e o painel respondeu:
--
--   «Este escritório está aberto sem servidor. As tarefas vivem na base de
--    dados do Órbita — arranca-o com npm start…»
--
-- O servidor estava lá. O que não existia era onde guardar o pedido: a tabela
-- `orbita_tasks` (nascida em `orbita_mesa.sql`) guarda `kind`, `entity_id` e
-- `entidade` — não guardava texto livre, nem título.
--
-- Estas duas colunas fecham isso. E são só o conforto: o código funciona sem
-- elas (o pedido vai em `entidade`, com o prefixo `pedido:`, e é lido de lá) —
-- aplicar este ficheiro é o que torna o cartão legível e o pedido pesquisável.
-- Idempotente: correr duas vezes não faz nada.
-- ============================================================================

alter table public.orbita_tasks add column if not exists payload jsonb not null default '{}'::jsonb;
alter table public.orbita_tasks add column if not exists title text not null default '';

comment on column public.orbita_tasks.payload is
  'o que a tarefa leva: o pedido escrito (payload.pedido), o agente e a sala (1.79.0)';
comment on column public.orbita_tasks.title is
  'o título legível da tarefa, para o cartão do escritório não mostrar o kind (1.79.0)';
