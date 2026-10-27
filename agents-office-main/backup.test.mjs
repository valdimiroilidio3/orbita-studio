// Testes da cópia de segurança e do botão «Testar ligação» (1.23.0).
//
// O que se prova, sem rede:
//   · a cópia tem as nove tabelas, contagens e uma marca (sha256) que muda se o
//     conteúdo mudar;
//   · «testar» exporta, relê do JSON, confere a marca e RESTAURA numa base em
//     memória — e compara as contagens, linha a linha;
//   · se uma tabela não se conseguir ler, isso aparece nos problemas (nunca
//     aparece um «ok» com uma cópia incompleta);
//   · «Testar ligação» faz um pedido real ao serviço: sem chave diz qual falta,
//     com chave devolve o código HTTP e o detalhe, e um 401 diz «recusou»;
//   · escrever chaves pela interface continua a ser 501, com a razão escrita.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { exportar, marca, testar } from './api/_backup.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

async function repoComDados() {
  const repo = createMemRepo();
  await repo.leads.inserir([
    { dedupe_key: 'a|coimbra', name: 'Clínica A', city: 'Coimbra', status: 'novo', source: 'geoapify', notes: null },
    { dedupe_key: 'b|coimbra', name: 'Clínica B', city: 'Coimbra', status: 'novo', source: 'geoapify', notes: null },
  ]);
  await repo.projetos.insert({ name: 'Site da Clínica A', kind: 'landing', status: 'rascunho' });
  await repo.receitas.insert({ amount_cents: 45000, campaign: 'teste', at: new Date().toISOString() });
  await repo.atividade.add('config', 'algo aconteceu');
  return repo;
}

const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = {}, fetchImpl) =>
  responder(repo, { caminho, metodo, corpo, env, ...(fetchImpl ? { fetchImpl } : {}) });

/* ---------- 1 · a cópia ---------- */
test('backup: a cópia leva as nove tabelas, contagens, total e marca', async () => {
  const repo = await repoComDados();
  const copia = await exportar(repo);
  assert.equal(copia.formato, 'orbita-backup/1');
  assert.deepEqual(Object.keys(copia.tabelas).sort(), ['atividade', 'config', 'leads', 'mensagens', 'projetos', 'receitas', 'runs', 'tarefas', 'uso']);
  assert.equal(copia.contagens.leads, 2);
  assert.equal(copia.contagens.projetos, 1);
  assert.equal(copia.contagens.receitas, 1);
  assert.equal(copia.total, Object.values(copia.contagens).reduce((a, b) => a + b, 0));
  assert.match(copia.marca, /^[0-9a-f]{32}$/);
  assert.deepEqual(copia.falhas, []);
});

test('backup: a marca muda quando o conteúdo muda', async () => {
  const repo = await repoComDados();
  const antes = await exportar(repo);
  await repo.leads.inserir([{ dedupe_key: 'c|coimbra', name: 'Clínica C', city: 'Coimbra', status: 'novo', source: 'geoapify', notes: null }]);
  const depois = await exportar(repo);
  assert.notEqual(antes.marca, depois.marca);
  /* a marca é uma função do conteúdo: recalcular dá o mesmo */
  assert.equal(marca(JSON.parse(JSON.stringify(depois))), depois.marca);
});

/* ---------- 2 · o ensaio de restauro ---------- */
test('backup: «testar» restaura a cópia numa base em memória e compara as contagens', async () => {
  const repo = await repoComDados();
  const r = await testar(repo);
  assert.equal(r.ok, true, (r.problemas || []).join(' · '));
  assert.equal(r.restaurado.leads, 2);
  assert.equal(r.restaurado.projetos, 1);
  assert.equal(r.restaurado.receitas, 1);
  assert.equal(r.restaurado.atividade, 1);
  assert.match(r.marca, /^[0-9a-f]{32}$/);
  assert.deepEqual(r.problemas, []);
});

test('backup: uma tabela que não se lê aparece nos problemas, não como «ok»', async () => {
  const repo = createMemRepo();
  repo.leads.list = async () => { throw new Error('a base não respondeu'); };
  const r = await testar(repo);
  assert.equal(r.ok, false);
  assert.match(r.problemas.join(' '), /não li leads: a base não respondeu/);
});

