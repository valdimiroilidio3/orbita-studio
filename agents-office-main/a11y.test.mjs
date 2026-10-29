// Testes da ACESSIBILIDADE — o espelho por palavras do escritório (26 out 2026, V8).
//
// Porque existem: o escritório era rato-apenas. As salas e os agentes só se abriam com um clique
// num `div` de três dimensões, e o `<canvas>` não dizia nada a um leitor de ecrã. `src/a11y.js`
// resolve isso sem tocar na cena — constrói uma lista em HTML com as mesmas acções — mas um
// módulo que ninguém executa é uma promessa, não uma garantia. Estes testes executam-no.
//
// O que fica provado:
//   · as 7 salas e os 47 agentes existem, e cada um é um <button> a sério (não um div com
//     `role="button"`), logo Enter e Espaço funcionam por semântica do browser;
//   · abrir move o foco para dentro, fechar devolve-o a quem abriu, Esc fecha;
//   · Tab circula dentro da lista, e Shift+Tab também — não se foge para a cena;
//   · clicar numa sala/agente chama a MESMA acção do rato (sem lógica paralela);
//   · `close(false)` não rouba o foco a quem o vai tratar (o rail, o grafo);
//   · o texto é PT-PT e o que vem dos dados é escapado (um nome com `<` não é HTML).
//
// E, porque a acessibilidade também se prova no que está escrito nos ficheiros que não se podem
// correr sem WebGL, há um segundo bloco que LÊ `src/main.js` e `src/shell.html` e verifica os
// invariantes do pedido: o canvas tem nome, os cartões e as pastilhas entram no Tab, e o espelho
// está ligado às duas acções reais.
//
//   node --test a11y.test.mjs        (ou: npm run test:a11y)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import { initA11y } from './src/a11y.js';
/* 1.53.0: o escritório falso tem de ser do TAMANHO do verdadeiro. Antes era um `Array.from(35)`
   escrito à mão; quando os agentes passaram a 47, este teste continuava a falar de 35 e a passar.
   Agora o espelho lê os dados reais e a contagem é conferida com um número explícito. */
import { AGENTS as AGENTS_REAIS } from './src/data.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/* ---------- um escritório falso, do tamanho do verdadeiro ---------- */

const SALAS = ['emails', 'delivery', 'sales', 'marketing', 'fin', 'ops', 'brain'];
const NOMES = {
  emails: 'Comando', delivery: 'Engenharia', sales: 'Prospecção',
  marketing: 'Media', fin: 'Design Lab', ops: 'Vendas', brain: 'Cérebro',
};
const AGENTES = AGENTS_REAIS.map((a) => ({
  id: a.id,
  name: a.name,
  dept: a.dept,
  lead: !!a.lead,
}));

function montar(opts = {}) {
  const dom = new JSDOM('<!doctype html><html lang="pt"><body></body></html>');
  const { document: doc, KeyboardEvent } = dom.window;
  const chamadas = { salas: [], agentes: [] };
  const api = initA11y({
    doc,
    agents: AGENTES,
    deptKeys: SALAS,
    describeRoom: (k) => ({
      name: NOMES[k], short: NOMES[k].toUpperCase(),
      glass: k === 'brain' ? '#AEB6AB' : '#1FA36B',
      meta: k === 'brain' ? '12 notas no vault' : '5 agentes · 1 a trabalhar · 0 à espera',
      empty: k === 'brain' ? 'O centro não tem secretárias.' : '',
      action: 'Abrir a sala',
    }),
    describeAgent: (id) => {
      const a = AGENTES.find((x) => x.id === id);
      return { name: a.name, role: 'Função', deptName: NOMES[a.dept], label: 'a trabalhar', kind: 'live' };
    },
    onRoom: (k) => chamadas.salas.push(k),
    onAgent: (id) => chamadas.agentes.push(id),
    ...opts,
  });
  return { dom, doc, api, chamadas, KeyboardEvent };
}

const tecla = (doc, alvo, key, extra = {}) =>
  alvo.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));

/* ---------- 1. o que é preciso para navegar ---------- */

