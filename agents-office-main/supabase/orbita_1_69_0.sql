-- ===========================================================================
-- 1.69.0 · a entrada (6 nov 2026)
--
-- Duas coisas novas em `orbita_contas`, e nenhuma delas guarda um segredo em
-- claro:
--
--   · o CÓDIGO de entrada (6 dígitos, 10 minutos, uma vez). Na tabela fica só o
--     sha256 — quem ler a base não consegue usar o código de ninguém;
--   · quem entrou pelo GitHub ou pelo Google, para o mesmo email não virar duas
--     contas e para se saber por onde a pessoa passou.
--
-- Idempotente: pode correr duas vezes sem estragar nada.
-- ===========================================================================

alter table orbita_contas add column if not exists codigo_hash text;
alter table orbita_contas add column if not exists codigo_expira timestamptz;
alter table orbita_contas add column if not exists codigo_tentativas integer not null default 0;
alter table orbita_contas add column if not exists oauth_fornecedor text;
alter table orbita_contas add column if not exists oauth_id text;

comment on column orbita_contas.codigo_hash is 'sha256 do código de entrada (nunca o código) · 1.69.0';
comment on column orbita_contas.codigo_expira is 'quando o código deixa de servir · 1.69.0';
comment on column orbita_contas.codigo_tentativas is 'tentativas gastas no código actual (limite 5) · 1.69.0';
comment on column orbita_contas.oauth_fornecedor is 'github | google — por onde a conta entrou · 1.69.0';
comment on column orbita_contas.oauth_id is 'o id da pessoa no fornecedor (não é segredo) · 1.69.0';
