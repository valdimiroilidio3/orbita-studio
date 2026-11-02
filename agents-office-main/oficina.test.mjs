// Testes do ESCRITÓRIO COMO INTERFACE — 1.58.0 (2 nov 2026).
//
// O que o dono pediu: cada sala mostra o estado real; os agentes activos têm um
// sinal discreto; clicar numa sala abre um painel contextual; o Cérebro mostra
// relações entre tarefas, agentes e conhecimento; e existe uma vista 2D para
// trabalho intensivo.
//
// O que estes testes provam (sem browser e sem WebGL):
//   · a regra do estado é a MESMA da mesa — `estadoAgentes` de `painel.js` — e não
//     uma segunda opinião escrita na cena;
//   · sem ligação ao servidor, uma sala vazia diz «sem ligação» em vez de «sem
//     trabalho» (não se afirma o que não se viu);
//   · o painel contextual mostra as tarefas reais da sala, com a idade certa, e
//     só oferece Aprovar/Rejeitar quando há mesmo uma decisão à espera;
//   · a planta 2D: as seis salas, o Cérebro, o teclado (setas/Enter/Esc), o foco
//     que volta a quem abriu, e as acções certas para cada botão;
//   · a ligação no `main.js` e no `shell.html` existe mesmo (botão, tecla M,
//     estado no cartão, `brain.setTrabalho`), e o bundle publicado traz o CSS.
//
//   node --test oficina.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

import {
  SALA_PARA_DEPARTAMENTO, ORDEM_SALAS, ESTADOS, INDICADOR,
  normalizarTarefa, estadoDoRetrato, contagensDaSala, estadoDaSala, fraseDoEstado,
  indicadorDeAgente, panoramaDaSala, panoramaHTML, construirPlanta, plantaHTML, initOficina,
  tarefasDoRetrato,
} from './src/oficina.js';
import { estadoAgentes } from './src/painel.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

/* ---------- o escritório falso: seis salas, três agentes, quatro tarefas ---------- */

const SALAS = ORDEM_SALAS.map((k) => ({
  chave: k,
  nome: { emails: 'COMANDO', delivery: 'ENGENHARIA', sales: 'PROSPEÇÃO', marketing: 'MEDIA', fin: 'DESIGN LAB', ops: 'VENDAS' }[k],
  cor: { emails: '#1FA36B', delivery: '#41AEE4', sales: '#E3B93A', marketing: '#DC5348', fin: '#4A6DE0', ops: '#8B5AD6' }[k],
}));

const AGENTES = [
  { id: 'elead', nome: 'ORBITA DIRECTOR', sala: 'emails' },
  { id: 'imail', nome: 'CHEFE DE GABINETE', sala: 'emails' },
  { id: 'pros', nome: 'LEAD HUNTER', sala: 'sales' },
];

const TAREFAS = [
  { id: 1, titulo: 'Escrever o briefing', sala: 'emails', agente: 'elead', estado: 'espera', quando: new Date(Date.now() - 5 * 3600e3).toISOString() },
  { id: 2, titulo: 'Rever a fila de entrada', sala: 'emails', agente: 'imail', estado: 'a-correr', quando: new Date(Date.now() - 20 * 60e3).toISOString() },
  { id: 3, titulo: 'Prospectar Coimbra', sala: 'sales', agente: 'pros', estado: 'falhou', quando: new Date(Date.now() - 2 * 3600e3).toISOString() },
  { id: 4, titulo: 'Site da Aurora', sala: 'delivery', agente: 'qa', estado: 'feita', quando: new Date(Date.now() - 26 * 3600e3).toISOString() },
];

test('1 · as seis salas do escritório falam a mesma língua que os departamentos da mesa', () => {
  assert.deepEqual(ORDEM_SALAS, ['emails', 'delivery', 'sales', 'marketing', 'fin', 'ops']);
  assert.equal(Object.keys(SALA_PARA_DEPARTAMENTO).length, 6);
  for (const k of ['emails', 'delivery', 'sales', 'marketing', 'fin', 'ops']) {
    assert.ok(SALA_PARA_DEPARTAMENTO[k], `${k} tem departamento`);
  }
  // os rótulos são os mesmos da mesa — não há um segundo vocabulário para a mesma coisa
  assert.equal(ESTADOS['espera-ti'].rotulo, 'Espera por ti');
  assert.equal(ESTADOS.bloqueado.rotulo, 'Bloqueada');
});

