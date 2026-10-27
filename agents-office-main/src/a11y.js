// Órbita — o espelho acessível do escritório (26 out 2026).
//
// Porque existe: a cena é um <canvas>. Para um leitor de ecrã não há lá nada dentro, e as salas
// e as pessoas só se abriam com o rato — 42 superfícies clicáveis que não existiam para quem usa
// teclado. Este módulo constrói, ao lado da cena, uma lista real em HTML: as salas e os agentes,
// cada um um <button> a sério, com as MESMAS acções do rato, um ciclo de foco próprio, Esc para
// fechar e o foco a voltar a quem abriu.
//
// Não toca no three nem no canvas, e não sabe nada do escritório: recebe os dados e as acções
// por parâmetro. É por isso que se testa sem browser nenhum (`a11y.test.mjs`, jsdom) — e é por
// isso que uma mudança na cena não pode partir a acessibilidade sem um teste dar por isso.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function initA11y({
  doc = globalThis.document,
  mount,
  agents = [],
  deptKeys = [],
  describeRoom = (k) => ({ name: k, short: k }),
  describeAgent = (id) => ({ name: id }),
  onRoom = null,
  onAgent = null,
} = {}) {
  if (!doc) throw new Error('initA11y: sem document');
  const host = mount || doc.body;
  if (!host) throw new Error('initA11y: sem sítio para montar');

  // o id é fixo porque a ligação «saltar para a lista» aponta para ele
  const el = doc.createElement('div');
  el.id = 'officeIndex';
  el.className = 'oi';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'oiTitle');
  el.setAttribute('aria-describedby', 'oiSub');
  el.innerHTML = `
    <div class="oi-wrap">
      <header class="oi-top">
        <div class="oi-ht">
          <h1 id="oiTitle">O escritório</h1>
          <p class="oi-sub" id="oiSub"></p>
        </div>
        <button type="button" class="oi-close" aria-label="fechar a lista (Esc)" title="fechar (Esc)">✕</button>
      </header>
      <div class="oi-grid"></div>
      <p class="oi-foot"><b>Tab</b> percorre · <b>Enter</b> abre · <b>Esc</b> fecha. A cena 3D continua por trás — isto é a mesma coisa, por palavras.</p>
    </div>`;
  host.appendChild(el);

  const grid = el.querySelector('.oi-grid');
  const sub = el.querySelector('#oiSub');
  let lastFocus = null;

  /* ---------- desenho ---------- */

  function agentLabel(a, s) {
    const partes = [s.name || a.name];
    if (s.role) partes.push(s.role);
    if (s.deptName) partes.push(s.deptName);
    const nome = partes.join(', ');
    return s.label ? `${nome}. ${s.label}` : nome;
  }

  function render() {
    const totalAgentes = agents.length;
    const linhas = deptKeys.map((k) => {
      const room = describeRoom(k) || {};
      const here = agents.filter((a) => a.dept === k);
      const nomeSala = room.name || k;
      const lista = here.length
        ? `<ul class="oi-list">${here.map((a) => {
          const s = describeAgent(a.id) || {};
          return `<li><button type="button" class="oi-agent" data-agent="${esc(a.id)}" aria-label="${esc(agentLabel(a, s))}">
            <span class="oi-an">${esc(s.name || a.name)}${a.lead ? ' <span class="oi-star" aria-hidden="true">★</span>' : ''}</span>
            <span class="oi-ar">${esc(s.role || '')}</span>
            <span class="oi-as" data-k="${esc(s.kind || 'idle')}">${esc(s.label || '')}</span>
          </button></li>`;
        }).join('')}</ul>`
        : `<p class="oi-empty">${esc(room.empty || 'Sem agentes nesta sala.')}</p>`;
      return `<section class="oi-room" aria-labelledby="oi-h-${esc(k)}">
        <div class="oi-rhead">
          <h2 id="oi-h-${esc(k)}"><span class="oi-dot" style="background:${esc(room.glass || 'currentColor')}" aria-hidden="true"></span>${esc(room.short || nomeSala)}</h2>
          <button type="button" class="oi-open" data-room="${esc(k)}" aria-label="Abrir ${esc(room.action || 'a sala')} ${esc(nomeSala)}">${esc(room.action || 'Abrir')}</button>
        </div>
        ${room.meta ? `<p class="oi-meta">${esc(room.meta)}</p>` : ''}
        ${lista}
      </section>`;
    }).join('');
    grid.innerHTML = linhas;
    const salas = deptKeys.length;
    sub.textContent = `${salas} ${salas === 1 ? 'sala' : 'salas'} · ${totalAgentes} ${totalAgentes === 1 ? 'agente' : 'agentes'} · a mesma informação da cena, para teclado e leitores de ecrã`;
  }

  /* ---------- abrir / fechar ---------- */

  function focusables() {
    return [...el.querySelectorAll(FOCUSABLE)];
  }

  function open(from) {
    if (!el.hidden) return;
    render();
    lastFocus = from || doc.activeElement || null;
    el.hidden = false;
    doc.body.classList.add('indexOpen');
    const primeiro = el.querySelector(FOCUSABLE);
    if (primeiro) primeiro.focus();
  }

  function close(restore = true) {
    if (el.hidden) return;
    el.hidden = true;
    doc.body.classList.remove('indexOpen');
    if (restore && lastFocus && lastFocus.isConnected && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  const toggle = (from) => (el.hidden ? open(from) : close());
  const isOpen = () => !el.hidden;

  /* ---------- teclado: modal a sério ---------- */

  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    // com a lista aberta, o resto do teclado não foge para a cena (os atalhos globais param aqui)
    e.stopPropagation();
    if (e.key !== 'Tab') return;
    const lista = focusables();
    if (!lista.length) return;
    const primeiro = lista[0], ultimo = lista[lista.length - 1];
    if (e.shiftKey && doc.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && doc.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  });

  /* ---------- acções: os mesmos dois gestos do rato ---------- */

  el.addEventListener('click', (e) => {
    const alvo = e.target && e.target.closest ? e.target.closest('[data-room], [data-agent], .oi-close') : null;
    if (!alvo || !el.contains(alvo)) return;
    if (alvo.classList.contains('oi-close')) { close(); return; }
    const sala = alvo.getAttribute('data-room');
    const agente = alvo.getAttribute('data-agent');
    close(false); // quem trata da acção decide onde o foco fica (o rail, o grafo…)
    if (sala && onRoom) onRoom(sala);
    else if (agente && onAgent) onAgent(agente);
  });

  render();

  return { el, open, close, toggle, isOpen, refresh: render, focusables };
}
