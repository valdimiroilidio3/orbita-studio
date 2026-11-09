/* ===========================================================================
   1.78.0 · O CONTROLO REMOTO DO ESCRITÓRIO (7 nov 2026)

   Pedido do dono: «vamos melhorar o remote de controlo do escritório, dando mais
   qualidade e mais realismo, ícones reais, e deixando mais elegante».

   O que existia era um dock de catorze glifos (⌂ + − ◍ ‹ › NE …) no canto, cada
   um com um peso diferente e nenhum a dizer o que faz. Isto substitui-o por um
   **comando à mão**: uma pastilha discreta que abre num painel pequeno, com
   ícones a sério (Lucide, ver `src/icones.js`) e três coisas que se lêem de
   relance — o estado da ligação, as salas e o trabalho.

   Regras que este ficheiro não quebra:

     · **nada é inventado.** O estado vem do `liveUi` (o mesmo que pinta os
       monitores), as contagens do `ORBITA.trabalho` (a mesma conta que acende a
       luz da sala) e as decisões do contador da barra. Sem ligação escreve-se
       «sem ligação», não «0»;
     · **não rouba a cena.** Fechado, são 44 px de altura no canto inferior
       esquerdo; aberto, 316 px de largura. O escritório continua a ser o
       protagonista;
     · **serve teclado e telemóvel.** Todos os botões são `<button>` a sério,
       têm nome acessível e anel de foco; a seta do teclado não fica presa, e no
       telemóvel o painel vira folha em baixo, acima do polegar.

   As acções chegam todas por `acoes` (funções reais do `main.js`): este módulo
   não sabe voar a câmara nem abrir as configurações — pede, e quem sabe faz.
   =========================================================================== */
import { icone } from './icones.js';
import { DEPTS } from './data.js';
import { ORDEM_SALAS } from './oficina.js';

/** «ao vivo», «a ler», «a ligar», «sem dados», «sem ligação» — o que é verdade agora. */
export const ESTADO_LIGACAO = {
  live: { texto: 'ao vivo', chave: 'live' },
  ler: { texto: 'a ler', chave: 'ler' },
  ligar: { texto: 'a ligar', chave: 'ligar' },
  stale: { texto: 'sem dados novos', chave: 'stale' },
  off: { texto: 'sem ligação', chave: 'off' },
};

/** O `status` + `modo` do `live.js` traduzidos para o que a pastilha diz. */
export function estadoDeLigacao(status, modo) {
  if (status === 'live' && modo === 'sondagem') return ESTADO_LIGACAO.ler;
  if (status === 'live') return ESTADO_LIGACAO.live;
  if (status === 'connecting') return ESTADO_LIGACAO.ligar;
  if (status === 'stale') return ESTADO_LIGACAO.stale;
  return ESTADO_LIGACAO.off;
}

const el = (doc, tag, cls = '', attrs = {}) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, String(v));
  return n;
};

/**
 * Constrói o comando. Devolve a API que o `main.js` usa:
 * `{ raiz, abrir, fechar, alternar, estaAberto, atualizar, tick, destruir }`.
 */
