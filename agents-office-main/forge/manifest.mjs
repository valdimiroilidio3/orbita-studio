// Órbita Forge — o MANIFESTO de uma ferramenta (27 out 2026).
//
// Porque é que isto existe. Um agente que escreve o próprio código é útil e é perigoso, pela
// mesma ordem. A resposta não é confiar no modelo nem proibir tudo: é obrigar a que cada
// ferramenta se APRESENTE antes de correr — o que faz, quem a escreveu, que dados toca, com que
// entradas, e que provas tem de passar. Tudo o que não se apresenta bem não entra no catálogo.
//
// Este ficheiro é puro (sem fs, sem servidor): valida o manifesto e lê o código à procura do que
// uma ferramenta não pode fazer. Os testes chamam-no directamente.

/** O que uma ferramenta pode tocar. Um escopo é uma promessa que o dono pode ler. */
export const SCOPES = {
  'brain:read': 'ler as notas do cérebro',
  'brain:write': 'escrever uma nota no cérebro (pede aprovação do dono para activar)',
  'tasks:read': 'ler as tarefas do escritório',
  'docs:read': 'ler a documentação do projecto',
  'scratch:write': 'escrever no rascunho privado do agente',
};
export const SCOPE_KEYS = Object.keys(SCOPES);
/** escopos que mexem em algo fora da memória da ferramenta: ficam em rascunho até o dono activar. */
export const WRITE_SCOPES = SCOPE_KEYS.filter((s) => s.endsWith(':write') && !s.startsWith('scratch:'));

export const LIMITS = {
  code: 8000,        // caracteres de código
  name: 46,
  summary: 220,
  examples: 4,       // no máximo quatro provas por ferramenta
  expect: 160,       // a expressão de cada prova
  timeoutMs: 400,    // tempo de CPU por execução (o `vm` corta-o à força)
  output: 24000,     // caracteres do resultado (o que não couber é cortado, não rebenta)
};

/* ---------- o que uma ferramenta NÃO pode escrever ----------
   O `vm` do Node já impede `import`, `require` e `process` não existirem no contexto; esta lista
   é a segunda vedação — apanha o código *antes* de correr, e diz ao dono o que viu. Não é uma
   fronteira de segurança absoluta (isso é o `--permission` do Node, documentado no FORGE.md): é
   uma vedação prática contra o que um modelo distraído escreve sem má intenção. */
