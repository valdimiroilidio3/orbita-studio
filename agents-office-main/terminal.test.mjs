// Órbita — os testes do TERMINAL (28 out 2026, pedido 34d).
//
// Pedido do dono: «o terminal deve funcionar perfeitamente, se possível de acordo com a máquina onde
// o sistema foi aberto». Isto executa `src/forge.js` num DOM a sério (jsdom) — o mesmo ficheiro que
// vai para o browser — e prova as quatro coisas que mudaram:
//   · `:help` é curto (três linhas) e manda a quem quer tudo para `:comandos`;
//   · `:comandos` lista-os todos, incluindo `:maquina` e `:api`;
//   · `:maquina` e `:api` mostram o que o SERVIDOR respondeu (SO, shell, node, ferramentas, serviços
//     prontos e chaves em falta) — nada é escrito à mão no cliente;
//   · Tab completa o comando e ↑ ↓ percorrem o histórico sem perder o que estava a ser escrito.
//
//   node --test terminal.test.mjs        (ou: npm run test:term)
//
// O que NÃO se prova aqui: o SSE ao vivo e o desenho do painel. Isso depende do servidor e do CSS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHELL = fs.readFileSync(path.join(HERE, 'src', 'shell.html'), 'utf8');
const ROOMS = ['marketing', 'emails', 'sales', 'fin', 'ops', 'delivery'];

/** O `#term` tal como está no shell, mais um `document`/`fetch` falsos e o módulo a sério. */
async function montar({ respostas = {} } = {}) {
  const start = SHELL.indexOf('<div id="term"');
  const end = SHELL.indexOf('<!--APP-->');
  assert.ok(start > 0 && end > start, 'o shell devia ter o painel #term');
  const dom = new JSDOM(`<!doctype html><html><body>${SHELL.slice(start, end)}</body></html>`, { pretendToBeVisual: true });
  const pedidos = [];
  const base = {
    '/api/platform': {
      ok: true, version: '1.13.0',
      machine: {
        os: 'Linux 6.8.0', arch: 'x64', cores: 8, cpu: 'Ryzen 7', memoryGB: 31.3, freeGB: 12.1,
        uptimeH: 4.2, node: 'v22.22.3', shell: '/bin/bash', cwd: '/home/dono/orbita', pid: 4242,
        tz: 'Europe/Lisbon', locale: 'pt-PT',
        tools: [{ name: 'git', found: true, version: 'git version 2.43' }, { name: 'node', found: true, version: 'v22.22.3' }, { name: 'docker', found: false, version: null }],
      },
    },
    '/api/platform/apis': {
      ok: true,
      summary: { total: 3, configured: 2, ready: 1 },
      list: [
        { id: 'github', name: 'GitHub', configured: true, ready: true, verified: true, latencyMs: 120, status: 200, missing: [], error: null },
        { id: 'resend', name: 'Resend (email)', configured: true, ready: false, verified: false, latencyMs: 90, status: 401, missing: [], error: 'HTTP 401 Unauthorized' },
        { id: 'stripe', name: 'Stripe', configured: false, ready: false, verified: false, missing: ['STRIPE_SECRET_KEY'], error: null },
      ],
    },
    '/api/forge': { ok: true, stats: { tools: 0, active: 0, runs: 0, failures: 0, avgMs: 0 }, rooms: ROOMS.map((r) => ({ room: r, tools: [] })) },
    '/api/forge/events?n=1': { ok: true, stats: { tools: 0, active: 0, runs: 0, failures: 0, avgMs: 0 }, events: [] },
  };
  const plano = { ...base, ...respostas };
  const fetchFalso = async (url) => {
    pedidos.push(String(url));
    const d = plano[String(url)];
    if (!d) return { ok: false, status: 404, json: async () => ({ error: 'rota falsa ' + url }) };
    return { ok: true, status: 200, json: async () => d };
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.fetch = fetchFalso;
  globalThis.EventSource = undefined;   // sem SSE nos testes: o que se prova é o comando
  const { createForgeTerminal } = await import('./src/forge.js?' + Math.random());
  const term = createForgeTerminal({ rooms: ROOMS });
  return { term, dom, pedidos, doc: dom.window.document };
}

const linhas = (doc) => [...doc.querySelectorAll('.tm-lines .tm-row .tm-tx')].map((n) => n.textContent);

test(':help é curto e aponta para :comandos', async () => {
  const { term, doc } = await montar();
  await term.command(':help');
  // a primeira linha é o eco do comando (› :help); o :help em si são três linhas
  const l = linhas(doc).filter((x) => !x.startsWith('›'));
  assert.equal(l.length, 3, 'o :help devia ter três linhas: ' + JSON.stringify(l));
  assert.ok(l.some((x) => x.includes(':ls')));
  assert.ok(l.some((x) => x.includes(':comandos')), 'falta a pista para a lista completa');
});

test(':comandos lista tudo o que o terminal sabe fazer', async () => {
  const { term, doc } = await montar();
  await term.command(':comandos');
  const texto = linhas(doc).join('\n');
  for (const c of [':ls', ':forge', ':run', ':adopt', ':activate', ':eventos', ':maquina', ':api', ':limpar']) {
    assert.ok(texto.includes(c), 'a lista completa não menciona ' + c);
  }
  assert.ok(/Tab/.test(texto) && /↑/.test(texto), 'a lista devia ensinar Tab e as setas');
});

test(':maquina mostra a máquina que o servidor reportou (nada inventado no cliente)', async () => {
  const { term, doc, pedidos } = await montar();
  await term.command(':maquina');
  assert.ok(pedidos.includes('/api/platform'), 'o :maquina tem de perguntar ao servidor');
  const texto = linhas(doc).join('\n');
  assert.match(texto, /Linux 6\.8\.0/);
  assert.match(texto, /x64 · 8 núcleos · Ryzen 7/);
  assert.match(texto, /31\.3 GB/);
  assert.match(texto, /node v22\.22\.3 · shell \/bin\/bash/);
  assert.match(texto, /pid 4242/);
  assert.match(texto, /git \(git version 2\.43\)/, 'as ferramentas com versão deviam aparecer');
  assert.match(texto, /em falta: docker/, 'o que não existe no PATH é dito, não escondido');
});

test(':api diz o que está pronto, o que falhou e qual a chave que falta', async () => {
  const { term, doc, pedidos } = await montar();
  await term.command(':api');
  assert.ok(pedidos.includes('/api/platform/apis'));
  const texto = linhas(doc).join('\n');
  assert.match(texto, /1 de 3 prontas/);
  assert.match(texto, /✓ GitHub — sonda respondeu · 120 ms · HTTP 200/);
  assert.match(texto, /… Resend \(email\) — com chave mas a sonda falhou: HTTP 401/);
  assert.match(texto, /STRIPE_SECRET_KEY/);
  assert.match(texto, /vigia o ficheiro/, 'tem de dizer que basta gravar o .env');
});

test('sem servidor o terminal não inventa: diz que não conseguiu', async () => {
  const { term, doc } = await montar();
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'indisponível' }) });
  await term.command(':maquina');
  const texto = linhas(doc).join('\n');
  assert.match(texto, /sem retrato da máquina: indisponível/);
});

