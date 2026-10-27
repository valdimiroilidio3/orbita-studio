// Órbita Forge — as RECEITAS e o COMPOSITOR (27 out 2026).
//
// O que é «um agente cria a própria ferramenta» quando não há um modelo de linguagem ligado? Não é
// fingir que há. É isto: o agente diz o que precisa, o compositor escolhe a receita certa, instancia
// o código com os dados reais daquela sala, e a ferramenta fica no catálogo com nome, escopos e
// provas. Quando há motor ligado, o mesmo caminho aceita código escrito pelo modelo (`draft` com
// `code`) e passa-o pelas mesmas provas — a porta é a mesma, muda quem escreve.
//
// Cada receita é uma ferramenta a sério: usa só as primitivas, tem provas que olham para `result`,
// e devolve JSON que uma pessoa consegue ler no terminal.
import { slugOf } from './manifest.mjs';

const RECIPES = [
  {
    id: 'notas-contagem',
    name: 'Contagem do cérebro',
    summary: 'Conta as notas do cérebro, as palavras e as ligações, e diz quais as três maiores.',
    scopes: ['brain:read'],
    inputs: { limite: { type: 'number', default: 3, description: 'quantas notas listar' } },
    keywords: ['contar', 'contagem', 'palavras', 'notas', 'cerebro', 'volume', 'tamanho', 'quantas'],
    code: `function run(input, ctx) {
  const notas = ctx.brain.notes();
  const n = Number(input.limite) > 0 ? Number(input.limite) : 3;
  const maiores = notas.slice().sort((a, b) => b.words - a.words).slice(0, n)
    .map((x) => ({ nota: x.name, palavras: x.words }));
  return {
    notas: notas.length,
    palavras: notas.reduce((s, x) => s + x.words, 0),
    ligacoes: notas.reduce((s, x) => s + x.links.length, 0),
    maiores: maiores,
  };
}`,
    examples: [{ input: { limite: 3 }, expect: 'typeof result.notas === "number" && typeof result.palavras === "number" && typeof result.ligacoes === "number" && Array.isArray(result.maiores)' }],
  },
  {
    id: 'notas-procura',
    name: 'Procura no cérebro',
    summary: 'Procura um termo nas notas e devolve onde aparece, com a linha à volta.',
    scopes: ['brain:read'],
    inputs: {
      termo: { type: 'string', default: '', description: 'o que procurar' },
      limite: { type: 'number', default: 5, description: 'quantos resultados' },
    },
    keywords: ['procurar', 'buscar', 'procurar', 'encontrar', 'termo', 'pesquisa', 'onde', 'nota'],
    code: `function run(input, ctx) {
  const termo = String(input.termo || '').trim();
  if (!termo) return { termo: '', achadas: 0, resultados: [] };
  const achados = ctx.brain.search(termo, { limit: Number(input.limite) > 0 ? Number(input.limite) : 5 });
  return {
    termo: termo,
    achadas: achados.length,
    resultados: achados.map((a) => ({ nota: a.name, onde: a.line })),
  };
}`,
    examples: [{ input: { termo: 'cliente' }, expect: 'typeof result.termo === "string" && Array.isArray(result.resultados)' }],
  },
  {
    id: 'sala-pulso',
    name: 'Pulso da sala',
    summary: 'Lê as tarefas da sala: quantas há por estado e há quanto tempo espera a mais antiga.',
    scopes: ['tasks:read'],
    inputs: { sala: { type: 'string', default: '', description: 'sala a ler (por omissão, a desta ferramenta)' } },
    keywords: ['tarefas', 'pulso', 'sala', 'estado', 'fila', 'espera', 'pendentes', 'abertas'],
    code: `function run(input, ctx) {
  const sala = String(input.sala || ctx.room);
  const minhas = ctx.tasks.list().filter((t) => t.dept === sala);
  const porEstado = {};
  for (const t of minhas) porEstado[t.state] = (porEstado[t.state] || 0) + 1;
  const abertas = minhas.filter((t) => ['waiting', 'live', 'queued', 'scheduled'].includes(t.state))
    .sort((a, b) => a.createdAt - b.createdAt);
  const antiga = abertas[0] || null;
  return {
    sala: sala,
    tarefas: minhas.length,
    porEstado: porEstado,
    maisAntiga: antiga ? { titulo: antiga.title, esperaMin: ctx.clock.minutesSince(antiga.createdAt) } : null,
  };
}`,
    examples: [{ input: {}, expect: 'typeof result.tarefas === "number" && typeof result.porEstado === "object"' }],
  },
  {
    id: 'fila-do-escritorio',
    name: 'Idade da fila',
    summary: 'Olha para todas as tarefas do escritório e diz o que está à espera há mais tempo.',
    scopes: ['tasks:read'],
    inputs: {},
    keywords: ['fila', 'atraso', 'atrasada', 'espera', 'escritorio', 'idade', 'gargalo'],
    code: `function run(input, ctx) {
  const t = ctx.tasks.stats();
  const horas = t.oldest ? Math.round(ctx.clock.minutesSince(t.oldest.createdAt) / 6) / 10 : null;
  return {
    total: t.total,
    porEstado: t.by,
    maisAntiga: t.oldest ? { titulo: t.oldest.title, horas: horas } : null,
  };
}`,
    examples: [{ input: {}, expect: 'typeof result.total === "number" && typeof result.porEstado === "object"' }],
  },
  {
    id: 'docs-auditoria',
    name: 'Auditoria da documentação',
    summary: 'Percorre os documentos do projecto: quantos são, quantas palavras e quais não têm título.',
    scopes: ['docs:read'],
    inputs: {},
    keywords: ['docs', 'documentacao', 'readme', 'auditoria', 'documentos', 'titulo'],
    code: `function run(input, ctx) {
  const docs = ctx.docs.list();
  const semTitulo = docs.filter((d) => d.headings === 0).map((d) => d.name);
  return {
    documentos: docs.length,
    palavras: docs.reduce((s, d) => s + d.words, 0),
    semTitulo: semTitulo,
    maiores: docs.slice().sort((a, b) => b.words - a.words).slice(0, 3).map((d) => ({ nome: d.name, palavras: d.words })),
  };
}`,
    examples: [{ input: {}, expect: 'Array.isArray(result.semTitulo) && typeof result.documentos === "number"' }],
  },
  {
    id: 'notas-orfas',
    name: 'Notas sem ligação',
    summary: 'Encontra as notas do cérebro que não têm nenhuma ligação — o que o grafo não alcança.',
    scopes: ['brain:read'],
    inputs: {},
    keywords: ['orfas', 'orfa', 'ligacoes', 'grafo', 'ligada', 'ilha', 'isolada'],
    code: `function run(input, ctx) {
  const notas = ctx.brain.notes();
  const orfas = notas.filter((n) => n.links.length === 0).map((n) => n.name);
  return { notas: notas.length, orfas: orfas.length, exemplos: orfas.slice(0, 8) };
}`,
    examples: [{ input: {}, expect: 'result.orfas <= result.notas && Array.isArray(result.exemplos)' }],
  },
  {
    id: 'nota-guardar',
    name: 'Guardar uma nota',
    summary: 'Escreve uma nota no cérebro, na pasta da oficina. Toca em dados: só activa com o dono.',
    scopes: ['brain:write'],
    sideEffects: true,
    inputs: {
      titulo: { type: 'string', default: 'Nota da oficina', description: 'nome da nota' },
      corpo: { type: 'string', default: '', description: 'texto a guardar' },
    },
    keywords: ['guardar', 'escrever', 'nota', 'registar', 'apontar', 'gravar'],
    code: `function run(input, ctx) {
  const titulo = String(input.titulo || 'Nota da oficina').trim();
  const corpo = String(input.corpo || '').trim();
  if (!corpo) throw new Error('falta o corpo da nota: sem texto não há nada para guardar');
  const res = ctx.brain.writeNote(titulo, corpo);
  return { nota: titulo, ficheiro: res.file, bytes: res.bytes, seco: !!res.dry };
}`,
    examples: [{ input: { titulo: 'Prova da oficina', corpo: 'texto de prova' }, expect: 'typeof result.ficheiro === "string"' }],
  },
];