export const UNSAFE = [
  [/\brequire\s*\(/, 'require()'],
  [/\bimport\s*[({'"]/, 'import'],
  [/\bimport\s*\(/, 'import() dinâmico'],
  [/\bprocess\b/, 'process'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\bglobal\b/, 'global'],
  [/\bFunction\s*\(/, 'Function()'],
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\b/, 'new Function'],
  [/\bconstructor\b/, 'constructor (escape de protótipo)'],
  [/__proto__/, '__proto__'],
  [/\bprototype\b/, 'prototype'],
  [/\bReflect\b/, 'Reflect'],
  [/\bProxy\b/, 'Proxy'],
  [/\bWebAssembly\b/, 'WebAssembly'],
  [/\bsetTimeout\b|\bsetInterval\b/, 'temporizadores'],
  [/\bchild_process\b/, 'child_process'],
  [/\bnode:fs\b|\bnode:http\b|\bnode:net\b/, 'módulos do Node'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b/, 'rede'],
  [/\bDeno\b|\bBun\b/, 'runtimes alternativos'],
  [/\bwhile\s*\(\s*true\s*\)/, 'ciclo infinito (while true)'],
  [/\bfor\s*\(\s*;\s*;\s*\)/, 'ciclo infinito (for vazio)'],
];

/** devolve a lista de coisas proibidas que o código contém (vazia = pode passar). */
export function unsafeCode(code) {
  const hits = [];
  const src = String(code || '');
  for (const [re, name] of UNSAFE) {
    const m = src.match(re);
    if (!m) continue;
    // a linha, para o terminal poder apontar onde está
    const at = src.slice(0, m.index).split('\n').length;
    hits.push({ what: name, line: at, text: src.split('\n')[at - 1].trim().slice(0, 90) });
  }
  return hits;
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,38}$/;
export const slugOf = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38);

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * Valida um manifesto por inteiro. Devolve `{ ok, problems }` — nunca atira: o chamador decide o
 * que dizer ao terminal. `rooms` e `agents` vêm do escritório real (src/data.js), para que uma
 * ferramenta não possa nascer numa sala que não existe.
 */
export function checkManifest(m, { rooms = [], agents = [] } = {}) {
  const p = [];
  if (!isPlain(m)) return { ok: false, problems: ['o manifesto não é um objecto'] };

  if (!SLUG.test(String(m.id || ''))) p.push(`id inválido ("${m.id}") — minúsculas, números e hífens, 2 a 39`);
  if (rooms.length && !rooms.includes(m.room)) p.push(`sala desconhecida ("${m.room}")`);
  if (agents.length && !agents.includes(m.author)) p.push(`autor desconhecido ("${m.author}")`);
  if (!String(m.name || '').trim()) p.push('falta o nome');
  if (String(m.name || '').length > LIMITS.name) p.push(`o nome passa de ${LIMITS.name} caracteres`);
  if (!String(m.summary || '').trim()) p.push('falta o resumo — o que a ferramenta faz, em uma frase');
  if (String(m.summary || '').length > LIMITS.summary) p.push(`o resumo passa de ${LIMITS.summary} caracteres`);

  const scopes = Array.isArray(m.scopes) ? m.scopes : [];
  if (!scopes.length) p.push('a ferramenta não declara um único escopo (o que toca?)');
  for (const s of scopes) if (!SCOPE_KEYS.includes(s)) p.push(`escopo desconhecido ("${s}")`);
  if (new Set(scopes).size !== scopes.length) p.push('escopos repetidos');

  // a versão é dada pelo registo ao gravar (v1, v2, …); um manifesto ainda não gravado não a tem
  if (m.version != null && (!Number.isInteger(m.version) || m.version < 1)) p.push('versão inválida');
  if (m.state != null && !['draft', 'active', 'broken', 'retired'].includes(m.state)) p.push(`estado inválido ("${m.state}")`);

  const inputs = m.inputs == null ? {} : m.inputs;
  if (!isPlain(inputs)) p.push('`inputs` tem de ser um objecto { nome: { tipo, default, descrição } }');
  else for (const [k, v] of Object.entries(inputs)) {
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(k)) p.push(`nome de entrada inválido ("${k}")`);
    if (!isPlain(v) || !['string', 'number', 'boolean', 'object'].includes(v.type)) p.push(`entrada "${k}" sem tipo válido`);
  }

  const code = String(m.code || '');
  if (!code.trim()) p.push('a ferramenta não tem código');
  if (code.length > LIMITS.code) p.push(`o código passa de ${LIMITS.code} caracteres`);
  if (code && !/\bfunction\s+run\s*\(/.test(code) && !/\brun\s*=/.test(code)) p.push('o código não define `function run(input, ctx)`');
  for (const u of unsafeCode(code)) p.push(`código proibido: ${u.what} (linha ${u.line})`);

  const ex = Array.isArray(m.examples) ? m.examples : [];
  if (!ex.length) p.push('sem provas: uma ferramenta tem de trazer pelo menos um exemplo');
  if (ex.length > LIMITS.examples) p.push(`demasiadas provas (${ex.length} > ${LIMITS.examples})`);
  ex.forEach((e, i) => {
    if (!isPlain(e)) { p.push(`prova ${i + 1} não é um objecto`); return; }
    if (e.input != null && !isPlain(e.input)) p.push(`prova ${i + 1}: \`input\` tem de ser um objecto`);
    if (!String(e.expect || '').trim()) p.push(`prova ${i + 1}: falta \`expect\` (a expressão que tem de ser verdadeira)`);
    else if (String(e.expect).length > LIMITS.expect) p.push(`prova ${i + 1}: \`expect\` é comprida demais`);
    else {
      const bad = unsafeCode(String(e.expect));
      if (bad.length) p.push(`prova ${i + 1}: \`expect\` com código proibido (${bad[0].what})`);
      if (!/\bresult\b/.test(String(e.expect))) p.push(`prova ${i + 1}: \`expect\` tem de olhar para \`result\``);
    }
  });

  return { ok: p.length === 0, problems: p };
}

/** Um retrato curto do manifesto, para o terminal e para a API. */
export function brief(m) {
  return {
    id: m.id, room: m.room, author: m.author, name: m.name, summary: m.summary,
    version: m.version, state: m.state, scopes: m.scopes,
    examples: (m.examples || []).length, auto: !!m.auto,
    runs: m.stats?.runs || 0, failures: m.stats?.failures || 0, ms: m.stats?.ms || 0,
    origin: m.origin || null, recipe: m.recipe || null, need: m.need || null,
    updatedAt: m.updatedAt || m.createdAt || 0,
  };
}
