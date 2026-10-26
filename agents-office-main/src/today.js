// Órbita — o ecrã «Hoje».
//
// Abres e vês três coisas: o que precisa da tua decisão, o que aconteceu enquanto dormias, e o
// que vai acontecer. Nada de listas de agentes nem de painéis de estado.
//
// A aprovação é um gesto: deslizar para a direita aprova, para a esquerda rejeita, e um toque
// longo abre o porquê. Cada gesto tem um botão equivalente — quem usa leitor de ecrã ou teclado
// não fica de fora. Os cartões saem do ecrã no instante em que os decides (atualização
// otimista) e, se o servidor recusar, voltam com a razão escrita.
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const h24 = iso => (iso ? new Date(iso).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
const d24 = iso => (iso ? new Date(iso).toLocaleDateString('pt-PT', { weekday: 'long', day: '2-digit', month: 'long' }) : '');
const since24 = iso => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
};

const KIND_PT = { mensagem: 'mensagem', tarefa: 'trabalho', seguimento: 'seguimento', rotina: 'rotina' };

export function initToday({ api = '/api', onOpenLeads = null, onOpenAgent = null } = {}) {
  const ov = document.getElementById('todayOv');
  const btn = document.getElementById('topToday');
  if (!ov || !btn) return null;

  const P = {
    date: ov.querySelector('.td-date'), decidir: ov.querySelector('.td-decide'), feed: ov.querySelector('.td-feed'),
    next: ov.querySelector('.td-next'), count: ov.querySelector('.td-count'), stop: ov.querySelector('.td-stop'),
    close: ov.querySelector('.td-close'), refresh: ov.querySelector('.td-refresh'), note: ov.querySelector('.td-note'),
    ring: ov.querySelector('.td-ring'), ringN: ov.querySelector('.td-ring b'),
  };
  const S = { data: null, seen: null, busy: false, open: false, expanded: new Set() };

  const markSeen = () => { try { S.seen = localStorage.getItem('orbita.today.seen') || null; } catch { S.seen = null; } };
  const setSeen = () => { try { localStorage.setItem('orbita.today.seen', new Date().toISOString()); } catch { /* sem storage */ } };
  markSeen();

  async function load({ quiet = false } = {}) {
    try {
      const q = S.seen ? `?since=${encodeURIComponent(S.seen)}` : '';
      const r = await fetch(api + '/ops/today' + q);
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      S.data = j;
      if (!quiet) P.note.textContent = '';
    } catch (e) {
      P.note.textContent = e.message === 'Failed to fetch' ? 'o escritório não respondeu — mostro o que já tinha' : e.message;
      P.note.classList.add('bad');
    }
    paint();
  }

  function paintPresence() {
    const p = S.data?.presenca || {};
    P.ring.classList.toggle('working', (p.agentes || 0) > 0);
    P.ringN.textContent = String(p.agentes || 0);
    P.stop.classList.toggle('on', !!p.parado);
    P.stop.textContent = p.parado ? 'RETOMAR ENVIOS' : 'PARAR TUDO';
    P.stop.setAttribute('aria-pressed', p.parado ? 'true' : 'false');
  }

  function cardHTML(c) {
    const expanded = S.expanded.has(c.id);
    const lead = c.lead?.name || '';
    const isTask = c.kind === 'tarefa';
    const canSend = c.kind === 'mensagem' && c.status === 'aprovada';
    return `<article class="td-card ${isTask ? 'is-task' : ''} ${c.status === 'revisao' ? 'is-review' : ''}" data-id="${esc(c.id)}" data-kind="${esc(c.kind)}" data-status="${esc(c.status || '')}" tabindex="0"
      aria-label="${esc(KIND_PT[c.kind] || c.kind)} para ${esc(lead)} — desliza para a direita para aprovar, para a esquerda para rejeitar">
      <div class="td-swipe-hint left" aria-hidden="true">rejeitar</div>
      <div class="td-swipe-hint right" aria-hidden="true">aprovar</div>
      <div class="td-card-inner">
        <header class="td-card-h">
          <span class="td-kind">${esc(c.channel || 'escritório')}</span>
          <span class="td-when">${since24(c.at)}</span>
        </header>
        <h3 class="td-lead">${esc(lead || 'Sem destinatário')}</h3>
        ${c.subject ? `<p class="td-subject">${esc(c.subject)}</p>` : ''}
        <p class="td-body">${esc(String(c.body || '').slice(0, expanded ? 1400 : 180))}${!expanded && String(c.body || '').length > 180 ? '…' : ''}</p>
        ${c.why ? `<p class="td-why ${expanded ? 'open' : ''}"><span>porquê</span> ${esc(c.why)}</p>` : ''}
        <div class="td-actions">
          ${canSend
            ? `<button class="td-btn primary" data-act="send">${c.channel === 'whatsapp' ? 'Abrir WhatsApp' : 'Enviar'}</button>`
            : `<button class="td-btn primary" data-act="approve">${isTask ? 'Aprovar' : 'Aprovar e enviar'}</button>`}
          <button class="td-btn" data-act="reject">Rejeitar</button>
          <button class="td-btn quiet" data-act="why" aria-expanded="${expanded}">${expanded ? 'Menos' : 'Ver porquê'}</button>
        </div>
      </div>
    </article>`;
  }

  function paintDecisions() {
    const list = S.data?.decidir || [];
    P.count.textContent = list.length ? String(list.length) : '';
    P.count.hidden = !list.length;
    if (!list.length) {
      P.decidir.innerHTML = `<div class="td-empty">
        <p class="td-empty-h">Nada à espera de ti.</p>
        <p>O escritório está a fazer o trabalho de fundo. Quando houver uma mensagem para sair, aparece aqui — e não sai sem este ecrã.</p>
        <div class="td-empty-acts">
          ${onOpenLeads ? '<button class="td-btn primary" data-act="leads">Procurar leads reais</button>' : ''}
          <button class="td-btn quiet" data-act="refresh">Voltar a ver</button>
        </div>
        <p class="td-empty-note">${(S.data?.resumo?.leads?.total || 0)} leads guardados · ${(S.data?.aSeguir?.length || 0)} por vir</p>
      </div>`;
      return;
    }
    P.decidir.innerHTML = list.map(cardHTML).join('');
    bindGestures();
  }

  function paintFeed() {
    const list = S.data?.aconteceu || [];
    P.feed.innerHTML = list.length
      ? list.map(e => `<li><time datetime="${esc(e.at)}">${h24(e.at)}</time><span>${esc(e.text)}</span></li>`).join('')
      : `<li class="td-none">Nada aconteceu desde a última vez. Sossego também é informação.</li>`;
  }

  function paintNext() {
    const list = S.data?.aSeguir || [];
    P.next.innerHTML = list.length
      ? list.map(x => `<li><time datetime="${esc(x.at)}">${/^\d{4}-/.test(String(x.at)) ? h24(x.at) : esc(x.at)}</time>
          <span>${esc(x.name || '')}<em>${esc(KIND_PT[x.kind] || x.kind)}${x.overdue ? ' · em atraso' : ''}</em></span></li>`).join('')
      : `<li class="td-none">Sem nada agendado. As rotinas e os seguimentos aparecem aqui.</li>`;
  }

  function paint() {
    paintPresence();
    paintDecisions();
    paintFeed();
    paintNext();
    const r = S.data?.resumo;
    P.date.textContent = `${d24(new Date().toISOString())}${r?.decidir ? ` · ${r.decidir} à tua espera` : ''}`;
  }

  /* ---------- gestos ---------- */
  function bindGestures() {
    for (const card of P.decidir.querySelectorAll('.td-card')) {
      if (card.dataset.bound) continue;
      card.dataset.bound = '1';
      let x0 = 0, dx = 0, down = false, longTimer = null, moved = false, id = null;

      const reset = () => {
        card.style.transform = ''; card.classList.remove('drag-l', 'drag-r');
        dx = 0; down = false; moved = false;
        if (longTimer) { clearTimeout(longTimer); longTimer = null; }
      };

      card.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return; // os botões tratam de si
        down = true; moved = false; x0 = e.clientX; id = e.pointerId;
        card.setPointerCapture?.(id);
        longTimer = setTimeout(() => { if (!moved && down) { openWhy(card); reset(); } }, 550);
      });
      card.addEventListener('pointermove', (e) => {
        if (!down) return;
        dx = e.clientX - x0;
        if (Math.abs(dx) > 6) { moved = true; if (longTimer) { clearTimeout(longTimer); longTimer = null; } }
        if (Math.abs(dx) > 4) {
          card.style.transform = `translateX(${dx}px) rotate(${Math.max(-6, Math.min(6, dx / 22))}deg)`;
          card.style.setProperty('--dx', String(Math.min(1, Math.abs(dx) / 110)));
          card.classList.toggle('drag-r', dx > 0);
          card.classList.toggle('drag-l', dx < 0);
        }
      });
      const end = async () => {
        if (!down) return;
        const went = dx;
        reset();
        if (Math.abs(went) < 92) return;
        await decide(card, went > 0 ? 'approve' : 'reject');
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', reset);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); decide(card, 'approve'); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); decide(card, 'reject'); }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWhy(card); }
      });
    }
  }

  function openWhy(card) {
    const id = card.dataset.id;
    if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
    paint();
    const again = P.decidir.querySelector(`.td-card[data-id="${CSS.escape(id)}"]`);
    again?.focus();
  }

  /* ---------- decisões ---------- */
  async function decide(card, act) {
    if (S.busy) return;
    const id = card.dataset.id, kind = card.dataset.kind, status = card.dataset.status;
    const item = (S.data?.decidir || []).find(c => c.id === id);
    S.busy = true;
    card.classList.add(act === 'approve' ? 'fly-r' : 'fly-l');
    P.note.textContent = act === 'approve' ? 'a aprovar…' : 'a rejeitar…';
    try {
      const path = kind === 'tarefa'
        ? `/tasks/${id}/${act === 'approve' ? 'approve' : 'reject'}`
        : act === 'approve' ? `/ops/messages/${id}/approve` : `/ops/messages/${id}/reject`;
      const body = kind === 'tarefa' && act === 'reject' ? { feedback: 'rejeitada em Hoje' } : { reason: 'rejeitada em Hoje' };
      const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `o servidor respondeu ${r.status}`);
      // otimista: o cartão sai já; a lista confirma a seguir
      P.decidir.querySelector(`.td-card[data-id="${CSS.escape(id)}"]`)?.remove();
      P.note.textContent = act === 'approve'
        ? (item?.kind === 'mensagem' && j.message?.status === 'bloqueada' ? `bloqueada: ${j.message.reason}` : 'aprovado.')
        : 'rejeitado.';
      await load({ quiet: true });
    } catch (e) {
      card.classList.remove('fly-r', 'fly-l');
      P.note.textContent = `não passou: ${e.message}`;
      P.note.classList.add('bad');
    } finally { S.busy = false; }
  }

  async function send(card) {
    const id = card.dataset.id;
    P.note.textContent = 'a preparar o envio…';
    try {
      const r = await fetch(`${api}/ops/messages/${id}/send`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `o servidor respondeu ${r.status}`);
      if (j.manual && j.url) { window.open(j.url, '_blank', 'noopener'); P.note.textContent = 'link aberto no WhatsApp — carrega em «Já enviei» quando estiver feito.'; }
      else if (j.delivered) P.note.textContent = 'enviada.';
      else P.note.textContent = j.reason || 'não saiu.';
      await load({ quiet: true });
    } catch (e) { P.note.textContent = `não saiu: ${e.message}`; P.note.classList.add('bad'); }
  }

  async function toggleStop() {
    const parado = !!S.data?.presenca?.parado;
    P.stop.disabled = true;
    try {
      const r = await fetch(`${api}/ops/stop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stop: !parado, why: parado ? 'retomado no ecrã Hoje' : 'parado no ecrã Hoje' }) });
      const j = await r.json();
      if (j.error) throw new Error(j.error);
      if (S.data) S.data.presenca.parado = j.parado;
      paintPresence();
      P.note.textContent = j.parado ? 'tudo parado. Nenhum envio sai até retomares.' : 'envios retomados.';
    } catch (e) { P.note.textContent = e.message; P.note.classList.add('bad'); }
    finally { P.stop.disabled = false; }
  }

  /* ---------- abrir/fechar ---------- */
  function open() {
    ov.hidden = false; S.open = true; btn.classList.add('on');
    ov.setAttribute('aria-hidden', 'false');
    load();
    const first = P.decidir.querySelector('.td-card');
    if (first) setTimeout(() => first.focus(), 60);
    else P.close.focus();
  }
  function close() {
    ov.hidden = true; S.open = false; btn.classList.remove('on');
    ov.setAttribute('aria-hidden', 'true');
    setSeen();
  }

  /* ---------- ouvir ---------- */
  P.decidir.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b) {
      const card = b.closest('.td-card');
      const act = b.dataset.act;
      if (act === 'leads' && onOpenLeads) return onOpenLeads();
      if (act === 'refresh') return load();
      if (!card) return;
      if (act === 'why') return openWhy(card);
      if (act === 'send') return send(card);
      return decide(card, act);
    }
    const card = e.target.closest('.td-card');
    // clicar no cartão (sem arrastar) também revela o porquê — no telemóvel é o toque normal
    if (card && !e.target.closest('button')) openWhy(card);
  });
  P.stop.addEventListener('click', toggleStop);
  P.close.addEventListener('click', close);
  P.refresh.addEventListener('click', () => load());
  btn.addEventListener('click', () => (S.open ? close() : open()));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && S.open) close();
    if (e.key.toLowerCase() === 'h' && !S.open && !/input|textarea/i.test(document.activeElement?.tagName || '')) open();
  });

  return { open, close, reload: load, get data() { return S.data; } };
}
