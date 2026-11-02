/* ===========================================================================
   1.58.0 · O CÉREBRO COMO REDE — tarefas, agentes e conhecimento, ligados
   (2 nov 2026)

   Até aqui o Cérebro era uma esfera bonita com as notas do vault à volta.
   Sabia-se o que estava escrito; não se sabia QUEM o escreveu, nem de que
   trabalho nasceu. Este ficheiro dá-lhe as duas coisas que faltavam, e fá-lo
   só a partir do que existe:

     · o agente que executou a tarefa,
     · a tarefa (o que foi pedido),
     · a nota que a tarefa produziu (o conhecimento).

   As três coisas são nós; as arestas são relações reais:
     agente —trabalha em→ tarefa —produz→ nota

   Nada aqui desenha: isto é aritmética e geometria (posições determinísticas,
   sem `Math.random`), para poder ser provado sem browser. A cena e o grafo em
   ecrã inteiro limitam-se a aplicar o resultado.

   Regra que não se quebra: sem nota, a tarefa não ganha uma aresta inventada.
   Sem tarefas, a rede diz que está vazia em vez de mostrar um exemplo.
   =========================================================================== */

/** O que cada tipo de nó é, e a cor com que se lê. */
export const TIPOS = {
  agente: { chave: 'agente', rotulo: 'Agentes', um: 'agente', cor: '#5ADEB7' },
  tarefa: { chave: 'tarefa', rotulo: 'Tarefas', um: 'tarefa', cor: '#EADC8F' },
  nota: { chave: 'nota', rotulo: 'Conhecimento', um: 'nota', cor: '#B0ADA3' },
};

/** Os dois grupos novos que entram no grafo do Cérebro (`brain.js` lê o prefixo). */
export const GRUPO = { agente: '00-Agentes', tarefa: '00-Tarefas' };

