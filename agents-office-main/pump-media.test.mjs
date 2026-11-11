/* ===========================================================================
   1.86.0 · a fila de mídia anda sozinha (o pump) — provado sem rede.

   O que se prova:
     · o pump avança imagens pendentes e NÃO avança vídeos (o browser compõe);
     · o pump respeita o orçamento de tempo: não começa mais uma imagem depois
       do orçamento, e diz que parou (não finge que acabou);
     · uma geração presa «a gerar» há mais de 3 min é curada para `falhou` com
       a razão escrita — nunca volta a gerar às cegas (podia cobrar duas vezes);
     · uma geração recente em `em_processamento` NÃO é curada (outra volta a está
       a gerar neste momento);
     · o endereço `/api/ciclo?so=midia` exige chave e não corre a fila de tarefas;
     · o despertar de 30 em 30 minutos existe e não tem o segredo escrito.

   Sem rede: o fornecedor é um fetch falso que responde depressa.
   =========================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createMemRepo } from './api/_repo.mjs';
import * as MD from './api/_media.mjs';
import { limparMemoria } from './api/_armazem.mjs';

const ENV = { MEDIA_WORKER_TOKEN: 'token-do-worker-de-teste-123' };

/** Um fornecedor falso que responde «não» depressa — sem rede, sem custo. */
const fornecedorRecusa = async () => ({ ok: false, status: 503, text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0), headers: new Map() });

async function geracao(repo, { tipo = 'imagem', estado = 'aguardando', actualizado = null, chave = null } = {}) {
  const g = await repo.geracoes.criar({
    chave, projeto_id: 'p1', tipo, fornecedor: tipo === 'video' ? 'orbita-render' : 'pollinations',
    prompt: 'uma chávena de café na mesa de madeira', opcoes: { largura: 768, altura: 768 }, estado,
  });
  if (actualizado) await repo.geracoes.actualizar(g.id, { actualizado });
  return g;
}

test('1.86.0 · o pump avança imagens e salta vídeos', async () => {
  limparMemoria();
  const repo = createMemRepo();
  await geracao(repo, { tipo: 'video' });
  await geracao(repo, { tipo: 'imagem' });
  const r = await MD.avancarPendentes(repo, { env: ENV, fetchImpl: fornecedorRecusa, orcamentoMs: 60000 });
  assert.equal(r.ok, true);
  assert.equal(r.avancadas.length, 1, 'devia avançar exatamente a imagem');
  const video = repo._dados.geracoes.find((g) => g.tipo === 'video');
  assert.equal(video.estado, 'aguardando', 'mexeu num vídeo — quem compõe é o browser');
  assert.equal(video.tentativas, 0);
});

test('1.86.0 · o pump respeita o orçamento de tempo e diz que parou', async () => {
  limparMemoria();
  const repo = createMemRepo();
  await geracao(repo); await geracao(repo); await geracao(repo);
  /* o relógio avança 20 s por leitura: com 25 s de orçamento só uma imagem entra */
  let t = 0;
  const agora = () => { t += 20000; return t; };
  const r = await MD.avancarPendentes(repo, { env: ENV, fetchImpl: fornecedorRecusa, orcamentoMs: 25000, agora });
  assert.equal(r.parou, true, 'tinha de dizer que parou no orçamento');
  assert.equal(r.avancadas.length, 1, `avançou ${r.avancadas.length}, devia ser 1`);
  assert.equal(r.restantes, 2, 'as duas que ficaram têm de estar contadas');
  assert.match(r.frase, /ficaram 2/);
});

test('1.86.0 · uma geração presa há mais de 3 min é curada, sem voltar a gerar', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const agora = Date.parse('2026-11-11T21:00:00Z');
  const velha = await geracao(repo, { estado: 'em_processamento', actualizado: new Date(agora - 10 * 60000).toISOString() });
  const r = await MD.avancarPendentes(repo, { env: ENV, fetchImpl: fornecedorRecusa, agora: () => agora });
  assert.equal(r.curadas.length, 1);
  const g = repo._dados.geracoes.find((x) => x.id === velha.id);
  assert.equal(g.estado, 'falhou', 'a presa tem de ficar falhou, não voltar a aguardando');
  assert.match(g.erro, /pode ter sido cobrada/);
  assert.equal(g.tentativas, 0, 'não pode ter tentado de novo');
});

test('1.86.0 · uma geração recente em curso NÃO é curada', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const agora = Date.parse('2026-11-11T21:00:00Z');
  const recente = await geracao(repo, { estado: 'em_processamento', actualizado: new Date(agora - 30000).toISOString() });
  const r = await MD.avancarPendentes(repo, { env: ENV, fetchImpl: fornecedorRecusa, agora: () => agora });
  assert.equal(r.curadas.length, 0, 'curou uma geração que ainda está a correr');
  assert.equal(repo._dados.geracoes.find((x) => x.id === recente.id).estado, 'em_processamento');
});

test('1.86.0 · a fila vazia diz que está vazia', async () => {
  limparMemoria();
  const repo = createMemRepo();
  const r = await MD.avancarPendentes(repo, { env: ENV, fetchImpl: fornecedorRecusa });
  assert.equal(r.ok, true);
  assert.equal(r.avancadas.length, 0);
  assert.equal(r.frase, 'a fila de imagens está vazia');
});

test('1.86.0 · /api/ciclo?so=midia exige chave e não corre a fila de tarefas', () => {
  const src = fs.readFileSync(new URL('./api/ciclo.mjs', import.meta.url), 'utf8');
  /* a ramificação do pump vem DEPOIS da autenticação e ANTES do correrCiclo */
  const iAuth = src.indexOf('quemPeloToken');
  const iMidia = src.indexOf("so === 'midia'");
  const iTarefas = src.indexOf('await correrCiclo(');
  assert.ok(iAuth > 0 && iMidia > iAuth, 'o pump tem de estar depois da autenticação');
  assert.ok(iTarefas > iMidia, 'o pump tem de sair antes de a fila de tarefas correr');
  assert.match(src, /avancarPendentes\(repo, \{ env, orcamentoMs: 25000 \}\)/);
});

test('1.86.0 · o despertar de 30 em 30 minutos existe, chama os dois caminhos e não tem o segredo escrito', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/despertar.yml', import.meta.url), 'utf8');
  assert.match(yml, /cron: '\*\/30 \* \* \* \*'/);
  assert.match(yml, /\/api\/ciclo\?so=midia/);
  assert.match(yml, /\$ORBITA_URL\/api\/ciclo"/);
  assert.match(yml, /secrets\.ORBITA_API_TOKEN/);
  assert.doesNotMatch(yml, /Bearer [A-Za-z0-9]{16,}/, 'um token parece estar escrito no ficheiro');
});

test('1.86.0 · o repositório só lista imagens na fila de pump', async () => {
  limparMemoria();
  const repo = createMemRepo();
  await geracao(repo, { tipo: 'video' });
  await geracao(repo, { tipo: 'imagem' });
  const lista = await repo.geracoes.listarPendentes(10);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].tipo, 'imagem');
});
