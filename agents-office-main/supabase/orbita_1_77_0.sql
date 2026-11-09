-- 1.77.0 · A CONTA QUE NASCE DE UM FORNECEDOR NÃO TEM PALAVRA-PASSE.
--
-- O dono entrou pelo GitHub e a base recusou:
--   null value in column "hash" of relation "orbita_contas" violates not-null constraint
--
-- A 1.54.0 desenhou `hash` como obrigatório porque só existia uma porta: email e
-- palavra-passe. A 1.69.0 acrescentou GitHub e Google — e uma conta que nasce de
-- um fornecedor não tem (nem deve ter) palavra-passe guardada. A regra ficou a
-- contradizer o código, e a entrada falhava depois de o GitHub já ter dito que
-- sim.
--
-- Esta migração é idempotente: numa base onde `hash` já aceita nulos e a regra já
-- existe, não faz nada. E não abre a porta a ninguém — quem entra continua a ser
-- decidido pela lista de donos e pelo fornecedor verificado (ver
-- `api/_entrada.mjs`).
--
-- A regra nova, provada em `aovivo.test.mjs` e `entrada.test.mjs`: uma conta tem
-- de ter POR ONDE entrar — palavra-passe (hash) OU fornecedor
-- (oauth_fornecedor). Uma linha sem nenhum dos dois não serve para entrar em lado
-- nenhum, e a base recusa-a.
--
-- Tudo dentro de um bloco: se a tabela não existir (base a meio), este ficheiro
-- não rebenta — diz o que faltou e segue. O `/api/setup` aplica-o depois da
-- 1.54.0, que é quem a cria.

do $$
declare tem_tabela boolean := to_regclass('public.orbita_contas') is not null;
begin
  if not tem_tabela then
    raise notice 'orbita_1_77_0: orbita_contas ainda não existe — aplicar orbita_1_54_0.sql primeiro';
    return;
  end if;

  -- 1 · a palavra-passe deixa de ser obrigatória
  execute 'alter table public.orbita_contas alter column hash drop not null';

  -- 2 · mas a conta tem de ter por onde entrar
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orbita_contas'::regclass
       and conname = 'orbita_contas_tem_por_onde_entrar'
  ) then
    -- uma linha antiga sem hash e sem fornecedor impediria a regra; não se apaga
    -- nada: se existir, a regra fica para a próxima vez e o aviso di-lo.
    if exists (
      select 1 from public.orbita_contas
       where hash is null and (oauth_fornecedor is null or length(btrim(oauth_fornecedor)) = 0)
    ) then
      raise notice 'orbita_1_77_0: há contas sem palavra-passe e sem fornecedor — a regra de entrada não foi criada';
    else
      execute 'alter table public.orbita_contas add constraint orbita_contas_tem_por_onde_entrar '
           || 'check (hash is not null or (oauth_fornecedor is not null and length(btrim(oauth_fornecedor)) > 0))';
    end if;
  end if;
end $$;

-- prova, para quem abrir o SQL Editor: `hash_aceita_nulo` tem de dizer YES.
-- (Num cliente que ignora o resultado, não faz mal nenhum: é só leitura.)
select
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'orbita_contas' and column_name = 'hash') as hash_aceita_nulo,
  (select count(*) from pg_constraint
    where conrelid = to_regclass('public.orbita_contas')
      and conname = 'orbita_contas_tem_por_onde_entrar') as tem_regra_de_entrada;
