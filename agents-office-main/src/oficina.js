/* ===========================================================================
   1.58.0 · O ESCRITÓRIO COMO INTERFACE — a conta que a cena não pode inventar
   (2 nov 2026)

   O escritório 3D é a cara da Órbita. Até aqui era sobretudo um lugar: as salas
   tinham números, mas o estado de cada uma e o que está lá dentro vivia noutro
   ecrã. Este ficheiro dá à cena o que lhe faltava, e faz a vista 2D:

     · `estadoDaSala()` — «a trabalhar», «espera por ti», «bloqueada», «na fila»,
       «em descanso» ou «sem trabalho», tirado das tarefas reais e do retrato ao
       vivo. A REGRA é a mesma da mesa: vive em `painel.js` (`estadoAgentes`) e
       não é reescrita aqui — só traduzida para as seis salas do escritório;
     · `indicadorDeAgente()` — o sinal discreto por cima de quem está mesmo a
       trabalhar (verde), à espera do teu OK (âmbar) ou falhou (vermelho);
     · `panoramaDaSala()` — o painel contextual que abre ao clicar numa sala;
     · `construirPlanta()` / `plantaHTML()` — a vista 2D: as mesmas seis salas,
       na mesma ordem, sem WebGL, para trabalho intensivo;
     · `initOficina()` — monta a planta, trata do teclado (setas, Enter, Esc) e
       devolve o foco a quem a abriu.

   Regra que não se quebra: sem dados, diz-se «sem trabalho» ou «sem ligação» —
   nunca se inventa um número, nem se acende uma luz que ninguém pediu.
   =========================================================================== */

import { estadoAgentes, idade, plural } from './painel.js';

/** A ponte entre as seis salas da cena e os departamentos da operação. */
export const SALA_PARA_DEPARTAMENTO = {
  emails: 'comando',
  sales: 'prospeccao',
  ops: 'vendas',
  marketing: 'media',
  fin: 'design',
  delivery: 'engenharia',
};

/** A ordem em que as salas se leem — a mesma do chão e a da planta 2D. */
export const ORDEM_SALAS = ['emails', 'delivery', 'sales', 'marketing', 'fin', 'ops'];

/** Tudo o que uma sala pode dizer, com a cor que usa na cena e na planta. */
export const ESTADOS = {
  'a-trabalhar': { rotulo: 'A trabalhar', curto: 'A TRABALHAR', cor: '#1E9070', ordem: 0 },
  bloqueado: { rotulo: 'Bloqueada', curto: 'BLOQUEADA', cor: '#B4391E', ordem: 1 },
  'espera-ti': { rotulo: 'Espera por ti', curto: 'ESPERA POR TI', cor: '#B4830B', ordem: 2 },
  'na-fila': { rotulo: 'Na fila', curto: 'NA FILA', cor: '#5B66CE', ordem: 3 },
  'em-descanso': { rotulo: 'Em descanso', curto: 'EM DESCANSO', cor: '#5A5A5A', ordem: 4 },
  'sem-trabalho': { rotulo: 'Sem trabalho', curto: 'SEM TRABALHO', cor: '#8A8A8A', ordem: 5 },
  'sem-ligacao': { rotulo: 'Sem ligação', curto: 'SEM LIGAÇÃO', cor: '#8A8A8A', ordem: 6 },
};

/** O estado dos monitores (`live.js`) traduzido para o indicador do agente. */
export const INDICADOR = {
  'a-trabalhar': { cor: '#1E9070', activo: true, rotulo: 'a trabalhar' },
  'espera-ti': { cor: '#B4830B', activo: true, rotulo: 'à espera do teu OK' },
  bloqueado: { cor: '#B4391E', activo: true, rotulo: 'a última tarefa falhou' },
  'na-fila': { cor: '#5B66CE', activo: false, rotulo: 'na fila' },
  descanso: { cor: '#8A8A8A', activo: false, rotulo: 'sem tarefa' },
  'sem-ligacao': { cor: '#8A8A8A', activo: false, rotulo: 'sem ligação ao vivo' },
};

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const MAPA_ESTADO = {
  doing: 'a-correr', running: 'a-correr', working: 'a-correr',
  next: 'na-fila', queued: 'na-fila', sched: 'na-fila', scheduled: 'na-fila',
  waiting: 'espera', awaiting_approval: 'espera',
  done: 'feita', succeeded: 'feita',
  failed: 'falhou', error: 'falhou', cancelled: 'cancelada',
};

