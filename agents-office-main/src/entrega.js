/* ===========================================================================
   1.80.0 · A ABA DE ENTREGA (9 nov 2026)

   Pedido do dono: «no próprio sistema deve ser possível ali mesmo uma aba de
   visualização e execução da app, … logo que acabar a tarefa, possibilidade de
   execução e baixar o arquivo em zip, os sites».

   O que isto faz, sem marketing:
     · mostra os sites que as salas produziram, lidos do servidor (`/artefactos`);
     · abre o site **aqui dentro**, num `<iframe sandbox>` alimentado por
       `srcdoc` — o CSS entra inline, o site corre sem pedir nada à rede;
     · deixa **descarregar o .zip** com os três ficheiros, gerado no servidor
       (bytes a sério, com sha256) — o download é uma cópia do que está à vista;
     · cria um site novo a partir de um brief curto, para o ciclo ser testável
       de ponta a ponta na própria aba.

   Regras que este ficheiro não quebra:
     · nada é inventado — sem servidor, a aba abre e diz porquê; sem artefactos,
       diz que não há nenhum;
     · o site corre em `sandbox=""`: sem scripts, sem mesma-origem, sem acesso
       ao escritório (o gerador já não escreve `<script>`, e o sandbox garante-o
       mesmo que um dia escreva);
     · aprovar é um acto humano e assinado — o botão manda `por`, e o servidor
       recusa sem isso.
   =========================================================================== */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** O nome do ficheiro a descarregar: sem acentos, sem barras, sem espaços, um só .zip. */
export function nomeDoPacote(id) {
  const bruto = String(id || 'site').replace(/\.zip$/i, '');
  const base = bruto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^[.\-_]+/, '')       // nada de «../» disfarçado no nome do ficheiro
    .replace(/[.\-_]+$/, '')
    .slice(0, 60);
  return `${base || 'site'}.zip`;
}

/**
 * Junta os ficheiros do artefacto numa só página para o `srcdoc`.
 * O `index.html` que o servidor gera aponta para `estilo.css`: aqui o CSS entra
 * dentro de `<style>`, senão o `srcdoc` (que não tem pasta) ficava sem estilo.
 */
