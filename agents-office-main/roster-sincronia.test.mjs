// Sincronização do roster: office.agents.json ↔ src/data.js ↔ roster.mjs ↔ CLAUDE.md.
// A fonte estrutural é src/data.js (AGENTS). Todos os números aqui são derivados dela;
// o único número fixo é o conjunto original de 35 lugares (roster-sincronia.original.json),
// que serve de prova de que nenhuma personalização se perdeu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, DEPT_KEYS } from './src/data.js';
import { IDENTITY } from './src/agentes.js';
import { defaults, validate, montarPlantel, loadRoster, FILE, LOCAL, LUGARES, brainFile } from './roster.mjs';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const lerJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const ORIGINAIS = lerJson(path.join(RAIZ, 'roster-sincronia.original.json')).agents; // os 35 lugares antes da sincronização
// as ferramentas configuradas em cada um dos 35 lugares originais (extraídas do ficheiro original)
const FERRAMENTAS_ORIGINAIS = {"elead":["notion","googlecalendar","slack"],"imail":["notion","slack","googlecalendar"],"report":["notion","clarity"],"dash":["clarity","notion"],"comply":["notion","gmail"],"pros":["territool","apollo","chrome"],"enzo":["fullenrich","apollo"],"ilm":["gmail","googlecalendar"],"riley":["chrome","notion"],"scout":["chrome","notion"],"vmail":["playwright","chrome"],"olead":["gmail","googlecalendar","pandadoc"],"piper":["pandadoc","notion"],"folo":["gmail","imessage"],"ona":["imessage","gmail"],"legal":["pandadoc","notion"],"cmail":["gmail","slack"],"gfx":["canva","notion"],"dasst":["canva","webflow"],"alead":["canva","higgsfield"],"invo":["notion","clarity"],"dlead":["webflow","playwright"],"pco":["notion","googlecalendar"],"qa":["playwright","chrome"],"crep":["webflow","playwright"],"cass":["stripe","notion"],"apay":["webflow","chrome"],"kmail":["notion","googledrive"],"mlead":["meta","notion"],"newt":["beehiiv","loops"],"ada":["meta"],"iggy":["meta","canva"],"vid":["hyperframes"],"lexi":["notion","googlecalendar"],"recon":["clarity","meta"]};
const IDS = AGENTS.map(a => a.id);
const entradasDoFicheiro = () => lerJson(FILE).agents;
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ao-roster-'));

test('o número de lugares vem de src/data.js e roster.mjs não o escreve à mão', () => {
  assert.equal(LUGARES, AGENTS.length);
  assert.equal(defaults().length, AGENTS.length);
  assert.equal(new Set(IDS).size, IDS.length, 'IDs duplicados em src/data.js');
  const fonte = fs.readFileSync(path.join(RAIZ, 'roster.mjs'), 'utf8');
  assert.doesNotMatch(fonte, /\b35 (lugares|seats|agentes|agents)\b/, 'roster.mjs ainda escreve 35 à mão');
});

test('1 · cada lugar estrutural tem exatamente uma entrada em office.agents.json', () => {
  const contagem = new Map();
  for (const e of entradasDoFicheiro()) contagem.set(e.id, (contagem.get(e.id) || 0) + 1);
  for (const id of IDS) assert.equal(contagem.get(id), 1, `«${id}» tem ${contagem.get(id) || 0} entradas (tem de ter 1)`);
  assert.equal(entradasDoFicheiro().length, AGENTS.length);
});

test('2 · sem IDs duplicados e sem entradas órfãs', () => {
  const vistos = new Set();
  for (const e of entradasDoFicheiro()) {
    assert.ok(!vistos.has(e.id), `«${e.id}» aparece duas vezes`);
    vistos.add(e.id);
  }
  assert.deepEqual([...vistos].filter(id => !IDS.includes(id)), [], 'entradas que não existem em src/data.js');
});

test('3 · departamento e lead do ficheiro coincidem com src/data.js; um líder por departamento', () => {
  const porId = new Map(AGENTS.map(a => [a.id, a]));
  for (const e of entradasDoFicheiro()) {
    const s = porId.get(e.id);
    assert.equal(e.department, s.dept, `«${e.id}» department`);
    assert.equal(!!e.lead, !!s.lead, `«${e.id}» lead`);
  }
  for (const dep of DEPT_KEYS) {
    const membros = AGENTS.filter(a => a.dept === dep);
    if (!membros.length) continue;
    assert.equal(membros.filter(a => a.lead).length, 1, `${dep} tem de ter exatamente um líder`);
  }
});