test('monta as 7 salas e os 47 agentes, e cada agente é um <button> a sério', () => {
  const { doc, api } = montar();
  assert.equal(api.el.id, 'officeIndex');
  assert.equal(api.el.getAttribute('role'), 'dialog');
  assert.equal(api.el.getAttribute('aria-modal'), 'true');
  assert.ok(api.el.getAttribute('aria-labelledby'), 'o diálogo tem de ter um título associado');

  const salas = api.el.querySelectorAll('.oi-room');
  assert.equal(salas.length, 7, 'são 6 salas e o centro');

  // `button` (e não `div role=button`): é o que dá Enter e Espaço de graça e o que o
  // leitor de ecrã anuncia como «botão». Um div com role seria uma imitação.
  const agentes = api.el.querySelectorAll('button.oi-agent');
  assert.equal(AGENTS_REAIS.length, 47, 'o escritório tem 47 agentes: se este número mudar, o teste muda com ele');
  assert.equal(agentes.length, AGENTS_REAIS.length);
  for (const b of agentes) {
    assert.equal(b.tagName, 'BUTTON');
    assert.equal(b.getAttribute('type'), 'button');
    assert.ok(b.getAttribute('aria-label'), `o agente ${b.dataset.agent} precisa de um nome`);
  }
  for (const b of api.el.querySelectorAll('.oi-open')) {
    assert.equal(b.tagName, 'BUTTON');
    assert.match(b.getAttribute('aria-label'), /^Abrir/);
  }
});

test('o centro não inventa agentes: diz, por palavras, o que lá está', () => {
  const { api } = montar();
  const brain = [...api.el.querySelectorAll('.oi-room')].find((r) => r.querySelector('[id="oi-h-brain"]'));
  assert.ok(brain, 'falta a sala do centro');
  assert.equal(brain.querySelectorAll('.oi-agent').length, 0);
  assert.match(brain.textContent, /O centro não tem secretárias/);
  assert.match(brain.textContent, /12 notas no vault/);
});

test('a ordem de tabulação é: salas e agentes na ordem dos dados, e o total é o esperado', () => {
  const { api } = montar();
  const lista = api.focusables();
  // 1 fechar + 7 salas + 47 agentes
  assert.equal(lista.length, 1 + 7 + AGENTS_REAIS.length);
  // agrupados por sala (a ordem dos dados), e todos presentes exactamente uma vez
  const ids = lista.filter((n) => n.dataset.agent).map((n) => n.dataset.agent);
  assert.deepEqual([...ids].sort(), AGENTES.map((a) => a.id).sort());
  const porSala = SALAS.flatMap((k) => AGENTES.filter((a) => a.dept === k).map((a) => a.id));
  assert.deepEqual(ids, porSala, 'a ordem segue as salas, não o acaso do ficheiro');
  // a primeira coisa que recebe foco ao abrir é o botão de fechar (o topo do diálogo)
  assert.equal(lista[0].getAttribute('aria-label'), 'fechar a lista (Esc)');
});

/* ---------- 2. abrir, fechar e o foco ---------- */

test('abrir põe o foco dentro; fechar devolve-o a quem abriu', () => {
  const { doc, api, tecla: _t } = montar();
  const gatilho = doc.createElement('button');
  gatilho.textContent = 'abrir';
  doc.body.appendChild(gatilho);
  gatilho.focus();

  assert.equal(api.isOpen(), false);
  assert.equal(api.el.hidden, true);

  api.open(gatilho);
  assert.equal(api.isOpen(), true);
  assert.equal(api.el.hidden, false);
  assert.ok(doc.body.classList.contains('indexOpen'), 'o resto da página tem de saber que há um modal');
  assert.equal(doc.activeElement, api.el.querySelector('.oi-close'));

  api.close();
  assert.equal(api.el.hidden, true);
  assert.ok(!doc.body.classList.contains('indexOpen'));
  assert.equal(doc.activeElement, gatilho, 'o foco volta a quem abriu a lista');
});

test('close(false) fecha sem tocar no foco — quem trata da acção manda', () => {
  const { doc, api } = montar();
  const gatilho = doc.createElement('button');
  doc.body.appendChild(gatilho);
  api.open(gatilho);
  const dentro = doc.activeElement;
  api.close(false);
  assert.equal(api.el.hidden, true);
  assert.equal(doc.activeElement, dentro, 'aqui o foco NÃO devia voltar atrás');
});

