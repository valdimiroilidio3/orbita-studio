// Órbita — the agents learn from your corrections (Beta).
// Every time a deliverable is sent back ("revise: …" in the chat), the correction is written to
//   <brain>/Órbita/feedback/<agent-id>.md
// Claude sorts it: a one-off about that task, or a standing rule that should apply every time.
// Standing rules are read by that agent before every task and chat turn. The file is yours:
// edit a rule, delete a line to unlearn it, move a line up to "Standing rules" to promote it.
import fs from 'node:fs';
import path from 'node:path';

export const dir = brainPath => path.join(brainPath, 'Órbita', 'feedback');
const file = (brainPath, id) => path.join(dir(brainPath), id + '.md');
const MAX_RULES = 15; // the most recent standing rules an agent carries into a task
const HEAD = (a) => `# Correções para ${a.name} (${a.id})\n\n` +
  'Sempre que o proprietário devolve o trabalho deste agente\'devolve o trabalho, a correção aterra aqui. Linhas abaixo de\n' +
  '"Standing rules" são lidas por este agente antes de cada tarefa e de cada conversa. Edita à vontade: reescreve uma\n' +
  'regra, apaga uma linha para a desaprender, sobe uma pontual para a tornar regra. Quando uma regra é na verdade um\n' +
  'processo, pertence a uma competência (SKILLS.md).\n\n## Standing rules\n\n## One-offs\n';

/** Read the file → { rules: [...], oneOffs: [...] } (each a line without the leading "- "). */
export function read(brainPath, id) {
  const p = file(brainPath, id); if (!fs.existsSync(p)) return { rules: [], oneOffs: [] };
  const out = { rules: [], oneOffs: [] }; let sec = null;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^##\s+standing rules/i.test(line)) { sec = 'rules'; continue; }
    if (/^##\s+one-offs/i.test(line)) { sec = 'oneOffs'; continue; }
    if (/^##?\s/.test(line)) { sec = null; continue; }
    const m = line.match(/^\s*[-*]\s+(.+)$/); if (m && sec) out[sec].push(m[1].trim());
  }
  return out;
}

/** Append one correction. `verdict` = { standing, rule } from classify(), or null when Claude was unavailable. */
export function record(brainPath, agent, task, feedback, verdict) {
  fs.mkdirSync(dir(brainPath), { recursive: true });
  const p = file(brainPath, agent.id);
  let text = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : HEAD(agent);
  if (!/^## Standing rules/m.test(text)) text += '\n## Standing rules\n'; if (!/^## One-offs/m.test(text)) text += '\n## One-offs\n';
  const date = new Date().toISOString().slice(0, 10);
  const quote = String(feedback).replace(/\s+/g, ' ').trim().slice(0, 160);
  const ctx = task?.title ? ` (${String(task.title).slice(0, 60)})` : '';
  const standing = !!(verdict && verdict.standing && verdict.rule);
  const line = standing ? `- ${date} · ${String(verdict.rule).replace(/\s+/g, ' ').trim().slice(0, 240)} ← "${quote}"${ctx}` : `- ${date} · "${quote}"${ctx}`;
  const insertAfter = standing ? /^## Standing rules[^\n]*\n/m : /^## One-offs[^\n]*\n/m;
  const m = text.match(insertAfter);
  // append at the END of that section (before the next "## " or the end of the file)
  const start = m.index + m[0].length; const rest = text.slice(start); const next = rest.search(/^## /m);
  const end = next < 0 ? text.length : start + next;
  const before = text.slice(0, end).replace(/\s*$/, '\n'); const after = text.slice(end);
  text = before + line + '\n' + (after && !after.startsWith('\n') ? '\n' : '') + after;
  fs.writeFileSync(p, text);
  return { standing, line, path: p };
}

/** Ask Claude whether a correction is a one-off or a standing rule. `ask(system, user)` → text. */
export async function classify(ask, agent, task, feedback) {
  const system = 'Classificas o comentário\'do proprietário sobre um agente de IA\'deste agente. Devolve APENAS um objeto JSON, sem prosa, sem blocos de código.';
  const user = `Agent: ${agent.name} — ${agent.role}. ${agent.does}\nTask: ${task?.title || ''}\nOwner's feedback: "${feedback}"\n\n` +
    'Isto é uma PONTUAL (sobre esta tarefa, este cliente, este rascunho) ou uma REGRA PERMANENTE (uma preferência que o proprietário vai querer em todo o trabalho futuro deste tipo)?\n' +
    'Sinais de uma regra permanente: "always", "never", "from now on", "we don\'t", uma preferência de formato ou tom, uma linha vermelha. Sinais de uma pontual: um facto sobre este cliente, uma alteração só a este rascunho, "this time", "here".\n' +
    'Return: {"standing": true|false, "rule": "<if standing: the preference as ONE short imperative sentence, general, no client or project names; else empty string>"}';
  try {
    const j = JSON.parse((await ask(system, user, { maxTokens: 200, timeout: 60000 })).replace(/```json|```/g, '').trim());
    return { standing: !!j.standing && !!j.rule, rule: String(j.rule || '').trim() };
  } catch { return null; }
}

/** The block for an agent's system prompt: its standing rules, newest last. */
export function promptText(brainPath, agent) {
  const { rules } = read(brainPath, agent.id); if (!rules.length) return '';
  const recent = rules.slice(-MAX_RULES).map(r => '- ' + r.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, '').replace(/\s*←\s*".*$/, ''));
  return 'LIÇÕES — o que o proprietário corrigiu antes. Aplica todas, sempre, sem que te peçam:\n' + recent.join('\n');
}
export const count = (brainPath, id) => read(brainPath, id).rules.length;
