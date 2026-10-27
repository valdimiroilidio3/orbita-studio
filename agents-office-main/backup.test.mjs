// Diagnóstico da cópia de segurança (1.26.0, 27 out 2026).
//
// A cópia e o ensaio de restauro já existiam (1.23.0) e têm os seus testes em
// `controlo.test.mjs`. O que se prova AQUI é o que é novo: as duas rotas
// passaram a responder também a GET, para se poder verificar em produção por
// leitura pura — sem escrever no registo e sem mexer nos dados.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const CHAVE = crypto.randomBytes(32);
const ENV = { ORBITA_CHAVE: CHAVE.toString('base64') };

async function repoComDados() {
  const repo = createMemRepo();
  await repo.leads.inserir([
    { dedupe_key: 'a|coimbra', name: 'Clínica A', city: 'Coimbra', status: 'novo', source: 'geoapify', notes: null },
    { dedupe_key: 'b|coimbra', name: 'Clínica B', city: 'Coimbra', status: 'novo', source: 'geoapify', notes: null },
  ]);
  await repo.projetos.insert({ name: 'Site da Clínica A', kind: 'landing', status: 'rascunho' });
  return repo;
}

const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = ENV) =>
  responder(repo, { caminho, metodo, corpo, env });

test('backup: o ensaio por GET corre tudo e não assina o registo', async () => {
  const repo = await repoComDados();
  const antes = repo._dados.atividade.length;
  const r = await chamar(repo, '/backup/teste');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true, (r.corpo.problemas || []).join(' · '));
  assert.equal(repo._dados.atividade.length, antes, 'um GET não pode escrever no registo');
});

test('backup: o ensaio por POST assina o registo (é o botão «Testar cópia»)', async () => {
  const repo = await repoComDados();
  const antes = repo._dados.atividade.length;
  const r = await chamar(repo, '/backup/teste', 'POST', {});
  assert.equal(r.corpo.ok, true);
  assert.equal(repo._dados.atividade.length, antes + 1);
  const registo = repo._dados.atividade.map((a) => a.texto || a.mensagem || '').join(' ');
  assert.match(registo, /cópia de segurança testada/);
});

test('backup: a cópia cifrada também se pode pedir por GET, sem texto simples na resposta', async () => {
  const repo = await repoComDados();
  const r = await chamar(repo, '/backup/cifrado');
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pacote.formato, 'orbita-cifrado/1');
  assert.equal(JSON.stringify(r.corpo).includes('Clínica A'), false, 'a resposta não pode conter a cópia em claro');
  assert.ok(r.corpo.copia.total >= 3, 'a cópia tem de levar os dados todos');
  /* a cópia abre com a chave certa e devolve as contagens */
  const d = await chamar(repo, '/backup/decifrar', 'POST', { pacote: r.corpo.pacote });
  assert.equal(d.corpo.ok, true);
  assert.equal(d.corpo.total, r.corpo.copia.total);
});
