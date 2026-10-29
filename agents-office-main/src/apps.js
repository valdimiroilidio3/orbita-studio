/* ===========================================================================
   1.53.0 · A LOJA DE APPS (29 out 2026)

   Pedido do dono: «muda o visual, põe um design da Apple espelho … e faz os
   campos de conexão assim como as imagens; esse visual para conectar e deve
   conectar mesmo a todos esses apps», depois: «liquid glass, com um visual de
   outro mundo».

   O que isto é, sem marketing:
     · uma folha de vidro por cima do escritório, com as secções e as contagens
       da referência (Programação, Design, Dados e análise, Produtividade…);
     · cada cartão diz o estado REAL, lido do servidor — `Conectado` só depois de
       uma sonda ter respondido, com o HTTP e os milissegundos ao lado;
     · `Conectar` abre o campo da chave, grava-a no `.env` desta máquina e testa
       o serviço na hora. Se o serviço só aceitar OAuth (Canva, Drive, Zapier) ou
       não tiver API (Obsidian, Prisma, Paper), o botão diz isso — não pede um
       token que não existe para depois dar erro;
     · sem servidor (o site publicado), a folha continua a abrir e diz a verdade:
       as chaves vivem nas variáveis de ambiente da Vercel.
   =========================================================================== */

import { APPS, SECOES, PEDIDO, agrupar, estadoDoApp, juntarComServidor, iniciais } from './catalogo-apps.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ===========================================================================
   O VIDRO
   ---------------------------------------------------------------------------
   Um só bloco de CSS, injectado uma vez. As regras que fazem parecer vidro e
   não uma caixa cinzenta: gradiente de fundo vivo (para haver o que desfocar),
   `backdrop-filter` a sério, um fio de luz no topo (`inset 0 1px 0`), sombra
   larga e baixa, e uma camada de brilho que segue o cursor (`--mx`/`--my`).
   =========================================================================== */
