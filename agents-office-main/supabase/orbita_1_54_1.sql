-- 1.54.1 · A CONTA NASCE SOZINHA (e confirma-se)
--
-- A 1.54.0 fechou a porta: contas, sessões, papéis. Faltava o outro lado do
-- critério 2 — alguém que nunca falou contigo consegue criar a sua conta e
-- entrar, e o email prova que a caixa existe.
--
-- Três colunas. `confirmado_em` vazio = conta criada pelo próprio, à espera do
-- link; um dono vê isso em Contas e pode confirmar à mão (é o caminho quando a
-- instalação não tem RESEND_API_KEY — dito na cara, não escondido).
--
-- Aplicar no Supabase (SQL Editor) ou por /api/setup?token=…&so=orbita_1_54_1.sql

alter table public.orbita_contas add column if not exists confirmado_em timestamptz;
alter table public.orbita_contas add column if not exists confirmar_hash text;
alter table public.orbita_contas add column if not exists confirmar_expira timestamptz;

comment on column public.orbita_contas.confirmado_em is 'quando o email da conta foi provado (1.54.1); null = por confirmar';
comment on column public.orbita_contas.confirmar_hash is 'sha256 do token do link de confirmação; nunca o token em claro (1.54.1)';
comment on column public.orbita_contas.confirmar_expira is 'o link de confirmação vale 24 horas (1.54.1)';

-- contas que já existiam antes desta migração: quem entrou alguma vez ou foi
-- criado por um dono já provou o email. Sem isto, todos os donos antigos
-- ficavam trancados fora da própria casa.
update public.orbita_contas
   set confirmado_em = coalesce(criado, now())
 where confirmado_em is null
   and (ultimo_acesso is not null or papel = 'dono');

create index if not exists orbita_contas_confirmar_idx on public.orbita_contas (confirmar_hash);

-- prova de que correu: tem de devolver 3
select count(*) as colunas_da_confirmacao
  from information_schema.columns
 where table_schema = 'public' and table_name = 'orbita_contas'
   and column_name in ('confirmado_em', 'confirmar_hash', 'confirmar_expira');
