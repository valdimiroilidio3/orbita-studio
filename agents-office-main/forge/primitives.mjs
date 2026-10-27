// Órbita Forge — as PRIMITIVAS (27 out 2026).
//
// Uma ferramenta não fala com o sistema de ficheiros nem com a rede: fala com estas funções. É
// assim que uma ferramenta escrita por um agente continua a ser uma ferramenta do escritório e
// não um programa solto. Cada primitiva devolve JSON simples (nada de handles, nada de classes) e
// cada uma está atrás de um escopo que o manifesto declara e que o dono pode ler antes de activar.
//
// Aqui não há dados de demonstração: as notas são as do cérebro, as tarefas são as de
// data/tasks.json e os documentos são os de docs/. Se o cérebro estiver vazio, a primitiva diz
// zero — não inventa uma amostra.
import fs from 'node:fs';
import path from 'node:path';

const MAX_NOTE = 60_000;   // nota maior do que isto é cortada: a ferramenta não é um despejo
const MAX_DOCS = 400;

function walk(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

const wordCount = (s) => (String(s).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
const lineCount = (s) => String(s).split(/\r?\n/).filter((l) => l.trim()).length;

function readTasks(dataDir) {
  try { const l = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks.json'), 'utf8')); return Array.isArray(l) ? l : []; }
  catch { return []; }
}

/**
 * Constrói o contexto que uma ferramenta recebe. `fn` é o registo de chamadas (para o terminal
 * poder dizer o que a ferramenta leu de facto, e quanto custou).
 */
export function makeContext({ brainDir, dataDir, docsDir, scratchDir, scopes = [], room, agent, log = () => {}, dry = false }) {
  const has = (s) => scopes.includes(s);
  const deny = (s) => { throw new Error(`escopo em falta: ${s}`); };
  const started = Date.now();
  const reads = [];
  let brainCache = null;

  const notes = () => {
    if (!has('brain:read')) deny('brain:read');
    if (brainCache) return brainCache;
    brainCache = walk(brainDir).map((file) => {
      let text = '';
      try { text = fs.readFileSync(file, 'utf8').slice(0, MAX_NOTE); } catch { text = ''; }
      const name = path.relative(brainDir, file).replace(/\\/g, '/').replace(/\.md$/i, '');
      const links = [...text.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1].trim()).filter(Boolean);
      return { name, title: (text.match(/^#\s+(.+)$/m) || [, name])[1].trim(), text, links, size: text.length, words: wordCount(text) };
    });
    reads.push(`brain: ${brainCache.length} notas`);
    return brainCache;
  };

  const scratchFile = (name) => {
    const safe = String(name || 'rascunho').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 60);
    return path.join(scratchDir, safe.endsWith('.md') ? safe : `${safe}.md`);
  };

  const ctx = {
    room, agent,
    /* --- cérebro ------------------------------------------------------- */
    brain: {
      /* `notes()` devolve o FICHEIRO DE ROSTO de cada nota — nome, título, links, peso — e não o
         texto todo: 41 notas inteiras não passam pelo tecto de saída, e uma ferramenta que precisa
         do texto pede-o nota a nota com `read()`. Assim a memória da ferramenta é a nota que ela
         escolheu, não o cérebro inteiro. */
      notes() {
        return notes().map(({ name, title, links, size, words }) => ({ name, title, links, size, words }));
      },
      read(name) {
        const q = String(name || '').toLowerCase();
        const hit = notes().find((n) => n.name.toLowerCase() === q || n.name.toLowerCase().endsWith('/' + q))
          || notes().find((n) => n.name.toLowerCase().includes(q));
        return hit ? hit.text.slice(0, 12000) : null;      // uma nota de 60 mil caracteres não é contexto
      },
      search(term, { limit = 8 } = {}) {
        const q = String(term || '').toLowerCase().trim();
        if (!q) return [];
        const out = [];
        for (const n of notes()) {
          const at = n.text.toLowerCase().indexOf(q);
          if (at < 0) continue;
          const from = Math.max(0, at - 70), to = Math.min(n.text.length, at + q.length + 90);
          out.push({ name: n.name, title: n.title, line: n.text.slice(from, to).replace(/\s+/g, ' ').trim(), links: n.links.length });
          if (out.length >= limit) break;
        }
        return out;
      },
      writeNote(name, body) {
        if (!has('brain:write')) deny('brain:write');
        /* `dry` é o ensaio: a prova de uma ferramenta que escreve não pode sujar o cérebro. Corre
           tudo menos o `writeFileSync`, e o resultado diz `dry: true` — mentir aqui seria pior do
           que não provar. */
        if (dry) {
          const rel = path.join('Órbita', 'oficina', `${String(name || 'nota').replace(/[^a-zA-Z0-9 _.-]/g, '-')}.md`);
          return { file: rel, bytes: String(body || '').length, dry: true };
        }
        const safe = String(name || 'nota').replace(/[^a-zA-Z0-9 _.-]/g, '').trim().slice(0, 70) || 'nota';
        const dir = path.join(brainDir, 'Órbita', 'oficina');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${safe}.md`);
        const at = new Date().toISOString();
        const text = `# ${safe}\n\n_escrita pela oficina de ${agent || 'um agente'} · ${at}_\n\n${String(body || '').trim()}\n`;
        fs.writeFileSync(file, text);
        brainCache = null;
        reads.push(`brain: escreveu ${path.relative(brainDir, file)}`);
        return { file: path.relative(brainDir, file), bytes: text.length };
      },
    },
    /* --- tarefas ------------------------------------------------------- */
    tasks: {
      list() {
        if (!has('tasks:read')) deny('tasks:read');
        const l = readTasks(dataDir);
        reads.push(`tarefas: ${l.length}`);
        return l.map((t) => ({
          id: t.id, title: t.title, dept: t.dept, agent: t.agent, state: t.state,
          createdAt: t.createdAt || 0, dueAt: t.dueAt || 0, completedAt: t.completedAt || 0,
        }));
      },
      stats() {
        const l = this.list();
        const by = {};
        let oldest = null;
        for (const t of l) {
          by[t.state] = (by[t.state] || 0) + 1;
          if (['waiting', 'live', 'queued', 'scheduled'].includes(t.state) && (!oldest || t.createdAt < oldest.createdAt)) oldest = t;
        }
        return { total: l.length, by, oldest };
      },
    },
    /* --- documentação do projecto -------------------------------------- */
    docs: {
      list() {
        if (!has('docs:read')) deny('docs:read');
        const root = docsDir;
        const files = [];
        try {
          for (const e of fs.readdirSync(root, { withFileTypes: true })) {
            if (e.isFile() && e.name.toLowerCase().endsWith('.md')) files.push(path.join(root, e.name));
            if (files.length >= MAX_DOCS) break;
          }
        } catch { /* sem docs/ é um estado válido */ }
        reads.push(`docs: ${files.length}`);
        return files.map((f) => {
          let text = '';
          try { text = fs.readFileSync(f, 'utf8'); } catch { text = ''; }
          return {
            name: path.basename(f), bytes: text.length, words: wordCount(text),
            headings: (text.match(/^#{1,6}\s+\S/gm) || []).length,
          };
        });
      },
    },
    /* --- texto (puro, não toca em nada) -------------------------------- */
    text: {
      words: wordCount,
      lines: lineCount,
      top(text, n = 5) {
        const stop = new Set(('a o e de da do das dos que em um uma para com não por se na no os as ao à é já mais como mas ou ser ter foi são está também há muito quando entre sobre ainda pode').split(' '));
        const freq = new Map();
        for (const w of (String(text).toLowerCase().match(/[\p{L}]{4,}/gu) || [])) {
          if (stop.has(w)) continue;
          freq.set(w, (freq.get(w) || 0) + 1);
        }
        return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, n).map(([palavra, vezes]) => ({ palavra, vezes }));
      },
      clip: (s, n = 400) => String(s).slice(0, n),
    },
    /* --- rascunho privado ---------------------------------------------- */
    scratch: {
      write(name, body) {
        if (!has('scratch:write')) deny('scratch:write');
        if (dry) return { file: scratchFile(name).split('/').pop(), bytes: String(body ?? '').length, dry: true };
        fs.mkdirSync(scratchDir, { recursive: true });
        const file = scratchFile(name);
        fs.writeFileSync(file, String(body ?? ''));
        reads.push(`scratch: ${path.basename(file)}`);
        return { file: path.basename(file), bytes: String(body ?? '').length };
      },
      read(name) {
        try { return fs.readFileSync(scratchFile(name), 'utf8'); } catch { return null; }
      },
    },
    clock: {
      now: () => Date.now(),
      iso: () => new Date().toISOString(),
      minutesSince: (ms) => Math.max(0, Math.round((Date.now() - Number(ms || 0)) / 60000)),
    },
    log: (...a) => log(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')),
    /* o que a ferramenta leu de facto — entra no registo de auditoria, não no resultado */
    __reads: () => reads.slice(),
    __ms: () => Date.now() - started,
  };
  return ctx;
}

/** o catálogo que o agente vê no prompt: as primitivas e o que cada uma faz. */
export const PRIMITIVE_DOC = `PRIMITIVAS (o único caminho para os dados):
  ctx.brain.notes()                  → [{ name, title, words, links, size }]  (brain:read)
  ctx.brain.search(termo, {limit})   → [{ name, title, line }]          (brain:read)
  ctx.brain.read(nome)               → texto da nota ou null            (brain:read)
  ctx.brain.writeNote(nome, corpo)   → { file, bytes }                  (brain:write · pede dono)
  ctx.tasks.list()                   → [{ id, title, dept, state, createdAt }]  (tasks:read)
  ctx.tasks.stats()                  → { total, by, oldest }            (tasks:read)
  ctx.docs.list()                    → [{ name, bytes, words, headings }] (docs:read)
  ctx.text.words(s) · .lines(s) · .top(s, n) · .clip(s, n)
  ctx.scratch.write(nome, corpo) · .read(nome)                          (scratch:write)
  ctx.clock.now() · .iso() · .minutesSince(ms) · ctx.log(...)`;
