/* ===========================================================================
   1.62.0 · A BUSCA GLOBAL, AO ALCANCE DO POLEGAR (2 nov 2026)

   O `Ctrl K` existia desde a 1.57.0 e no telemóvel não havia como lá chegar: o
   dono pedia pesquisa global e criação rápida de tarefas a uma mão. Um atalho de
   teclado não é uma porta num telefone.

   Este ficheiro é a parte que se pode provar sem ecrã: o que é uma consulta
   válida, como se arrumam os resultados, que tarefa se pode criar a partir de um
   resultado (e qual NÃO se pode, com a razão), e o que a folha de busca mostra em
   cada momento. A mesa só desenha o que aqui se decide.

   Regras:
   · nada de sugestões inventadas: os recentes são os que tu pesquisaste;
   · uma tarefa precisa de um alvo real (um lead ou um projeto) — sem alvo,
     diz-se que falta, em vez de criar uma tarefa vazia;
   · criar a partir da busca é sempre «à espera da tua aprovação»: nada corre
     sozinho por causa de uma pesquisa.
   =========================================================================== */

export const MINIMO = 2;
export const CHAVE_RECENTES = 'orbita.busca.recentes';
export const MAX_RECENTES = 6;

/** Sem acentos, sem maiúsculas — o mesmo critério do servidor (`/ops/pesquisa`). */
export function semAcentos(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** A consulta tal como se usa: aparada; abaixo de duas letras não se procura. */
export function limparConsulta(q) {
  return String(q ?? '').trim().replace(/\s+/g, ' ');
}

export function consultaValida(q) {
  return semAcentos(limparConsulta(q)).length >= MINIMO;
}

/** A entidade que um resultado representa — é o que uma tarefa precisa. */
export function entidadeDaRota(rota) {
  const r = String(rota || '');
  if (r.startsWith('#/lead/')) return 'lead';
  if (r.startsWith('#/projeto/')) return 'projeto';
  return null;
}

const texto = (v) => String(v ?? '').trim();

/**
 * Arruma a resposta de `/ops/pesquisa` em cartões: um título, uma linha de
 * contexto e um destino. Grupos vazios desaparecem — um cabeçalho sem itens é
 * ruído.
 */
export function agrupar(resposta = {}) {
  const grupos = Array.isArray(resposta.grupos) ? resposta.grupos : [];
  const limpos = grupos
    .map((g) => ({
      label: texto(g.label) || 'Resultados',
      itens: (Array.isArray(g.itens) ? g.itens : [])
        .filter((i) => i && i.id)
        .map((i) => {
          const entidade = entidadeDaRota(i.route);
          return {
            id: String(i.id),
            titulo: texto(i.name || i.title) || String(i.id).slice(0, 8),
            sub: texto(i.city || i.client || i.kindLabel),
            rota: texto(i.route) || '#/hoje',
            grupo: texto(g.label),
            entidade,
            podeCriarTarefa: !!entidade,
          };
        }),
    }))
    .filter((g) => g.itens.length);
  const total = limpos.reduce((n, g) => n + g.itens.length, 0);
  return {
    grupos: limpos,
    total,
    query: texto(resposta.query),
    nota: texto(resposta.nota) || (total ? '' : 'nada corresponde'),
  };
}

/* Os tipos de tarefa que o servidor aceita (`/ops/tarefas`). A inferência não
   adivinha: escolhe pelo verbo que está escrito e diz porquê. */
export const TIPOS = {
  investigar: { label: 'Investigar', porque: 'o pedido fala em procurar, ver ou perceber' },
  mensagem: { label: 'Escrever mensagem', porque: 'o pedido fala em escrever, responder ou contactar' },
  briefing: { label: 'Escrever briefing', porque: 'o pedido fala em briefing, plano ou proposta' },
  codigo: { label: 'Escrever código', porque: 'o pedido fala em código, página ou corrigir' },
  qa: { label: 'Testar', porque: 'o pedido fala em testar, verificar ou revisar' },
};

const PISTAS = [
  { tipo: 'qa', palavras: ['teste', 'testar', 'testa', 'verificar', 'verifica', 'revisao', 'revisar', 'rever', 'bug'] },
  { tipo: 'codigo', palavras: ['codigo', 'programar', 'corrigir', 'corrige', 'pagina', 'site', 'css', 'html', 'js', 'deploy'] },
  { tipo: 'briefing', palavras: ['briefing', 'plano', 'planea', 'proposta', 'orçamento', 'orcamento', 'estrutura'] },
  { tipo: 'mensagem', palavras: ['mensagem', 'email', 'mail', 'whatsapp', 'responder', 'responde', 'contactar', 'escreve', 'escrever', 'texto'] },
  { tipo: 'investigar', palavras: ['investigar', 'investiga', 'procurar', 'procura', 'pesquisar', 'perceber', 'saber', 'analisar', 'ler'] },
];

/** Que tarefa pedir, a partir do que a pessoa escreveu. Diz sempre porquê. */
export function inferirTipo(q) {
  /* Comparação por PALAVRA, não por pedaço: «escrever» contém «rever», e sem
     isto um pedido de escrita virava um pedido de revisão. */
  const palavras = semAcentos(limparConsulta(q)).split(/[^a-z0-9]+/).filter(Boolean);
  const combina = (w) => palavras.some((t) => t === w || (w.length >= 5 && t.startsWith(w) && t.length - w.length <= 3));
  for (const p of PISTAS) {
    const achou = p.palavras.find(combina);
    if (achou) return { tipo: p.tipo, palavra: achou, porque: TIPOS[p.tipo].porque, certo: true };
  }
  return {
    tipo: 'investigar', palavra: null, certo: false,
    porque: 'sem verbo claro no pedido: «investigar» é o trabalho que menos estraga se a intenção for outra',
  };
}

/**
 * A tarefa que um resultado pode originar. Sem um lead ou um projeto ligado ao
 * resultado, NÃO se inventa uma tarefa: diz-se o que falta.
 */
export function tarefaDoResultado({ consulta = '', item = null, aprovacao = true } = {}) {
  if (!item) {
    return { ok: false, sem: 'escolhe primeiro um resultado com lead ou projeto' };
  }
  const entidade = item.entidade || entidadeDaRota(item.rota);
  if (!entidade) {
    return { ok: false, sem: `${item.grupo || 'este resultado'} não tem lead nem projeto ligado — uma tarefa precisa de um alvo real` };
  }
  const inf = inferirTipo(consulta || item.titulo);
  return {
    ok: true,
    corpo: { kind: inf.tipo, entityId: String(item.id), entidade, aprovacao: !!aprovacao, correr: true },
    tipo: inf.tipo,
    rotuloTipo: TIPOS[inf.tipo].label,
    porque: inf.porque,
    titulo: `${TIPOS[inf.tipo].label}: ${item.titulo}`,
    alvo: item.titulo,
  };
}

/**
 * O estado da folha de busca — a decisão, não o desenho:
 *   curta   · ainda não há letras suficientes (e não se procura);
 *   a-carregar · há consulta e ainda não há resposta;
 *   erro    · a pesquisa falhou (diz-se, não se finge vazio);
 *   vazio   · a pesquisa respondeu e nada corresponde;
 *   lista   · há resultados.
 */
export function estadoDaBusca({ consulta = '', resultado = null, aCarregar = false, erro = '' } = {}) {
  const q = limparConsulta(consulta);
  if (!consultaValida(q)) {
    return { modo: 'curta', consulta: q, grupos: [], total: 0, nota: `escreve pelo menos ${MINIMO} letras — antes disso não há o que procurar` };
  }
  if (erro) return { modo: 'erro', consulta: q, grupos: [], total: 0, nota: erro };
  if (aCarregar || !resultado) return { modo: 'a-carregar', consulta: q, grupos: [], total: 0, nota: 'a procurar…' };
  const a = agrupar(resultado);
  if (!a.total) {
    return { modo: 'vazio', consulta: q, grupos: [], total: 0, nota: a.nota || `nada corresponde a «${q}»` };
  }
  return { modo: 'lista', consulta: q, grupos: a.grupos, total: a.total, nota: a.nota };
}

/** Os recentes como lista: sem repetidos, os mais novos à frente, no máximo 6. */
export function juntarRecente(lista = [], consulta = '') {
  const q = limparConsulta(consulta);
  if (!consultaValida(q)) return Array.isArray(lista) ? lista.slice(0, MAX_RECENTES) : [];
  const semRepetir = (Array.isArray(lista) ? lista : []).filter((x) => semAcentos(x) !== semAcentos(q));
  return [q, ...semRepetir].slice(0, MAX_RECENTES);
}

/** Ler/gravar os recentes sem partir quando o browser bloqueia o armazenamento. */
export function lerRecentes(storage) {
  try {
    const cru = storage && storage.getItem(CHAVE_RECENTES);
    const l = cru ? JSON.parse(cru) : [];
    return Array.isArray(l) ? l.filter((x) => typeof x === 'string').slice(0, MAX_RECENTES) : [];
  } catch { return []; }
}

export function gravarRecentes(storage, lista) {
  try {
    if (storage) storage.setItem(CHAVE_RECENTES, JSON.stringify((Array.isArray(lista) ? lista : []).slice(0, MAX_RECENTES)));
    return true;
  } catch { return false; }
}
