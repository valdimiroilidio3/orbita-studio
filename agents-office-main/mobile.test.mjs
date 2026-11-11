// 1.80.0 / 1.81.0 · O TELEMÓVEL, PROVADO PELA ORDEM DAS REGRAS.
//
// Esta máquina não tem Chrome (o `smoke: browser` do gate é saltado aqui), por isso
// não há captura de ecrã possível. O que se pode provar — e é exactamente o que
// estava mal — é o CASCATEAMENTO: qual regra ganha, num ecrã de 390 px, para as
// caixas que o dono viu cortadas.
//
// O bug de origem: o `#tpanel` tinha, no bloco móvel, `left/right:10px; width:auto`
// e, 600 linhas abaixo, um `#tpanel { width: 380px }` sem media query. Uma regra
// posterior ganha a uma media query (as media queries não dão especificidade), por
// isso num ecrã de 390 px o painel ficava com 380 px + 20 px de margens = 400 px.
// Era o corte à direita da captura.
//
// Este ficheiro lê o CSS a sério, ordena as regras, calcula especificidade e
// responde «quem ganha». Se alguém voltar a pôr uma largura fixa depois do bloco
// móvel, o teste fica vermelho.
//
// 1.81.0 acrescenta ao calculador duas coisas que faltavam: `@media (hover: none)`
// (o ecrã de toque, onde vivem as regras que revelam o que só o rato mostrava) e a
// regra de que `:hover` é um instante — não conta como estado em repouso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SHELL = fs.readFileSync(path.join(AQUI, 'src', 'shell.html'), 'utf8');

/** O primeiro `<style>` do documento é o grande (o segundo é o do terminal). */
export function cssDaShell(html = SHELL) {
  const m = /<style>([\s\S]*?)<\/style>/.exec(html);
  assert.ok(m, 'a shell tem de ter um <style>');
  return m[1];
}

const semComentarios = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Percorre o CSS e devolve as regras por ordem, com o `@media` em que vivem. */
export function regras(css) {
  const texto = semComentarios(css);
  const out = [];
  const pilha = [];
  let buf = '';
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '{') {
      const cabecalho = buf.trim();
      buf = '';
      if (cabecalho.startsWith('@')) {
        pilha.push({ at: cabecalho, seletor: null });
        continue;
      }
      // bloco de declarações: lê até o fecho correspondente
      let j = i + 1, prof = 1;
      while (j < texto.length && prof > 0) {
        if (texto[j] === '{') prof++;
        else if (texto[j] === '}') prof--;
        j++;
      }
      const corpo = texto.slice(i + 1, j - 1);
      const media = pilha.filter((p) => p.at && /^@media/.test(p.at)).map((p) => p.at);
      out.push({ seletor: cabecalho.replace(/\s+/g, ' '), corpo, media, ordem: out.length });
      i = j - 1;
      continue;
    }
    if (c === '}') { pilha.pop(); buf = ''; continue; }
    buf += c;
  }
  return out;
}

/** Declarações de um corpo: `{ propriedade: valor }` (a última ganha dentro do bloco). */
export function declaracoes(corpo) {
  const out = {};
  for (const parte of corpo.split(';')) {
    const k = parte.indexOf(':');
    if (k < 0) continue;
    const prop = parte.slice(0, k).trim().toLowerCase();
    const val = parte.slice(k + 1).trim();
    if (prop) out[prop] = val;
  }
  return out;
}

/** `min-width`/`max-width` em px — o que interessa para decidir se um bloco se aplica.
 *  1.81.0: também `hover: none` (ecrã de toque) e `pointer: coarse`, que é onde
 *  vivem as regras que revelam o que só o rato mostrava. */
export function mediaAplica(media, largura, toque = false) {
  if (!media || !media.length) return true;
  for (const m of media) {
    const max = /max-width:\s*(\d+)px/.exec(m);
    const min = /min-width:\s*(\d+)px/.exec(m);
    if (max && largura > Number(max[1])) return false;
    if (min && largura < Number(min[1])) return false;
    if (/hover:\s*none/.test(m) && !toque) return false;
    if (/hover:\s*hover/.test(m) && toque) return false;
    if (/pointer:\s*coarse/.test(m) && !toque) return false;
    if (/pointer:\s*fine/.test(m) && toque) return false;
  }
  return true;
}