/* ---------- 3 · as rotas ---------- */
test('rotas: /backup devolve a cópia e /backup/teste assina o resultado', async () => {
  const repo = await repoComDados();
  const c = await chamar(repo, '/backup');
  assert.equal(c.status, 200);
  assert.equal(c.corpo.ok, true);
  assert.equal(c.corpo.copia.contagens.leads, 2);

  const t = await chamar(repo, '/backup/teste', 'POST', {});
  assert.equal(t.status, 200);
  assert.equal(t.corpo.ok, true);
  const registo = repo._dados.atividade.find((a) => String(a.texto || a.mensagem || '').includes('cópia de segurança testada'));
  assert.ok(registo, 'o teste da cópia tem de ficar no registo de alterações');
});

test('rotas: o ensaio por GET não escreve no registo (diagnóstico puro)', async () => {
  const repo = await repoComDados();
  const antes = repo._dados.atividade.length;
  const r = await chamar(repo, '/backup/teste');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(repo._dados.atividade.length, antes, 'um GET não pode assinar o registo');
});

/* ---------- 4 · «Testar ligação» ---------- */
function falso(resposta) {
  const pedidos = [];
  const fn = async (url, opcoes = {}) => {
    pedidos.push({ url: String(url), opcoes });
    const r = typeof resposta === 'function' ? resposta(url, opcoes) : resposta;
    return {
      ok: (r.status || 200) < 400,
      status: r.status || 200,
      json: async () => r.json ?? {},
      text: async () => (r.text ?? JSON.stringify(r.json ?? '')),
    };
  };
  fn.pedidos = pedidos;
  return fn;
}

test('rotas: sem chave, «Testar ligação» diz qual variável falta', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/platform/testar', 'POST', { id: 'github' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, false);
  assert.equal(r.corpo.codigo, 'semchave');
  assert.match(r.corpo.erro, /GITHUB_TOKEN/);
});

test('rotas: com chave, «Testar ligação» faz o pedido e guarda o resultado', async () => {
  const repo = createMemRepo();
  const f = falso({ status: 200, json: { login: 'valdimiroilidio3' } });
  const r = await chamar(repo, '/platform/testar', 'POST', { id: 'github' }, { GITHUB_TOKEN: 'ghp_de_teste' }, f);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.detalhe, 'valdimiroilidio3');
  const pedido = f.pedidos[0];
  assert.equal(pedido.url, 'https://api.github.com/user');
  assert.equal(pedido.opcoes.headers.Authorization, 'Bearer ghp_de_teste');

  /* o resultado fica guardado: a lista passa a dizer que está verificada */
  const lista = await chamar(repo, '/platform/apis', 'GET', null, { GITHUB_TOKEN: 'ghp_de_teste' });
  const gh = lista.corpo.list.find((x) => x.id === 'github');
  assert.equal(gh.verified, true);
});

test('rotas: um 401 do serviço aparece como «recusou», com o código', async () => {
  const repo = createMemRepo();
  const f = falso({ status: 401, json: { message: 'Bad credentials' }, text: 'Bad credentials' });
  const r = await chamar(repo, '/platform/testar', 'POST', { id: 'github' }, { GITHUB_TOKEN: 'x' }, f);
  assert.equal(r.corpo.ok, false);
  assert.equal(r.corpo.status, 401);
  assert.match(r.corpo.erro, /GitHub respondeu HTTP 401/);
});

test('rotas: testar uma integração que não existe é 404, não um «ok» vazio', async () => {
  const repo = createMemRepo();
  await assert.rejects(
    () => chamar(repo, '/platform/testar', 'POST', { id: 'naoexiste' }),
    (e) => { assert.equal(e.status, 404); return true; },
  );
});

test('rotas: escrever chaves pela interface continua a ser 501, com a razão', async () => {
  const repo = createMemRepo();
  await assert.rejects(
    () => chamar(repo, '/platform/key', 'POST', { servico: 'github', variavel: 'GITHUB_TOKEN', valor: 'x' }),
    (e) => { assert.equal(e.status, 501); assert.match(e.message, /Environment Variables/); return true; },
  );
});
