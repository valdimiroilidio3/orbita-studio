-- 1.54.3 · A MÍDIA GERADA (imagem e vídeo) — 2 nov 2026
--
-- Porque uma tabela nova e não o jsonb do briefing: aqui entram bytes, estados
-- que mudam enquanto a página está aberta, contagens de limite por utilizador e
-- uma chave única de idempotência. Um jsonb com 200 gerações concorrentes perde
-- escritas em silêncio; uma tabela com `unique(chave)` não perde nada.
--
-- O que NÃO se copia para aqui: os bytes. O ficheiro vive no Storage Supabase
-- (bucket privado `orbita-media`); a linha guarda o caminho, o tipo, o tamanho e
-- as dimensões.
--
-- Aplicar no Supabase (SQL Editor) ou por
--   /api/setup?token=…&so=orbita_1_54_3.sql
-- É idempotente: numa base que já a tenha, não faz nada.

create table if not exists public.orbita_geracoes (
  id uuid primary key default gen_random_uuid(),
  -- idempotência: o mesmo pedido repetido devolve esta linha em vez de gerar outra
  chave text unique,
  projeto_id text not null,
  lead_id text,
  -- quem pediu (conta). 'mesa' = modo local, sem contas
  conta_id text,
  tipo text not null,
  fornecedor text not null,
  modelo text,
  -- o prompt QUE FOI ENVIADO (não o do briefing: o que o dono confirmou)
  prompt text not null,
  opcoes jsonb not null default '{}'::jsonb,
  estado text not null default 'aguardando',
  -- só se o fornecedor o der de forma fiável; nunca se inventa
  progresso int,
  custo_estimado numeric(12, 4),
  custo_moeda text default 'USD',
  custo_confiavel boolean default true,
  custo_real numeric(12, 4),
  -- «conceito» (mídia de IA) ou «aprovado» (o dono autoriza o uso)
  classificacao text not null default 'conceito',
  -- { caminho, mime, bytes, largura, altura, duracao, via, armazem }
  ficheiro jsonb,
  -- para o vídeo: que imagens entraram no plano
  fontes jsonb,
  -- id do pedido no fornecedor, quando ele devolver um
  externo_id text,
  tentativas int not null default 0,
  anterior uuid,
  erro text,
  criado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint orbita_geracoes_tipo check (tipo in ('imagem', 'video')),
  constraint orbita_geracoes_estado check (estado in ('aguardando', 'em_processamento', 'concluida', 'falhou', 'cancelada')),
  constraint orbita_geracoes_classificacao check (classificacao in ('conceito', 'aprovado'))
);

create index if not exists orbita_geracoes_projeto on public.orbita_geracoes (projeto_id, criado desc);
create index if not exists orbita_geracoes_conta_dia on public.orbita_geracoes (conta_id, criado desc);
create index if not exists orbita_geracoes_estado on public.orbita_geracoes (estado);
create index if not exists orbita_geracoes_lead on public.orbita_geracoes (lead_id);

comment on table public.orbita_geracoes is 'gerações de imagem e vídeo do projeto (1.54.3): prompt enviado, opções, quem, lead, projeto, fornecedor, estado e custo';
comment on column public.orbita_geracoes.chave is 'idempotência: evita gerar (e cobrar) duas vezes o mesmo pedido';
comment on column public.orbita_geracoes.classificacao is 'conceito = mídia de IA, não é registo real da empresa; aprovado = o dono autorizou o uso';
comment on column public.orbita_geracoes.custo_real is 'null quando o fornecedor não devolve um valor definitivo — nesse caso o custo fica estimado';

alter table public.orbita_geracoes enable row level security;
revoke all on public.orbita_geracoes from anon, authenticated;

-- O bucket dos ficheiros: privado (sem URL pública permanente). O acesso passa
-- todo por /api/ops/media/:id/ficheiro, com sessão.
insert into storage.buckets (id, name, public)
values ('orbita-media', 'orbita-media', false)
on conflict (id) do nothing;