export const recipeKeys = () => RECIPES.map((r) => r.id);
export const recipe = (id) => RECIPES.find((r) => r.id === id) || null;
export const recipes = () => RECIPES.map((r) => ({ id: r.id, name: r.name, summary: r.summary, scopes: r.scopes, keywords: r.keywords, sideEffects: !!r.sideEffects }));

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/**
 * Escolhe a receita. Devolve sempre o PORQUÊ: quais as palavras que pesaram e qual o segundo
 * classificado. Uma oficina que escolhe sem dizer porquê é uma caixa preta — e o dono não confia.
 */
export function choose(need) {
  const text = norm(need);
  const words = text.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const scored = RECIPES.map((r) => {
    const hits = r.keywords.filter((k) => text.includes(norm(k)));
    const wHits = words.filter((w) => r.keywords.some((k) => norm(k).startsWith(w) || w.startsWith(norm(k).slice(0, 5))));
    const score = hits.length * 2 + wHits.length;
    return { r, score, hits };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  if (!best || best.score === 0) {
    return { ok: false, reason: 'nenhuma receita serve este pedido', closest: scored.slice(0, 3).map((s) => s.r.id), words };
  }
  return {
    ok: true, recipe: best.r, score: best.score, hits: best.hits,
    second: second && second.score > 0 ? { id: second.r.id, score: second.score } : null,
    words,
  };
}

/** transformações de reparação: pequenas, determinísticas e visíveis (nada de magia). */
export const REPAIRS = [
  {
    id: 'guardar-entradas',
    why: 'a ferramenta partiu-se a ler uma entrada que não veio — passa a começar por `input = input || {}`',
    match: (e) => /Cannot read propert(y|ies) of (undefined|null)/i.test(String(e)) || /of undefined/i.test(String(e)),
    apply: (code) => code.replace(/function\s+run\s*\(\s*input\s*,\s*ctx\s*\)\s*\{/, 'function run(input, ctx) {\n  input = input || {};'),
  },
  {
    id: 'normalizar-texto',
    why: 'a ferramenta chamou um método de texto a um valor que não era texto — as entradas passam a ser normalizadas',
    match: (e) => /(toLowerCase|toUpperCase|trim|includes|split|startsWith)\s+is not a function/i.test(String(e)),
    apply: (code) => code.replace(/function\s+run\s*\(\s*input\s*,\s*ctx\s*\)\s*\{/,
      `function run(input, ctx) {
  input = Object.fromEntries(Object.entries(input || {}).map(([k, v]) => [k, v == null ? '' : v]));`),
  },
];

/** aplica a primeira reparação que reconhece a falha. Devolve o código novo e o que fez. */
export function repair(code, error) {
  for (const r of REPAIRS) {
    if (!r.match(error)) continue;
    const next = r.apply(code);
    if (next !== code) return { code: next, rule: r.id, why: r.why };
  }
  return null;
}

/** o código de uma receita, pronto a gravar. `title` é o nome que o agente lhe deu. */
export function instantiate(found, { room, author, name, need }) {
  const r = found.recipe;
  const id = slugOf(name || r.name);
  return {
    id,
    room,
    author,
    name: name || r.name,
    summary: r.summary,
    recipe: r.id,
    need: String(need || '').slice(0, 300),
    scopes: r.scopes,
    inputs: r.inputs,
    examples: r.examples,
    state: 'draft',
    auto: !r.sideEffects,
    code: r.code,
  };
}