test('Esc fecha e devolve o foco', () => {
  const { doc, api } = montar();
  const gatilho = doc.createElement('button');
  doc.body.appendChild(gatilho);
  gatilho.focus();
  api.open(gatilho);
  tecla(doc, doc.activeElement, 'Escape');
  assert.equal(api.el.hidden, true);
  assert.equal(doc.activeElement, gatilho);
});

test('Tab circula dentro da lista (e Shift+Tab também) — não se foge para a cena', () => {
  const { doc, api } = montar();
  const gatilho = doc.createElement('button');
  doc.body.appendChild(gatilho);
  api.open(gatilho);

  const lista = api.focusables();
  const primeiro = lista[0];
  const ultimo = lista[lista.length - 1];

  ultimo.focus();
  const ev = new doc.defaultView.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  ultimo.dispatchEvent(ev);
  assert.equal(ev.defaultPrevented, true, 'o Tab no último tem de ser tratado aqui');
  assert.equal(doc.activeElement, primeiro);

  const ev2 = new doc.defaultView.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
  primeiro.dispatchEvent(ev2);
  assert.equal(ev2.defaultPrevented, true);
  assert.equal(doc.activeElement, ultimo);
});

test('com a lista aberta, as teclas não seguem para os atalhos da cena', () => {
  const { doc, api } = montar();
  const gatilho = doc.createElement('button');
  doc.body.appendChild(gatilho);
  let chegouFora = 0;
  doc.body.addEventListener('keydown', () => { chegouFora++; });
  api.open(gatilho);
  tecla(doc, doc.activeElement, 'g'); // «g» abre o grafo quando a lista está fechada
  assert.equal(chegouFora, 0, 'a tecla ficou presa no diálogo');
});

/* ---------- 3. as acções são as mesmas do rato ---------- */

test('clicar numa sala chama onRoom com a chave certa', () => {
  const { api, chamadas } = montar();
  api.open();
  api.el.querySelector('[data-room="fin"]').click();
  assert.deepEqual(chamadas.salas, ['fin']);
  assert.equal(api.el.hidden, true, 'escolher uma sala fecha a lista');
});

test('clicar num agente chama onAgent com o id certo', () => {
  const { api, chamadas } = montar();
  api.open();
  const alvo = AGENTES[6].id;
  api.el.querySelector(`[data-agent="${alvo}"]`).click();
  assert.deepEqual(chamadas.agentes, [alvo]);
  assert.deepEqual(chamadas.salas, [], 'abrir um agente não abre uma sala');
});

test('o botão de fechar não dispara acção nenhuma', () => {
  const { api, chamadas } = montar();
  api.open();
  api.el.querySelector('.oi-close').click();
  assert.equal(api.el.hidden, true);
  assert.deepEqual(chamadas, { salas: [], agentes: [] });
});

test('refresh() volta a ler o estado sem perder o sítio', () => {
  let estado = 'a trabalhar';
  const { api } = montar({ describeAgent: (id) => ({ name: id, role: 'Função', deptName: 'Media', label: estado, kind: 'live' }) });
  assert.match(api.el.textContent, /a trabalhar/);
  api.open();
  estado = 'à espera do teu OK';
  api.refresh();
  assert.match(api.el.textContent, /à espera do teu OK/);
  assert.equal(api.isOpen(), true, 'refrescar não fecha a lista');
});

/* ---------- 4. texto: PT-PT, escapado, honesto ---------- */

test('o texto é PT-PT e conta o que está lá', () => {
  const { api, doc } = montar();
  const t = api.el.textContent;
  assert.match(t, /7 salas · 47 agentes/);
  assert.match(t, /Tab/);
  assert.match(t, /Enter/);
  assert.match(t, /Esc/);
  assert.equal(doc.documentElement.getAttribute('lang') || 'pt', 'pt');
});

test('um nome com HTML é texto, não marcação', () => {
  const nome = '<img src=x onerror=alert(1)>';
  const { api } = montar({
    agents: [{ id: 'x', name: nome, dept: 'emails' }],
    deptKeys: ['emails'],
    describeAgent: () => ({ name: nome, role: 'Função', deptName: 'Comando', label: 'a trabalhar', kind: 'live' }),
  });
  assert.equal(api.el.querySelectorAll('img').length, 0);
  assert.match(api.el.textContent, /<img src=x onerror=alert\(1\)>/, 'o nome tem de aparecer como texto');
});

