// Testes da OFICINA (27 out 2026) — sem browser, sem motor de IA, sem rede.
//
// O que aqui se prova é o que o produto promete: uma ferramenta só entra no catálogo depois de
// passar as provas; o código dela não alcança o processo, a rede nem o disco; as primitivas leem
// dados REAIS; uma ferramenta que escreve nasce em rascunho e a prova não suja o cérebro; e o que
// aparece no terminal é exactamente o que correu.
//
//   node --test forge.test.mjs        (ou: npm run test:forge)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkManifest, unsafeCode, slugOf, SCOPES, WRITE_SCOPES } from './forge/manifest.mjs';
import { runInSandbox } from './forge/sandbox.mjs';
import { makeContext } from './forge/primitives.mjs';
import { choose, repair, recipes, instantiate } from './forge/compose.mjs';
import { createBus } from './forge/bus.mjs';
import { createForge } from './forge/index.mjs';
import { DEPTS, DEPT_KEYS, AGENTS } from './src/data.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ROOM = 'marketing';
const AGENT = (AGENTS.find((a) => a.dept === ROOM && a.lead) || AGENTS.find((a) => a.dept === ROOM)).id;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-forge-'));

const GOOD = {
  id: 'contagem', room: ROOM, author: AGENT, name: 'Contagem', summary: 'conta notas',
  scopes: ['brain:read'], inputs: {}, state: 'draft', examples: [{ input: {}, expect: 'result.notas >= 0' }],
  code: 'function run(input, ctx) { const n = ctx.brain.notes(); return { notas: n.length }; }',
};

/* ---------- o portão: o manifesto ---------- */
test('o manifesto aceita uma ferramenta honesta', () => {
  const r = checkManifest(GOOD, { rooms: DEPT_KEYS, agents: AGENTS.map((a) => a.id) });
  assert.equal(r.ok, true, r.problems.join(' · '));
});

test('o manifesto recusa o que uma ferramenta não pode fazer nem tocar', () => {
  const base = { ...GOOD };
  const cases = [
    ['process', `${base.code}\nconst p = process.env;`],
    ['require', `${base.code}\nconst f = require('fs');`],
    ['eval', `${base.code}\neval('1+1');`],
    ['constructor', `${base.code}\nconst x = ctx.constructor;`],
    ['ciclo', 'function run(){ while (true) {} }'],
    ['rede', 'function run(){ return fetch("http://x"); }'],
  ];
  for (const [what, code] of cases) {
    const r = checkManifest({ ...base, code });
    assert.equal(r.ok, false, `${what}: devia ser recusado`);
    assert.ok(r.problems.some((p) => /proibido/.test(p)), `${what}: ${r.problems.join(' · ')}`);
  }
});

test('o manifesto exige provas que olhem para o resultado', () => {
  const semProvas = checkManifest({ ...GOOD, examples: [] });
  assert.equal(semProvas.ok, false);
  assert.ok(semProvas.problems.some((p) => /sem provas/.test(p)));

  const provaCega = checkManifest({ ...GOOD, examples: [{ input: {}, expect: 'true' }] });
  assert.equal(provaCega.ok, false);
  assert.ok(provaCega.problems.some((p) => /olhar para `result`/.test(p)), provaCega.problems.join(' · '));
});

test('o manifesto não aceita escopos inventados nem salas que não existem', () => {
  assert.equal(checkManifest({ ...GOOD, scopes: ['root:all'] }).ok, false);
  assert.equal(checkManifest({ ...GOOD, room: 'juridico' }, { rooms: DEPT_KEYS }).ok, false);
  assert.ok(WRITE_SCOPES.includes('brain:write'), 'escrever no cérebro tem de ser um escopo de escrita');
  assert.ok(SCOPES['brain:write'], 'e tem de ter descrição legível');
});

test('unsafeCode diz a linha onde está o problema', () => {
  const hits = unsafeCode('function run(){\n  return process.pid;\n}');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].line, 2);
  assert.match(hits[0].what, /process/);
});

test('slugOf dá nomes estáveis, sem acentos', () => {
  assert.equal(slugOf('Contagem do Cérebro!'), 'contagem-do-cerebro');
  assert.equal(slugOf('  ...  '), '');
});

/* ---------- o sandbox ---------- */
test('no sandbox não existe process, require nem fetch', () => {
  const r = runInSandbox({
    // `globalThis` existe (é do próprio contexto do vm), mas não traz o processo: é essa a prova
    source: 'function run(i, ctx) { return { p: typeof process, r: typeof require, f: typeof fetch, pid: typeof globalThis.process }; }',
    caps: {},
  });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.result, { p: 'undefined', r: 'undefined', f: 'undefined', pid: 'undefined' });
});

