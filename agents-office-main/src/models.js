// Órbita V3.6 — the three models, by name. Shared by the page and the server.
// AJ (9 Sep 2026): "it is either Opus, Sonnet, or Fable. That's it." Sonnet is the default for
// everything, including the routing call. Effort lives inside the name (Opus runs at high); nobody
// sees an effort setting. Four places, one precedence: the task beats the routine beats the agent
// beats the office default.
import { parDeModelo, etiquetaDoModelo } from './lista-modelos.js';
// V3.6.1 (10 Sep 2026): AJ asked for an EFFORT selection beside the model. Five levels as the CLI
// names them; AUTO (empty) = the model's own default (Opus runs at high). Same four places, same
// precedence as the model, then the model's own.
export const MODELS = {
  sonnet: { key: 'sonnet', name: 'Sonnet', flag: 'sonnet', id: 'claude-sonnet-5' },
  opus:   { key: 'opus',   name: 'Opus',   flag: 'opus',   id: 'claude-opus-5', effort: 'high' },
  fable:  { key: 'fable',  name: 'Fable',  flag: 'fable',  id: 'claude-fable-5-1' },
};
export const MODEL_KEYS = ['sonnet', 'opus', 'fable'];
export const DEFAULT_MODEL = 'sonnet';
export const FROM_TEXT = { task: 'esta tarefa', routine: 'esta rotina', agent: 'este agente', office: 'padrão do escritório', model: 'o do próprio modelo' };
export const EFFORT_KEYS = ['low', 'medium', 'high', 'xhigh', 'max'];
// 27 out 2026: em português. O tooltip já dizia «Baixo a Máximo como o Claude Code os designa»
// enquanto o menu mostrava LOW · MEDIUM · HIGH · X-HIGH · MAX — duas línguas no mesmo sítio.
// As CHAVES não mudam (low/medium/high/xhigh/max): o que vai no pedido para o servidor é o valor.
export const EFFORT_NAME = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };

/** "High" · "xhigh" · "extra high" → the CLI level; empty/auto/unknown → null. */
export function normEffort(s) {
  const t = String(s || '').toLowerCase().replace(/[\s_-]+/g, '').trim();
  if (!t || t === 'auto' || t === 'default') return null;
  if (t === 'extrahigh' || t === 'veryhigh') return 'xhigh';
  if (t === 'maximum') return 'max';
  return EFFORT_KEYS.includes(t) ? t : null;
}
export const effortName = k => EFFORT_NAME[k] || 'Auto';

/** The effort that wins, and where it was set; falls through to the model's own default (may be null = the CLI decides). */
export function effortFor({ task, routine, agent, office, model } = {}) {
  if (normEffort(task)) return { effort: normEffort(task), from: 'task' };
  if (normEffort(routine)) return { effort: normEffort(routine), from: 'routine' };
  if (normEffort(agent)) return { effort: normEffort(agent), from: 'agent' };
  if (normEffort(office)) return { effort: normEffort(office), from: 'office' };
  const m = MODELS[normModel(model)] || MODELS[DEFAULT_MODEL];
  return { effort: m.effort || null, from: 'model' };
}

/** "opus" · "Opus" · "claude-opus-5" → "opus"; anything else → null. */
export function normModel(s) {
  const t = String(s || '').toLowerCase().trim();
  if (!t) return null;
  for (const k of MODEL_KEYS) if (t === k || t.includes(k)) return k;
  return null;
}
/* 1.52.0 · um modelo já não é só um dos três da casa: o painel de tarefas aceita
   qualquer par fornecedor|modelo da IA da Órbita (`src/lista-modelos.js`). O nome
   de um par é o rótulo curto — «Qwen3.5-9B · OVH» —, e o id é o próprio par: é
   ele que viaja para o servidor e para o cartão da tarefa. */
export const modelName = k => (parDeModelo(k) ? etiquetaDoModelo(k) : (MODELS[k] || MODELS[DEFAULT_MODEL]).name);
export const modelId = k => (parDeModelo(k) ? String(k) : (MODELS[k] || MODELS[DEFAULT_MODEL]).id);

/** The one that wins, and where it was set. Each argument is a model key or empty. */
export function modelFor({ task, routine, agent, office } = {}) {
  if (normModel(task)) return { model: normModel(task), from: 'task' };
  if (normModel(routine)) return { model: normModel(routine), from: 'routine' };
  if (normModel(agent)) return { model: normModel(agent), from: 'agent' };
  return { model: normModel(office) || DEFAULT_MODEL, from: 'office' };
}

/** The CLI flags for a model key (+ an explicit effort level, else the model's own). */
export function modelArgs(key, effort) {
  const m = MODELS[normModel(key)] || MODELS[DEFAULT_MODEL];
  const a = ['--model', m.flag];
  const e = normEffort(effort) || m.effort;
  if (e) a.push('--effort', e);
  return a;
}
