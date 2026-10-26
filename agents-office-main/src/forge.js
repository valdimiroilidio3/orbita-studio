// Órbita — O TERMINAL DA OFICINA (27 out 2026).
//
// Pedido do dono: «quero poder ver o que está a fazer através do terminal». Isto é esse terminal —
// e é a sério: não há uma única linha escrita à mão. Tudo o que aqui aparece chegou por SSE do
// servidor, depois de uma execução real (uma ferramenta provada, uma nota lida, uma tarefa contada).
// Se o servidor não fez, o terminal não mostra.
//
// Desenho: um painel escuro sobre o escritório de dia — de propósito. O escritório é claro e
// isométrico; a oficina é preta e monospaced, como a consola de uma máquina. A tecla F abre e fecha.
//
// Comandos (todos chamam a API real):
//   :ls                          o catálogo, por sala
//   :forge <sala> <necessidade>  mandar a oficina forjar uma ferramenta
//   :run <sala> <id> [{json}]    correr uma ferramenta
//   :adopt <sala> <id> <destino> adoptar numa outra sala
//   :activate <sala> <id>        aprovar uma ferramenta que escreve
//   :eventos                     os últimos eventos
//   :limpar   :help
const PHASE_COLOR = {
  think: 't-think', match: 't-match', code: 't-code', save: 't-save', pass: 't-ok', fail: 't-fail',
  repair: 't-repair', active: 't-active', draft: 't-draft', broken: 't-broken', first: 't-first',
  done: 't-done', run: 't-run', ok: 't-ok', sense: 't-sense', adopt: 't-adopt', deny: 't-fail',
  'tool-log': 't-muted', info: 't-muted', error: 't-fail',
};
const ROOM_LABEL = { marketing: 'MEDIA', emails: 'COMANDO', sales: 'PROSPECÇÃO', fin: 'DESIGN', ops: 'VENDAS', delivery: 'ENTREGA' };

