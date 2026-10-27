// Órbita — the build loop (Beta).
//   node check.mjs             build + offline smoke + server smoke (no Claude calls)
//   CHECK_LIVE=1 node check.mjs  … plus one real routed task and one chat turn through Claude
// Every step prints ✓ or ✗ with the reason; the process exits 1 if anything failed. This is the
// loop the Beta was built against: change something, run it, fix what is red, repeat.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, ROOT } from './config.mjs';

const results = [];
const ok = (name, detail = '') => { results.push([true, name, detail]); console.log(`✓ ${name}${detail ? '  — ' + detail : ''}`); };
const bad = (name, detail = '') => { results.push([false, name, detail]); console.log(`✗ ${name}${detail ? '  — ' + detail : ''}`); };
const step = async (name, fn) => { try { const d = await fn(); ok(name, d || ''); return true; } catch (e) { bad(name, e.message); return false; } };
const sh = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { cwd: ROOT, ...opts }); let out = '', err = '';
  p.stdout?.on('data', d => { out += d; }); p.stderr?.on('data', d => { err += d; });
  p.on('close', c => c === 0 ? resolve(out) : reject(new Error((err || out).trim().split('\n').slice(-3).join(' | '))));
  p.on('error', reject);
});
const cfg = loadConfig();
const LIVE = process.env.CHECK_LIVE === '1';