export function paginaParaVer(files = {}) {
  const html = String(files['index.html'] || '');
  const css = String(files['estilo.css'] || '');
  if (!html) return '';
  let out = html;
  // remove o <link> para o CSS local (com ou sem atributos pela frente/atrás)
  out = out.replace(/<link\b[^>]*href=["']estilo\.css["'][^>]*>/gi, '');
  if (css) {
    const bloco = `<style>\n${css}\n</style>`;
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${bloco}\n</head>`) : bloco + out;
  }
  return out;
}

/** O que se diz de um artefacto, em português e sem adjectivos. */
export function estadoDoArtefacto(art = {}) {
  const estado = String(art.estado || 'rascunho');
  const aprovado = estado === 'aprovado';
  return {
    chave: aprovado ? 'aprovado' : 'rascunho',
    rotulo: aprovado ? 'aprovado' : 'rascunho',
    porque: aprovado
      ? `aprovado por ${art.aprovadoPor || 'alguém'}${art.publicadoEm ? ` em ${String(art.publicadoEm).slice(0, 10)}` : ''} — o pacote pode ir para o alojamento`
      : 'ninguém aprovou este site ainda: podes ver e descarregar, mas não está publicado',
  };
}

/** Os bytes que vêm do servidor em base64, descodificados. Sem `Buffer` no browser. */
export function base64ParaBytes(b64) {
  const s = String(b64 || '');
  if (!s) return new Uint8Array(0);
  if (typeof atob === 'function') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array(0);
}

const CSS = `
#entrega { position: fixed; inset: 0; z-index: 74; display: grid; place-items: center; padding: 22px;
  background: rgba(10,11,14,.52); backdrop-filter: blur(18px) saturate(130%); -webkit-backdrop-filter: blur(18px) saturate(130%);
  animation: egIn .18s var(--ease, cubic-bezier(.2,.8,.2,1)) both;
  font-family: var(--ui, -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif); }
#entrega[hidden] { display: none; }
@keyframes egIn { from { opacity: 0 } to { opacity: 1 } }
#entrega .eg-sheet {
  width: min(1120px, 100%); height: min(86vh, 880px); display: flex; flex-direction: column; overflow: hidden;
  border-radius: 22px; color: var(--ink, #151414);
  background: var(--cream, #FDFFF8);
  border: 1px solid var(--hairline, rgba(21,20,20,.12));
  box-shadow: 0 40px 110px rgba(10,10,12,.4);
}
#entrega header { display: flex; align-items: center; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--hairline, rgba(21,20,20,.1)); }
#entrega h2 { margin: 0; font-size: 15px; letter-spacing: .1em; text-transform: uppercase; }
#entrega .eg-sub { margin: 2px 0 0; font-size: 11px; opacity: .62; letter-spacing: .02em; }
#entrega .eg-x { margin-left: auto; width: 38px; height: 38px; min-width: 38px; border-radius: 50%; cursor: pointer;
  background: none; border: 1px solid var(--hairline, rgba(21,20,20,.14)); color: inherit; font: inherit; }
#entrega .eg-x:hover { background: rgba(21,20,20,.06); }
#entrega .eg-body { flex: 1; display: grid; grid-template-columns: 268px 1fr; min-height: 0; }
#entrega .eg-side { border-right: 1px solid var(--hairline, rgba(21,20,20,.1)); display: flex; flex-direction: column; min-height: 0; }
#entrega .eg-lista { overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
#entrega .eg-item { text-align: left; width: 100%; cursor: pointer; padding: 9px 10px; border-radius: 11px; font: inherit;
  background: none; border: 1px solid transparent; color: inherit; }
#entrega .eg-item:hover { background: rgba(21,20,20,.045); }
#entrega .eg-item.on { border-color: var(--ink, #151414); background: rgba(21,20,20,.05); }
#entrega .eg-item b { display: block; font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#entrega .eg-item span { display: block; margin-top: 2px; font-size: 9.5px; letter-spacing: .07em; text-transform: uppercase; opacity: .6; }
#entrega .eg-novo { margin: 0 10px 10px; padding: 9px 10px; border-radius: 11px; cursor: pointer; font: inherit;
  border: 1px dashed var(--hairline, rgba(21,20,20,.25)); background: none; color: inherit; font-size: 11px; }
#entrega .eg-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
#entrega .eg-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px; border-bottom: 1px solid var(--hairline, rgba(21,20,20,.1)); }
#entrega .eg-bar b { font-size: 12.5px; }
#entrega .eg-tag { padding: 3px 8px; border-radius: 99px; font-size: 8.5px; letter-spacing: .1em; text-transform: uppercase;
  border: 1px solid var(--hairline, rgba(21,20,20,.2)); }