const CSS = `
#apps { position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; padding: 24px;
  background:
    radial-gradient(60% 50% at 18% 8%, rgba(120,180,255,.20), transparent 62%),
    radial-gradient(50% 55% at 88% 12%, rgba(255,140,200,.16), transparent 60%),
    radial-gradient(70% 60% at 50% 108%, rgba(120,255,214,.16), transparent 64%),
    rgba(8,10,14,.62);
  backdrop-filter: blur(26px) saturate(135%); -webkit-backdrop-filter: blur(26px) saturate(135%);
  animation: appsIn .26s var(--ease, cubic-bezier(.2,.8,.2,1)) both; font-family: var(--sf, -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif); }
#apps[hidden] { display: none; }
@keyframes appsIn { from { opacity: 0 } to { opacity: 1 } }

#apps .ax {
  position: relative; width: min(1120px, 100%); height: min(84vh, 860px); display: flex; flex-direction: column;
  border-radius: 30px; overflow: hidden; color: #ECEEF2;
  background: linear-gradient(168deg, rgba(30,34,42,.86), rgba(16,18,24,.92));
  border: 1px solid rgba(255,255,255,.13);
  box-shadow: 0 60px 140px rgba(0,0,0,.62), 0 2px 0 rgba(255,255,255,.06) inset, 0 -30px 90px rgba(0,0,0,.35) inset;
  backdrop-filter: blur(30px) saturate(150%); -webkit-backdrop-filter: blur(30px) saturate(150%);
  animation: axRise .34s var(--ease, cubic-bezier(.2,.8,.2,1)) both;
}
@keyframes axRise { from { opacity: 0; transform: translateY(10px) scale(.995) } to { opacity: 1; transform: none } }

/* as auroras: manchas de cor a respirar devagar por trás do vidro */
#apps .ax::before {
  content: ""; position: absolute; inset: -40%; pointer-events: none; z-index: 0;
  background:
    radial-gradient(closest-side, rgba(90,150,255,.30), transparent) 18% 12%/48% 46% no-repeat,
    radial-gradient(closest-side, rgba(255,120,190,.22), transparent) 82% 6%/42% 40% no-repeat,
    radial-gradient(closest-side, rgba(110,255,210,.20), transparent) 60% 96%/52% 46% no-repeat;
  filter: blur(30px); animation: aurora 26s ease-in-out infinite alternate;
}
@keyframes aurora {
  0%   { transform: translate3d(-2%, -1%, 0) scale(1); }
  50%  { transform: translate3d(2%, 1.5%, 0) scale(1.06); }
  100% { transform: translate3d(-1%, 2%, 0) scale(1.02); }
}

#apps header { position: relative; z-index: 1; padding: 26px 30px 0; }
#apps h2 { margin: 0; font-size: 27px; letter-spacing: -.022em; font-weight: 700; }
#apps .ax-sub { margin: 5px 0 0; font-size: 13px; color: rgba(236,238,242,.62); }
#apps .ax-bar { display: flex; gap: 10px; align-items: center; margin: 20px 0 0; }
#apps .ax-search {
  flex: 1; display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 14px;
  border-radius: 13px; background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.10);
  transition: border-color .2s var(--ease), background .2s var(--ease), box-shadow .2s var(--ease);
}
#apps .ax-search:focus-within { border-color: rgba(140,190,255,.55); background: rgba(255,255,255,.075); box-shadow: 0 0 0 4px rgba(110,160,255,.12); }
#apps .ax-search svg { width: 15px; height: 15px; stroke: rgba(236,238,242,.55); fill: none; stroke-width: 1.7; flex: none; }
#apps .ax-search input {
  flex: 1; background: none; border: 0; outline: 0; color: #F2F4F8; font: inherit; font-size: 13.5px;
}
#apps .ax-search input::placeholder { color: rgba(236,238,242,.42); }
#apps .ax-add {
  height: 42px; padding: 0 16px; border-radius: 13px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 600;
  color: #F2F4F8; background: rgba(255,255,255,.075); border: 1px solid rgba(255,255,255,.14);
  box-shadow: 0 1px 0 rgba(255,255,255,.10) inset; transition: all .2s var(--ease); white-space: nowrap;
}
#apps .ax-add:hover { background: rgba(255,255,255,.13); transform: translateY(-1px); }
#apps .ax-x {
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer; color: rgba(236,238,242,.8);
  background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); font-size: 15px;
  transition: all .2s var(--ease);
}
#apps .ax-x:hover { background: rgba(255,255,255,.16); color: #fff; }

#apps .ax-body { position: relative; z-index: 1; flex: 1; overflow: auto; padding: 6px 30px 30px; scrollbar-width: thin; }
#apps .ax-body::-webkit-scrollbar { width: 10px; }
#apps .ax-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 99px; border: 3px solid transparent; background-clip: content-box; }

#apps .ax-sec { display: flex; align-items: baseline; gap: 10px; margin: 26px 2px 12px; }
#apps .ax-sec b { font-size: 12px; letter-spacing: .06em; font-weight: 650; color: rgba(236,238,242,.92); }
#apps .ax-sec i { font-style: normal; font-size: 11.5px; color: rgba(236,238,242,.45); }
#apps .ax-sec span { flex: 1; height: 1px; background: linear-gradient(90deg, rgba(255,255,255,.14), rgba(255,255,255,0)); }

#apps .ax-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 780px) { #apps .ax-grid { grid-template-columns: 1fr; } }

#apps .ax-card {
  position: relative; display: flex; align-items: center; gap: 13px; padding: 12px 14px; min-height: 64px;
  border-radius: 16px; background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.085);
  box-shadow: 0 1px 0 rgba(255,255,255,.07) inset;
  transition: background .22s var(--ease), border-color .22s var(--ease), transform .22s var(--ease), box-shadow .22s var(--ease);
  overflow: hidden;
}
#apps .ax-card::after { /* o brilho que segue o rato */
  content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity .25s var(--ease);
  background: radial-gradient(220px 120px at var(--mx, 50%) var(--my, 0%), rgba(255,255,255,.16), transparent 70%);
}
#apps .ax-card:hover { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.16); transform: translateY(-1px); box-shadow: 0 14px 34px rgba(0,0,0,.34); }
#apps .ax-card:hover::after { opacity: 1; }
#apps .ax-ico {
  width: 40px; height: 40px; border-radius: 11px; flex: none; display: grid; place-items: center;
  font-size: 12px; font-weight: 750; letter-spacing: .02em; color: #0B0D10;
  background: linear-gradient(160deg, #fff, #D8DEE8);
  box-shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 8px 18px rgba(0,0,0,.35);
}
#apps .ax-tx { min-width: 0; flex: 1; }
#apps .ax-tx b { display: block; font-size: 13.5px; font-weight: 600; letter-spacing: -.01em; }
#apps .ax-tx small { display: block; margin-top: 2px; font-size: 11.5px; color: rgba(236,238,242,.55); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#apps .ax-st { flex: none; text-align: right; }
#apps .ax-ok { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: #6EE7B7; }
#apps .ax-ok::before { content: "✓"; font-size: 11px; }
#apps .ax-ok-d { display: block; font-size: 10px; color: rgba(110,231,183,.6); margin-top: 1px; }
#apps .ax-btn {
  height: 30px; padding: 0 12px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 600;
  color: rgba(242,244,248,.92); background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14);
  transition: all .18s var(--ease); white-space: nowrap;
}
#apps .ax-btn:hover { background: rgba(255,255,255,.18); border-color: rgba(255,255,255,.28); }
#apps .ax-btn.warn { color: #FCD34D; border-color: rgba(252,211,77,.35); }
#apps .ax-btn.quiet { color: rgba(236,238,242,.62); }
/* 1.53.0 · uma ligação que já responde também se volta a provar: um botão redondo, discreto,
   ao lado do ✓ Conectado. Sem ele, «Conectado» ficava sem como se confirmar. */
#apps .ax-btn.mini { padding: 0; width: 26px; height: 26px; border-radius: 50%; font-size: 13px; line-height: 1; color: rgba(236,238,242,.7); }
#apps .ax-extra { font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: rgba(140,190,255,.8); margin-left: 6px; }

/* ---------- a folha de ligação ---------- */
#apps .ax-sheet { position: absolute; inset: 0; z-index: 3; display: grid; place-items: center; padding: 20px;
  background: rgba(6,8,12,.55); backdrop-filter: blur(10px); animation: appsIn .2s var(--ease) both; }
#apps .ax-sheet[hidden] { display: none; }
#apps .ax-form {
  width: min(520px, 100%); border-radius: 22px; padding: 22px;
  background: linear-gradient(168deg, rgba(40,45,56,.96), rgba(20,23,30,.98));
  border: 1px solid rgba(255,255,255,.16); box-shadow: 0 40px 90px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.12) inset;
  animation: axRise .26s var(--ease) both;
}
#apps .ax-form h3 { margin: 0; font-size: 18px; letter-spacing: -.02em; }
#apps .ax-form p { margin: 8px 0 0; font-size: 12.5px; line-height: 1.5; color: rgba(236,238,242,.66); }
#apps .ax-form a { color: #8CC6FF; text-decoration: none; border-bottom: 1px solid rgba(140,198,255,.35); }
#apps .ax-field { margin-top: 14px; }
#apps .ax-field label { display: block; font-size: 10px; letter-spacing: .13em; text-transform: uppercase; color: rgba(236,238,242,.5); margin-bottom: 6px; }
#apps .ax-field input {
  width: 100%; height: 40px; padding: 0 12px; border-radius: 11px; font: inherit; font-size: 13px;
  color: #F2F4F8; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.14); outline: 0;
}
#apps .ax-field input:focus { border-color: rgba(140,190,255,.6); box-shadow: 0 0 0 4px rgba(110,160,255,.13); }
#apps .ax-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
#apps .ax-primary {
  height: 36px; padding: 0 18px; border-radius: 11px; cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 650;
  color: #0B0D10; background: linear-gradient(180deg, #F7FAFF, #CFDCEE); border: 1px solid rgba(255,255,255,.5);
  box-shadow: 0 10px 24px rgba(120,170,255,.22); transition: all .18s var(--ease);
}
#apps .ax-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 30px rgba(120,170,255,.32); }
#apps .ax-primary[disabled] { opacity: .55; cursor: default; transform: none; }
#apps .ax-result { margin-top: 14px; padding: 10px 12px; border-radius: 11px; font-size: 12px; line-height: 1.45;
  background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.10); color: rgba(236,238,242,.8); }
#apps .ax-result.ok { color: #6EE7B7; border-color: rgba(110,231,183,.35); background: rgba(16,185,129,.10); }
#apps .ax-result.bad { color: #FCA5A5; border-color: rgba(252,165,165,.32); background: rgba(239,68,68,.10); }
#apps .ax-toast {
  position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 4;
  padding: 9px 16px; border-radius: 99px; font-size: 12px; color: #ECEEF2;
  background: rgba(20,23,30,.94); border: 1px solid rgba(255,255,255,.16); box-shadow: 0 20px 50px rgba(0,0,0,.5);
  opacity: 0; transition: opacity .2s var(--ease), transform .2s var(--ease); pointer-events: none;
}
#apps .ax-toast.show { opacity: 1; transform: translateX(-50%) translateY(-4px); }
#apps .ax-empty { padding: 40px 0; text-align: center; color: rgba(236,238,242,.5); font-size: 13px; }
`;