/** Uma tarefa, venha ela do escritório local ou do servidor, numa forma só. */
export function normalizarTarefa(t, { salaDe = null } = {}) {
  if (!t) return null;
  const titulo = String(t.title || t.titulo || t.name || t.kind || '').trim();
  if (!titulo) return null;
  const sala = t.dept || t.sala || (salaDe ? salaDe(t) : null);
  return {
    id: t.id ?? titulo,
    titulo,
    sala: sala || null,
    agente: t.agent || t.agente || null,
    estado: MAPA_ESTADO[t.state] || 'outra',
    quando: t.finished_at || t.doneAt || t.created_at || t.addedAt || null,
    kind: t.kind || null,
  };
}

/** O estado de um nó do retrato ao vivo, traduzido para o mesmo vocabulário. */
export function estadoDoRetrato(d) {
  const st = d && (typeof d === 'string' ? d : d.state);
  if (st === 'live' || st === 'working') return 'a-trabalhar';
  if (st === 'waiting' || st === 'stuck' || st === 'awaiting_approval') return 'espera-ti';
  if (st === 'error' || st === 'failed') return 'bloqueado';
  if (st === 'queued') return 'na-fila';
  return 'descanso';
}

/**
 * As contagens de uma sala. Duas fontes, sem somar duas vezes a mesma coisa:
 * as tarefas que o escritório conhece (locais ou já carregadas) e o retrato ao
 * vivo que o servidor envia por SSE. Quando as duas falam do mesmo posto, vale
 * a maior — o servidor pode ver trabalho que o browser ainda não tem.
 */
export function contagensDaSala(sala, { tarefas = [], agentes = [], retrato = {}, ligado = true } = {}) {
  const minhas = (Array.isArray(tarefas) ? tarefas : [])
    .filter(Boolean)
    .filter((t) => (t.sala || t.dept) === sala);
  const contar = (e) => minhas.filter((t) => (t.estado || MAPA_ESTADO[t.state]) === e).length;

  let aoVivo = 0, aEspera = 0, falhadas = 0, emFila = 0;
  if (ligado && retrato && typeof retrato === 'object') {
    for (const a of (Array.isArray(agentes) ? agentes : [])) {
      if (!a || a.sala !== sala) continue;
      const e = estadoDoRetrato(retrato[a.id]);
      if (e === 'a-trabalhar') aoVivo += 1;
      else if (e === 'espera-ti') aEspera += 1;
      else if (e === 'bloqueado') falhadas += 1;
      else if (e === 'na-fila') emFila += 1;
    }
  }

  return {
    aCorrer: Math.max(contar('a-correr'), aoVivo),
    porAprovar: Math.max(contar('espera'), aEspera),
    falhadas: Math.max(contar('falhou'), falhadas),
    naFila: Math.max(contar('na-fila'), emFila),
    concluidas: contar('feita'),
    total: minhas.length,
  };
}

/**
 * O estado de uma sala — a mesma decisão da mesa, sem uma segunda regra.
 * Se não há ligação e o escritório não tem nada, diz-se «sem ligação»; não se
 * afirma «sem trabalho» sobre uma sala que ninguém conseguiu ver.
 */
