/* ===========================================================================
   1.23.0 · uma cópia de segurança que se pode testar.

   O pedido do dono diz «backups testáveis». Uma cópia que nunca foi aberta não
   é uma cópia — é um ficheiro com fé. Aqui há duas coisas:

     · `exportar(repo)` lê as tabelas e devolve uma cópia com uma **marca**
       (sha256 do conteúdo). A marca é o que permite provar, mais tarde, que a
       cópia não foi alterada.
     · `testar(repo)` exporta, volta a ler o que exportou (serializar → voltar a
       ler), confere a marca e **restaura de facto** tudo numa base em memória,
       contando linha a linha. Só se tudo bater é que diz «ok».

   Limite declarado: prova que a cópia está inteira e que volta a entrar numa
   base com o mesmo esquema. Não prova que o Postgres de produção aceita o
   restauro — isso é um ensaio à parte, numa base de teste, e não se finge aqui.
   =========================================================================== */
import { createHash } from 'node:crypto';
import { createMemRepo } from './_repo.mjs';

export const FORMATO = 'orbita-backup/1';

/* as tabelas que interessam, e como se lê cada uma */
const FONTES = {
  leads: (r) => r.leads.list(1000),
  projetos: (r) => r.projetos.list(),
  tarefas: (r) => r.tarefas.list(300),
  mensagens: (r) => r.mensagens.list(300),
  receitas: (r) => r.receitas.desde('1970-01-01T00:00:00.000Z'),
  atividade: (r) => r.atividade.list(500),
  runs: (r) => r.ia.runs.listar(100),
  uso: (r) => r.ia.uso.recentes(500),
  config: async (r) => [await r.ia.config.ler()],
};

/** A marca da cópia: sha256 das tabelas, em JSON estável. */
export function marca(copia) {
  const alvo = JSON.stringify({ formato: copia.formato || FORMATO, tabelas: copia.tabelas });
  return createHash('sha256').update(alvo).digest('hex').slice(0, 32);
}

export async function exportar(repo, { agora = new Date() } = {}) {
  const tabelas = {};
  const falhas = [];
  for (const [nome, ler] of Object.entries(FONTES)) {
    try {
      const v = await ler(repo);
      tabelas[nome] = Array.isArray(v) ? v : [];
    } catch (e) {
      tabelas[nome] = [];
      falhas.push(`${nome}: ${String(e.message || e).slice(0, 120)}`);
    }
  }
  const copia = { formato: FORMATO, quando: agora.toISOString(), tabelas };
  copia.contagens = Object.fromEntries(Object.entries(tabelas).map(([k, v]) => [k, v.length]));
  copia.total = Object.values(copia.contagens).reduce((a, b) => a + b, 0);
  copia.marca = marca(copia);
  copia.falhas = falhas;
  return copia;
}

/** O ensaio de restauro: a cópia volta a entrar numa base vazia, linha a linha. */
async function restaurar(copia) {
  const destino = createMemRepo();
  const posto = { leads: 0, projetos: 0, tarefas: 0, mensagens: 0, receitas: 0, atividade: 0 };
  const problemas = [];

  try {
    const leads = copia.tabelas.leads || [];
    if (leads.length) { await destino.leads.inserir(leads.map(({ id, created_at, ...resto }) => resto)); posto.leads = leads.length; }
  } catch (e) { problemas.push(`leads: ${String(e.message || e).slice(0, 120)}`); }
  for (const chave of ['projetos', 'tarefas', 'mensagens']) {
    try {
      const linhas = copia.tabelas[chave] || [];
      for (const l of linhas) {
        const { id, created_at, ...resto } = l;
        await destino[chave].insert(resto);
      }
      posto[chave] = linhas.length;
    } catch (e) { problemas.push(`${chave}: ${String(e.message || e).slice(0, 120)}`); }
  }
  try {
    const linhas = copia.tabelas.receitas || [];
    for (const l of linhas) await destino.receitas.insert({ amount_cents: l.amount_cents, campaign: l.campaign, at: l.at });
    posto.receitas = linhas.length;
  } catch (e) { problemas.push(`receitas: ${String(e.message || e).slice(0, 120)}`); }
  try {
    const linhas = copia.tabelas.atividade || [];
    for (const l of linhas) await destino.atividade.add(l.kind || l.tipo || 'evento', l.mensagem || l.texto || '');
    posto.atividade = linhas.length;
  } catch (e) { problemas.push(`atividade: ${String(e.message || e).slice(0, 120)}`); }

  return { posto, problemas };
}

/**
 * O teste completo: exportar → serializar → voltar a ler → conferir a marca →
 * restaurar numa base em memória → comparar as contagens.
 */
export async function testar(repo, { agora = new Date() } = {}) {
  const t0 = Date.now();
  const problemas = [];
  const copia = await exportar(repo, { agora });

  /* 1. a cópia sobrevive a ir e voltar do JSON (é assim que ela viaja) */
  let relida;
  try {
    relida = JSON.parse(JSON.stringify(copia));
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, formato: FORMATO, marca: copia.marca, problemas: [`a cópia não passa por JSON: ${String(e.message || e)}`] };
  }

  /* 2. a marca confere */
  const marcaRelida = marca(relida);
  if (marcaRelida !== copia.marca) problemas.push(`a marca mudou ao reler (${copia.marca} → ${marcaRelida})`);

  /* 3. restaura e conta */
  const { posto, problemas: falhasRestauro } = await restaurar(relida);
  problemas.push(...falhasRestauro);
  for (const [nome, n] of Object.entries(posto)) {
    const esperado = (relida.tabelas[nome] || []).length;
    if (n !== esperado) problemas.push(`${nome}: ${n} restaurados de ${esperado}`);
  }
  if (relida.falhas?.length) problemas.push(...relida.falhas.map((f) => `não li ${f}`));

  return {
    ok: problemas.length === 0,
    ms: Date.now() - t0,
    formato: FORMATO,
    quando: copia.quando,
    marca: copia.marca,
    contagens: copia.contagens,
    total: copia.total,
    restaurado: posto,
    problemas,
  };
}
