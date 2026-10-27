// Órbita — CONFIGURAÇÕES (29 out 2026).
//
// Pedido do dono: «cria um campo para implementação de APIs, configurações reais, até mudança de
// tema (claro para escuro) e notificações reais».
//
// O painel tem quatro coisas e nenhuma delas é decorativa:
//
//   1 · TEMA      claro · escuro · automático — vale já e fica guardado no browser.
//   2 · APIS      o catálogo real do servidor (`/api/platform/apis`), com o que falta a cada serviço;
//                 um campo por variável, «guardar e testar» escreve a chave no `.env` e SONDA o
//                 serviço — o resultado que apareces é o HTTP e a latência reais (ou o erro real).
//   3 · AVISOS    notificações do browser: a permissão pede-se aqui, num clique; os avisos nascem do
//                 estado real dos postos (à espera do teu OK, falhou).
//   4 · PAINÉIS   recolher o campo de IA e o estado das tarefas. A escolha fica guardada.
//
// Sem servidor (o site publicado) o painel NÃO finge: diz que as chaves vivem na máquina onde o
// Órbita corre, e deixa funcionar o que é do browser (tema, painéis, avisos).

import { THEMES, THEME_LABEL, readTheme, safeStore } from './theme.js';
import { DEPTS, AGENTS, LAYOUT } from './data.js';
import { contarAgentes, corValida, filasNecessarias, gravarAjustes, lerAjustes, profundidadePara } from './salas.js';

/* ---------- o que fica lembrado entre visitas ----------
   Só preferências do browser: o tema (em theme.js), os avisos (em notify.js) e os dois painéis. */
