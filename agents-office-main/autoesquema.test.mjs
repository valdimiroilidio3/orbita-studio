/* ===========================================================================
   1.76.0 · O ESQUEMA DA PORTA QUE SE APLICA A SI PRÓPRIO (6 nov 2026)

   O que se prova aqui, sem rede e sem base de dados verdadeira:

     · um erro de «tabela doesn't exist» da porta é reconhecido; um erro de rede
       NÃO é (não se corre DDL às cegas);
     · quando a sonda falha, os três ficheiros da porta são aplicados, por esta
       ordem, e a sonda é repetida — só se ela passar é que se diz «ok»;
     · dez pedidos ao mesmo tempo fazem UMA aplicação (não dez);
     · uma instalação em memória (testes, modo local) nunca toca em nada;
     · o erro do PostgREST manda para o ficheiro certo: contas → 1_54_0, e
       codigo_hash → 1_69_0 (antes dizia `orbita_mesa.sql`, que não cria contas).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FICHEIROS_DA_PORTA, faltaEsquemaDaPorta, aplicarEsquemaDaPorta, criarCurador,
} from './api/_autoesquema.mjs';
import { explificar } from './api/_repo.mjs';

const ENV = { POSTGRES_URL: 'postgres://usuario:segredo@exemplo.pt/postgres?sslmode=require' };

/** Um erro como o que o `_repo.explificar` produz para uma tabela em falta. */
const erroTabela = () => Object.assign(new Error('falta a tabela «orbita_contas»: o esquema não foi aplicado'), {
  semEsquema: true, tabela: 'orbita_contas', status: 503,
});

test('1.76.0 · reconhece a falta de esquema da porta — e não confunde com uma avaria de rede', () => {
  assert.equal(faltaEsquemaDaPorta(erroTabela()), true);
  assert.equal(faltaEsquemaDaPorta(Object.assign(new Error('sem ligação à base: fetch failed'), { status: 503 })), false);
  assert.equal(faltaEsquemaDaPorta(new Error('relation "orbita_sessoes" does not exist')), true);
  assert.equal(faltaEsquemaDaPorta(new Error('relation "orbita_leads" does not exist')), false,
    'uma tabela que não é da porta não autoriza DDL da porta (a mesa não se cura por aqui)');
  assert.equal(faltaEsquemaDaPorta(Object.assign(new Error('falta a coluna «x»'), { semEsquema: true, tabela: 'orbita_leads' })), false,
    'uma tabela que não é da porta não autoriza DDL da porta');
});

test('1.76.0 · o erro do PostgREST manda para o ficheiro certo (não para a mesa)', () => {
  const contas = explificar('relation "orbita_contas" does not exist', { code: '42P01' });
  assert.equal(contas.ficheiro, 'orbita_1_54_0.sql');
  assert.match(contas.mensagem, /orbita_1_54_0\.sql/);
  assert.doesNotMatch(contas.mensagem, /orbita_mesa\.sql/, 'a mesa não cria contas');

  const coluna = explificar('column orbita_contas.codigo_hash does not exist', { code: '42703' });
  assert.equal(coluna.ficheiro, 'orbita_1_69_0.sql');

  const sessoes = explificar('relation "orbita_sessoes" does not exist', { code: '42P01' });
  assert.equal(sessoes.ficheiro, 'orbita_1_54_0.sql');
});

