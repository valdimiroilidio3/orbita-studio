// Integridade dos dados do escritório — a fonte de verdade e as ligações entre ela e o resto.
//
// Fonte de verdade: src/data.js (AGENTS, DEPT_KEYS, DEPTS, LAYOUT, NOME_SALA).
// Tudo o que aqui se verifica é DERIVADO desses arrays e objetos. Nenhum teste fixa um total de
// agentes: o roster pode crescer ou encolher sem que este ficheiro mude. (Os testes com 49 de
// office.test.mjs, a11y.test.mjs e elenco.test.mjs são guardas deliberadas e ficam como estão.)
//
//   node --test dados-integridade.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, DEPT_KEYS, DEPTS, LAYOUT, NOME_SALA, SALAS_COM_ROTINAS, officeProblems } from './src/data.js';
import { IDENTITY } from './src/agentes.js';
import { defaults } from './roster.mjs';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const lerJson = (f) => JSON.parse(fs.readFileSync(path.join(RAIZ, f), 'utf8'));

test('IDs de agente são únicos e não vazios', () => {
  const ids = AGENTS.map((a) => a.id);
  assert.ok(ids.length > 0, 'o escritório não tem agentes');
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0), 'há um agente sem id');
  const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(repetidos, [], 'IDs repetidos');
});

test('cada agente aponta para uma sala que existe (DEPT_KEYS), e cada sala tem entrada em DEPTS e LAYOUT', () => {
  for (const a of AGENTS) {
    assert.ok(DEPT_KEYS.includes(a.dept), `${a.id}: a sala «${a.dept}» não está em DEPT_KEYS`);
  }
  for (const k of DEPT_KEYS) {
    assert.ok(DEPTS[k], `DEPT_KEYS tem «${k}» e DEPTS não`);
    assert.ok(LAYOUT[k], `DEPT_KEYS tem «${k}» e LAYOUT não`);
  }
});

test('o total de agentes é a soma dos agentes por sala (calculado, não escrito)', () => {
  const porSala = Object.fromEntries(DEPT_KEYS.map((k) => [k, AGENTS.filter((a) => a.dept === k).length]));
  const soma = Object.values(porSala).reduce((n, x) => n + x, 0);
  assert.equal(soma, AGENTS.length, 'a soma das salas tem de dar todos os agentes');
  for (const k of DEPT_KEYS) assert.ok(porSala[k] > 0, `a sala «${k}» não tem nenhum agente`);
});

test('cada sala tem exatamente um líder, e o líder pertence à própria sala', () => {
  for (const k of DEPT_KEYS) {
    const lideres = AGENTS.filter((a) => a.dept === k && a.lead);
    assert.equal(lideres.length, 1, `a sala «${k}» tem ${lideres.length} líderes (tem de ter 1)`);
  }
  assert.ok(AGENTS.filter((a) => a.lead).every((a) => DEPT_KEYS.includes(a.dept)));
});

test('NOME_SALA: uma entrada por sala, nomes não vazios e sem colisões', () => {
  assert.deepEqual(Object.keys(NOME_SALA).sort(), [...DEPT_KEYS].sort(), 'NOME_SALA tem de ter exatamente as salas de DEPT_KEYS');
  const nomes = Object.values(NOME_SALA);
  assert.ok(nomes.every((n) => typeof n === 'string' && n.trim().length > 0), 'há um nome de sala vazio');
  assert.equal(new Set(nomes).size, nomes.length, 'dois nomes de sala iguais: ' + JSON.stringify(NOME_SALA));
});

test('DEPTS: cada entrada tem name e short, e o Cérebro (sem sala de agentes) também', () => {
  for (const [k, d] of Object.entries(DEPTS)) {
    assert.ok(d.name && d.short, `${k}: falta name ou short`);
  }
  assert.ok(DEPTS.brain, 'o Cérebro tem de existir em DEPTS');
});

