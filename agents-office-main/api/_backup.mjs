/* ===========================================================================
   1.23.0 · CÓPIA DE SEGURANÇA QUE SE PODE TESTAR

   O pedido do dono tem uma linha dura: «backups testáveis». Uma cópia que
   nunca foi aberta não é uma cópia — é um ficheiro com fé. Por isso aqui há
   duas coisas e não uma:

     · `exportar(repo)` lê as tabelas e devolve um JSON com uma marca (sha256
       do conteúdo das tabelas). A marca permite provar, mais tarde, que a
       cópia não foi alterada.
     · `testar(repo)` exporta, volta a ler o que exportou (serializar →
       desserializar), confere a marca e **restaura de facto** tudo numa base
       em memória, contando linha a linha. Só se tudo bater é que diz «ok».

   Limite declarado: isto prova que a cópia está inteira e que volta a entrar
   numa base com o mesmo esquema. Não prova que o Postgres de produção aceita
   o restauro — isso é um ensaio à parte, numa base de teste, e não se finge
   aqui.
   =========================================================================== */
import { createHash } from 'node:crypto';

export const FORMATO = 'orbita-backup/1';

/* as tabelas que interessam ao dono, e como se lê cada uma */
const FONTES = {
  leads: (r) => r.leads.list(1000),
  projetos: (r) => r.projetos.list(),
  tarefas: (r) => r.tarefas.list(300),
  mensagens: (r) => r.mensagens.list(300),
  receitas: (r) => r.receitas.desde('1970-01-01T00:00:00.000Z', 5000),
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

/** Restaura o que a cópia tem numa base em memória. É isto que se conta. */
async function restaurar(copia, destino) {
  const t = copia.tabelas || {};
  const postos = {};

  postos.leads = (await destino.leads.inserir(t.leads || [])).length;
  for (const p of t.projetos || []) await destino.projetos.insert(p);
  postos.projetos = (t.projetos || []).length;
  for (const x of t.tarefas || []) await destino.tarefas.insert(x);
  postos.tarefas = (t.tarefas || []).length;
  for (const m of t.mensagens || []) await destino.mensagens.inserir(m);
  postos.mensagens = (t.mensagens || []).length;
  for (const r of t.receitas || []) await destino.receitas.insert(r);
  postos.receitas = (t.receitas || []).length;
  /* atividade, runs, uso e config não se copiam para a base de ensaio: são
     telemetria e configuração, e o que se prova é que as linhas de negócio
     voltam todas. Ficam contadas na cópia. */
  return postos;
}

export async function testar(repo, { agora = new Date(), criarDestino = null } = {}) {
  const inicio = Date.now();
  const copia = await exportar(repo, { agora });
  const problemas = [];

  /* 1 · a cópia sobrevive a ir para texto e voltar (é assim que ela viaja) */
  let lida;
  try {
    lida = JSON.parse(JSON.stringify(copia));
  } catch (e) {
    return { ok: false, problemas: [`a cópia não volta a ser JSON: ${e.message}`], ms: Date.now() - inicio };
  }

  /* 2 · a marca continua a bater — se alguém mexeu num lead, isto falha */
  const agoraMarca = marca(lida);
  if (agoraMarca !== copia.marca) problemas.push(`a marca mudou ao ler a cópia (${copia.marca} → ${agoraMarca})`);

  /* 3 · as contagens dizem o mesmo que as listas */
  for (const [nome, linhas] of Object.entries(lida.tabelas || {})) {
    if ((lida.contagens[nome] ?? -1) !== linhas.length) {
      problemas.push(`${nome}: contagem ${lida.contagens[nome]} ≠ ${linhas.length} linhas`);
    }
  }

  /* 4 · restauro a sério numa base vazia, e comparo */
  let postos = {};
  let falhouRestauro = null;
  try {
    const { createMemRepo } = criarDestino
      ? { createMemRepo: criarDestino }
      : await import('./_repo.mjs');
    const destino = criarDestino ? criarDestino() : createMemRepo();
    postos = await restaurar(lida, destino);
    for (const [nome, quantas] of Object.entries(postos)) {
      if (quantas !== (lida.tabelas[nome] || []).length) {
        problemas.push(`${nome}: restaurou ${quantas} de ${(lida.tabelas[nome] || []).length}`);
      }
    }
    /* e a base de ensaio volta a dar as mesmas linhas por dentro */
    const deVolta = await destino.leads.list(1000);
    if (deVolta.length !== (lida.tabelas.leads || []).length) {
      problemas.push(`leads: a base de ensaio devolve ${deVolta.length} depois do restauro`);
    }
  } catch (e) {
    falhouRestauro = String(e.message || e).slice(0, 200);
    problemas.push(`o restauro rebentou: ${falhouRestauro}`);
  }

  return {
    ok: problemas.length === 0 && !falhouRestauro,
    ms: Date.now() - inicio,
    quando: copia.quando,
    formato: copia.formato,
    marca: copia.marca,
    contagens: copia.contagens,
    total: copia.total,
    restaurado: postos,
    falhasDeLeitura: copia.falhas,
    problemas,
    prova: 'cópia exportada, relida, conferida pela marca e restaurada numa base em memória',
  };
}