test('as primitivas atravessam a ponte como dados, não como objectos do anfitrião', () => {
  const r = runInSandbox({
    source: 'function run(i, ctx) { return { notas: ctx.brain.notes().length, nome: ctx.room }; }',
    caps: {
      room: 'marketing',
      brain: { notes: () => [{ name: 'a' }, { name: 'b' }] },
    },
  });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.result.notas, 2);
  assert.equal(r.result.nome, 'marketing');
});

test('um ciclo infinito é cortado pelo prazo, não pendura o servidor', () => {
  const t0 = Date.now();
  const r = runInSandbox({ source: 'function run() { let i = 0; while (i < 1e12) i++; return { i }; }', caps: {}, timeoutMs: 80 });
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t0 < 3000, 'o prazo tem de ser respeitado');
});

test('a prova (expect) olha para o resultado e reprova o que não confirma', () => {
  const ok = runInSandbox({ source: 'function run(){ return { n: 3 }; }', caps: {}, expect: 'result.n === 3' });
  assert.equal(ok.expect, true);
  const bad = runInSandbox({ source: 'function run(){ return { n: 0 }; }', caps: {}, expect: 'result.n > 0' });
  assert.equal(bad.ok, true);
  assert.equal(bad.expect, false);
});

test('um erro dentro da ferramenta volta como mensagem, não como excepção', () => {
  const r = runInSandbox({ source: 'function run(){ throw new Error("partiu-se"); }', caps: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /partiu-se/);
});

test('o tecto de saída recusa em vez de cortar JSON a meio', () => {
  const r = runInSandbox({ source: 'function run(i, ctx){ return ctx.grande(); }', caps: { grande: () => 'x'.repeat(60000) } });
  assert.equal(r.ok, false);
  assert.match(r.error, /demasiado/);
});

/* ---------- as primitivas: dados reais ---------- */
const ctxReal = (scopes, opts = {}) => makeContext({
  brainDir: path.join(ROOT, 'brain'), dataDir: path.join(ROOT, 'data'), docsDir: path.join(ROOT, 'docs'),
  scratchDir: path.join(tmp(), 'scratch'), scopes, room: ROOM, agent: AGENT, ...opts,
});

test('o cérebro lê-se a sério: há notas, cada uma com palavras contadas', () => {
  const ctx = ctxReal(['brain:read']);
  const notas = ctx.brain.notes();
  assert.ok(notas.length >= 10, `esperava notas no cérebro, encontrei ${notas.length}`);
  assert.ok(notas.every((n) => typeof n.name === 'string' && typeof n.words === 'number' && Array.isArray(n.links)));
  const uma = ctx.brain.read(notas[0].name);
  assert.equal(typeof uma, 'string');
  assert.ok(ctx.brain.search('nota').length >= 0);
});

test('sem o escopo, a primitiva recusa — a ferramenta não decide sozinha o que pode', () => {
  const ctx = ctxReal([]);
  assert.throws(() => ctx.brain.notes(), /escopo em falta: brain:read/);
  assert.throws(() => ctx.tasks.list(), /escopo em falta: tasks:read/);
});

test('a escrita em ensaio não toca no disco', () => {
  const scratch = path.join(tmp(), 'scratch');
  const ctx = makeContext({
    brainDir: path.join(ROOT, 'brain'), dataDir: path.join(ROOT, 'data'), docsDir: path.join(ROOT, 'docs'),
    scratchDir: scratch, scopes: ['brain:write', 'scratch:write'], room: ROOM, agent: AGENT, dry: true,
  });
  const r = ctx.brain.writeNote('Prova', 'texto');
  assert.equal(r.dry, true);
  assert.ok(!fs.existsSync(path.join(ROOT, 'brain', 'Órbita', 'oficina', 'Prova.md')), 'o ensaio não pode escrever no cérebro');
  const s = ctx.scratch.write('x', 'y');
  assert.equal(s.dry, true);
  assert.ok(!fs.existsSync(scratch) || fs.readdirSync(scratch).length === 0);
});

/* ---------- o compositor ---------- */
test('o compositor escolhe a receita certa e diz porquê', () => {
  const a = choose('contar as palavras das notas do cérebro');
  assert.equal(a.ok, true);
  assert.equal(a.recipe.id, 'notas-contagem');
  assert.ok(a.hits.includes('palavras'), JSON.stringify(a.hits));

  const b = choose('o que está à espera há mais tempo na fila');
  assert.equal(b.ok, true);
  assert.ok(['fila-do-escritorio', 'sala-pulso'].includes(b.recipe.id), b.recipe.id);

  const c = choose('fazer café expresso para a equipa');
  assert.equal(c.ok, false);
  assert.ok(c.closest.length > 0, 'mesmo sem receita, diz o que está mais perto');
});

test('as receitas são todas honestas: nome, resumo, escopos e provas', () => {
  for (const r of recipes()) {
    assert.ok(r.name && r.summary && r.scopes.length, `${r.id} sem nome/resumo/escopos`);
    const rc = instantiate(choose(r.name), { room: ROOM, author: AGENT, need: r.name }).code;
    assert.ok(rc.includes('function run'), `${r.id} sem run()`);
  }
});

test('a reparação é determinística, reconhecida por uma regra e visível', () => {
  const meu = 'function run(input, ctx) { return { t: input.termo.toLowerCase() }; }';
  const fix = repair(meu, "Cannot read properties of undefined (reading 'termo')");
  assert.ok(fix, 'devia reconhecer a falha de entrada');
  assert.equal(fix.rule, 'guardar-entradas');
  assert.match(fix.code, /input = input \|\| \{\};/);
  assert.equal(repair(meu, 'erro que a oficina não conhece'), null, 'não repara o que não entende');
});

/* ---------- a oficina, de ponta a ponta ---------- */
function oficina() {
  const root = path.join(tmp(), 'forge');
  const bus = createBus({ file: path.join(root, 'log.ndjson') });
  const f = createForge({
    root, bus,
    brainDir: path.join(ROOT, 'brain'), dataDir: path.join(ROOT, 'data'), docsDir: path.join(ROOT, 'docs'),
    rooms: DEPT_KEYS, agents: AGENTS.map((a) => a.id),
  });
  return { f, root, bus };
}

test('forjar: escolhe, grava, prova e activa — com a trace toda', () => {
  const { f, root } = oficina();
  const r = f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras das notas do cérebro' });
  assert.equal(r.ok, true, JSON.stringify(r.trace?.map((t) => t.text)));
  assert.equal(r.tool.state, 'active');
  assert.equal(r.tool.examples >= 1, true);
  const fases = r.trace.map((t) => t.phase);
  for (const p of ['think', 'match', 'save', 'pass', 'active', 'first', 'done']) assert.ok(fases.includes(p), `falta a fase ${p}: ${fases.join(',')}`);
  assert.ok(fs.existsSync(path.join(root, 'tools', ROOM, r.tool.id, 'manifest.json')));
  assert.ok(fs.existsSync(path.join(root, 'tools', ROOM, r.tool.id, 'v1.tool.js')));

  // a primeira execução devolveu números reais, não uma promessa
  assert.equal(typeof r.first.result.notas, 'number');
  assert.ok(r.first.result.notas > 0);
});

test('correr uma ferramenta regista uso e recusa-se a correr em rascunho', () => {
  const { f, root } = oficina();
  const made = f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro' });
  const run = f.run({ room: ROOM, id: made.tool.id });
  assert.equal(run.ok, true, run.error);
  assert.equal(typeof run.result.palavras, 'number');

  const stats = f.stats();
  assert.equal(stats.runs, 2, `esperava 2 execuções (a primeira e a minha), há ${stats.runs}`);

  // uma ferramenta que escreve fica em rascunho e não corre sem ordem expressa
  const draft = f.forge({ room: ROOM, agent: AGENT, need: 'guardar uma nota no cérebro' });
  assert.equal(draft.ok, false);
  assert.equal(draft.draft, true);
  assert.equal(draft.tool.state, 'draft');
  const refused = f.run({ room: ROOM, id: draft.tool.id, input: { corpo: 'x' } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /rascunho/);

  // e o dono pode activá-la; a activação volta a provar (em ensaio)
  const act = f.activate({ room: ROOM, id: draft.tool.id });
  assert.equal(act.ok, true, act.error);
  assert.equal(f.tools(ROOM).find((t) => t.id === draft.tool.id).state, 'active');
  assert.ok(!fs.existsSync(path.join(ROOT, 'brain', 'Órbita', 'oficina', 'Prova da oficina.md')), 'a prova não pode escrever no cérebro');
  assert.ok(fs.existsSync(path.join(root, 'tools', ROOM, draft.tool.id, 'v2.tool.js')) === false, 'activar não cria versão nova');
});

test('adopção: a ferramenta de uma sala é provada nos dados da outra', () => {
  const { f } = oficina();
  const made = f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro' });
  const to = DEPT_KEYS.find((k) => k !== ROOM);
  const r = f.adopt({ room: ROOM, id: made.tool.id, to, agent: (AGENTS.find((a) => a.dept === to && a.lead) || {}).id });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.tool.room, to);
  assert.equal(r.tool.state, 'active');
  assert.equal(r.tool.origin.room, ROOM, 'a proveniência tem de ficar escrita');
});

test('uma ferramenta partida fica BROKEN e nunca entra no catálogo activo', () => {
  const { f } = oficina();
  const r = f.forge({
    room: ROOM, agent: AGENT, need: 'ferramenta que falha',
    code: 'function run() { return { ok: true }; }',
    examples: [{ input: {}, expect: 'result.ok === false' }],
  });
  assert.equal(r.ok, false);
  assert.equal(r.tool.state, 'broken');
  assert.equal(f.stats().active, 0);
});

test('código escrito fora da oficina passa pelo mesmo portão', () => {
  const { f } = oficina();
  const r = f.forge({
    room: ROOM, agent: AGENT, need: 'ler o processo',
    name: 'mau', code: 'function run() { return { p: process.pid }; }',
    examples: [{ input: {}, expect: 'result.p > 0' }],
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /proibido/);
});

test('o agente pede uma ferramenta no texto e a oficina percebe', () => {
  const { f } = oficina();
  const text = 'Fiz o relatório.\nFORGE: quero contar as palavras das notas do cérebro\nFORGE: e também procurar termos\nFORGE: esta terceira é ignorada';
  const req = f.parseRequests(text);
  assert.equal(req.length, 2);
  assert.match(req[0], /contar as palavras/);
  assert.equal(f.parseRequests('sem pedidos aqui').length, 0);
});

test('o prompt do agente lista as ferramentas da sala e ensina o pedido', () => {
  const { f } = oficina();
  assert.equal(f.promptText(ROOM), '', 'sem ferramentas não há secção');
  f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro' });
  const p = f.promptText(ROOM);
  assert.match(p, /FERRAMENTAS QUE A TUA SALA JÁ FORJOU/);
  assert.match(p, /FORGE: <o que precisas/);
});

test('o sense corre as ferramentas da sala antes de o agente escrever', () => {
  const { f } = oficina();
  f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro' });
  const out = f.sense({ room: ROOM });
  assert.equal(out.length, 1);
  assert.equal(out[0].ok, true);
  assert.ok(out[0].result.notas > 0);
});

test('o terminal recebe os eventos por ordem, e ficam no log em disco', async () => {
  const { f, root } = oficina();
  const seen = [];
  const off = f.subscribe((e) => seen.push(e));
  f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro' });
  off();
  assert.ok(seen.length >= 8, `esperava uma dúzia de eventos, vi ${seen.length}`);
  assert.ok(seen.every((e, i) => i === 0 || e.seq > seen[i - 1].seq), 'a ordem dos eventos tem de ser crescente');
  assert.ok(seen.some((e) => e.phase === 'code' && e.data?.stream), 'o código tem de ser transmitido linha a linha');
  await new Promise((r) => setTimeout(r, 60));
  const log = fs.readFileSync(path.join(root, 'log.ndjson'), 'utf8').trim().split('\n');
  assert.ok(log.length >= 8);
  for (const l of log) assert.doesNotThrow(() => JSON.parse(l));
});

test('o catálogo é a única porta: salas, receitas, primitivas e limites', () => {
  const { f } = oficina();
  const c = f.catalogue();
  assert.equal(c.rooms.length, DEPT_KEYS.length);
  assert.ok(c.recipes.length >= 5);
  assert.match(c.primitives, /ctx\.brain\.notes\(\)/);
  assert.ok(c.limits.code > 1000);
  assert.deepEqual(c.writes, WRITE_SCOPES);
  assert.equal(c.stats.tools, 0);
});

test('duas versões da mesma ferramenta convivem (a oficina não apaga história)', () => {
  const { f, root } = oficina();
  const a = f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro' });
  const b = f.forge({ room: ROOM, agent: AGENT, need: 'contar as palavras do cérebro', name: 'contagem' });
  const dir = path.join(root, 'tools', ROOM, a.tool.id);
  assert.ok(fs.existsSync(path.join(dir, 'v1.tool.js')));
  assert.equal(b.tool.id, 'contagem');
  const header = fs.readFileSync(path.join(dir, 'v1.tool.js'), 'utf8').split('\n')[0];
  assert.match(header, /^\/\/~ /, 'o cabeçalho leva o marcador de proveniência');
});
