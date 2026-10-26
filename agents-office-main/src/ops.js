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
  const S = { data: null, leads: [], messages: [], queue: null, events: [], tab: 'leads', busy: false, error: '', adding: false, composing: null, dossier: {}, learning: null };

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
      const [s, l, m, q, e, a] = await Promise.all([
        get('/ops/summary'), get('/ops/leads?limit=40'), get('/ops/messages?limit=40'), get('/ops/queue'), get('/ops/events?limit=25'), get('/ops/aprendizagem'),
      ]);
      if (s.error) throw new Error(s.error);
      Object.assign(S, { data: s, leads: l.leads || [], messages: m.messages || [], queue: q, events: e.events || [], learning: a, error: '' });
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

  function newLeadForm() {
    return `<div class="op-form" role="group" aria-label="novo lead">
      <input class="op-in" data-f="name" placeholder="Nome do negócio" aria-label="nome">
      <input class="op-in" data-f="city" placeholder="Cidade" aria-label="cidade">
      <input class="op-in" data-f="phone" placeholder="Telefone" aria-label="telefone">
      <input class="op-in" data-f="email" placeholder="Email" aria-label="email">
      <input class="op-in" data-f="website" placeholder="Site (se tiver)" aria-label="site">
      <div class="op-form-acts">
        <button class="op-b good" data-act="save-lead">GUARDAR LEAD</button>
        <button class="op-b" data-act="cancel-lead">CANCELAR</button>
        <span class="op-hint">A nota é calculada do que escreveres — sem site, telefone público e avaliação contam.</span>
      </div>
    </div>`;
  }

  function dossierBlock(l) {
    const d = S.dossier[l.id];
    const r = d.research || {};
    const status = r.status === 'ok'
      ? `${d.evidence.length} factos · oportunidade ${d.opportunity}/100`
      : r.status === 'sem_site' ? 'sem site — é a oportunidade' : `${r.status}${r.reason ? ': ' + r.reason : ''}`;
    const facts = (d.evidence || []).map(e => `<li><b>${esc(e.label)}</b>${e.quote ? `<q>${esc(e.quote)}</q>` : ''}</li>`).join('');
    return `<div class="op-dossier">
      <div class="op-dossier-h"><b>Dossiê</b><span class="op-m">${esc(status)}</span></div>
      ${facts ? `<ul class="op-facts">${facts}</ul>` : `<div class="op-hint">${esc(r.reason || 'Ainda não li o site deste lead.')}</div>`}
      <div class="op-form-acts">
        <button class="op-b good" data-act="draft" data-id="${esc(l.id)}">ESCREVER COM OS FACTOS</button>
        <button class="op-b" data-act="close-dossier" data-id="${esc(l.id)}">FECHAR</button>
      </div>
    </div>`;
  }

  function composer(l) {
    const ch = l.phone ? 'whatsapp' : 'email';
    return `<div class="op-form" role="group" aria-label="escrever mensagem a ${esc(l.name)}">
      <div class="op-form-row">
        <select class="op-in" data-f="channel" aria-label="canal">
          <option value="whatsapp"${ch === 'whatsapp' ? ' selected' : ''}${l.phone ? '' : ' disabled'}>WhatsApp${l.phone ? '' : ' (sem número)'}</option>
          <option value="email"${ch === 'email' ? ' selected' : ''}${l.email ? '' : ' disabled'}>Email${l.email ? '' : ' (sem endereço)'}</option>
        </select>
        <input class="op-in" data-f="subject" placeholder="Assunto (email)" aria-label="assunto" value="${esc(l.website ? 'O site de ' + l.name : 'Uma ideia para ' + l.name)}">
      </div>
      <textarea class="op-in" data-f="body" rows="3" aria-label="mensagem" placeholder="Escreve a mensagem. Nada sai daqui sem o teu OK em Hoje.">${esc(
        l.website ? `Bom dia, vi que o ${l.name} tem presença em ${String(l.website).replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}${l.city ? ' em ' + l.city : ''} e reparei numa coisa que se resolve depressa: uma página simples, com o essencial e o botão de contacto. Faço isto por um valor fechado, sem mensalidade. Faz sentido falarmos 10 minutos esta semana?` : `Bom dia, encontrei o ${l.name}${l.city ? ' em ' + l.city : ''} e reparei que ainda não tem site — só o que aparece nas redes. Faço uma página simples, com o essencial e o botão de contacto, por um valor fechado. Faz sentido falarmos 10 minutos esta semana?`,
      )}</textarea>
      <div class="op-form-acts">
        <button class="op-b good" data-act="save-msg" data-id="${esc(l.id)}">GUARDAR RASCUNHO</button>
        <button class="op-b" data-act="cancel-msg">CANCELAR</button>
        <span class="op-hint">Fica à espera de aprovação. ${
          l.email || l.phone ? '' : 'Este lead não tem contacto — acrescenta um telefone ou email primeiro.'
        }</span>
      </div>
    </div>`;
  }

  function paintLeads() {
    const add = S.adding ? newLeadForm() : `<button class="op-b good" data-act="new-lead">+ NOVO LEAD</button>`;
    if (!S.leads.length) return `<div class="op-empty">Ainda não há leads na base de dados. Acrescenta um à mão, ou pesquisa na gaveta <b>LEADS</b> (◈) — o que encontra entra aqui, com nota e razões.</div><div class="op-form-acts">${add}</div>`;
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
          <button class="op-b" data-act="compose" data-id="${esc(l.id)}">ESCREVER</button>
          <button class="op-b" data-act="research" data-id="${esc(l.id)}" title="ver o site e o que se pode citar">${S.dossier[l.id]?.research?.status === 'ok' ? 'VER FACTOS' : 'PESQUISAR'}</button>
        </div>
      </div>${S.composing === l.id ? composer(l) : ''}${S.dossier[l.id] ? dossierBlock(l) : ''}`;
    }).join('') + `<div class="op-form-acts">${add}</div>`;
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
    const r = rest.length ? `<div class="op-sec">HISTÓRICO — diz o que responderam, e a nota aprende</div>${rest.slice(0, 12).map(m => row(m, m.status === 'enviada'
      ? `<button class="op-b good" data-act="signal" data-id="${esc(m.id)}" data-kind="respondeu">RESPONDEU</button>
         <button class="op-b" data-act="signal" data-id="${esc(m.id)}" data-kind="interessado">QUER FALAR</button>
         <button class="op-b" data-act="signal" data-id="${esc(m.id)}" data-kind="ignorou">IGNOROU</button>
         <button class="op-b" data-act="signal" data-id="${esc(m.id)}" data-kind="recusou">RECUSOU</button>`
      : '')).join('')}` : '';
    if (!waiting.length && !rest.length) return `<div class="op-empty">Nenhuma mensagem. Escreve uma a um lead (a partir da conversa de um agente) e ela aparece aqui para aprovares.</div>`;
    return (waiting.length ? `<div class="op-sec">À ESPERA DO TEU OK (${waiting.length})</div>${w}` : '<div class="op-empty">Nada à espera de aprovação.</div>') + r;
  }

  function paintQueue() {
    const q = S.queue || {};
    const L = S.learning;
    const learning = L && L.totalSinais
      ? `<div class="op-sec">O QUE APRENDI COM AS RESPOSTAS</div>
         <div class="op-learn">${L.aprendido.length
           ? L.aprendido.map(x => `<span class="op-tag ${/\+/.test(x) ? 'ok' : 'bad'}">${esc(x)}</span>`).join('')
           : `<span class="op-hint">Ainda não há sinais suficientes. ${L.aEsperar.length ? 'A esperar: ' + esc(L.aEsperar.join(' · ')) : ''}</span>`}
         </div>`
      : `<div class="op-sec">O QUE APRENDI COM AS RESPOSTAS</div><div class="op-hint">Ainda não há respostas registadas. Quando marcarem «respondeu» ou «ignorou» numa mensagem, a pontuação dos leads parecidos ajusta-se — com a razão escrita.</div>`;
    const box = ['fila', 'feito', 'falhou', 'a_correr'].map(k => `<div class="op-stat"><b>${q[k] || 0}</b><small>${k.replace('_', ' ')}</small></div>`).join('');
    const ev = S.events.map(e => `<div class="op-ev"><span class="op-evt">${hhmm(e.at)}</span> <b>${esc(e.action)}</b> <span class="op-m">${esc(e.actor)}${e.entity_id ? ' · ' + esc(String(e.entity_id).slice(0, 14)) : ''}</span></div>`).join('');
    return `<div class="op-stats">${box}</div>${learning}
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
  async function act(a, id, extra) {
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
      if (a === 'signal') {
        if (!extra) throw new Error('sinal sem tipo');
        const r = await post(`/ops/messages/${id}/sinal`, { kind: extra, note: '' });
        if (r.error) throw new Error(r.error);
        P.note.textContent = `registado: ${r.signal.kind}. A nota dos leads parecidos ajustou-se.`;
      }
      if (a === 'save-lead') {
        const f = P.body.querySelector('.op-form');
        if (!f) return;
        const val = k => String(f.querySelector(`[data-f="${k}"]`)?.value || '').trim();
        if (!val('name')) throw new Error('o lead precisa de um nome');
        const r = await post('/ops/leads', { leads: [{ name: val('name'), city: val('city'), phone: val('phone'), email: val('email'), website: val('website'), source: 'manual' }] });
        if (r.error) throw new Error(r.error);
        S.adding = false;
        P.note.textContent = r.created ? 'lead guardado e pontuado.' : 'já existia — atualizei os dados.';
      }
      if (a === 'research') {
        P.note.textContent = 'a ler o site…';
        const r = await post(`/ops/leads/${id}/pesquisar`);
        if (r.error) throw new Error(r.error);
        S.dossier[id] = r;
        P.note.textContent = r.research?.status === 'ok' ? `li ${r.evidence.length} factos no site.` : (r.research?.reason || 'sem site.');
        return paint();
      }
      if (a === 'close-dossier') { delete S.dossier[id]; return paint(); }
      if (a === 'draft') {
        P.note.textContent = 'a escrever com o que li…';
        const r = await post(`/ops/leads/${id}/rascunho`, {});
        if (r.error) throw new Error(r.error);
        S.dossier[id] = null;
        P.note.textContent = `rascunho ${r.generatedBy === 'ia' ? 'pelo motor' : 'pelo modelo local'} — está à tua espera em Hoje.`;
      }
      if (a === 'save-msg') {
        const f = P.body.querySelector('.op-form');
        if (!f) return;
        const val = k => String(f.querySelector(`[data-f="${k}"]`)?.value || '').trim();
        if (!val('body')) throw new Error('a mensagem está vazia');
        const r = await post('/ops/messages', { leadId: id, channel: val('channel') || 'whatsapp', subject: val('subject'), body: val('body') });
        if (r.error) throw new Error(r.error);
        S.composing = null;
        P.note.textContent = 'rascunho guardado — está à tua espera em Hoje.';
      }
    } catch (e) { P.note.textContent = e.message; P.note.classList.add('bad'); }
    finally { S.busy = false; await load(); }
  }

  P.body.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const a = b.dataset.act;
      if (a === 'new-lead') { S.adding = true; S.composing = null; return paint(); }
      if (a === 'cancel-lead') { S.adding = false; return paint(); }
      if (a === 'compose') { S.composing = S.composing === b.dataset.id ? null : b.dataset.id; S.adding = false; return paint(); }
      if (a === 'cancel-msg') { S.composing = null; return paint(); }
      return act(a, b.dataset.id, b.dataset.kind || b.dataset.ch);
    }
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
