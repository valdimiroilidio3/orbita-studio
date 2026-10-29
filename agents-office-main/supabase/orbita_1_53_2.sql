-- 1.53.2 · a coluna onde fica o resultado de uma tarefa.
--
-- Até aqui a tabela `orbita_tasks` (a da mesa) só tinha `state` e `error`: uma
-- tarefa podia correr, mas não havia onde escrever o que ela produziu. O
-- resultado acabava na Atividade, fora do cartão.
--
-- Aplicar no Supabase (SQL Editor) — é idempotente, pode correr duas vezes:
--   alter table ... add column if not exists ...
--
-- Até isto estar aplicado, o servidor não perde nada: guarda o texto na
-- Atividade e di-lo na própria tarefa (ver `api/_tarefas.mjs`).

alter table public.orbita_tasks add column if not exists resultado text;
alter table public.orbita_tasks add column if not exists modelo text;

comment on column public.orbita_tasks.resultado is 'o texto que o modelo devolveu para esta tarefa (1.53.2)';
comment on column public.orbita_tasks.modelo is 'fornecedor/modelo que respondeu, p.ex. groq/llama-3.3-70b-versatile (1.53.2)';

-- prova de que correu: tem de devolver 2
select count(*) as colunas_novas
  from information_schema.columns
 where table_schema = 'public' and table_name = 'orbita_tasks'
   and column_name in ('resultado', 'modelo');
