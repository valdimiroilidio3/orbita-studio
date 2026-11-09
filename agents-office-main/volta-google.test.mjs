/* ===========================================================================
   1.72.0 · A VOLTA DO GOOGLE (6 nov 2026)

   O Google devolve a pessoa ao endereço registado — que é a RAIZ do sítio. Este
   teste não lê o script: **corre-o**, com um `location` falso, contra o
   `dist/index.html` que a Vercel publica. É a única forma de saber que o `code`
   sai de lá para quem o sabe trocar, em vez de ficar numa landing page a olhar
   para ele.

   Regras que se provam:
     · com `code` + `state`, a raiz manda a pessoa para `/api/oauth?fornecedor=google`;
     · sem eles, a raiz não faz NADA (um visitante normal não é redireccionado);
     · com `error` do fornecedor, a razão segue para `/app` escrita em português;
     · o `code` e o `state` vão codificados (não se parte um URL com `+` ou `&`).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HTML = fs.readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8');

/** O primeiro `<script>` inline do `<head>` — o encaminhador da volta. */
function scriptDaVolta() {
  const head = HTML.slice(0, HTML.indexOf('</head>'));
  const m = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  const achado = m.find((c) => c.includes('/api/oauth?fornecedor=google'));
  assert.ok(achado, 'o encaminhador tem de estar no <head> (corre antes de a página desenhar)');
  return achado;
}

function correr(search) {
  const destino = [];
  const contexto = {
    location: { search, replace: (u) => destino.push(u) },
    URLSearchParams,
  };
  vm.createContext(contexto);
  vm.runInContext(scriptDaVolta(), contexto);
  return destino;
}

test('1.72.0 · a raiz entrega o `code` do Google a quem o sabe trocar', () => {
  const d = correr('?code=4/abcDEF&state=8f3a&scope=email');
  assert.equal(d.length, 1, 'redirecciona uma vez, não duas');
  const u = new URL(d[0], 'https://orbita-agentes.vercel.app');
  assert.equal(u.pathname, '/api/oauth');
  assert.equal(u.searchParams.get('fornecedor'), 'google');
  assert.equal(u.searchParams.get('code'), '4/abcDEF', 'o código passa intacto (as barras não se perdem)');
  assert.equal(u.searchParams.get('state'), '8f3a');
});

test('1.72.0 · um visitante normal da raiz não é redireccionado', () => {
  assert.deepEqual(correr(''), []);
  assert.deepEqual(correr('?utm_source=email'), []);
  assert.deepEqual(correr('?code=so-codigo-sem-state'), [], 'sem state não há como provar que é deste browser');
});

test('1.72.0 · caracteres que partem URLs vão codificados', () => {
  const d = correr('?code=a+b%2Bc&state=x%26y');
  const u = new URL(d[0], 'https://orbita-agentes.vercel.app');
  assert.equal(u.searchParams.get('code'), 'a b+c', 'o código descodifica no valor original');
  assert.equal(u.searchParams.get('state'), 'x&y', 'e um «&» no state não inventa parâmetros novos');
});

test('1.72.0 · se o Google recusar, a razão vai para a mesa', () => {
  const d = correr('?error=access_denied&error_description=O+utilizador+recusou&state=1');
  assert.equal(d.length, 1);
  const u = new URL(d[0], 'https://orbita-agentes.vercel.app');
  assert.equal(u.pathname, '/app');
  /* 1.72.1: passa o CÓDIGO, não o texto inglês — quem traduz é a mesa */
  assert.equal(u.searchParams.get('erroEntrada'), 'google:access_denied');
});

test('1.72.1 · a recusa «org_internal» chega à mesa como código, para ser explicada em português', () => {
  const d = correr('?error=org_internal&error_description=A+penas+usuarios+da+organizacao&state=1');
  assert.equal(d.length, 1);
  const u = new URL(d[0], 'https://orbita-agentes.vercel.app');
  assert.equal(u.pathname, '/app');
  assert.equal(u.searchParams.get('erroEntrada'), 'google:org_internal');
});

test('1.72.0 · um pedido já com `fornecedor` passa ao lado (não faz ciclos)', () => {
  assert.deepEqual(correr('?fornecedor=github&code=c&state=s'), []);
});
