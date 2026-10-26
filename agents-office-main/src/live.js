// ÓRBITA — AO VIVO. Os monitores do escritório 3D deixam de repetir três linhas de exemplo e passam
// a mostrar o trabalho que a base de dados já registou: a tarefa aberta, o que ela produziu, o que
// falhou e quando. A fonte é o servidor (`/api/ops/aovivo` + `/api/ops/aovivo/stream`, SSE); este
// ficheiro só desenha e diz a verdade sobre o que recebeu.
//
// O que aqui NÃO existe, por decisão:
//   · percentagens — o servidor não as calcula e nós não as inventamos; mostra-se tentativa x/y,
//     hora de início, passos e resultados;
//   · atividade fingida — sem eventos, o ecrã diz «sem tarefa registada» em vez de rodar texto;
//   · um estado `live` eterno — sem um evento nos últimos 2 minutos, o servidor devolve `idle`;
//   · fluxo silencioso — se o SSE calar mais de 20 s, tudo o que está no ecrã passa a DESATUALIZADO
//     com a hora do último dado bom, e a ligação volta sozinha quando o servidor responder.
import * as THREE from 'three';

export const W = 512, H = 320;
const MONO = '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SANS = '-apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif';
const ACID = '#B9FF00';
const BG = '#101113';
const INK = '#EDEBE4';
const DIM = '#8D9096';
const LINE = 'rgba(237,235,228,.13)';
const OK = '#6FE3A6';
const WARN = '#F2B84B';
const BAD = '#F2705F';
const SILENCE_MS = 20000;

const STATUS = {
  live: { label: 'LIVE', pt: 'a trabalhar', color: ACID },
  waiting: { label: 'WAITING', pt: 'à espera', color: WARN },
  error: { label: 'ERROR', pt: 'falhou', color: BAD },
  idle: { label: 'IDLE', pt: 'sem tarefa', color: DIM },
  demo: { label: 'DEMO', pt: 'demonstração', color: WARN },
  stale: { label: 'DESATUALIZADO', pt: 'sem ligação', color: WARN },
};

/* ---------- desenho: um painel por posto, com a forma do trabalho real ---------- */

const esc = s => String(s == null ? '' : s);
const hhmm = t => {
  const d = t ? new Date(t) : new Date();
  return Number.isNaN(d.getTime()) ? '--:--' : d.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false });
};
const ago = t => {
  if (!t) return '';
  const m = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 60000));
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
};
function font(x, size, weight = 400, mono = false) {
  x.font = `${weight} ${size}px ${mono ? MONO : SANS}`;
}
function clip(x, text, max) {
  const s = esc(text);
  if (x.measureText(s).width <= max) return s;
  let out = s;
  while (out.length > 4 && x.measureText(out + '…').width > max) out = out.slice(0, -1);
  return out + '…';
}
function rrect(x, X, Y, w, h, r) {
  x.beginPath();
  if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h);
}

/** A forma do painel vem do trabalho do posto, não do departamento: isto não é decoração. */
const SHAPE = {
  'projeto.gerar': 'terminal', 'projeto.corrigir': 'terminal', 'projeto.entregar': 'terminal',
  'projeto.qa': 'relatorio', 'projeto.briefing': 'documento',
  'lead.pesquisar': 'lista', 'lead.qualificar': 'lista', 'proposta.preparar': 'lista', 'mensagem.redigir': 'lista',
  'conteudo.rascunho': 'documento', 'command.revisao': 'documento',
};
const shapeOf = data => {
  const kind = data?.task?.kind || data?.last?.kind || (data?.kinds || [])[0];
  return SHAPE[kind] || 'terminal';
};
/** O título já está no topo do ecrã; repeti-lo como primeira linha é ruído. */
const semTitulo = (lines, title) => {
  const t = String(title || '').trim();
  return (lines || []).filter(l => {
    const txt = String(l.text || '').replace(/^[▸✕✓±$·]\s*/, '').replace(/\s*·\s*(falhou|concluída|a correr|em fila)$/, '').trim();
    if (t && l.k === 'start' && txt === t) return false;      // o título já está no topo
    if (/^começou\s/.test(txt)) return false;                  // início e tentativa já estão na linha de meta
    return true;
  });
};
const stateOf = (data, status) => {
  if (status === 'demo') return 'demo';
  if (status === 'stale' || status === 'off') return 'stale';
  return data?.state || 'idle';
};