test('2 · a regra do estado é a da mesa, não uma segunda opinião', () => {
  for (const [nome, c] of Object.entries({
    'a-trabalhar': { aCorrer: 2, porAprovar: 3, falhadas: 4, naFila: 5, concluidas: 1 },
    bloqueado: { aCorrer: 0, porAprovar: 3, falhadas: 4, naFila: 5, concluidas: 1 },
    'espera-ti': { aCorrer: 0, porAprovar: 3, falhadas: 0, naFila: 5, concluidas: 1 },
    'na-fila': { aCorrer: 0, porAprovar: 0, falhadas: 0, naFila: 5, concluidas: 1 },
    'em-descanso': { aCorrer: 0, porAprovar: 0, falhadas: 0, naFila: 0, concluidas: 1 },
    'sem-trabalho': { aCorrer: 0, porAprovar: 0, falhadas: 0, naFila: 0, concluidas: 0 },
  })) {
    const mesa = estadoAgentes({
      departamentos: [{ id: SALA_PARA_DEPARTAMENTO.emails, tarefas: c }], tarefas: [],
    }).linhas[0].estado;
    assert.equal(mesa, nome, `mesa: ${nome}`);
  }
});

test('3 · uma tarefa, venha de onde vier, entra na mesma forma', () => {
  assert.equal(normalizarTarefa({ state: 'doing', title: 'A' }).estado, 'a-correr');
  assert.equal(normalizarTarefa({ state: 'awaiting_approval', title: 'B' }).estado, 'espera');
  assert.equal(normalizarTarefa({ state: 'succeeded', title: 'C' }).estado, 'feita');
  assert.equal(normalizarTarefa({ state: 'queued', title: 'D' }).estado, 'na-fila');
  assert.equal(normalizarTarefa({ state: 'failed', title: 'E' }).estado, 'falhou');
  assert.equal(normalizarTarefa({ state: 'doing' }), null, 'sem título não há tarefa: um nó «—» não diz nada');
  assert.equal(normalizarTarefa({ dept: 'sales', state: 'doing', title: 'F' }).sala, 'sales');
});

test('4 · o retrato do servidor traduz-se nos mesmos seis estados', () => {
  assert.equal(estadoDoRetrato({ state: 'live' }), 'a-trabalhar');
  assert.equal(estadoDoRetrato({ state: 'waiting' }), 'espera-ti');
  assert.equal(estadoDoRetrato({ state: 'error' }), 'bloqueado');
  assert.equal(estadoDoRetrato({ state: 'queued' }), 'na-fila');
  assert.equal(estadoDoRetrato({ state: 'idle' }), 'descanso');
  assert.equal(estadoDoRetrato(null), 'descanso');
});

test('5 · as contagens de uma sala vêm das tarefas e do retrato, sem somar duas vezes', () => {
  const c = contagensDaSala('emails', { tarefas: TAREFAS, agentes: AGENTES, retrato: { elead: { state: 'waiting' } }, ligado: true });
  assert.equal(c.total, 2);
  assert.equal(c.aCorrer, 1);
  assert.equal(c.porAprovar, 1);
  assert.equal(c.falhadas, 0);

  // o servidor vê dois postos a trabalhar onde o browser só conhece um
  const c2 = contagensDaSala('emails', {
    tarefas: TAREFAS, agentes: AGENTES,
    retrato: { elead: { state: 'live' }, imail: { state: 'live' } }, ligado: true,
  });
  assert.equal(c2.aCorrer, 2);

  // sem ligação, o retrato não conta nada — e não se inventa trabalho
  const c3 = contagensDaSala('emails', { tarefas: [], agentes: AGENTES, retrato: { elead: { state: 'live' } }, ligado: false });
  assert.equal(c3.aCorrer, 0);
  assert.equal(c3.total, 0);
});

