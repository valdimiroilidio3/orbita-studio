/* ===========================================================================
   1.19.0 · provas da memória (Graft) e do estúdio (OpenMontage) — 27 out 2026

   O que se prova, sem rede e sem chaves:
     · a procura é lexical e ordena por pontos; não inventa achados;
     · guardar recusa títulos/textos vazios e não duplica notas iguais;
     · a auditoria vê duplicados e notas curtas e não apaga nada;
     · o `aprender` mostra o plano e só grava com `confirmar`;
     · o estúdio recusa pedidos vazios e, sem worker, marca `indisponivel`
       com a razão (nunca «concluido»);
     · o worker é autenticado por token e move o trabalho pela fila;
     · uma execução concluída deixa uma nota na memória (memoryze).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemRepo } from './api/_repo.mjs';
import * as memoria from './api/_ia/memoria.mjs';
import * as media from './api/_ia/media.mjs';
import { criarMotor } from './api/_ia/motor.mjs';
import { correr } from './api/_ia/orquestrador.mjs';
import { rotasIA } from './api/_ia/rotas.mjs';

const CHAVE = 'sk-teste-1234567890abcdef';
const envFalso = { OPENROUTER_API_KEY: CHAVE, MEDIA_WORKER_TOKEN: 'token-do-worker-123456' };
const json = (corpo, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(corpo) });

const notaExemplo = {
  titulo: 'Deploy da Vercel falha sem dist',
  texto: 'Se o build não correr, a pasta dist não existe e a Vercel publica 404. Correr node build.mjs antes.',
  etiquetas: ['deploy', 'vercel'],
  fonte: 'execução antiga',
};

/* ---------- 1 · memória ---------- */
test('memória: guarda, encontra pela palavra certa e não duplica', async () => {
  const repo = createMemRepo();
  const a = await memoria.guardar(repo, notaExemplo);
  assert.equal(a.ok, true);
  assert.equal(a.criada, true);

  const b = await memoria.guardar(repo, notaExemplo);
  assert.equal(b.criada, false, 'duplicou a mesma nota');
  assert.match(b.resumo, /já estava guardada/);

  const r = await memoria.procurar(repo, { consulta: 'vercel 404 dist' });
  assert.equal(r.modo, 'lexical');
  assert.equal(r.achados[0].titulo, notaExemplo.titulo);
  assert.ok(r.achados[0].pontos > 0);

  const nada = await memoria.procurar(repo, { consulta: 'fotossíntese clorofila' });
  assert.equal(nada.achados.length, 0, 'inventou um achado');
});

test('memória: recusa notas vazias e limita o que guarda', async () => {
  const repo = createMemRepo();
  const semTitulo = await memoria.guardar(repo, { titulo: 'ab', texto: 'x'.repeat(50) });
  assert.equal(semTitulo.ok, false);
  const semTexto = await memoria.guardar(repo, { titulo: 'título válido', texto: 'curto' });
  assert.equal(semTexto.ok, false);

  const n = await memoria.guardar(repo, {
    titulo: 'T' + 'x'.repeat(400),
    texto: 'y'.repeat(9000),
    etiquetas: Array.from({ length: 30 }, (_, i) => `tag${i}`),
  });
  assert.equal(n.ok, true);
  assert.equal(n.nota.titulo.length <= 160, true);
  assert.equal(n.nota.texto.length <= 8000, true);
  assert.equal(n.nota.etiquetas.length <= 12, true);
});

test('memória: a auditoria vê duplicados e notas curtas, e não apaga nada', async () => {
  const repo = createMemRepo();
  await repo.ia.memoria.criar({ titulo: 'Mesmo título', texto: 'a'.repeat(60), etiquetas: [], projeto: 'orbita' });
  await repo.ia.memoria.criar({ titulo: 'mesmo título', texto: 'b'.repeat(60), etiquetas: [], projeto: 'orbita' });
  await repo.ia.memoria.criar({ titulo: 'Nota curtinha', texto: 'curta', etiquetas: [], projeto: 'orbita', fonte: 'conversa' });

  const r = await memoria.auditar(repo);
  assert.equal(r.total, 3);
  assert.equal(r.duplicados.length, 1);
  assert.equal(r.duplicados[0].ids.length, 2);
  assert.equal(r.curtas.length, 1);
  assert.equal(r.semFonte.length, 3);
  assert.equal((await repo.ia.memoria.listar({ limite: 100 })).length, 3, 'a auditoria apagou notas');
  assert.equal(r.naoFaz.length >= 2, true);
});