export function estadoDaSala({ sala, tarefas = [], agentes = [], retrato = {}, ligado = true, agora = Date.now() } = {}) {
  const c = contagensDaSala(sala, { tarefas, agentes, retrato, ligado });
  const { linhas } = estadoAgentes({
    departamentos: [{ id: SALA_PARA_DEPARTAMENTO[sala] || sala, tarefas: c }],
    tarefas: [],
    agora,
  });
  const l = linhas[0] || { estado: 'sem-trabalho', ultimaIdade: null };
  const chave = !ligado && c.total === 0 && !c.aCorrer && !c.porAprovar && !c.falhadas ? 'sem-ligacao' : l.estado;
  const e = ESTADOS[chave] || ESTADOS['sem-trabalho'];
  const quando = (Array.isArray(tarefas) ? tarefas : [])
    .filter((t) => t && (t.sala || t.dept) === sala && t.quando)
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)))[0];
  const ultima = l.ultima || (quando && quando.quando) || null;
  return {
    chave,
    rotulo: e.rotulo,
    curto: e.curto,
    cor: e.cor,
    ordem: e.ordem,
    contagens: c,
    ultima,
    ultimaIdade: idade(ultima, agora),
    detalhe: fraseDoEstado(chave, c),
  };
}

/** Uma frase que explica o número — nunca um estado sem razão. */
export function fraseDoEstado(chave, c = {}) {
  if (chave === 'sem-ligacao') return 'O servidor não está a responder; esta sala mostra o último estado conhecido.';
  if (chave === 'a-trabalhar') return `${plural(c.aCorrer || 1, 'tarefa a correr', 'tarefas a correr')}${c.naFila ? `, ${plural(c.naFila, 'na fila', 'na fila')}` : ''}.`;
  if (chave === 'espera-ti') return `${plural(c.porAprovar || 1, 'decisão à tua espera', 'decisões à tua espera')}.`;
  if (chave === 'bloqueado') return `${plural(c.falhadas || 1, 'tarefa falhada', 'tarefas falhadas')} — alguém tem de olhar para isto.`;
  if (chave === 'na-fila') return `${plural(c.naFila || 1, 'tarefa na fila', 'tarefas na fila')}; ninguém lhe pegou ainda.`;
  if (chave === 'em-descanso') return `${plural(c.concluidas || 1, 'tarefa fechada', 'tarefas fechadas')}; a sala está livre.`;
  return 'Sem trabalho registado nesta sala.';
}

/** O sinal discreto por cima de um agente: só acende com trabalho real. */
export function indicadorDeAgente({ estado = 'descanso', ligado = true } = {}) {
  const chave = !ligado && estado !== 'a-trabalhar' ? 'sem-ligacao' : (INDICADOR[estado] ? estado : 'descanso');
  const i = INDICADOR[chave];
  return { chave, activo: !!i.activo && !!ligado, cor: i.cor, rotulo: i.rotulo };
}

/**
 * As tarefas que o SERVIDOR diz que estão a correr numa sala, quando o escritório
 * ainda não tem essas tarefas na mão. Sem isto, uma sala podia dizer «1 a correr»
 * e logo abaixo «nada registado» — que é a pior espécie de mentira: a que se
 * contradiz a si mesma.
 */
export function tarefasDoRetrato(sala, { agentes = [], retrato = {}, ligado = true, agora = Date.now() } = {}) {
  if (!ligado || !retrato || typeof retrato !== 'object') return [];
  const out = [];
  for (const a of (Array.isArray(agentes) ? agentes : [])) {
    if (!a || a.sala !== sala) continue;
    const d = retrato[a.id];
    const t = d && d.task;
    if (!t || !String(t.title || '').trim()) continue;
    const quando = t.started_at || t.created_at || d.at || (d.last && d.last.finished_at) || null;
    out.push({
      id: t.id ?? t.title,
      titulo: String(t.title).trim(),
      estado: MAPA_ESTADO[t.state] || 'outra',
      agente: a.nome || a.id,
      quando,
      idade: idade(quando, agora),
      aprovavel: t.state === 'awaiting_approval',
    });
  }
  return out;
}

/**
 * O painel contextual de uma sala: estado, contagens, o que lá está dentro e
 * quem lá está. É o mesmo objecto que a planta 2D usa no lado direito.
 */