test('1.76.0 · aplica os três ficheiros da porta, um por transacção, pelo cliente do esquema', async () => {
  const vistos = [];
  const cliente = {
    query: async (sql) => { vistos.push(String(sql).slice(0, 40)); return { rows: [] }; },
    end: async () => { vistos.push('fim'); },
  };
  const r = await aplicarEsquemaDaPorta(ENV, {
    ligar: async (env) => { assert.equal(env.POSTGRES_URL, ENV.POSTGRES_URL); return cliente; },
    aplicar: async (c, opcoes) => {
      assert.equal(c, cliente);
      assert.deepEqual(opcoes.ficheiros, FICHEIROS_DA_PORTA);
      return { ok: true, aplicados: opcoes.ficheiros.map((f) => ({ ficheiro: f })), erro: null };
    },
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.aplicados.map((a) => a.ficheiro), FICHEIROS_DA_PORTA);
  assert.equal(vistos.includes('fim'), true, 'a ligação é fechada sempre');
});

test('1.76.0 · sem POSTGRES_URL não se inventa esquema: diz-se o que falta', async () => {
  const r = await aplicarEsquemaDaPorta({}, {
    ligar: async (env) => { throw new Error(`${env.POSTGRES_URL ? '' : 'falta DATABASE_URL/POSTGRES_URL no ambiente'}`); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.fase, 'ligação');
  assert.match(r.erro, /POSTGRES_URL/);
});

test('1.76.0 · o curador: sonda falha → aplica → sonda passa → guarda em memória', async () => {
  let aplicacoes = 0;
  let sondas = 0;
  const repo = {
    tipo: 'base',
    contas: {
      async sonda() {
        sondas += 1;
        if (aplicacoes === 0) throw erroTabela();
        return true;
      },
    },
  };
  const garantir = criarCurador({
    ligar: async () => ({ end: async () => {} }),
    aplicar: async () => { aplicacoes += 1; return { ok: true, aplicados: [{ ficheiro: 'orbita_1_54_0.sql' }], erro: null }; },
    ttl: 60_000,
  });

  const r = await garantir(repo, ENV);
  assert.equal(r.ok, true);
  assert.equal(r.aplicadoAgora, true);
  assert.equal(aplicacoes, 1);
  assert.equal(sondas, 2, 'pergunta antes e confirma depois — aplicar sem verificar é outra promessa vazia');

  const outra = await garantir(repo, ENV);
  assert.equal(outra.emCache, true);
  assert.equal(aplicacoes, 1, 'a segunda vez não volta a mexer na base');
});

test('1.76.0 · dez pedidos ao mesmo tempo fazem UMA aplicação', async () => {
  let aplicacoes = 0;
  let primeiro = true;
  const repo = {
    tipo: 'base',
    contas: {
      async sonda() {
        if (primeiro) { primeiro = false; throw erroTabela(); }
        return true;
      },
    },
  };
  const garantir = criarCurador({
    ligar: async () => ({ end: async () => {} }),
    aplicar: async () => { aplicacoes += 1; await new Promise((r) => setTimeout(r, 20)); return { ok: true, aplicados: [], erro: null }; },
  });
  const rs = await Promise.all(Array.from({ length: 10 }, () => garantir(repo, ENV)));
  assert.equal(aplicacoes, 1, 'uma promessa partilhada, não dez DDL em paralelo');
  assert.equal(rs.every((x) => x.ok), true);
});

test('1.76.0 · se a aplicação falhar, o erro diz porquê e a próxima tentativa volta a tentar', async () => {
  let tentativas = 0;
  const repo = { tipo: 'base', contas: { async sonda() { throw erroTabela(); } } };
  const garantir = criarCurador({
    ligar: async () => { tentativas += 1; throw new Error('o pooler recusou a ligação'); },
    aplicar: async () => ({ ok: true, aplicados: [], erro: null }),
  });
  const r = await garantir(repo, ENV);
  assert.equal(r.ok, false);
  assert.equal(r.semEsquema, true);
  assert.match(r.erro, /pooler/);
  await garantir(repo, ENV);
  assert.equal(tentativas, 2, 'uma falha não fica em cache como se fosse sucesso');
});

test('1.76.0 · em memória (testes, modo local) o curador não toca em nada', async () => {
  let mexeu = false;
  const garantir = criarCurador({ ligar: async () => { mexeu = true; return { end: async () => {} }; } });
  const r = await garantir({ tipo: 'memoria', contas: { async sonda() { mexeu = true; } } }, ENV);
  assert.deepEqual(r, { ok: true, memoria: true });
  assert.equal(mexeu, false);
});
