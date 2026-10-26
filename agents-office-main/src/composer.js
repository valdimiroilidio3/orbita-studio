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
  const state = { mode: prefs.mode, model: prefs.model, effort: prefs.effort, auto: prefs.auto, favs: prefs.favs, tab: 'all', files: [], ctx: [], health: null, busy: false, mic: null };
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
  function setHealth(h) {
    state.health = h || null;
    if (state.model && h && Array.isArray(h.models) && !h.models.includes(state.model)) state.model = '';
    if (!state.favs.length && h && h.model) state.favs = [h.model];
    renderModelButton(); renderList(); renderEfforts(); renderContextMenu();
    const engine = h?.ai || null;
    if (el.pro) {
      const missing = !engine;
      el.pro.hidden = !missing;
      const t = el.pro.querySelector('.mc-pro-t');
      if (t) t.textContent = missing
        ? 'Sem motor de IA ligado — este posto não inventa uma resposta. Vê o que falta.'
        : '';
    }
    if (onHealth) onHealth(h);
  }
  async function refreshHealth() {
    try {
      const r = await fetch('/api/health', { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      setHealth(await r.json());
    } catch (e) { setHealth(null); }
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
    if (!h || !Array.isArray(h.models)) return [];
    return h.models.map(k => ({
      key: k,
      name: k === h.model ? (h.modelName || k) : k.charAt(0).toUpperCase() + k.slice(1),
      provider: 'Anthropic',
      current: k === h.model,
    }));
  };
  function renderModelButton() {
    const h = state.health;
    const m = state.auto ? (h?.model || '') : state.model;
    const name = m ? (m === h?.model ? (h.modelName || m) : m.charAt(0).toUpperCase() + m.slice(1)) : 'sem motor';
    if (el.name) el.name.textContent = name;
    if (el.badge) { el.badge.textContent = m ? 'A' : '—'; el.badge.title = m ? 'Anthropic' : 'sem motor ligado'; }
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
      ? 'O escritório escolhe' + (h?.modelName ? ' — ' + h.modelName + ' por omissão' : '') + '.'
      : 'Escolhido por ti; o Auto fica desligado até voltares a ligá-lo.';
  }
  function renderList() {
    if (!el.list) return;
    const all = models();
    const rows = state.tab === 'fav' ? all.filter(m => state.favs.includes(m.key)) : all;
    if (!all.length) {
      el.list.innerHTML = '<p class="mc-empty">Sem motor ligado: a lista de modelos vem do servidor e o servidor não respondeu. Nada aqui é inventado.</p>';
      return;
    }
    if (!rows.length) {
      el.list.innerHTML = '<p class="mc-empty">Ainda não há favoritos. A estrela de um modelo põe-no aqui.</p>';
      return;
    }
    el.list.innerHTML = rows.map(m => {
      const on = !state.auto && state.model === m.key;
      const fav = state.favs.includes(m.key);
      return `<div class="mc-row" role="menuitemradio" aria-checked="${on}" tabindex="-1" data-model="${esc(m.key)}">
        <span class="mc-badge" aria-hidden="true">A</span>
        <span class="mc-rmain"><span class="nm">${esc(m.name)}</span><span class="sub">${esc(m.provider)}${m.current ? ' · por omissão' : ''}</span></span>
        ${on ? `<span class="mc-tick" aria-hidden="true">${SVG.check}</span>` : ''}
        <button class="mc-star" type="button" aria-pressed="${fav}" aria-label="${fav ? 'tirar' : 'pôr'} ${esc(m.name)} nos favoritos" data-fav="${esc(m.key)}">${SVG.star}</button>
      </div>`;
    }).join('');
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
    const efforts = Array.isArray(state.health?.efforts) ? state.health.efforts : [];
    if (!efforts.length) {
      el.effortBox.innerHTML = '<span class="mc-empty">O servidor não declarou níveis de esforço.</span>';
      return;
    }
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
    setHealth, refreshHealth, toast, focus: () => el.input.focus(),
    openModelMenu: () => el.model?.click(), openContextMenu: () => el.ctx?.click(),
    openEngineSheet: openModal, startTour: () => tourShow(0), clear,
  };
}