test('SALAS_COM_ROTINAS só aponta para salas que existem', () => {
  assert.ok(SALAS_COM_ROTINAS.length > 0);
  for (const k of SALAS_COM_ROTINAS) assert.ok(DEPT_KEYS.includes(k), `«${k}» em SALAS_COM_ROTINAS não é uma sala`);
});

test('LAYOUT tem os mesmos pods que DEPTS (o Cérebro incluído), e cada sala de agentes tem pod', () => {
  assert.deepEqual(Object.keys(LAYOUT).sort(), Object.keys(DEPTS).sort(), 'LAYOUT e DEPTS têm de ter os mesmos pods');
  for (const k of DEPT_KEYS) assert.ok(LAYOUT[k], 'a sala «' + k + '» não tem pod em LAYOUT');
});

test('cada agente tem identidade (src/agentes.js) e não há identidades sem agente', () => {
  const ids = AGENTS.map((a) => a.id);
  const semIdentidade = ids.filter((id) => !IDENTITY[id]);
  assert.deepEqual(semIdentidade, [], 'agentes sem IDENTITY');
  const orfas = Object.keys(IDENTITY).filter((id) => !ids.includes(id));
  assert.deepEqual(orfas, [], 'identidades sem agente em AGENTS');
});

test('office.agents.json e o roster por omissão têm os mesmos lugares, sala e liderança que AGENTS', () => {
  const json = lerJson('office.agents.json').agents;
  const jsonIds = json.map((e) => e.id);
  const ids = AGENTS.map((a) => a.id);
  assert.deepEqual(jsonIds.filter((id, i) => jsonIds.indexOf(id) !== i), [], 'IDs repetidos em office.agents.json');
  assert.deepEqual([...jsonIds].sort(), [...ids].sort(), 'office.agents.json não tem os mesmos IDs que AGENTS');
  for (const e of json) {
    const a = AGENTS.find((x) => x.id === e.id);
    assert.equal(e.department, a.dept, `${e.id}: sala diferente em office.agents.json`);
    assert.equal(!!e.lead, !!a.lead, `${e.id}: liderança diferente em office.agents.json`);
  }
  assert.deepEqual(defaults().map((a) => a.id).sort(), [...ids].sort(), 'roster.defaults() não tem os mesmos lugares que AGENTS');
});

test('officeProblems() não encontra incoerências nos dados', () => {
  assert.deepEqual(officeProblems(), []);
});

test('o texto do build não escreve contagens à mão (vêm de AGENTS e DEPT_KEYS)', () => {
  const build = fs.readFileSync(path.join(RAIZ, 'build.mjs'), 'utf8');
  assert.doesNotMatch(build, /\b\d+ agentes\b/, 'build.mjs tem uma contagem de agentes escrita à mão');
  assert.match(build, /AGENTS\.length/);
});

test('CLAUDE.md dá o total e a contagem de cada sala que os dados confirmam', () => {
  const txt = fs.readFileSync(path.join(RAIZ, 'CLAUDE.md'), 'utf8');
  // contagens por sala, escritas como `chave` (N lugares)
  const porSala = [...txt.matchAll(/`(\w+)`\s*\((\d+)(?: lugares)?\)/g)];
  assert.equal(porSala.length, DEPT_KEYS.length, 'o CLAUDE.md tem de dar a contagem de cada uma das ' + DEPT_KEYS.length + ' salas');
  for (const [, k, n] of porSala) {
    const real = AGENTS.filter((a) => a.dept === k).length;
    assert.equal(Number(n), real, `CLAUDE.md diz ${n} lugares em «${k}», os dados têm ${real}`);
  }
  // o total: qualquer “N lugares” que não seja uma contagem por sala
  const resto = txt.replace(/`\w+`\s*\(\d+(?: lugares)?\)/g, '');
  for (const m of resto.matchAll(/\b(\d+)\s+lugares\b/g)) {
    assert.equal(Number(m[1]), AGENTS.length, `CLAUDE.md diz «${m[0]}», os dados têm ${AGENTS.length} agentes`);
  }
});