test('Tab completa o comando; ↑ ↓ percorrem o histórico sem perder o rascunho', async () => {
  const { term, doc } = await montar();
  const input = doc.querySelector('.tm-in');
  const tecla = (key) => input.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  input.value = ':maq';
  tecla('Tab');
  assert.equal(input.value, ':maquina ', 'Tab devia completar :maq → :maquina');
  // duas ordens → ↑ traz a última, ↑ outra vez a anterior, ↓ volta ao rascunho
  await term.command(':ls');
  await term.command(':api');
  input.value = ':a escrever';
  tecla('ArrowUp');
  assert.equal(input.value, ':api');
  tecla('ArrowUp');
  assert.equal(input.value, ':ls');
  tecla('ArrowDown');
  assert.equal(input.value, ':api');
  tecla('ArrowDown');
  assert.equal(input.value, ':a escrever', 'o que estava a ser escrito tem de voltar');
});

test('um comando desconhecido sugere o mais parecido em vez de ficar calado', async () => {
  const { term, doc } = await montar();
  await term.command(':mquina');
  const texto = linhas(doc).join('\n');
  assert.match(texto, /comando desconhecido: mquina/);
  assert.match(texto, /talvez :maquina/);
});

test('ao abrir, o terminal diz em que máquina está (uma linha, uma vez)', async () => {
  const { term, doc } = await montar();
  term.open();
  await new Promise((r) => setTimeout(r, 60));
  const texto = linhas(doc).join('\n');
  assert.match(texto, /Linux 6\.8\.0 · x64 · 8 núcleos · node v22\.22\.3 · shell \/bin\/bash/);
  const antes = linhas(doc).length;
  term.close(); term.open();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(linhas(doc).length, antes, 'a linha da máquina não se repete a cada abertura');
});