test('6 · cada sala diz o seu estado, e uma sala sem ligação não afirma «sem trabalho»', () => {
  const e = estadoDaSala({ sala: 'emails', tarefas: TAREFAS, agentes: AGENTES, retrato: {}, ligado: true });
  assert.equal(e.chave, 'a-trabalhar');
  assert.equal(e.rotulo, 'A trabalhar');
  assert.ok(e.ultimaIdade, 'a idade da última atividade é dita');

  const vazia = estadoDaSala({ sala: 'fin', tarefas: TAREFAS, agentes: AGENTES, retrato: {}, ligado: true });
  assert.equal(vazia.chave, 'sem-trabalho');

  const offline = estadoDaSala({ sala: 'fin', tarefas: [], agentes: AGENTES, retrato: {}, ligado: false });
  assert.equal(offline.chave, 'sem-ligacao');
  assert.match(offline.detalhe, /último estado conhecido/);

  const bloqueada = estadoDaSala({ sala: 'sales', tarefas: TAREFAS, agentes: AGENTES, retrato: {}, ligado: true });
  assert.equal(bloqueada.chave, 'bloqueado');
  assert.match(bloqueada.detalhe, /alguém tem de olhar/);
});

test('7 · o sinal de um agente só acende com trabalho real', () => {
  assert.equal(indicadorDeAgente({ estado: 'a-trabalhar', ligado: true }).activo, true);
  assert.equal(indicadorDeAgente({ estado: 'espera-ti', ligado: true }).activo, true);
  assert.equal(indicadorDeAgente({ estado: 'bloqueado', ligado: true }).activo, true);
  assert.equal(indicadorDeAgente({ estado: 'descanso', ligado: true }).activo, false);
  assert.equal(indicadorDeAgente({ estado: 'a-trabalhar', ligado: false }).activo, false, 'sem ligação não se acende');
  assert.equal(indicadorDeAgente({}).rotulo, INDICADOR.descanso.rotulo);
});

test('8 · o painel contextual diz o que está na sala, quem lá está e o que se pode fazer', () => {
  const p = panoramaDaSala({
    sala: 'emails', nome: 'COMANDO', cor: '#1FA36B',
    tarefas: TAREFAS, agentes: AGENTES, retrato: { elead: { state: 'waiting' } }, ligado: true,
  });
  assert.equal(p.tarefas.length, 2);
  assert.equal(p.tarefas[0].titulo, 'Escrever o briefing', 'o que espera decisão vem primeiro');
  assert.equal(p.tarefas[0].aprovavel, true);
  assert.equal(p.tarefas[1].estado, 'a-correr');
  assert.ok(p.tarefas[1].idade, 'a idade de cada tarefa');
  assert.equal(p.pessoas[0].id, 'elead', 'quem está activo vem à frente');
  assert.equal(p.estado.chave, 'a-trabalhar');

  const html = panoramaHTML(p);
  assert.match(html, /data-state="a-trabalhar"/);
  assert.match(html, /Escrever o briefing/);
  assert.match(html, /data-of="aprovar" data-agente="elead"/);
  assert.match(html, /data-of="abrir-2d"/);
  assert.match(html, /Ver esta sala em 2D/);
});

test('8b · a tarefa que o servidor diz que está a correr também entra no painel', () => {
  const p = panoramaDaSala({
    sala: 'emails', nome: 'COMANDO', tarefas: [], agentes: AGENTES,
    retrato: { elead: { state: 'live', task: { id: 't9', title: 'A escrever a proposta', state: 'running', started_at: new Date(Date.now() - 4 * 60000).toISOString() } } },
    ligado: true,
  });
  assert.equal(p.tarefas.length, 1, 'a sala dizia «1 a correr» e o painel dizia «nada registado»');
  assert.equal(p.tarefas[0].titulo, 'A escrever a proposta');
  assert.equal(p.tarefas[0].estado, 'a-correr');
  assert.ok(p.tarefas[0].idade, 'a idade vem do servidor');
  assert.match(panoramaHTML(p), /A escrever a proposta/);

  // sem ligação, o retrato não conta: nada de tarefas fantasmas
  const offline = panoramaDaSala({
    sala: 'emails', tarefas: [], agentes: AGENTES,
    retrato: { elead: { state: 'live', task: { title: 'A escrever a proposta', state: 'running' } } }, ligado: false,
  });
  assert.equal(offline.tarefas.length, 0);
});

