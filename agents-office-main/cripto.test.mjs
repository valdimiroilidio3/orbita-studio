// Testes do cofre (1.25.0, 27 out 2026).
//
// O que se prova aqui, sem rede:
//   · há uma chave mestra — de `ORBITA_CHAVE`, ou derivada da chave da base;
//   · o que se cifra volta a abrir com a mesma chave e NÃO abre com outra;
//   · uma cópia alterada é detectada (AES-256-GCM: a etiqueta não bate);
//   · sem chave, a rota diz que não pode cifrar — não guarda nada em claro;
//   · a cópia cifrada não deixa passar nomes de leads em texto simples.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { chaveMestre, cifrar, decifrar, impressao, mascarar } from './api/_cripto.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const CHAVE = crypto.randomBytes(32);
const ENV = { ORBITA_CHAVE: CHAVE.toString('base64') };

test('cofre: sem chave nenhuma, diz o que falta em vez de inventar uma', () => {
  const k = chaveMestre({});
  assert.equal(k.chave, null);
  assert.match(k.motivo, /ORBITA_CHAVE/);
  const torta = chaveMestre({ ORBITA_CHAVE: 'abc' });
  assert.equal(torta.chave, null);
  assert.match(torta.motivo, /32 bytes/);
});

test('cofre: a chave vem de ORBITA_CHAVE, ou é derivada da chave da base', () => {
  const k = chaveMestre(ENV);
  assert.equal(k.chave.length, 32);
  assert.equal(k.fonte, 'ORBITA_CHAVE');
  assert.equal(k.motivo, null);

  const derivada = chaveMestre({ SUPABASE_SECRET_KEY: 'sb-secret-de-teste' });
  assert.equal(derivada.chave.length, 32);
  assert.match(derivada.fonte, /derivada de SUPABASE_SECRET_KEY/);
  /* determinística: a mesma base, a mesma chave (senão as cópias antigas não abriam) */
  const outra = chaveMestre({ SUPABASE_SECRET_KEY: 'sb-secret-de-teste' });
  assert.equal(derivada.chave.equals(outra.chave), true);
  const diferente = chaveMestre({ SUPABASE_SECRET_KEY: 'outra-base' });
  assert.equal(derivada.chave.equals(diferente.chave), false);
});

test('cofre: cifra e decifra, e uma chave errada não abre', () => {
  const k = chaveMestre(ENV).chave;
  const claro = { leads: [{ nome: 'Clínica do Mondego' }], total: 1 };
  const p = cifrar(claro, k);
  assert.equal(p.formato, 'orbita-cifrado/1');
  assert.equal(p.alg, 'aes-256-gcm');
  assert.equal(JSON.stringify(p).includes('Mondego'), false, 'o pacote não pode ter texto simples');
  assert.deepEqual(decifrar(p, k), claro);

  const outra = chaveMestre({ ORBITA_CHAVE: crypto.randomBytes(32).toString('base64') }).chave;
  assert.throws(() => decifrar(p, outra), /chave está errada ou a cópia foi alterada/);
});

test('cofre: uma cópia alterada é detectada, mesmo com a chave certa', () => {
  const k = chaveMestre(ENV).chave;
  const p = cifrar({ a: 1 }, k);
  const bruto = Buffer.from(p.dados, 'base64');
  bruto[0] = bruto[0] ^ 0xff;
  const mexido = { ...p, dados: bruto.toString('base64') };
  assert.throws(() => decifrar(mexido, k), /chave está errada ou a cópia foi alterada/);
  assert.notEqual(impressao(mexido), impressao(p));
});

test('cofre: a impressão identifica a cópia sem a abrir', () => {
  const k = chaveMestre(ENV).chave;
  const a = cifrar({ n: 1 }, k);
  const b = cifrar({ n: 1 }, k);
  assert.equal(a.dados === b.dados, false, 'cada cópia leva um IV novo');
  assert.match(impressao(a), /^[0-9a-f]{16}$/);
  assert.notEqual(impressao(a), impressao(b));
});

test('cofre: mascarar não revela o segredo', () => {
  const m = mascarar('GEOAPIFY-CHAVE-SUPER-SECRETA');
  assert.equal(m.includes('SUPER'), false);
  assert.match(m, /^GEOA…RETA$/);
});

/* ---------- as rotas ---------- */
const chamar = (repo, caminho, metodo, corpo, env = ENV) => responder(repo, { caminho, metodo, corpo, env });

test('rotas: /backup/cifrado exporta, cifra e não deixa o conteúdo em claro', async () => {
  const repo = createMemRepo();
  await repo.leads.inserir([{ dedupe_key: 'clinica|coimbra', name: 'Clínica do Mondego', city: 'Coimbra', status: 'novo', source: 'geoapify', notes: null }]);
  const r = await chamar(repo, '/backup/cifrado', 'POST', {});
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.pacote.formato, 'orbita-cifrado/1');
  assert.equal(r.corpo.chaveDe, 'ORBITA_CHAVE');
  assert.equal(r.corpo.copia.total >= 1, true);
  assert.equal(JSON.stringify(r.corpo).includes('Mondego'), false, 'a resposta não pode conter a cópia em claro');
  assert.match(r.corpo.impressao, /^[0-9a-f]{16}$/);
});

test('rotas: /backup/decifrar confirma a cópia e devolve só o retrato', async () => {
  const repo = createMemRepo();
  await repo.leads.inserir([{ dedupe_key: 'a|b', name: 'Lead A', city: 'B', status: 'novo', source: 'x', notes: null }]);
  const cifrada = await chamar(repo, '/backup/cifrado', 'POST', {});
  const r = await chamar(repo, '/backup/decifrar', 'POST', { pacote: cifrada.corpo.pacote });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.total, cifrada.corpo.copia.total);
  assert.equal(JSON.stringify(r.corpo).includes('Lead A'), false, 'decifrar confirma, não despeja dados');

  await assert.rejects(
    () => chamar(repo, '/backup/decifrar', 'POST', { pacote: cifrada.corpo.pacote }, { ORBITA_CHAVE: crypto.randomBytes(32).toString('base64') }),
    (e) => { assert.equal(e.status, 400); assert.match(e.message, /chave está errada ou a cópia foi alterada/); return true; },
  );
});

test('rotas: sem chave de cifra, a rota recusa em vez de guardar em claro', async () => {
  const repo = createMemRepo();
  await assert.rejects(() => chamar(repo, '/backup/cifrado', 'POST', {}, {}), (e) => {
    assert.equal(e.status, 503);
    assert.match(e.message, /não posso cifrar/);
    return true;
  });
  await assert.rejects(() => chamar(repo, '/backup/decifrar', 'POST', { pacote: {} }, {}), (e) => {
    assert.equal(e.status, 503);
    return true;
  });
});