test('4 · os lugares acrescentados recebem valores por omissão válidos (sem ferramentas inventadas)', () => {
  const originais = new Set(ORIGINAIS.map(a => a.id));
  const novos = AGENTS.filter(a => !originais.has(a.id));
  assert.equal(novos.length, AGENTS.length - ORIGINAIS.length);
  const base = defaults();
  for (const a of novos) {
    const d = base.find(x => x.id === a.id);
    assert.equal(d.name, a.name, `${a.id}: name`);
    assert.equal(d.role, IDENTITY[a.id].role, `${a.id}: role`);
    assert.equal(d.does, IDENTITY[a.id].does, `${a.id}: does`);
    assert.deepEqual(d.tools, [], `${a.id}: tools não se inventam`);
    assert.equal(d.brief, '');
    assert.equal(d.model, '');
    assert.equal(d.effort, '');
    const e = entradasDoFicheiro().find(x => x.id === a.id);
    assert.deepEqual(e.tools, [], `${a.id}: o ficheiro não pode trazer ferramentas inventadas`);
  }
  const semFicheiro = montarPlantel([]);
  assert.equal(semFicheiro.agents.length, AGENTS.length, 'sem ficheiro nenhum, o escritório tem todos os lugares');
  assert.deepEqual(semFicheiro.problems, []);
});

test('5 · as personalizações dos 35 lugares existentes são preservadas', () => {
  assert.equal(Object.keys(FERRAMENTAS_ORIGINAIS).length, ORIGINAIS.length);
  const porId = new Map(montarPlantel([{ path: FILE, label: 'office.agents.json' }]).agents.map(a => [a.id, a]));
  for (const o of ORIGINAIS) {
    const a = porId.get(o.id);
    assert.ok(a, `«${o.id}» desapareceu`);
    assert.deepEqual(a.tools, FERRAMENTAS_ORIGINAIS[o.id], `${o.id}: tools mudaram`);
    assert.equal(a.name, o.name, `${o.id}: name`);
    assert.equal(a.role, o.role, `${o.id}: role`);
    assert.equal(a.does, o.does, `${o.id}: does`);
  }
});