test('9 · sem decisões pendentes não há botões de aprovar (não se finge uma decisão)', () => {
  const p = panoramaDaSala({ sala: 'sales', tarefas: TAREFAS, agentes: AGENTES, retrato: {}, ligado: true });
  const html = panoramaHTML(p);
  assert.doesNotMatch(html, /data-of="aprovar"/);
  assert.match(html, /Prospectar Coimbra/);
  assert.match(html, /falhou/);
});

test('10 · a planta junta as seis salas, o Cérebro e a ligação — a mesma conta do painel', () => {
  const planta = construirPlanta({
    salas: SALAS, tarefas: TAREFAS, agentes: AGENTES,
    retrato: { elead: { state: 'waiting' }, imail: { state: 'live' } },
    ligado: true, brain: { notas: 14, ligacoes: 9, resumo: { curto: '2 agentes · 4 tarefas' } },
  });
  assert.equal(planta.salas.length, 6);
  assert.equal(planta.resumo.tarefas, 4);
  assert.equal(planta.resumo.aCorrer, 1);
  assert.equal(planta.resumo.aEspera, 1);
  assert.equal(planta.resumo.falhadas, 1);
  assert.equal(planta.resumo.activos, 2);
  assert.equal(planta.brain.notas, 14);

  const html = plantaHTML(planta, { seleccionada: 'emails' });
  for (const s of SALAS) assert.match(html, new RegExp(`data-sala="${s.chave}"`), `${s.chave} está na planta`);
  assert.match(html, /O Cérebro/);
  assert.match(html, /14 notas · 9 ligações/);
  assert.match(html, /aria-pressed="true"/, 'a sala escolhida fica marcada');
  assert.match(html, /data-of="abrir-3d"/, 'na planta, a acção é voltar ao 3D');
  assert.match(html, /data-of="fechar"/);
});

test('11 · sem ligação, a planta di-lo em vez de mostrar zeros como factos', () => {
  const planta = construirPlanta({ salas: SALAS, tarefas: [], agentes: AGENTES, retrato: {}, ligado: false });
  const html = plantaHTML(planta, {});
  assert.match(html, /sem ligação ao vivo/);
  assert.match(html, /Sem ligação/, 'cada sala diz que não viu nada');
  assert.match(html, /Escolhe uma sala/, 'sem escolha, ensina em vez de mostrar um vazio');
});

/* ---------- a planta viva, num DOM ---------- */

function novaPlanta(opts = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="antes">antes</button></body></html>', { url: 'https://mesa.test/' });
  const dados = opts.dados || {
    salas: SALAS, tarefas: TAREFAS, agentes: AGENTES,
    retrato: { elead: { state: 'waiting' }, imail: { state: 'live' } },
    ligado: true, brain: { notas: 14, ligacoes: 9, resumo: { curto: '2 agentes · 4 tarefas' } },
  };
  const chamadas = { sala: [], tarefas: [], agente: [], aprovar: [], rejeitar: [], fechar: 0 };
  const oficina = initOficina({
    doc: dom.window.document,
    getDados: () => dados,
    onAbrirSala: (k) => chamadas.sala.push(k),
    onAbrirTarefas: (k) => chamadas.tarefas.push(k),
    onAgente: (id) => chamadas.agente.push(id),
    onAprovar: (id) => chamadas.aprovar.push(id),
    onRejeitar: (id) => chamadas.rejeitar.push(id),
    onFechar: () => { chamadas.fechar += 1; },
  });
  return { dom, doc: dom.window.document, oficina, chamadas, dados };
}