#entrega .eg-tag.ok { border-color: #1E9070; color: #1E9070; }
#entrega .eg-btn { padding: 7px 11px; border-radius: 9px; cursor: pointer; font: inherit; font-size: 10.5px; letter-spacing: .06em;
  text-transform: uppercase; border: 1px solid var(--ink, #151414); background: var(--ink, #151414); color: var(--cream, #FDFFF8); }
#entrega .eg-btn.quiet { background: none; color: inherit; border-color: var(--hairline, rgba(21,20,20,.24)); }
#entrega .eg-btn:disabled { opacity: .45; cursor: not-allowed; }
#entrega .eg-stage { flex: 1; position: relative; min-height: 0; background: #E9EAE4; display: grid; place-items: center; }
#entrega iframe { width: 100%; height: 100%; border: 0; background: #fff; }
#entrega .eg-vazio { padding: 28px; text-align: center; font-size: 12.5px; line-height: 1.6; max-width: 420px; opacity: .78; }
#entrega .eg-nota { padding: 8px 14px 11px; font-size: 10.5px; line-height: 1.5; opacity: .72; border-top: 1px solid var(--hairline, rgba(21,20,20,.08)); }
#entrega .eg-form { padding: 14px; display: grid; gap: 8px; grid-template-columns: 1fr 1fr; align-content: start; }
#entrega .eg-form label { display: flex; flex-direction: column; gap: 3px; font-size: 9.5px; letter-spacing: .09em; text-transform: uppercase; opacity: .8; }
#entrega .eg-form input { font: inherit; font-size: 13px; padding: 8px 9px; border-radius: 8px;
  border: 1px solid var(--hairline, rgba(21,20,20,.22)); background: #fff; color: inherit; }
#entrega .eg-form .eg-full { grid-column: 1 / -1; }
body.dark #entrega .eg-sheet { background: #17181C; color: #ECEAE3; border-color: rgba(236,234,227,.14); }
body.dark #entrega .eg-form input { background: #101114; color: #ECEAE3; border-color: rgba(236,234,227,.18); }
body.dark #entrega .eg-btn { background: #ECEAE3; color: #15161A; border-color: #ECEAE3; }
body.dark #entrega .eg-btn.quiet { background: none; color: #ECEAE3; border-color: rgba(236,234,227,.24); }
body.dark #entrega .eg-stage { background: #0D0E11; }
/* telemóvel: a folha ocupa o ecrã e a lista passa a uma faixa horizontal por cima */
@media (max-width: 760px) {
  #entrega { padding: 0; }
  #entrega .eg-sheet { width: 100%; height: 100%; border-radius: 0; border: 0; }
  #entrega .eg-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  #entrega .eg-side { border-right: 0; border-bottom: 1px solid var(--hairline, rgba(21,20,20,.1)); max-height: 34vh; }
  #entrega .eg-lista { flex-direction: row; overflow-x: auto; overflow-y: hidden; }
  #entrega .eg-item { min-width: 168px; }
  #entrega .eg-x { width: 44px; height: 44px; min-width: 44px; }
  #entrega .eg-form { grid-template-columns: 1fr; }
  #entrega .eg-btn { min-height: 44px; }
  /* 1.81.0 · 16 px: abaixo disto o iOS amplia a página ao tocar no campo, e o
     utilizador fica com um formulário meio fora do ecrã. Vale para todos. */
  #entrega .eg-form input { font-size: 16px; }
  #entrega .eg-item b { white-space: normal; }   /* em lista horizontal, o título não se corta a meio */
}
`;

/**
 * A aba. `fetchImpl` e `doc` entram por parâmetro para se poder provar sem browser.
 * `aoMudar` é chamado sempre que a lista muda (para a cena poder reagir, se um dia quiser).
 */
export function createEntrega({ doc = globalThis.document, fetchImpl = globalThis.fetch, aoMudar = null, urlApi = globalThis.URL } = {}) {
  const estado = { aberto: false, itens: [], escolhido: null, files: null, erro: '', carregando: false, modo: 'ver', nota: '' };
  let raiz = null, listaEl = null, palcoEl = null, barraEl = null, notaEl = null, formEl = null;

  function garantirCss() {
    if (doc.getElementById('entrega-css')) return;
    const s = doc.createElement('style');
    s.id = 'entrega-css';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function garantirDom() {
    if (raiz) return;
    garantirCss();
    raiz = doc.createElement('div');
    raiz.id = 'entrega';
    raiz.hidden = true;
    raiz.setAttribute('role', 'dialog');
    raiz.setAttribute('aria-modal', 'true');
    raiz.setAttribute('aria-label', 'entrega: ver o site, executar e descarregar');
    raiz.innerHTML = `
      <div class="eg-sheet">
        <header>
          <div>
            <h2>Entrega</h2>
            <p class="eg-sub">o site que a sala produziu — ver aqui dentro, e levar em .zip</p>
          </div>
          <button class="eg-x" data-acao="fechar" title="fechar (Esc)" aria-label="fechar">✕</button>
        </header>
        <div class="eg-body">
          <aside class="eg-side">
            <div class="eg-lista" role="list"></div>
            <button class="eg-novo" data-acao="novo">+ criar um site</button>
          </aside>
          <section class="eg-main">
            <div class="eg-bar"></div>
            <div class="eg-stage"></div>
            <div class="eg-nota" aria-live="polite"></div>
          </section>
        </div>
      </div>`;
    doc.body.appendChild(raiz);
    listaEl = raiz.querySelector('.eg-lista');
    palcoEl = raiz.querySelector('.eg-stage');
    barraEl = raiz.querySelector('.eg-bar');
    notaEl = raiz.querySelector('.eg-nota');

    raiz.addEventListener('click', (e) => {
      const alvo = e.target.closest('[data-acao]');
      if (!alvo) { if (e.target === raiz) fechar(); return; }
      const acao = alvo.dataset.acao;
      if (acao === 'fechar') fechar();
      else if (acao === 'novo') { estado.modo = 'novo'; estado.nota = ''; pintar(); }
      else if (acao === 'novo-cancelar') { estado.modo = 'ver'; pintar(); }
      else if (acao === 'escolher') escolher(alvo.dataset.id);
      else if (acao === 'zip') descarregar();
      else if (acao === 'aprovar') aprovar();
      else if (acao === 'criar') criar(alvo.closest('.eg-form'));
    });
    raiz.addEventListener('submit', (e) => { e.preventDefault(); criar(e.target); });
  }

  function pintarLista() {
    if (!listaEl) return;
    if (!estado.itens.length) {
      listaEl.innerHTML = `<div class="eg-vazio" style="padding:14px 8px;font-size:11.5px">${
        estado.erro ? esc(estado.erro) : 'Nenhum site criado ainda. Escreve uma tarefa na barra, ou cria um aqui.'}</div>`;
      return;
    }
    listaEl.innerHTML = estado.itens.map((a) => {
      const e = estadoDoArtefacto(a);
      return `<button class="eg-item${a.id === estado.escolhido ? ' on' : ''}" data-acao="escolher" data-id="${esc(a.id)}" role="listitem">
        <b>${esc(a.nome || a.id)}</b><span>${esc(e.rotulo)} · ${esc(String(a.criadoEm || '').slice(0, 10))}</span>
      </button>`;
    }).join('');
  }

  function pintarBarra() {
    const art = estado.itens.find((a) => a.id === estado.escolhido) || null;
    if (!barraEl) return;
    if (!art) { barraEl.innerHTML = '<b>nada escolhido</b>'; return; }
    const e = estadoDoArtefacto(art);
    barraEl.innerHTML = `
      <b>${esc(art.nome || art.id)}</b>
      <span class="eg-tag${e.chave === 'aprovado' ? ' ok' : ''}" title="${esc(e.porque)}">${esc(e.rotulo)}</span>
      <span class="eg-sub" style="margin:0">${(art.ficheiros || []).length} ficheiro(s)</span>
      <span style="flex:1"></span>
      ${e.chave === 'aprovado' ? '' : '<button class="eg-btn quiet" data-acao="aprovar">aprovar</button>'}
      <button class="eg-btn" data-acao="zip" ${estado.files ? '' : 'disabled'}>descarregar .zip</button>`;
  }

  function pintarPalco() {
    if (!palcoEl) return;
    if (estado.modo === 'novo') {
      palcoEl.innerHTML = formulario();
      formEl = palcoEl.querySelector('.eg-form');
      return;
    }
    if (estado.erro) { palcoEl.innerHTML = `<div class="eg-vazio">${esc(estado.erro)}</div>`; return; }
    if (estado.carregando) { palcoEl.innerHTML = '<div class="eg-vazio">a ler o site do servidor…</div>'; return; }
    const pagina = estado.files ? paginaParaVer(estado.files) : '';
    if (!pagina) {
      palcoEl.innerHTML = `<div class="eg-vazio">${
        estado.itens.length
          ? 'Escolhe um site à esquerda para o ver aqui dentro.'
          : 'Ainda não há nada para ver. Um site nasce de uma tarefa — ou do botão «criar um site».'}</div>`;
      return;
    }
    palcoEl.innerHTML = `<iframe title="pré-visualização do site" sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(pagina)}"></iframe>`;
  }

  function formulario() {
    return `<form class="eg-form" autocomplete="off">
      <label class="eg-full">Nome do negócio<input name="nome" required maxlength="80" placeholder="Salão Bela Vista"></label>
      <label>Actividade<input name="atividade" maxlength="60" placeholder="cabeleireiro"></label>
      <label>Cidade<input name="cidade" maxlength="60" placeholder="Lisboa"></label>
      <label>Telefone<input name="telefone" maxlength="24" inputmode="tel" placeholder="+351 210 001 122"></label>
      <label>Email<input name="email" maxlength="80" inputmode="email" placeholder="ola@salao.pt"></label>
      <div class="eg-full" style="display:flex;gap:8px;margin-top:4px">
        <button class="eg-btn" type="submit">criar o site</button>
        <button class="eg-btn quiet" type="button" data-acao="novo-cancelar">voltar</button>
      </div>
    </form>`;
  }

  function pintar() {
    if (!raiz) return;
    pintarLista(); pintarBarra(); pintarPalco();
    if (notaEl) {
      const art = estado.itens.find((a) => a.id === estado.escolhido);
      notaEl.textContent = estado.nota || (art ? estadoDoArtefacto(art).porque
        : 'O site corre num iframe isolado: sem scripts, sem acesso ao escritório.');
    }
  }

  async function pedir(caminho, corpo = null) {
    const r = await fetchImpl('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ caminho, metodo: corpo ? 'POST' : 'GET', corpo }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.error || j.erro || `o servidor respondeu ${r.status}`);
      e.status = r.status;
      throw e;
    }
    // o /api/rpc embrulha: { status, corpo }
    const env = j && typeof j === 'object' && 'corpo' in j ? j : { status: r.status, corpo: j };
    if (env.status >= 400) throw new Error(env.corpo?.erro || env.corpo?.error || `o servidor respondeu ${env.status}`);
    return env.corpo;
  }

  async function carregar() {
    estado.carregando = true; estado.erro = ''; pintar();
    try {
      const r = await pedir('/artefactos');
      estado.itens = Array.isArray(r?.artefactos) ? r.artefactos : [];
      if (!estado.escolhido && estado.itens.length) estado.escolhido = estado.itens[0].id;
      if (estado.escolhido) await abrirArtefacto(estado.escolhido, { silencioso: true });
    } catch (e) {
      /* 401 não é «sem ligação»: é a porta a pedir sessão. Dizer a mesma frase para
         os dois casos é o género de imprecisão que já nos custou uma versão. */
      estado.erro = e.status === 401
        ? 'Entra com a tua conta para ver as entregas: a porta do escritório pede sessão (o cookie expirou ou nunca houve).'
        : `Sem ligação ao servidor: ${String(e.message || e).slice(0, 160)}. A aba abre na mesma; o que falta é a resposta do escritório.`;
    } finally {
      estado.carregando = false; pintar();
      if (aoMudar) { try { aoMudar(estado); } catch { /* quem chamou que trate */ } }
    }
  }

  async function abrirArtefacto(id, { silencioso = false } = {}) {
    estado.escolhido = id; estado.files = null; if (!silencioso) { estado.modo = 'ver'; pintar(); }
    try {
      const p = await pedir(`/artefactos/${encodeURIComponent(id)}/preview`);
      estado.files = p && typeof p === 'object' ? p : null;
      estado.nota = '';
    } catch (e) {
      estado.files = null;
      estado.nota = `não consegui ler o site: ${String(e.message || e).slice(0, 140)}`;
    }
    pintar();
  }

  async function escolher(id) {
    if (!id) return;
    estado.modo = 'ver';
    if (estado.escolhido === id && estado.files) { pintar(); return; }
    await abrirArtefacto(id);
  }

  async function descarregar() {
    const id = estado.escolhido;
    if (!id) return;
    estado.nota = 'a preparar o .zip no servidor…'; pintar();
    try {
      const z = await pedir(`/artefactos/${encodeURIComponent(id)}/zip`);
      const bytes = base64ParaBytes(z.base64);
      if (!bytes.length) throw new Error('o servidor devolveu um pacote vazio');
      const tipo = 'application/zip';
      const ficheiro = nomeDoPacote(z.nome || id);
      const objetoUrl = urlApi && typeof urlApi.createObjectURL === 'function' ? urlApi : (typeof URL !== 'undefined' ? URL : null);
      const url = objetoUrl && objetoUrl.createObjectURL ? objetoUrl.createObjectURL(new Blob([bytes], { type: tipo })) : '';
      const a = doc.createElement('a');
      a.href = url; a.download = ficheiro;
      a.style.display = 'none';
      doc.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => { try { if (objetoUrl && objetoUrl.revokeObjectURL) objetoUrl.revokeObjectURL(url); } catch { /* já revogado */ } }, 4000);
      estado.nota = `${ficheiro} · ${(z.bytes / 1024).toFixed(1)} KB · ${(z.ficheiros || []).map((f) => f.nome).join(' · ')} · sha256 ${String(z.sha256 || '').slice(0, 12)}…`;
    } catch (e) {
      estado.nota = `não consegui preparar o .zip: ${String(e.message || e).slice(0, 160)}`;
    }
    pintar();
  }

  async function aprovar() {
    const id = estado.escolhido;
    if (!id) return;
    estado.nota = 'a registar a aprovação…'; pintar();
    try {
      const r = await pedir(`/artefactos/${encodeURIComponent(id)}/publicar`, { aprovado: true, por: 'dono' });
      const i = estado.itens.findIndex((a) => a.id === id);
      if (i >= 0 && r?.artefacto) estado.itens[i] = { ...estado.itens[i], ...r.artefacto };
      estado.nota = 'aprovado e registado: o pacote já pode ir para o alojamento.';
    } catch (e) {
      estado.nota = `não aprovou: ${String(e.message || e).slice(0, 160)}`;
    }
    pintar();
  }

  async function criar(form) {
    if (!form) return;
    const dados = {};
    for (const campo of ['nome', 'atividade', 'cidade', 'telefone', 'email']) {
      const el = form.querySelector(`[name="${campo}"]`);
      dados[campo] = el ? String(el.value || '').trim() : '';
    }
    for (const k of Object.keys(dados)) if (!dados[k]) delete dados[k];
    if (!dados.nome) { estado.nota = 'o site precisa de um nome'; pintar(); return; }
    estado.nota = 'a montar o site…'; pintar();
    try {
      const r = await pedir('/artefactos/site', dados);
      const art = r?.artefacto;
      if (!art) throw new Error('o servidor não devolveu o artefacto');
      estado.itens = [art, ...estado.itens.filter((a) => a.id !== art.id)];
      estado.modo = 'ver';
      const nota = r.guardado === 'base' ? 'site criado e guardado na base' : 'site criado nesta sessão';
      await abrirArtefacto(art.id, { silencioso: true });
      estado.nota = nota;
      pintar();
    } catch (e) {
      estado.nota = `não criou: ${String(e.message || e).slice(0, 160)}`;
      pintar();
    }
  }

  function abrir() {
    garantirDom();
    estado.aberto = true;
    raiz.hidden = false;
    estado.modo = 'ver';
    pintar();
    carregar();
  }
  function fechar() {
    if (!raiz) return;
    estado.aberto = false;
    raiz.hidden = true;
  }
  function toggle() { if (estado.aberto) fechar(); else abrir(); }

  return {
    abrir, fechar, toggle, recarregar: carregar,
    estaAberto: () => estado.aberto,
    /** só para os testes e para quem quiser inspeccionar sem tocar no DOM */
    estado,
  };
}
