-- 1.54.0 · A PORTA.
--
-- Até aqui a Órbita publicada não tinha contas: `/auth/eu` respondia «Dono,
-- owner, todos os poderes» a quem pedisse, e `/auth/entrar` respondia `{ok:true}`
-- sem verificar nada. Quem chegasse ao endereço era dono.
--
-- Estas duas tabelas são a fechadura. Aplicar no Supabase (SQL Editor) ou por
-- `/api/setup?token=…` (já está na lista de ficheiros do esquema).
--
-- O que NUNCA fica aqui: a palavra-passe em claro, ou o token de sessão em claro.
-- `hash` é `scrypt$N$r$p$sal$hash`; `token_hash` é o sha256 do token do cookie.

create table if not exists public.orbita_contas (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  nome text not null default '',
  papel text not null default 'leitor'
    check (papel in ('dono', 'gestor', 'operador', 'leitor')),
  hash text not null,
  activo boolean not null default true,
  criado timestamptz not null default now(),
  ultimo_acesso timestamptz,
  -- recuperação: um token de uso único, guardado em hash, que vale 30 minutos
  recuperar_hash text,
  recuperar_expira timestamptz
);
alter table public.orbita_contas enable row level security;
revoke all on table public.orbita_contas from anon, authenticated;
grant select, insert, update, delete on table public.orbita_contas to service_role;
create index if not exists orbita_contas_email_idx on public.orbita_contas (email);

create table if not exists public.orbita_sessoes (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.orbita_contas (id) on delete cascade,
  token_hash text not null unique,
  criado timestamptz not null default now(),
  expira timestamptz not null,
  revogada timestamptz,
  ip text,
  agente text
);
alter table public.orbita_sessoes enable row level security;
revoke all on table public.orbita_sessoes from anon, authenticated;
grant select, insert, update, delete on table public.orbita_sessoes to service_role;
create index if not exists orbita_sessoes_token_idx on public.orbita_sessoes (token_hash);
create index if not exists orbita_sessoes_conta_idx on public.orbita_sessoes (conta_id, criado desc);

-- prova de que correu: tem de devolver 2
select count(*) as tabelas_da_porta
  from information_schema.tables
 where table_schema = 'public' and table_name in ('orbita_contas', 'orbita_sessoes');