/** Especificidade (a, b, c) de um seletor composto — descendentes incluídos. */
export function especificidade(seletor) {
  let a = 0, b = 0, c = 0;
  for (const parte of seletor.split(/\s+/)) {
    if (!parte) continue;
    a += (parte.match(/#[\w-]+/g) || []).length;
    b += (parte.match(/\.[\w-]+/g) || []).length + (parte.match(/\[[^\]]+\]/g) || []).length;
    const limpo = parte.replace(/#[\w-]+|::?[\w-]+(\([^)]*\))?|\.[\w-]+|\[[^\]]+\]/g, ' ');
    c += limpo.split(/[>+~]/).map((x) => x.trim()).filter(Boolean).length;
  }
  return [a, b, c];
}

const compara = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);

/**
 * Qual o valor de `prop` que ganha para o elemento `el` a uma dada largura.
 * `el` = { tag, id, classes, pais: [{tag, classes}] } — só o que os seletores usados precisam.
 */
export function valorEfectivo(css, el, prop, largura = 390, toque = false) {
  let vencedor = null;
  for (const r of regras(css)) {
    if (!mediaAplica(r.media, largura, toque)) continue;
    for (const seletor of r.seletor.split(',').map((s) => s.trim())) {
      /* `:hover` é um instante, não o estado em repouso: o que se mede aqui é o que
         se vê ao chegar à página. Sem isto, uma regra de hover fingia ganhar sempre
         — e escondia que o «+» do calendário não existia no telemóvel. */
      if (!seletor || /:hover/.test(seletor) || !combina(seletor, el)) continue;
      const decl = declaracoes(r.corpo);
      if (!(prop in decl)) continue;
      const cand = { valor: decl[prop], esp: especificidade(seletor), ordem: r.ordem };
      if (!vencedor || compara(cand.esp, vencedor.esp) > 0 || (compara(cand.esp, vencedor.esp) === 0 && cand.ordem >= vencedor.ordem)) {
        vencedor = cand;
      }
    }
  }
  return vencedor ? vencedor.valor : null;
}

/** Um seletor composto (`tag#id.class` ou `tag.class`), com descendência por espaço. */
function combinaUm(parte, no) {
  const tag = /^[a-zA-Z][\w-]*/.exec(parte);
  if (tag && tag[0].toLowerCase() !== String(no.tag || '').toLowerCase()) return false;
  const id = /#([\w-]+)/.exec(parte);
  if (id && id[1] !== no.id) return false;
  const classes = [...parte.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  for (const k of classes) if (!(no.classes || []).includes(k)) return false;
  // pseudo-classes usadas nos seletores de layout: :not(...) e :has(...) não se modelam aqui
  const pseudo = [...parte.matchAll(/:([\w-]+)/g)].map((m) => m[1]).filter((p) => !['hover', 'focus-visible', 'active', 'focus'].includes(p));
  for (const p of pseudo) if (!(no.pseudo || []).includes(p)) return false;
  return true;
}

export function combina(seletor, no) {
  // os combinadores `>` e `+` não mudam o que se prova aqui (a descendência é livre)
  const partes = seletor.split(/\s+/).filter((p) => p && p !== '>' && p !== '+' && p !== '~');
  if (!partes.length) return false;
  // da direita para a esquerda; cada parte anterior tem de existir num ancestral (ordem livre)
  let atual = no;
  if (!combinaUm(partes[partes.length - 1], atual)) return false;
  let i = partes.length - 2;
  let ancestrais = [...(no.pais || [])];
  while (i >= 0) {
    const achou = ancestrais.findIndex((a) => combinaUm(partes[i], a));
    if (achou < 0) return false;
    /* o mesmo nó pode satisfazer duas partes seguidas: `#topbar .m-group` é UM
       elemento (id + classe), não dois ancestrais distintos */
    ancestrais = ancestrais.slice(achou);
    i--;
  }
  return true;
}

/* ---------- os elementos que o dono viu ---------- */
const painel = { tag: 'div', id: 'tpanel', classes: [], pais: [{ tag: 'body', classes: [] }] };
const media = (id, classes = []) => ({ tag: 'div', id, classes, pais: [{ tag: 'body', classes: [] }] });

test('1.80.0 · num telemóvel de 390 px o painel cabe: nada de 380 px fixos', () => {
  const css = cssDaShell();
  assert.equal(valorEfectivo(css, painel, 'width', 390), 'auto',
    'o `#tpanel` tem de deixar de ter largura fixa no telemóvel (era a causa do corte à direita)');
  assert.equal(valorEfectivo(css, painel, 'left', 390), '8px');
  assert.equal(valorEfectivo(css, painel, 'right', 390), '8px');
  assert.match(String(valorEfectivo(css, painel, 'max-height', 390)), /78d?vh/);
  assert.equal(valorEfectivo(css, painel, 'overflow', 390), 'hidden');
});

test('1.80.0 · no ecrã grande o painel fica exactamente como estava (380 px)', () => {
  const css = cssDaShell();
  assert.equal(valorEfectivo(css, painel, 'width', 1440), '380px');
  assert.equal(valorEfectivo(css, painel, 'overflow', 1440), null, 'sem overflow forçado na secretária');
});

test('1.80.0 · a gaveta do posto ocupa o ecrã todo e começa no topo (não 52 px abaixo)', () => {
  const css = cssDaShell();
  const rail = media('rail');
  assert.equal(valorEfectivo(css, rail, 'top', 390), '0');
  assert.equal(valorEfectivo(css, rail, 'width', 390), '100%');
  assert.equal(valorEfectivo(css, rail, 'width', 1440), 'min(400px, 92vw)');
  assert.equal(valorEfectivo(css, media('railDept'), 'overflow-y', 390), 'auto',
    'a gaveta do departamento tem de rolar: sem isto o conteúdo sai da caixa');
});

test('1.80.0 · o compositor e a lista de tarefas rolam dentro da folha', () => {
  const css = cssDaShell();
  const linhas = { tag: 'div', classes: ['tp-rows'], pais: [painel] };
  assert.equal(valorEfectivo(css, linhas, 'overflow-y', 390), 'auto');
  const campo = { tag: 'textarea', classes: ['tp-in'], pais: [painel] };
  assert.equal(valorEfectivo(css, campo, 'font-size', 390), '16px', '16 px no campo: o iOS não amplia ao tocar');
  const add = { tag: 'button', classes: ['tp-add'], pais: [{ tag: 'div', classes: ['tp-r2'] }, painel] };
  const largura = valorEfectivo(css, add, 'width', 390);
  assert.equal(largura, '100%', 'o ADICIONAR ocupa a linha toda em vez de espremer os campos');
});

test('1.80.0 · o ✕ das gavetas é um alvo de dedo (44 px), não de rato', () => {
  const css = cssDaShell();
  const fechar = { tag: 'button', id: 'railClose', classes: [], pais: [{ tag: 'div', id: 'rail', classes: ['open'] }] };
  assert.equal(valorEfectivo(css, fechar, 'width', 390), '44px');
  assert.equal(valorEfectivo(css, fechar, 'height', 390), '44px');
});

test('1.80.0 · a barra de cima não empurra a página para o lado', () => {
  const css = cssDaShell();
  const barra = media('topbar');
  assert.equal(valorEfectivo(css, barra, 'padding', 390), '8px 10px');
  const etiqueta = { tag: 'span', classes: ['mb-t'],
    pais: [{ tag: 'button', classes: [] }, { tag: 'div', id: 'topbar', classes: ['m-group'] }] };
  assert.equal(valorEfectivo(css, etiqueta, 'display', 390), 'none', 'em ecrã estreito fica o ícone');
});

test('1.80.0 · o bloco móvel é o último: é a ordem que o faz ganhar', () => {
  const css = cssDaShell();
  const todas = regras(css);
  const doPainel = todas.filter((r) => r.seletor.split(',').map((s) => s.trim()).includes('#tpanel'));
  assert.ok(doPainel.length >= 3, 'há pelo menos três blocos que tocam no #tpanel');
  const fixaLarga = doPainel.find((r) => /(^|;)\s*width:\s*380px/.test(r.corpo) && !r.media.length);
  assert.ok(fixaLarga, 'a largura de secretária (380 px) tem de continuar a existir');
  const movel = doPainel.filter((r) => r.media.some((m) => /max-width:\s*640px/.test(m)));
  assert.ok(movel.length, 'tem de haver um bloco móvel');
  assert.ok(Math.max(...movel.map((r) => r.ordem)) > fixaLarga.ordem,
    'o bloco móvel tem de vir DEPOIS da largura fixa — senão o telemóvel perde, como perdia');
});

/* ===========================================================================
   1.81.0 · O CALENDÁRIO NO TELEMÓVEL (9 nov 2026)

   O `#calOv` é `position:fixed; inset:0` — o ecrã todo — e o interior nunca foi
   pensado para 390 px: uma barra que não quebra, uma gaveta de 272 px fixos ao lado
   de uma grelha de sete colunas, e popovers de 372 px. O que se prova aqui é o
   mesmo que na 1.80.0: quem ganha, a que largura, para cada caixa.
   =========================================================================== */
const cal = { tag: 'div', id: 'calOv', classes: ['on'], pais: [{ tag: 'body', classes: [] }] };
/* a lista de pais é a cadeia toda (o combinador aproxima-se do elemento): sem isto um
   seletor como `#calOv .cv-band` não chega ao avô */
const dentro = (tag, classes, pai, extra = {}) => ({ tag, classes, pais: [pai, ...(pai.pais || [])], ...extra });
const band = dentro('div', ['cv-band'], cal);
const cx = (css, el, prop, largura, toque = false) => valorEfectivo(css, el, prop, largura, toque);

test('1.81.0 · a barra do calendário quebra em três filas (a 390 px não cabia numa)', () => {
  const css = cssDaShell();
  assert.equal(cx(css, band, 'display', 390), 'grid');
  assert.equal(cx(css, band, 'height', 390), 'auto', 'altura fixa de 64 px + fila que não quebra = conteúdo fora do ecrã');
  assert.match(String(cx(css, band, 'grid-template-areas', 390)), /brand close/);
  assert.equal(cx(css, dentro('div', ['cv-keys'], band), 'display', 390), 'none',
    'atalhos de teclado num telemóvel não existem — e roubavam a linha toda');
  assert.equal(cx(css, cal, 'display', 390), 'flex', 'o overlay continua a ser a coluna de sempre');
  const fechar = dentro('button', [], cal, { id: 'cvClose' });
  assert.equal(cx(css, fechar, 'width', 390), '44px');
  assert.equal(cx(css, fechar, 'height', 390), '44px');
  const titulo = dentro('div', [], band, { id: 'cvTitle' });
  assert.equal(cx(css, titulo, 'min-width', 390), '0', '200 px mínimos no título empurravam a barra');
  const brand = dentro('div', ['cv-brand'], band);
  assert.equal(cx(css, dentro('small', [], brand), 'display', 390), 'none');
});

test('1.81.0 · a barra de secretária fica exactamente como estava', () => {
  const css = cssDaShell();
  assert.equal(cx(css, band, 'display', 1440), 'flex');
  assert.equal(cx(css, band, 'height', 1440), '64px');
  assert.equal(cx(css, dentro('div', ['cv-keys'], band), 'display', 1440), null, 'na secretária os atalhos não têm regra nenhuma: ficam como sempre estiveram');
  assert.equal(cx(css, dentro('div', [], band, { id: 'cvTitle' }), 'min-width', 1440), '200px');
});

test('1.81.0 · as rotinas passam por cima e os dias por baixo: a grelha deixa de ser esmagada', () => {
  const css = cssDaShell();
  const corpo = dentro('div', ['cv-body'], cal);
  assert.equal(cx(css, corpo, 'flex-direction', 390), 'column');
  assert.equal(cx(css, corpo, 'flex-direction', 1440), null);
  const rail = dentro('aside', ['cv-rail'], corpo);
  assert.equal(cx(css, rail, 'width', 390), 'auto', '272 px fixos ao lado de sete colunas davam ~118 px à grelha');
  assert.equal(cx(css, rail, 'width', 1440), '272px');
  assert.match(String(cx(css, rail, 'max-height', 390)), /30dvh/);
  const wrap = dentro('div', ['cv-wrap'], corpo);
  assert.equal(cx(css, wrap, 'overflow-y', 390), 'auto', 'em lista, quem rola é a coluna dos dias');
});

test('1.81.0 · a grelha de sete colunas passa a lista de dias empilhados', () => {
  const css = cssDaShell();
  const grelha = dentro('div', ['cv-grid', 'month'], cal);
  assert.equal(cx(css, grelha, 'grid-template-columns', 390), '1fr');
  assert.equal(cx(css, grelha, 'grid-template-columns', 1440), 'repeat(7, 1fr)');
  assert.equal(cx(css, grelha, 'grid-auto-rows', 390), 'auto');
  assert.equal(cx(css, dentro('div', ['cv-dow'], cal), 'display', 390), 'none',
    'sem colunas não há cabeçalho de dias — a semana vai escrita em cada dia');
  const dia = dentro('div', ['cv-day'], grelha);
  assert.match(String(cx(css, dia, 'padding', 390)), /58px/, 'gutter à esquerda para o número e a inicial');
  assert.equal(cx(css, dia, 'border-right', 390), '0');
  const num = dentro('div', ['cv-num'], dia);
  assert.equal(cx(css, num, 'left', 390), '10px');
  assert.equal(cx(css, num, 'position', 390), 'absolute');
  // e a inicial do dia, que na grelha era a coluna
  const wd = dentro('span', ['cv-wd'], num);
  assert.equal(cx(css, wd, 'display', 390), 'block');
  assert.equal(cx(css, wd, 'display', 1440), 'none');
  // o título de um evento em lista lê-se todo, não se corta a meio
  assert.equal(cx(css, dentro('div', ['cv-ev-t'], dia), 'white-space', 390), 'normal');
});

test('1.81.0 · em ecrã de toque não há hover: o «+» de agendar fica à vista', () => {
  const css = cssDaShell();
  const dia = dentro('div', ['cv-day'], dentro('div', ['cv-grid', 'month'], cal));
  const add = dentro('button', ['cv-add'], dia);
  /* num telemóvel o bloco de largura já o mostra; o que esta regra acrescenta é o
     tablet e o portátil com ecrã de toque, onde a largura sozinha não decidia nada */
  assert.equal(cx(css, add, 'opacity', 390, false), '1');
  assert.equal(cx(css, add, 'opacity', 1024, false), '0', 'na secretária continua a aparecer com o rato');
  assert.equal(cx(css, add, 'opacity', 1024, true), '1', 'num ecrã de toque tem de estar à vista');
  const chip = dentro('button', ['mc-chip'], dentro('div', ['mc-chips'], dentro('div', ['mc'], { tag: 'div', id: 'mChat', classes: [], pais: [{ tag: 'body', classes: [] }] })));
  assert.equal(cx(css, dentro('button', ['x'], chip), 'opacity', 390, true), '1');
});

test('1.81.0 · os popovers deixam de ter 372 px fixos: cabem nos 360', () => {
  const css = cssDaShell();
  const pop = { tag: 'div', id: 'cvPop', classes: [], pais: [{ tag: 'body', classes: [] }] };
  assert.equal(cx(css, pop, 'width', 390), 'auto !important');
  assert.equal(cx(css, pop, 'width', 1440), '372px');
  assert.equal(cx(css, pop, 'left', 390), '8px !important', 'ganha ao `left` em linha que o place() escreve');
  assert.equal(cx(css, pop, 'right', 390), '8px !important');
  assert.equal(cx(css, pop, 'top', 390), 'auto !important');
  assert.match(String(cx(css, pop, 'max-height', 390)), /74dvh/);
  const ai = { tag: 'div', id: 'aiPop', classes: [], pais: [{ tag: 'body', classes: [] }] };
  assert.equal(cx(css, ai, 'width', 390), 'auto');
  assert.equal(cx(css, ai, 'width', 1440), '372px');
});

test('1.81.0 · os campos novos também a 16 px (o iOS não amplia ao tocar)', () => {
  const css = cssDaShell();
  const pop = { tag: 'div', id: 'cvPop', classes: [], pais: [{ tag: 'body', classes: [] }] };
  for (const tag of ['input', 'select', 'textarea']) {
    assert.equal(cx(css, dentro(tag, [], pop), 'font-size', 390), '16px', `${tag} do popover do calendário`);
  }
  assert.equal(cx(css, dentro('input', [], cal, { id: 'cvSearch' }), 'font-size', 390), '16px', 'a pesquisa do calendário');
  const barra = dentro('div', [], cal, { id: 'topbar' });
  const grupo = dentro('div', ['m-group'], barra);
  assert.equal(cx(css, dentro('button', [], grupo), 'min-height', 390), '40px', 'a barra de cima é de dedo, não de rato');
});

test('1.81.0 · nenhuma gaveta flutuante fica mais larga do que um telemóvel de 360 px', () => {
  const css = cssDaShell();
  /* os painéis que se abrem por cima da cena. A regra é simples e vale para todos:
     a 360 px, uma largura fixa em px só é aceitável se caber em 344 (360 − 16). */
  const paineis = [
    ['div', 'tpanel'], ['div', 'rail'], ['div', 'leadsPanel'], ['div', 'opsPanel'],
    ['div', 'cfgPanel'], ['div', 'aiPop'], ['div', 'cvPop'], ['div', null, ['bv-pane']],
  ];
  for (const [tag, id, classes] of paineis) {
    const el = { tag, id, classes: classes || [], pais: [{ tag: 'body', classes: [] }] };
    const largura = String(valorEfectivo(css, el, 'width', 360) || '');
    const fixa = /^(\d+)px$/.exec(largura);
    const nome = id ? `#${id}` : `.${classes[0]}`;
    if (fixa) assert.ok(Number(fixa[1]) <= 344, `${nome} tem ${largura} a 360 px: não cabe`);
    else assert.match(largura, /auto|100%|min\(|calc\(/, `${nome} devia ser fluido a 360 px (é "${largura}")`);
  }
});

test('1.81.0 · a mesa (/app) também cabe: a lista de leads e os números colapsam', () => {
  const html = fs.readFileSync(path.join(AQUI, 'src', 'mesa.html'), 'utf8');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const el = (tag, classes) => ({ tag, classes, pais: [{ tag: 'body', classes: [] }] });
  const row = el('div', ['row']);
  const stats = el('div', ['stats']);
  const head = el('div', ['head']);
  // 390 px: uma linha de lead é nome + etiqueta (as colunas escondem-se), dois números por fila
  assert.equal(valorEfectivo(css, row, 'grid-template-columns', 390), '1fr auto');
  assert.equal(valorEfectivo(css, stats, 'grid-template-columns', 390), 'repeat(2, 1fr)');
  assert.equal(valorEfectivo(css, head, 'flex-direction', 390), 'column', 'o título e os botões empilham');
  // e a 1440 px nada disto acontece
  assert.equal(valorEfectivo(css, row, 'grid-template-columns', 1440), '1fr 150px 120px 92px');
  assert.equal(valorEfectivo(css, stats, 'grid-template-columns', 1440), 'repeat(4, 1fr)');
});

/* ===========================================================================
   1.83.0 · «AINDA ESTÁ APERTADO SIM NA VERSÃO MOBILE» (9 nov 2026)

   O dono disse-o duas vezes. Estas provas medem, a 360 px, as caixas que
   estavam a esticar o ecrã:
     · os BOTÕES de filtro das execuções herdavam o `min-width: 620px` da tabela
       (as duas coisas chamavam-se `.mo-tab`) — cada filtro tinha 620 px;
     · as tabelas de 6 colunas não cabiam: passam a cartões (linha a linha);
     · os separadores do projeto saíam do ecrã em vez de quebrar;
     · a pesquisa tinha 220 px fixos ao lado de um botão.
   =========================================================================== */
test('1.83.0 · os filtros das execuções deixam de ter 620 px (a tabela e o botão não são a mesma coisa)', () => {
  const html = fs.readFileSync(path.join(AQUI, 'src', 'mesa.html'), 'utf8');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const filtros = { tag: 'div', classes: ['mo-filtros'], pais: [{ tag: 'body', classes: [] }] };
  const chip = { tag: 'button', classes: ['mo-tab'], pais: [filtros, { tag: 'body', classes: [] }] };
  for (const largura of [360, 390, 1440]) {
    assert.equal(valorEfectivo(css, chip, 'min-width', largura), '0', `o filtro tem min-width fixo a ${largura} px`);
    assert.equal(valorEfectivo(css, chip, 'width', largura), 'auto', `o filtro ocupa a linha toda a ${largura} px`);
    assert.equal(valorEfectivo(css, chip, 'min-height', largura), '40px', 'o filtro é alvo de dedo');
  }
  /* e a tabela continua a ter a largura mínima na secretária (não se perdeu nada) */
  const tabela = { tag: 'table', classes: ['mo-tab'], pais: [{ tag: 'body', classes: [] }] };
  assert.equal(valorEfectivo(css, tabela, 'min-width', 1440), '620px');
  assert.equal(valorEfectivo(css, tabela, 'min-width', 360), '0', 'a 360 px a tabela não pode ter 620 px');
});

test('1.83.0 · a 360 px as tabelas deixam de rolar para o lado: cada linha é um cartão', () => {
  const html = fs.readFileSync(path.join(AQUI, 'src', 'mesa.html'), 'utf8');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const tabela = { tag: 'table', classes: ['mo-tab'], pais: [{ tag: 'body', classes: [] }] };
  const linha = { tag: 'tr', classes: [], pais: [tabela, { tag: 'body', classes: [] }] };
  const cabecalho = { tag: 'thead', classes: [], pais: [tabela, { tag: 'body', classes: [] }] };
  const wrap = { tag: 'div', classes: ['mo-tabwrap'], pais: [{ tag: 'body', classes: [] }] };
  assert.equal(valorEfectivo(css, tabela, 'display', 390), 'block');
  assert.equal(valorEfectivo(css, cabecalho, 'display', 390), 'none', 'sem cabeçalho repetido a cada cartão');
  assert.equal(valorEfectivo(css, linha, 'display', 390), 'flex');
  assert.equal(valorEfectivo(css, linha, 'flex-wrap', 390), 'wrap');
  assert.equal(valorEfectivo(css, wrap, 'overflow-x', 390), 'visible', 'nada de rolar para o lado');
  /* a 1440 px a tabela é uma tabela */
  assert.equal(valorEfectivo(css, tabela, 'display', 1440), null);
  assert.equal(valorEfectivo(css, cabecalho, 'display', 1440), null);
  assert.equal(valorEfectivo(css, linha, 'display', 1440), null);
});

test('1.83.0 · a 390 px cabem os separadores do projeto, a pesquisa e as provas do CRM', () => {
  const html = fs.readFileSync(path.join(AQUI, 'src', 'mesa.html'), 'utf8');
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const el = (tag, classes, pais = []) => ({ tag, classes, pais: [...pais, { tag: 'body', classes: [] }] });

  const tabs = el('div', ['pj-tabs']);
  assert.equal(valorEfectivo(css, tabs, 'flex-wrap', 390), 'wrap', 'os separadores quebram em linhas');
  assert.equal(valorEfectivo(css, tabs, 'overflow-x', 390), 'visible');
  assert.equal(valorEfectivo(css, tabs, 'overflow-x', 1440), 'auto', 'na secretária continuam a rolar');

  const pesquisa = el('div', ['search']);
  assert.equal(valorEfectivo(css, pesquisa, 'flex', 390), '1 1 100%', 'a pesquisa ocupa a linha');
  assert.equal(valorEfectivo(css, pesquisa, 'min-width', 390), '0');
  assert.equal(valorEfectivo(css, pesquisa, 'min-width', 1440), '220px');

  const prova = el('div', ['crm-prova']);
  const celula = el('td', [], [prova]);
  assert.equal(valorEfectivo(css, celula, 'display', 390), 'block', 'as duas colunas viram duas linhas');

  const grade = el('div', ['ia-grade']);
  assert.equal(valorEfectivo(css, grade, 'grid-template-columns', 390), '1fr');
  assert.equal(valorEfectivo(css, grade, 'grid-template-columns', 1440), 'repeat(auto-fill, minmax(220px, 1fr))');
});