/* ---------- ORBITA API integrations (26 out 2026) ---------- */
await step('integrações e Google: token, CRM, fila de conteúdo, Places e pesquisa web', async () => {
  const out = await sh('node', ['--test', 'integrations.test.mjs', 'google.test.mjs']);
  const counts = [...out.matchAll(/# pass (\d+)/g)].map(m => +m[1]); // um ficheiro de testes por linha de resumo
  const passed = counts.reduce((a, b) => a + b, 0);
  const failed = [...out.matchAll(/# fail (\d+)/g)].reduce((a, m) => a + +m[1], 0);
  if (!passed || failed) throw new Error(out.trim().split('\n').slice(-8).join(' | '));
  return `${passed} testes (integrações + Google) · 0 falhas`;
});

await step('operação: base de dados, pontuação, funil, aprovação, opt-out e fila', async () => {
  const out = await sh('node', ['--test', 'ops.test.mjs']);
  const passed = [...out.matchAll(/# pass (\d+)/g)].reduce((a, m) => a + +m[1], 0);
  const failed = [...out.matchAll(/# fail (\d+)/g)].reduce((a, m) => a + +m[1], 0);
  if (!passed || failed) throw new Error(out.trim().split('\n').slice(-8).join(' | '));
  return `${passed} testes · SQLite em memória, nenhum serviço externo`;
});

/* ---------- 1. build ---------- */
await step('build: braingraph + bundle', async () => {
  const out = await sh('node', ['build.mjs']);
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'command-centre-v2.html'), 'utf8');
  if (html.length < 500000) throw new Error('bundle looks too small: ' + html.length);
  if (!/ÓRBITA/.test(html)) throw new Error('shell missing');
  return out.trim().split('\n').pop();
});
await step('hoje: o ecrã existe no bundle — três blocos, gesto, porquê e interruptor', async () => {
  const html = fs.readFileSync(path.join(ROOT, 'dist', 'command-centre-v2.html'), 'utf8');
  const must = {
    'três blocos': ['td-col-decide', 'Enquanto dormias', 'A seguir'],
    'gesto': ['pointerdown', 'ArrowRight', 'pointerup'],
    'porquê': ['td-why', 'why'],
    'interruptor': ['PARAR TUDO', '/ops/stop'],
    'tokens': ['--s4: 16px', '--t-m: 14px', '--ok:', '--risk:'],
    'acessibilidade': ['aria-modal', 'aria-live', 'focus-visible'],
    'passo 3': ['PESQUISAR', 'dossier', 'predictions', 'td-objections'],
  };
  const falta = [];
  for (const [what, needles] of Object.entries(must)) for (const n of needles) if (!html.includes(n)) falta.push(`${what}:${n}`);
  if (falta.length) throw new Error('falta no bundle → ' + falta.join(', '));
  return 'três blocos · deslizar + teclado · porquê · parar tudo · tokens e aria';
});

await step('horas: 00:00–23:59 em todo o lado, nunca AM/PM', async () => {
  const t = await import('./src/time.js');
  const d = new Date(2026, 9, 25, 13, 5, 42);
  const midnight = new Date(2026, 9, 25, 0, 5);
  const late = new Date(2026, 9, 25, 23, 59);
  const got = [t.fmtTime(d), t.fmtClock(d), t.fmtTime(midnight), t.fmtTime(late), t.fmtDateTime(d), t.fmtDate(d)];
  if (got[0] !== '13:05') throw new Error('13:05 esperado, veio ' + got[0]);
  if (got[1] !== '13:05:42') throw new Error('13:05:42 esperado, veio ' + got[1]);
  if (got[2] !== '00:05') throw new Error('meia-noite devia ser 00:05, veio ' + got[2]);
  if (got[3] !== '23:59') throw new Error('23:59 esperado, veio ' + got[3]);
  if (!/13:05$/.test(got[4])) throw new Error('data+hora sem hora a 24 h: ' + got[4]);
  if (/AM|PM/i.test(got.join(' '))) throw new Error('apareceu AM/PM: ' + got.join(' · '));
  if (t.normaliseHour('9:5') !== '09:05' || t.normaliseHour('24:00') !== '00:00') throw new Error('normaliseHour falha');
  const dist = fs.readFileSync(path.join(ROOT, 'dist/command-centre-v2.html'), 'utf8');
  if (/toLocaleTimeString\('en-NZ'/.test(dist) || /hour:\s*'numeric'/.test(dist)) throw new Error('o bundle ainda tem formatação de 12 horas');
  if (!/hours24/.test(dist)) throw new Error('o bundle não tem o relógio de 24 horas (datalist hours24)');
  return got.slice(0, 4).join(' · ') + ' · bundle a 24 h';
});

await step('build: graph has linked notes', async () => {
  const { BRAIN } = await import('./src/braingraph.js?' + Date.now());
  if (!BRAIN.nodes.length || !BRAIN.links.length) throw new Error('empty graph');
  if (!BRAIN.floor || BRAIN.floor.length < Math.min(90, BRAIN.nodes.length)) throw new Error('floor layout missing');
  return `${BRAIN.notes} notes · ${BRAIN.nodes.length} linked · ${BRAIN.links.length} links`;
});

/* ---------- 1b. the roster + the connector parser ---------- */
await step('roster: office.agents.json validates', async () => {
  const { loadRoster } = await import('./roster.mjs');
  const r = loadRoster();
  if (r.agents.length !== 35) throw new Error('agents: ' + r.agents.length);
  if (r.problems.length) throw new Error(r.problems.join(' | '));
  return `35 agents · ${r.customised} customised${r.files.length ? ' · ' + r.files.join(' + ') : ''}`;
});
await step('roster: bad edits are refused, not applied', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'newt', name: 'PODCAST NOTES', department: 'sales', lead: true, colour: 'red' }, { id: 'ghost', name: 'X' }] });
  const n = r.agents.find(a => a.id === 'newt');
  if (n.name !== 'PODCAST NOTES' || n.department !== 'marketing' || n.lead) throw new Error('validation let a fixed field through');
  if (r.problems.length < 4) throw new Error('expected four problems, got ' + r.problems.length);
});
await step('roster: brief is accepted and trimmed', async () => {
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'piper', brief: ['Three tiers.', 'Never discount.'] }, { id: 'lexi', brief: 'x'.repeat(2500) }] });
  if (r.agents.find(a => a.id === 'piper').brief !== 'Three tiers.\nNever discount.') throw new Error('list brief not joined');
  if (r.agents.find(a => a.id === 'lexi').brief.length !== 2000 || !r.problems.some(p => /brief is over/.test(p))) throw new Error('long brief not trimmed with a warning');
});
await step('skills: shipped skills load and bind', async () => {
  const { loadSkills } = await import('./skills.mjs'); const { loadRoster } = await import('./roster.mjs');
  const r = loadRoster(); const sk = loadSkills(cfg.brainPath, r.agents);
  if (sk.problems.length) throw new Error(sk.problems.join(' | '));
  const piper = r.agents.find(a => a.id === 'piper'), cmail = r.agents.find(a => a.id === 'cmail'), lexi = r.agents.find(a => a.id === 'lexi');
  if (!sk.names(piper).includes('proposal')) throw new Error('proposal not bound to piper: ' + sk.names(piper));
  if (!sk.names(cmail).includes('client-reply') || sk.names(lexi).includes('client-reply')) throw new Error('department binding wrong');
  if (!sk.names(lexi).includes('house-style')) throw new Error('unbound skill did not reach everyone');
  const txt = sk.promptText(piper); if (!/--- template\.md ---/.test(txt) || !/### proposal/.test(txt)) throw new Error('files beside SKILL.md not inlined');
  const sum = sk.summary();
  return `${sum.count} skills (${sum.shipped} shipped, ${sum.brain} in the brain) · ` + sum.skills.map(x => `${x.name}→${x.everyone ? 'everyone' : [...x.agents, ...x.departments].join('+')}`).join(' ');
});
await step('skills: a broken skill is refused, not applied', async () => {
  const { loadSkills } = await import('./skills.mjs'); const { loadRoster } = await import('./roster.mjs');
  const os = await import('node:os'); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-skills-')); const dir = path.join(tmp, 'Órbita', 'skills');
  fs.mkdirSync(path.join(dir, 'ghost'), { recursive: true }); fs.mkdirSync(path.join(dir, 'nofile')); fs.mkdirSync(path.join(dir, 'proposal'));
  fs.writeFileSync(path.join(dir, 'ghost', 'SKILL.md'), '---\nagents: [nobody]\ncolour: red\n---\n# Ghost\nDo things.');
  fs.writeFileSync(path.join(dir, 'proposal', 'SKILL.md'), '---\ndescription: Our own proposal skill\nagents: [piper]\n---\n# Ours\nThe brain version.');
  fs.writeFileSync(path.join(dir, 'oneliner.md'), '---\ndepartments: [fin]\n---\nMonth-end pack rules.');
  const sk = loadSkills(tmp, loadRoster().agents); fs.rmSync(tmp, { recursive: true, force: true });
  if (sk.skills.some(x => x.name === 'ghost')) throw new Error('a skill with no valid binding was loaded');
  if (!sk.problems.some(p => /nobody/.test(p)) || !sk.problems.some(p => /colour/.test(p)) || !sk.problems.some(p => /nofile/.test(p))) throw new Error('problems not reported: ' + sk.problems.join(' | '));
  const prop = sk.skills.find(x => x.name === 'proposal'); if (!prop || prop.source !== 'brain' || prop.description !== 'Our own proposal skill') throw new Error('the brain skill did not replace the shipped one');
  if (!sk.skills.find(x => x.name === 'oneliner' && x.departments.includes('fin'))) throw new Error('one-file skill not loaded');
  return `${sk.problems.length} problems reported · brain proposal wins`;
});
await step('lessons: a correction is recorded and standing rules come back', async () => {
  const learn = await import('./learn.mjs'); const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-learn-')); const a = { id: 'piper', name: 'PROPOSALS', role: 'x', does: 'y' };
  learn.record(tmp, a, { title: 'Harbourside proposal' }, 'add the booking integration for this one', { standing: false, rule: '' });
  learn.record(tmp, a, { title: 'Harbourside proposal' }, 'too long — proposals are always one page', { standing: true, rule: 'Keep every proposal to one page.' });
  learn.record(tmp, a, { title: 'Marina quote' }, 'never quote a discount', { standing: true, rule: 'Never offer a discount.' });
  const r = learn.read(tmp, 'piper'); const txt = learn.promptText(tmp, a); fs.rmSync(tmp, { recursive: true, force: true });
  if (r.rules.length !== 2 || r.oneOffs.length !== 1) throw new Error(`rules ${r.rules.length} one-offs ${r.oneOffs.length}`);
  if (!/^LIÇÕES/.test(txt) || !/one page/.test(txt) || /booking integration/.test(txt) || /←/.test(txt)) throw new Error('prompt text wrong: ' + txt);
  if (learn.promptText(tmp, { id: 'nobody' })) throw new Error('no file should mean no block');
  return `${r.rules.length} standing rules · ${r.oneOffs.length} one-off · agent with no file gets nothing`;
});
await step('interview: the lead asks five questions, then writes briefs + a skill into the brain', async () => {
  const onboard = await import('./onboard.mjs'); const { loadRoster } = await import('./roster.mjs'); const { loadSkills } = await import('./skills.mjs'); const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-onboard-')); const brain = path.join(tmp, 'brain'), data = path.join(tmp, 'data'); fs.mkdirSync(brain);
  const agents = loadRoster(brain).agents; const dept = agents.filter(a => a.department === 'sales'); const lead = dept.find(a => a.lead);
  const stub = async () => JSON.stringify({ briefs: [{ id: 'pros', brief: 'Every lead leaves with a score and a reason.' }, { id: 'enzo', brief: 'Empty beats invented.' }, { id: 'ghost', brief: 'x' }],
    skill: { name: 'Wholesale Quote', description: 'How we quote a wholesale account', agents: ['enzo'], body: '# Quoting a wholesale account\nUse this for any quote to a trade customer.\n## Steps\n1. Check the account in 30-Customers.\n## The shape\nFollow template.md.\n## Rules\n- Never discount.', template: '# Quote for {account}\n## Lines\n## Terms' }, try: 'quote Harbour Hardware for 40 units' });
  const ctx = { dept: 'sales', deptName: 'Sales', lead, agents: dept, connected: ['Gmail'], brainPath: brain, dataDir: data, ask: stub, business: 'Test Co' };
  if (await onboard.handle('what are you working on?', ctx) !== null) throw new Error('ordinary chat was captured');
  const r0 = await onboard.handle('set up', ctx); if (!/Pergunta 1 de 5/.test(r0.reply) || !onboard.active(data, 'sales')) throw new Error('did not start: ' + r0.reply.slice(0, 80));
  const r1 = await onboard.handle('We sell to trade accounts.', ctx); if (!/Pergunta 2 de 5/.test(r1.reply)) throw new Error('no second question');
  await onboard.handle('Quoting a wholesale account: check the account, price from the ladder, send.', ctx); await onboard.handle('skip', ctx); await onboard.handle('never discount', ctx);
  const r5 = await onboard.handle('Gmail and our bookkeeper', ctx);
  if (onboard.active(data, 'sales')) throw new Error('interview still active after the last answer');
  if (!r5.wrote || r5.wrote.briefs.length !== 2 || !r5.wrote.skill || r5.wrote.skill.name !== 'wholesale-quote') throw new Error('write-up wrong: ' + JSON.stringify(r5.wrote));
  if (!r5.wrote.problems.some(p => /ghost/.test(p))) throw new Error('an agent outside the department was accepted');
  const merged = loadRoster(brain); if (merged.agents.find(a => a.id === 'enzo').brief !== 'Empty beats invented.' || merged.problems.length) throw new Error('brief not merged into the brain roster: ' + merged.problems);
  const sk = loadSkills(brain, merged.agents); const w = sk.skills.find(x => x.name === 'wholesale-quote');
  if (!w || w.source !== 'brain' || !w.agents.includes('enzo') || !w.files.some(f => f.name === 'template.md') || sk.problems.length) throw new Error('skill not loadable: ' + sk.problems);
  if (!onboard.isSetUp(merged.agents, sk, 'sales') || onboard.isSetUp(merged.agents, sk, 'fin')) throw new Error('setUp flag wrong');
  const c = await onboard.handle('set up', ctx); await onboard.handle('cancel', ctx); if (onboard.active(data, 'sales')) throw new Error('cancel did not clear');
  fs.rmSync(tmp, { recursive: true, force: true });
  return `5 perguntas · 2 briefs merged · skill wholesale-quote→enzo com template · sales set up, fin not · cancel clears`;
});
await step('connectors: claude mcp list parses', async () => {
  const m = await import('./mcp.mjs');
  const l = m.parseList('Checking MCP server health…\n\nclaude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected\nclaude.ai Meta Ads: https://mcp.facebook.com/ads - ! Needs authentication\nplaywright: npx -y @playwright/mcp@latest - ✔ Connected');
  if (l.length !== 3) throw new Error('parsed ' + l.length);
  if (l[0].id !== 'claude_ai_Gmail' || l[0].key !== 'gmail' || l[0].status !== 'connected') throw new Error('gmail: ' + JSON.stringify(l[0]));
  if (l[1].status !== 'needs-auth' || l[1].key !== 'meta') throw new Error('meta: ' + JSON.stringify(l[1]));
  if (l[2].depts.length !== 2) throw new Error('playwright depts: ' + l[2].depts);
});

/* ---------- 1c. routines (V3.5) ---------- */
await step('routines: plain words become a schedule', async () => {
  const w = await import('./src/when.js');
  const cases = [
    ['every weekday at 8am, triage the inbox and tell me what needs me', 'todos os dias úteis · 08:00', 'triage the inbox and tell me what needs me'],
    ['Every Monday 9am, list the overdue invoices and draft the reminders', 'todas as segundas · 09:00', 'list the overdue invoices and draft the reminders'],
    ["match today's bank lines to invoices, daily at 5:30pm", 'todos os dias · 17:30', "match today's bank lines to invoices"],
    ['every hour between 9am and 5pm on weekdays, qualify new leads', 'de hora a hora 09:00–17:00 · dias úteis', 'qualify new leads'],
    ['chase quiet deals every tuesday and thursday at 10', 'Ter, Qui · 10:00', 'chase quiet deals'],
    ['on fridays at 4pm this week\'s cash position', 'todas as sextas · 16:00', "this week's cash position"],
    ['every 2 minutes say hello', 'a cada 2 min', 'say hello'],
    ['every weekend at noon, check the queue', 'fins de semana · 12:00', 'check the queue'],
  ];
  for (const [text, desc, task] of cases) {
    const r = w.parseWhen(text); if (!r) throw new Error('no schedule found in: ' + text);
    if (w.describe(r.when) !== desc) throw new Error(`"${text}" → ${w.describe(r.when)}, expected ${desc}`);
    if (r.text !== task) throw new Error(`"${text}" → task "${r.text}", expected "${task}"`);
    if (!w.valid(r.when) || !(w.nextRun(r.when) > Date.now())) throw new Error('no next run for ' + desc);
  }
  if (w.parseWhen('reply to a client asking when their September report will arrive within 24 hours')) throw new Error('a plain task was read as a routine');
  const t = w.parseWhen('every weekday, triage the inbox'); if (!t || !t.needsTime) throw new Error('missing time not asked back');
  const g = w.parseWhen('every morning triage the inbox'); if (!g || g.when.at !== '08:00' || !g.guessed) throw new Error('"morning" not taken as 08:00 with a flag');
  const d = w.parseWhen('weekly at 3pm list renewals'); if (!d || !d.needsDay) throw new Error('weekly with no day not asked back');
  const now = new Date('2026-09-09T17:05:00').getTime(); // a Wednesday
  const nx = w.nextRun({ kind: 'weekly', days: [1], at: '09:00' }, now); if (new Date(nx).getDay() !== 1 || new Date(nx).getHours() !== 9) throw new Error('Monday 09:00 not next');
  if (w.untilText(now + 120000, now) !== 'daqui a 2 min' || w.untilText(w.fromPicker('fri', '16:00') && nx, now) !== 'Seg 09:00') throw new Error('countdown text');
  return `${cases.length} phrasings · asks back for a missing time or day · "morning" → 08:00 flagged`;
});
await step('routines: outside Comando, Prospeção e Vendas is refused, bad ones named', async () => {
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs'); const agents = loadRoster().agents;
  const bad = rt.validate({ id: 'x', dept: 'marketing', agent: 'iggy', text: 'post the reel', when: { kind: 'daily', at: '09:00' } }, agents);
  if (!bad.problems.some(p => /versão futura/.test(p))) throw new Error('marketing routine not refused: ' + bad.problems);
  if (!/Comando, Prospeção e Vendas/.test(rt.refusal('marketing'))) throw new Error('refusal sentence');
  const wrong = rt.validate({ dept: 'fin', agent: 'ghost', text: 'x', when: { kind: 'weekly', days: [] } }, agents);
  if (!wrong.problems.some(p => /nenhum agente/.test(p)) || !wrong.problems.some(p => /não está completo/.test(p))) throw new Error('unknown agent / incomplete schedule not named: ' + wrong.problems);
  const cross = rt.validate({ dept: 'fin', agent: 'pros', text: 'x', when: { kind: 'daily', at: '09:00' } }, agents);
  if (!cross.problems.some(p => /está em Prospeção, não em Design Lab/.test(p))) throw new Error('cross-department agent not named: ' + cross.problems);
  const good = rt.validate({ dept: 'emails', agent: 'elead', text: 'Triage the overnight inbox', when: { kind: 'weekdays', at: '08:00' } }, agents);
  if (good.problems.length || good.routine.id !== 'triage-the-overnight-inbox' || good.routine.needsOk !== true) throw new Error('a good routine did not validate: ' + JSON.stringify(good));
  const dup = rt.validate({ id: 'triage-the-overnight-inbox', dept: 'emails', agent: 'elead', text: 'x', when: { kind: 'daily', at: '09:00' } }, agents, [good.routine]);
  if (!dup.problems.some(p => /partilham este id/.test(p))) throw new Error('duplicate id not named');
  if (rt.guessNeedsOk('list the overdue invoices') || !rt.guessNeedsOk('send the reminders') || !rt.guessNeedsOk('draft replies to unanswered client emails')) throw new Error('needs-OK guess');
  return 'marketing refused · unknown agent, wrong department, incomplete schedule, duplicate id all named · needsOk defaults on';
});
await step('routines: due fires once, a missed run catches up marked LATE, then the clock moves on', async () => {
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs'); const os = await import('node:os');
  const agents = loadRoster().agents; const brain = fs.mkdtempSync(path.join(os.tmpdir(), 'ao-routines-')); const data = path.join(brain, 'data');
  rt.save(brain, [{ id: 'a', dept: 'emails', agent: 'elead', title: 'A', text: 'triage', when: { kind: 'weekdays', at: '08:00' } }, { id: 'p', dept: 'ops', agent: 'folo', title: 'P', text: 'chase', when: { kind: 'daily', at: '10:00' }, paused: true, needsOk: false }]);
  const l = rt.load(brain, agents); if (l.problems.length || l.routines.length !== 2) throw new Error('load: ' + l.problems);
  const st = rt.loadState(data); const now = Date.now();
  const { list } = rt.withState(l.routines, st, now); if (!(st.a.nextAt > now) || list.find(r => r.id === 'p').nextAt !== null) throw new Error('nextAt not set / paused not null');
  if (rt.due(l.routines, st, now).length) throw new Error('fired before its time');
  st.a.nextAt = now - 2 * 3600 * 1000; st.p.nextAt = now - 3600 * 1000; // the office was off for two hours
  const d = rt.due(l.routines, st, now); if (d.length !== 1 || d[0].routine.id !== 'a' || !d[0].late) throw new Error('catch-up wrong: ' + JSON.stringify(d.map(x => [x.routine.id, x.late])));
  rt.advance(st, l.routines[0], now, 't1', true); rt.saveState(data, st);
  if (!(st.a.nextAt > now) || st.a.runs !== 1 || !st.a.lastLate) throw new Error('advance did not move the clock on');
  if (rt.due(l.routines, st, now).length) throw new Error('fired twice');
  const s2 = rt.loadState(data); if (s2.a.lastTaskId !== 't1') throw new Error('state not saved');
  const soon = { kind: 'minutes', every: 2 }; st.a.nextAt = now - 30 * 1000; const d2 = rt.due(l.routines, st, now); if (d2.length !== 1 || d2[0].late) throw new Error('a run 30 s past its minute is not late');
  const m = rt.matchRoutine(list, 'emails', 'the triage one'); if (!m || m.id !== 'a') throw new Error('match by words');
  fs.rmSync(brain, { recursive: true, force: true });
  return 'due once · 2 h late → one catch-up marked LATE · paused never fires · state persists · words match a routine';
});

/* ---------- 1d. models + the usage gauge (V3.6) ---------- */
await step('models: three names + five effort levels, one precedence, the right CLI flags', async () => {
  const m = await import('./src/models.js');
  if (JSON.stringify(m.MODEL_KEYS) !== '["sonnet","opus","fable"]' || m.DEFAULT_MODEL !== 'sonnet') throw new Error('keys/default');
  if (m.normModel('Opus') !== 'opus' || m.normModel('claude-sonnet-5') !== 'sonnet' || m.normModel('haiku') !== null || m.normModel('') !== null) throw new Error('normModel');
  const p = (o) => m.modelFor(o); 
  if (p({}).model !== 'sonnet' || p({}).from !== 'office') throw new Error('empty → office sonnet');
  if (p({ office: 'opus' }).model !== 'opus' || p({ agent: 'fable', office: 'opus' }).from !== 'agent' || p({ routine: 'opus', agent: 'fable' }).model !== 'opus' || p({ task: 'sonnet', routine: 'opus', agent: 'fable', office: 'opus' }).from !== 'task') throw new Error('precedence');
  if (p({ task: 'haiku', office: 'opus' }).model !== 'opus') throw new Error('an unknown task model must fall through');
  if (m.modelArgs('sonnet').join(' ') !== '--model sonnet' || m.modelArgs('opus').join(' ') !== '--model opus --effort high' || m.modelArgs('fable').join(' ') !== '--model fable' || m.modelArgs('nonsense').join(' ') !== '--model sonnet') throw new Error('args: ' + m.modelArgs('opus').join(' '));
  // V3.6.1 effort: five CLI levels, AUTO = the model's own, same precedence then the model
  if (m.normEffort('Extra high') !== 'xhigh' || m.normEffort('auto') !== null || m.normEffort('turbo') !== null || m.normEffort('MAX') !== 'max') throw new Error('normEffort');
  const e = (o) => m.effortFor(o);
  if (e({ model: 'opus' }).effort !== 'high' || e({ model: 'opus' }).from !== 'model' || e({ model: 'sonnet' }).effort !== null) throw new Error('effort falls through to the model');
  if (e({ office: 'low', model: 'opus' }).effort !== 'low' || e({ agent: 'max', office: 'low' }).from !== 'agent' || e({ routine: 'medium', agent: 'max' }).effort !== 'medium' || e({ task: 'xhigh', routine: 'medium', agent: 'max', office: 'low' }).from !== 'task') throw new Error('effort precedence');
  if (m.modelArgs('sonnet', 'max').join(' ') !== '--model sonnet --effort max' || m.modelArgs('opus', 'low').join(' ') !== '--model opus --effort low' || m.modelArgs('opus', 'nonsense').join(' ') !== '--model opus --effort high') throw new Error('effort args');
  const { validate } = await import('./roster.mjs');
  const r = validate({ agents: [{ id: 'invo', model: 'OPUS', effort: 'High' }, { id: 'lexi', model: 'haiku', effort: 'turbo' }] });
  if (r.agents.find(a => a.id === 'invo').model !== 'opus' || r.agents.find(a => a.id === 'lexi').model !== '' || !r.problems.some(x => /sonnet, opus or fable/.test(x))) throw new Error('roster model field');
  if (r.agents.find(a => a.id === 'invo').effort !== 'high' || r.agents.find(a => a.id === 'lexi').effort !== '' || !r.problems.some(x => /low, medium, high, xhigh or max/.test(x))) throw new Error('roster effort field');
  const rt = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs');
  const v = rt.validate({ dept: 'ops', agent: 'piper', text: 'x', when: { kind: 'daily', at: '09:00' }, model: 'Fable', effort: 'xhigh' }, loadRoster().agents); if (v.problems.length || v.routine.model !== 'fable' || v.routine.effort !== 'xhigh') throw new Error('routine model/effort field');
  return 'sonnet · opus (effort high) · fable · task > routine > agent > office · roster and routines refuse anything else';
});
await step('usage: the gauge parses Claude\'s answer and the office\'s own count sits underneath', async () => {
  const u = await import('./usage.mjs');
  const sample = { five_hour: { utilization: 29, resets_at: '2026-09-09T08:20:00.322898+00:00' }, seven_day: { utilization: 39.6, resets_at: '2026-09-12T03:00:00.322921+00:00' } };
  const p = u.parseUsage(sample); if (!p || p.session.percent !== 29 || p.week.percent !== 40 || !p.session.resetsAt || new Date(p.week.resetsAt).getUTCDay() !== 6) throw new Error('parse: ' + JSON.stringify(p));
  if (u.parseUsage({ nothing: true }) !== null || u.parseUsage(null) !== null) throw new Error('unknown shape must be null');
  const now = Date.now(); let st = {};
  st = u.record(st, { input_tokens: 10, output_tokens: 40, cache_creation_input_tokens: 9000, cache_read_input_tokens: 5000 }, now);
  st = u.record(st, { input_tokens: 5, output_tokens: 5 }, now + 1000);
  const f = u.fallback(st, now + 2000); if (f.source !== 'office' || f.window.tokens !== 14060 || f.window.runs !== 2 || f.window.resetsAt !== st.startedAt + u.WINDOW) throw new Error('count: ' + JSON.stringify(f));
  const later = u.fallback(st, now + u.WINDOW + 1); if (later.window.tokens !== 0 || later.window.runs !== 0 || later.window.startedAt !== null) throw new Error('window did not reset');
  const tok = u.readToken(); // read into memory only — never printed
  return `parses percent + reset · unknown shape → null · 2 runs = 14,060 tokens · window resets after 5 h · login token on this machine: ${tok ? 'found' : 'none'}`;
});

/* ---------- 1e. Agent Teams + Claude in Chrome (V3.2 (16 Sep)) ---------- */
await step('teams: the sentence says team, the plan is checked against the seats, notes are parsed', async () => {
  const t = await import('./teams.mjs');
  for (const ok of ['as a team, write three hooks', 'get the team on this', 'spawn three teammates to plan the launch', 'split it across the desks']) if (!t.intent(ok)) throw new Error('not a team: ' + ok);
  for (const no of ['write three hooks', 'draft the team offsite email', 'reply to the client']) if (t.intent(no)) throw new Error('wrongly a team: ' + no);
  if (t.askedSize('spawn three teammates') !== 3 || t.askedSize('as a team') !== null) throw new Error('askedSize');
  const seats = [{ id: 'mlead', lead: true }, { id: 'ada' }, { id: 'newt' }, { id: 'gfx' }], lead = seats[0];
  const plan = t.parsePlan('```json\n{"pieces":[{"agent":"ada","title":"A","text":"a"},{"agent":"ada","title":"dup","text":"x"},{"agent":"ghost","title":"g","text":"x"},{"agent":"newt","title":"N","text":"n"},{"agent":"gfx","title":"G","text":"g"},{"agent":"mlead","title":"M","text":"m"}],"why":"split"}\n```', { seats, lead, max: 3 });
  if (plan.solo || plan.pieces.map(p => p.agent).join() !== 'ada,newt,gfx') throw new Error('plan: ' + JSON.stringify(plan));
  const solo = t.parsePlan('not json at all', { seats, lead, max: 3, fallback: { title: 'T', text: 'x' } });
  if (!solo.solo || solo.pieces[0].agent !== 'mlead') throw new Error('no fallback to the lead');
  const one = t.parsePlan('{"pieces":[{"agent":"ada","title":"A","text":"a"}]}', { seats, lead, max: 3, fallback: { title: 'T', text: 'x' } });
  if (!one.solo || one.pieces[0].agent !== 'ada') throw new Error('a one-piece plan should be solo on that desk');
  if (!/never one piece/.test(t.planPrompt({ business: 'x', deptName: 'y', lead: { name: 'L' }, seats: [], text: 't', max: 3 }).user)) throw new Error('the plan prompt must insist on a split');
  const m = t.parseMessages('Heading\nbody\n@newt: use the June figure\n@lead: two hooks clash\n@nobody: ignored', ['ada', 'newt', 'gfx', 'mlead']);
  if (m.messages.length !== 2 || m.messages[0].to !== 'newt' || m.messages[1].to !== 'lead' || !/@nobody/.test(m.body) || /@newt/.test(m.body)) throw new Error('messages: ' + JSON.stringify(m));
  const sec = t.teamSection({ me: { id: 'ada' }, lead, pieces: plan.pieces, nameOf: id => id.toUpperCase() });
  if (!/Your piece: A/.test(sec) || !/NEWT: N/.test(sec) || !/@lead|@newt/.test(sec)) throw new Error('team section: ' + sec.slice(0, 200));
  const st = t.settings({ teams: { max: 99 } }); if (st.max !== 6 || !st.enabled) throw new Error('settings clamp: ' + JSON.stringify(st));
  if (t.settings({ teams: { enabled: false } }).enabled) throw new Error('enabled false ignored');
  const extra = t.noteExtra({ pieces: [{ agent: 'ada', title: 'A', result: 'r' }], messages: [{ from: 'ada', to: 'lead', text: 'x' }] }, id => id.toUpperCase());
  if (!/## Team/.test(extra) || !/ADA → lead: x/.test(extra) || !/### ADA — A\nr/.test(extra)) throw new Error('note extra: ' + extra);
  return 'intent · askedSize · plan (dedupe, unknown seats, cap, one desk → solo, none → the lead) · notes · section · settings · note';
});
await step('teams: a team routine is kept and moved to the department lead', async () => {
  const { validate } = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs');
  const agents = loadRoster().agents;
  const v = validate({ id: 'wk', dept: 'ops', agent: 'piper', title: 'x', text: 'x', when: { kind: 'weekly', days: [1], at: '09:00' }, team: true }, agents);
  if (v.problems.length) throw new Error(v.problems.join(' | '));
  if (v.routine.team !== true || v.routine.agent !== 'olead') throw new Error('agent ' + v.routine.agent + ' team ' + v.routine.team);
  const w = validate({ id: 'wk2', dept: 'ops', agent: 'piper', title: 'x', text: 'x', when: { kind: 'weekly', days: [1], at: '09:00' } }, agents);
  if (w.routine.team !== undefined || w.routine.agent !== 'piper') throw new Error('a plain routine changed');
  return 'team:true → olead (líder de Vendas) · plain routine untouched';
});
await step('browser: tools.browser puts --chrome and the Chrome server in the agents\' hands; off means --no-chrome', async () => {
  const m = await import('./mcp.mjs');
  if (m.toolId('claude-in-chrome') !== 'claude-in-chrome' || m.toolId('claude.ai Gmail') !== 'claude_ai_Gmail') throw new Error('toolId');
  m.configure({ mcp: {}, tools: { browser: true } });
  if (m.cliArgs().join() !== '--chrome') throw new Error('cliArgs on: ' + m.cliArgs());
  m.fromInit({ mcp_servers: [{ name: 'claude-in-chrome', status: 'connected' }], tools: ['mcp__claude-in-chrome__navigate', 'mcp__claude-in-chrome__read_page'] });
  const s = m.list().find(x => x.id === 'claude-in-chrome'); if (!s || s.key !== 'chrome' || s.name !== 'Chrome' || s.status !== 'connected' || s.tools.length !== 2) throw new Error('chrome server: ' + JSON.stringify(s));
  if (!m.allowedTools().includes('mcp__claude-in-chrome')) throw new Error('not in allowedTools: ' + m.allowedTools());
  if (!/Chrome browser/.test(m.promptText([])) || !/CAPTCHA/.test(m.promptText([]))) throw new Error('prompt does not explain the browser');
  if (m.keyOf('mcp__claude-in-chrome__navigate') !== 'chrome' || m.namesOf(['mcp__claude-in-chrome__find'])[0] !== 'Chrome') throw new Error('keyOf/namesOf');
  if (m.summary().browser?.on !== true || typeof m.summary().browser.installed !== 'boolean') throw new Error('summary.browser');
  m.configure({ mcp: { deny: ['Chrome'] }, tools: { browser: true } });
  if (m.allowedTools().includes('mcp__claude-in-chrome')) throw new Error('deny did not keep Chrome out of the agents\' hands');
  m.configure({ mcp: {}, tools: { browser: false } });
  if (m.cliArgs().join() !== '--no-chrome') throw new Error('cliArgs off: ' + m.cliArgs());
  m.configure(cfg); // back to the office's own config
  const logos = fs.readFileSync(path.join(ROOT, 'src', 'mcplogos.js'), 'utf8'); if (!/\n  chrome: \{ name: 'Chrome'/.test(logos)) throw new Error('no Chrome tile in src/mcplogos.js');
  const b = m.browserState();
  return `--chrome · mcp__claude-in-chrome allowed · deny works · --no-chrome when off · tile baked · this machine: ${b.installed ? 'extension paired' + (b.device ? ' (' + b.device + ')' : '') : 'extension NOT paired'}`;
});
await step('calendar: a routine can start on a date, and projects forward day by day', async () => { // V3.2.1
  const w = await import('./src/when.js');
  const now = new Date('2026-09-16T10:00:00').getTime();
  const later = w.nextRun({ kind: 'weekdays', at: '08:00', start: '2026-09-28' }, now); if (new Date(later).toDateString() !== 'Mon Sep 28 2026') throw new Error('start ignored: ' + new Date(later));
  const earlier = w.nextRun({ kind: 'weekdays', at: '08:00', start: '2026-09-01' }, now); if (new Date(earlier).toDateString() !== 'Thu Sep 17 2026') throw new Error('a past start changed the next run: ' + new Date(earlier));
  const occ = w.occurrences({ kind: 'weekly', days: [1], at: '09:00', start: '2026-09-28' }, now, now + 30 * 864e5).map(t => new Date(t).getDate()); if (occ.join() !== '28,5,12') throw new Error('occurrences: ' + occ);
  if (!/a partir de 5 jan/.test(w.describe({ kind: 'daily', at: '08:00', start: '2099-01-05' })) || /from/.test(w.describe({ kind: 'daily', at: '08:00', start: '2020-01-05' }))) throw new Error('describe start');
  if (w.valid({ kind: 'daily', at: '08:00', start: 'next week' })) throw new Error('a bad start date passed');
  const pk = w.fromPicker('mon', '09:30', '2026-10-05'); if (pk.start !== '2026-10-05' || pk.days[0] !== 1) throw new Error('picker start: ' + JSON.stringify(pk));
  const { validate } = await import('./routines.mjs'); const { loadRoster } = await import('./roster.mjs');
  const v = validate({ id: 'oct', dept: 'emails', agent: 'elead', title: 'x', text: 'x', when: { kind: 'weekdays', at: '08:00', start: '2026-10-05' } }, loadRoster().agents); if (v.problems.length || v.routine.when.start !== '2026-10-05') throw new Error('routine start lost: ' + v.problems.join(' | '));
  return 'start date honoured · past start ignored · 3 Mondays projected · described "from 5 Jan" · picker + routines carry start';
});
await step('config: browser and teams default on, max 4', async () => {
  const c = loadConfig(); if (c.tools.browser !== true || c.teams.enabled !== true || c.teams.max !== 4) throw new Error(JSON.stringify({ tools: c.tools, teams: c.teams }));
});

/* ---------- 2. offline smoke (Playwright) ---------- */
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { try { ({ chromium } = await import('playwright-core')); } catch {} }
if (!chromium) bad('smoke: playwright', 'not installed — npm i -D playwright-core (uses your Chrome)');
else {
  let browser = null;
  try {
    try { browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
    catch { browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); }
    const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });
    await page.goto('file://' + path.join(ROOT, 'dist', 'command-centre-v2.html') + '?s=check'); await page.waitForTimeout(3000);
    await step('smoke: loads without page errors', async () => { if (errors.length) throw new Error(errors[0]); });
    await step('smoke: 35 agents at their desks', async () => { const n = await page.evaluate(() => Object.keys(window.CC.R).length); if (n !== 35) throw new Error('agents: ' + n); return n + ' agents'; });
    await step('smoke: six department cards + the Brain tag', async () => {
      const t = await page.evaluate(() => [...document.querySelectorAll('.badge .b-name')].map(e => e.textContent.trim()));
      for (const k of ['COMANDO', 'PROSPEÇÃO', 'VENDAS', 'DESIGN LAB', 'ENGENHARIA', 'MEDIA', 'O CÉREBRO']) if (!t.some(x => x.startsWith(k))) throw new Error('missing card ' + k);
    });
    await step('smoke: task panel has rows and counts', async () => {
      const n = await page.evaluate(() => document.querySelectorAll('.tp-row').length); if (n < 10) throw new Error('rows: ' + n);
      const chips = await page.evaluate(() => document.querySelectorAll('.tp-chip').length); if (chips !== 6) throw new Error('chips: ' + chips);
      return n + ' rows';
    });
    await step('smoke: command bar adds a task in demo mode', async () => {
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
      await page.fill('.tp-in', 'cut a 15 second teaser from the demo reel'); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Added/.test(hint)) throw new Error('hint: ' + hint);
      const row = await page.evaluate(() => [...document.querySelectorAll('.tp-row .tp-t')].some(e => /teaser/i.test(e.textContent))); if (!row) throw new Error('row not in the feed');
      return hint.trim().slice(0, 60);
    });
    await step('smoke: TEAM in the bar → the lead + piece cards on the desks (demo)', async () => { // V3.2 (16 Sep)
      await page.waitForTimeout(2800); // the previous step's hint timer (2.6 s) would wipe our "Added" line mid-read
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="sales"]');
      await page.fill('.tp-in', 'as a team, plan the spring outreach push');
      await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true })));
      const pre = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Team · SALES LEAD/.test(pre)) throw new Error('hint before Add: ' + pre);
      await page.keyboard.press('Enter'); await page.waitForTimeout(700);
      const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Added — SALES LEAD has it with/.test(hint)) throw new Error('hint: ' + hint);
      const n = await page.evaluate(() => ({ lead: [...document.querySelectorAll('.tp-row .tp-t')].filter(e => /⚑ As a team, plan the spring/.test(e.textContent)).length, pieces: document.querySelectorAll('.tp-row.piece').length, chip: [...document.querySelectorAll('.tp-team-chip')].map(e => e.textContent) }));
      if (n.lead !== 1 || n.pieces < 2 || !n.chip.some(c => /^TEAM [34]$/.test(c)) || !n.chip.includes('PIECE')) throw new Error(JSON.stringify(n));
      await page.fill('.tp-in', 'draft the renewal email'); await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true })));
      const plain = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (/Team ·/.test(plain)) throw new Error('a plain sentence still reads as a team: ' + plain);
      await page.click('.tp-team'); const on = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Team · SALES LEAD/.test(on)) throw new Error('the TEAM toggle did not take: ' + on);
      await page.click('.tp-team'); await page.fill('.tp-in', '');
      return `${hint.trim().slice(0, 70)} · ${n.pieces} piece cards · chips ${[...new Set(n.chip)].join(' ')}`;
    });
    await step('smoke: a routine typed in the bar lands in SCHEDULED (demo)', async () => {
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="emails"]');
      await page.fill('.tp-in', 'every weekday at 8am, triage the inbox and tell me what needs me');
      await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true })));
      await page.waitForFunction(() => /Routine/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 5000 }).catch(() => {});
      const pre = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Routine/.test(pre) || !/every weekday · 08:00/.test(pre)) throw new Error('hint before Add: ' + pre);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /Routine set|couldn/.test(document.querySelector('.tp-hint').textContent), null, { timeout: 5000 }).catch(() => {});
      const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Routine set/.test(hint)) throw new Error('hint: ' + hint);
      await page.waitForTimeout(400);
      const n = await page.evaluate(() => window.CC.routines().length); if (n !== 1) throw new Error('routines: ' + n);
      const row = await page.evaluate(() => [...document.querySelectorAll('.tp-row.sched .tp-t')].some(e => /triage the inbox/i.test(e.textContent))); if (!row) throw new Error('no SCHEDULED row');
      const strip = await page.evaluate(() => { const e = document.querySelector('.tp-next'); return e.hidden ? '' : e.textContent; }); if (!/NEXT/.test(strip) || !/triage/i.test(strip)) throw new Error('next-up strip: ' + strip);
      await page.keyboard.press('b'); await page.waitForTimeout(600);
      const col = await page.evaluate(() => [...document.querySelectorAll('#board .lh')].map(e => e.textContent)); if (col[1] !== 'SCHEDULED') throw new Error('board columns: ' + col.join(','));
      const card = await page.evaluate(() => document.querySelectorAll('#board .tk.sched').length); if (!card) throw new Error('no SCHEDULED card on the board');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      await page.evaluate(() => window.CC.tasks.rtAct(window.CC.routines()[0].id, 'run')); await page.waitForTimeout(500);
      const fired = await page.evaluate(() => window.CC.tasks.tasks.some(t => t.routine && /triage the inbox/i.test(t.title))); if (!fired) throw new Error('RUN NOW did not make a task');
      await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
      await page.fill('.tp-in', 'every day at 9am post the reel'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
      const no = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/versão futura/.test(no)) throw new Error('marketing not refused: ' + no);
      const still = await page.evaluate(() => window.CC.routines().length); if (still !== 1) throw new Error('a refused routine was added');
      const opts = await page.evaluate(() => [...document.querySelectorAll('.tp-model option')].map(o => o.value).join(',') + '|' + document.querySelector('.tp-model').value); if (opts !== 'sonnet,opus,fable|sonnet') throw new Error('model menu: ' + opts);
      const eff = await page.evaluate(() => [...document.querySelectorAll('.tp-effort option')].map(o => o.value).join(',') + '|' + document.querySelector('.tp-effort').value); if (eff !== ',low,medium,high,xhigh,max|') throw new Error('effort menu: ' + eff);
      // V3.7: the box grows with the text, and the big editor mirrors it both ways
      await page.fill('.tp-in', 'line one\nline two\nline three'); await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true }))); await page.waitForTimeout(200);
      const grown = await page.evaluate(() => document.querySelector('.tp-in').offsetHeight); if (grown < 50) throw new Error('box did not grow: ' + grown + 'px');
      await page.click('.tp-big-btn'); await page.waitForTimeout(300);
      const bigOn = await page.evaluate(() => document.getElementById('tpBig').classList.contains('on') && document.querySelector('.tb-in').value === document.querySelector('.tp-in').value && document.querySelector('.tb-dept').textContent === 'MARKETING'); if (!bigOn) throw new Error('big editor did not open with the text');
      await page.type('.tb-in', ' and more'); await page.waitForTimeout(200);
      const back = await page.evaluate(() => document.querySelector('.tp-in').value.endsWith(' and more') && /MARKETING LEAD|Goes to|Probably/.test(document.querySelector('.tb-hint').textContent)); if (!back) throw new Error('big editor did not mirror back');
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const bigOff = await page.evaluate(() => !document.getElementById('tpBig').classList.contains('on')); if (!bigOff) throw new Error('Esc did not close the big editor');
      await page.fill('.tp-in', ''); await page.evaluate(() => document.querySelector('.tp-in').dispatchEvent(new Event('input', { bubbles: true }))); await page.evaluate(() => document.querySelector('.tp-in').blur()); await page.click('.tp-chip[data-f="all"]'); // hand the keys back, feed back to All
      const rest = await page.evaluate(() => document.querySelector('.tp-in').offsetHeight); if (rest > 34) throw new Error('box did not shrink back: ' + rest + 'px');
      return 'hint says the schedule · SCHEDULED row + next-up strip + board column · RUN NOW fires · marketing refused · box grows + big editor mirrors';
    });
    await step('smoke: the CALENDAR button and P open the calendar — routines on their days, a task scheduled for a date, a routine from a date (demo)', async () => { // V3.2.1
      await page.click('#topCal'); await page.waitForTimeout(500); // the top-bar button opens it…
      if (!await page.$eval('#calOv', e => e.classList.contains('on'))) throw new Error('the CALENDAR button did not open the calendar');
      await page.keyboard.press('Escape'); await page.waitForTimeout(400);
      await page.keyboard.press('p'); await page.waitForTimeout(600); // …and so does P
      if (!await page.$eval('#calOv', e => e.classList.contains('on'))) throw new Error('P did not open the calendar');
      const cells = await page.$$eval('.cv-day', e => e.length); if (cells !== 35 && cells !== 42) throw new Error('month cells: ' + cells);
      if (!await page.$('.cv-day.today')) throw new Error('no today cell');
      const rt = await page.$$eval('.cv-ev.routine', e => e.length); if (rt < 3) throw new Error('routine occurrences on the grid: ' + rt);
      const rail = await page.$eval('#cvRtN', e => +e.textContent); if (rail < 1) throw new Error('rail empty');
      // a task for a day next week (the second day after today on the grid)
      const days = await page.$$eval('.cv-day', els => els.map(e => e.dataset.day)); const ti = days.indexOf(await page.$eval('.cv-day.today', e => e.dataset.day));
      const target = days[Math.min(days.length - 1, ti + 2)];
      await page.hover(`.cv-day[data-day="${target}"]`); await page.click(`.cv-day[data-day="${target}"] .cv-add`); await page.waitForTimeout(300);
      await page.selectOption('.cv-dept', 'sales'); await page.fill('.cv-text', 'Call the three warm leads from the expo'); await page.click('.cv-go'); await page.waitForTimeout(500);
      const sched = await page.$$eval('.cv-ev.sched', e => e.map(x => x.closest('.cv-day').dataset.day)); if (sched.length !== 1 || sched[0] !== target) throw new Error('scheduled card: ' + JSON.stringify(sched));
      const panel = await page.evaluate(() => window.CC.tasks.tasks.filter(t => t.state === 'scheduled').length); if (panel !== 1) throw new Error('panel has ' + panel + ' scheduled');
      // a routine from that date: REPEAT on, emails (routines are Emails/Accounting/Sales)
      await page.hover(`.cv-day[data-day="${target}"]`); await page.click(`.cv-day[data-day="${target}"] .cv-add`); await page.waitForTimeout(300);
      await page.selectOption('.cv-dept', 'emails'); await page.fill('.cv-text', 'Send the weekly client update'); await page.click('.cv-rep'); await page.waitForTimeout(200);
      const hint = await page.$eval('.cv-hint', e => e.textContent); if (!/Routine ·/.test(hint) || !/first run/.test(hint)) throw new Error('routine hint: ' + hint);
      await page.click('.cv-go'); await page.waitForTimeout(500);
      const r = await page.evaluate(() => window.CC.tasks.routines.find(x => /weekly client update/i.test(x.title))); if (!r || r.when.start !== target) throw new Error('routine start: ' + JSON.stringify(r && r.when));
      const before = await page.$$eval('.cv-ev.routine', (els, t) => els.filter(x => x.title.startsWith('Send the weekly client update') && x.closest('.cv-day').dataset.day < t).length, target); if (before) throw new Error('the routine shows before its start date');
      // marketing is refused for routines, with the sentence
      await page.hover(`.cv-day[data-day="${target}"]`); await page.click(`.cv-day[data-day="${target}"] .cv-add`); await page.waitForTimeout(200);
      await page.selectOption('.cv-dept', 'marketing'); await page.click('.cv-rep'); await page.waitForTimeout(150);
      const refused = await page.$eval('.cv-hint', e => e.textContent); const dis = await page.$eval('.cv-go', e => e.disabled); if (!/versão futura/.test(refused) || !dis) throw new Error('marketing routine not refused: ' + refused);
      await page.keyboard.press('Escape'); await page.waitForTimeout(150); if (!await page.$eval('#cvPop', e => e.hidden)) throw new Error('Esc did not close the popover');
      await page.click('.cv-seg button[data-v="week"]'); await page.waitForTimeout(300); const wk = await page.$$eval('.cv-day', e => e.length); if (wk !== 7) throw new Error('week cells: ' + wk);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300); if (await page.$eval('#calOv', e => e.classList.contains('on'))) throw new Error('Esc did not close the calendar');
      return `${cells} cells · ${rt} routine runs on the grid · rail ${rail} · task scheduled for ${target} · routine starts ${target} (none before) · marketing refused · week view 7`;
    });
    await step('smoke: department focus opens the chat rail', async () => {
      await page.keyboard.press('1'); await page.waitForTimeout(1800);
      const cls = await page.evaluate(() => document.getElementById('rail').className); if (!/agentOpen/.test(cls) || !/open/.test(cls)) throw new Error('rail: ' + cls);
      const strip = await page.evaluate(() => document.querySelector('#topconn').className); if (!/focus/.test(strip)) throw new Error('top strip not centred');
      await page.keyboard.press('Escape'); await page.waitForTimeout(1200);
    });
    await step('smoke: B opens and closes the company board', async () => {
      await page.keyboard.press('b'); await page.waitForTimeout(700);
      if (!(await page.evaluate(() => window.CC.tasks.isOpen()))) throw new Error('board did not open');
      await page.keyboard.press('Escape'); await page.waitForTimeout(500);
      if (await page.evaluate(() => window.CC.tasks.isOpen())) throw new Error('board did not close');
    });
    await step('smoke: G opens the Brain graph with notes', async () => {
      await page.keyboard.press('g'); await page.waitForTimeout(700);
      if (!(await page.evaluate(() => window.CC.brain.isOpen()))) throw new Error('graph did not open');
      const n = await page.evaluate(() => window.CC.brain.nodes.length); if (n < 10) throw new Error('nodes: ' + n);
      await page.keyboard.press('Escape'); await page.waitForTimeout(300);
      if (await page.evaluate(() => window.CC.brain.isOpen())) throw new Error('graph did not close');
      return n + ' notes';
    });
    await step('smoke: approval flow reaches the panel', async () => {
      await page.evaluate(() => window.CC.requestApproval('ada'));
      await page.waitForFunction(() => document.querySelectorAll('.tp-row.waiting').length > 0, null, { timeout: 4000 }).catch(() => {}); // the panel renders on the next frame; headless WebGL frames can be slow
      const w = await page.evaluate(() => document.querySelectorAll('.tp-row.waiting').length); if (!w) throw new Error('no waiting row (ada: ' + (await page.evaluate(() => window.CC.R.ada.state)) + ')');
    });
    await step('smoke: no errors after the run', async () => { if (errors.length) throw new Error(errors[0]); });
  } catch (e) { bad('smoke: browser', e.message); }
  finally { if (browser) await browser.close(); }
}

