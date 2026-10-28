-- ===========================================================================
-- 1.37.0 · as respostas dos clientes (27 out 2026)
--
-- Porque existe: o código das mensagens (envio pelo Resend e pelo WhatsApp,
-- recepção das respostas, estados de entrega) usa colunas que NÃO estavam no
-- esquema versionado (`orbita_mesa.sql`). Numa base criada só a partir do repo,
-- o envio respondia 400 do PostgREST — «coluna não existe» — e a resposta do
-- cliente não tinha onde ser gravada.
--
-- É idempotente: pode correr-se duas vezes, e não apaga nada. Correr no SQL
-- Editor do Supabase (Database → SQL Editor → colar → Run).
-- ===========================================================================

-- ---------- mensagens: o envio e a recepção ----------
alter table public.orbita_messages add column if not exists subject          text;
alter table public.orbita_messages add column if not exists "to"             text;   -- destino
alter table public.orbita_messages add column if not exists "from"           text;   -- remetente (respostas)
alter table public.orbita_messages add column if not exists provider         text;   -- resend | whatsapp-cloud
alter table public.orbita_messages add column if not exists provider_id      text;   -- id lá fora
alter table public.orbita_messages add column if not exists enviada_at       timestamptz;
alter table public.orbita_messages add column if not exists recebida_at      timestamptz;
alter table public.orbita_messages add column if not exists entregue_at      timestamptz;
alter table public.orbita_messages add column if not exists lido_at          timestamptz;
alter table public.orbita_messages add column if not exists rejeitada_at     timestamptz;
alter table public.orbita_messages add column if not exists erro             text;
alter table public.orbita_messages add column if not exists canal_confirmado text;
alter table public.orbita_messages add column if not exists direction        text not null default 'out';  -- out = mandámos, in = responderam
-- o id do fornecedor para a mensagem de ENTRADA: é o que impede a Meta (que
-- repete o webhook quando não recebe 200) de duplicar a mesma resposta
alter table public.orbita_messages add column if not exists id_externo       text;

-- o estado passou a ter mais valores: ensaio (não sai), aprovada, falhou,
-- bloqueada, revisao, recebida (chegou do cliente)
alter table public.orbita_messages drop constraint if exists orbita_messages_status_check;
alter table public.orbita_messages add constraint orbita_messages_status_check
  check (status in ('rascunho', 'ensaio', 'aprovada', 'rejeitada', 'enviada', 'falhou', 'bloqueada', 'revisao', 'recebida'));

create unique index if not exists orbita_messages_externo_idx on public.orbita_messages (id_externo) where id_externo is not null;
create index if not exists orbita_messages_provider_id_idx on public.orbita_messages (provider_id) where provider_id is not null;
create index if not exists orbita_messages_lead_idx on public.orbita_messages (lead_id, created_at desc);

-- ---------- leads: o que a mesa mostra e a recepção escreve ----------
alter table public.orbita_leads add column if not exists responded_at  timestamptz;
alter table public.orbita_leads add column if not exists rating        numeric;
alter table public.orbita_leads add column if not exists reviews       int;
alter table public.orbita_leads add column if not exists score_reasons text;
alter table public.orbita_leads add column if not exists consent       text;

-- ---------- prova ----------
-- Depois de correr, isto tem de devolver as colunas todas:
--   select column_name from information_schema.columns
--    where table_name = 'orbita_messages' order by column_name;
-- E o webhook pode ser ligado:
--   WhatsApp → Meta for Developers → WhatsApp → Configuration:
--     Callback URL: https://<o-teu-dominio>/api/webhooks/whatsapp
--     Verify token: o mesmo de WHATSAPP_VERIFY_TOKEN
--   Resend → Webhooks → Add endpoint: https://<o-teu-dominio>/api/webhooks/resend
--     (eventos de recepção; o segredo vai para RESEND_WEBHOOK_SECRET)
