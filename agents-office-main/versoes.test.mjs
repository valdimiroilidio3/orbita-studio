/* ===========================================================================
   1.79.2 · AS VERSÕES QUE O CI USA TÊM DE SERVIR (9 nov 2026)

   O gate do GitHub esteve vermelho em todos os pull requests — e não era do
   código da aplicação. O `package.json` prometia `engines: >= 20` e o
   `.github/workflows/verificacao.yml` corria Node 20; mas o `jsdom` tinha subido
   para a 30, que exige `^22.22.2 || ^24.15.0 || >=26`. Resultado: no CI, as
   suites que abrem o `shell.html` num DOM (o compositor, as apps, as
   integrações) rebentavam ao importar o `jsdom` — 113 s e vermelho, num
   ambiente onde nada disto era visível.

   Este teste existe para isso não voltar em silêncio:

     · a versão de Node que o CI corre está declarada num sítio só (`CI_NODE`);
     · o `engines.node` do `package.json` aceita essa versão;
     · **cada dependência directa instalada declara engines que aceitam** a mesma
       versão — é o que apanhava o `jsdom` 30;
     · e o próprio workflow usa essa versão (as duas suites: `gate` e `suites`).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const RAIZ = new URL('./', import.meta.url);
const lerJson = (p) => JSON.parse(fs.readFileSync(new URL(p, RAIZ), 'utf8'));

/** A versão de Node do CI — uma só, escrita aqui e no workflow. */
const CI_NODE = '20.19.0';

/* --- um leitor de intervalos semver, pequeno e suficiente -------------------
   Aceita o que as dependências usam de facto: `*`, `>=x`, `^x.y.z`, `~x.y.z`,
   `x.y.z`, e alternativas com `||`. Nada de pré-lançamentos. */
function comparar(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function umTermo(termo, versao) {
  const t = termo.trim();
  if (!t || t === '*' || t === 'x') return true;
  const m = /^(>=|>|<=|<|\^|~|=)?\s*v?(\d+)(?:\.(\d+|[x*]))?(?:\.(\d+|[x*]))?$/.exec(t);
  if (!m) return false; // um formato que este leitor não conhece: reprova (e diz-se porquê)
  const [, op = '', maior, menor = 'x', patch = 'x'] = m;
  const base = `${maior}.${menor === 'x' || menor === '*' ? '0' : menor}.${patch === 'x' || patch === '*' ? '0' : patch}`;
  const c = comparar(versao, base);
  switch (op) {
    case '>=': return c >= 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '<': return c < 0;
    case '^': {
      if (c < 0) return false;
      if (Number(maior) > 0) return comparar(versao, `${Number(maior) + 1}.0.0`) < 0;
      if (Number(menor) > 0) return comparar(versao, `0.${Number(menor) + 1}.0`) < 0;
      return comparar(versao, `0.0.${Number(patch) + 1}`) < 0;
    }
    case '~': {
      if (c < 0) return false;
      return comparar(versao, `${Number(maior)}.${Number(menor) + 1}.0`) < 0;
    }
    default: return c === 0;
  }
}
/** A versão `versao` satisfaz o intervalo `intervalo`? */
export function satisfaz(intervalo, versao = CI_NODE) {
  /* `>= 16.0.0` (com espaço) e `>=16` são a mesma coisa */
  const limpo = String(intervalo).replace(/([><=^~]+)\s+/g, '$1');
  return limpo.split('||').some((parte) => parte.trim().split(/\s+/).every((t) => umTermo(t, versao)));
}

const PACOTE = lerJson('./package.json');

test('1.79.2 · o engines do projecto aceita a versão de Node que o CI corre', () => {
  const faixa = PACOTE.engines?.node;
  assert.ok(faixa, 'o package.json tem de declarar engines.node');
  assert.equal(satisfaz(faixa), true, `engines.node diz «${faixa}», que não aceita ${CI_NODE}`);
  /* e a versão declarada é a que o workflow usa */
  const wf = fs.readFileSync(new URL('../.github/workflows/verificacao.yml', RAIZ), 'utf8');
  /* 1.79.2 · o workflow pode declarar a versão por matriz (`matrix.node: [20, 22]`,
     que é o que faz hoje: duas versões testadas) ou à mão (`node-version: 20`).
     As duas formas contam; um comentário na linha não conta (`20 # o mínimo …`). */
  const daMatriz = [...wf.matchAll(/node:\s*\[([^\]]+)\]/g)]
    .flatMap((m) => m[1].split(','))
    .map((x) => x.trim().replace(/^'|'$/g, ''))
    .filter((x) => /^\d+(\.\d+){0,2}$/.test(x));
  const doPasso = [...wf.matchAll(/node-version:\s*([^\n]+)/g)]
    .map((m) => (m[1].match(/^\s*\d+(\.\d+){0,2}/) || [])[0])
    .map((x) => (x || '').trim())
    .filter(Boolean);
  /* `${{ matrix.node }}` não é número: nesse caso a matriz é a fonte */
  const versoes = [...new Set([...daMatriz, ...doPasso])];
  assert.ok(versoes.length, 'o workflow tem de declarar node-version');
  assert.ok(versoes.length, 'não encontrei a versão do Node no workflow');
  for (const v of versoes) {
    /* `20` no workflow quer dizer «a última 20.x», que é a do `CI_NODE` */
    const alvo = v.includes('.') ? v : (v === CI_NODE.split('.')[0] ? CI_NODE : `${v}.0.0`);
    assert.ok(satisfaz(faixa, alvo), `o CI corre Node ${alvo} e o engines.node é «${faixa}»`);
  }
});

test('1.79.2 · cada dependência directa aceita a versão de Node do CI', () => {
  const nomes = [
    ...Object.keys(PACOTE.dependencies || {}),
    ...Object.keys(PACOTE.devDependencies || {}),
  ];
  const problemas = [];
  for (const nome of nomes) {
    let meta;
    try { meta = JSON.parse(fs.readFileSync(new URL(`./node_modules/${nome}/package.json`, RAIZ), 'utf8')); }
    catch { problemas.push(`${nome}: não está instalado (corre «npm ci»)`); continue; }
    const faixa = meta.engines?.node;
    if (!faixa) continue; // sem engines declarados, não promete nada
    if (!satisfaz(faixa, CI_NODE)) {
      problemas.push(`${nome}@${meta.version} exige «${faixa}» — o CI corre Node ${CI_NODE}`);
    }
  }
  assert.deepEqual(problemas, [],
    'uma dependência que exige outro Node parte as suites no CI sem se ver em casa:\n  ' + problemas.join('\n  '));
});

test('1.79.2 · o leitor de intervalos não passa tudo por favor', () => {
  /* sem isto, um erro no leitor fazia o teste acima dizer «está tudo bem» */
  assert.equal(satisfaz('^22.22.2 || ^24.15.0 || >=26.0.0'), false, 'o jsdom 30 não serve no Node 20');
  assert.equal(satisfaz('^20.19.0 || ^22.13.0 || >=24.0.0'), true);
  assert.equal(satisfaz('>=20'), true);
  assert.equal(satisfaz('>=22'), false);
  assert.equal(satisfaz('>=16.0.0'), true);
  assert.equal(satisfaz('12'), false);
  assert.equal(satisfaz('*'), true);
  assert.equal(satisfaz('^0.2.3'), false, 'o ^0.2.x fecha na 0.3.0 — 20.19 não entra');
  assert.equal(satisfaz('^0.2.3', '0.2.7'), true);
  assert.equal(satisfaz('~20.0.0'), false, 'a ~ fecha a 20.0.x e o CI corre 20.19');
});
