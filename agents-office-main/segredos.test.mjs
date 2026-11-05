/* ===========================================================================
   1.65.0 · os segredos que o dono inventa (4 nov 2026)

   O arranque passou a dizer «falta ORBITA_API_TOKEN (32 caracteres ou mais)» e
   isso deixou o último passo na mão de quem lê: inventar o valor, com o tamanho
   certo, e sabendo que a Vercel nunca mais o mostra. `src/segredos.js` faz a
   parte chata. Aqui prova-se que:

     · o valor gerado tem, no mínimo, o que `api/_prontidao.mjs` exige;
     · é hexadecimal (nada de caracteres que se percam ao copiar);
     · dois valores seguidos não são iguais;
     · sem gerador aleatório NÃO se inventa um valor previsível;
     · o mínimo desta tabela e o do servidor são o mesmo número — um teste contra
       `GRUPOS`, para não haver duas verdades;
     · a máscara mostra as pontas e o tamanho, e o aviso diz que não fica guardado.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { GRUPOS } from './api/_prontidao.mjs';
import { MINIMOS, GERAVEIS, PASSOS, gerarSegredo, avaliarSegredo, mascara, avisoDoGerado } from './src/segredos.js';

test('1.65.0 · gera um valor com o mínimo da variável, em hexadecimal', () => {
  for (const [nome, minimo] of Object.entries(MINIMOS)) {
    const r = gerarSegredo(nome);
    assert.equal(r.ok, true, `${nome} devia gerar`);
    assert.ok(r.valor.length >= minimo, `${nome}: ${r.valor.length} < ${minimo}`);
    assert.match(r.valor, /^[0-9a-f]+$/, `${nome} tem de ser hexadecimal`);
    assert.equal(r.tamanho, r.valor.length);
    assert.equal(avaliarSegredo(nome, r.valor).ok, true, `${nome}: o que se gera tem de passar no mínimo`);
  }
});

test('1.65.0 · dois valores seguidos não são o mesmo segredo', () => {
  const a = gerarSegredo('ORBITA_API_TOKEN').valor;
  const b = gerarSegredo('ORBITA_API_TOKEN').valor;
  assert.notEqual(a, b);
});

test('1.65.0 · sem gerador aleatório não se inventa um valor previsível', () => {
  for (const fonte of [null, {}, { getRandomValues: 'sim' }]) {
    const r = gerarSegredo('ORBITA_API_TOKEN', fonte);
    assert.equal(r.ok, false, 'sem crypto não há segredo');
    assert.equal(r.valor, undefined, 'nunca devolve um valor quando falha');
    assert.match(r.motivo, /openssl rand -hex/, 'diz como se resolve');
  }
});

test('1.65.0 · uma variável que não se sabe gerar diz que não sabe (não adivinha o tamanho)', () => {
  const r = gerarSegredo('RESEND_API_KEY'); // vem do fornecedor, não se inventa
  assert.equal(r.ok, false);
  assert.match(r.motivo, /RESEND_API_KEY/);
  assert.equal(avaliarSegredo('RESEND_API_KEY', 're_123').ok, null, 'sem mínimo conhecido não se diz que está bem');
});

test('1.65.0 · avaliar diz quantos caracteres tem e qual é o mínimo', () => {
  const curto = avaliarSegredo('ORBITA_API_TOKEN', 'abc');
  assert.equal(curto.ok, false);
  assert.equal(curto.tamanho, 3);
  assert.equal(curto.minimo, 32);
  assert.match(curto.motivo, /3 caracteres.*mínimo é 32/);
  const vazio = avaliarSegredo('ORBITA_ADMIN_TOKEN', '');
  assert.equal(vazio.ok, false);
  assert.match(vazio.motivo, /vazio/);
});

test('1.65.0 · a tabela de mínimos é a mesma do servidor', () => {
  const doServidor = new Map();
  for (const g of GRUPOS) {
    for (const i of g.itens) {
      if (i.minimo > 0) for (const alias of i.aliases) doServidor.set(alias, i.minimo);
    }
  }
  assert.ok(GERAVEIS.length >= 3, 'há segredos a gerar');
  for (const [nome, minimo] of Object.entries(MINIMOS)) {
    assert.equal(doServidor.get(nome), minimo,
      `${nome}: src/segredos.js diz ${minimo} e api/_prontidao.mjs diz ${doServidor.get(nome)}`);
  }
  /* e o contrário: nenhum mínimo do servidor ficou esquecido aqui */
  for (const [nome] of doServidor) {
    assert.ok(MINIMOS[nome], `${nome} tem mínimo no servidor e não se gera na página`);
  }
});

test('1.65.0 · a máscara mostra as pontas e o tamanho, nunca o meio', () => {
  const valor = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const m = mascara(valor);
  assert.match(m, /^a1b2…8f90 \(32\)$/);
  assert.doesNotMatch(m, /c3d4e5f6/, 'o meio não aparece');
  assert.equal(mascara(''), '');
  assert.match(mascara('abc'), /•/);
});

test('1.65.0 · o aviso diz que aparece uma vez e que não fica guardado', () => {
  const a = avisoDoGerado('ORBITA_API_TOKEN', 32);
  assert.match(a, /ORBITA_API_TOKEN/);
  assert.match(a, /32 caracteres/);
  assert.match(a, /Copia agora/);
  assert.match(a, /não fica guardado/);
});

test('1.65.0 · os passos da Vercel são os que se fazem, por esta ordem', () => {
  assert.ok(PASSOS.length >= 3);
  assert.match(PASSOS[0], /Settings → Environment Variables/);
  assert.ok(PASSOS.some((p) => /Redeploy/.test(p)), 'sem redeploy a variável não chega à função');
  assert.ok(PASSOS.some((p) => /Production/.test(p)));
});