export function criarRemoto({
  doc = globalThis.document,
  liveUi = null,
  acoes = {},
  dados = {},
  aberto = false,
  guardar = null,
} = {}) {
  if (!doc || typeof doc.createElement !== 'function') return null;

  const raiz = el(doc, 'aside', 'rmt', { id: 'remoto', 'aria-label': 'Controle remoto do escritório' });
  raiz.dataset.estado = 'off';

  /* ---------- a pastilha (o que se vê quando está fechado) ---------- */
  const cabeca = el(doc, 'div', 'rmt-h');
  const botao = el(doc, 'button', 'rmt-toggle', {
    type: 'button', 'aria-expanded': 'false', 'aria-controls': 'rmtPainel',
    title: 'controle remoto do escritório (R)',
  });
  const marcaIcone = icone('remoto', { doc, size: 17, cls: 'rmt-ic' });
  if (marcaIcone) botao.appendChild(marcaIcone);
  botao.appendChild(el(doc, 'b', 'rmt-t', {})).textContent = 'REMOTO';
  const ponto = el(doc, 'i', 'rmt-dot', { 'aria-hidden': 'true' });
  botao.appendChild(ponto);
  const rotulo = el(doc, 'span', 'rmt-est');
  botao.appendChild(rotulo);
  const seta = icone('abrir', { doc, size: 15, cls: 'rmt-seta' });
  if (seta) botao.appendChild(seta);
  cabeca.appendChild(botao);
  raiz.appendChild(cabeca);

  /* ---------- o painel ---------- */
  const painel = el(doc, 'div', 'rmt-painel', { id: 'rmtPainel', hidden: '' });
  raiz.appendChild(painel);

  const grupo = (titulo, ico) => {
    const g = el(doc, 'div', 'rmt-grp');
    const h = el(doc, 'span', 'rmt-lab');
    const i = icone(ico, { doc, size: 13, cls: 'rmt-lab-ic' });
    if (i) h.appendChild(i);
    h.appendChild(el(doc, 'span', '', {})).textContent = titulo;
    g.appendChild(h);
    painel.appendChild(g);
    return g;
  };
  const botaoDeVista = (g, chave, nome, ico, titulo) => {
    const b = el(doc, 'button', 'rmt-b', { type: 'button', 'data-vista': chave, title: titulo || nome });
    const i = icone(ico, { doc, size: 16 });
    if (i) b.appendChild(i);
    const t = el(doc, 'span', 'rmt-b-t');
    t.textContent = nome;
    b.appendChild(t);
    g.appendChild(b);
    return b;
  };

  /* vista */
  const gVista = grupo('VISTA', 'geral');
  const linhas = el(doc, 'div', 'rmt-row');
  gVista.appendChild(linhas);
  for (const [chave, nome, ico, titulo] of [
    ['geral', 'Geral', 'geral', 'visão geral (0)'],
    ['aerea', 'Aérea', 'aerea', 'vista aérea (9)'],
    ['esq', '', 'esquerda', 'rodar a câmara para a esquerda ([)'],
    ['dir', '', 'direita', 'rodar a câmara para a direita (])'],
    ['planta', '2D', 'planta', 'planta 2D — trabalho intensivo (M)'],
  ]) {
    const b = botaoDeVista({ appendChild: (n) => linhas.appendChild(n) }, chave, nome, ico, titulo);
    if (!nome) { b.classList.add('so-icone'); b.setAttribute('aria-label', chave === 'esq' ? 'rodar para a esquerda' : 'rodar para a direita'); }
    else b.setAttribute('aria-label', nome);
  }

  /* salas — os nomes e as cores vêm de `data.js`, a ordem da cena de `oficina.js` */
  const gSalas = grupo('SALAS', 'salas');
  const grade = el(doc, 'div', 'rmt-salas');
  gSalas.appendChild(grade);
  const botoesDeSala = new Map();
  for (const k of ORDEM_SALAS) {
    const d = DEPTS[k];
    if (!d) continue;
    const b = el(doc, 'button', 'rmt-sala', { type: 'button', 'data-sala': k, title: `abrir a sala ${d.name}` });
    const cor = el(doc, 'i', 'rmt-cor', { 'aria-hidden': 'true' });
    cor.style.background = d.chip;
    b.appendChild(cor);
    const nome = el(doc, 'span', 'rmt-sala-n');
    nome.textContent = d.short || d.name;
    b.appendChild(nome);
    const n = el(doc, 'span', 'rmt-sala-num', { 'aria-hidden': 'true' });
    b.appendChild(n);
    grade.appendChild(b);
    botoesDeSala.set(k, { botao: b, num: n });
  }

  /* trabalho */
  const gTrabalho = grupo('TRABALHO', 'trabalho');
  const nums = el(doc, 'div', 'rmt-nums', { 'aria-live': 'polite' });
  gTrabalho.appendChild(nums);
  const numDe = (chave, ico, rotuloCurto) => {
    const b = el(doc, 'button', 'rmt-n', { type: 'button', 'data-num': chave, title: rotuloCurto });
    const i = icone(ico, { doc, size: 14 });
    if (i) b.appendChild(i);
    const v = el(doc, 'b', 'rmt-n-v');
    v.textContent = '—';
    b.appendChild(v);
    const t = el(doc, 'span', 'rmt-n-t');
    t.textContent = rotuloCurto;
    b.appendChild(t);
    nums.appendChild(b);
    return v;
  };
  const numTrabalho = numDe('live', 'activo', 'a trabalhar');
  const numEspera = numDe('waiting', 'espera', 'à espera');
  const numFila = numDe('queue', 'ia', 'na fila');
  const numDecisoes = numDe('decisoes', 'aviso', 'decisões');

  /* rodapé */
  const pe = el(doc, 'div', 'rmt-foot');
  painel.appendChild(pe);
  const linkMesa = el(doc, 'a', 'rmt-mesa', { href: '/app', target: '_blank', rel: 'noopener' });
  const im = icone('abrirFora', { doc, size: 14 });
  if (im) linkMesa.appendChild(im);
  const tm = el(doc, 'span');
  tm.textContent = 'abrir a mesa';
  linkMesa.appendChild(tm);
  pe.appendChild(linkMesa);
  const bConfig = el(doc, 'button', 'rmt-ghost', { type: 'button', 'data-vista': 'config', title: 'configurações (,)' });
  const ic = icone('config', { doc, size: 15 });
  if (ic) bConfig.appendChild(ic);
  const tc = el(doc, 'span');
  tc.textContent = 'Config';
  bConfig.appendChild(tc);
  pe.appendChild(bConfig);
  const bTema = el(doc, 'button', 'rmt-ghost', { type: 'button', 'data-vista': 'tema', title: 'trocar entre claro e escuro (D)' });
  bTema.setAttribute('aria-label', 'trocar entre claro e escuro');
  const it = icone('escuro', { doc, size: 15 });
  if (it) bTema.appendChild(it);
  pe.appendChild(bTema);

  /* ---------- abrir e fechar ---------- */
  let isAberto = !!aberto;
  const pintarAberto = () => {
    painel.hidden = !isAberto;
    botao.setAttribute('aria-expanded', isAberto ? 'true' : 'false');
    raiz.classList.toggle('aberto', isAberto);
    if (seta) {
      const novo = icone(isAberto ? 'fechar' : 'abrir', { doc, size: 15, cls: 'rmt-seta' });
      if (novo) seta.replaceWith(novo);
    }
    if (guardar) { try { guardar(isAberto); } catch { /* sem armazenamento */ } }
  };
  function abrir() { isAberto = true; pintarAberto(); atualizar(); }
  function fechar() { isAberto = false; pintarAberto(); }
  function alternar() { isAberto ? fechar() : abrir(); }

  botao.addEventListener('click', () => alternar());

  /* ---------- acções ---------- */
  /* `...args` de propósito: uma acção chamada sem alvo não deve receber um
     `undefined` que ela possa confundir com uma sala */
  const clicar = (nome, ...args) => {
    const f = acoes[nome];
    if (typeof f === 'function') { try { f(...args); } catch { /* uma acção que falha não parte o painel */ } }
  };
  painel.addEventListener('click', (e) => {
    const alvo = e.target && e.target.closest ? e.target.closest('[data-vista],[data-sala]') : null;
    if (!alvo) return;
    const sala = alvo.getAttribute('data-sala');
    if (sala) { clicar('sala', sala); return; }
    const vista = alvo.getAttribute('data-vista');
    if (vista === 'esq') return clicar('esquerda');
    if (vista === 'dir') return clicar('direita');
    clicar(vista);
  });
  /* o contador das decisões abre o «Hoje» — é o que ele conta */
  nums.addEventListener('click', (e) => {
    const alvo = e.target && e.target.closest ? e.target.closest('[data-num]') : null;
    if (!alvo) return;
    if (alvo.getAttribute('data-num') === 'decisoes') clicar('hoje');
    else clicar('trabalho');
  });

  /* ---------- o retrato (nunca inventado) ---------- */
  const escrever = (no, texto) => { if (no && no.textContent !== texto) no.textContent = texto; };

  function atualizar() {
    const e = (dados.estado && dados.estado()) || {};
    const st = estadoDeLigacao(e.status || 'off', e.modo || 'parado');
    raiz.dataset.estado = st.chave;
    escrever(rotulo, st.texto);

    const t = e.totais || {};
    const decis = Number(typeof dados.decisoes === 'function' ? dados.decisoes() : (e.decisoes || 0)) || 0;
    escrever(numTrabalho, String(Number(t.running != null ? t.running : t.live) || 0));
    escrever(numEspera, String(Number(t.waiting) || 0));
    escrever(numFila, String(Number(t.queued) || 0));
    escrever(numDecisoes, String(decis));
    raiz.classList.toggle('tem-decisao', decis > 0);

    for (const [k, { botao: b, num }] of botoesDeSala) {
      const w = (typeof dados.trabalho === 'function' ? dados.trabalho(k) : null) || null;
      const live = w ? Number(w.live) || 0 : 0;
      const wait = w ? Number(w.waiting) || 0 : 0;
      b.dataset.estado = !w ? 'sem-ligacao' : live ? 'a-trabalhar' : wait ? 'espera' : 'sem-trabalho';
      escrever(num, w ? (live ? String(live) : wait ? String(wait) : '') : '');
      const titulo = w
        ? (live ? `${live} a trabalhar${wait ? ` · ${wait} à espera` : ''}` : wait ? `${wait} à espera do teu OK` : 'sem trabalho agora')
        : 'sem ligação';
      if (b.title !== titulo) b.title = titulo;
      b.setAttribute('aria-label', `${DEPTS[k]?.name || k} — ${titulo}`);
    }
  }

  /* uma leitura por segundo, no máximo: o painel não é um segundo ecrã */
  let ultimo = 0;
  function tick(agora = Date.now()) {
    if (!isAberto) return;
    if (agora - ultimo < 1000) return;
    ultimo = agora;
    atualizar();
  }

  pintarAberto();
  atualizar();

  return {
    raiz, abrir, fechar, alternar, estaAberto: () => isAberto, atualizar, tick,
    destruir() { try { raiz.remove(); } catch { /* já não está no documento */ } },
  };
}
