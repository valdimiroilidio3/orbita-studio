// Órbita — a gaveta EMPRESA (12 nov 2026).
//
// Mostra a equipa de agentes (Programação, Produto, Design), o fluxo de etapas e os projetos
// com o estado de cada etapa. Lê /api/empresa e /api/empresa/projetos/:id; cria projetos com
// POST /api/empresa/projetos. Não inventa nada: se o servidor não responde, diz isso; se não há
// motor, diz porquê e desativa o botão de criar.
//
// As funções de desenho (`htmlEquipa`, `htmlProjetos`, `htmlProjeto`, `htmlMotor`) são puras,
// para o teste conseguir vê-las sem navegador.

export const ETIQUETA_ESTADO = {
  'por-fazer': 'por fazer',
  'a-correr': 'a correr',
  concluido: 'concluído',
  falhou: 'falhou',
  'sem-motor': 'sem motor',
  'tempo-esgotado': 'tempo esgotado',
  erro: 'erro',
  'sem-ficheiros': 'sem ficheiros',
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nomeDo = (estado, id) => (estado && estado.agentes || []).find((a) => a.id === id)?.nome || id;

/** Motor em uma linha: o que seria usado, ou o motivo de não haver nenhum. */
export function htmlMotor(m = {}) {
  if (m.motor === 'gratis') return '<span class="em-pill ok">motor · gratuito (sem chave)</span>';
  if (m.motor === 'claude-cli') return '<span class="em-pill ok">motor · Claude Code desta máquina</span>';
  if (m.motor === 'api') return `<span class="em-pill ok">motor · API${m.modelo ? ' · ' + esc(m.modelo) : ''}</span>`;
  return `<span class="em-pill off">sem motor — ${esc(m.motivo || 'nenhum motor disponível')}</span>`;
}

/** A equipa, por divisão, com o papel de cada agente. */
export function htmlEquipa(estado) {
  if (!estado) return '';
  return Object.entries(estado.divisoes).map(([id, nome]) => {
    const membros = estado.agentes.filter((a) => a.divisao === id);
    return `<section class="em-div" data-divisao="${esc(id)}">
      <h3>${esc(nome)} <span class="em-n">${membros.length}</span></h3>
      <ul>${membros.map((a) => `<li><b>${esc(a.nome)}</b><span>${esc(a.papel)}</span></li>`).join('')}</ul>
    </section>`;
  }).join('');
}

/** Lista de projetos, o selecionado marcado. */
export function htmlProjetos(projetos = [], selecionado = null) {
  if (!projetos.length) return '<p class="em-vazio">Ainda não há projetos. Cria o primeiro abaixo.</p>';
  return `<ul class="em-lista">${projetos.map((p) => `
    <li><button type="button" data-projeto="${esc(p.id)}" class="${p.id === selecionado ? 'on' : ''}">
      <span class="em-nome">${esc(p.nome)}</span>
      <span class="em-prog">${p.etapasFeitas}/${p.etapasTotal}</span>
      <span class="em-est em-${esc(p.estado)}">${esc(ETIQUETA_ESTADO[p.estado] || p.estado)}</span>
    </button></li>`).join('')}</ul>`;
}

/** Um projeto: cada etapa com o agente, o estado, os ficheiros e o erro, se houver. */
export function htmlProjeto(p, estado) {
  if (!p) return '';
  const etapas = p.etapas.map((e, i) => {
    const fich = (e.ficheiros || []).slice(0, 6);
    return `<li class="em-etapa em-${esc(e.estado)}">
      <span class="em-i">${i + 1}</span>
      <div>
        <b>${esc(nomeDo(estado, e.agente))}</b> <span class="em-fase">${esc(e.fase)}</span>
        <span class="em-est">${esc(ETIQUETA_ESTADO[e.estado] || e.estado)}</span>
        ${fich.length ? `<div class="em-fich">${fich.map((f) => `<code>${esc(f)}</code>`).join(' ')}</div>` : ''}
        ${e.erro ? `<div class="em-erro-t">${esc(e.erro)}</div>` : ''}
      </div>
    </li>`;
  }).join('');
  const passagens = (p.passagens || []).length;
  return `<div class="em-proj-h"><b>${esc(p.nome)}</b> <span class="em-n">${passagens} passagens</span>${p.correndo ? ' <span class="em-pill live">a correr</span>' : ''}</div>
    <ol class="em-etapas">${etapas}</ol>`;
}

export function initEmpresaPainel({ api = '/api', doc = typeof document !== 'undefined' ? document : null, fetchImpl = (...a) => fetch(...a) } = {}) {
  const btn = doc && doc.getElementById('topEmpresa');
  const panel = doc && doc.getElementById('empresaPanel');
  if (!btn || !panel) return null;
  const q = (s) => panel.querySelector(s);
  const P = { motor: q('.em-motor'), equipa: q('.em-equipa'), projetos: q('.em-projetos'), detalhe: q('.em-detalhe'),
    form: q('.em-form'), nome: q('.em-form [name="nome"]'), pedido: q('.em-form [name="pedido"]'), enviar: q('.em-form button[type="submit"]'),
    erro: q('.em-erro'), close: q('.em-close'), sum: q('.em-sum') };
  const S = { estado: null, projetos: [], atual: null, detalhe: null, erro: '', timer: null };

  const open = () => { panel.hidden = false; btn.classList.add('on'); carregar(); };
  const close = () => { panel.hidden = true; btn.classList.remove('on'); pararPoll(); };
  const toggle = () => (panel.hidden ? open() : close());

  function pintar() {
    if (P.erro) P.erro.textContent = S.erro || '';
    if (!S.estado) { if (P.sum) P.sum.textContent = S.erro ? 'servidor não responde' : 'a ler…'; return; }
    if (P.sum) P.sum.textContent = `${S.estado.agentes.length} agentes · ${S.projetos.length} projetos`;
    if (P.motor) P.motor.innerHTML = htmlMotor(S.estado.motor);
    if (P.equipa) P.equipa.innerHTML = htmlEquipa(S.estado);
    if (P.projetos) P.projetos.innerHTML = htmlProjetos(S.projetos, S.atual);
    if (P.detalhe) P.detalhe.innerHTML = S.detalhe ? htmlProjeto(S.detalhe, S.estado) : '<p class="em-vazio">Escolhe um projeto para ver as etapas.</p>';
    if (P.enviar) {
      const sem = S.estado.motor.motor === 'sem-motor';
      P.enviar.disabled = sem;
      P.enviar.title = sem ? (S.estado.motor.motivo || 'sem motor') : 'criar e correr o fluxo';
    }
  }

  async function get(caminho) {
    const r = await fetchImpl(api + caminho);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  async function carregar() {
    try {
      S.estado = await get('/empresa');
      S.projetos = S.estado.projetos;
      S.erro = '';
      if (S.atual) await abrirProjeto(S.atual, { semPintar: true });
    } catch (e) {
      S.erro = `não consegui ler a empresa: ${e.message}`;
    }
    pintar();
    armarPoll();
  }

  async function abrirProjeto(id, { semPintar = false } = {}) {
    S.atual = id;
    try {
      S.detalhe = await get('/empresa/projetos/' + encodeURIComponent(id));
      S.erro = '';
    } catch (e) {
      S.detalhe = null;
      S.erro = `não consegui abrir o projeto: ${e.message}`;
    }
    if (!semPintar) pintar();
  }

  function pararPoll() { if (S.timer) { clearInterval(S.timer); S.timer = null; } }
  function armarPoll() {
    const correndo = S.detalhe && S.detalhe.correndo;
    if (correndo && !S.timer && !panel.hidden) S.timer = setInterval(async () => {
      if (!S.atual) return;
      await abrirProjeto(S.atual);
      if (!S.detalhe || !S.detalhe.correndo) { pararPoll(); carregar(); }
    }, 2500);
    if (!correndo) pararPoll();
  }

  async function criar(ev) {
    ev.preventDefault();
    const nome = P.nome.value.trim();
    const pedido = P.pedido.value.trim();
    if (!nome || !pedido) { S.erro = 'falta o nome ou o pedido'; pintar(); return; }
    P.enviar.disabled = true;
    try {
      const r = await fetchImpl(api + '/empresa/projetos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nome, pedido }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.motivo || j.error || `HTTP ${r.status}`);
      P.nome.value = ''; P.pedido.value = '';
      S.erro = '';
      await carregar();
      await abrirProjeto(j.id);
      pintar();
      armarPoll();
    } catch (e) {
      S.erro = `não criei o projeto: ${e.message}`;
      pintar();
    }
  }

  btn.addEventListener('click', toggle);
  if (P.close) P.close.addEventListener('click', close);
  if (P.form) P.form.addEventListener('submit', criar);
  if (P.projetos) P.projetos.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-projeto]');
    if (b) abrirProjeto(b.getAttribute('data-projeto'));
  });
  doc.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panel.hidden) close(); });

  return { open, close, toggle, carregar, abrirProjeto, _estado: S };
}
