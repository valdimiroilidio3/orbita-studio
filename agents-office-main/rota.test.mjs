/* ===========================================================================
   1.53.1 · «AS IAs DEVEM RESPONDER A TUDO» — a prova.

   O caso real (29 out 2026): Groq escolhida, «oi» escrito, modo CONSTRUIR. O
   cartão respondeu «Não foi criada — esta página está publicada sem o servidor
   das tarefas». A Groq nunca foi chamada. Um pedido de conversa morreu por
   causa de uma rota que não existe na publicação.

   Aqui prova-se a regra que impede isso:
     · a decisão de rota (src/rota.js) manda para a conversa sempre que o quadro
       não existe — e nunca inventa uma tarefa;
     · `main.js` usa essa decisão no CONSTRUIR e cai para a conversa quando
       `/api/tasks` ou `/api/chat` respondem 404;
     · o aviso da queda diz o que aconteceu (sem quadro) e não promete uma
       tarefa que não existe;
     · o texto da falha deixa de ser um beco sem saída.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { CAMINHOS, rotaDoEnvio, deveCairParaConversa, avisoDaQueda, metaDaQueda } from './src/rota.js';
import { explicarFalha } from './src/falhas.js';

const MAIN = readFileSync(new URL('./src/main.js', import.meta.url), 'utf8');

/* ---------- a decisão ---------- */

test('sem quadro, CONSTRUIR vai para a conversa — não morre, não inventa tarefa', () => {
  const r = rotaDoEnvio({ modo: 'build', par: { fornecedor: 'groq', modelo: 'openai/gpt-oss-120b' }, quadro: false, temCli: false, temOrbita: true });
  assert.equal(r, CAMINHOS.CONVERSA);
  // o mesmo sem par escolhido (router automático)
  assert.equal(rotaDoEnvio({ modo: 'build', quadro: false, temCli: false, temOrbita: true }), CAMINHOS.CONVERSA);
  // e mesmo numa máquina com motor local, o build sem quadro responde na conversa da Órbita
  assert.equal(rotaDoEnvio({ modo: 'build', quadro: false, temCli: true, temOrbita: true }), CAMINHOS.CONVERSA);
});

test('com quadro, CONSTRUIR continua a criar a tarefa (nada mudou no servidor local)', () => {
  assert.equal(rotaDoEnvio({ modo: 'build', quadro: true, temCli: true, temOrbita: true }), CAMINHOS.QUADRO);
});

test('um par escolhido à mão vai sempre pela conversa da Órbita (o /api/chat não o conhece)', () => {
  assert.equal(rotaDoEnvio({ modo: 'ask', par: { fornecedor: 'groq', modelo: 'x' }, quadro: true, temCli: true }), CAMINHOS.CONVERSA);
  assert.equal(rotaDoEnvio({ modo: 'plan', par: { fornecedor: 'groq', modelo: 'x' }, quadro: false, temCli: false }), CAMINHOS.CONVERSA);
});

test('na publicação (sem CLI) a conversa é o caminho, mesmo em automático', () => {
  assert.equal(rotaDoEnvio({ modo: 'ask', temCli: false, temOrbita: true }), CAMINHOS.CONVERSA);
  // e sem catálogo nenhum também não se bate numa rota que não existe: tenta-se a conversa
  assert.equal(rotaDoEnvio({ modo: 'ask', temCli: false, temOrbita: false }), CAMINHOS.CONVERSA);
  // na máquina do dono, com CLI, o motor local continua a ser o primeiro
  assert.equal(rotaDoEnvio({ modo: 'ask', temCli: true, temOrbita: true }), CAMINHOS.MOTOR_LOCAL);
});

test('só se cai para a conversa quando a rota não existe — um 500 não se disfarça de conversa', () => {
  assert.equal(deveCairParaConversa({ falha: { tipo: 'sem-servidor' }, temOrbita: true }), true);
  assert.equal(deveCairParaConversa({ falha: { tipo: 'servidor' }, temOrbita: true }), false);
  assert.equal(deveCairParaConversa({ falha: { tipo: 'rede' }, temOrbita: true }), false);
  assert.equal(deveCairParaConversa({ falha: { tipo: 'sem-servidor' }, temOrbita: false }), false);
  assert.equal(deveCairParaConversa({}), false);
});

