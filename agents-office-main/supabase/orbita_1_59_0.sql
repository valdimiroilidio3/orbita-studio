-- =============================================================================
-- Órbita · 1.59.0 · LEADS COMO CRM (2 nov 2026)
--
-- O que esta migração acrescenta, e porquê:
--
--   · a PROVA do site — quando foi verificado, o que respondeu e porquê. Sem
--     data não se pode dizer «verificado»; era o que faltava para o dado valer;
--   · a PROVENIÊNCIA — de onde veio o contacto (endereço da fonte), para se
--     poder conferir em vez de acreditar;
--   · o TRABALHO COMERCIAL — qualificação, próxima ação e a data dela. É isto
--     que separa uma lista de um funil;
--   · o HISTÓRICO — quem mudou o quê, quando. Uma linha por alteração, com o
--     autor, para se saber quem autorizou cada passo.
--
-- Nada aqui apaga ou reescreve dados existentes: só acrescenta colunas (todas
-- anuláveis, porque «não sei» é um valor honesto) e uma tabela nova.
--
-- Aplicar no Supabase (SQL editor) depois de `orbita_1_56_0.sql`.
-- =============================================================================

-- ---------- a prova e a proveniência ----------
alter table public.orbita_leads
  add column if not exists website_estado text
    check (website_estado is null or website_estado in ('ok', 'falhou', 'sem_site')),
  add column if not exists website_verificado_em timestamptz,
  add column if not exists website_motivo text,
  add column if not exists fonte_url text,
  add column if not exists confianca text
    check (confianca is null or confianca in ('alta', 'media', 'baixa'));

-- ---------- o trabalho comercial ----------
alter table public.orbita_leads
  add column if not exists qualificacao int
    check (qualificacao is null or (qualificacao >= 0 and qualificacao <= 100)),
  add column if not exists proxima_acao text,
  add column if not exists proxima_acao_em date;

comment on column public.orbita_leads.website_verificado_em is
  'Quando o site foi realmente pedido (1.59.0). Nulo = nunca verificado: não se afirma que está bom.';
comment on column public.orbita_leads.confianca is
  'Nível de confiança nos dados (alta/media/baixa), calculado com as razões em src/crm.js.';
comment on column public.orbita_leads.qualificacao is
  'Qualificação comercial 0–100. Quando nulo, a interface diz que o número vem da nota do lead.';

create index if not exists orbita_leads_proxima_idx
  on public.orbita_leads (proxima_acao_em) where proxima_acao_em is not null;
create index if not exists orbita_leads_confianca_idx
  on public.orbita_leads (confianca);

-- ---------- o histórico: quem mudou o quê ----------
create table if not exists public.orbita_lead_eventos (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.orbita_leads(id) on delete cascade,
  tipo text not null default 'nota'
    check (tipo in ('criado', 'estado', 'verificacao', 'edicao', 'proxima_acao', 'qualificacao', 'nota', 'projeto', 'mensagem')),
  texto text not null,
  -- quem fez: o email da sessão quando há contas, «dono» no modo de uma pessoa só,
  -- «agente»/«sistema» quando foi o próprio sistema (uma verificação automática)
  autor text not null default 'sistema',
  detalhe jsonb,
  criado timestamptz not null default now()
);

alter table public.orbita_lead_eventos enable row level security;
revoke all on table public.orbita_lead_eventos from anon, authenticated;
grant select, insert, update, delete on table public.orbita_lead_eventos to service_role;

create index if not exists orbita_lead_eventos_lead_idx
  on public.orbita_lead_eventos (lead_id, criado desc);

comment on table public.orbita_lead_eventos is
  'O rasto de cada lead (1.59.0): estado, verificação do site, edições, próxima ação. O `autor` é quem autorizou o passo.';
