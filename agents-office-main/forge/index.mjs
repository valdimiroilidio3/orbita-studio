// Órbita Forge — a OFICINA (27 out 2026).
//
// O contrato, por palavras: cada agente pode pedir uma ferramenta. A oficina escolhe a receita,
// escreve o código, PROVA-O contra os dados reais daquela sala, repara-o se ele se partir (no
// máximo duas vezes), e só então o deixa no catálogo — em rascunho se tocar em algo que escreve.
// A partir daí a ferramenta é da sala: corre antes de cada tarefa (`sense`), aparece no prompt dos
// agentes como o que eles já sabem fazer, e pode ser adoptada por outra sala com proveniência.
//
// Nada aqui inventa números: os resultados vêm das primitivas, que leem o cérebro, as tarefas e a
// documentação que estão em disco. Se a sala não tem tarefas, a ferramenta diz zero.
import path from 'node:path';
import { checkManifest, unsafeCode, brief, WRITE_SCOPES, LIMITS } from './manifest.mjs';
import { makeContext, PRIMITIVE_DOC } from './primitives.mjs';
import { runInSandbox } from './sandbox.mjs';
import { choose, instantiate, repair, recipes, recipe as recipeOf } from './compose.mjs';
import * as registry from './registry.mjs';
import { createBus } from './bus.mjs';

const clip = (v, n = 480) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

