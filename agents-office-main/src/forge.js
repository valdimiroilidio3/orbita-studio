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
//   :maquina                     em que máquina o escritório está a correr (SO, shell, node, ferramentas)
//   :api                         que APIs reais estão prontas, e qual a chave que falta
//   :comandos                    a lista completa
//   :limpar   :help              (:help é curto de propósito: os cinco que se usam)
//
// 28 out 2026 (pedido 34d): o terminal passou a olhar para a máquina. Ao abrir, pergunta ao servidor
// em que sistema está (/api/platform), mostra-o numa linha, e completa comandos com Tab. Nada disto é
// inventado: é o que o processo `node` reporta e o que o PATH responde.
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
/** Distância de edição — só para sugerir o comando que o dedo queria escrever. */
function perto(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
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
  let machineShown = false, machine = null;
  const COMMANDS = ['help', 'ls', 'forge', 'run', 'adopt', 'activate', 'eventos', 'maquina', 'api', 'comandos', 'limpar'];

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
        // curto de propósito (pedido 34d): quem abre o terminal precisa de três linhas, não de um manual
        for (const l of [
          ':ls — o catálogo, por sala · :forge <sala> <o que precisas> — a oficina forja e prova',
          ':run <sala> <id> [{"json"}] — corre e mostra o resultado real · :api — as APIs prontas',
          ':maquina — o sistema onde isto corre · :comandos — a lista toda',
        ]) info(l);
      } else if (cmd === 'comandos' || cmd === 'commands') {
        for (const l of [
          ':ls — o catálogo de ferramentas, por sala',
          ':forge <sala> <o que precisas> — a oficina forja e prova uma ferramenta',
          ':run <sala> <id> [{"json"}] — corre uma ferramenta e mostra o resultado real',
          ':adopt <sala> <id> <destino> — leva a ferramenta a outra sala (nasce em rascunho)',
          ':activate <sala> <id> — aprova uma ferramenta que escreve',
          ':eventos — os últimos acontecimentos',
          ':maquina — SO, arquitectura, memória, node, shell e ferramentas do PATH',
          ':api — serviços configurados, prontos, e a chave que falta a cada um',
          ':limpar — limpa o ecrã · Tab completa o comando · ↑ ↓ percorre o histórico',
        ]) info(l);
      } else if (cmd === 'maquina' || cmd === 'maq' || cmd === 'machine' || cmd === 'sys') {
        let d;
        try { d = await api('/api/platform'); } catch (e) { info(`sem retrato da máquina: ${e.message}`); return; }
        const m = d.machine || {};
        machine = m; machineShown = true;
        for (const l of [
          `máquina: ${m.os} · ${m.arch} · ${m.cores} núcleos · ${m.cpu}`,
          `memória: ${m.memoryGB} GB (livres ${m.freeGB} GB) · uptime ${m.uptimeH} h · fuso ${m.tz} · fuso local ${m.locale}`,
          `node ${m.node} · shell ${m.shell} · pid ${m.pid} · cwd ${m.cwd}`,
          `ferramentas: ${(m.tools || []).filter((t) => t.found).map((t) => t.name + (t.version ? ' (' + t.version + ')' : '')).join(' · ') || 'nenhuma no PATH'}`,
          `em falta: ${(m.tools || []).filter((t) => !t.found).map((t) => t.name).join(' · ') || 'nada'}`,
        ]) info(l);
      } else if (cmd === 'api' || cmd === 'apis') {
        let d;
        try { d = await api('/api/platform/apis'); } catch (e) { info(`sem estado das APIs: ${e.message}`); return; }
        const prontas = d.list.filter((p) => p.ready), comChave = d.list.filter((p) => p.configured && !p.ready);
        info(`${prontas.length} de ${d.summary.total} prontas · ${d.summary.configured} com chave`);
        for (const p of prontas) info(`✓ ${p.name} — ${p.verified ? 'sonda respondeu' : 'configurada (sem sonda)'}${p.latencyMs != null ? ' · ' + p.latencyMs + ' ms' : ''}${p.status ? ' · HTTP ' + p.status : ''}`);
        for (const p of comChave) info(`… ${p.name} — com chave mas a sonda falhou: ${p.error || 'sem resposta'}`);
        const falta = d.list.filter((p) => !p.configured);
        info(`por configurar (${falta.length}): ${falta.map((p) => p.missing[0]).slice(0, 10).join(' · ')}${falta.length > 10 ? ' …' : ''}`);
        info('como ligar: mete a chave no .env — o servidor vigia o ficheiro e sonda sozinho, sem reiniciar');
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
        const near = COMMANDS
          .map((c) => ({ c, d: perto(cmd.toLowerCase(), c) }))
          .filter(({ c, d }) => d <= Math.max(2, Math.floor(c.length / 3)) || c.startsWith(cmd.toLowerCase().slice(0, 3)))
          .sort((x, y) => x.d - y.d)
          .map(({ c }) => c);
        info(`comando desconhecido: ${cmd}${near.length ? ' — talvez ' + near.slice(0, 3).map((c) => ':' + c).join(' · ') : ' — :help'}`);
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
  let draft = '';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' && hist.length) {
      if (hi === -1) draft = input.value;               // guarda o que estava a ser escrito
      hi = Math.min(hi + 1, hist.length - 1); input.value = hist[hi];
      e.preventDefault();
      setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
    } else if (e.key === 'ArrowDown' && hi >= 0) {
      hi = Math.max(hi - 1, -1); input.value = hi < 0 ? draft : hist[hi];
      e.preventDefault();
    } else if (e.key === 'Tab') {
      const v = input.value;
      if (!v.startsWith(':')) return;
      const cur = v.slice(1).split(/\s+/)[0].toLowerCase();
      const hits = COMMANDS.filter((c) => c.startsWith(cur));
      if (hits.length === 1) { input.value = ':' + hits[0] + (v.includes(' ') ? v.slice(1 + cur.length) : ' '); e.preventDefault(); }
      else if (hits.length > 1) info(`comandos: ${hits.map((c) => ':' + c).join(' · ')}`);
    }
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
      if (!machineShown && typeof fetch === 'function') {
        machineShown = true;
        fetch('/api/platform').then((r) => r.json()).then((d) => {
          machine = d.machine || null;
          if (!machine) return;
          addLine({ ts: Date.now(), phase: 'sense', text: `${machine.os} · ${machine.arch} · ${machine.cores} núcleos · node ${machine.node} · shell ${machine.shell} — :maquina para o resto` });
        }).catch(() => { machineShown = false; });
      }
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