const hhmmss = (ts) => {
  const d = new Date(ts || Date.now());
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function createForgeTerminal({ rooms = [], onOpen = null } = {}) {
  const el = document.getElementById('term');
  if (!el) return { open() {}, close() {}, toggle() {}, isOpen: () => false, command: () => {}, log() {} };
  const linesEl = el.querySelector('.tm-lines');
  const statsEl = el.querySelector('.tm-stats');
  const tabsEl = el.querySelector('.tm-tabs');
  const bodyEl = el.querySelector('.tm-body');
  const form = el.querySelector('.tm-prompt');
  const input = el.querySelector('.tm-in');

  let open = false, es = null, filter = 'todas', backlog = [], hist = [], hi = -1, stats = null;

  const roomOf = (r) => ROOM_LABEL[r] || (r ? r.toUpperCase() : '');

  function addLine(ev, { quiet = false } = {}) {
    const line = {
      ts: ev.ts || Date.now(), room: ev.room || null, phase: ev.phase || 'info', text: String(ev.text ?? ''),
    };
    backlog.push(line);
    if (backlog.length > 1500) backlog.shift();
    if (!quiet) paint(line);
  }

  function paint(line) {
    if (filter !== 'todas' && line.room && line.room !== filter) return;
    const near = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 90;
    const row = document.createElement('div');
    row.className = `tm-row ${PHASE_COLOR[line.phase] || 't-muted'}`;
    row.innerHTML = `<span class="tm-ts">${hhmmss(line.ts)}</span>` +
      (line.room ? `<span class="tm-room">${esc(roomOf(line.room))}</span>` : '<span class="tm-room"></span>') +
      `<span class="tm-tx">${esc(line.text)}</span>`;
    linesEl.appendChild(row);
    while (linesEl.childElementCount > 900) linesEl.removeChild(linesEl.firstChild);
    if (near) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function repaint() {
    linesEl.innerHTML = '';
    for (const l of backlog.slice(-600)) paint(l);
  }

  function paintStats(s) {
    if (!s) return;
    stats = s;
    statsEl.innerHTML = `<b>${s.active}</b> activas / ${s.tools} · <b>${s.runs}</b> execuções · ` +
      `<b>${s.failures}</b> falhas · média ${s.avgMs} ms`;
  }

  function tabs() {
    tabsEl.innerHTML = '';
    const mk = (id, label) => {
      const b = document.createElement('button');
      b.className = 'tm-tab' + (filter === id ? ' on' : '');
      b.textContent = label;
      b.onclick = () => { filter = id; tabs(); repaint(); };
      return b;
    };
    tabsEl.appendChild(mk('todas', 'TODAS'));
    for (const r of rooms) tabsEl.appendChild(mk(r, roomOf(r)));
  }

  function connect() {
    if (es || typeof EventSource === 'undefined') return;
    es = new EventSource('/api/forge/stream');
    es.addEventListener('hello', (e) => {
      try {
        const d = JSON.parse(e.data);
        paintStats(d.stats);
        for (const ev of d.events || []) addLine(ev, { quiet: true });
        repaint();
        if (backlog.length === 0) info('o terminal está ligado. Nenhum evento ainda — a oficina só fala quando faz.');
      } catch { /* fluxo corrompido não derruba o terminal */ }
    });
    es.addEventListener('forge', (e) => {
      try {
        const ev = JSON.parse(e.data);
        addLine(ev);
        if (ev.phase === 'done' || ev.phase === 'active' || ev.phase === 'broken') refreshStats();
      } catch { /* idem */ }
    });
    es.addEventListener('error', () => { /* o EventSource volta sozinho */ });
  }

  function refreshStats() {
    // sem servidor (ou a abrir o ficheiro com duplo clique) não há API: o terminal fica quieto
    if (typeof fetch !== 'function') return Promise.resolve();
    return fetch('/api/forge/events?n=1').then((r) => r.json()).then((d) => paintStats(d.stats)).catch(() => {});
  }

  function info(text) { addLine({ ts: Date.now(), phase: 'info', text }); }

  async function api(path, payload) {
    if (typeof fetch !== 'function') throw new Error('sem servidor: este terminal precisa do `npm start`');
    const r = await fetch(path, {
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'content-type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `falhou (${r.status})`);
    return d;
  }

  async function command(raw) {
    const text = String(raw || '').trim();
    if (!text) return;
    hist.unshift(text); if (hist.length > 60) hist.pop(); hi = -1;
    if (!text.startsWith(':')) { info(`os comandos começam com dois pontos — escreve :help`); return; }
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    addLine({ ts: Date.now(), phase: 'run', text: `› ${text}` });
    try {
      if (cmd === 'help' || cmd === '?') {
        for (const l of [
          ':ls — o catálogo de ferramentas, por sala',
          ':forge <sala> <o que precisas> — a oficina forja e prova uma ferramenta',
          ':run <sala> <id> [{"json"}] — corre uma ferramenta e mostra o resultado real',
          ':adopt <sala> <id> <destino> — leva a ferramenta a outra sala (nasce em rascunho)',
          ':activate <sala> <id> — aprova uma ferramenta que escreve',
          ':eventos — os últimos acontecimentos · :limpar',
        ]) info(l);
      } else if (cmd === 'limpar' || cmd === 'clear') {
        backlog = []; linesEl.innerHTML = '';
      } else if (cmd === 'ls' || cmd === 'tools') {
        const d = await api('/api/forge');
        paintStats(d.stats);
        for (const r of d.rooms) {
          if (!r.tools.length) { info(`${roomOf(r.room)}: nenhuma ferramenta ainda`); continue; }
          for (const t of r.tools) info(`${roomOf(r.room)} · ${t.id} v${t.version} [${t.state}] · ${t.name} · ${t.runs}× · ${t.summary}`);
        }
        if (!d.stats.tools) info('a oficina está vazia. Experimenta: :forge marketing contar as palavras do cérebro');
      } else if (cmd === 'eventos' || cmd === 'log') {
        const d = await api('/api/forge/events?n=60');
        for (const ev of d.events) info(`${hhmmss(ev.ts)} ${ev.phase} ${ev.text}`);
      } else if (cmd === 'forge') {
        const [room, ...needParts] = rest;
        if (!rooms.includes(room)) { info(`sala? ${rooms.join(' · ')}`); return; }
        info(`a forjar em ${roomOf(room)}… (as linhas chegam ao vivo)`);
        const r = await api('/api/forge/draft', { room, need: needParts.join(' ') });
        if (!r.ok && r.error) info(`a oficina parou: ${r.error}`);
        refreshStats();
      } else if (cmd === 'run') {
        const [room, id, ...jsonParts] = rest;
        if (!rooms.includes(room) || !id) { info('uso: :run <sala> <id> [{"json"}]'); return; }
        let input = {};
        if (jsonParts.length) { try { input = JSON.parse(jsonParts.join(' ')); } catch { info('o JSON não abre — corri sem entradas'); } }
        const r = await api('/api/forge/run', { room, id, input });
        addLine({ ts: Date.now(), room, phase: r.ok ? 'ok' : 'fail', text: r.ok ? `✓ ${id} · ${r.ms} ms · ${JSON.stringify(r.result).slice(0, 400)}` : `✗ ${id} · ${r.error}` });
      } else if (cmd === 'activate') {
        const [room, id] = rest;
        const r = await api('/api/forge/activate', { room, id });
        addLine({ ts: Date.now(), room, phase: r.ok ? 'active' : 'fail', text: r.ok ? `✦ ${id} activada` : `✗ ${r.error}` });
      } else if (cmd === 'adopt') {
        const [room, id, to] = rest;
        const r = await api('/api/forge/adopt', { room, id, to });
        addLine({ ts: Date.now(), room: to, phase: r.ok ? 'adopt' : 'fail', text: r.ok ? `⇄ ${id} adoptada em ${roomOf(to)}` : `✗ ${r.error}` });
      } else {
        info(`comando desconhecido: ${cmd} — :help`);
      }
    } catch (e) {
      info(`erro: ${e.message}`);
    }
    refreshStats();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    command(v);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hist.length) { hi = Math.min(hi + 1, hist.length - 1); input.value = hist[hi]; e.preventDefault(); }
    else if (e.key === 'ArrowDown' && hi >= 0) { hi = Math.max(hi - 1, -1); input.value = hi < 0 ? '' : hist[hi]; e.preventDefault(); }
  });

  function show(on) {
    open = !!on;
    el.hidden = !open;
    el.setAttribute('aria-hidden', String(!open));
    document.body.classList.toggle('term-on', open);
    if (open) {
      connect();
      tabs();
      if (!backlog.length) info('terminal da oficina. :help para os comandos.');
      setTimeout(() => { input.focus(); bodyEl.scrollTop = bodyEl.scrollHeight; }, 30);
      if (onOpen) onOpen();
      refreshStats();
    }
  }

  tabs();

  return {
    open: () => show(true),
    close: () => show(false),
    toggle: () => show(!open),
    isOpen: () => open,
    command,
    log: (text, phase = 'info') => info(text, phase),
    stats: () => stats,
    el,
  };
}
