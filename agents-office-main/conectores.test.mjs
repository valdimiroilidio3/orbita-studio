/* ===========================================================================
   1.79.2 · OS CONECTORES DO SERVIDOR, À VISTA SEM SESSÃO (9 nov 2026)

   O dono apontou-o por palavras: «os conectores MCP e a oficina continuam a ler a
   tua máquina». É verdade que o `claude mcp list` é do posto — mas a página
   publicada não tem de ficar a falar do posto. A instalação tem os SEUS
   conectores: as chaves que vivem no ambiente do servidor.

   O que se prova aqui, sem rede:

     · o catálogo de serviços vive num sítio só (a `_rotas` re-exporta-o);
     · `resumoDosConectores` conta por NOME de variável — e nunca imprime valores;
     · o `/api/health` (público) publica esse retrato: é o que a página consegue
       ler sem sessão, ao contrário do `/platform/apis` (que a porta fecha);
     · a barra do escritório e os painéis de configuração deixaram de mandar o dono
       arrancar um terminal, e a oficina diz o que é em vez de mandar `npm start`.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { SERVICOS, resumoDosConectores } from './api/_servicos.mjs';
import * as rotas from './api/_rotas.mjs';

const fonte = (f) => fs.readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');

test('1.79.2 · o catálogo de serviços tem um dono só', () => {
  assert.ok(SERVICOS.length >= 20, `esperava o catálogo inteiro, vi ${SERVICOS.length}`);
  assert.equal(rotas.SERVICOS, SERVICOS, 'a _rotas tem de re-exportar o MESMO array, não uma cópia');
  const ids = SERVICOS.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, 'serviços duplicados no catálogo');
  for (const id of ['github', 'vercel', 'supabase', 'resend', 'notion', 'slack']) {
    assert.ok(ids.includes(id), `o catálogo perdeu ${id}`);
  }
});

test('1.79.2 · sem chaves não há conectores ligados (e o catálogo é todo dito)', () => {
  const r = resumoDosConectores({});
  assert.equal(r.ligados.length, 0);
  assert.equal(r.total, SERVICOS.length);
  assert.equal(r.de.length, SERVICOS.length);
  assert.ok(r.porLigar.includes('resend'));
  for (const s of r.de) assert.ok(typeof s.nome === 'string' && s.nome.length > 1, `${s.id} sem nome`);
});

test('1.79.2 · com chaves no ambiente, os conectores certos ficam ligados', () => {
  const r = resumoDosConectores({ RESEND_API_KEY: 're_segredo', SUPABASE_URL: 'https://x', SUPABASE_SECRET_KEY: 'k' });
  const ids = r.ligados.map((x) => x.id).sort();
  assert.deepEqual(ids, ['resend', 'supabase']);
  /* supabase pede DUAS variáveis: uma só não chega */
  assert.deepEqual(resumoDosConectores({ SUPABASE_URL: 'https://x' }).ligados.map((x) => x.id), []);
  /* e o valor da chave NUNCA sai neste retrato */
  assert.equal(JSON.stringify(r).includes('re_segredo'), false, 'uma chave em claro não pode ir para o health');
});

test('1.79.2 · o health publica o retrato dos conectores, por nome', async () => {
  const { default: handler } = await import('./api/health.mjs');
  const guardado = {};
  await handler(
    { headers: {}, query: {}, url: '/api/health' },
    { status(c) { guardado.status = c; return this; }, json(b) { guardado.corpo = b; }, setHeader() {} },
  );
  /* sem base de dados o health responde 503 — mas o retrato dos conectores vai lá */
  assert.equal(guardado.status, 503);
  assert.ok(guardado.corpo.conectores, 'o health tem de trazer `conectores`');
  assert.equal(guardado.corpo.conectores.total, SERVICOS.length);
  assert.ok(Array.isArray(guardado.corpo.conectores.de));
  for (const s of guardado.corpo.conectores.de) {
    assert.deepEqual(Object.keys(s).sort(), ['falta', 'id', 'ligado', 'nome', 'tipo']);
  }
});

test('1.79.2 · a barra do escritório lê o servidor, não a máquina do dono', () => {
  const mcp = fonte('mcp.js');
  assert.equal(/os conectores vêm do `claude mcp list` desta máquina/.test(mcp), false,
    'a página publicada não pode falar do posto do dono como se fosse o servidor');
  assert.match(mcp, /async function perguntarConectores/);
  assert.match(mcp, /fetch\('\/api\/health'/);
  assert.match(mcp, /conectores/);
  assert.match(mcp, /Configurações/, 'sem conectores ligados, diz onde se ligam');
});

test('1.79.2 · nenhum painel manda o dono arrancar um terminal', () => {
  /* tira comentários de bloco e de linha: o registo do que mudou pode (e deve)
     nomear o `npm start`; o TEXTO que o dono lê, não. */
  const semComentarios = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  for (const f of ['forge.js', 'apps.js', 'config.js', 'mesa.js', 'tasks.js', 'falhas.js']) {
    const limpo = semComentarios(fonte(f));
    assert.equal(/npm start/.test(limpo), false, `${f} ainda manda correr npm start a quem lê a página`);
  }
});

test('1.79.5 · nenhum painel diz que este escritório não tem servidor', () => {
  /* o problema que isto fecha: a frase «aberto sem servidor · `npm start`» fazia o
     escritório parecer um ficheiro solto. Ele TEM servidor (a publicação e a base); o
     que pode faltar é a LIGAÇÃO. Sobram três usos honestos — «sem servidor local»
     (o serve.mjs não está a correr), «sem servidor de correio» (serviço de email) e
     «sem servidor publicado» (a base a falar) — e todos dizem de que servidor falam. */
  const semComentarios = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
  const permitidos = /sem servidor (local|de correio|publicado)/i;
  for (const f of ['forge.js', 'apps.js', 'config.js', 'mesa.js', 'tasks.js', 'falhas.js', 'ops.js', 'localapi.js', 'mcp.js']) {
    const texto = semComentarios(fonte(f));
    for (const m of texto.matchAll(/[^\n]{0,40}sem servidor[^\n]{0,20}/gi)) {
      assert.match(m[0], permitidos, `${f}: «${m[0].trim()}» dá a ideia de que não há servidor nenhum`);
    }
  }
  /* e as duas frases que diziam isso mesmo, agora dizem o que se passa */
  assert.match(fonte('ops.js'), /'servidor não responde'/);
  assert.match(fonte('config.js'), /sem ligação · só este browser/);
  assert.match(fonte('config.js'), /sem ligação ao servidor não há trabalho a acontecer/);
});

test('1.79.2 · a oficina diz o que é, e aponta o que a publicação faz', () => {
  const s = fonte('forge.js');
  assert.match(s, /oficina local: forja ferramentas em ficheiros desta máquina/);
  assert.match(s, /o trabalho corre nas tarefas e na IA da Órbita/);
  assert.match(s, /semServidorAvisado/);
});
