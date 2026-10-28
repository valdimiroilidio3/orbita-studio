/* ===========================================================================
   1.50.0 · provas do erro honesto — 28 out 2026

   O caso real que originou isto, em produção:
     POST /api/tasks → 404 com uma página HTML ("The page could not be found")
     → r.json() rebentava
     → a barra dizia «Sem um motor de IA ligado, o escritório não finge que a
       tarefa existe».

   Duas coisas erradas: a rota não existia, e o motor podia estar bom. Aqui
   prova-se que cada falha passa a ter a sua frase, e que nenhuma delas culpa a
   IA sem motivo.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import { explicarFalha, lerCorpo, pareceHTML, motorNaMesa, fraseDaBarra, ROTA_DA_MESA } from './src/falhas.js';

const HTML_DA_VERCEL = '<!DOCTYPE html><html><head><title>The page could not be found</title></head><body>404: NOT_FOUND</body></html>';

test('falhas: uma página HTML no lugar de JSON é «sem servidor», não «sem motor»', () => {
  const f = explicarFalha({ status: 404, texto: HTML_DA_VERCEL, rota: '/api/tasks' });
  assert.equal(f.tipo, 'sem-servidor');
  assert.match(f.frase, /publicada sem o servidor/i);
  assert.match(f.detalhe, /\/api\/tasks/);
  assert.match(f.ajuda, /npm start|mesa/i);
  assert.equal(/<a\s|href=/i.test(f.ajuda), false, 'a ajuda é texto puro: quem desenha é que põe o link');
});

test('falhas: o erro que o utilizador viu nunca mais é falta de IA', () => {
  const f = explicarFalha({ status: 404, texto: HTML_DA_VERCEL, rota: '/api/tasks' });
  const tudo = `${f.frase} ${f.detalhe} ${f.ajuda}`.toLowerCase();
  assert.equal(/sem (um )?motor de ia/.test(tudo), false);
  assert.equal(/não finge que a tarefa existe/.test(tudo), false);
});

test('falhas: quando o servidor diz que falta o motor, a frase é essa', () => {
  const f = explicarFalha({
    status: 503,
    texto: JSON.stringify({ error: 'nenhum fornecedor de IA configurado — mete as chaves no ambiente' }),
    rota: '/api/tasks',
  });
  assert.equal(f.tipo, 'sem-motor');
  assert.match(f.detalhe, /nenhum fornecedor/);
  assert.match(f.ajuda, /AI|mesa|motor/i);
});

test('falhas: uma recusa do servidor mantém a razão dele, sem a reescrever', () => {
  const f = explicarFalha({ status: 400, texto: JSON.stringify({ error: 'essa hora já passou' }), rota: '/api/tasks' });
  assert.equal(f.tipo, 'servidor');
  assert.match(f.detalhe, /essa hora já passou/);
  assert.equal(f.detalhe.includes('motor'), false);
});

test('falhas: sem resposta nenhuma é «rede», e aponta o npm start', () => {
  const f = explicarFalha({ status: 0, texto: '', rota: '/api/tasks' });
  assert.equal(f.tipo, 'rede');
  assert.match(f.ajuda, /npm start/);
});

test('falhas: lerCorpo nunca atira — JSON, HTML e lixo', () => {
  assert.deepEqual(lerCorpo('{"a":1}').json, { a: 1 });
  assert.equal(lerCorpo(HTML_DA_VERCEL).html, true);
  assert.equal(lerCorpo(HTML_DA_VERCEL).json, null);
  assert.equal(lerCorpo('The page could not be found').json, null);
  assert.equal(lerCorpo('').json, null);
  assert.equal(pareceHTML('  <html>'), true);
  assert.equal(pareceHTML('{"html": true}'), false);
});

test('falhas: a IA da mesa conta-se pelo que está pronto, não pela lista toda', () => {
  const m = motorNaMesa({
    fornecedores: [
      { id: 'ovh', nome: 'OVH', configurado: true, desligado: false },
      { id: 'llm7', nome: 'LLM7', configurado: true, desligado: true },
      { id: 'tavily', nome: 'Tavily', configurado: false, desligado: false },
    ],
  });
  assert.equal(m.disponivel, true);
  assert.equal(m.quantos, 1);
  assert.equal(m.total, 3);
  assert.deepEqual(m.nomes, ['OVH']);
  assert.match(m.frase, /1 fornecedor/);

  const vazio = motorNaMesa({ fornecedores: [] });
  assert.equal(vazio.disponivel, false);
  assert.match(vazio.frase, /não respondeu|nenhum/);
  assert.equal(motorNaMesa(null).disponivel, false);
});

test('falhas: a frase da barra distingue servidor local de mesa', () => {
  assert.match(fraseDaBarra({ temServidorLocal: true, motorLocal: 'Claude' }), /servidor local · motor Claude/);
  assert.match(fraseDaBarra({ temServidorLocal: true, motorLocal: null }), /sem motor ligado/);
  assert.match(fraseDaBarra({ temServidorLocal: false, mesa: motorNaMesa({ fornecedores: [{ id: 'x', nome: 'X', configurado: true }] }) }), /sem servidor local · .*X/);
  assert.match(fraseDaBarra({}), /tarefas criam-se na mesa/);
});

/* ---------- a garantia no código que é publicado ---------- */
import { readFileSync } from 'node:fs';

const fonte = (f) => readFileSync(new URL(`./src/${f}`, import.meta.url), 'utf8');

test('código: a frase que culpava a IA desapareceu da barra e do compositor', () => {
  for (const f of ['tasks.js', 'main.js']) {
    const s = fonte(f);
    assert.doesNotMatch(s, /não finge que a tarefa existe/, `${f} ainda tem a frase antiga`);
    assert.doesNotMatch(s, /Sem um motor de IA ligado/, `${f} ainda culpa a IA por qualquer erro`);
    assert.match(s, /from '\.\/falhas\.js'/, `${f} tem de usar a leitura honesta de falhas`);
  }
});

test('código: a barra confirma a rota das tarefas antes de prometer o escritório', () => {
  const s = fonte('tasks.js');
  assert.match(s, /let tarefasOk = false/);
  assert.match(s, /fetch\(API \+ '\/tasks'\)/, 'tem de perguntar pela rota que usa');
  assert.match(s, /if \(live && !tarefasOk\) \{ explicarSemServidor\(\); return; \}/, 'sem servidor, não tenta criar');
  assert.match(s, /ligarIaDaMesa\(\)/, 'sem servidor local, a IA lê-se na mesa');
});

test('código: o painel do motor não fica mudo quando /api/ai não existe', () => {
  const s = fonte('tasks.js');
  /* o `r.json()` directo era o que rebentava e deixava o painel em «SEM IA» */
  assert.doesNotMatch(s, /const r = await fetch\(`\$\{API\}\/ai\$\{refresh \? '\?refresh=1' : ''\}`\);\n\s*AI_\.state = await r\.json\(\);/);
  assert.match(s, /if \(!r\.ok \|\| !lido\.json \|\| !Array\.isArray\(lido\.json\.providers\)\) throw new Error/);
  assert.match(s, /aiDaMesa/);
});
