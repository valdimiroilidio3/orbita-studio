-- 1.55.0 · DINHEIRO VERDADEIRO (2 nov 2026)
--
-- Até aqui `/ops/saldo` devolvia custo 0 e margem igual à receita: falso por
-- construção. O `/ia/uso` já guardava tokens de cada chamada; faltava o preço e
-- um sítio inteiro (não arredondado a cêntimos) para o guardar.
--
-- Guarda-se **micro-USD** (inteiro): `tokens × preço` onde o preço é USD por
-- milhão de tokens dá exactamente micro-USD. Uma chamada de 900 tokens custa
-- 0,000135 USD; em cêntimos arredondados dava zero, e mil chamadas ficavam
-- «grátis». Os cêntimos de euro são derivados na leitura, com o câmbio usado.
--
-- `custo_micro_usd` nulo NÃO é zero: é «não se sabe o preço». A mesa conta essas
-- chamadas à parte (`custo_desconhecido`) em vez de as somar como gratuitas.
--
-- Aplicar no Supabase (SQL Editor) ou por
--   /api/setup?token=…&so=orbita_1_55_0.sql
-- É idempotente: numa base que já a tenha, não faz nada.

alter table public.orbita_ai_uso
  add column if not exists custo_micro_usd bigint,
  add column if not exists custo_moeda text default 'USD',
  add column if not exists custo_desconhecido boolean default false,
  add column if not exists preco_entrada numeric(12, 4),
  add column if not exists preco_saida numeric(12, 4),
  add column if not exists preco_fonte text;

comment on column public.orbita_ai_uso.custo_micro_usd is 'custo da chamada em micro-USD (tokens × USD por 1M tokens); null = preço desconhecido, nunca zero';
comment on column public.orbita_ai_uso.preco_fonte is 'catalogo | catalogo-gratuito | ambiente (ORBITA_PRECOS_IA) | ausente';

-- (o índice por `criado` já existe desde o orbita_ia.sql; não se duplica)
create index if not exists orbita_ai_uso_fornecedor_criado on public.orbita_ai_uso (fornecedor, criado desc);

-- O custo por tarefa: é o que permite dizer «este lead custou X» e «este projeto
-- custou Y», em vez de um total que não se consegue atribuir a nada.
alter table public.orbita_tasks
  add column if not exists custo_micro_usd bigint;

comment on column public.orbita_tasks.custo_micro_usd is 'custo da execução da tarefa em micro-USD (1.55.0); null = desconhecido, não é zero';

create index if not exists orbita_tasks_entidade on public.orbita_tasks (entity_id);
