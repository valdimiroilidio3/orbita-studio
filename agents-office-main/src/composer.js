// Órbita — O CONVERSADOR (27 out 2026).
//
// O dono mandou um componente React/Tailwind (`ai-prompt-composer-with-model-selector.tsx`) e
// pediu que substituísse o campo de uma linha que aqui estava. O Órbita é um único HTML, sem CDN
// e sem React: em vez de trazer um runtime de 140 kB e um passo de Tailwind para dentro de um
// bundle que tem de abrir offline, o DESENHO e o COMPORTAMENTO foram portados para aqui — o mesmo
// cartão, as mesmas peças (modos, modelo com provedor e esforço, + Ficheiros, @ Contexto, ditar,
// seta), a mesma calma.
//
// O que NÃO foi copiado, de propósito:
//   · o banner «Upgrade to Pro» e os planos/modal de marketing — o Órbita não vende planos, e um
//     preço inventado seria dado de demonstração (pedido 19). O mesmo lugar do cartão passa a ser
//     ocupado por um aviso REAL: quando não há motor de IA ligado, o compositor diz isso e abre o
//     estado do motor. Quando há motor, o aviso não aparece.
//   · os modelos de exemplo (kimi-k3, gpt-56-terra…) — a lista vem de /api/health: Sonnet, Opus e
//     Fable, que são os que o servidor sabe correr. Se o servidor não responder, a lista fica vazia
//     e o botão diz «sem motor».
//   · o `@terminal` do popover de contexto — não há terminal ligado ao agente, por isso a linha
//     aparece desactivada com a razão, em vez de fingir que existe.
//
// Tudo o que o compositor envia volta na resposta do servidor (`model`, `effort`, `mode`,
// `context`, `files`) e é mostrado por baixo da resposta: o que se lê é o que correu.

import { PAR_SEP, parDeModelo, chaveDoPar } from './lista-modelos.js';

export const MODES = [
  { key: 'plan', name: 'Planear', title: 'Planear: o agente devolve um plano e não executa nada (sem ferramentas)' },
  { key: 'ask', name: 'Perguntar', title: 'Perguntar: conversa, com as notas da empresa' },
  { key: 'build', name: 'Construir', title: 'Construir: cria a tarefa no quadro e o servidor corre-a' },
];
export const MODE_KEYS = MODES.map(m => m.key);
export const EFFORT_LABEL = { '': 'Auto', low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };
export const FILES_MAX = 5, FILE_MAX_CHARS = 40000, FILES_BUDGET = 60000;
export const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|log|yml|yaml|js|mjs|cjs|jsx|ts|tsx|css|scss|html?|xml|sql|py|rb|go|rs|sh|toml|ini|env|diff|patch)$/i;
export const PREFS_KEY = 'orbita_composer_v1';

export const modeInfo = k => MODES.find(m => m.key === k) || MODES[1];
export const effortLabel = k => EFFORT_LABEL[String(k ?? '')] || 'Auto';
export const isTextName = name => TEXT_EXT.test(String(name || ''));

/** Porque é que este ficheiro não entra (null = entra). Uma recusa é dita, nunca ignorada em silêncio. */
export function fileProblem(file) {
  if (!file) return 'ficheiro vazio';
  const name = String(file.name || '');
  if (!isTextName(name)) return `${name || 'este ficheiro'}: só texto (txt, md, csv, json, código). Imagens e PDF não são lidos`;
  if (Number(file.size) > FILE_MAX_CHARS * 6) return `${name}: grande demais (${Math.round(Number(file.size) / 1024)} kB, o limite é ~${Math.round(FILE_MAX_CHARS / 1024)} kB)`;
  return null;
}

/** Junta o que já está anexado com o que chega agora, dentro dos limites do servidor. */
export function packFiles(current, incoming) {
  const list = [...(current || [])];
  const rejected = [];
  for (const f of incoming || []) {
    const why = fileProblem(f);
    if (why) { rejected.push(why); continue; }
    if (list.length >= FILES_MAX) { rejected.push(`${f.name}: o máximo são ${FILES_MAX} ficheiros por mensagem`); continue; }
    if (list.some(x => x.name === f.name && x.size === f.size)) continue;
    list.push(f);
  }
  let budget = FILES_BUDGET;
  const kept = list.filter(f => {
    const t = String(f.text ?? '');
    if (budget <= 0) { rejected.push(`${f.name}: a mensagem já leva ${Math.round(FILES_BUDGET / 1024)} kB de anexos`); return false; }
    budget -= Math.min(t.length, FILE_MAX_CHARS);
    return true;
  });
  return { files: kept, rejected };
}

/* ---------------------------------------------------------------- a IA da Órbita (1.51.0)
   14 out 2026: o compositor mostrava Sonnet/Opus/Fable porque esses eram os modelos
   que o servidor local sabia correr. Na página publicada não há servidor local — e a
   lista ficava vazia, com o botão a dizer «sem motor». A IA da Órbita existe nessa
   mesma página (a mesa fala com ela por /api/rpc); o que faltava era o compositor
   saber perguntar-lhe o catálogo. Passa a saber, e a escolha é um par
   fornecedor|modelo — o mesmo que POST /ia/chat valida. */
/* 1.52.0 · a regra do par vive num sítio só (`src/lista-modelos.js`): o painel de
   tarefas passou a usar a mesma escolha, e duas implementações divergiriam. */
export const IA_SEP = PAR_SEP;

/** O nome com que a escolha fica guardada: `openrouter|qwen/qwen3-coder:free`. */
export const chaveDeModelo = (fornecedor, modelo) => chaveDoPar(fornecedor, modelo);

