// Órbita — a gaveta OPERAÇÃO (26 out 2026).
//
// O que antes não tinha sítio nenhum: os leads que ficam guardados a sério (com a nota e as razões
// dela), as mensagens à espera do OK do dono, a fila de trabalho e o rasto do que aconteceu.
// Nada aqui inventa: se a base de dados não responde, a gaveta diz isso em vez de mostrar zeros.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = c => (c / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
const hhmm = iso => (iso ? new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '—');

export function initOps({ api = '/api' } = {}) {
  const btn = document.getElementById('topOps');
  const panel = document.getElementById('opsPanel');
  if (!btn || !panel) return null;

  const P = {
    sum: panel.querySelector('.op-sum'), tabs: [...panel.querySelectorAll('.op-tab')],
    body: panel.querySelector('.op-body'), close: panel.querySelector('.op-close'),
    refresh: panel.querySelector('.op-refresh'), note: panel.querySelector('.op-note'),
  };
  const S = { data: null, leads: [], messages: [], queue: null, events: [], tab: 'leads', busy: false, error: '' };

  const open = () => { panel.hidden = false; btn.classList.add('on'); load(); };
  const close = () => { panel.hidden = true; btn.classList.remove('on'); };
  const toggle = () => (panel.hidden ? open() : close());

  async function get(path) { const r = await fetch(api + path); return r.json(); }
  async function post(path, payload) {
    const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload || {}) });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  }

  async function load() {
    try {
      const [s, l, m, q, e] = await Promise.all([
        get('/ops/summary'), get('/ops/leads?limit=40'), get('/ops/messages?limit=40'), get('/ops/queue'), get('/ops/events?limit=25'),
      ]);
      if (s.error) throw new Error(s.error);
      Object.assign(S, { data: s, leads: l.leads || [], messages: m.messages || [], queue: q, events: e.events || [], error: '' });
    } catch (err) {
      S.error = err.message === 'Failed to fetch' ? 'o servidor não respondeu — a gaveta não inventa números' : err.message;
    }
    paint();
  }

  function paintSummary() {
    const d = S.data;
    if (!d) { P.sum.textContent = S.error || 'a ler…'; P.sum.classList.toggle('bad', !!S.error); return; }
    P.sum.classList.remove('bad');
    const t = d.conversao.taxaResposta;
    P.sum.innerHTML = `<b>${d.leads.total}</b> leads · <b>${d.funil.contactados}</b> contactados · <b>${d.funil.clientes}</b> clientes`
      + (t === null ? ' · resposta: sem dados' : ` · resposta <b>${t}%</b>`)
      + ` · gasto <b>${money(d.custos.apiCentimos)}</b>`;
  }

  const STATUS_PT = { novo: 'novo', contactado: 'contactado', respondeu: 'respondeu', reuniao: 'reunião', cliente: 'cliente', perdido: 'perdido' };
  const NEXT = { novo: ['contactado', 'perdido'], contactado: ['respondeu', 'perdido'], respondeu: ['reuniao', 'perdido'], reuniao: ['cliente', 'perdido'], cliente: [], perdido: ['novo'] };

  function paintLeads() {
    if (!S.leads.length) return `<div class="op-empty">Ainda não há leads na base de dados. Pesquisa na gaveta <b>LEADS</b> (◈) e o que encontra entra aqui, com nota e razões.</div>`;
    return S.leads.map(l => {
      const opts = [l.status, ...NEXT[l.status]].map(s => `<option value="${s}"${s === l.status ? ' selected' : ''}>${STATUS_PT[s]}</option>`).join('');
      return `<div class="op-row">
        <div class="op-main">
          <div class="op-n">${esc(l.name)}${l.consent === 'retirado' ? ' <span class="op-tag bad">opt-out</span>' : ''}</div>
          <div class="op-m">${esc(l.city || '')}${l.phone ? ' · ' + esc(l.phone) : ''}${l.email ? ' · ' + esc(l.email) : ''}${l.website ? ' · ' + esc(String(l.website).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]) : ' · sem site'}</div>
          <div class="op-reasons">${esc(l.score_reasons || '')}</div>
        </div>
        <div class="op-side">
          <div class="op-score">${l.score ?? '—'}<small>NOTA</small></div>
          <select class="op-stage" data-id="${esc(l.id)}" title="mudar de estado no funil">${opts}</select>
        </div>
      </div>`;
    }).join('');
  }

  function paintMessages() {
    const waiting = S.messages.filter(m => m.status === 'rascunho' || m.status === 'aprovada');
    const rest = S.messages.filter(m => !waiting.includes(m));
    const row = (m, acts) => `<div class="op-row">
      <div class="op-main"><div class="op-n">${esc(m.lead?.name || m.lead_id)} <span class="op-tag ${m.channel === 'whatsapp' ? 'ok' : ''}">${m.channel}</span> <span class="op-tag ${m.status === 'bloqueada' || m.status === 'falhou' ? 'bad' : ''}">${m.status}</span></div>
        <div class="op-m">${esc(m.subject || '')}</div><div class="op-reasons">${esc(String(m.body || '').slice(0, 140))}${m.reason ? ' — ' + esc(m.reason) : ''}</div></div>
      <div class="op-side op-acts">${acts}</div></div>`;
    const w = waiting.map(m => row(m, (m.status === 'rascunho'
      ? `<button class="op-b good" data-act="approve" data-id="${esc(m.id)}">APROVAR</button><button class="op-b" data-act="reject" data-id="${esc(m.id)}">REJEITAR</button>`
      : `<button class="op-b" data-act="send" data-id="${esc(m.id)}" data-ch="${esc(m.channel)}">${m.channel === 'whatsapp' ? 'ABRIR WHATSAPP' : 'ENVIAR'}</button>`
        + (m.channel === 'whatsapp' ? `<button class="op-b good" data-confirm="${esc(m.id)}" title="marcar como enviada depois de enviares no WhatsApp">JÁ ENVIEI</button>` : '')))).join('');
    const r = rest.length ? `<div class="op-sec">HISTÓRICO</div>${rest.slice(0, 12).map(m => row(m, '')).join('')}` : '';
    if (!waiting.length && !rest.length) return `<div class="op-empty">Nenhuma mensagem. Escreve uma a um lead (a partir da conversa de um agente) e ela aparece aqui para aprovares.</div>`;
    return (waiting.length ? `<div class="op-sec">À ESPERA DO TEU OK (${waiting.length})</div>${w}` : '<div class="op-empty">Nada à espera de aprovação.</div>') + r;
  }

  function paintQueue() {
    const q = S.queue || {};
    const box = ['fila', 'feito', 'falhou', 'a_correr'].map(k => `<div class="op-stat"><b>${q[k] || 0}</b><small>${k.replace('_', ' ')}</small></div>`).join('');
    const ev = S.events.map(e => `<div class="op-ev"><span class="op-evt">${hhmm(e.at)}</span> <b>${esc(e.action)}</b> <span class="op-m">${esc(e.actor)}${e.entity_id ? ' · ' + esc(String(e.entity_id).slice(0, 14)) : ''}</span></div>`).join('');
    return `<div class="op-stats">${box}</div>
      <div class="op-sec">O QUE ACONTECEU (auditoria)</div>${ev || '<div class="op-empty">Sem eventos ainda.</div>'}`;
  }

  function paint() {
    paintSummary();
    P.note.textContent = S.error || '';
    P.note.classList.toggle('bad', !!S.error);
    P.body.innerHTML = S.tab === 'leads' ? (S.error ? `<div class="op-empty bad">${esc(S.error)}</div>` : paintLeads())
      : S.tab === 'messages' ? paintMessages() : paintQueue();
  }

  function tab(k) { S.tab = k; for (const t of P.tabs) t.classList.toggle('on', t.dataset.k === k); paint(); }

  // ---- ações ----
  async function act(a, id, ch) {
    if (S.busy) return;
    S.busy = true; P.note.classList.remove('bad');
    try {
      if (a === 'approve') { const r = await post(`/ops/messages/${id}/approve`); if (r.error) throw new Error(r.error); P.note.textContent = r.message?.status === 'bloqueada' ? 'bloqueada: ' + r.message.reason : 'aprovada — o envio continua a ser teu.'; }
      if (a === 'reject') { const r = await post(`/ops/messages/${id}/reject`, { reason: 'rejeitada na gaveta' }); if (r.error) throw new Error(r.error); P.note.textContent = 'rejeitada.'; }
      if (a === 'send') {
        const r = await post(`/ops/messages/${id}/send`);
        if (r.error) throw new Error(r.error);
        if (r.manual && r.url) { window.open(r.url, '_blank', 'noopener'); P.note.textContent = 'link aberto — depois confirma aqui que enviaste.'; }
        else if (r.delivered) P.note.textContent = 'enviada.';
        else P.note.textContent = r.reason || 'não saiu.';
      }
      if (a === 'confirm') { const r = await post(`/ops/messages/${id}/confirm`); if (r.error) throw new Error(r.error); P.note.textContent = 'confirmada como enviada.'; }
    } catch (e) { P.note.textContent = e.message; P.note.classList.add('bad'); }
    finally { S.busy = false; await load(); }
  }

  P.body.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) { act(b.dataset.act, b.dataset.id, b.dataset.ch); return; }
    const c = e.target.closest('button[data-confirm]');
    if (c) act('confirm', c.dataset.confirm);
  });
  P.body.addEventListener('change', async e => {
    const sel = e.target.closest('.op-stage');
    if (!sel) return;
    const r = await fetch(`${api}/ops/leads/${sel.dataset.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: sel.value }) });
    const j = await r.json().catch(() => ({}));
    if (j.error) { P.note.textContent = j.error; P.note.classList.add('bad'); } else { P.note.textContent = `«${j.lead?.name}» → ${STATUS_PT[j.lead?.status] || j.lead?.status}`; P.note.classList.remove('bad'); }
    await load();
  });

  btn.addEventListener('click', toggle);
  P.close.addEventListener('click', close);
  P.refresh.addEventListener('click', load);
  for (const t of P.tabs) t.addEventListener('click', () => tab(t.dataset.k));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });
  setInterval(() => { if (!panel.hidden) load(); }, 15000);

  return { open, close, reload: load };
}