test('12 · abrir a planta monta as seis salas, escolhe a primeira e fecha com Esc', () => {
  const { doc, oficina, chamadas } = novaPlanta();
  assert.equal(oficina.estaAberto(), false);
  const ov = doc.getElementById('planta');
  assert.ok(ov, 'a planta existe no documento');
  assert.equal(ov.hidden, true);

  oficina.abrir();
  assert.equal(oficina.estaAberto(), true);
  assert.equal(ov.hidden, false);
  assert.equal(doc.querySelectorAll('.pl-sala').length, 6);
  assert.equal(doc.querySelector('.pl-sala[aria-pressed="true"]').dataset.sala, 'emails');
  assert.ok(doc.body.classList.contains('plantaAberta'));

  // Esc numa sala fecha e avisa (quem abriu a planta decide o resto)
  doc.querySelector('.pl-sala').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(oficina.estaAberto(), false);
  assert.equal(ov.hidden, true);
  assert.equal(chamadas.fechar, 1);
  assert.equal(doc.body.classList.contains('plantaAberta'), false);
});

test('13 · as setas andam pela grelha e o Enter abre a sala no 3D', () => {
  const { doc, oficina, chamadas } = novaPlanta();
  oficina.abrir();
  /* cada tecla parte da sala que está escolhida — tal como o browser faria, porque
     o foco segue a escolha depois de cada redesenho */
  const tecla = (key) => {
    const alvo = doc.querySelector('.pl-sala[aria-pressed="true"]');
    alvo.focus();
    alvo.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key, bubbles: true }));
  };

  tecla('ArrowRight');
  assert.equal(oficina.salaEscolhida(), 'delivery', 'à direita está a sala seguinte');
  tecla('ArrowDown');
  assert.equal(oficina.salaEscolhida(), 'fin', 'três à frente, como a grelha de três colunas');
  tecla('ArrowUp');
  assert.equal(oficina.salaEscolhida(), 'delivery');

  const actual = doc.querySelector('.pl-sala[aria-pressed="true"]');
  actual.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(chamadas.sala, ['delivery'], 'Enter abre a sala no 3D e fecha a planta');
  assert.equal(oficina.estaAberto(), false);
});

test('14 · clicar numa sala escolhe-a; o painel mostra as tarefas reais e os botões certos', () => {
  const { doc, oficina, chamadas } = novaPlanta();
  oficina.abrir('emails');
  const painel = doc.querySelector('.pl-detail');
  assert.match(painel.textContent, /Escrever o briefing/);
  assert.match(painel.textContent, /Aprovar/);

  // aprovar chama a acção real, com o agente certo
  const aprovar = painel.querySelector('[data-of="aprovar"]');
  assert.equal(aprovar.dataset.agente, 'elead');
  aprovar.click();
  assert.deepEqual(chamadas.aprovar, ['elead']);
  assert.deepEqual(chamadas.rejeitar, []);

  // clicar noutra sala muda o painel
  doc.querySelector('.pl-sala[data-sala="sales"]').click();
  assert.equal(oficina.salaEscolhida(), 'sales');
  assert.match(doc.querySelector('.pl-detail').textContent, /Prospectar Coimbra/);
  assert.equal(doc.querySelector('.pl-sala[data-sala="sales"]').getAttribute('aria-pressed'), 'true');

  // as duas acções de saída existem e vão ao escritório
  doc.querySelector('.pl-detail [data-of="abrir-3d"]').click();
  assert.deepEqual(chamadas.sala, ['sales']);
  assert.equal(oficina.estaAberto(), false);
});

test('15 · "Tarefas da sala" abre o quadro certo, e fechar devolve o foco a quem abriu', () => {
  const { dom, doc, oficina, chamadas } = novaPlanta();
  const antes = doc.getElementById('antes');
  antes.focus();
  oficina.abrir('ops');
  assert.equal(doc.activeElement.dataset.sala, 'ops', 'o foco entra na sala escolhida');

  doc.querySelector('.pl-detail [data-of="abrir-tarefas"]').click();
  assert.deepEqual(chamadas.tarefas, ['ops']);

  oficina.fechar();
  assert.equal(doc.activeElement.id, 'antes', 'o foco volta a quem abriu');
  assert.equal(dom.window.document.getElementById('planta').innerHTML, '');
});