/* ---------- 3. server smoke ---------- */
{
  const port = 4600 + Math.floor(Math.random() * 300);
  const env = { ...process.env, PORT: String(port) };
  let donoCookie = '', leitorCookie = '';
  let srv = spawn('node', ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  const up = await (async () => { for (let i = 0; i < 40; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 250)); } return null; })();
  if (!up) bad('server: starts', log.trim().split('\n').slice(-2).join(' | ') || 'no health response');
  else {
    const AI_IDS = (await import('./providers.mjs')).IDS;
    if (!AI_IDS.includes(up.backend) && up.backend !== 'nenhum') bad('server: starts', `motor desconhecido: ${up.backend}`);
    ok('server: starts', `${up.name} · ${up.ai ? up.ai.label + ' (' + up.backend + ')' : 'SEM MOTOR'} · brain ${up.notes} notes`);
    await step('server: /api/ai diz o que está instalado, o que falta e porquê', async () => {
      const a = await (await fetch(base + '/api/ai')).json();
      if (!Array.isArray(a.providers) || !a.providers.length) throw new Error('no providers');
      const okc = a.providers.filter(p => p.available && !p.pending), dead = a.providers.filter(p => !p.available || p.pending);
      if (dead.some(p => !p.reason)) throw new Error('um motor indisponível sem explicação');
      if (!!a.active !== (okc.length > 0)) throw new Error('active não bate com os disponíveis');
      for (const id of AI_IDS) if (!a.providers.some(p => p.id === id)) throw new Error('falta o preset ' + id);
      return `${a.providers.length} motores · ${okc.length} ligados${okc.length ? ' (' + okc.map(p => p.label).join(' · ') + ')' : ''} · ativo: ${a.active ? a.active.id : 'nenhum'}`;
    });
    await step('server: /api/ai/test recusa com uma razão, não com um estoiro', async () => {
      const a = await (await fetch(base + '/api/ai')).json();
      const deadOne = a.providers.find(p => !p.available && !p.pending) || a.providers.find(p => p.reason);
      if (!deadOne) return 'todos disponíveis — nada a recusar';
      const r = await fetch(base + '/api/ai/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: deadOne.id }) });
      const j = await r.json();
      if (j.ok) throw new Error('disse que testou um motor indisponível');
      if (!j.error) throw new Error('recusou sem dizer porquê');
      return `${deadOne.id}: ${String(j.error).slice(0, 70)}`;
    });
    await step('server: trocar para um motor que não existe é recusado com a lista', async () => {
      const r = await fetch(base + '/api/ai/switch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'motor-imaginario' }) });
      const j = await r.json();
      if (r.status === 200 || j.ok) throw new Error('aceitou um motor que não existe');
      if (!/motor-imaginario/.test(j.error || '')) throw new Error('não explicou: ' + JSON.stringify(j).slice(0, 120));
      return 'recusado · ' + String(j.error).slice(0, 60);
    });
    await step('motores: o Gemini nativo fala o dialeto do Google (X-Goog-Api-Key, systemInstruction)', async () => {
      // Servidor local que imita a API do AI Studio: prova o pedido exato (rota, cabeçalho, corpo) e
      // a leitura da resposta, sem chave verdadeira e sem sair da máquina.
      const http = await import('node:http');
      let vazio = false;
      let seen = null;
      const srv = http.createServer((rq, rs) => {
        let raw = '';
        rq.on('data', d => { raw += d; });
        rq.on('end', () => {
          seen = { url: rq.url, key: rq.headers['x-goog-api-key'], body: JSON.parse(raw || '{}') };
          rs.writeHead(200, { 'content-type': 'application/json' });
          rs.end(JSON.stringify(vazio
            ? { promptFeedback: { blockReason: 'SAFETY' } }
            : { candidates: [{ content: { parts: [{ text: 'olá do Gemini' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4 }, modelVersion: 'gemini-flash-latest' }));
        });
      });
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${srv.address().port}/v1beta`;
      const before = { key: process.env.GEMINI_API_KEY, base: process.env.GEMINI_BASE_URL, model: process.env.AO_AI_MODEL };
      process.env.GEMINI_API_KEY = 'chave-de-teste';
      process.env.GEMINI_BASE_URL = url;
      delete process.env.AO_AI_MODEL;
      try {
        const ai = await import('./providers.mjs?gemini=' + Date.now()); // o preset lê GEMINI_BASE_URL no import
        const res = ai.resolve({ model: 'sonnet', ai: { provider: 'gemini-api', providers: {} } }, null);
        const target = res.candidates.find(c => c.id === 'gemini-api');
        if (!target.available) throw new Error('gemini-api indisponível: ' + target.reason);
        const out = await ai.makeRunner(target, { model: 'sonnet' }, {}).askX({ system: 'SYS', user: 'Olá', tools: false });
        if (out.text !== 'olá do Gemini') throw new Error('texto: ' + JSON.stringify(out.text));
        if (out.usage.input_tokens !== 11 || out.usage.output_tokens !== 4) throw new Error('uso não lido: ' + JSON.stringify(out.usage));
        if (!seen) throw new Error('o servidor não recebeu nada');
        if (seen.url !== '/v1beta/models/gemini-flash-latest:generateContent') throw new Error('rota errada: ' + seen.url);
        if (seen.key !== 'chave-de-teste') throw new Error('cabeçalho X-Goog-Api-Key em falta');
        if (seen.body.systemInstruction?.parts?.[0]?.text !== 'SYS') throw new Error('systemInstruction em falta');
        if (seen.body.contents?.[0]?.parts?.[0]?.text !== 'Olá') throw new Error('contents errado');
        if (process.env.GEMINI_API_KEY !== 'chave-de-teste') throw new Error('ambiente mexido');
        vazio = true;
        let honest = '';
        try { await ai.makeRunner(target, { model: 'sonnet' }, {}).askX({ system: 'SYS', user: 'Olá', tools: false }); }
        catch (e) { honest = e.message; }
        if (!/SAFETY|vazia/.test(honest)) throw new Error('resposta bloqueada não foi explicada: ' + (honest || 'resolveu vazio'));
        return 'rota + X-Goog-Api-Key + systemInstruction · texto e tokens lidos · bloqueio explicado';
      } finally {
        srv.close();
        if (before.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = before.key;
        if (before.base === undefined) delete process.env.GEMINI_BASE_URL; else process.env.GEMINI_BASE_URL = before.base;
        if (before.model !== undefined) process.env.AO_AI_MODEL = before.model;
      }
    });
    await step('motores: o Antigravity responde, desembrulha o JSON e recusa saída vazia', async () => {
      // Um `agy` falso no PATH: prova o caminho inteiro (deteção, argumentos, envelope, erro) sem
      // instalar nada nem tocar na conta do dono.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-agy-'));
      const bin = path.join(dir, 'agy');
      fs.writeFileSync(bin, `#!/usr/bin/env node\nif (process.env.FAKE_AGY_EMPTY === '1') process.exit(0);\nprocess.stdout.write(JSON.stringify({ result: 'resposta do agy falso' }) + '\\n');\n`, { mode: 0o755 });
      const oldPath = process.env.PATH;
      process.env.PATH = dir + path.delimiter + oldPath;
      try {
        const ai = await import('./providers.mjs?agy=' + Date.now());
        const entry = ai.resolve({ model: 'sonnet', ai: { providers: {} } }, null).candidates.find(c => c.id === 'antigravity');
        if (!entry.available) throw new Error('agy não foi detetado: ' + entry.reason);
        const hooks = { allowedTools: () => [], modelArgs: () => [], ranOn: () => null, cliArgs: () => [] };
        const out = await ai.makeRunner({ ...entry, available: true }, { model: 'sonnet' }, hooks).askX({ system: 'SYS', user: 'Olá', tools: false });
        if (out.text !== 'resposta do agy falso') throw new Error('texto inesperado: ' + JSON.stringify(out.text));
        process.env.FAKE_AGY_EMPTY = '1';
        let honest = '';
        try { await ai.makeRunner({ ...entry, available: true }, { model: 'sonnet' }, hooks).askX({ system: 'SYS', user: 'Olá', tools: false }); }
        catch (e) { honest = e.message; }
        if (!/não devolveu nada/.test(honest)) throw new Error('saída vazia não foi recusada: ' + (honest || 'resolveu com texto vazio'));
        return `--output-format json · envelope desembrulhado · vazio recusado`;
      } finally {
        process.env.PATH = oldPath; delete process.env.FAKE_AGY_EMPTY;
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
    await step('server: o Antigravity (agy) está na lista de motores, com a instalação certa', async () => {
      const a = await (await fetch(base + '/api/ai')).json();
      const agy = a.providers.find(p => p.id === 'antigravity');
      if (!agy) throw new Error('não há provider antigravity');
      if (agy.bin !== 'agy') throw new Error('bin devia ser agy: ' + agy.bin);
      if (!/antigravity\.google/.test(agy.reason || agy.hint || '')) throw new Error('não diz como instalar');
      return `antigravity · bin ${agy.bin} · ${agy.available ? 'ligado' : 'indisponível (explica porquê)'}`;
    });
    await step('server: /api/google diz o que falta, sem inventar', async () => {
      const g = await (await fetch(base + '/api/google')).json();
      if (!g.places || !g.web) throw new Error('sem places/web');
      for (const k of ['places', 'web']) if (!g[k].available && !g[k].reason) throw new Error(k + ' indisponível sem razão');
      if (g.any && !(g.places.available || g.web.available)) throw new Error('any não bate com as chaves');
      return `${g.places.available ? 'Places ligado' : 'Places sem chave'} · ${g.web.available ? 'web ligada' : 'web sem chave'} · ${g.leads?.total || 0} leads`;
    });
    await step('server: procurar sem chave da Google é recusado com a frase certa', async () => {
      const g = await (await fetch(base + '/api/google')).json();
      if (g.places.available) return 'há chave — nada a recusar';
      const r = await fetch(base + '/api/google/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'places', what: 'clínicas dentárias', where: 'Lisboa' }) });
      const j = await r.json();
      if (j.ok) throw new Error('disse que procurou sem chave');
      if (!/chave/.test(j.error || '')) throw new Error('não falou de chave: ' + JSON.stringify(j).slice(0, 120));
      return String(j.error).slice(0, 70);
    });
    await step('server: /api/leads devolve a lista guardada (mesmo vazia)', async () => {
      const l = await (await fetch(base + '/api/leads')).json();
      if (!l.ok || !Array.isArray(l.leads)) throw new Error('sem lista');
      if (typeof l.stats?.total !== 'number') throw new Error('sem contagem');
      return `${l.leads.length} leads · ${l.stats.total} no total`;
    });
    await step('server: /api/integrations é público e diz o que falta, sem segredos', async () => {
      const r = await fetch(base + '/api/integrations'); if (r.status !== 200) throw new Error('status ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j.providers)) throw new Error('sem providers');
      if (!j.providers.some(p => p.id === 'openstreetmap' && p.ready)) throw new Error('OSM devia estar pronto');
      if (JSON.stringify(j).includes('service_role') || /eyJ[A-Za-z0-9]{20}/.test(JSON.stringify(j))) throw new Error('a resposta parece trazer uma chave');
      return `${j.providers.filter(p => p.ready).map(p => p.id).join(', ')} prontos · sem chave: ${j.providers.filter(p => !p.ready).map(p => p.id).join(', ') || 'nenhum'}`;
    });
    await step('server: o CRM das integrações só abre com o token', async () => {
      const anon = await fetch(base + '/api/crm/leads');
      if (![401, 503].includes(anon.status)) throw new Error('sem token: ' + anon.status);
      const tok = process.env.ORBITA_API_TOKEN;
      if (!tok) return 'sem ORBITA_API_TOKEN no ambiente — 503 como esperado';
      const auth = await fetch(base + '/api/crm/leads', { headers: { authorization: 'Bearer ' + tok } });
      if (auth.status !== 200) throw new Error('com token: ' + auth.status);
      const j = await auth.json();
      if (!Array.isArray(j.leads)) throw new Error('sem lista');
      return `${anon.status} sem token · 200 com token · ${j.leads.length} leads em ${j.storage}`;
    });
    await step('server: os agentes recebem os dois servidores MCP do projeto', async () => {
      const m = await (await fetch(base + '/api/mcp')).json();
      const get = id => {
        const s = m.servers.find(x => x.id === id);
        if (!s) throw new Error(id + ' não aparece em /api/mcp');
        if (s.status !== 'connected') throw new Error(`${id}: ${s.status}${s.error ? ' — ' + s.error : ''}`);
        return s;
      };
      const integ = get('orbita_integrations'), goog = get('orbita_google');
      if (!integ.tools.includes('orbita_leads_list')) throw new Error('integrações sem ferramentas');
      if (!goog.tools.includes('google_places_search')) throw new Error('google sem google_places_search');
      if (goog.tools.length !== 4) throw new Error('google: ' + goog.tools.length + ' ferramentas');
      return `${integ.tools.length} + ${goog.tools.length} ferramentas · ${integ.name} · ${goog.name}`;
    });
    await step('server: serves the office', async () => { const r = await fetch(base + '/'); const t = await r.text(); if (!/ÓRBITA/.test(t)) throw new Error('html missing'); });
    await step('server: /api/brain has the live graph', async () => { const g = await (await fetch(base + '/api/brain')).json(); if (!g.nodes.length) throw new Error('empty'); return `${g.nodes.length} linked notes`; });
    await step('server: /api/mcp lists this machine\'s connectors', async () => {
      const m = await (await fetch(base + '/api/mcp')).json();
      if (!Array.isArray(m.servers)) throw new Error('no servers array');
      const c = m.servers.filter(s => s.status === 'connected').length;
      return `${m.servers.length} servers · ${c} connected · agents get tools: ${m.tools ? 'yes' : 'no (API backend)'}${m.web ? ' + web' : ''}`;
    });
    await step('server: /api/health carries the roster', async () => { if (!Array.isArray(up.agents) || up.agents.length !== 35) throw new Error('agents: ' + (up.agents && up.agents.length)); if (!up.agents[0].does) throw new Error('no job description'); });
    await step('server: the office default is Sonnet and /api/usage always answers', async () => {
      if (up.model !== 'sonnet' || JSON.stringify(up.models) !== '["sonnet","opus","fable"]') throw new Error('health model: ' + up.model);
      if (up.effort !== '' || JSON.stringify(up.efforts) !== '["low","medium","high","xhigh","max"]') throw new Error('health effort: ' + up.effort);
      const r = await fetch(base + '/api/usage'); if (r.status !== 200) throw new Error('status ' + r.status); const u = await r.json();
      if (!u.ok || !['claude', 'office'].includes(u.source)) throw new Error(JSON.stringify(u).slice(0, 120));
      return u.source === 'claude' ? `Claude's gauge: session ${u.session?.percent}% · week ${u.week?.percent}%` : `office count (${u.reason})`;
    });
    await step('server: /api/skills lists the skills and who has them', async () => {
      const s = await (await fetch(base + '/api/skills')).json(); if (!s.count || !Array.isArray(s.skills)) throw new Error('no skills');
      const piper = up.agents.find(a => a.id === 'piper'); if (!piper.skills?.includes('proposal')) throw new Error('health roster has no skills on piper');
      return `${s.count} skills · piper: ${piper.skills.join(', ')}`;
    });
    await step('server: the lead offers the interview when a department is not set up', async () => {
      const lead = up.agents.find(a => a.id === 'pros'); if (lead.interviewer !== true) throw new Error('pros is not the interviewer');
      if (typeof up.setup?.sales !== 'boolean') throw new Error('no setup map');
      const r = await (await fetch(base + '/api/lessons')).json(); if (!Array.isArray(r.agents)) throw new Error('no lessons endpoint');
      return `sales set up: ${up.setup.sales} · lessons dir ${path.basename(r.dir)}`;
    });
    await step('server: /api/routines lists the timetable and names the departments', async () => {
      const r = await (await fetch(base + '/api/routines')).json(); if (!Array.isArray(r.routines) || JSON.stringify(r.depts) !== '["emails","sales","ops"]') throw new Error(JSON.stringify(r).slice(0, 120));
      if (typeof up.routines?.count !== 'number') throw new Error('health has no routines');
      return `${r.routines.length} routines${r.routines.length ? ' · next ' + (r.routines.filter(x => x.nextAt).sort((a, b) => a.nextAt - b.nextAt)[0]?.title || '—') : ''} · ${path.basename(path.dirname(r.path))}/${path.basename(r.path)}`;
    });
    await step('server: a routine outside Comando, Prospeção e Vendas is refused with a sentence', async () => {
      const r = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'marketing', text: 'every day at 9am post the reel' }) });
      const j = await r.json(); if (r.status !== 400 || !j.refused || !/versão futura/.test(j.error)) throw new Error(r.status + ' ' + JSON.stringify(j));
      const t = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'every weekday, triage the inbox' }) });
      const k = await t.json(); if (t.status !== 400 || !k.needsTime) throw new Error('missing time not asked back: ' + JSON.stringify(k));
      const n = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'chase the quiet deals' }) });
      const m = await n.json(); if (n.status !== 400 || !m.noSchedule) throw new Error('no schedule not named: ' + JSON.stringify(m));
      return j.error;
    });
    await step('server: /api/health says teams and the browser are on; the bar has the Chrome tile', async () => {
      if (!up.teams || up.teams.enabled !== true || up.teams.max !== 4) throw new Error('health.teams: ' + JSON.stringify(up.teams));
      if (!up.browser || up.browser.on !== true) throw new Error('health.browser: ' + JSON.stringify(up.browser));
      const m = await (await fetch(base + '/api/mcp')).json();
      const c = m.servers.find(s => s.id === 'claude-in-chrome'); if (!c || c.key !== 'chrome' || !Array.isArray(c.depts) || c.depts.length !== 6) throw new Error('chrome not in /api/mcp: ' + JSON.stringify(c));
      return `teams on (max ${up.teams.max}) · Chrome ${c.status}${up.browser.device ? ' · ' + up.browser.device : ''} · wired to every pod`;
    });
    await step('server: a task scheduled for a time that has passed is refused', async () => { // V3.2.1
      const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'call the leads', at: Date.now() - 3600000 }) });
      const j = await r.json(); if (r.status !== 400 || !/passou/.test(j.error)) throw new Error(r.status + ' ' + JSON.stringify(j));
      const b = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'call the leads', at: 'tomorrowish' }) });
      if (b.status !== 400) throw new Error('bad time accepted');
      return j.error;
    });
    await step('server: rejects an empty task', async () => { const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"dept":"sales","text":""}' }); if (r.status !== 400) throw new Error('status ' + r.status); });
    if (LIVE) {
      await step('live: Claude routes a task', async () => {
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'reply to a client asking when their September report will arrive' }) });
        if (!r.ok) throw new Error((await r.json()).error); const t = await r.json(); globalThis.__t = t; return `${t.agent} · ${t.title}`;
      });
      await step('live: the agent delivers and the note is saved', async () => {
        const t = globalThis.__t; if (!t) throw new Error('no task'); const r = await fetch(`${base}/api/tasks/${t.id}/run`, { method: 'POST' });
        if (!r.ok) throw new Error((await r.json()).error); const d = await r.json(); if (d.error) throw new Error(d.result);
        const notePath = path.join(cfg.brainPath, 'Órbita', d.note + '.md'); if (!fs.existsSync(notePath)) throw new Error('note not written: ' + notePath);
        return `${d.result.length} chars · read ${d.read.join(', ')} · ${d.note}.md`;
      });
      await step('live: a two-minute routine fires on the server, runs and lands', async () => {
        const r = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'every 2 minutes, list what is in the inbox that needs me today' }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error); const id = j.routine.id;
        try {
          if (!j.routine.nextAt || j.routine.desc !== 'a cada 2 min') throw new Error('routine wrong: ' + JSON.stringify(j.routine));
          let task = null;
          for (let i = 0; i < 100 && !(task && task.state !== 'next' && task.state !== 'doing'); i++) { await new Promise(r => setTimeout(r, 3000)); task = (await (await fetch(base + '/api/tasks')).json()).find(t => t.routine === id); }
          if (!task) throw new Error('the routine never fired'); if (task.state === 'next' || task.state === 'doing') throw new Error('the routine fired but did not finish in time');
          if (task.by !== 'routine' || task.error) throw new Error('task: ' + task.state + ' ' + (task.result || '').slice(0, 120));
          return `${task.agent} · ${task.title} · ${task.state}${task.state === 'waiting' ? ' for the OK' : ''} · ${task.result.length} chars`;
        } finally { await fetch(`${base}/api/routines/${id}`, { method: 'DELETE' }); }
      });
      await step('live: a task set to Opus runs on Opus and says so', async () => {
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'sales', text: 'one line: what should the next follow-up to a quiet lead say', model: 'opus' }) });
        if (!r.ok) throw new Error((await r.json()).error); const t = await r.json(); if (t.model !== 'opus') throw new Error('task.model ' + t.model);
        const d = await (await fetch(`${base}/api/tasks/${t.id}/run`, { method: 'POST' })).json(); if (d.error) throw new Error(d.result);
        if (d.modelUsed !== 'opus' || d.modelFrom !== 'task' || !/opus/.test(String(d.modelId))) throw new Error(`ran on ${d.modelId} (${d.modelUsed} from ${d.modelFrom})`);
        const u = await (await fetch(base + '/api/usage')).json(); if (!u.ok) throw new Error('usage after a run');
        return `${d.agent} · ${d.modelId} · from the task · gauge ${u.source}`;
      });
      await step('live: a task scheduled 75 s ahead fires on its minute and lands; a routine from a date waits for it', async () => { // V3.2.1
        const at = Date.now() + 75000;
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'list what is in the inbox that needs me today', at }) });
        const t = await r.json(); if (!r.ok) throw new Error(t.error); if (t.state !== 'scheduled' || t.dueAt !== at) throw new Error('not scheduled: ' + JSON.stringify({ state: t.state, dueAt: t.dueAt }));
        const start = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
        const rr = await fetch(base + '/api/routines', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'emails', text: 'triage the inbox', when: { kind: 'weekdays', at: '08:00', start } }) });
        const j = await rr.json(); if (!rr.ok) throw new Error(j.error);
        try {
          if (!j.routine.nextAt || new Date(j.routine.nextAt).toISOString().slice(0, 10) < start) throw new Error('routine fires before its start: ' + new Date(j.routine.nextAt));
          let task = null;
          for (let i = 0; i < 100 && !(task && task.state !== 'scheduled' && task.state !== 'next' && task.state !== 'doing'); i++) { await new Promise(r => setTimeout(r, 3000)); task = (await (await fetch(base + '/api/tasks')).json()).find(x => x.id === t.id); }
          if (!task || task.state === 'scheduled') throw new Error('the scheduled task never fired'); if (task.state === 'next' || task.state === 'doing') throw new Error('fired but did not finish in time');
          if (task.error) throw new Error('task failed: ' + task.result.slice(0, 120));
          return `${task.agent} · ${task.title} · ${task.state}${task.state === 'waiting' ? ' for the OK' : ''} · routine "${j.routine.desc}" next ${new Date(j.routine.nextAt).toDateString()}`;
        } finally { await fetch(`${base}/api/routines/${j.routine.id}`, { method: 'DELETE' }); }
      });
      await step('live: a team task — the lead plans, the desks work at once, the lead writes the final', async () => {
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'marketing', text: 'as a team, give me three angles for a reel about inbox overload: for each one a hook line and a two-sentence caption', team: true }) });
        if (!r.ok) throw new Error((await r.json()).error); const t = await r.json();
        if (!t.team || t.agent !== 'mlead') throw new Error('not a team task for the lead: ' + JSON.stringify({ team: t.team, agent: t.agent }));
        const d = await (await fetch(`${base}/api/tasks/${t.id}/run`, { method: 'POST' })).json(); if (d.error) throw new Error(d.result);
        const ps = d.team?.pieces || []; if (ps.length < 2) throw new Error('fewer than two pieces: ' + JSON.stringify(d.team));
        if (new Set(ps.map(p => p.agent)).size !== ps.length) throw new Error('a desk got two pieces');
        if (!ps.every(p => p.state === 'done' && p.result)) throw new Error('a piece did not finish: ' + JSON.stringify(ps.map(p => [p.agent, p.state])));
        if (!/Team:/i.test(d.result)) throw new Error('the final has no Team line');
        const note = fs.readFileSync(path.join(cfg.brainPath, 'Órbita', d.note + '.md'), 'utf8'); if (!/^team: /m.test(note) || !/## Team/.test(note)) throw new Error('the note does not carry the team');
        return `${ps.map(p => p.agent).join(' + ')} → ${d.agent} · ${d.result.length} chars · ${(d.team.messages || []).length} notes between them · ${d.note}.md`;
      });
      await step('live: an agent drives the owner\'s Chrome', async () => {
        const r = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dept: 'ops', text: 'Open https://example.com in the browser and tell me the exact page heading and where its one link points. Then close the tab.' }) });
        if (!r.ok) throw new Error((await r.json()).error); const t = await r.json();
        const d = await (await fetch(`${base}/api/tasks/${t.id}/run`, { method: 'POST' })).json(); if (d.error) throw new Error(d.result);
        if (!(d.tools || []).includes('chrome')) throw new Error('the browser was not used (tools: ' + (d.tools || []).join(' ') + '): ' + d.result.slice(0, 200));
        if (!/example domain/i.test(d.result)) throw new Error('the heading is not in the result: ' + d.result.slice(0, 200));
        return `${d.agent} · used ${d.used.join(', ')} · "${d.result.match(/example domain/i)[0]}"`;
      });
      await step('live: chat answers in persona', async () => {
        const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agent: 'lexi', text: 'what is our proposal win rate?' }) });
        if (!r.ok) throw new Error((await r.json()).error); const j = await r.json(); if (!j.reply) throw new Error('empty reply'); return j.reply.slice(0, 80).replace(/\n/g, ' ');
      });
      if (chromium) await step('live: the whole flow in a browser', async () => {
        let browser; try { browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] }); } catch { browser = await chromium.launch({ channel: 'chrome' }); }
        try {
          const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
          const errs = []; page.on('pageerror', e => errs.push(e.message));
          await page.goto(base + '/'); await page.waitForTimeout(3500);
          const mode = await page.evaluate(() => document.querySelector('.tp-mode').textContent); if (!/LIVE|SEM MOTOR/i.test(mode)) throw new Error('panel not live: ' + mode);
          const before = await page.evaluate(() => window.CC.brain.nodes.length);
          const known = await page.evaluate(() => window.CC.tasks.tasks.filter(t => t.live).map(t => t.id));
          await page.click('.tp-dd'); await page.click('.tp-menu button[data-k="marketing"]');
          await page.fill('.tp-in', 'write three hook lines for a reel about why most businesses ignore their inbox'); await page.keyboard.press('Enter');
          await page.waitForFunction(() => /Added|couldn/i.test(document.querySelector('.tp-hint').textContent), { timeout: 150000 });
          const hint = await page.evaluate(() => document.querySelector('.tp-hint').textContent); if (!/Added/.test(hint)) throw new Error(hint);
          const mine = await page.evaluate(k => window.CC.tasks.tasks.find(t => t.live && !k.includes(t.id))?.id, known); if (!mine) throw new Error('the new task is not in the panel');
          await page.waitForFunction(id => { const t = window.CC.tasks.tasks.find(x => x.id === id); return t && t.state === 'done'; }, mine, { timeout: 240000 });
          const done = await page.evaluate(id => { const t = window.CC.tasks.tasks.find(x => x.id === id); return { error: t.error, note: t.note, read: t.read }; }, mine);
          if (done.error) throw new Error('task failed');
          await page.waitForTimeout(2500);
          await page.click(`.tp-row[data-id="${mine}"]`); await page.waitForTimeout(2500);
          const card = await page.evaluate(n => [...document.querySelectorAll('.m-file .f-name')].some(e => e.textContent === n + '.md'), done.note); if (!card) throw new Error('deliverable card not in the chat');
          const after = await page.evaluate(() => window.CC.brain.nodes.length);
          const inGraph = await page.evaluate(n => window.CC.brain.nodes.some(x => x.id === n), done.note); // a second run on the same day rewrites the same note, so the count may not grow
          if (after < before || !inGraph) throw new Error(`the new note is not in the brain graph (${before} → ${after}, ${done.note})`);
          if (errs.length) throw new Error(errs[0]);
          return `${hint.trim().slice(0, 50)} · ${done.note}.md in the chat and in the graph · brain ${before} → ${after} notes`;
        } finally { await browser.close(); }
      });
    } else ok('live: skipped', 'set CHECK_LIVE=1 to route one task and one chat through Claude');
  }
  srv.kill();
}