/**
 * Pinta um monitor. `view` = { agent:{name, role, deptName, chip}, data, status, at }.
 * Nada aqui consulta a rede: desenha o último retrato recebido e diz de quando é.
 */
export function drawScreen(x, w, h, view) {
  if (!x) return;
  const { agent = {}, data = null, status = 'off', at = null } = view || {};
  const st = stateOf(data, status);
  const S = STATUS[st] || STATUS.idle;
  const chip = agent.chip || ACID;
  const pad = Math.round(w * 0.045);

  x.save();
  x.fillStyle = BG; x.fillRect(0, 0, w, h);

  // cabeçalho: posto, estado, hora — a mesma gramática em todos, o conteúdo é que muda
  x.fillStyle = '#191A1D'; x.fillRect(0, 0, w, Math.round(h * 0.14));
  x.fillStyle = chip; x.fillRect(0, 0, Math.round(w * 0.008), Math.round(h * 0.14));
  font(x, Math.round(w * 0.033), 700);
  x.fillStyle = INK;
  x.fillText(clip(x, agent.name || data?.id || 'posto', w * 0.5), pad, Math.round(h * 0.095));
  font(x, Math.round(w * 0.024), 600, true);
  x.fillStyle = S.color;
  const badge = `${st === 'stale' ? 'DESATUALIZADO' : S.label}`;
  const badgeW = x.measureText(badge).width;
  const dotR = Math.round(w * 0.008);
  x.fillText(badge, w - pad - badgeW, Math.round(h * 0.09));
  x.beginPath(); x.arc(w - pad - badgeW - dotR * 2, Math.round(h * 0.082), dotR, 0, Math.PI * 2); x.fill();

  const y0 = Math.round(h * 0.2);
  const bandH = (st === 'error' || st === 'waiting') ? Math.round(h * 0.10) : 0;
  const footH = Math.round(h * 0.085);
  const bodyBottom = h - bandH - footH; // o corpo nunca escreve por cima da faixa nem do rodapé

  if (st === 'idle' || !data?.hasData) {
    // sem trabalho próprio: dizer isso mesmo e, se houver, mostrar o do departamento — marcado
    font(x, Math.round(w * 0.036), 600);
    x.fillStyle = INK;
    x.fillText('SEM TAREFA PRÓPRIA', pad, y0 + Math.round(h * 0.06));
    const dep = data?.deptActivity;
    font(x, Math.round(w * 0.025));
    x.fillStyle = DIM;
    if (dep?.task) {
      const DEPT_PT = { emails: 'COMANDO', sales: 'PROSPEÇÃO', ops: 'VENDAS', fin: 'DESIGN LAB', delivery: 'ENGENHARIA', marketing: 'MEDIA' };
      let y = y0 + Math.round(h * 0.125);
      font(x, Math.round(w * 0.021), 600, true);
      x.fillStyle = WARN;
      x.fillText(`do departamento ${DEPT_PT[dep.dept] || dep.dept} — não deste posto`, pad, y);
      y += Math.round(h * 0.05);
      font(x, Math.round(w * 0.026), 600);
      x.fillStyle = INK;
      x.fillText(clip(x, dep.task.title, w - pad * 2), pad, y);
      y += Math.round(h * 0.042);
      font(x, Math.round(w * 0.022), 500, true);
      x.fillStyle = DIM;
      x.fillText(clip(x, `${dep.task.stateLabel} · ${hhmm(dep.at)}${dep.active ? ` · ${dep.active} em curso` : ''}`, w - pad * 2), pad, y);
      y += Math.round(h * 0.05);
      for (const l of dep.lines.slice(0, 3)) {
        font(x, Math.round(w * 0.021), 500, true);
        x.fillStyle = l.k === 'error' ? BAD : INK;
        x.fillText(clip(x, l.text, w - pad * 2), pad, y);
        y += Math.round(w * 0.042);
      }
    } else {
      const last = data?.last;
      x.fillText(clip(x, last ? `${last.stateLabel || last.state} · ${hhmm(last.at)}` : 'este posto ainda não recebeu trabalho', w - pad * 2), pad, y0 + Math.round(h * 0.15));
      if (last?.title) x.fillText(clip(x, last.title, w - pad * 2), pad, y0 + Math.round(h * 0.21));
      font(x, Math.round(w * 0.023), 400, true);
      x.fillStyle = 'rgba(141,144,150,.8)';
      x.fillText('nada é inventado para preencher o ecrã', pad, h - Math.round(h * 0.14));
    }
  } else {
    const shape = shapeOf(data);
    const title0 = data.task?.title || data.last?.title || '';
    const lines = semTitulo(data.lines || [], title0).slice(0, shape === 'lista' ? 5 : 6);
    const rowH = Math.round(w * 0.048);
    let y = y0 + rowH;

    font(x, Math.round(w * 0.030), 700);
    x.fillStyle = INK;
    const title = data.task?.title || data.last?.title || '—';
    x.fillText(clip(x, title, w - pad * 2), pad, y);
    y += Math.round(h * 0.055);

    font(x, Math.round(w * 0.024), 500, true);
    const meta = [];
    if (data.task?.started_at) meta.push(`início ${hhmm(data.task.started_at)}`);
    if (data.task?.attempts != null) meta.push(`tentativa ${data.task.attempts}/${data.task.max_attempts}`);
    if (data.project) meta.push(data.project.id);
    meta.push(`atualizado ${hhmm(at)}`);
    x.fillStyle = DIM;
    x.fillText(clip(x, meta.join(' · '), w - pad * 2), pad, y);
    x.strokeStyle = LINE; x.beginPath(); x.moveTo(pad, y + Math.round(h * 0.022)); x.lineTo(w - pad, y + Math.round(h * 0.022)); x.stroke();
    y += Math.round(h * 0.055);

    if (shape === 'relatorio') {
      // QA: contagens como as do relatório, com a mesma fonte
      const v = data.verification;
      font(x, Math.round(w * 0.027), 600);
      if (v) {
        const cells = [
          ['estado', v.passed ? 'PASSOU' : 'FALHOU', v.passed ? OK : BAD],
          ['críticos', String(v.critical ?? 0), v.critical ? BAD : INK],
          ['importantes', String(v.important ?? 0), INK],
          ['menores', String(v.minor ?? 0), INK],
        ];
        const cw = (w - pad * 2) / cells.length;
        cells.forEach(([l, v2, c], i) => {
          const cx = pad + i * cw;
          font(x, Math.round(w * 0.020), 600, true); x.fillStyle = DIM; x.fillText(l.toUpperCase(), cx, y);
          font(x, Math.round(w * 0.042), 700); x.fillStyle = c; x.fillText(v2, cx, y + Math.round(h * 0.058));
        });
        y += Math.round(h * 0.125);
      }
      font(x, Math.round(w * 0.023), 500, true);
      for (const l of lines) {
        if (y > bodyBottom - 2) break;
        x.fillStyle = l.k === 'error' ? BAD : l.k === 'test' ? OK : INK;
        const marca = l.k === 'error' ? '✕' : l.k === 'test' ? '✓' : '·';
        x.fillText(clip(x, /^[✕✓±$·▸]/.test(String(l.text).trim()) ? l.text : `${marca} ${l.text}`, w - pad * 2), pad, y);
        y += rowH;
      }
    } else if (shape === 'lista') {
      // leads/propostas: uma linha por registo, com o resultado ao lado
      const col = w * 0.62;
      for (const l of lines) {
        if (y > bodyBottom - 2) break;
        x.fillStyle = l.k === 'error' ? BAD : l.k === 'wait' ? WARN : INK;
        font(x, Math.round(w * 0.023), 500, true);
        x.fillText(clip(x, l.text, col), pad, y);
        font(x, Math.round(w * 0.021), 600, true);
        x.fillStyle = l.k === 'error' ? BAD : DIM;
        x.fillText(l.k === 'error' ? 'falhou' : l.k === 'wait' ? 'espera' : 'registado', w - pad - x.measureText('registado').width, y);
        y += rowH;
      }
    } else if (shape === 'documento') {
      // o documento que o posto escreve: título, critérios, entregas
      for (const l of lines) {
        if (y > bodyBottom - 2) break;
        font(x, Math.round(w * 0.023), l.k === 'file' ? 600 : 500, true);
        x.fillStyle = l.k === 'error' ? BAD : l.k === 'file' ? OK : INK;
        x.fillText(clip(x, (l.k === 'file' ? '¶ ' : '— ') + l.text, w - pad * 2), pad, y);
        y += rowH;
      }
    } else {
      // terminal: comandos, ficheiros, testes — o que o trabalho imprimiu
      for (const l of lines) {
        if (y > bodyBottom - 2) break;
        const mark = l.k === 'error' ? '✕' : l.k === 'file' ? '±' : l.k === 'test' ? '✓' : l.k === 'tool' ? '$' : '·';
        font(x, Math.round(w * 0.023), 500, true);
        x.fillStyle = l.k === 'error' ? BAD : l.k === 'file' ? OK : l.k === 'tool' ? ACID : INK;
        const jaTemMarca = /^[✕✓±$·▸]/.test(String(l.text).trim());
        x.fillText(clip(x, jaTemMarca ? l.text : `${mark} ${l.text}`, w - pad * 2), pad, y);
        y += rowH;
      }
    }

    // se sobrou espaço, as últimas tarefas reais deste posto — nada de preencher com exemplos
    const hist = (data.history || []).filter(h2 => h2.id !== data.task?.id).slice(0, 3);
    if (hist.length && y < bodyBottom - rowH * 2) {
      y = Math.max(y, bodyBottom - rowH * (hist.length + 1) - Math.round(h * 0.04));
      font(x, Math.round(w * 0.019), 600, true); x.fillStyle = DIM;
      x.fillText('HISTÓRICO', pad, y); y += Math.round(h * 0.055);
      font(x, Math.round(w * 0.021), 500, true);
      for (const h2 of hist) {
        x.fillStyle = h2.state === 'failed' ? BAD : INK;
        x.fillText(clip(x, `${h2.stateLabel || h2.state} · ${h2.title}`, w - pad * 2 - Math.round(w * 0.10)), pad, y);
        font(x, Math.round(w * 0.019), 500, true); x.fillStyle = DIM;
        x.fillText(hhmm(h2.at), w - pad - x.measureText(hhmm(h2.at)).width, y);
        font(x, Math.round(w * 0.021), 500, true);
        y += rowH;
      }
    }

    if (st === 'error') {
      x.fillStyle = 'rgba(242,112,95,.16)'; x.fillRect(0, h - bandH, w, bandH);
      font(x, Math.round(w * 0.024), 600, true); x.fillStyle = BAD;
      x.fillText(clip(x, `✕ ${data.task?.error || data.jobs?.[0]?.error || 'falhou — ver painel'}`, w - pad * 2), pad, h - bandH + Math.round(bandH * 0.64));
    } else if (st === 'waiting') {
      x.fillStyle = 'rgba(242,184,75,.14)'; x.fillRect(0, h - bandH, w, bandH);
      font(x, Math.round(w * 0.024), 600, true); x.fillStyle = WARN;
      x.fillText(data.task?.state === 'awaiting_approval' ? 'à espera da tua aprovação' : 'em fila — ainda não começou', pad, h - bandH + Math.round(bandH * 0.64));
    }
  }

  // rodapé: de onde vêm estes dados e de quando são (por cima da faixa, nunca por baixo dela)
  const footTop = h - bandH - footH;
  x.fillStyle = LINE; x.fillRect(pad, footTop, w - pad * 2, 1);
  font(x, Math.round(w * 0.019), 500, true);
  x.fillStyle = st === 'stale' ? WARN : DIM;
  x.fillText(clip(x, st === 'stale'
    ? `DESATUALIZADO · último dado ${hhmm(at)}`
    : `base de dados do Órbita · ${hhmm(at)}`, w - pad * 2), pad, footTop + footH - Math.round(h * 0.014));
  x.restore();
}