export function panoramaDaSala({
  sala, nome = sala, cor = '#5A5A5A', tarefas = [], agentes = [], retrato = {}, ligado = true, agora = Date.now(),
} = {}) {
  const estado = estadoDaSala({ sala, tarefas, agentes, retrato, ligado, agora });
  const normais = (Array.isArray(tarefas) ? tarefas : [])
    .map((t) => (t && t.estado ? t : normalizarTarefa(t)))
    .filter((t) => t && t.sala === sala);

  /* o que o servidor diz junta-se ao que o escritório conhece, sem repetir títulos */
  const doServidor = tarefasDoRetrato(sala, { agentes, retrato, ligado, agora })
    .filter((t) => !normais.some((n) => n.titulo === t.titulo));

  const ordem = { espera: 0, 'a-correr': 1, falhou: 2, 'na-fila': 3, feita: 4, cancelada: 5, outra: 6 };
  const lista = [...normais, ...doServidor]
    .slice()
    .sort((a, b) => (ordem[a.estado] ?? 9) - (ordem[b.estado] ?? 9)
      || String(b.quando || '').localeCompare(String(a.quando || '')))
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      titulo: t.titulo,
      estado: t.estado,
      agente: t.agente,
      quando: t.quando,
      idade: idade(t.quando, agora),
      aprovavel: t.estado === 'espera' && !!t.agente,
    }));

  const pessoas = (Array.isArray(agentes) ? agentes : [])
    .filter((a) => a && a.sala === sala)
    .map((a) => {
      const ind = indicadorDeAgente({ estado: estadoDoRetrato(retrato ? retrato[a.id] : null), ligado });
      return { id: a.id, nome: a.nome || a.name || a.id, estado: ind.chave, activo: ind.activo, cor: ind.cor, rotulo: ind.rotulo };
    })
    .sort((a, b) => Number(b.activo) - Number(a.activo) || a.nome.localeCompare(b.nome));

  return { sala, nome, cor, estado, contagens: estado.contagens, tarefas: lista, pessoas, ligado, agora };
}

/* ---------- o painel contextual na gaveta da sala (3D) ---------- */

const ROTULO_TAREFA = {
  'a-correr': 'a correr', espera: 'à espera do teu OK', 'na-fila': 'na fila',
  feita: 'concluída', falhou: 'falhou', cancelada: 'cancelada', outra: 'registada',
};

/** O bloco que abre com a sala: estado, o que lá está, quem lá está. */
export function panoramaHTML(p) {
  if (!p) return '';
  const c = p.contagens || {};
  const conta = [
    c.aCorrer ? plural(c.aCorrer, 'a correr', 'a correr') : '',
    c.porAprovar ? plural(c.porAprovar, 'à espera de ti', 'à espera de ti') : '',
    c.falhadas ? plural(c.falhadas, 'falhada', 'falhadas') : '',
    c.concluidas ? plural(c.concluidas, 'feita', 'feitas') : '',
  ].filter(Boolean).join(' · ') || 'sem tarefas registadas';

  const linhas = p.tarefas.length
    ? p.tarefas.map((t) => `
      <li class="pra-row" data-estado="${esc(t.estado)}">
        <span class="pra-dot"></span>
        <span class="pra-t"><b>${esc(t.titulo)}</b><em>${esc(ROTULO_TAREFA[t.estado] || t.estado)}${t.idade ? ` · há ${esc(t.idade)}` : ''}${t.agente ? ` · ${esc(t.agente)}` : ''}</em></span>
        ${t.aprovavel ? `<span class="pra-a"><button type="button" data-of="aprovar" data-agente="${esc(t.agente)}" title="aprovar: regista a decisão na base de dados">Aprovar</button><button type="button" data-of="rejeitar" data-agente="${esc(t.agente)}" title="rejeitar: a tarefa volta atrás">Rejeitar</button></span>` : ''}
      </li>`).join('')
    : `<li class="pra-vazio">Nada registado nesta sala${p.ligado ? '' : ' — e sem ligação ao servidor não se afirma mais do que isto'}.</li>`;

  const gente = p.pessoas.length
    ? p.pessoas.map((a) => `<span class="pra-p" data-estado="${esc(a.estado)}" title="${esc(a.nome)} — ${esc(a.rotulo)}"><i style="background:${esc(a.cor)}"></i>${esc(a.nome.split(' ')[0])}</span>`).join('')
    : '<span class="pra-pra-vazio">sem agentes nesta sala</span>';

  return `
  <div class="pra" data-sala="${esc(p.sala)}" data-state="${esc(p.estado.chave)}" style="--sala:${esc(p.cor)};--estado:${esc(p.estado.cor)}">
    <div class="pra-top">
      <span class="pra-state"><i></i>${esc(p.estado.rotulo)}</span>
      <span class="pra-n">${esc(conta)}${p.estado.ultimaIdade ? ` · última há ${esc(p.estado.ultimaIdade)}` : ''}</span>
    </div>
    <p class="pra-frase">${esc(p.estado.detalhe)}</p>
    <ul class="pra-list">${linhas}</ul>
    <div class="pra-people">${gente}</div>
    <div class="pra-acts">
      <button type="button" data-of="abrir-2d" data-sala="${esc(p.sala)}">Ver esta sala em 2D</button>
      <button type="button" data-of="abrir-tarefas" data-sala="${esc(p.sala)}">Tarefas da sala</button>
    </div>
  </div>`;
}

