-- ===========================================================================
-- 1.60.0 · A AUTONOMIA POR TIPO DE TRABALHO (2 nov 2026)
--
-- Porque é uma tabela e não um valor no código: subir de nível é uma decisão do
-- dono, e uma decisão sem autor nem data não se pode auditar. Cada linha diz
-- quem decidiu, quando, com que motivo e quantos casos existiam nessa altura.
--
--   1. correr no Supabase → SQL Editor (uma vez; pode correr duas vezes);
--   2. depois, /api/health deixa de a mencionar em `faltam`.
--
-- O nível é sempre um dos três: pedir_sempre · proposto · autonomo. Uma acção
-- sensível (ferramenta destrutiva) continua a exigir aprovação humana mesmo em
-- `autonomo` — essa regra vive no servidor, não nesta tabela.
-- ===========================================================================

create table if not exists public.orbita_autonomia (
  id           text primary key default ('au_' || replace(gen_random_uuid()::text, '-', '')),
  escopo       text not null unique,
  nivel        text not null default 'pedir_sempre'
               check (nivel in ('pedir_sempre', 'proposto', 'autonomo')),
  casos        integer not null default 0,
  taxa         numeric(4, 3),
  motivo       text,
  decidido_por text not null default 'dono',
  decidido_em  timestamptz not null default now(),
  criado       timestamptz not null default now()
);

create index if not exists orbita_autonomia_nivel_idx on public.orbita_autonomia (nivel);

alter table public.orbita_autonomia enable row level security;
revoke all on public.orbita_autonomia from anon, authenticated;

comment on table public.orbita_autonomia is
  'Nível de autonomia por tipo de trabalho, com autor e data. Ver src/motores.js e api/_rotas.mjs (/ops/autonomia).';
