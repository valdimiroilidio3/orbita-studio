// 1.80.0 · O TELEMÓVEL, PROVADO PELA ORDEM DAS REGRAS.
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

/** `min-width`/`max-width` em px — o que interessa para decidir se um bloco se aplica. */
export function mediaAplica(media, largura) {
  if (!media || !media.length) return true;
  for (const m of media) {
    const max = /max-width:\s*(\d+)px/.exec(m);
    const min = /min-width:\s*(\d+)px/.exec(m);
    if (max && largura > Number(max[1])) return false;
    if (min && largura < Number(min[1])) return false;
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
export function valorEfectivo(css, el, prop, largura = 390) {
  let vencedor = null;
  for (const r of regras(css)) {
    if (!mediaAplica(r.media, largura)) continue;
    for (const seletor of r.seletor.split(',').map((s) => s.trim())) {
      if (!seletor || !combina(seletor, el)) continue;
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