const chave = (tipo, id) => `${tipo}:${id}`;
const texto = (v) => (v == null ? '' : String(v));
const slug = (t) => texto(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** O estado de uma tarefa, venha ela do escritório ou do servidor. */
const ESTADO = {
  doing: 'aberta', running: 'aberta', working: 'aberta',
  waiting: 'espera', awaiting_approval: 'espera',
  next: 'fila', queued: 'fila', sched: 'fila', scheduled: 'fila',
  done: 'feita', succeeded: 'feita',
  failed: 'falhou', error: 'falhou',
};
export const estadoDaTarefa = (t) => ESTADO[t && t.state] || 'outra';

/** O nome da nota que a tarefa escreveu, quando o servidor o disse. */
export function notaDaTarefa(t) {
  if (!t) return null;
  const fontes = [
    t.nota, t.note, t.notaId, t.noteId,
    t.resultado && (t.resultado.nota || t.resultado.note),
    t.piece && (t.piece.nota || t.piece.note),
    t.last && (t.last.nota || t.last.note),
  ];
  for (const f of fontes) if (typeof f === 'string' && f.trim()) return f.trim();
  return null;
}

/** A tarefa tem um nome próprio? Sem título não há nó: um nó «—» não diz nada. */
const tituloDa = (t) => texto(t.title || t.titulo || t.name || t.kind || '').trim();

/* Posições: três anéis concêntricos. Agentes por fora (são quem age), tarefas
   no meio, conhecimento por dentro (é o que fica). Tudo determinístico: a mesma
   base de dados dá sempre o mesmo desenho, e é isso que torna isto testável. */
const ANEL = { agente: 0.88, tarefa: 0.58, nota: 0.3 };

function dispor(itens, raio, base = 0) {
  const n = Math.max(1, itens.length);
  return itens.map((it, i) => {
    const ang = base + (i / n) * Math.PI * 2;
    return { ...it, x: Math.cos(ang) * raio, y: Math.sin(ang) * raio, ang };
  });
}

/**
 * Constrói a rede.
 *
 * @param {object} o
 * @param {Array}  o.agentes  [{ id, nome, sala }]
 * @param {Array}  o.tarefas  tarefas do escritório ou do servidor
 * @param {Array}  o.notas    [{ id }] — as notas que o Cérebro tem no grafo
 * @param {number} o.limite   quantas tarefas entram (as abertas primeiro)
 */
export function construirRede({ agentes = [], tarefas = [], notas = [], limite = 14 } = {}) {
  const listaAgentes = (Array.isArray(agentes) ? agentes : []).filter((a) => a && a.id);
  const porId = new Map(listaAgentes.map((a) => [String(a.id), a]));
  const listaNotas = (Array.isArray(notas) ? notas : []).filter((n) => n && texto(n.id).trim());
  const notaPorId = new Map(listaNotas.map((n) => [texto(n.id), n]));

  /* As tarefas entram por ordem de importância: primeiro o que está aberto ou à
     espera de alguém; depois o que acabou. As mesmas contas do Cérebro e da mesa. */
  const ordem = { espera: 0, aberta: 1, falhou: 2, fila: 3, feita: 4, outra: 5 };
  const validas = (Array.isArray(tarefas) ? tarefas : [])
    .filter(Boolean)
    .map((t) => ({ t, titulo: tituloDa(t), estado: estadoDaTarefa(t) }))
    .filter((x) => x.titulo);
  const escolhidas = validas
    .slice()
    .sort((a, b) => (ordem[a.estado] - ordem[b.estado])
      || (Number(b.t.prioridade || 0) - Number(a.t.prioridade || 0))
      || (Date.parse(b.t.created_at || b.t.createdAt || 0) || 0) - (Date.parse(a.t.created_at || a.t.createdAt || 0) || 0))
    .slice(0, Math.max(0, Number(limite) || 0));

  /* Só entra o agente que tem trabalho escolhido — os outros 35 ficariam a
     fazer peso no desenho sem uma única aresta para mostrar. */
  const idsDeAgente = [];
  for (const x of escolhidas) {
    const id = texto(x.t.agent || x.t.agente || x.t.agentId || '');
    if (id && porId.has(id) && !idsDeAgente.includes(id)) idsDeAgente.push(id);
  }

  const nos = [];
  const ligacoes = [];
  const jaLigado = new Set();
  const liga = (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (a === b || jaLigado.has(k)) return;
    jaLigado.add(k);
    ligacoes.push({ a, b });
  };

  const agentesNo = dispor(idsDeAgente.map((id) => {
    const a = porId.get(id);
    return { chave: chave('agente', id), tipo: 'agente', id, rotulo: texto(a.nome || a.name || id), sala: a.sala || a.dept || null };
  }), ANEL.agente);

  /* As tarefas de cada agente ficam perto do seu agente, num leque estreito:
     vê-se de quem é o trabalho antes de se ler o rótulo. */
  const abertura = Math.PI / Math.max(3, agentesNo.length * 2);
  const tarefasNo = [];
  const anguloDoAgente = new Map(agentesNo.map((a) => [a.chave, a.ang]));
  const porAgente = new Map();
  for (const x of escolhidas) {
    const id = texto(x.t.agent || x.t.agente || x.t.agentId || '');
    const k = id ? chave('agente', id) : null;
    if (!porAgente.has(k)) porAgente.set(k, []);
    porAgente.get(k).push(x);
  }
  let solto = 0;
  const origem = new Map(); // chave do nó → tarefa de onde veio (para achar a nota)
  const semDono = porAgente.get(null) || [];
  for (const [k, lista] of porAgente) {
    if (!k) continue;
    const base = anguloDoAgente.has(k) ? anguloDoAgente.get(k) : 0;
    const n = lista.length;
    lista.forEach((x, j) => {
      const ang = base + (j - (n - 1) / 2) * abertura;
      const r = ANEL.tarefa - (j % 2) * 0.07; // um dente de serra: dois nós nunca se sobrepõem
      const no = {
        chave: chave('tarefa', x.t.id ?? x.titulo), tipo: 'tarefa',
        id: texto(x.t.id ?? x.titulo), rotulo: x.titulo, estado: x.estado,
        agente: texto(x.t.agent || x.t.agente || ''), x: Math.cos(ang) * r, y: Math.sin(ang) * r, ang,
      };
      tarefasNo.push(no);
      origem.set(no.chave, x.t);
      liga(k, no.chave);
    });
  }
  // tarefas sem agente reconhecido: ficam num arco próprio, sem aresta para ninguém
  dispor(semDono, ANEL.tarefa).forEach((x, i) => {
    const ang = -Math.PI / 2 + (i + 0.5) * (Math.PI / Math.max(4, semDono.length + 1));
    solto += 1;
    const no = {
      chave: chave('tarefa', x.t.id ?? x.titulo), tipo: 'tarefa', id: texto(x.t.id ?? x.titulo),
      rotulo: x.titulo, estado: x.estado, agente: '', x: Math.cos(ang) * ANEL.tarefa, y: Math.sin(ang) * ANEL.tarefa, ang,
    };
    tarefasNo.push(no);
    origem.set(no.chave, x.t);
  });

  /* Conhecimento: só entra a nota que uma tarefa nomeia. Se o servidor não disse
     qual foi, não há aresta — e não há nó (um nó solto no Cérebro seria ficção). */
  const notasNo = [];
  for (const t of tarefasNo) {
    const nome = notaDaTarefa(origem.get(t.chave));
    if (!nome) continue;
    const nota = notaPorId.get(nome) || notaPorId.get([...notaPorId.keys()].find((k) => k.toLowerCase() === nome.toLowerCase()));
    if (!nota) continue;
    if (notasNo.some((n) => n.id === texto(nota.id))) {
      liga(t.chave, chave('nota', nota.id));
      continue;
    }
    const ang = t.ang + 0.05;
    const no = {
      chave: chave('nota', nota.id), tipo: 'nota', id: texto(nota.id), rotulo: texto(nota.id),
      x: Math.cos(ang) * ANEL.nota, y: Math.sin(ang) * ANEL.nota, ang,
    };
    notasNo.push(no);
    liga(t.chave, no.chave);
  }

  /* O grau de cada nó é o que a cena usa para o tamanho: um agente com quatro
     tarefas fica maior do que um com uma. */
  const grau = new Map();
  for (const { a, b } of ligacoes) {
    grau.set(a, (grau.get(a) || 0) + 1);
    grau.set(b, (grau.get(b) || 0) + 1);
  }
  for (const n of [...agentesNo, ...tarefasNo, ...notasNo]) n.d = grau.get(n.chave) || 1;

  const todos = [...agentesNo, ...tarefasNo, ...notasNo];
  const contagens = {
    agentes: agentesNo.length,
    tarefas: tarefasNo.length,
    notas: notasNo.length,
    ligacoes: ligacoes.length,
    semDono: solto,
    porEstado: tarefasNo.reduce((acc, n) => { acc[n.estado] = (acc[n.estado] || 0) + 1; return acc; }, {}),
  };

  return { nos: todos, ligacoes, contagens, vazio: todos.length === 0 };
}

/** A frase da rede — a mesma verdade em três sítios (rail, painel 2D, Cérebro). */
export function resumoDaRede(rede) {
  const c = (rede && rede.contagens) || {};
  if (!rede || rede.vazio) {
    return {
      curto: 'a rede está vazia',
      longo: 'Sem tarefas que liguem um agente a uma nota, o Cérebro não tem relações para mostrar. A rede nasce do trabalho real.',
    };
  }
  const p = (n, um, muitos) => `${n} ${n === 1 ? um : muitos}`;
  return {
    curto: `${p(c.agentes, 'agente', 'agentes')} · ${p(c.tarefas, 'tarefa', 'tarefas')} · ${p(c.notas, 'nota', 'notas')}`,
    longo: `${p(c.agentes, 'agente ligado', 'agentes ligados')} a ${p(c.tarefas, 'tarefa', 'tarefas')}, `
      + `${p(c.notas, 'nota escrita', 'notas escritas')} pelo trabalho — ${p(c.ligacoes, 'ligação real', 'ligações reais')}.`,
  };
}