export const PREFS_KEY = 'orbita.paineis';
export function readPrefs(store = safeStore()) {
  try {
    const raw = JSON.parse(store.getItem(PREFS_KEY) || '{}');
    return { ai: !!raw.ai, tasks: !!raw.tasks };
  } catch { return { ai: false, tasks: false }; }
}
export function writePrefs(prefs, store = safeStore()) {
  const p = { ai: !!prefs.ai, tasks: !!prefs.tasks };
  try { store.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* sem armazenamento */ }
  return p;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const KIND_LABEL = {
  ia: 'IA', dados: 'Dados', 'base-de-dados': 'Base de dados', codigo: 'Código', deploy: 'Deploy',
  pagamentos: 'Pagamentos', correio: 'Correio', mensagens: 'Mensagens', voz: 'Voz', api: 'API',
};


/* ---------- falar com o servidor ----------
   A Vercel só alcança a função de `api/` no caminho exacto do ficheiro: não há
   `/api/ops/summary` nem `/api/controlo/estado` (dá 404). O caminho vai dentro do
   pedido, em `/api/rpc` — é o mesmo contrato que a mesa já usa. Antes desta
   versão, este painel pedia `/api/platform/apis` a sério e recebia 404 em
   produção: a lista de APIs nunca aparecia. */
async function pedir(caminho, { metodo = 'GET', corpo = null } = {}) {
  if (metodo === 'GET') {
    const r = await fetch(`/api/rpc?caminho=${encodeURIComponent(caminho)}`, { headers: { accept: 'application/json' } });
    if (r.status === 404 || r.status === 503) return { semServidor: true };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return { dados: j.corpo ?? j, status: j.status ?? 200 };
  }
  const r = await fetch('/api/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caminho, metodo, corpo: corpo ?? {} }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { erro: j.error || `HTTP ${r.status}` };
  if ((j.status || 200) >= 400) return { erro: j.corpo?.error || j.corpo?.erro || `HTTP ${j.status}` };
  return { dados: j.corpo ?? j, status: j.status };
}

/* ---------- 1.20.0 · o Centro de Controlo ----------
   Três marcas por linha, e nenhuma inventada: `configurado` (existe chave),
   `ligado` (o último teste real passou) e `a_funcionar` (houve execuções nas
   últimas 24 h). Vêm do servidor em `/api/controlo/estado`. */
const SELO = {
  sim: { k: 'on', t: 'sim' },
  nao: { k: 'off', t: 'não' },
  prova: { k: 'warn', t: 'por provar' },
};
const selo = (v) => (v === true ? SELO.sim : v === false ? SELO.nao : SELO.prova);
const SALAS = Object.keys(DEPTS).filter((k) => k !== 'brain');

function stateOf(p) {
  if (p.verified) return { k: 'on', t: 'pronta' };
  if (p.configured) return { k: 'warn', t: p.note ? 'configurada' : 'com chave' };
  return { k: 'off', t: 'sem chave' };
}

export function createConfig({
  panel = document.getElementById('cfgPanel'),
  theme = readTheme(),
  onTheme = () => {},
  notify = null,             // o notificador (src/notify.js) — opcional
  collapse = { ai: false, tasks: false },
  onCollapse = () => {},
} = {}) {
  if (!panel) return { open() {}, close() {}, toggle() {}, refresh() {}, isOpen: () => false };
  const body = panel.querySelector('.cfg-body');
  const title = panel.querySelector('.cfg-sum');
  let isOpen = false, busy = false;
  let apis = null;              // { list, summary } do servidor
  let semServidor = false;
  let lastError = '';
  let centro = null;            // /api/controlo/estado
  let ajustes = null;           // o que este browser guardou (cores e agentes)
  let formSala = null;          // sala com o formulário de agente aberto
  let avisoSala = '';           // «recarrega para a cena assentar»

  /* ---------- o tema ---------- */
  function themeRow() {
    return `<div class="cfg-sec">
      <div class="cfg-h"><b>Tema</b><span class="cfg-note">claro · escuro · o que o sistema disser</span></div>
      <div class="cfg-seg" role="radiogroup" aria-label="tema">
        ${THEMES.map((t) => `<button type="button" role="radio" aria-checked="${theme === t}" class="cfg-r${theme === t ? ' on' : ''}" data-theme="${t}">${THEME_LABEL[t]}</button>`).join('')}
      </div>
    </div>`;
  }

  /* ---------- os painéis ---------- */
  function prefsRow() {
    const row = (k, lab, hint) => `<label class="cfg-sw">
        <input type="checkbox" data-collapse="${k}" ${collapse[k] ? 'checked' : ''}>
        <span class="cfg-sw-t">${lab}<i>${hint}</i></span>
      </label>`;
    return `<div class="cfg-sec">
      <div class="cfg-h"><b>Painéis</b><span class="cfg-note">afastar o que não estás a usar</span></div>
      ${row('ai', 'Campo de IA recolhido', 'a caixa de conversa fica numa linha; abre-se com um clique')}
      ${row('tasks', 'Estado das tarefas recolhido', 'a coluna da direita fica só com o título')}
    </div>`;
  }

  /* ---------- os avisos ---------- */
  function notifyRow() {
    const s = notify ? notify.state() : { has: false, granted: false, permission: 'unsupported', enabled: false };
    const why = !s.has ? 'este browser não tem notificações'
      : s.permission === 'denied' ? 'o browser bloqueou as notificações neste sítio — permite nas definições do sítio'
      : semServidor ? 'sem servidor não há trabalho a acontecer — nada para avisar'
      : 'avisos do browser quando um posto fica à espera do teu OK, ou falha';
    return `<div class="cfg-sec">
      <div class="cfg-h"><b>Avisos</b><span class="cfg-note">${esc(why)}</span></div>
      <div class="cfg-line">
        <button type="button" class="cfg-btn${s.enabled && s.granted ? ' on' : ''}" data-act="notify" ${(!s.has || semServidor) ? 'disabled' : ''}>
          ${s.enabled && s.granted ? 'Ligados — desligar' : 'Ligar avisos'}
        </button>
        <button type="button" class="cfg-btn quiet" data-act="notify-test" ${s.granted ? '' : 'disabled'}>Enviar um teste</button>
        <span class="cfg-res">${esc(s.granted ? 'permissão dada' : s.permission === 'denied' ? 'permissão recusada' : s.has ? 'permissão por pedir' : 'sem suporte')}</span>
      </div>
    </div>`;
  }

  /* ---------- as APIs ---------- */
  function apiRow(p) {
    const st = stateOf(p);
    // uma linha por variável: as que faltam pedem a chave, as que já estão dizem que estão (e
    // aceitam outra, para se poder trocar uma chave sem ir ao ficheiro à mão)
    const nomes = (p.env && p.env.length) ? p.env : p.missing;
    const inputs = nomes.map((k) => {
      const falta = (p.missing || []).includes(k);
      return `<label class="cfg-fld">
        <span class="cfg-k">${esc(k)}${falta ? '' : ' · configurada'}</span>
        <input type="password" autocomplete="off" spellcheck="false" data-env="${esc(k)}" placeholder="${falta ? 'cola a chave e guarda — fica só no .env desta máquina' : 'já está — cola outra para substituir'}">
      </label>`;
    }).join('');
    const when = p.checkedAt ? new Date(p.checkedAt) : null;
    const detail = p.configured && p.missing.length === 0
      ? `<span class="cfg-res">${p.verified ? `sonda respondeu${p.status ? ' · HTTP ' + p.status : ''}${p.latencyMs != null ? ' · ' + p.latencyMs + ' ms' : ''}` : p.error ? esc(p.error) : 'com chave, sem sonda recente'}</span>`
      : '';
    return `<div class="cfg-api" data-id="${esc(p.id)}">
      <div class="cfg-api-h">
        <span class="cfg-chip k-${esc(p.kind)}">${esc(KIND_LABEL[p.kind] || p.kind || 'API')}</span>
        <b>${esc(p.name)}</b>
        <span class="cfg-st s-${st.k}"><i></i>${st.t}</span>
        ${p.docs ? `<a class="cfg-doc" href="${esc(p.docs)}" target="_blank" rel="noopener" title="documentação de ${esc(p.name)}">docs ↗</a>` : ''}
      </div>
      ${p.note ? `<p class="cfg-note small">${esc(p.note)}</p>` : ''}
      ${inputs}
      <div class="cfg-line">
        <button type="button" class="cfg-btn" data-act="save" ${p.missing.length === 0 && !p.configured ? 'disabled' : ''}>Guardar e testar</button>
        <button type="button" class="cfg-btn quiet" data-act="test" ${!p.configured ? 'disabled' : ''} title="${p.configured ? 'faz um pedido real a esta integração, agora' : 'sem chave: não há nada para testar'}">Testar ligação</button>
        <button type="button" class="cfg-btn quiet" data-act="clear" ${p.configured ? '' : 'hidden'}>Apagar chave</button>
        ${detail}
        <span class="cfg-out" role="status" aria-live="polite"></span>
      </div>
      ${when && p.verified ? '' : ''}
    </div>`;
  }

  /* ---------- as seis salas ---------- */
  function salaCard(dept) {
    const d = DEPTS[dept];
    const base = AGENTS.filter((a) => a.dept === dept && !a.acrescentado);
    const extras = (ajustes?.agentes || []).filter((a) => a.dept === dept);
    const total = contarAgentes(AGENTS, dept);
    const filas = filasNecessarias(total);
    const capacidade = filas * 2;
    const livres = Math.max(0, capacidade - total);
    const ia = centro?.ia;
    return `<div class="cfg-api" data-sala="${esc(dept)}">
      <div class="cfg-api-h">
        <span class="cfg-swatch" style="background:${esc(d.chip)}" aria-hidden="true"></span>
        <b>${esc(d.name)}</b>
        <span class="cfg-st s-on"><i></i>${total} ${total === 1 ? 'agente' : 'agentes'}</span>
      </div>
      <p class="cfg-note small">${filas} ${filas === 1 ? 'fila' : 'filas'} · ${livres} ${livres === 1 ? 'lugar livre' : 'lugares livres'} · ${extras.length ? 'sala ampliada pelos agentes novos' : 'na planta original'}</p>
      <div class="cfg-line">
        <label class="cfg-fld cfg-cor">
          <span class="cfg-k">cor da sala</span>
          <input type="color" value="${esc(d.chip)}" data-cor="${esc(dept)}" aria-label="cor da sala ${esc(d.name)}">
        </label>
        <button type="button" class="cfg-btn quiet" data-mais="${esc(dept)}">+ agente</button>
        ${extras.map((a) => `<button type="button" class="cfg-btn quiet" data-menos="${esc(a.id)}" data-dept="${esc(dept)}" title="tirar ${esc(a.nome)}">× ${esc(a.nome)}</button>`).join('')}
      </div>
      <label class="cfg-fld cfg-tam">
        <span class="cfg-k">profundidade · ${Number(LAYOUT[dept]?.d || 0).toFixed(1)} m</span>
        <input type="range" min="${profundidadePara(filasNecessarias(total)).toFixed(1)}" max="${(profundidadePara(filasNecessarias(total)) + 20).toFixed(1)}" step="0.5"
          value="${Number(LAYOUT[dept]?.d || 0).toFixed(1)}" data-tamanho="${esc(dept)}"
          data-minimo="${profundidadePara(filasNecessarias(total)).toFixed(1)}" aria-label="profundidade da sala ${esc(d.name)}">
      </label>
      ${formSala === dept ? `<div class="cfg-line">
        <label class="cfg-fld"><span class="cfg-k">nome do agente</span>
          <input type="text" data-novo-nome placeholder="ex.: Gestor de tráfego" maxlength="28" autocomplete="off"></label>
        <label class="cfg-fld"><span class="cfg-k">função</span>
          <input type="text" data-novo-funcao placeholder="o que ele faz" maxlength="120" autocomplete="off"></label>
        <button type="button" class="cfg-btn" data-criar="${esc(dept)}">Acrescentar</button>
        <button type="button" class="cfg-btn quiet" data-cancelar="1">Cancelar</button>
      </div>` : ''}
      ${base.length ? '' : `<p class="cfg-honest">Esta sala está sem agentes de origem — só tem os que acrescentares.</p>`}
      ${ia ? '' : ''}
    </div>`;
  }

  function centroSection() {
    if (semServidor) return '';
    const ia = centro?.ia;
    const ex = centro?.execucao;
    const seg = centro?.seguranca;
    const salas = SALAS.map(salaCard).join('');
    const ligados = ia ? (ia.funcionais || []) : [];
    return `<div class="cfg-sec">
      <div class="cfg-h"><b>Centro de Controlo</b><span class="cfg-note">${centro ? `estado real · ${esc(centro.versao || '')}` : 'a ler o estado…'}</span></div>
      <p class="cfg-honest">Cada serviço tem três marcas separadas: <b>configurado</b> (existe chave), <b>ligado</b>
      (o último teste real passou) e <b>a funcionar</b> (houve trabalho nas últimas 24 h). Nada disto é estimado.</p>

      <div class="cfg-group"><h4>As seis salas</h4><div class="cfg-salas">${salas}</div></div>

      ${avisoSala ? `<p class="cfg-honest">${esc(avisoSala)} <button type="button" class="cfg-btn" data-act="recarregar">Recarregar a cena</button></p>` : ''}

      <div class="cfg-group"><h4>Inteligência</h4>
        <p class="cfg-note small">
          <span class="cfg-st s-${ia?.pronto ? 'on' : 'off'}"><i></i>motor ${ia?.pronto ? 'pronto' : 'sem fornecedor'}</span>
          · ${ia?.comChave || 0} configurados · ${ligados.length} ligados ${ligados.length ? `(${esc(ligados.slice(0, 6).join(', '))}${ligados.length > 6 ? '…' : ''})` : ''} · ${ia?.porTestar || 0} por testar
        </p>
      </div>

      <div class="cfg-group"><h4>Execução</h4>
        <p class="cfg-note small">
          <span class="cfg-st s-${ex?.a_funcionar ? 'on' : 'warn'}"><i></i>${ex?.a_funcionar ? 'a funcionar' : 'parado'}</span>
          · ${ex?.runs24h || 0} execuções em 24 h · ${ex?.chamadas24h || 0} chamadas a modelos
          ${ex?.ultimaChamada ? `· última ${esc(new Date(ex.ultimaChamada).toLocaleString())}` : '· sem chamadas registadas'}
        </p>
      </div>

      <div class="cfg-group"><h4>Registo de alterações</h4>
        ${(centro?.registo || []).length
          ? `<ul class="cfg-reg">${centro.registo.slice(0, 6).map((r) => `<li><span>${esc(new Date(r.quando).toLocaleString())}</span> ${esc(r.o_que)} <i>${esc(r.quem)}</i></li>`).join('')}</ul>`
          : `<p class="cfg-note small">sem alterações registadas — as mudanças de salas ficam aqui com hora e autor (o único perfil desta instalação é «dono»).</p>`}
      </div>

      <div class="cfg-group"><h4>Segurança</h4>
        <p class="cfg-note small">
          login <b>${seg?.autenticacao ? 'activo' : 'não configurado'}</b> · chaves no servidor <b>${seg?.chavesNoServidor ? 'sim' : 'não'}</b>
          · aprovação humana <b>${seg?.aprovacaoHumana ? 'sim' : 'não'}</b>
        </p>
        ${seg?.nota ? `<p class="cfg-honest">${esc(seg.nota)}</p>` : ''}
      </div>
    </div>`;
  }

  function apisSection() {
    if (semServidor) {
      return `<div class="cfg-sec">
        <div class="cfg-h"><b>APIs</b><span class="cfg-note">as chaves vivem na máquina onde o Órbita corre</span></div>
        <p class="cfg-honest">Esta é a vista publicada: não há servidor aqui, por isso não há `.env` para escrever nem
        sondas para correr. Na tua máquina — <code>npm start</code> — este mesmo painel lista os serviços, aceita as
        chaves e sonda cada um a sério. Nada é guardado no browser.</p>
      </div>`;
    }
    if (!apis) {
      return `<div class="cfg-sec"><div class="cfg-h"><b>APIs</b><span class="cfg-note">a ler o catálogo do servidor…</span></div>
        ${lastError ? `<p class="cfg-honest">${esc(lastError)}</p>` : ''}</div>`;
    }
    const s = apis.summary || {};
    const prontas = apis.list.filter((p) => p.verified).length;
    const grupos = ['ia', 'dados', 'base-de-dados', 'codigo', 'deploy', 'pagamentos', 'correio', 'mensagens', 'api'];
    const outros = apis.list.filter((p) => !grupos.includes(p.kind));
    const porTipo = [...grupos.filter((g) => apis.list.some((p) => p.kind === g)), ...(outros.length ? ['outros'] : [])];
    const lista = (k) => apis.list.filter((p) => (k === 'outros' ? !grupos.includes(p.kind) : p.kind === k));
    return `<div class="cfg-sec">
      <div class="cfg-h"><b>APIs</b><span class="cfg-note">${prontas} com sonda a responder · ${s.configured || 0} com chave · ${s.total || apis.list.length} no catálogo</span></div>
      <p class="cfg-honest">Aqui vê-se o que existe no ambiente do servidor e o que falta a cada serviço. Escrever
      chaves pela interface só funciona na tua máquina (<code>npm start</code>); em produção as variáveis são
      geridas na Vercel (Settings → Environment Variables) e esta aba diz isso em vez de fingir que guardou.</p>
      ${porTipo.map((k) => `<div class="cfg-group"><h4>${esc(KIND_LABEL[k] || 'Outros')}</h4>${lista(k).map(apiRow).join('')}</div>`).join('')}
    </div>`;
  }

  function render() {
    if (!body) return;
    body.innerHTML = themeRow() + centroSection() + apisSection() + notifyRow() + prefsRow();
    if (title) title.textContent = semServidor ? 'sem servidor · configurações do browser' : 'esta máquina';
    wire();
  }

  async function loadApis() {
    if (busy) return; busy = true;
    try {
      const r = await pedir('/platform/apis');
      if (r.semServidor) { semServidor = true; apis = null; lastError = ''; }
      else if (!r.dados?.list) { lastError = 'o catálogo não abriu'; apis = null; }
      else { apis = r.dados; semServidor = false; lastError = ''; }
    } catch (e) {
      semServidor = false; apis = null; lastError = `sem resposta do servidor: ${e.message}`;
    }
    busy = false;
    render();
  }

  async function loadCentro() {
    try {
      const r = await pedir('/controlo/estado');
      if (r.semServidor) { semServidor = true; centro = null; }
      else { centro = r.dados || null; semServidor = false; if (centro?.ajustes) ajustes = centro.ajustes; }
    } catch (e) { centro = null; lastError = `Centro de Controlo: ${e.message}`; }
    render();
  }

  /** Guarda no servidor e neste browser. A cena só muda no próximo arranque —
   *  e é isso que o aviso diz, em vez de fingir que já mudou. */
  async function guardarSalas(pedido, { metodo = 'POST', caminho = '/controlo/salas', pintadas = 0 } = {}) {
    let servidorOk = false, erro = '';
    const r = await pedir(caminho, { metodo, corpo: pedido || {} }).catch((e) => ({ erro: 'sem resposta do servidor: ' + e.message }));
    if (r?.erro) erro = r.erro;
    else { servidorOk = true; if (r?.dados?.ajustes) ajustes = r.dados.ajustes; }

    /* a cópia local é o que a cena consegue ler sem esperar por rede */
    if (ajustes) gravarAjustes(safeStore(), ajustes);
    const cena = pintadas > 0
      ? `Cor aplicada agora mesmo em ${pintadas} peças da sala.`
      : 'A cena aplica isto no próximo arranque.';
    avisoSala = servidorOk ? `Guardado. ${cena}` : `Guardado só neste browser (${erro}). ${cena}`;
    formSala = null;
    render();
  }

  /* ---------- os gestos ---------- */
  async function saveKey(row) {
    const id = row.getAttribute('data-id');
    const out = row.querySelector('.cfg-out');
    const values = {};
    for (const inp of row.querySelectorAll('input[data-env]')) {
      const v = String(inp.value || '').trim();
      if (v) values[inp.getAttribute('data-env')] = v;
    }
    if (!Object.keys(values).length) { if (out) out.textContent = 'escreve a chave primeiro'; return; }
    const btn = row.querySelector('[data-act="save"]');
    if (btn) { btn.disabled = true; btn.textContent = 'a guardar e a sondar…'; }
    if (out) { out.className = 'cfg-out'; out.textContent = ''; }
    try {
      const r = await pedir('/platform/key', { metodo: 'POST', corpo: { id, values } });
      if (r.erro) {
        /* em produção as variáveis são só de leitura: diz-se, não se finge */
        if (out) { out.className = 'cfg-out bad'; out.textContent = r.erro; }
        return;
      }
      const j = r.dados || {};
      for (const inp of row.querySelectorAll('input[data-env]')) inp.value = '';
      const pr = j.probe;
      const msg = pr
        ? (pr.ok ? `✓ respondeste — HTTP ${pr.status}${pr.ms != null ? ' · ' + pr.ms + ' ms' : ''}` : `✗ ${pr.error || 'sem resposta'}${pr.status ? ' · HTTP ' + pr.status : ''}`)
        : (j.missing && j.missing.length ? `guardado — falta ${j.missing.join(', ')}` : 'guardado');
      if (out) { out.className = 'cfg-out ' + (pr && pr.ok ? 'good' : pr ? 'bad' : 'warn'); out.textContent = msg; }
      if (j.apis) { apis = j.apis; semServidor = false; }
      setTimeout(() => { loadApis(); }, pr ? 900 : 300);
    } catch (e) {
      if (out) { out.className = 'cfg-out bad'; out.textContent = 'sem resposta do servidor: ' + e.message; }
    } finally {
      const b = row.querySelector('[data-act="save"]');
      if (b) { b.disabled = false; b.textContent = 'Guardar e testar'; }
    }
  }

  async function clearKey(row) {
    const id = row.getAttribute('data-id');
    const out = row.querySelector('.cfg-out');
    const p = apis && apis.list.find((x) => x.id === id);
    if (!p) return;
    const values = {};
    const alvo = (p.env && p.env.length) ? p.env : (p.missing || []);
    if (!alvo.length) { if (out) out.textContent = 'nada a apagar'; return; }
    for (const k of alvo) values[k] = '';
    try {
      const r = await pedir('/platform/key', { metodo: 'POST', corpo: { id, values } });
      if (out) { out.className = 'cfg-out ' + (r.erro ? 'bad' : 'warn'); out.textContent = r.erro || 'chave apagada'; }
      setTimeout(() => loadApis(), 400);
    } catch (e) {
      if (out) { out.className = 'cfg-out bad'; out.textContent = 'sem resposta: ' + e.message; }
    }
  }

  /* 1.22.0 · o botão «Testar ligação»: um pedido real, agora, a esta integração.
     Sem chave o servidor responde «falta X» — e é isso que se mostra. */
  async function testarIntegracao(row) {
    const id = row.getAttribute('data-id');
    const out = row.querySelector('.cfg-out');
    const btn = row.querySelector('[data-act="test"]');
    const antes = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'a testar…'; }
    if (out) { out.className = 'cfg-out'; out.textContent = ''; }
    try {
      const r = await pedir('/platform/testar', { metodo: 'POST', corpo: { id } });
      const d = r.dados || {};
      const texto = d.ok
        ? `✓ ${d.nome || id} ligou${d.status ? ' · HTTP ' + d.status : ''}${d.ms != null ? ' · ' + d.ms + ' ms' : ''}${d.modelo ? ' · ' + d.modelo : ''}${d.detalhe ? ' · ' + d.detalhe : ''}${d.resposta ? ` · «${d.resposta}»` : ''}`
        : `✗ ${d.erro || r.erro || 'sem resposta'}`;
      if (out) { out.className = 'cfg-out ' + (d.ok ? 'good' : 'bad'); out.textContent = texto; }
      if (d.ok || d.erro) setTimeout(() => loadApis(), 700);
    } catch (e) {
      if (out) { out.className = 'cfg-out bad'; out.textContent = 'sem resposta do servidor: ' + e.message; }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = antes || 'Testar ligação'; }
    }
  }

  function wire() {
    if (!body) return;
    body.querySelectorAll('[data-theme]').forEach((b) => {
      b.addEventListener('click', () => {
        theme = b.getAttribute('data-theme');
        onTheme(theme);
        render();
      });
    });
    body.querySelectorAll('[data-collapse]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const k = inp.getAttribute('data-collapse');
        collapse = { ...collapse, [k]: !!inp.checked };
        onCollapse(k, !!inp.checked);
      });
    });
    const nb = body.querySelector('[data-act="notify"]');
    if (nb) nb.addEventListener('click', async () => {
      if (!notify) return;
      const s = notify.state();
      const r = s.granted && s.enabled ? notify.setEnabled(false) : await notify.ask();
      render();
      if (r && r.ok === false && r.error) {
        const res = body.querySelector('.cfg-res');
        if (res) res.textContent = r.error;
      }
    });
    const nt = body.querySelector('[data-act="notify-test"]');
    if (nt) nt.addEventListener('click', () => {
      if (notify) notify.show({ id: 'teste', state: 'waiting', task: 'teste das configurações' });
    });
    /* --- Centro de Controlo --- */
    body.querySelectorAll('[data-cor]').forEach((inp) => {
      inp.addEventListener('change', () => {
        const dept = inp.getAttribute('data-cor');
        const cor = String(inp.value || '').trim();
        if (!corValida(cor)) { avisoSala = 'essa cor não é válida (#rrggbb)'; render(); return; }
        if (DEPTS[dept]) DEPTS[dept].chip = cor;      // a interface mostra já
        /* 1.21.0: se a cena estiver viva e souber repintar, muda AGORA */
        let pintadas = 0;
        try { pintadas = window.ORBITA?.recolor?.(dept, cor) || 0; } catch { pintadas = 0; }
        guardarSalas({ cor }, { caminho: `/controlo/salas/${encodeURIComponent(dept)}/cor`, pintadas });
      });
    });
    body.querySelectorAll('[data-tamanho]').forEach((inp) => {
      /* mostra o valor enquanto se arrasta; grava ao largar (um pedido, não vinte) */
      const eco = () => { const k = inp.closest('.cfg-fld')?.querySelector('.cfg-k'); if (k) k.textContent = `profundidade · ${Number(inp.value).toFixed(1)} m`; };
      inp.addEventListener('input', eco);
      inp.addEventListener('change', () => {
        const dept = inp.getAttribute('data-tamanho');
        const d = Number(inp.value);
        const minimo = Number(inp.getAttribute('data-minimo')) || 8;
        guardarSalas({ d, minimo, base: minimo }, { caminho: `/controlo/salas/${encodeURIComponent(dept)}/tamanho` });
      });
    });
    body.querySelectorAll('[data-mais]').forEach((b) => {
      b.addEventListener('click', () => { formSala = b.getAttribute('data-mais'); render(); });
    });
    const cancelar = body.querySelector('[data-cancelar]');
    if (cancelar) cancelar.addEventListener('click', () => { formSala = null; render(); });
    body.querySelectorAll('[data-criar]').forEach((b) => {
      b.addEventListener('click', () => {
        const dept = b.getAttribute('data-criar');
        const nome = body.querySelector('[data-novo-nome]')?.value || '';
        const funcao = body.querySelector('[data-novo-funcao]')?.value || '';
        const existentesNaSala = contarAgentes(AGENTS, dept) - (ajustes?.agentes || []).filter((a) => a.dept === dept).length;
        guardarSalas({ nome, dept, funcao, existentesNaSala }, { caminho: '/controlo/agentes' });
      });
    });
    body.querySelectorAll('[data-menos]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.getAttribute('data-menos');
        if (ajustes) ajustes = { ...ajustes, agentes: (ajustes.agentes || []).filter((a) => a.id !== id) };
        guardarSalas({}, { metodo: 'DELETE', caminho: `/controlo/agentes/${encodeURIComponent(id)}` });
      });
    });
    const recarregar = body.querySelector('[data-act="recarregar"]');
    if (recarregar) recarregar.addEventListener('click', () => location.reload());

    body.querySelectorAll('.cfg-api').forEach((row) => {
      const sv = row.querySelector('[data-act="save"]');
      if (sv) sv.addEventListener('click', () => saveKey(row));
      const cl = row.querySelector('[data-act="clear"]');
      if (cl) cl.addEventListener('click', () => clearKey(row));
      const ts = row.querySelector('[data-act="test"]');
      if (ts) ts.addEventListener('click', () => testarIntegracao(row));
      row.querySelectorAll('input[data-env]').forEach((inp) => {
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(row); } });
      });
    });
  }

  /* ---------- abrir / fechar ---------- */
  function show(on) {
    isOpen = !!on;
    panel.hidden = !isOpen;
    panel.setAttribute('aria-hidden', String(!isOpen));
    document.body.classList.toggle('cfg-on', isOpen);
    const btn = document.getElementById('topCfg');
    if (btn) btn.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      ajustes = lerAjustes(safeStore());
      render();
      loadApis();
      loadCentro();
      const first = panel.querySelector('button, input');
      if (first) setTimeout(() => first.focus(), 30);
    }
  }
  const close = () => show(false);
  const open = () => show(true);
  const toggle = () => show(!isOpen);

  panel.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) { e.stopPropagation(); close(); } }, true);

  /** Actualizado de fora quando o tema ou os avisos mudam noutro sítio. */
  function refresh(patch = {}) {
    if (patch.theme) theme = patch.theme;
    if (patch.collapse) collapse = { ...collapse, ...patch.collapse };
    if (isOpen) render();
  }

  return { open, close, toggle, refresh, isOpen: () => isOpen, _save: saveKey };
}
