/* ===========================================================================
   1.41.0 · O ESQUEMA, APLICADO SEM ADIVINHAR (28 out 2026)

   O `/api/setup` só aplicava `orbita_ia.sql`. Isso deixava a base a meio: as
   tabelas da IA existiam e as da mesa não, e o `health` dizia «falta o esquema»
   sem dizer QUAL. Pior: havia três ficheiros SQL no repositório e nenhum sítio
   que dissesse a ordem — e a ordem importa, porque dois deles criam a MESMA
   tabela (`orbita_leads`) com colunas diferentes.

   A verdade, depois de os ler:

     · `orbita_mesa.sql`      — as tabelas que a aplicação USA (leads, messages,
                                tasks, projects, atividade, receitas);
     · `orbita_ia.sql`        — as da IA (runs, steps, uso, memória, media jobs);
     · `orbita_1_37_0.sql`    — as colunas do envio/respostas em `orbita_messages`;
     · `orbita_schema.sql`    — NÃO se aplica: é o desenho da migração do SQLite
                                (diz isso na primeira linha) e define `orbita_leads`
                                com `company_name`/`lead_status`, incompatível com
                                a mesa (`name`/`status`). Se corresse primeiro, o
                                `create table if not exists` seguinte era ignorado
                                em silêncio e a mesa partia.

   Este módulo é a única lista dessa ordem. Recebe um cliente com `query` (o `pg`
   em produção, um duplo nos testes) e aplica um ficheiro por transacção: um erro
   num ficheiro não deixa os anteriores a meio.
   =========================================================================== */
import fsPadrao from 'node:fs';

/** A ordem em que o esquema se aplica. A ordem É o contrato. */
export const FICHEIROS = ['orbita_mesa.sql', 'orbita_ia.sql', 'orbita_1_37_0.sql'];

/** O que está no repositório e NÃO se aplica — com a razão, para ninguém «corrigir» isto. */
export const NAO_APLICADOS = {
  'orbita_schema.sql': 'desenho da migração do SQLite, nunca executado; cria orbita_leads com colunas incompatíveis (company_name/lead_status) e, se corresse primeiro, a mesa ficava sem as colunas que usa',
};

export const TABELAS_DA_MESA = ['orbita_leads', 'orbita_messages', 'orbita_tasks', 'orbita_projects', 'orbita_atividade', 'orbita_receitas'];

/** Lê um ficheiro do esquema. Existe separado para o teste poder injectar outro `fs`. */
export function lerFicheiro(nome, { fs = fsPadrao, raiz = new URL('../supabase/', import.meta.url) } = {}) {
  return String(fs.readFileSync(new URL(nome, raiz), 'utf8'));
}

/**
 * Aplica o esquema, um ficheiro por transacção.
 * @param {{query:(sql:string)=>Promise<any>}} cliente
 * @param {{ficheiros?:string[], fs?:object, raiz?:URL, so?:string|null, log?:Function}} opcoes
 * @returns {Promise<{ok:boolean, aplicados:Array, saltados:Array, erro:string|null, ficheiro:string|null}>}
 */
export async function aplicarEsquema(cliente, { ficheiros = FICHEIROS, fs = fsPadrao, raiz, so = null, log = () => {} } = {}) {
  const lista = so ? ficheiros.filter((f) => f === so) : ficheiros;
  if (so && !lista.length) {
    return { ok: false, aplicados: [], saltados: [], erro: `«${so}» não é um ficheiro do esquema (${ficheiros.join(', ')})`, ficheiro: so };
  }
  const aplicados = [];
  for (const nome of lista) {
    let sql;
    try {
      sql = lerFicheiro(nome, { fs, raiz });
    } catch (e) {
      return { ok: false, aplicados, saltados: [], erro: `não consegui ler ${nome}: ${e.message}`, ficheiro: nome };
    }
    try {
      await cliente.query('begin');
      await cliente.query(sql);
      await cliente.query('commit');
      aplicados.push({ ficheiro: nome, bytes: sql.length });
      log(`  esquema: ${nome} aplicado (${sql.length} bytes)`);
    } catch (e) {
      /* uma transacção falhada tem de ser fechada, ou o cliente fica preso */
      try { await cliente.query('rollback'); } catch { /* a ligação já pode estar morta */ }
      return {
        ok: false, aplicados, saltados: [],
        erro: `${nome}: ${String(e.message || e).slice(0, 300)}`,
        ficheiro: nome,
      };
    }
  }
  return { ok: true, aplicados, saltados: Object.keys(NAO_APLICADOS), erro: null, ficheiro: null };
}

/** As tabelas que existem mesmo — para não dizer «ok» sem olhar. */
export async function tabelasExistentes(cliente, prefixo = 'orbita_') {
  const r = await cliente.query(
    "select table_name from information_schema.tables where table_schema='public' and table_name like $1 order by 1",
    [`${prefixo}%`],
  );
  return (r?.rows || []).map((x) => x.table_name);
}

/** O que a mesa exige e não está lá. Vazio = a base serve. */
export function tabelasEmFalta(tabelas = []) {
  const tem = new Set(tabelas);
  return TABELAS_DA_MESA.filter((t) => !tem.has(t));
}