/** Textura viva para um posto. O `draw()` é chamado pelo loop da cena, não pela rede. */
export function makeLiveScreen(agent) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const view = { agent, data: null, status: 'stale', at: null };
  let painted = '';
  return {
    tex, canvas, agent, view,
    draw(force) {
      const key = JSON.stringify([view.status, view.at, view.data]);
      if (!force && key === painted) return false;
      painted = key;
      drawScreen(ctx, W, H, view);
      tex.needsUpdate = true;
      return true;
    },
  };
}

/* ---------- o cliente SSE ---------- */

/**
 * Liga ao fluxo do servidor. Devolve uma API pequena: cada monitor espera por `forAgent(id)`,
 * o painel subscreve `onChange`, e o rodapé lê `status()`.
 */
export function createLive({ url = '/api/ops/aovivo/stream', agents = [], demo = false } = {}) {
  const state = { agents: {}, at: null, totais: {}, fonte: '', abertas: [] };
  const listeners = new Set();
  const screens = new Map();
  let source = null; let lastHeard = 0; let status = 'off'; let stopped = false; let retry = 0;
  let dirty = true; let lastPaint = 0;

  const setStatus = (next, why = '') => {
    if (status === next) return;
    status = next;
    for (const fn of listeners) { try { fn({ type: 'status', status, why, at: state.at }); } catch { /* um painel não derruba a ligação */ } }
  };
  const emit = kind => {
    for (const fn of listeners) { try { fn({ type: kind, state, status, at: state.at }); } catch { /* idem */ } }
  };

  function ingest(payload) {
    if (!payload || !payload.agents) return;
    lastHeard = Date.now();
    dirty = true;
    state.agents = payload.agents;
    state.at = payload.at || new Date().toISOString();
    state.serverTime = payload.serverTime || null;
    state.totais = payload.totais || {};
    state.fonte = payload.fonte || '';
    state.abertas = payload.abertas || [];
    if (Array.isArray(payload.alteracoes) && payload.alteracoes.length) state.alteracoes = payload.alteracoes;
    for (const [id, scr] of screens) {
      const d = state.agents[id];
      if (!d) continue;
      scr.view.data = d;
      scr.view.status = demo ? 'demo' : 'live';
      scr.view.at = state.at;
    }
    setStatus(demo ? 'demo' : 'live');
    emit('update');
  }

  function start() {
    if (stopped) return;
    if (typeof EventSource === 'undefined') { setStatus('off', 'o browser não suporta eventos do servidor'); return; }
    try { source = new EventSource(`${url}${agents.length ? `?agentes=${encodeURIComponent(agents.join(','))}` : ''}`); }
    catch { setStatus('off', 'ligação recusada'); return; }
    source.addEventListener('hello', e => { retry = 0; ingest(JSON.parse(e.data)); });
    source.addEventListener('update', e => ingest(JSON.parse(e.data)));
    source.addEventListener('ping', () => { lastHeard = Date.now(); if (status === 'stale') { setStatus('live'); emit('update'); } });
    source.addEventListener('erro', () => setStatus('stale', 'o servidor respondeu com erro'));
    source.onerror = () => {
      // o EventSource tenta sozinho; enquanto isso os ecrãs dizem que estão velhos
      retry += 1;
      setStatus(retry > 1 ? 'off' : 'stale', 'à espera do servidor');
    };
    source.onopen = () => { if (status === 'off') setStatus('stale'); };
    setStatus('connecting');
  }
  function stop() { stopped = true; if (source) { try { source.close(); } catch { /* já fechado */ } source = null; } setStatus('off'); }

  /** Chamado pelo loop da cena: decide se vale a pena redesenhar, e marca o que ficou velho. */
  function tick(now = Date.now(), slow = false) {
    if (!demo && status !== 'off' && status !== 'connecting' && lastHeard && now - lastHeard > SILENCE_MS) {
      setStatus('stale', `sem eventos há ${Math.round((now - lastHeard) / 1000)} s`);
    }
    if (!screens.size) return;
    // 60 fps aqui seria desperdício: repinta quando chegou um retrato novo, ou de vez em quando
    // para o relógio e o «há x min» não mentirem. Longe da câmara, o intervalo é maior.
    if (!dirty && now - lastPaint < (slow ? 15000 : 2500)) return;
    dirty = false; lastPaint = now;
    for (const [id, scr] of screens) {
      if (!demo && status !== 'live' && status !== 'demo') { scr.view.status = status === 'off' ? 'off' : 'stale'; scr.view.at = state.at; }
      scr.draw();
    }
  }

  function attach(agent) {
    if (screens.has(agent.id)) return screens.get(agent.id);
    const scr = makeLiveScreen(agent);
    screens.set(agent.id, scr);
    const d = state.agents[agent.id];
    if (d) { scr.view.data = d; scr.view.status = demo ? 'demo' : 'live'; scr.view.at = state.at; }
    scr.view.status = demo ? 'demo' : (state.at ? (status === 'live' ? 'live' : 'stale') : 'off');
    scr.draw(true);
    return scr;
  }

  /** Um painel pode desenhar o mesmo monitor (mesma verdade, outro tamanho). */
  function paintInto(canvas, id) {
    const scr = screens.get(id);
    const x = canvas.getContext && canvas.getContext('2d');
    if (!x) return;
    drawScreen(x, canvas.width, canvas.height, scr ? scr.view : { agent: R_AGENT(id), data: state.agents[id], status, at: state.at });
  }

  function R_AGENT(id) { return { id }; }

  /** Um retrato à mão (o botão «atualizar»): o mesmo caminho do fluxo, sem esperar pelo evento. */
  async function refresh() {
    try {
      const r = await fetch(`${url.replace(/\/stream$/, '')}${agents.length ? `?agentes=${encodeURIComponent(agents.join(','))}` : ''}`,
        { headers: { accept: 'application/json' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error(r.status === 401 ? 'a sessão expirou — entra outra vez' : `o servidor respondeu ${r.status}`);
      ingest(await r.json());
      return true;
    } catch (e) { setStatus('stale', e.message || 'sem resposta'); return false; }
  }

  /* ---------- o painel de inspeção ---------- */

  const setText = (el, text) => { if (el) el.textContent = text; };
  const row = (k, v, t, href) => {
    const d = document.createElement('div'); d.className = 'r';
    const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
    const vv = document.createElement('span'); vv.className = 'v';
    if (href) { const a = document.createElement('a'); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = v; vv.appendChild(a); }
    else vv.textContent = v;
    d.append(kk, vv);
    if (t) { const tt = document.createElement('span'); tt.className = 't'; tt.textContent = t; d.appendChild(tt); }
    return d;
  };
  const empty = html => { const d = document.createElement('div'); d.className = 'empty'; d.innerHTML = html; return d; };

  /**
   * Enche o painel do rail com o retrato deste posto. `agent` traz a identidade que já existia na
   * cena (nome, função, departamento, cor) — nada é renomeado aqui.
   */
  function renderPanel(id, agent = {}) {
    const el = sel => document.getElementById(sel);
    const d = state.agents[id] || null;
    // o estado mostrado é o da LIGAÇÃO quando ela não está de pé: nunca «ao vivo» com dados velhos
    const st = demo ? 'demo'
      : status === 'live' ? (d?.state || 'idle')
      : status === 'off' ? 'off' : 'stale';
    const S = STATUS[st] || STATUS.idle;

    const bar = el('lvBar');
    if (bar) {
      bar.dataset.s = d ? st : 'off';
      setText(bar.querySelector('b'), (STATUS[st] || STATUS.idle).label);
    }
    const note = el('lvNote');
    if (note) {
      note.textContent = demo ? 'demonstração — ecrãs gravados'
        : status !== 'live' ? (state.at ? `último dado ${hhmm(state.at)}` : 'sem ligação ao servidor')
        : !d ? 'à espera do primeiro retrato'
        : (d.lastEventAt ? `${d.stateLabel} · última atividade ${ago(d.lastEventAt)}` : d.stateLabel);
    }

    // monitor: a mesma textura que está na cena, desenhada no tamanho do painel
    const cv = el('lvCanvas');
    if (cv) {
      const scr = screens.get(id);
      if (scr) { drawScreen(cv.getContext && cv.getContext('2d'), cv.width, cv.height, scr.view); }
      else drawScreen(cv.getContext && cv.getContext('2d'), cv.width, cv.height, { agent, data: d, status: state.status, at: state.at });
      setText(el('lvCapAt'), state.at ? `último dado ${hhmm(state.at)}` : 'sem dados');
    }

    // atividade atual — só o que existe
    const now = el('lvNow');
    if (now) {
      now.innerHTML = '';
      if (!d) {
        now.appendChild(empty(status === 'off'
          ? 'O servidor não respondeu, por isso não há atividade para mostrar. O monitor mostra o último retrato conhecido, marcado como <b>desatualizado</b>.'
          : 'Ainda não chegou nenhum retrato deste posto. Nada é inventado enquanto isso.'));
      } else if (!d.hasData) {
        const dep = d.deptActivity;
        if (dep?.task) {
          now.appendChild(empty(`Este posto <b>não tem tarefas próprias</b> na base de dados. Função: ${esc(agent.role || d.role || '—')} · ${esc(agent.deptName || '')}. O que se segue é trabalho real do <b>departamento</b> — não deste posto.`));
          const h = document.createElement('div'); h.className = 'n-t'; h.textContent = dep.task.title;
          const m = document.createElement('div'); m.className = 'n-m';
          m.textContent = [dep.task.kind, dep.task.stateLabel, hhmm(dep.at), dep.active ? `${dep.active} em curso` : ''].filter(Boolean).join(' · ');
          now.append(h, m);
          for (const l of dep.lines.slice(0, 4)) {
            const r = document.createElement('div'); r.className = 'n-l' + (l.k === 'error' ? ' err' : '');
            const i = document.createElement('i'); i.textContent = l.k === 'error' ? '✕' : '·';
            const s2 = document.createElement('span'); s2.textContent = l.text;
            r.append(i, s2); now.appendChild(r);
          }
        } else {
          now.appendChild(empty(`Este posto <b>não tem tarefas registadas</b> na base de dados do Órbita. Função: ${esc(agent.role || '—')} · ${esc(agent.deptName || '')}.`));
        }
      } else {
        const t = d.task || d.last;
        const h = document.createElement('div'); h.className = 'n-t'; h.textContent = t?.title || '—';
        const m = document.createElement('div'); m.className = 'n-m';
        const bits = [];
        if (t?.kind) bits.push(t.kind);
        if (t?.stateLabel) bits.push(t.stateLabel);
        if (t?.started_at) bits.push(`início ${hhmm(t.started_at)}`);
        if (t?.attempts != null) bits.push(`tentativa ${t.attempts}/${t.max_attempts}`);
        if (t?.duration_ms) bits.push(`${Math.round(t.duration_ms / 1000)} s`);
        m.textContent = bits.join(' · ');
        now.append(h, m);
        for (const l of semTitulo(d.lines || [], t?.title).slice(0, 6)) {
          const r = document.createElement('div'); r.className = 'n-l' + (l.k === 'error' ? ' err' : '');
          const i = document.createElement('i'); i.textContent = l.k === 'error' ? '✕' : l.k === 'file' ? '±' : l.k === 'test' ? '✓' : '·';
          const s2 = document.createElement('span'); s2.textContent = l.text;
          r.append(i, s2); now.appendChild(r);
        }
        if (d.project) {
          const p = document.createElement('div'); p.className = 'n-m';
          p.textContent = `projeto ${d.project.id} · ${d.project.name} · ${d.project.status}`;
          now.appendChild(p);
        }
      }
    }

    // verificações
    const checks = el('lvChecks');
    if (checks) {
      checks.innerHTML = '';
      if (d?.verification) {
        const v = d.verification;
        checks.appendChild(row('QA', v.passed ? 'passou' : 'falhou', hhmm(v.at)));
        checks.appendChild(row('problemas', `${v.total ?? 0} no total`, `${v.critical ?? 0} crítico(s) · ${v.important ?? 0} importante(s)`));
        if (d.project) checks.appendChild(row('relatório', 'abrir o projeto e o QA', '', `/api/ops/projetos/${encodeURIComponent(d.project.id)}`));
      } else {
        checks.appendChild(empty('Sem verificações de QA registadas para o trabalho deste posto. Não há resultado para apresentar.'));
      }
    }

    // artefactos
    const art = el('lvArt');
    if (art) {
      art.innerHTML = '';
      const list = d?.artifacts || [];
      if (list.length) {
        for (const a of list) art.appendChild(row(a.kind, a.label, a.bytes ? `${(a.bytes / 1024).toFixed(1)} KB` : '', a.url));
      } else if (d?.hasData) {
        art.appendChild(empty('O trabalho deste posto não deixou ficheiros nem relatórios — o resultado está nas linhas acima.'));
      } else {
        art.appendChild(empty('Sem artefactos: este posto ainda não produziu nada.'));
      }
    }

    // histórico
    const hist = el('lvHist');
    if (hist) {
      hist.innerHTML = '';
      const list = (d?.history?.length ? d.history : (d?.deptActivity?.history || [])).slice(0, 8);
      if (!list.length) hist.appendChild(empty('Sem histórico de tarefas para este posto.'));
      if (!d?.history?.length && d?.deptActivity) hist.appendChild(empty('(do departamento — este posto não tem tarefas próprias)'));
      for (const h of list.slice(0, 8)) {
        hist.appendChild(row(h.stateLabel || h.state, h.title, h.at ? hhmm(h.at) : ''));
      }
    }

    // eventos — a cadeia de auditoria, com segredos já ocultados no servidor
    const ev = el('lvEv');
    if (ev) {
      ev.innerHTML = '';
      const list = d?.events || [];
      if (!list.length) ev.appendChild(empty('Sem eventos registados para as tarefas deste posto.'));
      for (const e of list.slice(0, 8)) {
        ev.appendChild(row(e.actor || '—', e.action + (e.detail ? ` · ${e.detail}` : ''), e.at ? hhmm(e.at) : ''));
      }
    }

    // rodapé: fonte, hora, e um botão honesto
    const foot = el('lvFoot');
    if (foot) {
      foot.innerHTML = '';
      const mud = (state.alteracoes || []).filter(m => m.agente === id).slice(-1)[0];
      if (mud) {
        const m = document.createElement('div');
        m.style.marginBottom = '4px';
        m.textContent = `Última mudança registada: ${mud.estado} · ${mud.tarefa || 'sem título'} · ${hhmm(mud.at)}`;
        foot.appendChild(m);
      }
      const p = document.createElement('div');
      p.textContent = d && d.hasData
        ? 'Fonte: tarefas, jobs, projetos e QA da base de dados do Órbita. Sem percentagens inventadas — tentativa, horas e resultados são os registados.'
        : 'Fonte: base de dados do Órbita. Este posto não tem trabalho registado; o painel di-lo em vez de preencher com exemplos.';
      foot.appendChild(p);
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'ATUALIZAR AGORA';
      b.addEventListener('click', async () => { b.disabled = true; b.textContent = 'A LER…'; await refresh(); renderPanel(id, agent); b.disabled = false; b.textContent = 'ATUALIZAR AGORA'; });
      foot.appendChild(b);
      if (demo) {
        const w = document.createElement('div');
        w.style.marginTop = '6px';
        w.textContent = 'DEMO: esta cena usa sessões gravadas (window.SCREENS). O painel lê a base de dados real, mas os monitores 3D não são um fluxo ao vivo.';
        foot.appendChild(w);
      } else if (status !== 'live') {
        const w = document.createElement('div');
        w.style.color = '#B23B2B'; w.style.marginTop = '6px';
        w.textContent = `A ligação ao vivo não está de pé (${status}). O que está acima pode estar desatualizado.`;
        foot.appendChild(w);
      }
    }
  }

  return {
    start, stop, tick, attach, paintInto, refresh, renderPanel,
    onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    status: () => status,
    forAgent: id => state.agents[id] || null,
    all: () => state.agents,
    meta: () => ({ at: state.at, totais: state.totais, fonte: state.fonte, abertas: state.abertas, status }),
    screens,
  };
}