/** O CSS desta folha, para o `a11y`/testes poderem provar que o vidro não é uma imagem. */
export const CSS_APPS = CSS;

/* ===========================================================================
   O PEDIDO AO SERVIDOR
   ---------------------------------------------------------------------------
   Duas instalações, dois caminhos:
     · nesta máquina há `/api/platform/apis` e `/api/platform/key` a sério;
     · no site publicado só existe `/api/rpc` (e escrever chaves devolve 501).
   A função tenta o caminho directo e cai para o RPC — nunca inventa um estado.
   =========================================================================== */
async function pedirServidor(fetchImpl, { caminho, metodo = 'GET', corpo = null, directo = true }) {
  const tentativas = [];
  if (directo && metodo === 'GET') tentativas.push({ url: `/api/platform${caminho}`, init: { headers: { accept: 'application/json' } } });
  if (metodo === 'GET') tentativas.push({ url: `/api/rpc?caminho=${encodeURIComponent(`/platform${caminho}`)}`, init: { headers: { accept: 'application/json' } } });
  if (metodo !== 'GET') {
    if (directo) tentativas.push({ url: `/api/platform${caminho}`, init: { method: metodo, headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo || {}) } });
    tentativas.push({ url: '/api/rpc', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ caminho: `/platform${caminho}`, metodo, corpo: corpo || {} }) } });
  }
  let ultimo = null;
  for (const t of tentativas) {
    try {
      const r = await fetchImpl(t.url, t.init);
      if (r.status === 404 || r.status === 405) { ultimo = { semServidor: true }; continue; }
      const j = await r.json().catch(() => ({}));
      // resposta do RPC: { status, corpo }
      const corpoOk = j && Object.prototype.hasOwnProperty.call(j, 'corpo') ? j.corpo : j;
      const estado = j && Object.prototype.hasOwnProperty.call(j, 'status') ? j.status : r.status;
      if (estado >= 400) return { erro: (corpoOk && (corpoOk.error || corpoOk.erro)) || `HTTP ${estado}`, estado, dados: corpoOk };
      return { dados: corpoOk, estado };
    } catch (e) { ultimo = { erro: String(e.message || e) }; }
  }
  return ultimo || { semServidor: true };
}