/* ---------- a vista 2D (trabalho intensivo, sem WebGL) ---------- */

/**
 * Junta as seis salas, o Cérebro e a ligação num só retrato — o que a planta 2D
 * desenha. Nada aqui toca no DOM: é a mesma conta que a cena podia usar.
 */
export function construirPlanta({
  salas = [], tarefas = [], agentes = [], retrato = {}, ligado = true, brain = null, agora = Date.now(),
} = {}) {
  const lista = (Array.isArray(salas) ? salas : [])
    .filter((s) => s && s.chave)
    .map((s) => panoramaDaSala({ sala: s.chave, nome: s.nome, cor: s.cor, tarefas, agentes, retrato, ligado, agora }));

  const normais = (Array.isArray(tarefas) ? tarefas : [])
    .map((t) => (t && t.estado ? t : normalizarTarefa(t)))
    .filter(Boolean);

  const resumo = {
    salas: lista.length,
    aCorrer: lista.reduce((n, p) => n + (p.contagens.aCorrer || 0), 0),
    aEspera: lista.reduce((n, p) => n + (p.contagens.porAprovar || 0), 0),
    falhadas: lista.reduce((n, p) => n + (p.contagens.falhadas || 0), 0),
    tarefas: normais.length,
    agentes: (Array.isArray(agentes) ? agentes : []).filter(Boolean).length,
    activos: lista.reduce((n, p) => n + p.pessoas.filter((a) => a.activo).length, 0),
  };
  resumo.frase = resumo.salas === 0
    ? 'sem salas para mostrar'
    : `${plural(resumo.aCorrer, 'tarefa a correr', 'tarefas a correr')} · ${plural(resumo.aEspera, 'decisão à tua espera', 'decisões à tua espera')} · ${plural(resumo.falhadas, 'falhada', 'falhadas')}`;

  const cerebro = {
    notas: Number(brain && brain.notas) || 0,
    ligacoes: Number(brain && brain.ligacoes) || 0,
    resumo: (brain && brain.resumo) || null,
  };
  return { salas: lista, brain: cerebro, ligado, resumo, agora };
}

const PONTOS = (p) => p.pessoas.slice(0, 14).map((a) =>
  `<i class="pl-pt" data-state="${esc(a.estado)}" style="--pt:${esc(a.cor)}" title="${esc(a.nome)} — ${esc(a.rotulo)}"></i>`).join('')
  + (p.pessoas.length > 14 ? `<i class="pl-pt mais" title="mais ${p.pessoas.length - 14} nesta sala">+${p.pessoas.length - 14}</i>` : '');