test('6 · precedência: office.agents.json → cérebro → office.agents.local.json; o último ganha', () => {
  const dir = pasta();
  try {
    const f1 = path.join(dir, 'a.json'), f2 = path.join(dir, 'b.json'), f3 = path.join(dir, 'c.json');
    fs.writeFileSync(f1, JSON.stringify({ agents: [{ id: 'elead', tools: ['um'], name: 'PRIMEIRO' }] }));
    fs.writeFileSync(f2, JSON.stringify({ agents: [{ id: 'elead', tools: ['dois'] }, { id: 'imail', role: 'Papel do cérebro' }] }));
    fs.writeFileSync(f3, JSON.stringify({ agents: [{ id: 'elead', tools: ['tres'] }] }));
    const r = montarPlantel([{ path: f1, label: 'a' }, { path: f2, label: 'b' }, { path: f3, label: 'c' }]);
    const el = r.agents.find(a => a.id === 'elead');
    assert.deepEqual(el.tools, ['tres'], 'o último ficheiro tem de ganhar');
    assert.equal(el.name, 'PRIMEIRO', 'um campo que o último ficheiro não mexe mantém o valor anterior');
    assert.equal(r.agents.find(a => a.id === 'imail').role, 'Papel do cérebro');
    assert.deepEqual(r.files, ['a', 'b', 'c']);
    assert.deepEqual(r.problems, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('6b · loadRoster aplica o cérebro por cima de office.agents.json (o local, se existir, fica por cima de tudo)', () => {
  const cerebro = pasta();
  try {
    fs.mkdirSync(path.join(cerebro, 'Órbita'), { recursive: true });
    fs.writeFileSync(brainFile(cerebro), JSON.stringify({ agents: [{ id: 'elead', tools: ['do-cerebro'] }] }));
    const r = loadRoster(cerebro);
    assert.ok(r.files.includes('office.agents.json'));
    assert.ok(r.files.includes('brain/Órbita/agents.json'));
    if (!fs.existsSync(LOCAL)) assert.deepEqual(r.agents.find(a => a.id === 'elead').tools, ['do-cerebro']);
    assert.equal(r.agents.length, AGENTS.length);
  } finally { fs.rmSync(cerebro, { recursive: true, force: true }); }
});

test('7 · entradas inválidas geram avisos claros e não interrompem o carregamento', () => {
  const dir = pasta();
  try {
    const bom = path.join(dir, 'bom.json'), mau = path.join(dir, 'mau.json'), partido = path.join(dir, 'partido.json');
    fs.writeFileSync(bom, JSON.stringify({ agents: [
      { id: 'ghost', name: 'X' },
      { id: 'piper', tools: ['pandadoc'] },
      { id: 'piper', tools: ['duplicado'] },
      { id: 'olead', department: 'fin' },
      { id: 'olead', lead: false },
      { id: 'lexi', model: 'haiku' },
      { id: 'lexi', effort: 'turbo' },
      { id: 'cmail', brief: 'x'.repeat(2500) },
      { name: 'sem id' },
    ] }));
    fs.writeFileSync(mau, '{ nope');
    fs.writeFileSync(partido, JSON.stringify({ agentes: [] }));
    let r;
    assert.doesNotThrow(() => {
      r = montarPlantel([{ path: bom, label: 'bom' }, { path: mau, label: 'mau' }, { path: partido, label: 'partido' }]);
    });
    assert.equal(r.agents.length, AGENTS.length, 'o escritório carrega com todos os lugares');
    const txt = r.problems.join('\n');
    assert.match(txt, new RegExp(`"ghost" não é um dos ${LUGARES} lugares`));
    assert.match(txt, /aparece duas vezes/);
    assert.match(txt, /o departamento não se muda/);
    assert.match(txt, /o líder não se muda/);
    assert.match(txt, /o modelo tem de ser/);
    assert.match(txt, /o esforço tem de ser/);
    assert.match(txt, /o brief passa de/);
    assert.match(txt, /não tem "id"/);
    assert.match(txt, /não é JSON válido/);
    assert.match(txt, /tem de ser/);
    for (const p of r.problems) assert.match(p, /^(bom|mau|partido): /, `aviso sem origem: ${p}`);
    // o que é válido continua a valer
    assert.deepEqual(r.agents.find(a => a.id === 'piper').tools, ['duplicado'], 'a última entrada ganha');
    assert.equal(r.agents.find(a => a.id === 'olead').department, 'ops');
    assert.equal(r.agents.find(a => a.id === 'olead').lead, true);
    assert.equal(r.agents.find(a => a.id === 'lexi').model, '');
    assert.equal(r.agents.find(a => a.id === 'cmail').brief.length, 2000);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('7b · um ficheiro com a forma errada devolve o plantel base com um aviso', () => {
  const r = validate({ agentes: [] });
  assert.equal(r.agents.length, AGENTS.length);
  assert.match(r.problems[0], /tem de ser/);
});

test('8 · CLAUDE.md dá o número real de lugares e de cada departamento', () => {
  const doc = fs.readFileSync(path.join(RAIZ, 'CLAUDE.md'), 'utf8');
  const total = doc.match(/seis departamentos e (\d+) lugares/);
  assert.ok(total, 'CLAUDE.md não diz o total de lugares');
  assert.equal(Number(total[1]), AGENTS.length);
  for (const dep of ['emails', 'sales', 'marketing', 'ops', 'fin', 'delivery']) {
    const m = doc.match(new RegExp('`' + dep + '` \\((\\d+)(?: lugares)?\\)'));
    assert.ok(m, `CLAUDE.md não diz quantos lugares tem «${dep}»`);
    assert.equal(Number(m[1]), AGENTS.filter(a => a.dept === dep).length, `«${dep}»`);
  }
  assert.match(doc, /name, role, does, tools, brief, model e effort/, 'CLAUDE.md não lista effort entre os campos editáveis');
});

test('9 · «personalizado» conta também ferramentas, modelo e esforço', () => {
  const cerebro = pasta();
  try {
    const r = loadRoster(cerebro);
    if (!fs.existsSync(LOCAL)) assert.equal(r.customised, ORIGINAIS.length, 'os 35 lugares com ferramentas configuradas');
  } finally { fs.rmSync(cerebro, { recursive: true, force: true }); }
});

// 10 · o que o dono escreve no ficheiro: objetos e listas não viram «[object Object]», e o brief com tipo errado avisa
test('10 · campos de texto com objeto são recusados com aviso em PT-PT, nunca gravados como «[object Object]»', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'olead', name: { x: 1 }, role: ['a'], does: { y: 2 } }, { id: 'piper', tools: ['ok', { a: 1 }] }] });
  const o = r.agents.find(a => a.id === 'olead');
  const p = r.agents.find(a => a.id === 'piper');
  for (const v of [o.name, o.role, o.does]) assert.doesNotMatch(String(v), /object Object/);
  assert.equal(o.name, 'SALES CLOSER', 'o nome antigo mantém-se');
  assert.ok(r.problems.some(x => /o nome tem de ser texto/.test(x)), 'aviso do nome');
  assert.ok(r.problems.some(x => /a função tem de ser texto/.test(x)), 'aviso da função');
  assert.ok(r.problems.some(x => /o «faz» tem de ser texto/.test(x)), 'aviso do «faz»');
  assert.deepEqual(p.tools.filter(t => t !== 'ok'), [], 'o objeto não entra nas ferramentas');
  assert.ok(r.problems.some(x => /só se aceitam nomes de conectores/.test(x)), 'aviso das ferramentas');
});

test('10b · um brief com tipo errado (objeto) é avisado e ignorado, não passa em silêncio', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'cmail', brief: { a: 1 } }, { id: 'elead', brief: ['Linha um', 'Linha dois'] }] });
  assert.ok(r.problems.some(x => /brief tem de ser texto ou uma lista de linhas/.test(x)), 'aviso do brief');
  assert.equal(r.agents.find(a => a.id === 'elead').brief, 'Linha um\nLinha dois', 'lista de linhas continua a juntar-se');
});

test('11 · o total oficial é 49 lugares: se mudar, é uma decisão do proprietário e este teste avisa', () => {
  // Guarda deliberada, não contagem derivada: AGENTS.length nunca falharia sozinho.
  assert.equal(AGENTS.length, 49, 'o escritório tem 49 lugares; mudar este número exige rever as guardas de 49 nos outros testes');
  assert.equal(lerJson(FILE).agents.length, 49, 'office.agents.json tem uma entrada por lugar');
  assert.equal(LUGARES, 49, 'roster.mjs LUGARES');
});
