// Órbita — the department lead interviews the owner (Beta).
// In the chat with a department lead, say "set up". The lead asks five questions, one at a time,
// about how that department works here, then writes it down for the team:
//   · a brief for each agent in the department   → <brain>/Órbita/agents.json
//   · one skill for the job the owner described  → <brain>/Órbita/skills/<name>/
// Nothing is written until the last answer. "skip" skips a question, "done" finishes early,
// "cancel" throws the answers away. State lives in data/interviews.json while an interview runs.
import fs from 'node:fs';
import path from 'node:path';

const START = /^\s*(set\s?-?up|configurar|configura|montar|entrevista|onboard(ing)?|interview\s+me|teach\s+(you|the\s+team)|let'?s\s+(set\s?up|start)|start\s+the\s+interview|começar)\b/i;
const CANCEL = /^\s*(cancel|cancelar|desistir|stop|never\s?mind|forget\s+it)\s*[.!]?\s*$/i;
const SKIP = /^\s*(skip|saltar|passar|seguinte|pass|next)\s*[.!]?\s*$/i;
const DONE = /^\s*(done|terminar|acabar|chega|pronto|finish|that'?s\s+(it|all|enough)|enough)\s*[.!]?\s*$/i;

export const QUESTIONS = [
  { k: 'what', q: d => `Primeiro: o que faz ${d} aqui, nas tuas palavras? O que entra, o que sai e para quem é?` },
  { k: 'job', q: d => `Guia-me pelo trabalho de ${d.toLowerCase()} que fazes mais vezes, do princípio ao fim. Onde começa, o que verificas, como é a coisa acabada?` },
  { k: 'good', q: () => `Como é um bom resultado? Se tens um de que gostaste, cola-o aqui ou descreve-o. Se tens um modelo, descreve as secções.` },
  { k: 'never', q: () => `O que nunca pode acontecer? Linhas vermelhas, coisas que esperam sempre por ti, algo que já correu mal e não pode repetir-se.` },
  { k: 'tools', q: () => `Que ferramentas ou sistemas usamos para isto, e que pessoas estão envolvidas (clientes, fornecedores, equipa, um contabilista)? Diz «saltar» se não te lembrares de nada.` },
];

export const stateFile = dataDir => path.join(dataDir, 'interviews.json');
const load = dataDir => { try { return JSON.parse(fs.readFileSync(stateFile(dataDir), 'utf8')); } catch { return {}; } };
const save = (dataDir, s) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(stateFile(dataDir), JSON.stringify(s, null, 2)); };
export const active = (dataDir, dept) => !!load(dataDir)[dept];

/** Is this department set up yet? True when any of its agents has a brief or a skill of the owner's. */
export function isSetUp(agents, skills, dept) {
  return agents.some(a => a.department === dept && (a.brief || skills.forAgent(a).some(s => s.source === 'brain')));
}

const progress = (i, d) => `**Pergunta ${i + 1} de ${QUESTIONS.length}.** ${QUESTIONS[i].q(d)}`;

/**
 * One chat turn. Returns { reply, wrote? } when the interview handles it, or null to let the normal chat answer.
 * ctx: { dept, deptName, lead, agents (this dept), connected (names), brainPath, dataDir, ask, afterWrite }
 */
export async function handle(text, ctx) {
  const { dept, deptName: d, lead, dataDir } = ctx;
  const st = load(dataDir); const cur = st[dept];
  if (!cur) {
    if (!START.test(text)) return null;
    st[dept] = { step: 0, answers: [], startedAt: Date.now() }; save(dataDir, st);
    return { reply: `Boa. Cinco perguntas sobre como ${d} funciona aqui, uma de cada vez. Responde por palavras simples, tanto ou tão pouco quanto quiseres. «saltar» salta uma, «terminar» acaba mais cedo, «cancelar» deita tudo fora. Nada é escrito até ao fim, e depois digo-te exatamente o que escrevi e onde.\n\n${progress(0, d)}` };
  }
  if (CANCEL.test(text)) { delete st[dept]; save(dataDir, st); return { reply: `Cancelado. Não se escreveu nada. Diz «configurar» quando quiseres começar de novo.` }; }
  let finish = false;
  if (DONE.test(text)) { if (!cur.answers.some(Boolean)) { delete st[dept]; save(dataDir, st); return { reply: `Ainda nada para escrever. Diz «configurar» quando tiveres uns minutos.` }; } finish = true; }
  else { cur.answers.push(SKIP.test(text) ? '' : String(text).trim()); cur.step = cur.answers.length; if (cur.step >= QUESTIONS.length) finish = true; }
  if (!finish) { save(dataDir, st); return { reply: `Anotado.\n\n${progress(cur.step, d)}` }; }
  delete st[dept]; save(dataDir, st); // whatever happens next, the interview is over
  const answers = QUESTIONS.map((q, i) => ({ k: q.k, q: q.q(d), a: cur.answers[i] || '' })).filter(x => x.a);
  const wrote = await writeUp(answers, ctx);
  const briefs = wrote.briefs.map(b => `${ctx.agents.find(a => a.id === b.id)?.name || b.id}`).join(', ');
  const lines = [`Pronto. Isto é o que escrevi para ${d}:`];
  if (wrote.briefs.length) lines.push(`- Um briefing para ${briefs} em \`${wrote.agentsFile}\` — o que cada um agora sabe sobre como trabalhas.`);
  if (wrote.skill) lines.push(`- A skill, **${wrote.skill.name}**${wrote.skill.description ? ' (' + wrote.skill.description + ')' : ''}, for ${wrote.skill.agents.map(id => ctx.agents.find(a => a.id === id)?.name || id).join(' and ')} in \`${wrote.skill.dir}\`${wrote.skill.template ? ' with a template beside it' : ''}.`);
  if (!wrote.briefs.length && !wrote.skill) lines.push(`- Não saiu nada de útil das respostas, por isso nada foi escrito. Diz «configurar» para tentares outra vez com mais detalhe.`);
  if (wrote.problems.length) lines.push(`- Skipped: ${wrote.problems.join('; ')}.`);
  lines.push(`Entram em vigor na próxima tarefa. Experimenta: escolhe ${d} na barra de tarefas e escreve "${wrote.tryTask || 'o trabalho que descreveste, para um cliente real'}". Se o resultado não estiver bem, devolve-o com "revise: …" e eu lembro-me da correção. Edita os ficheiros quando quiseres; são teus.`);
  return { reply: lines.join('\n'), wrote };
}

/** Claude turns the answers into briefs + one skill, and they are written into the brain. */
export async function writeUp(answers, ctx) {
  const { dept, deptName: d, lead, agents, connected = [], brainPath, ask, business = '' } = ctx;
  const roster = agents.map(a => `- ${a.id} · ${a.name}${a.lead ? ' (lead)' : ''} · ${a.role} · ${a.does}`).join('\n');
  const system = `Transformas as respostas de uma entrevista ao proprietário em instruções de trabalho para os agentes de IA do departamento ${d} de ${business || 'o seu negócio'}. Devolve APENAS um objeto JSON, sem prosa, sem blocos de código.`;
  const user = `Agentes em ${d} (id · nome · função · o que fazem):\n${roster}\n\nFerramentas ligadas: ${connected.join(', ') || 'nenhuma'}\n\nAs respostas do proprietário:\n` +
    answers.map(x => `P: ${x.q}\nR: ${x.a}`).join('\n\n') + '\n\n' +
    'Escreve:\n' +
    '1. "briefs": para cada agente cujo trabalho as respostas tocam (o líder sempre), um briefing — as instruções permanentes do proprietário\'s para esse agente em 2–6 frases curtas, segunda pessoa, concretas, nas palavras do proprietário\'s Tom, linhas vermelhas, a quem escalar, que ferramenta usar. Só o que o proprietário disse ou implicou claramente; nunca inventes um processo. Salta os agentes sobre os quais as respostas nada dizem.\n' +
    '2. "skill": UMA competência para o trabalho que o proprietário mais descreveu (pergunta 2), ou null se não descreveu nenhum. name = short kebab-case; description = one line; agents = os ids que fazem este trabalho (1–3); body = Markdown: um título, depois a primeira linha a dizer quando esta competência se aplica, depois "## Steps" (numerados, o que ler ou verificar primeiro, pelo nome da nota se o proprietário a nomeou), "## The shape" (as secções da coisa acabada), "## Rules" (curtas, absolutas, saídas das linhas vermelhas). Menos de 3000 caracteres. template = the finished thing\'s em Markdown com as secções do proprietário\'e marcadores em {chavetas}, ou "" se o proprietário não deu forma.\n' +
    '3. "try": uma tarefa, menos de 90 caracteres, que o proprietário possa escrever para testar isto, nas palavras dele.\n' +
    'Devolve: {"briefs":[{"id":"<id do agente>","brief":"<texto>"}],"skill":{"name":"","description":"","agents":[],"body":"","template":""}|null,"try":""}';
  let j = null; try { const t = await ask(system, user, { maxTokens: 3000, timeout: 180000 }); const s = t.replace(/```json|```/g, ''); j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch (e) { j = { briefs: [], skill: null, try: '', error: e.message }; }
  const ids = new Set(agents.map(a => a.id)); const problems = [];
  if (j.error) problems.push('O Claude não devolveu instruções utilizáveis (' + j.error.split('\n')[0] + ')');
  // briefs → <brain>/Órbita/agents.json (merged: other agents and other fields untouched)
  const briefs = (Array.isArray(j.briefs) ? j.briefs : []).filter(b => b && ids.has(b.id) && String(b.brief || '').trim()).map(b => ({ id: b.id, brief: String(b.brief).trim().slice(0, 2000) }));
  for (const b of (Array.isArray(j.briefs) ? j.briefs : [])) if (b && b.id && !ids.has(b.id)) problems.push(`"${b.id}" não está em ${d}`);
  const agentsFile = path.join(brainPath, 'Órbita', 'agents.json');
  if (briefs.length) {
    fs.mkdirSync(path.dirname(agentsFile), { recursive: true });
    let doc = { agents: [] }; try { const x = JSON.parse(fs.readFileSync(agentsFile, 'utf8')); if (Array.isArray(x?.agents)) doc = x; } catch {}
    for (const b of briefs) { const e = doc.agents.find(x => x && x.id === b.id); if (e) e.brief = b.brief; else doc.agents.push({ id: b.id, brief: b.brief }); }
    fs.writeFileSync(agentsFile, JSON.stringify(doc, null, 2) + '\n');
  }
  // the skill → <brain>/Órbita/skills/<name>/SKILL.md (+ template.md)
  let skill = null;
  if (j.skill && typeof j.skill === 'object' && String(j.skill.body || '').trim()) {
    const name = String(j.skill.name || `${dept}-job`).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || `${dept}-job`;
    let bound = (Array.isArray(j.skill.agents) ? j.skill.agents : []).filter(id => ids.has(id));
    if (!bound.length) bound = [lead.id];
    const dir = path.join(brainPath, 'Órbita', 'skills', name);
    if (fs.existsSync(path.join(dir, 'SKILL.md'))) { const bak = path.join(dir, `SKILL.md.backup-${Date.now()}`); fs.copyFileSync(path.join(dir, 'SKILL.md'), bak); problems.push(`uma competência chamada ${name} já existia — o SKILL.md antigo fica ao lado as ${path.basename(bak)}`); }
    fs.mkdirSync(dir, { recursive: true });
    const description = String(j.skill.description || '').replace(/\n/g, ' ').trim().slice(0, 160);
    const body = String(j.skill.body).trim().slice(0, 6000);
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\nagents: [${bound.join(', ')}]\n---\n${body}\n`);
    const template = String(j.skill.template || '').trim();
    if (template) fs.writeFileSync(path.join(dir, 'template.md'), template.slice(0, 4000) + '\n');
    skill = { name, description, agents: bound, dir: path.relative(process.cwd(), dir), template: !!template };
  }
  if (ctx.afterWrite) ctx.afterWrite();
  return { briefs, skill, agentsFile: path.relative(process.cwd(), agentsFile), problems, tryTask: String(j.try || '').trim().slice(0, 90) };
}