test('memória: aprender mostra o plano primeiro e só grava com confirmar', async () => {
  const repo = createMemRepo();
  const texto = [
    '## Base de dados',
    'A mesa escreve no Supabase com a chave de serviço e RLS fechado: nenhum anónimo lê as tabelas.',
    '## Publicação',
    'O deploy corre node build.mjs e publica a pasta dist; sem build não há site.',
  ].join('\n\n');

  const plano = await memoria.aprender(repo, { texto });
  assert.equal(plano.ok, true);
  assert.equal(plano.confirmado, false);
  assert.equal(plano.quantos, 2);
  assert.equal((await repo.ia.memoria.listar({ limite: 50 })).length, 0, 'gravou antes de confirmar');

  const feito = await memoria.aprender(repo, { texto, confirmar: true });
  assert.equal(feito.criadas, 2);
  assert.equal((await repo.ia.memoria.listar({ limite: 50 })).length, 2);

  const outra = await memoria.aprender(repo, { texto, confirmar: true });
  assert.equal(outra.criadas, 0, 'voltou a gravar notas iguais');
  assert.equal(outra.repetidas, 2);
});

/* ---------- 2 · estúdio ---------- */
test('estúdio: sem worker configurado, o trabalho nasce indisponível e diz porquê', async () => {
  const repo = createMemRepo();
  const r = await media.criar(repo, { pedido: 'explicador de 30 s sobre o Café Central', tipo: 'video' }, {});
  assert.equal(r.status, 201);
  assert.equal(r.corpo.trabalho.estado, 'indisponivel');
  assert.match(r.corpo.trabalho.erro, /MEDIA_WORKER_TOKEN/);
});

test('estúdio: valida o pedido e o tipo', async () => {
  const repo = createMemRepo();
  assert.equal((await media.criar(repo, { pedido: 'curto' }, envFalso)).status, 400);
  const ok = await media.criar(repo, { pedido: 'vídeo de 20 s com legendas em português', tipo: 'video', pipeline: 'framework-smoke' }, envFalso);
  assert.equal(ok.status, 201);
  assert.equal(ok.corpo.trabalho.estado, 'pedido');
  const ma = await media.criar(repo, { pedido: 'um pedido suficientemente longo', pipeline: 'nao-existe' }, envFalso);
  assert.equal(ma.status, 400);
});

test('estúdio: o worker autentica-se por token e conduz o trabalho até ao fim', async () => {
  const repo = createMemRepo();
  const criado = await media.criar(repo, { pedido: 'explicador de 15 s, 1080p, legendas', tipo: 'video' }, envFalso);

  assert.equal(media.tokenOk(envFalso, 'errado'), false);
  assert.equal(media.tokenOk({}, 'x'), false);
  assert.equal(media.tokenOk(envFalso, 'token-do-worker-123456'), true);

  const assumido = await media.assumir(repo, envFalso);
  assert.equal(assumido.status, 200);
  assert.equal(assumido.corpo.trabalho.id, criado.corpo.trabalho.id);
  assert.equal(assumido.corpo.trabalho.estado, 'a_correr');

  const fim = await media.concluir(repo, criado.corpo.trabalho.id, { url: 'https://exemplo/video.mp4', pipeline: 'framework-smoke' });
  assert.equal(fim.corpo.trabalho.estado, 'concluido');
  assert.equal(fim.corpo.trabalho.url_resultado, 'https://exemplo/video.mp4');

  const falhou = await media.criar(repo, { pedido: 'outro trabalho de vinte segundos', tipo: 'audio' }, envFalso);
  await media.falhar(repo, falhou.corpo.trabalho.id, 'ffmpeg não instalado');
  const lido = await repo.ia.media.porId(falhou.corpo.trabalho.id);
  assert.equal(lido.estado, 'falhou');
  assert.match(lido.erro, /ffmpeg/);
});

test('estúdio: o sinal do worker guarda o que está instalado e o estado diz se está vivo', async () => {
  const repo = createMemRepo();
  await media.sinal(repo, { versao: '0.1.0', commit: 'abc1234', pipelines: ['cinematic'], ferramentas: { ffmpeg: true, python: true } });
  const est = await media.estado(repo, envFalso);
  assert.equal(est.worker.vivo, true);
  assert.equal(est.worker.versao, '0.1.0');
  assert.equal(est.worker.ferramentas.ffmpeg, true);
  assert.equal(est.configurado, true);
  assert.equal(est.porque, null);
});

/* ---------- 3 · rotas ---------- */
test('rotas /media: token obrigatório e 404 no que não existe', async () => {
  const repo = createMemRepo();
  const semToken = await rotasIA(repo, { caminho: '/media/assumir', metodo: 'POST', corpo: {}, env: envFalso });
  assert.equal(semToken.status, 401);

  const comToken = await rotasIA(repo, { caminho: '/media/assumir', metodo: 'POST', corpo: { token: 'token-do-worker-123456' }, env: envFalso });
  assert.equal(comToken.status, 200);

  const nada = await rotasIA(repo, { caminho: '/media/xpto/xyz', metodo: 'POST', corpo: { token: 'token-do-worker-123456' }, env: envFalso });
  assert.equal(nada.status, 404);
});