/** Separa a escolha. `null` quer dizer «não é um par da Órbita» (um nome do CLI). */
export const dividirModelo = (chave) => parDeModelo(chave);

/** As linhas do menú a partir do que `GET /ia/modelos` devolveu.
    Só entram modelos de fornecedores que podem responder (chave + não desligados);
    o resto é contado e dito, em vez de aparecer para falhar depois. */
export function modelosDoCatalogo(corpo, estado = {}) {
  const fora = new Map(((estado && estado.fornecedores) || []).map(f => [f && f.id, f]));
  const modelos = [];
  let semChave = 0, desligados = 0;
  for (const f of (corpo && corpo.fornecedores) || []) {
    if (!f || !f.id) continue;
    const st = fora.get(f.id) || {};
    const desligado = f.desligado === true || st.desligado === true;
    const temChave = f.comChave === true || st.configurado === true || st.comChaveAgora === true;
    if (!temChave || desligado) {
      if (desligado) desligados += 1; else semChave += 1;
      continue;
    }
    const vistos = new Set();
    for (const x of f.catalogo || []) {
      const modelo = typeof x === 'string' ? x : (x && x.modelo);
      if (!modelo || vistos.has(modelo)) continue;
      vistos.add(modelo);
      modelos.push({
        key: chaveDeModelo(f.id, modelo),
        model: modelo,
        name: modelo,
        provider: f.nome || f.id,
        badge: String(f.nome || f.id).charAt(0).toUpperCase(),
        gratis: !!(x && typeof x === 'object' ? x.gratuito : f.gratuito),
        testado: st.testado === true && !!(st.ultimoTeste && st.ultimoTeste.ok),
      });
    }
  }
  // quem já respondeu a um pedido real primeiro; depois os gratuitos
  modelos.sort((a, b) => (Number(b.testado) - Number(a.testado)) || (Number(b.gratis) - Number(a.gratis)) || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
  return {
    modelos,
    semChave,
    desligados,
    esforcos: Array.isArray(corpo && corpo.esforcos) ? corpo.esforcos.filter(k => typeof k === 'string') : [],
    nota: (corpo && corpo.esforcoNota) || '',
  };
}

/** Que agente da IA da Órbita responde por um agente do escritório.
    O escritório tem 35 postos com nomes de gente; a IA da Órbita tem 8 papéis.
    Sem esta ponte, todos caíam no `research` — o «automático» que o dono estranhou. */
const POR_DEPT = { emails: 'orchestrator', sales: 'research', ops: 'research', fin: 'design', delivery: 'backend', marketing: 'creative' };
const POR_POSTO = {
  qa: 'qa', crep: 'frontend', cass: 'backend', apay: 'backend', dlead: 'orchestrator', pco: 'orchestrator',
  gfx: 'design', dasst: 'design', alead: 'design', inv: 'design', invoo: 'design',
  newt: 'creative', ada: 'creative', iggy: 'creative', vid: 'creative', lexi: 'creative', recon: 'creative', mlead: 'creative',
  legal: 'reviewer', comply: 'reviewer', report: 'reviewer',
  elead: 'orchestrator', imail: 'orchestrator', olead: 'research', pros: 'research',
};
export function agenteDaOrbita(agente = {}) {
  const posto = String(agente.id || agente.key || '');
  if (POR_POSTO[posto]) return POR_POSTO[posto];
  return POR_DEPT[String(agente.dept || '')] || 'research';
}

/* ---------------------------------------------------------------- a conversa pela Órbita
   O mesmo contrato da mesa (POST /ia/chat), mas dentro do envelope /api/rpc que é
   o único caminho que existe na página publicada. Estas três funções são puras
   para o teste poder discuti-las: o que se pede, o que se lê, e o que cabe. */
export const ROTA_CHAT_ORBITA = '/ia/chat';

export function corpoDaOrbita({ agente = 'research', mensagem = '', historico = [], par = null, esforco = '' } = {}) {
  return {
    caminho: ROTA_CHAT_ORBITA,
    metodo: 'POST',
    corpo: {
      agente,
      mensagem: String(mensagem || ''),
      historico: (historico || []).slice(-8),
      /* sem par = auto: o router da Órbita decide; com par = vai àquele fornecedor */
      ...(par ? { fornecedor: par.fornecedor, modelo: par.modelo } : {}),
      ...(esforco ? { esforco } : {}),
    },
  };
}

/** Lê o envelope {status, corpo} (ou o corpo solto) e devolve o que a conversa mostra. */
export function lerRespostaOrbita(env, par = null) {
  const corpo = env && typeof env === 'object' && 'corpo' in env ? (env.corpo || {}) : (env || {});
  const status = Number((env && env.status) ?? 200);
  if (status >= 400 || !corpo || !corpo.resposta) {
    return { ok: false, erro: (corpo && corpo.error) || 'a IA da Órbita não devolveu resposta' };
  }
  const quem = [corpo.fornecedor || (par && par.fornecedor) || 'IA da Órbita', corpo.modelo || (par && par.modelo)]
    .filter(Boolean).join(' · ');
  const extras = [];
  if (corpo.esforco && corpo.esforco.maxTokens) extras.push(`tecto ${corpo.esforco.maxTokens} tokens`);
  if (corpo.ms) extras.push(`${Math.round(Number(corpo.ms) / 100) / 10} s`);
  if (Array.isArray(corpo.ferramentas) && corpo.ferramentas.length) extras.push(`${corpo.ferramentas.length} ferramenta(s)`);
  return { ok: true, texto: String(corpo.resposta), meta: [quem, ...extras].join(' · '), corpo };
}

/** Os anexos entram no texto da mensagem: a rota leva uma mensagem só. O que não
    couber é contado — não desaparece em silêncio. */
export function juntarAnexos(texto, files = [], limite = 7800) {
  let mensagem = String(texto || '');
  let cortados = 0;
  for (const f of files || []) {
    const bloco = `\n\n--- ${f.name} ---\n${String(f.text || '')}`;
    if (mensagem.length + bloco.length > limite) { cortados += 1; continue; }
    mensagem += bloco;
  }
  return { mensagem, cortados };
}

/** As escolhas de @contexto, com os números que o servidor declarou. `terminal` não existe: é dito. */
export function contextChoices(health) {
  const notes = Number(health?.context?.notes ?? health?.notes ?? 0);
  const docs = Number(health?.context?.docs ?? 0);
  return [
    { key: 'brain', label: 'Cérebro', what: 'as notas da empresa', count: notes, unit: notes === 1 ? 'nota' : 'notas', disabled: !notes, why: notes ? '' : 'o Cérebro ainda não tem notas para ler' },
    { key: 'docs', label: 'Documentos', what: 'os markdown de docs/', count: docs, unit: docs === 1 ? 'documento' : 'documentos', disabled: !docs, why: docs ? '' : 'não há documentos markdown em docs/' },
    { key: 'terminal', label: 'Terminal', what: 'a linha de comandos do posto', count: null, unit: '', disabled: true, why: 'não há terminal ligado ao agente' },
  ];
}

/** O corpo que vai para POST /api/chat. Um sítio só, para o teste poder discuti-lo. */
export function chatBody({ text, mode = 'ask', model = '', effort = '', auto = true, files = [], context = null, history = [] } = {}) {
  return {
    text: String(text || ''),
    mode: MODE_KEYS.includes(mode) ? mode : 'ask',
    model: auto ? undefined : (model || undefined),
    effort: auto ? undefined : (effort || undefined),
    auto: auto !== false,
    files: (files || []).map(f => ({ name: f.name, text: String(f.text ?? '').slice(0, FILE_MAX_CHARS) })),
    context: (context || null) && context.length ? context : undefined,
    history: (history || []).slice(-8),
  };
}

/** Um rótulo honesto para o que correu: modelo · esforço · modo · anexos/contexto. */
export function metaLine(r = {}, sent = {}) {
  const bits = [];
  if (r.modelName || sent.model) bits.push(r.modelName || sent.model);
  if (r.effortName || r.effort) bits.push('esforço ' + String(r.effortName || effortLabel(r.effort)).toLowerCase());
  else bits.push('esforço auto');
  if ((r.mode || sent.mode) === 'plan') bits.push('plano');
  if (sent.files?.length) bits.push(sent.files.length + (sent.files.length === 1 ? ' ficheiro' : ' ficheiros'));
  if (sent.context?.length) bits.push(sent.context.map(k => '@' + (contextLabel(k))).join(' · '));
  return bits.join(' · ');
}
const contextLabel = k => ({ brain: 'Cérebro', docs: 'Documentos' }[k] || k);

export function loadPrefs(storage) {
  const base = { mode: 'ask', model: '', effort: '', auto: true, favs: [], tour: false, tab: 'all' };
  try {
    const raw = storage?.getItem(PREFS_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw);
    return {
      mode: MODE_KEYS.includes(p.mode) ? p.mode : 'ask',
      model: typeof p.model === 'string' ? p.model : '',
      effort: typeof p.effort === 'string' ? p.effort : '',
      auto: p.auto !== false,
      favs: Array.isArray(p.favs) ? p.favs.filter(x => typeof x === 'string').slice(0, 12) : [],
      tour: p.tour === true,
    };
  } catch { return base; }
}
export function savePrefs(storage, prefs) {
  try { storage?.setItem(PREFS_KEY, JSON.stringify({ mode: prefs.mode, model: prefs.model, effort: prefs.effort, auto: prefs.auto, favs: prefs.favs, tour: prefs.tour })); } catch { /* sem armazenamento: só não persiste */ }
}

/* ------------------------------------------------------------------ a parte que toca no DOM */

const SVG = {
  chev: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3 3 3-3"/></svg>',
  star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6z"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  at: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.6"/><path d="M10.6 8v1.2a1.8 1.8 0 003.4-.8V8a6 6 0 10-2.4 4.8"/></svg>',
  mic: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="6.1" y="2.2" width="3.8" height="7.2" rx="1.9"/><path d="M4 7.6v.6a4 4 0 008 0v-.6M8 12.2v1.6"/></svg>',
  x: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
};

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function initComposer({ onSubmit, onHealth = null, storage = (typeof localStorage !== 'undefined' ? localStorage : null), doc = document } = {}) {
  const $ = id => doc.getElementById(id);
  const el = {
    card: $('mc'), modes: $('mcModes'), model: $('mcModel'), badge: $('mcBadge'), name: $('mcMName'), eff: $('mcEff'),
    menu: $('mcMenu'), auto: $('mcAuto'), autoNote: $('mcAutoNote'), tabs: $('mcTabs'), list: $('mcList'),
    effortBox: $('mcEffort'), engineNote: $('mcEngineNote'), input: $('mIn'), chips: $('mcChips'), add: $('mcAdd'), file: $('mcFile'),
    ctx: $('mcCtx'), ctxMenu: $('mcCtxMenu'), mic: $('mcMic'), send: $('mSend'),
    pro: $('mcPro'), proBtn: $('mcProBtn'), tour: $('mcTour'), tourPanel: $('mcTourPanel'),
    modal: $('mcModal'), sheet: $('mcSheet'), toast: $('mcToast'),
  };
  if (!el.card || !el.input || !el.send) return null; // página antiga: não há compositor para ligar

  const prefs = loadPrefs(storage);
  const state = { mode: prefs.mode, model: prefs.model, effort: prefs.effort, auto: prefs.auto, favs: prefs.favs, tab: 'all', files: [], ctx: [], health: null, busy: false, mic: null,
    catalogo: null, catalogoErro: '', catalogoPedido: false }; // 1.51.0 · a IA da Órbita
  const save = () => savePrefs(storage, state);

  /* ---------------------------------------------------------------- avisos (toasts) */
  let toastTimer = 0;
  function toast(msg, kind = '') {
    if (!el.toast) return;
    el.toast.textContent = msg;
    el.toast.dataset.k = kind;
    el.toast.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('on'), kind === 'err' ? 7000 : 4200);
  }

  /* ---------------------------------------------------------------- saúde do servidor */
  function setHealth(h, porque = '') {
    state.health = h || null;
    /* 29 out 2026 (lançamento): há DUAS razões para não haver motor, e diziam a mesma frase. Sem
       servidor nenhum (a vista publicada, aberta em estático) o problema não é a chave da IA — é não
       haver Órbita a correr. A frase passa a dizer qual das duas é. */
    state.semServidor = !h && porque === 'sem-servidor';
    /* uma escolha da Órbita (fornecedor|modelo) não se apaga por o CLI ter outros nomes */
    if (state.model && !dividirModelo(state.model) && h && Array.isArray(h.models) && !h.models.includes(state.model)) state.model = '';
    if (!state.favs.length && h && h.model) state.favs = [h.model];
    renderModelButton(); renderList(); renderEfforts(); renderContextMenu();
    renderAviso(); // 1.51.0 · o aviso também depende da IA da Órbita, que chega depois
    if (onHealth) onHealth(h);
  }
  /* ---------------------------------------------------------------- o catálogo da IA da Órbita
     Uma leitura por sessão (e outra quando o menú abre sem lista). Em produção o caminho
     directo `/api/ia/modelos` não existe — a mesa fala por `/api/rpc`, com o envelope
     {status, corpo}. Aqui faz-se o mesmo, e a falha é guardada para ser dita. */
  async function lerIa(caminho) {
    const r = await fetch('/api/rpc?caminho=' + encodeURIComponent(caminho), { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (j && typeof j === 'object' && 'status' in j) {
      if (j.status >= 400) throw new Error((j.corpo && j.corpo.error) || ('HTTP ' + j.status));
      return j.corpo;
    }
    return j;
  }
  async function refreshCatalogo() {
    if (state.catalogoPedido) return state.catalogo;
    state.catalogoPedido = true;
    try {
      const [modelos, estado] = await Promise.all([
        lerIa('/ia/modelos'),
        lerIa('/ia/estado').catch(() => null), // sem o estado mostra-se a lista toda; não inventa nada
      ]);
      state.catalogo = modelosDoCatalogo(modelos, estado || {});
      state.catalogoErro = '';
    } catch (e) {
      state.catalogo = null;
      state.catalogoErro = e && e.message ? e.message : 'sem resposta';
    }
    renderModelButton(); renderList(); renderEfforts(); renderAviso();
    return state.catalogo;
  }

  /* O aviso do cartão. Três estados, três frases: (1) há motor aqui, (2) não há
     motor local mas a IA da Órbita responde por /api/rpc, (3) não há motor nenhum.
     1.51.0 · antes, (2) era contado como (3) — «Vista publicada, aqui não há motor
     de IA» — quando a IA estava ali, a responder, a um pedido de distância. */
  function renderAviso() {
    if (!el.pro) return;
    const h = state.health;
    const engine = h?.ai || null;
    const orbita = (state.catalogo?.modelos || []).length;
    /* Enquanto não se sabe (nem saúde nem catálogo chegaram), o aviso NÃO aparece:
       no instante antes das respostas mostrava «Sem motor de IA ligado» — a frase
       que o dono apontou — quando a IA estava a responder. Só se decide depois. */
    const decido = state.health !== null || state.catalogo !== null;
    el.pro.hidden = !decido || !!engine || orbita > 0;
    const t = el.pro.querySelector('.mc-pro-t');
    if (!t) return;
    t.textContent = state.semServidor
      ? 'Vista publicada — aqui não há motor local. A mesa de trabalho (Mesa, na barra) funciona já neste browser: escreve um lead, um projeto ou uma entrada de dinheiro e fica guardado no teu aparelho.'
      : 'Sem motor de IA ligado — este posto não inventa uma resposta. Vê o que falta.';
  }

  async function refreshHealth() {
    try {
      const r = await fetch('/api/health', { headers: { accept: 'application/json' } });
      // 404 num sítio estático significa «não há API aqui», e não «a API está avariada»
      if (r.status === 404) { setHealth(null, 'sem-servidor'); return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setHealth(await r.json());
    } catch (e) {
      // «sem-servidor» é diferente de «o servidor respondeu 503»: o primeiro é estático, o segundo
      // é um Órbita de pé a dizer que não tem motor. Só o primeiro muda a frase do aviso.
      const rede = !!(e && (e.name === 'TypeError' || /fetch|network|load failed/i.test(e.message || '')));
      setHealth(null, rede ? 'sem-servidor' : (e && e.message));
    }
    /* 1.51.0 · haja ou não servidor local, a IA da Órbita pode estar ali: pergunta-se-lhe */
    refreshCatalogo();
  }

  /* ---------------------------------------------------------------- modos */
  if (el.modes && !el.modes.children.length) {
    el.modes.innerHTML = MODES.map(m => `<button type="button" data-mode="${m.key}" aria-pressed="false">${m.name}</button>`).join('');
  }
  function renderModes() {
    if (!el.modes) return;
    el.modes.querySelectorAll('button').forEach(b => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.title = modeInfo(b.dataset.mode).title;
    });
    el.card.dataset.mode = state.mode;
    el.input.placeholder = state.mode === 'build' ? 'Descreve a tarefa que o escritório deve correr…'
      : state.mode === 'plan' ? 'O que queres planear? O agente devolve um plano, não o trabalho.'
        : 'Escreve uma mensagem…';
  }
  el.modes?.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode; save(); renderModes(); el.input.focus();
  }));

  /* ---------------------------------------------------------------- modelo + esforço */
  const models = () => {
    const h = state.health;
    const doCli = h && Array.isArray(h.models) ? h.models.map(k => ({
      key: k,
      name: k === h.model ? (h.modelName || k) : k.charAt(0).toUpperCase() + k.slice(1),
      provider: 'Anthropic',
      badge: 'A',
      motor: 'cli',
      current: k === h.model,
    })) : [];
    /* os da Órbita vêm depois dos da casa: primeiro o que está debaixo dos pés */
    const daOrbita = (state.catalogo?.modelos || []).map(m => ({ ...m, motor: 'orbita' }));
    return [...doCli, ...daOrbita];
  };
  const rowDe = key => models().find(m => m.key === key) || null;
  function renderModelButton() {
    const h = state.health;
    const par = state.auto ? null : dividirModelo(state.model);
    const linha = par ? rowDe(state.model) : null;
    const m = state.auto ? (h?.model || '') : state.model;
    /* num par da Órbita o nome é o do modelo (o fornecedor vai no distintivo e por baixo) */
    const curto = par ? par.modelo.split('/').pop() : '';
    const name = par
      ? (curto.length > 22 ? curto.slice(0, 21) + '…' : curto)
      : m ? (m === h?.model ? (h.modelName || m) : m.charAt(0).toUpperCase() + m.slice(1))
        /* enquanto a lista da Órbita não chega, «auto»; «sem motor» só depois de a
           resposta dizer que não há nenhum (era o que o dono via, e era falso) */
        : (state.catalogo === null ? 'auto' : 'sem motor');
    if (el.name) el.name.textContent = name;
    if (el.badge) {
      el.badge.textContent = par ? (linha?.badge || '·') : m ? 'A' : (state.catalogo === null ? '·' : '—');
      el.badge.title = par ? (linha?.provider || par.fornecedor) : m ? 'Anthropic'
        : (state.catalogo?.modelos?.length ? 'IA da Órbita — a lista é a real' : 'sem motor ligado');
    }
    const eff = state.auto ? (h?.effort || '') : state.effort;
    if (el.eff) {
      const label = state.auto ? (eff ? effortLabel(eff) : '') : effortLabel(state.effort);
      el.eff.textContent = label;
      el.eff.hidden = !label; // no Auto sem esforço do escritório, a pílula fica só com o nome: numa coluna de 400 px cada carácter conta
    }
    if (el.model) {
      el.model.title = state.auto
        ? 'Auto: o escritório escolhe o modelo' + (h?.modelName ? ' (' + h.modelName + ')' : '')
        : 'Modelo escolhido nesta conversa';
      el.model.classList.toggle('auto', state.auto);
    }
    if (el.auto) {
      el.auto.setAttribute('aria-checked', String(state.auto));
      el.auto.classList.toggle('on', state.auto);
    }
    const engine = state.health?.ai || null;
    if (el.engineNote) {
      const why = engine && engine.kind === 'api'
        ? 'Este motor é uma API compatível: o esforço não é enviado e os três nomes da casa vão para o modelo que o fornecedor declarar. O modelo continua a ser real — o que não existe é o botão do esforço.'
        : '';
      el.engineNote.textContent = why;
      el.engineNote.hidden = !why;
    }
    if (el.autoNote) el.autoNote.textContent = state.auto
      ? (h?.modelName
        ? 'O escritório escolhe — ' + h.modelName + ' por omissão.'
        : (state.catalogo?.modelos || []).length
          ? 'O escritório escolhe — o router da Órbita decide entre os ' + state.catalogo.modelos.length + ' modelos que podem responder.'
          : 'O escritório escolhe.')
      : 'Escolhido por ti; o Auto fica desligado até voltares a ligá-lo.';
  }
  function renderList() {
    if (!el.list) return;
    const all = models();
    const rows = state.tab === 'fav' ? all.filter(m => state.favs.includes(m.key)) : all;
    if (!all.length) {
      /* 1.51.0 · três razões diferentes, três frases. «O servidor não respondeu» era
         dito mesmo quando o servidor respondia e não tinha modelos. */
      const cat = state.catalogo;
      const msg = state.catalogoErro
        ? `Sem lista de modelos: ${esc(state.catalogoErro)}. Nada aqui é inventado.`
        : cat
          ? `A IA da Órbita respondeu, mas nenhum fornecedor tem chave: ${cat.semChave} sem chave${cat.desligados ? `, ${cat.desligados} desligado(s)` : ''}. Liga uma chave no Control Center (Mesa → IA) e a lista aparece aqui.`
          : 'A pedir a lista de modelos à IA da Órbita…';
      el.list.innerHTML = `<p class="mc-empty">${msg}</p>`;
      return;
    }
    if (!rows.length) {
      el.list.innerHTML = '<p class="mc-empty">Ainda não há favoritos. A estrela de um modelo põe-no aqui.</p>';
      return;
    }
    el.list.innerHTML = rows.map(m => {
      const on = !state.auto && state.model === m.key;
      const fav = state.favs.includes(m.key);
      const sub = esc(m.provider) + (m.current ? ' · por omissão' : '') + (m.gratis ? ' · grátis' : '') + (m.testado ? ' · provado' : '');
      return `<div class="mc-row" role="menuitemradio" aria-checked="${on}" tabindex="-1" data-model="${esc(m.key)}">
        <span class="mc-badge" aria-hidden="true">${esc(m.badge || '·')}</span>
        <span class="mc-rmain"><span class="nm">${esc(m.name)}</span><span class="sub">${sub}</span></span>
        ${on ? `<span class="mc-tick" aria-hidden="true">${SVG.check}</span>` : ''}
        <button class="mc-star" type="button" aria-pressed="${fav}" aria-label="${fav ? 'tirar' : 'pôr'} ${esc(m.name)} nos favoritos" data-fav="${esc(m.key)}">${SVG.star}</button>
      </div>`;
    }).join('');
    /* o que ficou de fora é dito: um fornecedor sem chave não entra na lista para falhar */
    const cat = state.catalogo;
    if (cat && (cat.semChave || cat.desligados) && state.tab !== 'fav') {
      const foot = doc.createElement('p');
      foot.className = 'mc-empty';
      foot.textContent = `Fora da lista: ${cat.semChave} fornecedor(es) sem chave${cat.desligados ? ` e ${cat.desligados} desligado(s)` : ''}. A lista mostra só quem pode responder agora.`;
      el.list.appendChild(foot);
    }
    el.list.querySelectorAll('.mc-row').forEach(row => {
      row.addEventListener('click', () => { pickModel(row.dataset.model); });
      row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickModel(row.dataset.model); } });
    });
    el.list.querySelectorAll('.mc-star').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const k = b.dataset.fav;
      state.favs = state.favs.includes(k) ? state.favs.filter(x => x !== k) : [...state.favs, k];
      save(); renderList();
      toast(state.favs.includes(k) ? 'Nos favoritos.' : 'Fora dos favoritos.', 'ok');
    }));
  }
  function pickModel(key) {
    if (!key) return;
    state.model = key; state.auto = false; save(); renderModelButton(); renderList(); closeMenus(); el.input.focus();
  }
  function renderEfforts() {
    if (!el.effortBox) return;
    const doCli = Array.isArray(state.health?.efforts) ? state.health.efforts : [];
    /* os níveis da Órbita são reais: viram o tecto de tokens da resposta (api/_ia/rotas.mjs) */
    const efforts = doCli.length ? doCli : (state.catalogo?.esforcos || []);
    if (!efforts.length) {
      el.effortBox.innerHTML = '<span class="mc-empty">O servidor não declarou níveis de esforço.</span>';
      return;
    }
    if (!doCli.length && state.catalogo?.nota) el.effortBox.dataset.nota = state.catalogo.nota;
    el.effortBox.title = doCli.length ? '' : (state.catalogo?.nota || '');
    const keys = ['', ...efforts];
    el.effortBox.innerHTML = keys.map(k => `<button type="button" class="mc-effb${state.effort === k && !state.auto ? ' on' : ''}${k === '' ? ' auto' : ''}" data-eff="${esc(k)}" aria-pressed="${state.effort === k && !state.auto}">${esc(effortLabel(k))}</button>`).join('');
    el.effortBox.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      state.effort = b.dataset.eff;
      if (state.effort) state.auto = false;
      save(); renderModelButton(); renderEfforts();
    }));
  }
  el.model?.addEventListener('click', () => {
    const open = el.menu && !el.menu.hidden;
    closeMenus();
    if (open) return;
    if (!state.health) refreshHealth();
    else if (!state.catalogo && !state.catalogoErro) refreshCatalogo();
    el.menu.hidden = false;
    el.model.setAttribute('aria-expanded', 'true');
    el.card.classList.add('menuOpen'); // o foco fica no botão: quem usa teclado chega às linhas com Tab
  });
  el.auto?.addEventListener('click', () => {
    state.auto = !state.auto; save(); renderModelButton(); renderList(); renderEfforts();
    toast(state.auto ? 'Auto: o escritório escolhe o modelo.' : 'Modelo escolhido por ti.', 'ok');
  });
  el.tabs?.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    state.tab = b.dataset.tab === 'fav' ? 'fav' : 'all';
    el.tabs.querySelectorAll('button').forEach(x => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-selected', String(on));
    });
    renderList();
  }));

  /* ---------------------------------------------------------------- ficheiros */
  function renderChips() {
    if (!el.chips) return;
    const total = state.files.length + state.ctx.length;
    el.chips.hidden = !total;
    if (!total) { el.chips.innerHTML = ''; return; }
    el.chips.innerHTML =
      state.ctx.map(k => `<span class="mc-chip ctx"><span class="nm">@${esc(contextLabel(k))}</span><button class="x" type="button" data-ctx="${esc(k)}" aria-label="tirar o contexto ${esc(contextLabel(k))}">${SVG.x}</button></span>`).join('') +
      state.files.map((f, i) => `<span class="mc-chip"><span class="nm">${esc(f.name)}</span><span class="sz">${Math.max(1, Math.round((f.text || '').length / 1024 * 10) / 10)} kB</span><button class="x" type="button" data-file="${i}" aria-label="tirar ${esc(f.name)}">${SVG.x}</button></span>`).join('');
    el.chips.querySelectorAll('.x[data-file]').forEach(b => b.addEventListener('click', () => {
      state.files.splice(Number(b.dataset.file), 1); renderChips(); syncSend();
    }));
    el.chips.querySelectorAll('.x[data-ctx]').forEach(b => b.addEventListener('click', () => {
      state.ctx = state.ctx.filter(k => k !== b.dataset.ctx); renderChips(); syncSend();
    }));
  }
  el.add?.addEventListener('click', () => el.file?.click());
  el.file?.addEventListener('change', async () => {
    const picked = [...(el.file.files || [])];
    el.file.value = '';
    if (!picked.length) return;
    const read = [];
    for (const f of picked) {
      const why = fileProblem(f);
      if (why) { toast(why, 'err'); continue; }
      try {
        const text = await f.text();
        if (text.includes('\u0000')) { toast(`${f.name}: parece binário — só texto.`, 'err'); continue; }
        read.push({ name: f.name, size: f.size, text: text.slice(0, FILE_MAX_CHARS) });
      } catch (e) { toast(`${f.name}: não consegui ler (${e.message}).`, 'err'); }
    }
    const { files, rejected } = packFiles(state.files, read);
    state.files = files;
    for (const why of rejected) toast(why, 'err');
    if (read.length) toast(read.length === 1 ? 'Ficheiro anexado a esta mensagem.' : `${read.length} ficheiros anexados a esta mensagem.`, 'ok');
    renderChips(); syncSend();
  });

  /* ---------------------------------------------------------------- @ contexto */
  function renderContextMenu() {
    if (!el.ctxMenu) return;
    const choices = contextChoices(state.health);
    el.ctxMenu.innerHTML = choices.map(c => {
      const on = state.ctx.includes(c.key);
      const count = c.count === null ? '' : `<span class="sz">${c.count} ${esc(c.unit)}</span>`;
      return `<button class="mc-crow${on ? ' on' : ''}" type="button" role="menuitemcheckbox" aria-checked="${on}" data-ctx="${esc(c.key)}"${c.disabled ? ' disabled aria-disabled="true"' : ''}>
        <span class="mc-rmain"><span class="nm">@${esc(c.label)}</span><span class="sub">${esc(c.disabled ? c.why : c.what)}</span></span>
        ${count}${on ? `<span class="mc-tick" aria-hidden="true">${SVG.check}</span>` : ''}
      </button>`;
    }).join('');
    el.ctxMenu.querySelectorAll('.mc-crow').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      const k = b.dataset.ctx;
      state.ctx = state.ctx.includes(k) ? state.ctx.filter(x => x !== k) : [...state.ctx, k];
      renderChips(); renderContextMenu(); syncSend();
    }));
  }
  el.ctx?.addEventListener('click', () => {
    const open = el.ctxMenu && !el.ctxMenu.hidden;
    closeMenus();
    if (open) return;
    if (!state.health) refreshHealth();
    renderContextMenu();
    el.ctxMenu.hidden = false;
    el.ctx.setAttribute('aria-expanded', 'true');
    el.ctxMenu.querySelector('.mc-crow:not([disabled])')?.focus();
  });

  /* ---------------------------------------------------------------- ditar (voz real do browser) */
  const Speech = (typeof window !== 'undefined') && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if (el.mic) {
    if (!Speech) {
      el.mic.disabled = true;
      el.mic.title = 'Este navegador não expõe ditado. O Órbita não finge que está a ouvir.';
      el.mic.setAttribute('aria-pressed', 'false');
    } else {
      el.mic.addEventListener('click', () => {
        if (state.mic) { try { state.mic.stop(); } catch { /* já parado */ } return; }
        const rec = new Speech(); rec.lang = (doc.documentElement.lang || 'pt') + '-PT';
        rec.interimResults = true; rec.continuous = false;
        let base = el.input.value ? el.input.value.replace(/\s*$/, ' ') : '';
        rec.onresult = ev => {
          let said = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) said += ev.results[i][0].transcript;
          el.input.value = base + said;
          syncSend();
        };
        rec.onerror = e => { toast(e.error === 'not-allowed' ? 'O navegador não deu acesso ao microfone.' : `Ditado: ${e.error}.`, 'err'); };
        rec.onend = () => { state.mic = null; el.mic.setAttribute('aria-pressed', 'false'); el.mic.classList.remove('rec'); el.input.focus(); };
        try { rec.start(); state.mic = rec; el.mic.setAttribute('aria-pressed', 'true'); el.mic.classList.add('rec'); toast('A ouvir — fala e o texto entra no campo.', 'ok'); } catch (e) { toast(`Não consegui abrir o microfone (${e.message}).`, 'err'); }
      });
    }
  }

  /* ---------------------------------------------------------------- o estado do motor (o lugar do «Upgrade to Pro») */
  function openModal() {
    if (!el.modal) return;
    const h = state.health;
    const engine = h?.ai || null;
    const rows = [
      ['Motor', engine ? (engine.label || engine.id) : 'nenhum — o servidor não declarou um motor activo'],
      ['Modelo por omissão', h?.modelName || (h?.model || '—')],
      ['Esforço por omissão', h?.effort ? effortLabel(h.effort) : 'o do modelo (auto)'],
      ['Cérebro', h?.context ? `${h.context.notes} notas` : '—'],
      ['Documentos', h?.context ? `${h.context.docs} markdown em docs/` : '—'],
      ['Anexos', `até ${FILES_MAX} ficheiros de texto por mensagem`],
      ['Modos', MODES.map(m => m.name).join(' · ')],
    ];
    el.sheet.innerHTML = `
      <h2 id="mcModalTitle">Motor e contexto</h2>
      <p class="sub">O que este compositor envia, lido do servidor agora.</p>
      <dl class="mc-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <p class="mc-note-l">Este aviso ocupa o lugar do «Upgrade to Pro» do desenho original: o Órbita não tem planos nem faturação, por isso não há preço para mostrar. O que aqui está é o estado real do motor — quando não há nenhum, o compositor diz isso em vez de deixar a seta carregar num vazio.</p>
      <div class="foot"><p>Falta um motor? Arranca o Órbita com um backend de IA ligado (Claude Code, Codex, Gemini ou uma API compatível).</p><button class="btn primary" type="button" id="mcModalClose">Fechar</button></div>`;
    el.modal.hidden = false;
    el.modal.querySelector('#mcModalClose').focus();
    el.modal.querySelector('#mcModalClose').addEventListener('click', closeModal);
    el.modal.addEventListener('click', e => { if (e.target === el.modal) closeModal(); });
    if (!state.health) refreshHealth();
  }
  function closeModal() { if (el.modal) el.modal.hidden = true; el.proBtn?.focus(); }
  el.proBtn?.addEventListener('click', openModal);

  /* ---------------------------------------------------------------- tour (opcional, dispensável) */
  const TOUR = [
    { sel: '.mc-modes', text: 'Três modos: Planear devolve um plano sem mexer em nada, Perguntar é conversa, Construir cria a tarefa no quadro e o servidor corre-a.' },
    { sel: '#mcModel', text: 'O modelo e o esforço. «Auto» deixa o escritório escolher; escolher um modelo desliga o Auto e vale só para esta conversa.' },
    { sel: '.mc-left', text: '+ Ficheiros anexa texto a esta mensagem (não fica guardado). @ Contexto diz ao agente que notas ou documentos ler.' },
    { sel: '#mSend', text: 'Enter envia, Shift + Enter muda de linha. A seta só acorda quando há texto.' },
  ];
  let tourStep = 0;
  function tourShow(i) {
    if (!el.tourPanel) return;
    doc.querySelectorAll('.mc-hl').forEach(x => x.classList.remove('mc-hl'));
    tourStep = Math.max(0, Math.min(TOUR.length - 1, i));
    const step = TOUR[tourStep];
    const target = doc.querySelector(step.sel);
    target?.classList.add('mc-hl');
    el.tourPanel.hidden = false;
    el.tourPanel.innerHTML = `<div class="mc-tour-h">Passo ${tourStep + 1} de ${TOUR.length}</div>
      <p>${esc(step.text)}</p>
      <div class="mc-tour-b"><button type="button" class="btn" data-tour="skip">Fechar</button><button type="button" class="btn primary" data-tour="next">${tourStep === TOUR.length - 1 ? 'Pronto' : 'Seguinte'}</button></div>`;
    el.tourPanel.querySelector('[data-tour="skip"]').addEventListener('click', tourEnd);
    el.tourPanel.querySelector('[data-tour="next"]').addEventListener('click', () => {
      if (tourStep === TOUR.length - 1) tourEnd(); else tourShow(tourStep + 1);
    });
    el.tourPanel.querySelector('[data-tour="next"]').focus();
  }
  function tourEnd() {
    doc.querySelectorAll('.mc-hl').forEach(x => x.classList.remove('mc-hl'));
    if (el.tourPanel) el.tourPanel.hidden = true;
    state.tour = true; save();
  }
  el.tour?.addEventListener('click', () => tourShow(0));

  /* ---------------------------------------------------------------- enviar */
  function value() { return el.input.value.trim(); }
  function syncSend() {
    const on = !!value() && !state.busy;
    el.send.disabled = !on;
    el.send.setAttribute('aria-disabled', String(!on));
    el.card.classList.toggle('hasText', !!value());
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight || 21, 148) + 'px';
  }
  function clear() {
    el.input.value = '';
    state.files = []; state.ctx = [];
    renderChips(); syncSend();
  }
  async function submit() {
    const text = value();
    if (!text || state.busy) return;
    const meta = {
      mode: state.mode,
      auto: state.auto,
      model: state.auto ? '' : state.model,
      effort: state.auto ? '' : state.effort,
      files: state.files.map(f => ({ name: f.name, text: f.text })),
      context: [...state.ctx],
    };
    state.busy = true; syncSend(); el.send.classList.add('busy');
    try {
      await onSubmit?.(text, meta);
      clear();
    } catch (e) {
      toast(e?.message || 'Não foi possível enviar.', 'err');
    } finally {
      state.busy = false; el.send.classList.remove('busy'); syncSend(); el.input.focus();
    }
  }
  el.send.addEventListener('click', submit);
  el.input.addEventListener('input', syncSend);
  el.input.addEventListener('keydown', e => {
    e.stopPropagation(); // a escrever, «g», «b», «l» e «1–6» são letras e não atalhos
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); el.model?.click(); }
    else if (e.key === 'Escape') closeMenus();
  });

  function closeMenus() {
    if (el.menu) el.menu.hidden = true;
    if (el.ctxMenu) el.ctxMenu.hidden = true;
    el.model?.setAttribute('aria-expanded', 'false');
    el.ctx?.setAttribute('aria-expanded', 'false');
    el.card?.classList.remove('menuOpen');
  }
  doc.addEventListener('click', e => {
    if (el.card && !el.card.contains(e.target)) closeMenus();
  });
  doc.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeMenus(); if (el.modal && !el.modal.hidden) closeModal(); if (el.tourPanel && !el.tourPanel.hidden) tourEnd(); }
  });

  renderModes(); renderModelButton(); renderEfforts(); renderList(); renderContextMenu(); renderChips(); syncSend();
  refreshHealth();
  return {
    state: () => ({ ...state, files: state.files.map(f => f.name) }),
    setHealth, refreshHealth, refreshCatalogo, toast, focus: () => el.input.focus(),
    openModelMenu: () => el.model?.click(), openContextMenu: () => el.ctx?.click(),
    openEngineSheet: openModal, startTour: () => tourShow(0), clear,
  };
}