test('o aviso da queda diz a verdade e não promete uma tarefa', () => {
  const a = avisoDaQueda({ modo: 'build' });
  assert.match(a, /quadro de tarefas só existe/i);
  assert.match(a, /conversa/i);
  assert.equal(/criad|tarefa criada|no quadro com o id/i.test(a), false);
  assert.match(metaDaQueda({ modo: 'build' }), /sem quadro nesta publicação/);
});

/* ---------- os fios no main.js ---------- */

test('main.js: CONSTRUIR pergunta à decisão antes de tentar o quadro', () => {
  const ramo = /if \(m\.mode === 'build'\) \{[\s\S]*?\n  \}/.exec(MAIN);
  assert.ok(ramo, 'não encontrei o ramo do CONSTRUIR em sendChat');
  assert.match(ramo[0], /rotaDoEnvio\(\{ modo: 'build'/, 'decide pela função pura, não por um if à mão');
  assert.match(ramo[0], /conversaEmVezDeQuadro/, 'sem quadro tem de responder em conversa');
  // o aviso antigo (que só dizia «precisa do quadro») já não existe
  assert.equal(/Construir precisa do quadro de tarefas/.test(MAIN), false,
    'o beco sem saída de 29 out não pode voltar');
});

test('main.js: o quadro que falha com 404 também cai para a conversa', () => {
  const fn = /async function buildFromChat[\s\S]*?\n\}/.exec(MAIN);
  assert.ok(fn, 'não encontrei buildFromChat');
  assert.match(fn[0], /deveCairParaConversa\(\{ falha: f, temOrbita: temOrbitaAgora\(\) \}\)/);
  assert.match(fn[0], /conversaEmVezDeQuadro\(id, text, m, par, f\)/);
  // e sem quadro nenhum, sai logo para a conversa (antes de escrever no chat)
  assert.match(fn[0], /if \(!tasks \|\| !tasks\.isLive\(\)\) return conversaEmVezDeQuadro/);
});

test('main.js: um 404 em /api/chat também é respondido pela Órbita', () => {
  const trecho = /rota: '\/api\/chat'[\s\S]{0,900}?throw e;/.exec(MAIN);
  assert.ok(trecho, 'não encontrei o tratamento da falha do motor local');
  assert.match(trecho[0], /deveCairParaConversa/);
  assert.match(trecho[0], /sendChatOrbita\(id, clean, m, par\)/);
});

test('main.js: a resposta nunca duplica a mensagem do dono ao cair para a conversa', () => {
  // sendChatOrbita tira a última mensagem do histórico se for a mesma pergunta
  const fn = /async function sendChatOrbita[\s\S]*?\n\}/.exec(MAIN);
  assert.ok(fn);
  assert.match(fn[0], /ultima\.who === 'user' && ultima\.text === texto/, 'a pergunta ia ser lida duas vezes pela IA');
});

test('main.js: a conversa em vez do quadro usa o par escolhido (a Groq, não o router)', () => {
  const fn = /async function conversaEmVezDeQuadro[\s\S]*?\n\}/.exec(MAIN);
  assert.ok(fn, 'não encontrei conversaEmVezDeQuadro');
  assert.match(fn[0], /sendChatOrbita\(id, text, \{ \.\.\.m, mode: 'ask' \}, par/,
    'o par tem de seguir para a conversa: é a escolha do dono');
  // e diz que trocou de caminho
  assert.match(fn[0], /avisoDaQueda\(\{ modo: m\.mode \}\)/);
});

test('a falha «sem servidor» deixa de ser um beco sem saída', () => {
  const f = explicarFalha({ status: 404, texto: '<!doctype html><html>The page could not be found</html>', rota: '/api/tasks' });
  assert.equal(f.tipo, 'sem-servidor');
  assert.match(f.ajuda, /conversa não depende desta rota/i);
  assert.match(f.ajuda, /npm start/);
});

test('main.js: se a escolha falhar, tenta o automático uma vez (e só uma)', () => {
  const fn = /async function sendChatOrbita[\s\S]*?\n\}/.exec(MAIN);
  assert.ok(fn);
  assert.match(fn[0], /if \(par && !\(m && m\.__tentouAuto\)\)/, 'falta a segunda tentativa');
  assert.match(fn[0], /return sendChatOrbita\(id, texto, \{ \.\.\.m, __tentouAuto: true \}, null/,
    'a segunda tentativa tem de ir sem par (automático) e marcada, para não fazer ciclo');
});
