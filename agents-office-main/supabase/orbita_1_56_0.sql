-- 1.56.0 · A FATURA (2 nov 2026) — A3
--
-- Até aqui o dinheiro entrava por um campo («entrou X €») e não havia documento
-- nenhum. Uma fatura não é um total: é um papel com número, data, NIF, base,
-- IVA e total — e, quando corre mal, uma nota de crédito que não deixa buracos
-- na numeração.
--
-- A tabela é a fonte da verdade do documento. Os valores ficam em **cêntimos
-- inteiros**: arredonda-se uma vez, no IVA da fatura, e nunca se somam floats.
--
-- A chave única `(serie, numero, tipo)` é o que impede dois números iguais: dois
-- pedidos ao mesmo tempo, um ganha e o outro recebe o conflito e tenta o número
-- seguinte. Uma fatura anulada NÃO se apaga: passa a `estado = 'anulada'` e o
-- número fica gasto; a nota de crédito é uma linha nova, com o mesmo número e
-- `tipo = 'nota_credito'`.
--
-- Aplicar no Supabase (SQL Editor) ou por
--   /api/setup?token=…&so=orbita_1_56_0.sql
-- É idempotente: numa base que já a tenha, não faz nada.

create table if not exists public.orbita_faturas (
  id text primary key,
  serie text not null,                       -- o ano, «2026»
  numero integer not null,
  codigo text not null,                      -- «2026/0001»; na nota de crédito, «2026/0001-NC»
  tipo text not null default 'fatura',       -- fatura | nota_credito
  estado text not null default 'emitida',    -- emitida | anulada
  cliente_nome text not null,
  cliente_nif text,
  cliente_email text,
  cliente_morada text,
  consumidor_final boolean not null default false,
  linhas jsonb not null default '[]'::jsonb, -- [{descricao, quantidade, precoCentimos, totalCentimos}]
  iva_taxa numeric(5, 2) not null default 23,
  motivo_isencao text,                       -- obrigatório quando iva_taxa = 0
  base_centimos integer not null default 0,
  iva_centimos integer not null default 0,
  total_centimos integer not null default 0,
  moeda text not null default 'EUR',
  nota text,
  emitente_nome text,
  emitente_nif text,
  emitente_morada text,
  emitida_em timestamptz not null default now(),
  criado timestamptz not null default now(),
  enviada_em timestamptz,
  enviada_para text,
  fatura_origem text,                        -- na nota de crédito, a fatura anulada
  motivo_anulacao text,
  anulada_em timestamptz
);

-- sem buracos e sem repetições: um número por série e por tipo
create unique index if not exists orbita_faturas_serie_numero_tipo
  on public.orbita_faturas (serie, numero, tipo);
create index if not exists orbita_faturas_emitida on public.orbita_faturas (emitida_em desc);
create index if not exists orbita_faturas_cliente on public.orbita_faturas (cliente_nome);

comment on table public.orbita_faturas is 'faturas e notas de crédito (1.56.0): documento com número, IVA e PDF; os valores estão em cêntimos inteiros';
comment on column public.orbita_faturas.numero is 'sequencial por série (ano) e por tipo; nunca se reutiliza, nem depois de anular';
comment on column public.orbita_faturas.total_centimos is 'base + IVA em cêntimos; negativo na nota de crédito';
comment on column public.orbita_faturas.estado is 'emitida | anulada — anular cria a nota de crédito, não apaga a fatura';

-- Só o servidor toca nesta tabela (chave de serviço). Sem políticas, a chave
-- pública não lê nem escreve: um documento fiscal não é conteúdo de CDN.
alter table public.orbita_faturas enable row level security;
revoke all on public.orbita_faturas from anon, authenticated;