/** A planta inteira, em HTML. `seleccionada` é a sala abertas no painel do lado. */
export function plantaHTML(planta, { seleccionada = null } = {}) {
  if (!planta) return '';
  const sel = planta.salas.find((s) => s.sala === seleccionada) || null;
  const salas = planta.salas.map((p) => `
    <button type="button" class="pl-sala" data-of="sala" data-sala="${esc(p.sala)}" data-state="${esc(p.estado.chave)}"
      aria-pressed="${p.sala === (sel && sel.sala) ? 'true' : 'false'}"
      style="--sala:${esc(p.cor)};--estado:${esc(p.estado.cor)}"
      title="${esc(p.nome)} — ${esc(p.estado.rotulo)}. ${esc(p.estado.detalhe)}">
      <span class="pl-nome"><i></i>${esc(p.nome)}</span>
      <span class="pl-est">${esc(p.estado.rotulo)}</span>
      <span class="pl-nums">
        <b>${p.contagens.aCorrer || 0}</b> a correr
        <b>${p.contagens.porAprovar || 0}</b> à espera
        <b>${p.contagens.falhadas || 0}</b> falhadas
      </span>
      <span class="pl-pts">${PONTOS(p)}</span>
      <span class="pl-ult">${p.estado.ultimaIdade ? `há ${esc(p.estado.ultimaIdade)}` : 'sem atividade registada'}</span>
    </button>`).join('');

  const detalhe = sel
    ? panoramaHTML(sel).replace('data-of="abrir-2d"', 'data-of="abrir-3d"')
    : `<div class="pl-hint"><b>Escolhe uma sala</b><span>Cada sala mostra o estado real: o que está a correr, o que espera por ti e o que falhou. Setas para andar, Enter para abrir, Esc para sair.</span></div>`;

  return `
  <div class="pl-head">
    <div class="pl-title"><b>Planta do escritório</b><span>vista 2D · sem animação, para trabalho intensivo</span></div>
    <span class="pl-lig" data-lig="${planta.ligado ? 'live' : 'off'}">${planta.ligado ? 'ligado ao servidor' : 'sem ligação ao vivo'}</span>
    <button type="button" class="pl-x" data-of="fechar" aria-label="fechar a planta e voltar ao escritório 3D" title="fechar (Esc)">✕</button>
  </div>
  <div class="pl-body">
    <div class="pl-grid" role="group" aria-label="as seis salas">
      ${salas}
      <div class="pl-centro" aria-label="o Cérebro">
        <b>O Cérebro</b>
        <span>${planta.brain.notas.toLocaleString('pt-PT')} notas · ${planta.brain.ligacoes.toLocaleString('pt-PT')} ligações</span>
        <em>${esc((planta.brain.resumo && planta.brain.resumo.curto) || 'rede por construir')}</em>
      </div>
    </div>
    <aside class="pl-detail" aria-live="polite">${detalhe}</aside>
  </div>
  <div class="pl-foot">${esc(planta.resumo.frase)} <span>· ${planta.resumo.tarefas} tarefas · ${planta.resumo.activos} agentes com sinal</span></div>`;
}

/* ---------- a planta viva ---------- */

/**
 * Monta a planta e liga-a ao escritório. Recebe `getDados()` (que devolve o
 * mesmo retrato que a cena usa) e as acções reais. Sem `getDados`, a planta
 * abre vazia e di-lo — não inventa salas.
 */