/**
 * Monta a folha. Devolve `{ open, close, toggle, isOpen, refresh }`.
 * Nada aqui corre no arranque: o primeiro `open()` é que pede o estado ao servidor.
 */
export function createApps({ doc = globalThis.document, fetchImpl = globalThis.fetch, aoFechar = null } = {}) {
  if (!doc) throw new Error('createApps precisa de um documento');
  const estado = { aberto: false, itens: APPS, servidor: null, semServidor: false, busca: '', lido: null };
  let raiz = null, corpo = null, folha = null, toastEl = null, alvoLigacao = null;

  function garantirCss() {
    if (doc.getElementById('apps-css')) return;
    const s = doc.createElement('style');
    s.id = 'apps-css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function garantirDom() {
    if (raiz) return;
    garantirCss();
    raiz = doc.createElement('div');
    raiz.id = 'apps';
    raiz.hidden = true;
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-label', 'Apps e integrações');
    raiz.innerHTML = `
      <div class="ax">
        <header>
          <div style="display:flex;align-items:flex-start;gap:12px">
            <div style="flex:1">
              <h2>Apps</h2>
              <p class="ax-sub">Conecte as ferramentas e os serviços com que os agentes trabalham.</p>
            </div>
            <button class="ax-x" data-acao="fechar" title="fechar (Esc)" aria-label="fechar">✕</button>
          </div>
          <div class="ax-bar">
            <label class="ax-search">
              <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4 14 14"/></svg>
              <input type="search" placeholder="Buscar" aria-label="buscar apps" autocomplete="off" spellcheck="false">
            </label>
            <button class="ax-add" data-acao="personalizado">+ Adicionar personalizado</button>
          </div>
        </header>
        <div class="ax-body" tabindex="0"></div>
        <div class="ax-sheet" hidden></div>
        <div class="ax-toast" role="status" aria-live="polite"></div>
      </div>`;
    doc.body.appendChild(raiz);
    corpo = raiz.querySelector('.ax-body');
    folha = raiz.querySelector('.ax-sheet');
    toastEl = raiz.querySelector('.ax-toast');

    raiz.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-acao]');
      if (!alvo) {
        if (e.target === raiz) fechar();
        return;
      }
      const acao = alvo.dataset.acao;
      if (acao === 'fechar') fechar();
      else if (acao === 'personalizado') abrirPersonalizado();
      else if (acao === 'ligar') abrirLigacao(alvo.dataset.id);
      else if (acao === 'testar') testar(alvo.dataset.id);
    });
    raiz.querySelector('input[type=search]').addEventListener('input', (e) => {
      estado.busca = String(e.target.value || '');
      pintar();
    });
    raiz.addEventListener('pointermove', (e) => {
      const card = e.target.closest && e.target.closest('.ax-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
    raiz.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); fechar(); } });
  }

  function toast(texto) {
    if (!toastEl) return;
    toastEl.textContent = texto;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  function visiveis() {
    const q = estado.busca.trim().toLowerCase();
    const lista = juntarComServidor(APPS, estado.servidor);
    if (!q) return lista;
    return lista.filter((a) => `${a.nome} ${a.desc} ${a.grupo}`.toLowerCase().includes(q));
  }

  function pintar() {
    if (!corpo) return;
    const itens = visiveis();
    if (!itens.length) {
      corpo.innerHTML = `<div class="ax-empty">Nada com «${esc(estado.busca)}».</div>`;
      return;
    }
    const grupos = agrupar(itens);
    corpo.innerHTML = grupos.map((g) => `
      <div class="ax-sec"><b>${esc(g.nome)}</b><i>${g.itens.length}</i><span></span></div>
      <div class="ax-grid">
        ${g.itens.map((app) => {
          const st = estadoDoApp(app, app.servidor);
          const direita = st.tom === 'ok'
            ? `<span class="ax-ok">${esc(st.rotulo)}</span><span class="ax-ok-d">${esc(st.detalhe)}</span><button class="ax-btn quiet mini" data-acao="testar" data-id="${esc(app.id)}" title="Testar agora" aria-label="Testar ${esc(app.nome)} agora">↻</button>`
            : st.tom === 'prova'
              ? `<button class="ax-btn warn" data-acao="testar" data-id="${esc(app.id)}">Testar</button>`
              : st.tom === 'off'
                ? `<button class="ax-btn" data-acao="ligar" data-id="${esc(app.id)}">Conectar</button>`
                : `<button class="ax-btn quiet" data-acao="ligar" data-id="${esc(app.id)}">${esc(st.rotulo)}</button>`;
          return `<div class="ax-card">
            <div class="ax-ico" style="background:linear-gradient(160deg,#fff, ${esc(app.cor || '#D8DEE8')}22 60%, #fff)">${esc(iniciais(app.nome))}</div>
            <div class="ax-tx"><b>${esc(app.nome)}${app.extra ? '<span class="ax-extra">teu</span>' : ''}</b><small>${esc(app.desc)}</small></div>
            <div class="ax-st">${direita}</div>
          </div>`;
        }).join('')}
      </div>`).join('');
  }

  function abrirLigacao(id) {
    const app = visiveis().find((a) => a.id === id) || APPS.find((a) => a.id === id);
    if (!app) return;
    alvoLigacao = app;
    const p = PEDIDO[app.tipo] || PEDIDO.chave;
    const nota = p.nota.replace(/\{nome\}/g, app.nome);
    const link = app.site ? `<a href="${esc(app.site)}" target="_blank" rel="noopener">onde se cria a chave</a>` : '';
    const campos = app.tipo === 'chave'
      ? app.env.map((k) => `<div class="ax-field"><label for="f-${esc(k)}">${esc(k)}</label><input id="f-${esc(k)}" data-env="${esc(k)}" type="password" autocomplete="off" spellcheck="false" placeholder="cola aqui…"></div>`).join('')
      : '';
    folha.innerHTML = `
      <div class="ax-form">
        <h3>${esc(p.titulo.replace(/\{nome\}/g, app.nome))}</h3>
        <p>${esc(nota)}${link ? ` · ${link}` : ''}</p>
        ${campos}
        <div class="ax-result" hidden></div>
        <div class="ax-actions">
          <button class="ax-btn" data-acao="cancelar">Fechar</button>
          ${app.tipo === 'chave' ? '<button class="ax-primary" data-acao="guardar">Guardar e testar</button>' : ''}
        </div>
      </div>`;
    folha.hidden = false;
    const primeiro = folha.querySelector('input');
    if (primeiro) primeiro.focus();
    folha.querySelector('[data-acao=cancelar]').addEventListener('click', () => { folha.hidden = true; folha.innerHTML = ''; });
    const guardar = folha.querySelector('[data-acao=guardar]');
    if (guardar) guardar.addEventListener('click', () => guardarChave(app, guardar));
  }

  async function guardarChave(app, botao) {
    const caixa = folha.querySelector('.ax-result');
    const valores = {};
    for (const inp of folha.querySelectorAll('input[data-env]')) {
      const v = String(inp.value || '').trim();
      if (!v) { caixa.hidden = false; caixa.className = 'ax-result bad'; caixa.textContent = `Falta ${inp.dataset.env}.`; inp.focus(); return; }
      valores[inp.dataset.env] = v;
    }
    botao.disabled = true; botao.textContent = 'a guardar…';
    const r = await pedirServidor(fetchImpl, { caminho: '/key', metodo: 'POST', corpo: { id: app.id, values: valores } });
    botao.disabled = false; botao.textContent = 'Guardar e testar';
    caixa.hidden = false;
    if (r.semServidor) {
      caixa.className = 'ax-result bad';
      caixa.textContent = 'Sem servidor nesta página: as chaves só se gravam na máquina onde o Órbita corre (npm start).';
      return;
    }
    if (r.erro) {
      caixa.className = 'ax-result bad';
      caixa.textContent = r.estado === 501
        ? 'Aqui as chaves vivem nas variáveis de ambiente da Vercel (Settings → Environment Variables) — esta instalação não as pode escrever pela interface. Define a variável e volta a testar.'
        : `Não guardou: ${r.erro}`;
      return;
    }
    // guardou: o servidor já sondou o serviço ao gravar — mostramos o resultado real
    const prova = (r.dados && (r.dados.probe || r.dados.probed || r.dados.resultado)) || null;
    caixa.className = 'ax-result ok';
    caixa.textContent = prova
      ? `Guardado. Respondeu HTTP ${prova.status ?? '—'} em ${prova.ms ?? '—'} ms.`
      : 'Guardado. O servidor vai testar o serviço agora.';
    toast(`${app.nome}: chave guardada.`);
    /* a folha fica aberta com o resultado da sonda à frente (fecha-se sozinha a seguir):
       quem guardou tem de ver o HTTP e a latência, não uma janela a desaparecer. */
    const minha = folha;
    setTimeout(() => { if (folha === minha) { folha.hidden = true; folha.innerHTML = ''; } }, 1600);
    await refrescar();
  }

  async function testar(id) {
    const app = visiveis().find((a) => a.id === id);
    toast(`A testar ${app ? app.nome : id}…`);
    const r = await pedirServidor(fetchImpl, { caminho: '/testar', metodo: 'POST', corpo: { id } });
    if (r.erro) { toast(`Não deu para testar: ${r.erro}`); return; }
    const ok = r.dados && (r.dados.ok === true);
    toast(ok ? `${app ? app.nome : id}: respondeu ✓` : `${app ? app.nome : id}: ${(r.dados && (r.dados.erro || r.dados.error)) || 'sem resposta'}`);
    await refrescar();
  }

  function abrirPersonalizado() {
    alvoLigacao = null;
    folha.innerHTML = `
      <div class="ax-form">
        <h3>Adicionar app personalizado</h3>
        <p>Um serviço que não está nesta lista entra por aqui: o nome, o endereço que responde, e como se autentica. É gravado em <code>data/api/providers.json</code> nesta máquina.</p>
        <div class="ax-field"><label for="c-nome">Nome</label><input id="c-nome" data-campo="nome" placeholder="O meu serviço"></div>
        <div class="ax-field"><label for="c-url">Endereço de sonda (GET)</label><input id="c-url" data-campo="url" placeholder="https://api.exemplo.com/health"></div>
        <div class="ax-field"><label for="c-env">Variável da chave</label><input id="c-env" data-campo="env" placeholder="MEU_SERVICO_TOKEN"></div>
        <div class="ax-field"><label for="c-head">Cabeçalho</label><input id="c-head" data-campo="header" placeholder="Authorization" value="Authorization"></div>
        <div class="ax-result" hidden></div>
        <div class="ax-actions"><button class="ax-btn" data-acao="cancelar">Fechar</button><button class="ax-primary" data-acao="criar">Adicionar</button></div>
      </div>`;
    folha.hidden = false;
    folha.querySelector('input').focus();
    folha.querySelector('[data-acao=cancelar]').addEventListener('click', () => { folha.hidden = true; folha.innerHTML = ''; });
    folha.querySelector('[data-acao=criar]').addEventListener('click', async (e) => {
      const ler = (c) => String((folha.querySelector(`[data-campo=${c}]`) || {}).value || '').trim();
      const corpo = { name: ler('nome'), url: ler('url'), env: ler('env'), header: ler('header') };
      const caixa = folha.querySelector('.ax-result');
      if (!corpo.name || !corpo.url || !corpo.env) {
        caixa.hidden = false; caixa.className = 'ax-result bad'; caixa.textContent = 'Faltam o nome, o endereço ou a variável da chave.'; return;
      }
      e.currentTarget.disabled = true;
      const r = await pedirServidor(fetchImpl, { caminho: '/custom', metodo: 'POST', corpo });
      e.currentTarget.disabled = false;
      caixa.hidden = false;
      if (r.erro) { caixa.className = 'ax-result bad'; caixa.textContent = r.estado === 501 ? 'Nesta instalação os serviços personalizados gravam-se na máquina onde o Órbita corre.' : `Não gravou: ${r.erro}`; return; }
      caixa.className = 'ax-result ok';
      caixa.textContent = 'Adicionado. Aparece no fim da lista, na secção Infra e nuvem.';
      setTimeout(() => { folha.hidden = true; folha.innerHTML = ''; }, 900);
      await refrescar();
    });
  }

  async function refrescar() {
    const r = await pedirServidor(fetchImpl, { caminho: '/apis' });
    if (r.semServidor) {
      estado.semServidor = true;
      estado.servidor = [];
    } else if (r.dados) {
      estado.semServidor = false;
      estado.servidor = Array.isArray(r.dados.list) ? r.dados.list : (Array.isArray(r.dados) ? r.dados : []);
      estado.lido = (r.dados && r.dados.checkedAt) || new Date().toISOString();
    } else {
      estado.semServidor = true;
    }
    pintar();
    return estado;
  }

  function abrir() {
    garantirDom();
    raiz.hidden = false;
    estado.aberto = true;
    pintar();
    const campo = raiz.querySelector('input[type=search]');
    if (campo) setTimeout(() => campo.focus(), 30);
    refrescar();
  }
  function fechar() {
    if (!raiz) return;
    raiz.hidden = true;
    estado.aberto = false;
    if (folha) { folha.hidden = true; folha.innerHTML = ''; }
    if (typeof aoFechar === 'function') aoFechar();
  }
  const alternar = () => (estado.aberto ? fechar() : abrir());

  return {
    open: abrir, close: fechar, toggle: alternar,
    isOpen: () => estado.aberto,
    refresh: refrescar,
    estado,
    /** para os testes: pinta sem abrir */
    _pintar: pintar,
  };
}