test('sem documento, o módulo recusa em vez de fingir', () => {
  assert.throws(() => initA11y({ doc: null }), /sem document/);
});

/* =========================================================================
   5. os invariantes que vivem nos ficheiros que não correm sem WebGL
   ========================================================================= */

const main = fs.readFileSync(path.join(ROOT, 'src', 'main.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'src', 'shell.html'), 'utf8');

test('o canvas tem nome e descrição, e a página está em português', () => {
  assert.match(shell, /<html lang="pt">/);
  const canvas = shell.match(/<canvas id="scene"[^>]*>/);
  assert.ok(canvas, 'o canvas da cena desapareceu');
  assert.match(canvas[0], /role="img"/);
  const nome = canvas[0].match(/aria-label="([^"]+)"/);
  assert.ok(nome && nome[1].length > 20, 'o nome do canvas tem de dizer o que é a cena');
  const desc = canvas[0].match(/aria-describedby="([^"]+)"/);
  assert.ok(desc, 'o canvas tem de apontar para a descrição longa');
  assert.ok(shell.includes(`id="${desc[1]}"`), 'a descrição apontada não existe no ficheiro');
});

test('a lista do escritório é alcançável sem saber atalhos: ligação de salto + tecla L', () => {
  assert.match(shell, /id="skipIndex"[^>]*>Saltar para a lista do escritório/, 'falta a ligação de salto');
  assert.match(shell, /id="zIndex"/, 'falta o botão visível ao lado do zoom');
  assert.match(main, /e\.key === 'l'.*a11y\.toggle/, 'a tecla L não abre a lista');
  assert.match(main, /getElementById\('skipIndex'\)\s*\.addEventListener\('click'/, 'a ligação de salto não faz nada');
});

test('as 7 salas e os 35 agentes são a mesma lista dos dados reais', () => {
  assert.match(main, /deptKeys: \[\.\.\.DEPT_KEYS, 'brain'\]/);
  assert.match(main, /agents: AGENTS/);
  // as duas acções do rato continuam a ser as do espelho — uma só implementação
  assert.match(main, /onRoom: \(k\) => \{ if \(k === 'brain'\) brain\.open\(\); else zoomToDept\(k\);/);
  assert.match(main, /onAgent: \(id\) => \{ openAgent\(id,/);
});

test('cartões de sala e pastilhas dos agentes entram no Tab, com Enter e Espaço', () => {
  // o cartão (6 salas + centro)
  assert.match(main, /b\.setAttribute\('role', 'button'\)/);
  assert.match(main, /b\.tabIndex = 0/);
  assert.match(main, /b\.setAttribute\('aria-label', badgeLabel\(k\)\)/);
  // a pastilha: 35 no ecrã, mas só as da sala em foco no Tab (senão eram 35 paragens)
  assert.match(main, /pill\.tabIndex = -1/);
  assert.match(main, /focused === r\.a\.dept \? 0 : -1/);
  // uma só forma de activar, para os dois: a mesma do clique
  assert.equal((main.match(/if \(e\.key === 'Enter' \|\| e\.key === ' '\)/g) || []).length, 2);
  assert.equal((main.match(/e\.preventDefault\(\); (b|pill)\.click\(\)/g) || []).length, 2);
});

test('o botão de aprovação deixou de ser uma div: agora recebe foco e Enter', () => {
  const ocorrencias = main.match(/<button type="button" class="b-appr"/g) || [];
  assert.equal(ocorrencias.length, 2, 'são dois: o cartão da sala e o cabeçalho do rail');
  assert.equal((main.match(/<div class="b-appr"/g) || []).length, 0, 'ficou uma div clicável');
});

test('nada disto toca no 3D: o espelho não importa three nem desenha geometria', () => {
  const origem = fs.readFileSync(path.join(ROOT, 'src', 'a11y.js'), 'utf8');
  assert.ok(!/three|THREE|WebGL|canvas/.test(origem.replace(/\/\/.*$/gm, '')), 'o espelho não pode depender da cena');
  assert.ok(!/Geometry|Material|Camera/.test(origem.replace(/\/\/.*$/gm, '')), 'o espelho não desenha nada');
});