test('rotas /ia/memoria: guarda, procura, audita e apaga', async () => {
  const repo = createMemRepo();
  const n = await rotasIA(repo, { caminho: '/ia/memoria', metodo: 'POST', corpo: notaExemplo, env: {} });
  assert.equal(n.status, 201);

  const p = await rotasIA(repo, { caminho: '/ia/memoria/procurar', metodo: 'POST', corpo: { consulta: 'vercel' }, env: {} });
  assert.equal(p.status, 200);
  assert.equal(p.corpo.achados.length >= 1, true);

  const a = await rotasIA(repo, { caminho: '/ia/memoria/auditar', metodo: 'GET', env: {} });
  assert.equal(a.status, 200);
  assert.equal(a.corpo.total, 1);

  const id = n.corpo.nota.id;
  const d = await rotasIA(repo, { caminho: `/ia/memoria/${id}`, metodo: 'DELETE', env: {} });
  assert.equal(d.status, 200);
  assert.equal((await repo.ia.memoria.listar({})).length, 0);
});

/* ---------- 4 · o ciclo completo: memória a alimentar o orquestrador ---------- */
function fornecedorFalso() {
  const fetchImpl = async (url, opt) => {
    const corpo = JSON.parse(opt.body);
    const sistema = corpo.messages?.[0]?.content || '';
    if (sistema.includes('Orchestrator')) {
      return json({ choices: [{ message: { content: JSON.stringify({ passos: [
        { agente: 'research', titulo: 'Ver a mesa', instrucao: 'resume os números', criterio: 'números reais' },
      ], limites: ['sem pesquisa web'] }) } }] });
    }
    if (sistema.includes('Reviewer')) {
      return json({ choices: [{ message: { content: JSON.stringify({ decisao: 'aprovado', justificacao: 'os passos têm números reais', corrigir: [] }) } }] });
    }
    return json({ choices: [{ message: { content: 'feito com os dados da mesa' } }] });
  };
  return { fetchImpl };
}

test('ciclo: uma execução concluída escreve uma nota na memória (memoryze)', async () => {
  const repo = createMemRepo();
  const { fetchImpl } = fornecedorFalso();
  const motor = criarMotor({ repo, env: envFalso, fetchImpl });
  const run = await correr({ repo, motor, objetivo: 'perceber quantos leads existem e resumir', env: envFalso });
  assert.equal(run.estado, 'concluido', run.erro || '');

  const notas = await repo.ia.memoria.listar({ limite: 10 });
  assert.equal(notas.length, 1, 'não escreveu nota nenhuma');
  assert.match(notas[0].titulo, /perceber quantos leads/);
  assert.equal(notas[0].fonte.startsWith('execução'), true);
  assert.equal(notas[0].etiquetas.includes('execucao'), true);
  assert.match(notas[0].texto, /Revisão \(aprovado\)/);
});

test('ciclo: a memória é consultada antes do plano e aparece no pedido ao Orchestrator', async () => {
  const repo = createMemRepo();
  await memoria.guardar(repo, {
    titulo: 'Nunca prometer pesquisa web',
    texto: 'Nesta instalação não há pesquisa web nem execução de código: os passos não podem contar com isso.',
    etiquetas: ['limites'],
  });
  let pedidoDoPlano = '';
  const fetchImpl = async (url, opt) => {
    const corpo = JSON.parse(opt.body);
    const sistema = corpo.messages?.[0]?.content || '';
    if (sistema.includes('Orchestrator')) {
      pedidoDoPlano = corpo.messages.map((m) => m.content).join('\n');
      return json({ choices: [{ message: { content: JSON.stringify({ passos: [{ agente: 'research', titulo: 'Resumir', instrucao: 'usa a mesa', criterio: 'números reais' }], limites: [] }) } }] });
    }
    if (sistema.includes('Reviewer')) return json({ choices: [{ message: { content: JSON.stringify({ decisao: 'aprovado', justificacao: 'ok', corrigir: [] }) } }] });
    return json({ choices: [{ message: { content: 'ok' } }] });
  };
  const motor = criarMotor({ repo, env: envFalso, fetchImpl });
  const run = await correr({ repo, motor, objetivo: 'planear sem prometer pesquisa web', env: envFalso });
  assert.equal(run.estado, 'concluido', run.erro || '');
  assert.match(pedidoDoPlano, /Notas da memória/, 'o plano não recebeu as notas');
  assert.match(pedidoDoPlano, /Nunca prometer pesquisa web/);
});