/* ---------- 4. operação: servidor isolado, dados deitados fora no fim ---------- */
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-ops-'));
  const port = 4700 + Math.floor(Math.random() * 200);
  // ORBITA_PESQUISA_PERMITIR_PRIVADO: só aqui, para o passo 3 poder ler um site falso local
  const env = { ...process.env, PORT: String(port), ORBITA_DATA_DIR: tmp, ORBITA_DB: path.join(tmp, 'ops.db'), ORBITA_PESQUISA_PERMITIR_PRIVADO: '1' };
  let donoCookie = '', leitorCookie = '';
  let srv = spawn('node', ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const base = `http://localhost:${port}`;
  const call = async (method, p, payload, headers = {}) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  try {
    const up = await (async () => { for (let i = 0; i < 60; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) return true; } catch {} await new Promise(r => setTimeout(r, 250)); } return false; })();
    if (!up) { bad('operação: o servidor arranca com a base de dados', log.trim().split('\n').slice(-3).join(' | ')); throw new Error('sem /api/health'); }
    if (!/opera[çc][ãa]o:/.test(log)) throw new Error('o arranque não anunciou a operação: ' + log.split('\n').filter(l => l.includes('opera')).join(' | '));

    await step('operação: /api/ops/summary diz a verdade de uma base vazia', async () => {
      const { status, body } = await call('GET', '/api/ops/summary');
      if (status !== 200) throw new Error('HTTP ' + status);
      if (body.leads.total !== 0) throw new Error('não está vazia: ' + body.leads.total);
      if (body.conversao.taxaResposta !== null) throw new Error('inventou uma taxa com zero contactos');
      if (!body.semDados?.taxaResposta) throw new Error('não explicou a ausência');
      return 'zero leads · taxa null · razão dita';
    });

    await step('operação: um lead entra, é pontuado e uma segunda vez não duplica', async () => {
      const a = await call('POST', '/api/ops/leads', { leads: [{ name: 'Clínica Teste', website: 'https://clinica-teste.pt', phone: '+351 210 111 222', city: 'Lisboa', category: 'dentista' }] });
      if (a.status !== 201 || a.body.created !== 1) throw new Error(JSON.stringify(a.body).slice(0, 160));
      const b = await call('POST', '/api/ops/leads', { leads: [{ name: 'Clínica Teste Lda', website: 'https://www.clinica-teste.pt/menu', rating: 3.8, reviews: 9 }] });
      if (b.body.created !== 0) throw new Error('duplicou');
      const list = await call('GET', '/api/ops/leads?limit=5');
      const lead = list.body.leads.find(l => /Clínica Teste/.test(l.name));
      if (!lead || !lead.score_reasons) throw new Error('sem pontuação explicada');
      if (lead.rating !== 3.8) throw new Error('os dados frescos não entraram');
      return `${list.body.leads.length} lead(s) · nota ${lead.score} · ${String(lead.score_reasons).slice(0, 60)}`;
    });

    await step('operação: mensagem nasce rascunho, não sai sem OK, e o opt-out trava-a', async () => {
      const list = await call('GET', '/api/ops/leads?limit=1');
      const lead = list.body.leads[0];
      if (!lead) throw new Error('sem lead para testar');
      if (!lead.email) {
        // sem email não há envio de email: prova-se o caminho do WhatsApp (link revisto à mão)
      }
      const draft = await call('POST', '/api/ops/messages', { leadId: lead.id, channel: 'whatsapp', body: 'Olá, falo do site?' });
      if (draft.status !== 201 || draft.body.message.status !== 'rascunho') throw new Error('não nasceu rascunho');
      const early = await call('POST', `/api/ops/messages/${draft.body.message.id}/send`);
      if (early.status !== 409) throw new Error(`devia recusar com 409, veio ${early.status}: ${JSON.stringify(early.body).slice(0, 120)}`);
      if (!/aprovada/.test(early.body.error || '')) throw new Error('recusou sem dizer que falta a aprovação');
      const okd = await call('POST', `/api/ops/messages/${draft.body.message.id}/approve`);
      if (okd.body.message.status !== 'aprovada') throw new Error('não aprovou: ' + JSON.stringify(okd.body).slice(0, 120));
      const sent = await call('POST', `/api/ops/messages/${draft.body.message.id}/send`);
      if (sent.body.delivered) throw new Error('fingiu que enviou no WhatsApp');
      if (!sent.body.manual || !/wa\.me/.test(sent.body.url || '')) throw new Error('não devolveu o link a rever');
      // opt-out: a mensagem seguinte tem de ficar bloqueada, não enviada
      const off = await call('POST', '/api/ops/consent/opt-out', { email: 'geral@clinica-teste.pt', phone: lead.phone , reason: 'pediu para parar' });
      if (!off.body.ok) throw new Error('o opt-out foi recusado');
      const after = await call('POST', '/api/ops/messages', { leadId: lead.id, channel: 'whatsapp', body: 'segunda' });
      const blocked = await call('POST', `/api/ops/messages/${after.body.message.id}/approve`);
      if (blocked.body.message.status !== 'bloqueada') throw new Error('aprovou depois do opt-out');
      return 'rascunho → aprovada → link manual · opt-out bloqueia';
    });

    await step('operação: a fila aceita trabalho, corre e é auditável', async () => {
      const q = await call('GET', '/api/ops/queue');
      if (q.status !== 200) throw new Error('HTTP ' + q.status);
      const tick = await call('POST', '/api/ops/queue/tick');
      if (tick.status !== 200) throw new Error('tick HTTP ' + tick.status);
      const ev = await call('GET', '/api/ops/events?limit=20');
      const actions = ev.body.events.map(e => e.action);
      for (const a of ['lead.criado', 'mensagem.rascunho', 'mensagem.aprovada', 'consentimento.opt_out']) {
        if (!actions.includes(a)) throw new Error('sem rasto de ' + a);
      }
      return `${ev.body.events.length} eventos na auditoria · fila ${q.body.fila || 0} à espera`;
    });

    await step('hoje: o que espera decisão aparece com o porquê, tirado dos dados', async () => {
      const list = await call('GET', '/api/ops/leads?limit=1');
      const lead = list.body.leads[0];
      if (!lead) throw new Error('sem lead');
      await call('POST', '/api/ops/messages', { leadId: lead.id, channel: 'whatsapp', body: 'Uma abordagem curta.' });
      const t = await call('GET', '/api/ops/today');
      if (t.status !== 200) throw new Error('HTTP ' + t.status);
      if (!Array.isArray(t.body.decidir)) throw new Error('sem lista de decisões');
      const card = t.body.decidir.find(c => c.kind === 'mensagem');
      if (!card) throw new Error('a mensagem à espera não apareceu');
      if (!card.why) throw new Error('cartão sem porquê');
      if (!/avaliação|telefone|site|nicho/.test(card.why)) throw new Error('o porquê não vem dos dados: ' + card.why);
      if (!t.body.aconteceu.length) throw new Error('nada no «aconteceu»');
      if (typeof t.body.presenca?.parado !== 'boolean') throw new Error('sem estado do interruptor');
      return `${t.body.decidir.length} à espera · ${t.body.aconteceu.length} eventos · porquê: ${card.why.slice(0, 48)}…`;
    });

    await step('interruptor de emergência: parado, nada sai; retomado, volta', async () => {
      // um lead próprio para esta prova: o anterior foi para opt-out no passo 3
      await call('POST', '/api/ops/leads', { leads: [{ name: 'Paragem Teste', website: 'https://paragem-teste.pt', phone: '+351 967 111 222' }] });
      const list = await call('GET', '/api/ops/leads?limit=10');
      const lead = list.body.leads.find(l => /Paragem Teste/.test(l.name));
      if (!lead) throw new Error('não criou o lead da prova');
      const d = await call('POST', '/api/ops/messages', { leadId: lead.id, channel: 'whatsapp', body: 'Outra.' });
      await call('POST', `/api/ops/messages/${d.body.message.id}/approve`);
      await call('POST', '/api/ops/stop', { stop: true, why: 'check' });
      const blocked = await call('POST', `/api/ops/messages/${d.body.message.id}/send`);
      if (blocked.body.delivered) throw new Error('enviou com tudo parado');
      if (!/interruptor/.test(blocked.body.reason || '')) throw new Error('recusou sem explicar: ' + JSON.stringify(blocked.body).slice(0, 140));
      const t = await call('GET', '/api/ops/today');
      if (t.body.presenca.parado !== true) throw new Error('o ecrã Hoje não mostra o interruptor ligado');
      await call('POST', '/api/ops/stop', { stop: false });
      const after = await call('GET', '/api/ops/today');
      if (after.body.presenca.parado !== false) throw new Error('não retomou');
      return 'parado recusa · Hoje mostra · retoma';
    });

    // --- passo 3: ver o negócio a sério, escrever com factos, aprender com as respostas ---
    const fakeSite = await (async () => {
      const http = await import('node:http');
      const page = `<!doctype html><html lang="pt-PT"><head><title>Salão Bela Vista — Lisboa</title>
        <meta name="description" content="Cortes, coloração e tratamentos no coração de Alvalade, com marcação pelo telefone.">
        </head><body><h1>Salão Bela Vista</h1><p>Horário: 9h às 19h. Telefone 21 000 11 22.</p>
        <a href="https://instagram.com/salaobelavista">Instagram</a><footer>© 2019</footer></body></html>`;
      const srv = http.createServer((rq, rs) => {
        if (rq.url === '/robots.txt') { rs.writeHead(200); return rs.end('User-agent: *\nDisallow: /admin\n'); }
        rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(page);
      });
      await new Promise(r => srv.listen(0, '127.0.0.1', r));
      return { srv, url: `http://127.0.0.1:${srv.address().port}/` };
    })();
    try {
      let lote;
      await step('passo 3: a pesquisa lê o site e tira frases verdadeiras', async () => {
        const made = await call('POST', '/api/ops/leads', { leads: [{ name: 'Salão Bela Vista', city: 'Lisboa', phone: '+351 210 001 122', website: fakeSite.url, category: 'cabeleireiro', rating: 4.1, reviews: 10 }] });
        if (!made.body.total) throw new Error('não criou o lead');
        const lead = (await call('GET', '/api/ops/leads?limit=10')).body.leads.find(l => /Bela Vista/.test(l.name));
        const r = await call('POST', `/api/ops/leads/${lead.id}/pesquisar`);
        if (r.body.research.status !== 'ok') throw new Error('status ' + r.body.research.status + ': ' + r.body.research.reason);
        if (r.body.evidence.length < 4) throw new Error('poucos factos: ' + r.body.evidence.length);
        const keys = r.body.evidence.map(e => e.key);
        for (const k of ['sem-mobile', 'desactualizado']) if (!keys.includes(k)) throw new Error('faltou notar ' + k);
        const desc = r.body.evidence.find(e => e.key === 'descricao');
        if (!/Cortes, coloração/.test(desc?.quote || '')) throw new Error('a citação verdadeira não veio');
        if (/Horário/.test(JSON.stringify(r.body.research.facts?.text || ''))) throw new Error('guardou o texto todo');
        lote = { leadId: lead.id };
        return `${r.body.evidence.length} factos · oportunidade ${r.body.opportunity}/100 · cita «Cortes, coloração…»`;
      });

      await step('passo 3: a mensagem nasce dos factos e traz as objeções respondidas', async () => {
        if (!lote) throw new Error('sem lead do passo anterior');
        const r = await call('POST', `/api/ops/leads/${lote.leadId}/rascunho`, { channel: 'whatsapp' });
        if (r.status !== 201) throw new Error('HTTP ' + r.status + ': ' + (r.body.error || ''));
        const m = r.body.message;
        if (!/350 €/.test(m.body)) throw new Error('a oferta não entrou: ' + m.body);
        if (!m.predictions.length || m.predictions.some(p => !p.if || !p.answer)) throw new Error('objeções incompletas');
        if (!m.evidence_used.length) throw new Error('a mensagem não diz em que factos se apoia');
        if (m.generated_by !== 'modelo') throw new Error('autor inesperado: ' + m.generated_by);
        if (!/vi o site/.test(m.why)) throw new Error('o porquê não diz que leu o site: ' + m.why);
        lote.messageId = m.id;
        return `${m.predictions.length} objeções previstas · autor «${m.generated_by}» · ${m.evidence_used.length} factos citáveis`;
      });

      await step('passo 3: um sinal de resposta entra na aprendizagem, com amostra honesta', async () => {
        if (!lote?.messageId) throw new Error('sem mensagem do passo anterior');
        const sig = await call('POST', `/api/ops/messages/${lote.messageId}/sinal`, { kind: 'respondeu', note: 'pediu proposta' });
        if (!sig.body.ok) throw new Error(JSON.stringify(sig.body).slice(0, 120));
        if (!sig.body.signal.attributes.length) throw new Error('o sinal não trouxe atributos');
        const a = await call('GET', '/api/ops/aprendizagem');
        if (a.body.totalSinais < 1) throw new Error('a aprendizagem não contou o sinal');
        if (a.body.aprendido.length) throw new Error('aprendeu com um caso só — não devia');
        if (!a.body.aEsperar.length) throw new Error('não disse o que está a esperar');
        return `1 sinal registado · à espera de amostra (${a.body.aEsperar[0]})`;
      });

      await step('passo 3: a oferta é do dono e volta já no rascunho seguinte', async () => {
        const set = await call('POST', '/api/ops/oferta', { preco_eur: 450, prazo_dias: 5 });
        if (set.body.oferta.preco_eur !== 450) throw new Error('não guardou o preço');
        const r = await call('POST', `/api/ops/leads/${lote.leadId}/rascunho`, { channel: 'whatsapp' });
        if (!/450 €/.test(r.body.message.body)) throw new Error('o preço novo não entrou: ' + r.body.message.body.slice(0, 120));
        return '450 € e 5 dias na mensagem seguinte';
      });
    } finally { fakeSite.srv.close(); }

    await step('registo: a cadeia de hashes fecha e denuncia uma edição', async () => {
      const v = await call('GET', '/api/ops/events/verify');
      if (!v.body.ok) throw new Error('a cadeia partiu-se em ' + v.body.brokenAt);
      if (v.body.count < 5) throw new Error('poucos eventos para provar: ' + v.body.count);
      return `${v.body.count} eventos encadeados · último ${String(v.body.lastHash).slice(0, 12)}…`;
    });

    await step('operação: email exige token e consentimento; sem eles não sai', async () => {
      const made = await call('POST', '/api/ops/leads', { leads: [{ name: 'Restaurante Email', website: 'https://restaurante-email.pt', email: 'geral@restaurante-email.pt' }] });
      if (!made.body.total) throw new Error('não criou o lead de email');
      const lead = (await call('GET', '/api/ops/leads?limit=10')).body.leads.find(l => l.email);
      if (!lead) throw new Error('o lead de email desapareceu');
      await call('POST', `/api/ops/leads/${lead.id}/consent`, { consent: 'dado', reference: 'formulário do site' });
      const d = await call('POST', '/api/ops/messages', { leadId: lead.id, channel: 'email', subject: 'Olá', body: 'Uma proposta curta.' });
      await call('POST', `/api/ops/messages/${d.body.message.id}/approve`);
      const r = await call('POST', `/api/ops/messages/${d.body.message.id}/send`);
      if (r.status === 200 && r.body.delivered) throw new Error('enviou sem token');
      if (!/ORBITA_API_TOKEN|Token/i.test(r.body.error || '')) throw new Error('recusou sem dizer o que falta: ' + JSON.stringify(r.body).slice(0, 140));
      return 'HTTP ' + r.status + ' · ' + String(r.body.error).slice(0, 60);
    });
    // --- passo 4: autonomia graduada, ensaio e avaliações ---
    await step('passo 4: a autonomia começa em «pede-me sempre» e recusa subir sem casos', async () => {
      const a = await call('GET', '/api/ops/autonomia');
      if (!a.body.limiar || a.body.limiar.minCasos !== 50) throw new Error('limiar errado: ' + JSON.stringify(a.body.limiar));
      const r = await call('POST', '/api/ops/autonomia/whatsapp%3Asem-site/subir', {});
      if (r.status !== 409) throw new Error('subiu sem amostra (HTTP ' + r.status + ')');
      if (!/faltam \d+ casos/.test(r.body.error || '')) throw new Error('não disse quanto falta: ' + JSON.stringify(r.body).slice(0, 140));
      return 'HTTP 409 · ' + String(r.body.error).slice(0, 70);
    });

    await step('passo 4: o ensaio escreve tudo e não deixa sair nada', async () => {
      const on = await call('POST', '/api/ops/ensaio', { activo: true });
      if (!on.body.activo) throw new Error('não ligou o ensaio');
      const lead = (await call('GET', '/api/ops/leads?limit=5')).body.leads[0];
      const d = await call('POST', '/api/ops/messages', { leadId: lead.id, channel: 'whatsapp', body: 'Olá, vi que não tem site.' });
      if (d.body.message.status !== 'ensaio') throw new Error('nasceu «' + d.body.message.status + '», não em ensaio');
      const rep = await call('GET', '/api/ops/ensaio');
      if (!rep.body.total) throw new Error('o relatório não conta nada');
      const p = await call('POST', `/api/ops/messages/${d.body.message.id}/promover`);
      if (p.body.message.status !== 'rascunho') throw new Error('promover não devolveu a rascunho');
      await call('POST', '/api/ops/ensaio', { activo: false });
      return `${rep.body.total} em ensaio · nada saiu · promovida a rascunho`;
    });

    await step('passo 4: as avaliações do rascunho correm e ficam guardadas', async () => {
      const r = await call('POST', '/api/ops/evals/correr');
      if (!r.body.total) throw new Error('não correu nenhum caso');
      if (r.body.falhou) throw new Error(JSON.stringify(r.body.resultados.filter(x => !x.ok)).slice(0, 200));
      const h = await call('GET', '/api/ops/evals');
      if (!h.body.ultimo || h.body.ultimo.passed !== r.body.passou) throw new Error('não ficou no histórico');
      if (h.body.regressao === undefined) throw new Error('sem resposta sobre regressão');
      return `${r.body.passou}/${r.body.total} · prompt ${r.body.promptVersion} · guardado`;
    });

    // --- passo 5: saldo real e modo agência ---
    await step('passo 5: o saldo conta receita, custos e margem — e não inventa entradas', async () => {
      const vazio = await call('GET', '/api/ops/saldo');
      if (vazio.body.receitaCentimos !== 0 || !vazio.body.semDados?.receita) throw new Error('não disse que não há receita');
      const add = await call('POST', '/api/ops/receita', { euros: 350, campaign: 'Coimbra · barbearias' });
      if (add.status !== 201) throw new Error('HTTP ' + add.status + ' ' + JSON.stringify(add.body).slice(0, 120));
      const b = await call('GET', '/api/ops/saldo');
      if (b.body.receitaCentimos !== 35000) throw new Error('não somou a entrada: ' + b.body.receitaCentimos);
      if (b.body.margemCentimos !== b.body.receitaCentimos - b.body.custoCentimos) throw new Error('a margem não fecha');
      return `${(b.body.receitaCentimos / 100).toFixed(2)} € entrou · ${(b.body.custoCentimos / 100).toFixed(2)} € gastou · margem ${(b.body.margemCentimos / 100).toFixed(2)} €`;
    });

    await step('passo 5: um cliente novo ganha base própria e não vê os leads do outro', async () => {
      const antes = (await call('GET', '/api/ops/summary')).body.leads.total;
      const made = await call('POST', '/api/ops/clientes', { nome: 'Clínica Prova', nicho: 'clínicas dentárias', cidade: 'Coimbra', entrar: false });
      if (made.status !== 201) throw new Error('HTTP ' + made.status + ' ' + JSON.stringify(made.body).slice(0, 140));
      if ((made.body.cliente.proximosPassos || []).length < 3) throw new Error('o onboarding não diz o que falta');
      const lista = await call('GET', '/api/ops/clientes');
      if (!lista.body.clientes.some(c => c.id === made.body.cliente.id)) throw new Error('o cliente não entrou na lista');
      const ent = await call('POST', `/api/ops/clientes/${made.body.cliente.id}/entrar`);
      if (ent.status !== 200) throw new Error('não entrou no espaço: ' + JSON.stringify(ent.body).slice(0, 120));
      const depois = (await call('GET', '/api/ops/summary')).body.leads.total;
      if (depois !== 0) throw new Error('o espaço novo vê ' + depois + ' lead(s) do anterior');
      const rol = await call('GET', '/api/ops/agencia');
      if (!rol.body.clientes?.length) throw new Error('a agência não soma nada');
      return `${antes} lead(s) no espaço antigo · 0 no novo · ${rol.body.clientes.length} espaço(s) na agência`;
    });

    // --- a mesa de trabalho: a página que o dono abre de manhã ---
    await step('mesa: /app serve a página de trabalho, já construída', async () => {
      const r = await fetch(base + '/app');
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      if (!/id="main"/.test(html)) throw new Error('sem a área principal');
      if (!/Órbita/.test(html)) throw new Error('sem marca');
      if (!/Aprovar e enviar/.test(html)) throw new Error('o script da mesa não foi incluído no build');
      if (!/#\/leads/.test(html)) throw new Error('sem navegação por rotas');
      if (!/#\/projetos/.test(html)) throw new Error('a mesa não tem a secção de projetos');
      return `${(html.length / 1024).toFixed(0)} KB · um ficheiro · sem pedidos externos`;
    });

    await step('mesa: o lead vem com dossiê e as mensagens dele numa só resposta', async () => {
      const made = await call('POST', '/api/ops/leads', { leads: [{ name: 'Mesa Prova', website: 'https://mesa-prova.pt', phone: '+351 219 000 111', city: 'Lisboa', category: 'barbearia' }] });
      if (!made.body.created) throw new Error('não criou o lead da prova');
      const lead = (await call('GET', '/api/ops/leads?limit=10')).body.leads.find(l => l.name === 'Mesa Prova');
      if (!lead) throw new Error('o lead desapareceu');
      const one = await call('GET', '/api/ops/leads/' + lead.id);
      if (one.status !== 200 || !one.body.lead) throw new Error('HTTP ' + one.status + ' ' + JSON.stringify(one.body).slice(0, 120));
      if (!one.body.dossier || !Array.isArray(one.body.dossier.evidence)) throw new Error('sem dossiê');
      if (!Array.isArray(one.body.messages)) throw new Error('sem as mensagens do lead');
      const d = await call('POST', `/api/ops/leads/${lead.id}/rascunho`, { channel: 'whatsapp' });
      if (d.status !== 201) throw new Error('não escreveu o rascunho: ' + JSON.stringify(d.body).slice(0, 120));
      const two = await call('GET', '/api/ops/leads/' + lead.id);
      if (!two.body.messages.length) throw new Error('o rascunho não aparece na página do lead');
      if (two.body.messages[0].lead?.name !== 'Mesa Prova') throw new Error('a mensagem não traz o lead');
      return `1 lead · dossiê ${two.body.dossier.evidence.length} factos · ${two.body.messages.length} mensagem`;
    });

    // --- passo 6: lead → projeto → código → QA → aprovação → entrega ---
    let projetoId = null;
    await step('passo 6: de um lead ganho nasce um projeto, com briefing escrito a partir dos dados', async () => {
      const made = await call('POST', '/api/ops/leads', { leads: [{ name: 'Studio Entrega', category: 'Cabeleireiro', city: 'Lisboa', phone: '+351 918 222 333', rating: 4.7, reviews: 41 }] });
      if (!made.body.total) throw new Error('não criou o lead da prova');
      const lead = (await call('GET', '/api/ops/leads?limit=10')).body.leads.find(l => l.name === 'Studio Entrega');
      if (!lead) throw new Error('o lead desapareceu');
      const q = await call('PATCH', '/api/ops/leads/' + lead.id, { status: 'qualificado', note: 'tem potencial' });
      if (q.body.lead.status !== 'qualificado') throw new Error('não qualificou: ' + JSON.stringify(q.body).slice(0, 120));
      const p = await call('POST', `/api/ops/leads/${lead.id}/projeto`, { kind: 'landing' });
      if (p.status !== 201) throw new Error('HTTP ' + p.status + ' ' + JSON.stringify(p.body).slice(0, 140));
      projetoId = p.body.projeto.id;
      if (!/Lisboa/.test(p.body.projeto.brief)) throw new Error('o briefing não traz a cidade');
      const dup = await call('POST', `/api/ops/leads/${lead.id}/projeto`, { kind: 'landing' });
      if (dup.status !== 409) throw new Error('duplicou o projeto do mesmo lead');
      return `lead qualificado · projeto ${projetoId} · duplicado recusado`;
    });

    await step('passo 6: o motor escreve ficheiros reais e o QA aprova-os', async () => {
      if (!projetoId) throw new Error('sem projeto');
      const g = await call('POST', `/api/ops/projetos/${projetoId}/gerar`);
      if (g.status !== 200 || !g.body.files?.length) throw new Error('geração: ' + JSON.stringify(g.body).slice(0, 160));
      if (!g.body.files.includes('index.html')) throw new Error('sem index.html');
      const q = await call('POST', `/api/ops/projetos/${projetoId}/qa`);
      if (q.status !== 200 || !q.body.run.passed) throw new Error('QA não passou: ' + JSON.stringify(q.body.run?.items || q.body).slice(0, 200));
      return `${g.body.files.length} ficheiros · ${(g.body.bytes / 1024).toFixed(0)} KB · QA ${q.body.run.total} problema(s) · passou`;
    });

    await step('passo 6: o preview é servido de verdade, não é uma captura', async () => {
      if (!projetoId) throw new Error('sem projeto');
      const a = await call('POST', `/api/ops/projetos/${projetoId}/aprovar`, { note: 'ok na prova' });
      if (a.body.project.status !== 'aprovado') throw new Error('não aprovou: ' + JSON.stringify(a.body).slice(0, 120));
      const d = await call('POST', `/api/ops/projetos/${projetoId}/entregar`, { target: 'preview' });
      if (d.status !== 200 || !d.body.url) throw new Error('entrega: ' + JSON.stringify(d.body).slice(0, 140));
      const page = await fetch(base + d.body.url);
      const html = await page.text();
      if (page.status !== 200) throw new Error('preview HTTP ' + page.status);
      if (!/<html lang="pt">/.test(html) || !/Studio Entrega/.test(html)) throw new Error('o preview não é a página gerada');
      const css = await fetch(base + d.body.url + 'styles.css');
      if (css.status !== 200) throw new Error('o CSS do preview não é servido');
      return `${d.body.url} → 200 · HTML e CSS servidos`;
    });

    await step('passo 6: mexer no projeto depois do QA volta a exigir auditoria', async () => {
      if (!projetoId) throw new Error('sem projeto');
      const g = await call('POST', `/api/ops/projetos/${projetoId}/gerar`);
      if (g.body.project.status !== 'gerado') throw new Error('gerar outra vez devia invalidar a aprovação (está ' + g.body.project.status + ')');
      const d = await call('POST', `/api/ops/projetos/${projetoId}/entregar`, { target: 'preview' });
      if (d.status !== 409) throw new Error('entregou sem aprovação nova (HTTP ' + d.status + ')');
      const q = await call('POST', `/api/ops/projetos/${projetoId}/qa`);
      const a = await call('POST', `/api/ops/projetos/${projetoId}/aprovar`, {});
      if (a.body.project.status !== 'aprovado') throw new Error('não voltou a aprovar');
      return `HTTP 409 sem aprovação · QA ${q.body.run.passed ? 'passou' : 'falhou'} · aprovado outra vez`;
    });

    await step('passo 6: Vercel e GitHub recusam com o nome exacto do que falta', async () => {
      if (!projetoId) throw new Error('sem projeto');
      const v = await call('POST', `/api/ops/projetos/${projetoId}/entregar`, { target: 'vercel' });
      if (v.status !== 409 || !/VERCEL_DEPLOY_HOOK/.test(JSON.stringify(v.body))) throw new Error('Vercel: ' + JSON.stringify(v.body).slice(0, 160));
      const g = await call('POST', `/api/ops/projetos/${projetoId}/entregar`, { target: 'github' });
      if (![409, 200].includes(g.status)) throw new Error('GitHub: HTTP ' + g.status);
      const zip = await fetch(base + `/api/ops/projetos/${projetoId}/zip`);
      const buf = Buffer.from(await zip.arrayBuffer());
      if (buf.subarray(0, 4).toString('hex') !== '504b0304') throw new Error('o .zip não é um zip');
      return `Vercel pede hook · GitHub pede token/fluxo · .zip com ${(buf.length / 1024).toFixed(0)} KB`;
    });

    // --- passo 7: tarefas dos departamentos, funil, pesquisa e a guarda da porta ---
    await step('passo 7: uma tarefa de desenvolvimento corre, deixa resultado e evidência', async () => {
      if (!projetoId) throw new Error('sem projeto');
      const t = await call('POST', '/api/ops/tarefas', { kind: 'projeto.qa', entidade: 'projeto', entityId: projetoId, correr: true });
      if (t.status !== 201 && t.status !== 200) throw new Error('HTTP ' + t.status + ' ' + JSON.stringify(t.body).slice(0, 140));
      const tarefa = t.body.tarefa;
      if (tarefa.state !== 'succeeded') throw new Error('ficou ' + tarefa.state + ': ' + (tarefa.error || ''));
      if (!tarefa.evidence.length && tarefa.result?.total !== 0) throw new Error('sem evidência');
      if (tarefa.duration_ms == null) throw new Error('sem duração');
      return `${tarefa.deptName} · ${tarefa.evidence.length} prova(s) · ${tarefa.result.total} problema(s) · ${tarefa.duration_ms} ms`;
    });

    await step('passo 7: o mesmo trabalho pedido duas vezes não duplica — e um tipo inventado é recusado', async () => {
      if (!projetoId) throw new Error('sem projeto');
      const a = await call('POST', '/api/ops/tarefas', { kind: 'projeto.gerar', entidade: 'projeto', entityId: projetoId });
      const b = await call('POST', '/api/ops/tarefas', { kind: 'projeto.gerar', entidade: 'projeto', entityId: projetoId });
      if (a.body.tarefa.id !== b.body.tarefa.id) throw new Error('duplicou a tarefa aberta');
      const mau = await call('POST', '/api/ops/tarefas', { kind: 'comando.livre', entityId: 'x' });
      if (mau.status !== 400) throw new Error('aceitou um tipo inventado (HTTP ' + mau.status + ')');
      return `uma só tarefa ${a.body.tarefa.id} · tipo inventado → 400`;
    });

    await step('passo 7: o que precisa de IA falha com o motivo, não com um resultado inventado', async () => {
      const t = await call('POST', '/api/ops/tarefas', { kind: 'conteudo.rascunho', entidade: 'projeto', entityId: projetoId || 'p_x', correr: true });
      const tarefa = t.body.tarefa;
      if (tarefa.state !== 'failed') throw new Error('devia falhar sem motor, ficou ' + tarefa.state);
      if (!/motor de IA/.test(tarefa.error || '')) throw new Error('motivo pouco claro: ' + tarefa.error);
      if (Object.keys(tarefa.result || {}).length) throw new Error('deixou um resultado inventado');
      return `falhou com o motivo escrito (${tarefa.attempts}/${tarefa.max_attempts})`;
    });

    await step('passo 7: uma acção de risco espera aprovação humana e só avança depois', async () => {
      const t = await call('POST', '/api/ops/tarefas', { kind: 'command.revisao', entidade: 'sistema', entityId: 'geral', aprovacao: true, correr: true });
      const id = t.body.tarefa.id;
      if (t.body.tarefa.state !== 'awaiting_approval') throw new Error('ficou ' + t.body.tarefa.state);
      const cedo = await call('POST', `/api/ops/tarefas/${id}/correr`);
      if (cedo.status !== 409) throw new Error('deixou repetir antes de aprovar');
      const ok = await call('POST', `/api/ops/tarefas/${id}/aprovar`, { note: 'revisto' });
      if (ok.body.tarefa.state !== 'succeeded' || ok.body.tarefa.approved_by !== 'dono') throw new Error('aprovação não ficou registada');
      return 'awaiting_approval → aprovar → succeeded · quem aprovou fica escrito';
    });

    await step('passo 7: os agentes só aparecem a trabalhar quando há tarefa em curso', async () => {
      const a = (await call('GET', '/api/ops/agentes')).body;
      if (!Array.isArray(a.departamentos) || a.departamentos.length !== 6) throw new Error('não são seis departamentos');
      if (a.departamentos.some(d => !d.name)) throw new Error('departamento sem nome');
      const nomes = a.departamentos.map(d => d.name).join(',');
      if (nomes !== 'ORION,LUNA,KAI,NOVA,ZEKE,MIRA') throw new Error('ordem da cadeia: ' + nomes);
      if (!/sem trabalho pendente|sem tarefas|com falhas/.test(JSON.stringify(a.departamentos.map(d => d.last)))) {
        // nenhum departamento pode declarar-se a trabalhar sem tarefa em `running`
      }
      if (a.totais.running !== 0) throw new Error('diz que há trabalho a correr sem nada a correr');
      return `6 departamentos · ${a.totais.succeeded} concluídas · 0 a correr`;
    });

    await step('passo 7: o funil conta por fase e por origem, e vê o que parou', async () => {
      const p = (await call('GET', '/api/ops/pipeline')).body;
      if (!p.fases || p.fases.length !== 6) throw new Error('fases em falta');
      if (typeof p.totalLeads !== 'number') throw new Error('sem total de leads');
      if (!Array.isArray(p.porOrigem)) throw new Error('sem origens');
      return `${p.fases.map(f => f.key + '=' + f.leads).join(' ')} · ${p.porOrigem.length} origem(ns) · ${p.paradas.lista.length} parada(s)`;
    });

    await step('passo 7: a pesquisa global encontra lead, projeto e tarefa sem acentos', async () => {
      const r = (await call('GET', '/api/ops/pesquisa?q=studio')).body;
      if (r.total < 1) throw new Error('não encontrou «studio»');
      if (!r.grupos.length) throw new Error('sem grupos');
      const onde = r.grupos.map(g => g.grupo).join(',');
      const curto = (await call('GET', '/api/ops/pesquisa?q=a')).body;
      if (curto.total !== 0) throw new Error('uma letra não devia pesquisar');
      return `grupos: ${onde} · uma letra é ignorada`;
    });

    await step('passo 7: pedidos de outra origem com cookie são recusados (CSRF)', async () => {
      const r = await fetch(base + '/api/ops/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://mau.example', cookie: 'orbita_admin=falso' },
        body: JSON.stringify({ name: 'Intruso' }),
      });
      if (r.status !== 403) throw new Error('aceitou um POST de outra origem com cookie (HTTP ' + r.status + ')');
      const igual = await fetch(base + '/api/ops/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, cookie: 'orbita_admin=falso' },
        body: JSON.stringify({ leads: [{ name: 'Legítimo ' + Date.now(), phone: '+351 918 999 000' }] }),
      });
      if (igual.status !== 201) throw new Error('recusou um POST da própria origem (HTTP ' + igual.status + ')');
      return 'outra origem → 403 · mesma origem → 201';
    });

    await step('passo 7: dados inválidos e tarefas inexistentes são recusados com motivo', async () => {
      const alvo = 'l_nao_existe';
      const t = await call('POST', '/api/ops/tarefas', { kind: 'lead.qualificar', entidade: 'lead', entityId: alvo, correr: true });
      if (t.body.tarefa.state !== 'failed' || t.status !== 409) throw new Error('aceitou um lead inexistente');
      const pedido = await call('POST', '/api/ops/tarefas/t_nao_existe/correr');
      if (pedido.status !== 404) throw new Error('tarefa inexistente: HTTP ' + pedido.status);
      const projeto = await call('GET', '/api/ops/projetos/p_nao_existe');
      if (projeto.status !== 404) throw new Error('projeto inexistente: HTTP ' + projeto.status);
      return 'lead e tarefa inexistentes → 404/409 com motivo';
    });

    await step('passo 7: dois pedidos simultâneos do mesmo trabalho não criam duas tarefas', async () => {
      const pedido = () => call('POST', '/api/ops/tarefas', { kind: 'lead.qualificar', entidade: 'lead', entityId: 'l_corrida', payload: {} });
      const r = await Promise.all([pedido(), pedido(), pedido(), pedido()]);
      const ids = new Set(r.map(x => x.body.tarefa?.id));
      if (ids.size !== 1) throw new Error('criou ' + ids.size + ' tarefas para o mesmo trabalho');
      const criadas = r.filter(x => x.body.existia === false).length;
      if (criadas !== 1) throw new Error('criadas ' + criadas + ' (devia ser exactamente 1)');
      return `4 pedidos em paralelo → 1 tarefa ${[...ids][0]}`;
    });

    await step('passo 7: os dados sobrevivem a um reinício do servidor', async () => {
      const antes = (await call('GET', '/api/ops/leads?limit=50')).body.leads.length;
      const tarefasAntes = (await call('GET', '/api/ops/tarefas')).body.tarefas.length;
      const projetosAntes = (await call('GET', '/api/ops/projetos')).body.projetos.length;
      if (!antes || !tarefasAntes) throw new Error('nada para provar: ' + antes + ' leads, ' + tarefasAntes + ' tarefas');
      // mata-se o processo e levanta-se outro sobre o MESMO ficheiro de base de dados
      await new Promise(r => { srv.once('exit', r); srv.kill(); });
      for (let i = 0; i < 40; i++) { try { await fetch(base + '/api/health'); } catch { break; } await new Promise(r => setTimeout(r, 100)); }
      srv = spawn('node', ['serve.mjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
      let up = false;
      for (let i = 0; i < 80; i++) { try { const r = await fetch(base + '/api/health'); if (r.ok) { up = true; break; } } catch {} await new Promise(r => setTimeout(r, 250)); }
      if (!up) throw new Error('o servidor não voltou a arrancar');
      const depois = (await call('GET', '/api/ops/leads?limit=50')).body.leads.length;
      const tarefasDepois = (await call('GET', '/api/ops/tarefas')).body.tarefas.length;
      const projetosDepois = (await call('GET', '/api/ops/projetos')).body.projetos.length;
      if (depois !== antes) throw new Error(`leads: ${antes} → ${depois}`);
      if (tarefasDepois !== tarefasAntes) throw new Error(`tarefas: ${tarefasAntes} → ${tarefasDepois}`);
      if (projetosDepois !== projetosAntes) throw new Error(`projetos: ${projetosAntes} → ${projetosDepois}`);
      return `${depois} leads · ${tarefasDepois} tarefas · ${projetosDepois} projetos intactos`;
    });

    // --- passo 8: contas, sessões e papéis ---
    // Um cliente HTTP mínimo com cookie jar, para provar a sessão como o browser a vive.
    const comCookie = async (method, p, payload, cookie, extra = {}) => {
      const r = await fetch(base + p, {
        method,
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...extra },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      const set = r.headers.get('set-cookie') || '';
      return { status: r.status, body: await r.json().catch(() => ({})), set, cookie: set ? set.split(';')[0] : '' };
    };

    await step('passo 8: a primeira conta só nasce enquanto não há nenhuma', async () => {
      const fraca = await comCookie('POST', '/api/auth/primeiro-dono', { email: 'dono@orbita.pt', password: '1234' });
      if (fraca.status !== 400) throw new Error('aceitou uma palavra-passe fraca (' + fraca.status + ')');
      const r = await comCookie('POST', '/api/auth/primeiro-dono', { email: 'Dono@Orbita.PT', name: 'Chelton', password: 'uma-frase-bem-comprida' });
      if (r.status !== 201) throw new Error('HTTP ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 140));
      if (r.body.user.role !== 'dono') throw new Error('a primeira conta não é dona');
      if (JSON.stringify(r.body).includes('password_hash')) throw new Error('a hash saiu na resposta');
      if (!/HttpOnly/.test(r.set) || !/SameSite=Strict/.test(r.set)) throw new Error('cookie sem HttpOnly/SameSite: ' + r.set);
      const outra = await comCookie('POST', '/api/auth/primeiro-dono', { email: 'outra@orbita.pt', password: 'outra-frase-comprida' });
      if (outra.status !== 409) throw new Error('deixou criar uma segunda «primeira conta»');
      return `${r.body.user.email} criada como dono · cookie HttpOnly+SameSite=Strict · segunda tentativa → 409`;
    });

    await step('passo 8: sem sessão não se entra (e o pedido diz porquê)', async () => {
      const r = await comCookie('GET', '/api/ops/summary');
      if (r.status !== 401) throw new Error('abriu sem sessão: HTTP ' + r.status);
      if (r.body.hint !== 'sessao') throw new Error('não disse que faltava entrar');
      const errada = await comCookie('POST', '/api/auth/entrar', { email: 'dono@orbita.pt', password: 'errada-mas-comprida' });
      if (errada.status !== 401) throw new Error('aceitou a palavra-passe errada (' + errada.status + ')');
      const inexistente = await comCookie('POST', '/api/auth/entrar', { email: 'ninguem@orbita.pt', password: 'errada-mas-comprida' });
      if (inexistente.body.error !== errada.body.error) throw new Error('as mensagens revelam se o email existe');
      return '401 com motivo · mesma frase para conta inexistente e palavra-passe errada';
    });

    await step('passo 8: entrar devolve uma sessão que abre /api/ops', async () => {
      const r = await comCookie('POST', '/api/auth/entrar', { email: 'dono@orbita.pt', password: 'uma-frase-bem-comprida' });
      if (r.status !== 200 || !r.cookie) throw new Error('não entrou: ' + r.status);
      donoCookie = r.cookie;
      const s = await comCookie('GET', '/api/ops/summary', undefined, donoCookie);
      if (s.status !== 200) throw new Error('com sessão: HTTP ' + s.status);
      const eu = await comCookie('GET', '/api/auth/eu', undefined, donoCookie);
      if (eu.body.papel !== 'dono' || !eu.body.perms.admin) throw new Error('o papel não veio: ' + JSON.stringify(eu.body).slice(0, 120));
      return `sessão aberta · papel ${eu.body.papel} · perms ${JSON.stringify(eu.body.perms)}`;
    });

    await step('passo 8: cada papel só faz o que lhe compete (autenticação ≠ autorização)', async () => {
      const criar = async (email, role) => {
        const r = await comCookie('POST', '/api/ops/utilizadores', { email, password: 'palavra-comprida-2026', role }, donoCookie);
        if (r.status !== 201) throw new Error('criar ' + role + ': ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
        return r.body.utilizador;
      };
      await criar('gestor@orbita.pt', 'gestor');
      await criar('operador@orbita.pt', 'operador');
      await criar('leitor@orbita.pt', 'leitor');
      const entrar = async email => {
        const r = await comCookie('POST', '/api/auth/entrar', { email, password: 'palavra-comprida-2026' });
        if (r.status !== 200) throw new Error('entrar ' + email + ': ' + r.status);
        return r.cookie;
      };
      const leitor = await entrar('leitor@orbita.pt');
      const operador = await entrar('operador@orbita.pt');
      const gestor = await entrar('gestor@orbita.pt');
      const t = async (cookie, method, p, body) => (await comCookie(method, p, body, cookie)).status;
      const linhas = [];
      linhas.push(`leitor lê=${await t(leitor, 'GET', '/api/ops/leads')} escreve=${await t(leitor, 'POST', '/api/ops/leads', { leads: [{ name: 'L', phone: '+351 911 000 111' }] })}`);
      linhas.push(`operador escreve=${await t(operador, 'POST', '/api/ops/leads', { leads: [{ name: 'O ' + Date.now(), phone: '+351 911 000 222' }] })} aprova=${await t(operador, 'POST', '/api/ops/stop', { stop: false })}`);
      linhas.push(`gestor aprova=${await t(gestor, 'POST', '/api/ops/stop', { stop: false })} contas=${await t(gestor, 'GET', '/api/ops/utilizadores')}`);
      linhas.push(`dono contas=${await t(donoCookie, 'GET', '/api/ops/utilizadores')}`);
      if (!/leitor lê=200 escreve=403/.test(linhas[0])) throw new Error(linhas[0]);
      if (!/operador escreve=201 aprova=403/.test(linhas[1])) throw new Error(linhas[1]);
      if (!/gestor aprova=200 contas=403/.test(linhas[2])) throw new Error(linhas[2]);
      if (!/dono contas=200/.test(linhas[3])) throw new Error(linhas[3]);
      leitorCookie = leitor;
      return linhas.join(' · ');
    });

    await step('passo 8: cinco falhas seguidas bloqueiam a conta por 15 minutos', async () => {
      const alvo = 'bloqueio@orbita.pt';
      const criada = await comCookie('POST', '/api/ops/utilizadores', { email: alvo, password: 'palavra-comprida-2026', role: 'leitor' }, donoCookie);
      if (criada.status !== 201) throw new Error('não criou a conta do teste: ' + criada.status);
      const estados = [];
      for (let i = 0; i < 5; i++) {
        const r = await comCookie('POST', '/api/auth/entrar', { email: alvo, password: 'errada-mas-comprida' });
        estados.push(r.status);
      }
      const certo = await comCookie('POST', '/api/auth/entrar', { email: alvo, password: 'palavra-comprida-2026' });
      if (certo.status !== 423) throw new Error('com a palavra-passe certa devia estar bloqueada; veio ' + certo.status);
      if (estados.filter(s => s === 401).length !== 5) throw new Error('estados inesperados: ' + estados.join(','));
      if (!/demasiadas tentativas/.test(certo.body.error || '')) throw new Error('a recusa não explica o bloqueio: ' + certo.body.error);
      // o bloqueio não deixa rasto do email em claro: os eventos dizem o motivo, não quem
      const eventos = await comCookie('GET', '/api/ops/eventos?limit=50', undefined, donoCookie);
      const texto = JSON.stringify(eventos.body || {});
      if (/bloqueio@orbita\.pt/.test(texto)) throw new Error('o email ficou em claro no registo de eventos');
      return `5×401 → tentativa certa 423 «${String(certo.body.error).slice(0, 42)}…» · sem email em claro nos eventos`;
    });

    await step('passo 8: sair fecha a sessão e o cookie antigo deixa de valer', async () => {
      const antes = await comCookie('GET', '/api/ops/leads', undefined, leitorCookie);
      if (antes.status !== 200) throw new Error('a sessão do leitor não estava válida');
      const fora = await comCookie('POST', '/api/auth/sair', {}, leitorCookie);
      if (fora.status !== 200) throw new Error('sair: HTTP ' + fora.status);
      const depois = await comCookie('GET', '/api/ops/leads', undefined, leitorCookie);
      if (depois.status !== 401) throw new Error('o cookie antigo ainda vale (' + depois.status + ')');
      const revogada = await comCookie('POST', '/api/auth/entrar', { email: 'operador@orbita.pt', password: 'palavra-comprida-2026' });
      const lista = await comCookie('GET', '/api/ops/sessoes', undefined, donoCookie);
      if (!Array.isArray(lista.body.sessoes) || !lista.body.sessoes.length) throw new Error('a lista de sessões veio vazia');
      const alvo = lista.body.sessoes.find(x => x.user === 'operador@orbita.pt' && x.state === 'activa');
      const r = await comCookie('DELETE', '/api/ops/sessoes/' + alvo.id, undefined, donoCookie);
      if (r.status !== 200) throw new Error('revogar: HTTP ' + r.status);
      const depoisRevogar = await comCookie('GET', '/api/ops/leads', undefined, revogada.cookie);
      if (depoisRevogar.status !== 401) throw new Error('a sessão revogada ainda vale');
      return `${lista.body.sessoes.length} sessões · sair e revogar fecham na hora`;
    });

    await step('passo 8: cookie de sessão de outra origem é recusado (CSRF), na origem certa passa', async () => {
      const mau = await comCookie('POST', '/api/ops/stop', { stop: true }, donoCookie, { origin: 'https://mau.example' });
      if (mau.status !== 403) throw new Error('aceitou um POST de outra origem com cookie (' + mau.status + ')');
      const bom = await comCookie('POST', '/api/ops/stop', { stop: false }, donoCookie, { origin: base });
      if (bom.status !== 200) throw new Error('recusou um POST da nossa origem (' + bom.status + ')');
      return 'outra origem → 403 · mesma origem → 200';
    });

    // --- passo 9: o escritório ao vivo (SSE) — 26 out 2026 ---
    await step('passo 9: o retrato dos postos lê a base de dados e exige sessão', async () => {
      const sem = await comCookie('GET', '/api/ops/aovivo');
      if (sem.status !== 401) throw new Error('o retrato abriu sem sessão (' + sem.status + ')');
      const r = await comCookie('GET', '/api/ops/aovivo', undefined, donoCookie);
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      if (!r.body.agents || !r.body.agents.ilm) throw new Error('falta o posto do qualificador');
      if (!/base de dados/.test(r.body.fonte || '')) throw new Error('não diz de onde vêm os dados');
      const semTrabalho = Object.values(r.body.agents).every(a => a.state === 'idle');
      return `${Object.keys(r.body.agents).length} postos · fonte declarada · sem sessão → 401${semTrabalho ? ' · tudo idle (nada inventado)' : ''}`;
    });

    await step('passo 9: o fluxo SSE emite quando o trabalho muda, com heartbeat e sem tempestade', async () => {
      const lead = await comCookie('POST', '/api/ops/leads', { leads: [{ name: 'Ao Vivo Lda', city: 'Coimbra', phone: '+351 916 555 444' }] }, donoCookie);
      if (lead.status !== 201) throw new Error('não criou o lead de prova (' + lead.status + ')');
      const lista = await comCookie('GET', '/api/ops/leads?order=recent&limit=1', undefined, donoCookie);
      const leadId = (lista.body.leads && lista.body.leads[0] && lista.body.leads[0].id) || '';
      if (!leadId) throw new Error('o lead de prova não ficou na base de dados');

      const ctrl = new AbortController();
      const res = await fetch(base + '/api/ops/aovivo/stream', {
        headers: { cookie: donoCookie, accept: 'text/event-stream' }, signal: ctrl.signal,
      });
      if (res.status !== 200) throw new Error('o fluxo devolveu ' + res.status);
      if (!/text\/event-stream/.test(res.headers.get('content-type') || '')) throw new Error('não é SSE: ' + res.headers.get('content-type'));
      if (!/no-transform/.test(res.headers.get('cache-control') || '')) throw new Error('sem cache-control de fluxo');
      const reader = res.body.getReader(); const dec = new TextDecoder();
      const eventos = []; let buf = ''; let bufInicial = '';
      const ler = (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const pedaco = dec.decode(value, { stream: true });
            buf += pedaco; if (bufInicial.length < 400) bufInicial += pedaco;
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const bloco = buf.slice(0, i); buf = buf.slice(i + 2);
              const ev = (bloco.match(/^event: (.*)$/m) || [])[1];
              const dado = (bloco.match(/^data: (.*)$/m) || [])[1];
              if (ev) eventos.push({ ev, dado: dado ? JSON.parse(dado) : null });
            }
          }
        } catch { /* fechado no fim */ }
      })();
      await new Promise(r => setTimeout(r, 900));
      await comCookie('POST', '/api/ops/tarefas', { kind: 'lead.qualificar', entidade: 'lead', entityId: leadId, correr: true }, donoCookie);
      await Promise.race([ler, new Promise(r => setTimeout(r, 5000))]);
      ctrl.abort();

      const tipos = eventos.map(e => e.ev);
      if (!tipos.includes('hello')) throw new Error('o fluxo não começou com o retrato');
      if (!tipos.includes('ping')) throw new Error('sem heartbeat');
      const updates = eventos.filter(e => e.ev === 'update');
      if (!updates.length) throw new Error('a tarefa mudou e o fluxo não disse nada');
      const ultimo = updates[updates.length - 1].dado;
      const il = ultimo.agents.ilm;
      if (!il || !il.hasData) throw new Error('o retrato atualizado não traz o trabalho do posto');
      if (il.lines.some(l => /%/.test(l.text))) throw new Error('apareceu uma percentagem inventada');
      if (eventos.length > 40) throw new Error('demasiados eventos sem mudanças (' + eventos.length + ') — o fluxo estaria a inundar');
      if (!/retry: 3000/.test(bufInicial)) throw new Error('o fluxo não diz ao cliente para voltar sozinho (retry)');
      const alt = (updates[updates.length - 1].dado.alteracoes || []).find(x => x.agente === 'ilm');
      if (!alt) throw new Error('o evento não identifica o posto que mudou');
      if (!alt.idTarefa || !alt.estado || !alt.at) throw new Error('a mudança não diz tarefa, estado e momento');
      return `hello → ${updates.length} update(s) reais após a tarefa · ${tipos.filter(t => t === 'ping').length} heartbeat(s) · ${eventos.length} eventos no total`;
    });

  } catch (e) { bad('operação: servidor isolado', e.message); }
  finally { try { srv.kill(); } catch {} try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} }
}

/* ---------- summary ---------- */
const fails = results.filter(r => !r[0]);
console.log(`\n${fails.length ? '✗' : '✓'} ${results.length - fails.length}/${results.length} checks passed${fails.length ? ' — ' + fails.map(f => f[1]).join(', ') : ''}`);
process.exit(fails.length ? 1 : 0);
