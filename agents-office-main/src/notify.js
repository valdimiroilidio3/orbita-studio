// Órbita — AS NOTIFICAÇÕES (29 out 2026).
//
// Pedido do dono: «notificações reais». A regra do escritório é a mesma de sempre: nada aparece na
// tua secretária que não tenha acontecido. Por isso uma notificação aqui **só** nasce de um dado do
// servidor: um posto que ficou à espera do teu OK (estado `waiting`), um posto que falhou (`error`).
// Não há lembretes de marketing, nem «bons dias», nem um cronómetro a inventar trabalho.
//
// A permissão do browser só se pede num clique teu (o interruptor das Configurações) — pedir no
// arranque é a forma mais rápida de ficar bloqueado para sempre. E o interruptor só aparece ligado
// se a permissão estiver mesmo dada: não se mostra um interruptor «ligado» sobre uma permissão que
// o browser recusou.
//
// Estado e regras vivem aqui em funções puras (`changes`, `due`, `prefEnabled`) para poderem ser
// provadas em Node sem browser nenhum.

export const NOTIFY_KEY = 'orbita.notificacoes';
export const NOTIFY_MIN_GAP_MS = 60 * 1000;   // a mesma coisa não se repete ao segundo
export const NOTIFY_MAX_PER_TICK = 3;         // nunca uma torrente de janelas

export function prefEnabled(store) {
  try { return String(store?.getItem(NOTIFY_KEY) ?? '') === '1'; } catch { return false; }
}
export function setPref(store, on) {
  try { store?.setItem(NOTIFY_KEY, on ? '1' : '0'); } catch { /* sem armazenamento */ }
  return !!on;
}

/** O que mudou de interesse entre dois retratos do servidor. Puro: recebe e devolve dados. */
export function changes(prev = {}, next = {}) {
  const out = [];
  for (const [id, d] of Object.entries(next || {})) {
    const st = d && d.state;
    if (st !== 'waiting' && st !== 'error') continue;
    const before = prev && prev[id] ? prev[id].state : null;
    if (before === st) continue;                        // já estava assim: não é notícia
    const task = (d.task && (d.task.title || d.task.id)) || (d.last && d.last.title) || '';
    out.push({ id, state: st, task: String(task || '').slice(0, 120), at: String(d.at || '') });
  }
  return out;
}

/**
 * Que avisos podem sair AGORA, dado o que já saiu antes. `sent` é um mapa `chave → timestamp`.
 * Devolve `{ send, sent }` — o `sent` novo não é mutado, para o teste poder comparar.
 */
export function due(events = [], sent = {}, now = Date.now(), { gap = NOTIFY_MIN_GAP_MS, max = NOTIFY_MAX_PER_TICK } = {}) {
  const next = { ...sent };
  const send = [];
  for (const e of events) {
    if (send.length >= max) break;
    const key = `${e.id}:${e.state}`;
    const last = next[key] || 0;
    if (now - last < gap) continue;
    next[key] = now;
    send.push(e);
  }
  return { send, sent: next };
}

/** O texto do aviso. Curto, em português, sem prometer o que não está a acontecer. */
export function textFor(e) {
  const what = e.task ? `«${e.task}»` : '';
  if (e.state === 'waiting') return { title: 'Precisa do teu OK', body: `${what || 'Uma tarefa'} está à espera de aprovação no Órbita.`.replace('«» ', '') };
  return { title: 'Falhou uma tarefa', body: `${what || 'Uma tarefa'} falhou. Abre o Órbita para ver o que aconteceu.`.replace('«» ', '') };
}

/** O que se pode fazer neste browser, dito sem optimismo. */
export function support(env = globalThis) {
  const has = typeof env.Notification === 'function';
  const permission = has ? String(env.Notification.permission || 'default') : 'unsupported';
  return {
    has,
    permission,
    canAsk: has && permission === 'default',
    granted: has && permission === 'granted',
  };
}

/**
 * Ligar o notificador à cena. `getLive()` devolve o retrato por agente que o SSE já mantém;
 * `onChange` do live chama-nos a cada actualização. Nada aqui inventa estado.
 */
export function createNotifier({ store, env = globalThis, getLive = () => ({}), onStatus = () => {} } = {}) {
  let sent = {};
  let prev = null;              // o primeiro retrato é o estado de partida: não gera avisos
  let enabled = prefEnabled(store);
  const st = () => support(env);

  function setEnabled(on) {
    const s = st();
    if (on && !s.granted) return { ok: false, ...s, error: s.has ? (s.permission === 'denied' ? 'o browser bloqueou estas notificações neste sítio — tens de as permitir nas definições do sítio' : 'ainda faltam as permissões') : 'este browser não tem notificações' };
    enabled = setPref(store, on);
    onStatus({ enabled, ...st() });
    return { ok: true, enabled, ...st() };
  }

  async function ask() {
    const s = st();
    if (!s.has) return { ok: false, error: 'este browser não tem notificações', ...s };
    if (s.permission !== 'default') return setEnabled(s.granted);
    try {
      const p = await env.Notification.requestPermission();
      return setEnabled(p === 'granted');
    } catch (e) { return { ok: false, error: e.message, ...st() }; }
  }

  function show(e) {
    if (!enabled) return false;
    const s = st();
    if (!s.granted) return false;
    const t = textFor(e);
    try {
      const n = new env.Notification(t.title, { body: t.body, tag: `orbita-${e.id}-${e.state}`, renotify: false, lang: 'pt-PT' });
      n.onclick = () => { try { env.focus(); } catch { /* sem janela */ } n.close(); };
      return true;
    } catch { return false; }
  }

  /** Chamado a cada retrato do servidor. Só os postos que MUDARAM de estado contam. */
  function ingest(live = getLive()) {
    const out = changes(prev, live);
    prev = Object.fromEntries(Object.entries(live || {}).map(([k, v]) => [k, { state: v && v.state }]));
    if (!out.length) return [];
    const { send, sent: s2 } = due(out, sent);
    sent = s2;
    return send.filter(show);
  }

  return { ingest, ask, setEnabled, show, state: () => ({ enabled, ...st() }), reset: () => { prev = null; sent = {}; } };
}
