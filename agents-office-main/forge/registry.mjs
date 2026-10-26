// Órbita Forge — o REGISTO (27 out 2026).
//
// Uma ferramenta não vive na memória do servidor: vive em disco, com nome, versão e autoria, para
// sobreviver a um reinício — e para que o dono possa abrir o ficheiro e ler o que o agente escreveu.
//
//   data/forge/tools/<sala>/<id>/manifest.json     o que a ferramenta é
//   data/forge/tools/<sala>/<id>/v3.tool.js        o código dessa versão (as antigas ficam: histórico)
//   data/forge/usage.json                          quantas vezes correu, quantas falhou, quanto somou
//   data/forge/scratch/<sala>/<agente>/            o rascunho privado (scope scratch:write)
//
// As escritas são atómicas (ficheiro temporário + rename): um servidor que morra a meio de uma
// gravação não deixa um manifesto truncado a apontar para um código que não existe.
import fs from 'node:fs';
import path from 'node:path';
import { checkManifest, brief } from './manifest.mjs';

export const paths = (root) => ({
  root,
  tools: path.join(root, 'tools'),
  usage: path.join(root, 'usage.json'),
  scratch: path.join(root, 'scratch'),
  log: path.join(root, 'log.ndjson'),
});

function ensure(dir) { fs.mkdirSync(dir, { recursive: true }); }
function atomic(file, text) {
  ensure(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

export function init(root) {
  const P = paths(root);
  ensure(P.tools); ensure(P.scratch);
  if (!fs.existsSync(P.usage)) atomic(P.usage, '{}\n');
  return P;
}

export function rooms(root) {
  try {
    return fs.readdirSync(path.join(root, 'tools'), { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}

/** todas as ferramentas (opcionalmente de uma sala), já com as estatísticas do uso real. */
export function list(root, room = null) {
  const out = [];
  const usage = readJSON(path.join(root, 'usage.json'), {});
  for (const r of room ? [room] : rooms(root)) {
    let ids = [];
    try { ids = fs.readdirSync(path.join(root, 'tools', r), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { continue; }
    for (const id of ids) {
      const dir = path.join(root, 'tools', r, id);
      const m = readJSON(path.join(dir, 'manifest.json'), null);
      if (!m) continue;
      const u = usage[`${r}/${id}`] || {};
      out.push({ ...m, stats: { runs: u.runs || 0, failures: u.failures || 0, ms: u.ms || 0, lastAt: u.lastAt || 0 } });
    }
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

export function get(root, room, id) {
  return list(root, room).find((m) => m.id === id) || null;
}

export function source(root, room, id, version) {
  const m = get(root, room, id);
  if (!m) return null;
  const v = version || m.version;
  try { return fs.readFileSync(path.join(root, 'tools', room, id, `v${v}.tool.js`), 'utf8'); } catch { return null; }
}

/**
 * Grava uma versão nova. Recebe o manifesto sem `version` (ou com ela) e o código; a versão é
 * sempre a última + 1, para que nada seja reescrito por engano — o histórico é a memória da
 * oficina, e uma ferramenta que piora tem de poder voltar atrás.
 */
export function save(root, manifest, code, { rooms: roomKeys = [], agents = [] } = {}) {
  const dir = path.join(root, 'tools', manifest.room, manifest.id);
  ensure(dir);
  const prev = readJSON(path.join(dir, 'manifest.json'), null);
  const version = (prev?.version || 0) + 1;
  const now = Date.now();
  const next = {
    ...manifest,
    version, updatedAt: now,
    createdAt: prev?.createdAt || now,
    state: manifest.state || 'draft',
    stats: prev?.stats || { runs: 0, failures: 0, ms: 0 },
    origin: manifest.origin || prev?.origin || { room: manifest.room, id: manifest.id, version },
    code: `v${version}.tool.js`,
  };
  const check = checkManifest({ ...next, code }, { rooms: roomKeys, agents });
  if (!check.ok) return { ok: false, problems: check.problems };
  // o cabeçalho leva o marcador `//~` para que uma adopção saiba o que é proveniência e o que é
  // código do autor (sem este marcador, adoptar uma ferramenta apagava-lhe os comentários)
  const header = [
    `//~ ${next.name} · v${version} · sala ${next.room} · autor ${next.author}`,
    `//~ ${next.summary}`,
    `//~ escopos: ${next.scopes.join(', ')}`,
    `//~ forjada pela oficina do Órbita em ${new Date(now).toISOString()}`,
  ].join('\n');
  atomic(path.join(dir, `v${version}.tool.js`), `${header}\n\n${code}\n`);
  atomic(path.join(dir, 'manifest.json'), JSON.stringify(next, null, 2) + '\n');
  return { ok: true, manifest: next };
}

export function setState(root, room, id, state) {
  const m = get(root, room, id);
  if (!m) return null;
  const next = { ...m, state, updatedAt: Date.now() };
  atomic(path.join(root, 'tools', room, id, 'manifest.json'), JSON.stringify(next, null, 2) + '\n');
  return next;
}

/** regista uma execução real. `failures` conta execuções que rebentaram, não provas falhadas. */
export function record(root, room, id, { ok, ms }) {
  const file = path.join(root, 'usage.json');
  const usage = readJSON(file, {});
  const key = `${room}/${id}`;
  const u = usage[key] || { runs: 0, failures: 0, ms: 0, lastAt: 0 };
  u.runs += 1;
  if (!ok) u.failures += 1;
  u.ms += Math.max(0, Math.round(ms || 0));
  u.lastAt = Date.now();
  usage[key] = u;
  atomic(file, JSON.stringify(usage, null, 2) + '\n');
  return u;
}

/**
 * Adopção: uma ferramenta nascida numa sala passa a existir noutra, com proveniência guardada.
 * É o que transforma seis oficinas em escritório — o que a MEDIA aprendeu, as VENDAS não têm de
 * reaprender. A cópia nasce em rascunho: cada sala prova-a contra os seus próprios dados.
 */
export function adopt(root, { room, id, to, author, agents = [], rooms: roomKeys = [] }) {
  const m = get(root, room, id);
  if (!m) return { ok: false, problems: [`não há ${room}/${id}`] };
  const code = source(root, room, id);
  if (!code) return { ok: false, problems: ['o código da versão actual não está em disco'] };
  const body = code.split('\n').filter((l) => !l.startsWith('//~ ')).join('\n').trim();
  return save(root, {
    ...m, room: to, author: author || m.author, id: m.id, state: 'draft',
    origin: { room, id, version: m.version }, stats: { runs: 0, failures: 0, ms: 0 },
  }, body, { rooms: roomKeys, agents });
}

export { brief };