test('16 · a planta actualiza sem perder a sala escolhida', () => {
  const { doc, oficina, dados } = novaPlanta();
  oficina.abrir('sales');
  dados.tarefas = [...dados.tarefas, { id: 9, titulo: 'Nova tarefa da sala', sala: 'sales', agente: 'pros', estado: 'na-fila' }];
  dados.retrato = { pros: { state: 'live' } };
  oficina.actualizar();
  assert.equal(oficina.salaEscolhida(), 'sales');
  assert.match(doc.querySelector('.pl-detail').textContent, /Nova tarefa da sala/);
  assert.equal(doc.querySelector('.pl-sala[data-sala="sales"]').dataset.state, 'a-trabalhar');
});

/* ---------- a ligação real: ficheiros que não se podem correr sem WebGL ---------- */

const ler = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('17 · o escritório está ligado à oficina: botão, tecla M, estado no cartão e Cérebro', () => {
  const main = ler('src/main.js');
  const shell = ler('src/shell.html');

  assert.match(main, /from '\.\/oficina\.js'/, 'a cena importa as contas puras');
  assert.match(main, /const oficina = initOficina\(/, 'a planta é montada no arranque');
  assert.match(main, /onAprovar: \(id\) => resolveApproval\(id, true\)/, 'aprovar na planta é a acção real');
  assert.match(main, /e\.key === 'm' \|\| e\.key === 'M'/, 'a tecla M abre a planta');
  assert.match(main, /getElementById\('z2d'\)/, 'o botão da planta existe e está ligado');
  assert.match(shell, /id="z2d"/, 'o botão está no HTML');

  assert.match(main, /panoramaHTML\(panoramaDe\(k\)\)/, 'a gaveta da sala abre o painel contextual');
  assert.match(main, /if \(of === 'aprovar' \|\| of === 'rejeitar'\)/, 'os botões da gaveta tratam a decisão');
  assert.match(main, /class = 'b-state'|className = 'b-state'/, 'o cartão da sala ganha o estado');
  assert.match(main, /function syncEstadoDasSalas\(/, 'o estado é escrito nos seis cartões');
  assert.match(main, /function actualizarSinal\(/, 'há um sinal por agente');
  assert.match(main, /const sinal = makeActivityDot\(\)/, 'o sinal é um sprite discreto');
  assert.match(main, /brain\.setTrabalho\(\{ agentes: AGENTES_3D/, 'o Cérebro recebe as relações');
  assert.match(main, /sinal\.visible = !!ind\.activo/, 'o sinal só acende com trabalho real');
});

test('18 · o Cérebro sabe juntar trabalho ao grafo, e a rede é a mesma dos testes', () => {
  const brain = ler('src/brain.js');
  assert.match(brain, /import \{ construirRede, resumoDaRede, GRUPO \} from '\.\/rede\.js'/);
  assert.match(brain, /function setTrabalho\(\{ agentes = \[\], tarefas = \[\] \} = \{\}\) \{/);
  assert.match(brain, /nodes\.length = baseLen/, 'o trabalho é reconstruído, não acumulado');
  assert.match(brain, /return \{ read, readNote, write, setGraph, setTrabalho, rede: \(\) => redeAtual/);
});

test('19 · o CSS da interface está no bundle que se publica', () => {
  const dist = path.join(ROOT, 'dist', 'command-centre-v2.html');
  if (!fs.existsSync(dist)) return; // sem build local não há o que ler aqui
  const html = fs.readFileSync(dist, 'utf8');
  for (const agulha of ['.b-state', '.pra-state', '#planta', '.pl-sala', '.pl-centro', '.pl-detail']) {
    assert.ok(html.includes(agulha), `o bundle traz ${agulha}`);
  }
  assert.ok(html.includes('z2d'), 'o botão da planta vai no bundle');
  // os acentos podem viajar escapados no bundle (`\xF3`): procura-se o que é estável
  assert.ok(/planta do escrit/.test(html), 'o nome acessível vai no bundle');
});