export function initOficina({
  doc = globalThis.document,
  getDados = () => ({}),
  onAbrirSala = null,   // abrir a sala no 3D (câmara + gaveta)
  onAbrirTarefas = null, // abrir o quadro de tarefas filtrado por sala
  onAgente = null,       // abrir a conversa com um agente
  onAprovar = null,
  onRejeitar = null,
  onFechar = null,
} = {}) {
  if (!doc) throw new Error('initOficina: sem document');
  const body = doc.body;
  let ov = doc.getElementById('planta');
  if (!ov) {
    ov = doc.createElement('div');
    ov.id = 'planta';
    ov.className = 'planta';
    ov.hidden = true;
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'false');
    ov.setAttribute('aria-label', 'planta do escritório — vista 2D');
    body.appendChild(ov);
  }
  let aberta = false, seleccionada = null, antesDoFoco = null;

  function dados() {
    try { return getDados() || {}; } catch { return {}; }
  }
  function retrato() {
    const d = dados();
    return construirPlanta({
      salas: d.salas || [], tarefas: d.tarefas || [], agentes: d.agentes || [],
      retrato: d.retrato || {}, ligado: d.ligado !== false,
      brain: d.brain || null, agora: d.agora || Date.now(),
    });
  }
  function desenhar() {
    const p = retrato();
    if (!seleccionada && p.salas.length) seleccionada = p.salas[0].sala;
    if (seleccionada && !p.salas.some((s) => s.sala === seleccionada)) seleccionada = p.salas[0] ? p.salas[0].sala : null;
    ov.innerHTML = plantaHTML(p, { seleccionada });
    ov.querySelectorAll('.pl-sala').forEach((b) => b.addEventListener('keydown', tecla));
    return p;
  }
  function actualizar() { if (aberta) desenhar(); }

  function abrir(sala = null) {
    if (sala) seleccionada = sala;
    antesDoFoco = doc.activeElement;
    aberta = true;
    ov.hidden = false;
    doc.body.classList.add('plantaAberta');
    desenhar();
    const alvo = ov.querySelector('.pl-sala[aria-pressed="true"]') || ov.querySelector('.pl-sala');
    if (alvo && alvo.focus) { try { alvo.focus({ preventScroll: true }); } catch { alvo.focus(); } }
  }
  function fechar() {
    if (!aberta) return;
    aberta = false;
    ov.hidden = true;
    ov.innerHTML = '';
    doc.body.classList.remove('plantaAberta');
    if (antesDoFoco && antesDoFoco.focus) { try { antesDoFoco.focus({ preventScroll: true }); } catch { /* sem foco */ } }
    antesDoFoco = null;
    if (onFechar) onFechar();
  }
  function alternar(sala = null) { aberta ? fechar() : abrir(sala); }

  function seleccionar(sala) {
    if (!sala) return;
    seleccionada = sala;
    desenhar();
    const alvo = ov.querySelector(`.pl-sala[data-sala="${sala}"]`);
    if (alvo && alvo.focus) { try { alvo.focus({ preventScroll: true }); } catch { /* sem foco */ } }
  }

  /* Setas andam pela grelha (três colunas, como a planta); Enter abre o que está
     escolhido. É o que se espera de uma vista «para trabalho intensivo». */
  function tecla(e) {
    if (!aberta) return;
    const actual = e.target.closest && e.target.closest('.pl-sala');
    const salas = [...ov.querySelectorAll('.pl-sala')].map((b) => b.dataset.sala);
    const i = actual ? salas.indexOf(actual.dataset.sala) : -1;
    const ir = (n) => { const t = salas[(n + salas.length) % salas.length]; if (t) { e.preventDefault(); e.stopPropagation(); seleccionar(t); } };
    /* a tecla é da planta: não deixa o escritório por trás reagir à mesma seta */
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fechar(); }
    else if (e.key === 'ArrowRight') ir(i + 1);
    else if (e.key === 'ArrowLeft') ir(i - 1);
    else if (e.key === 'ArrowDown') ir(i + 3);
    else if (e.key === 'ArrowUp') ir(i - 3);
    else if (e.key === 'Enter' && actual) { e.preventDefault(); e.stopPropagation(); clicar({ of: 'abrir-3d', sala: actual.dataset.sala }); }
  }

  function clicar(alvo) {
    const of = alvo.of || '';
    if (of === 'fechar') return fechar();
    if (of === 'sala') return seleccionar(alvo.sala);
    if (of === 'abrir-3d') { fechar(); if (onAbrirSala) onAbrirSala(alvo.sala); return; }
    if (of === 'abrir-sala') { if (onAbrirSala) onAbrirSala(alvo.sala); return; }
    if (of === 'abrir-tarefas') { if (onAbrirTarefas) onAbrirTarefas(alvo.sala); return; }
    if (of === 'aprovar' || of === 'rejeitar') {
      const fn = of === 'aprovar' ? onAprovar : onRejeitar;
      if (fn && alvo.agente) fn(alvo.agente);
      setTimeout(actualizar, 40);
      return;
    }
    if (of === 'agente' && onAgente && alvo.agente) onAgente(alvo.agente);
  }

  ov.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-of]');
    if (!b) return;
    e.preventDefault();
    clicar({ of: b.dataset.of, sala: b.dataset.sala || null, agente: b.dataset.agente || null });
  });
  ov.addEventListener('keydown', tecla);

  return { abrir, fechar, alternar, actualizar, seleccionar, estaAberto: () => aberta, salaEscolhida: () => seleccionada, dados: retrato };
}