export function createForge({
  root, brainDir, dataDir, docsDir,
  rooms = [], agents = [],
  bus = createBus({ file: null }),
  now = () => Date.now(),
} = {}) {
  registry.init(root);

  const emit = (room, agent, tool, phase, text, data) =>
    bus.emit({ room, agent, tool, phase, text, ...(data ? { data } : {}) });

  /** o contexto de uma ferramenta: primitivas com os escopos do manifesto, e a sala onde vive. */
  const ctxFor = (m, { dry = false } = {}) => makeContext({
    brainDir, dataDir, docsDir,
    scratchDir: path.join(root, 'scratch', m.room, m.author || 'anon'),
    scopes: m.scopes || [], room: m.room, agent: m.author, dry,
    log: (line) => emit(m.room, m.author, m.id || null, 'tool-log', line),
  });

  /* ---------- provas ----------
     Uma prova corre a ferramenta contra dados REAIS com o contexto em `dry` quando o manifesto
     escreve. Uma ferramenta que grava uma nota não pode sujar o cérebro só porque está a ser
     testada — e o resultado diz `dry: true`, para ninguém confundir ensaio com escrita. */
  function testSource(source, examples = [], { room, author, scopes = [], dry = true } = {}) {
    const m = { room, author, scopes: scopes || [], id: 'prova' };
    const caps = ctxFor(m, { dry });
    const results = [];
    for (let i = 0; i < examples.length; i++) {
      const ex = examples[i] || {};
      const t0 = now();
      const r = runInSandbox({ source, input: ex.input || {}, caps, expect: ex.expect, timeoutMs: LIMITS.timeoutMs });
      const ok = !!r.ok && r.expect !== false;
      results.push({
        n: i + 1, ok, ms: now() - t0,
        error: r.error || (r.expect === false ? `a prova não se confirmou: ${ex.expect}` : null),
        output: r.ok ? clip(r.result, 300) : null, timedOut: !!r.timedOut,
      });
      if (!ok) break;   // uma prova falhada chega: não vale a pena insistir nas seguintes
    }
    return results;
  }

  /* ---------- execução ---------- */
  function exec(m, source, input, { dry = false } = {}) {
    const caps = ctxFor(m, { dry });
    const r = runInSandbox({ source, input: input || {}, caps, timeoutMs: LIMITS.timeoutMs });
    return { ...r, reads: typeof caps.__reads === 'function' ? caps.__reads() : [] };
  }

  /** corre uma ferramenta (activa por omissão), com auditoria e uso registado. */
  function run({ room, id, input = {}, force = false, agent = null, dry = false, quiet = false }) {
    const m = registry.get(root, room, id);
    if (!m) return { ok: false, error: `não há ferramenta ${room}/${id}` };
    if (m.state !== 'active' && !force) {
      const label = { draft: 'rascunho', broken: 'quebrada', retired: 'retirada' }[m.state] || m.state;
      return { ok: false, error: `${room}/${id} está em ${label} — activa-a primeiro (o dono decide o que escreve)` };
    }
    const source = registry.source(root, room, id);
    if (!source) return { ok: false, error: 'o código não está em disco' };
    const who = agent || m.author;
    if (!quiet) emit(room, who, id, 'run', `▶ ${id} ${clip(input, 120)}`);
    const r = exec({ ...m, author: who }, source, input, { dry });
    registry.record(root, room, id, { ok: r.ok, ms: r.ms });
    if (!quiet) {
      if (r.ok) emit(room, who, id, 'ok', `✓ ${id} · ${r.ms} ms · ${clip(r.result, 320)}`, { ms: r.ms, reads: r.reads });
      else emit(room, who, id, 'fail', `✗ ${id} · ${r.error}`, { ms: r.ms });
      for (const line of r.logs || []) emit(room, who, id, 'tool-log', line);
    }
    if (!r.ok && (m.stats?.failures || 0) + 1 >= 3) {
      registry.setState(root, room, id, 'broken');
      emit(room, who, id, 'broken', `⛔ ${id} falhou três vezes seguidas — passa a BROKEN e sai do catálogo activo`);
    }
    return { ok: r.ok, result: r.result ?? null, error: r.error || null, ms: r.ms, logs: r.logs || [], reads: r.reads || [] };
  }

  /** corre as ferramentas-sensor da sala (activas, sem efeitos) — é o que o agente «vê» antes de escrever. */
  function sense({ room, limit = 3, exclude = [] } = {}) {
    const tools = registry.list(root, room)
      .filter((m) => m.state === 'active' && m.auto && !WRITE_SCOPES.some((s) => (m.scopes || []).includes(s)))
      .filter((m) => !exclude.includes(m.id))
      .slice(0, limit);
    const out = [];
    for (const m of tools) {
      const r = run({ room, id: m.id, input: {}, agent: m.author });
      out.push({ id: m.id, name: m.name, ok: r.ok, ms: r.ms, result: r.ok ? r.result : null, error: r.error });
    }
    if (out.length) emit(room, null, null, 'sense', `❋ ${out.length} ferramenta(s) leram os dados da sala (${out.reduce((s, x) => s + x.ms, 0)} ms)`);
    return out;
  }

  /* ---------- forja ---------- */
  /**
   * Um turno de oficina. Devolve a TRACE completa (as linhas que o terminal vê) além do resultado,
   * para que a mesma execução seja contável nos testes e visível na página.
   * `code` só entra quando quem escreve é um modelo (ou o dono); sem ele, a receita é escolhida.
   */
  function forge({ room, agent, need, code = null, name = null, scopes = null, examples = null, activate = false } = {}) {
    const t0 = now();
    const trace = [];
    const step = (phase, text, data) => { trace.push({ phase, text, ts: now() }); emit(room, agent, null, phase, text, data); };
    if (!rooms.includes(room)) return { ok: false, error: `sala desconhecida: ${room}`, trace };
    if (!need && !code) return { ok: false, error: 'a oficina precisa de saber o que falta', trace };

    step('think', `⌁ ${agent || 'a sala'} precisa de uma ferramenta: “${clip(need || 'escrita fora da oficina', 160)}”`);

    let manifest;
    if (code) {
      const id = String(name || 'a-medida');
      manifest = {
        id, room, author: agent, name: name || 'Ferramenta à medida',
        summary: String(need || 'ferramenta escrita à medida').slice(0, 200),
        scopes: scopes || ['brain:read'], inputs: {}, examples: examples || [],
        state: 'draft', auto: false, code: String(code),
      };
      step('code', `✎ código escrito fora da oficina (${String(code).length} caracteres) — a passá-lo pelo mesmo portão`);
    } else {
      const found = choose(need);
      step('match', found.ok
        ? `▸ receita escolhida: ${found.recipe.id}${found.hits.length ? ` (${found.hits.join(', ')})` : ''}${found.second ? ` · segunda: ${found.second.id}` : ''}`
        : `▸ nenhuma receita serve este pedido (mais perto: ${found.closest.join(', ')})`);
      if (!found.ok) return { ok: false, error: found.reason, closest: found.closest, trace };
      manifest = instantiate(found, { room, author: agent, name, need });
    }

    let src = String(manifest.code || '');
    const check = checkManifest({ ...manifest, code: src }, { rooms, agents });
    if (!check.ok) {
      step('deny', `⛔ manifesto recusado: ${check.problems.slice(0, 2).join(' · ')}`);
      return { ok: false, error: check.problems.join(' · '), trace, problems: check.problems };
    }
    for (const line of src.split('\n')) emit(room, agent, manifest.id, 'code', line, { stream: true });

    let saved = registry.save(root, { ...manifest, code: src }, src, { rooms, agents });
    if (!saved.ok) { step('deny', `⛔ não gravou: ${saved.problems[0]}`); return { ok: false, error: saved.problems[0], trace }; }
    step('save', `⌸ gravada ${room}/${manifest.id} v${saved.manifest.version} · data/forge/tools/${room}/${manifest.id}/`);

    let results = testSource(src, manifest.examples, { room, author: agent, scopes: manifest.scopes });
    let attempts = 0;
    while (results.some((r) => !r.ok) && attempts < 2) {
      const bad = results.find((r) => !r.ok);
      attempts++;
      step('fail', `✗ prova ${bad.n} falhou: ${clip(bad.error, 160)}`);
      const fix = repair(src, bad.error || '');
      if (!fix) { step('fail', '✗ a oficina não reconhece esta falha — e não repara o que não entende'); break; }
      step('repair', `↺ reparação ${attempts}: ${fix.rule} — ${fix.why}`);
      src = fix.code;
      const re = registry.save(root, { ...manifest, code: src }, src, { rooms, agents });
      if (!re.ok) { step('deny', `⛔ a reparação não passou o portão: ${re.problems[0]}`); break; }
      step('save', `⌸ ${room}/${manifest.id} v${re.manifest.version} (reparada)`);
      results = testSource(src, manifest.examples, { room, author: agent, scopes: manifest.scopes });
    }

    const passed = results.filter((r) => r.ok).length;
    const allOk = results.length === manifest.examples.length && passed === manifest.examples.length;
    for (const r of results) {
      const text = `${r.ok ? '✓' : '✗'} prova ${r.n}/${manifest.examples.length}${r.ok ? ` · ${r.ms} ms · ${clip(r.output, 180)}` : ` · ${clip(r.error, 160)}`}`;
      trace.push({ phase: r.ok ? 'pass' : 'fail', text, ts: now() });
      emit(room, agent, manifest.id, r.ok ? 'pass' : 'fail', text);
    }
    if (!allOk) {
      registry.setState(root, room, manifest.id, 'broken');
      step('broken', `⛔ ficou em BROKEN com ${passed}/${manifest.examples.length} provas — não entra no catálogo activo`);
      return { ok: false, error: 'provas falharam', tool: brief(registry.get(root, room, manifest.id) || manifest), trace, results };
    }

    const needsOwner = (manifest.scopes || []).some((s) => WRITE_SCOPES.includes(s));
    const activated = !needsOwner || activate;
    if (activated) registry.setState(root, room, manifest.id, 'active');
    const nowTool = registry.get(root, room, manifest.id) || manifest;
    step(activated ? 'active' : 'draft', activated
      ? `✦ ${manifest.id} v${nowTool.version} ACTIVA · ${manifest.examples.length}/${manifest.examples.length} provas · escopos ${manifest.scopes.join(', ')}`
      : `◌ ${manifest.id} em RASCUNHO: escreve (${manifest.scopes.join(', ')}) e só o dono a activa`);

    let first = null;
    if (activated) {
      first = run({ room, id: manifest.id, input: manifest.examples[0]?.input || {}, agent });
      if (first.ok) step('first', `▶ primeira execução: ${clip(first.result, 240)}`);
    }
    const tool = brief(registry.get(root, room, manifest.id) || manifest);
    step('done', `⌁ ${room}: ${tool.name} v${tool.version} (${tool.state}) · ${now() - t0} ms`);
    return { ok: activated, tool, trace, results, first, draft: !activated };
  }

  function activate({ room, id }) {
    const m = registry.get(root, room, id);
    if (!m) return { ok: false, error: 'não existe' };
    const source = registry.source(root, room, id);
    const results = testSource(source, m.examples || [], { room, author: m.author, scopes: m.scopes });
    const ok = results.length === (m.examples || []).length && results.every((r) => r.ok);
    if (!ok) {
      registry.setState(root, room, id, 'broken');
      emit(room, m.author, id, 'fail', `✗ ${id} não passou as provas ao ser activada`);
      return { ok: false, error: 'provas falharam', results };
    }
    const next = registry.setState(root, room, id, 'active');
    emit(room, m.author, id, 'active', `✦ ${id} v${m.version} activada pelo dono · ${results.length} prova(s)`);
    return { ok: true, tool: brief(next), results };
  }

  function adopt({ room, id, to, agent }) {
    if (!rooms.includes(to)) return { ok: false, error: `sala desconhecida: ${to}` };
    const r = registry.adopt(root, { room, id, to, author: agent, agents, rooms });
    if (!r.ok) return { ok: false, error: r.problems.join(' · ') };
    emit(to, agent, r.manifest.id, 'adopt', `⇄ ${r.manifest.id} adoptada de ${room} (v${r.manifest.origin.version}) — em rascunho até provar`);
    const tested = testSource(registry.source(root, to, r.manifest.id), r.manifest.examples || [], { room: to, author: r.manifest.author, scopes: r.manifest.scopes });
    const ok = tested.length === (r.manifest.examples || []).length && tested.every((t) => t.ok);
    if (ok) registry.setState(root, to, r.manifest.id, 'active');
    emit(to, agent, r.manifest.id, ok ? 'active' : 'broken', ok
      ? `✦ adoptada e provada na sala de destino (${tested.length}/${tested.length})`
      : '⛔ adoptada mas não provou — fica em rascunho');
    return { ok, tool: brief(registry.get(root, to, r.manifest.id)), tests: tested };
  }

  /* ---------- para o prompt dos agentes ---------- */
  /** o que esta sala já sabe fazer, em texto — entra no prompt de cada tarefa. */
  function promptText(agentOrRoom) {
    const room = typeof agentOrRoom === 'string' ? agentOrRoom : agentOrRoom?.dept || agentOrRoom?.department;
    const tools = registry.list(root, room).filter((m) => m.state === 'active');
    if (!tools.length) return '';
    return `FERRAMENTAS QUE A TUA SALA JÁ FORJOU (correm antes de escreveres; os resultados vêm no contexto)\n` +
      tools.map((m) => `- ${m.id} · ${m.name} · ${m.summary}${m.stats?.runs ? ` · usada ${m.stats.runs}×` : ''}`).join('\n') +
      `\nSe precisares de uma ferramenta que não tens, escreve numa linha: FORGE: <o que precisas, em português>. A oficina forja-a e ela existe a partir da próxima tarefa.`;
  }

  /** lê pedidos de ferramenta do texto de um agente — puro, testável sem motor nenhum. */
  function parseRequests(text) {
    const out = [];
    for (const line of String(text || '').split(/\r?\n/)) {
      if (out.length >= 2) break;
      const m = line.match(/^\s*(?:[-*]\s*)?FORGE:\s*(.+)$/i);
      if (m && m[1].trim()) out.push(m[1].trim().replace(/[`*]/g, '').slice(0, 300));
    }
    return out;
  }

  function stats() {
    const all = registry.list(root);
    const runs = all.reduce((s, m) => s + (m.stats?.runs || 0), 0);
    const fail = all.reduce((s, m) => s + (m.stats?.failures || 0), 0);
    const ms = all.reduce((s, m) => s + (m.stats?.ms || 0), 0);
    return {
      tools: all.length,
      active: all.filter((m) => m.state === 'active').length,
      draft: all.filter((m) => m.state === 'draft').length,
      broken: all.filter((m) => m.state === 'broken').length,
      rooms: new Set(all.map((m) => m.room)).size,
      runs, failures: fail, avgMs: runs ? Math.round(ms / runs) : 0,
      events: bus.tail(1)[0]?.seq || 0,
      listeners: bus.listeners(),
    };
  }

  function catalogue() {
    const all = registry.list(root);
    return {
      rooms: rooms.map((r) => ({ room: r, tools: all.filter((m) => m.room === r).map(brief) })),
      stats: stats(), recipes: recipes(), primitives: PRIMITIVE_DOC, limits: LIMITS, writes: WRITE_SCOPES,
    };
  }

  return {
    root, bus,
    catalogue, stats, sense, run, forge, activate, adopt, promptText, parseRequests,
    testSource,
    tools: (room) => registry.list(root, room).map(brief),
    source: (room, id, v) => registry.source(root, room, id, v),
    recent: (n) => bus.tail(n),
    subscribe: (fn) => bus.subscribe(fn),
    unsafe: unsafeCode,
    recipe: recipeOf,
  };
}
