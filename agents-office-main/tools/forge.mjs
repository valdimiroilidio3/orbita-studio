#!/usr/bin/env node
// Órbita — o TERMINAL DA OFICINA, na linha de comandos (27 out 2026).
//
// O mesmo fluxo que o painel do browser (tecla F), mas num terminal a sério — para acompanhar o
// escritório de outra janela, ou para pôr num `tmux` ao lado da cena.
//
//   node tools/forge.mjs ls [sala]                 o catálogo
//   node tools/forge.mjs forge <sala> <texto…>     a oficina forja e prova uma ferramenta
//   node tools/forge.mjs run <sala> <id> ['{"json"}']
//   node tools/forge.mjs adopt <sala> <id> <destino>
//   node tools/forge.mjs log [n]                   os últimos eventos
//   node tools/forge.mjs watch [sala]              SEGUE o fluxo ao vivo
//
// Variáveis: ORBITA_URL (por omissão http://localhost:$PORT, e PORT=4520 se nada for dito).
const URL_BASE = (process.env.ORBITA_URL || `http://localhost:${process.env.PORT || 4520}`).replace(/\/$/, '');

const C = {
  reset: '\u001b[0m', dim: '\u001b[2m', b: '\u001b[1m',
  green: '\u001b[38;5;114m', red: '\u001b[38;5;203m', yellow: '\u001b[38;5;179m',
  cyan: '\u001b[38;5;80m', teal: '\u001b[38;5;79m', blue: '\u001b[38;5;111m',
  grey: '\u001b[38;5;245m', white: '\u001b[38;5;254m', violet: '\u001b[38;5;147m',
};
const PHASE = {
  think: C.blue, match: C.yellow, code: C.teal, save: C.grey, pass: C.green, fail: C.red,
  repair: C.yellow, active: C.green, draft: C.yellow, broken: C.red, first: C.cyan,
  done: C.white, run: C.grey, ok: C.green, sense: C.blue, adopt: C.violet, deny: C.red,
  'tool-log': C.dim, info: C.grey, error: C.red,
};
const hhmmss = (ts) => new Date(ts || Date.now()).toTimeString().slice(0, 8);
const line = (ev) => `${C.dim}${hhmmss(ev.ts)}${C.reset} ${ev.room ? `${C.grey}${String(ev.room).padEnd(10)}${C.reset} ` : ''}${PHASE[ev.phase] || C.grey}${ev.text}${C.reset}`;

async function api(path, payload) {
  const r = await fetch(`${URL_BASE}${path}`, {
    method: payload ? 'POST' : 'GET',
    headers: payload ? { 'content-type': 'application/json' } : {},
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let d = {};
  try { d = await r.json(); } catch { /* resposta vazia */ }
  if (!r.ok) throw new Error(d.error || `${r.status} ${r.statusText}`);
  return d;
}

async function watch(filter) {
  const res = await fetch(`${URL_BASE}/api/forge/stream`);
  if (!res.ok || !res.body) throw new Error('o servidor não abriu o fluxo (a porta está certa?)');
  const dec = new TextDecoder();
  let buf = '';
  console.log(`${C.dim}— ligado a ${URL_BASE} · Ctrl+C para sair —${C.reset}`);
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const evt = (frame.match(/^event: (.+)$/m) || [])[1];
      const data = (frame.match(/^data: (.+)$/m) || [])[1];
      if (!data) continue;
      let d; try { d = JSON.parse(data); } catch { continue; }
      if (evt === 'hello') {
        for (const e of d.events || []) if (!filter || e.room === filter) console.log(line(e));
        continue;
      }
      if (filter && d.room && d.room !== filter) continue;
      console.log(line(d));
    }
  }
}

const [cmd = 'help', ...rest] = process.argv.slice(2);
try {
  if (cmd === 'ls' || cmd === 'list') {
    const d = await api('/api/forge');
    const s = d.stats;
    console.log(`${C.b}OFICINA${C.reset} ${C.grey}· ${s.tools} ferramentas · ${s.active} activas · ${s.runs} execuções · média ${s.avgMs} ms${C.reset}`);
    for (const r of d.rooms) {
      const tools = rest.length ? r.tools.filter((t) => t.id === rest[0]) : r.tools;
      if (!tools.length) continue;
      console.log(`\n${C.b}${r.room.toUpperCase()}${C.reset}`);
      for (const t of tools) {
        const color = t.state === 'active' ? C.green : t.state === 'broken' ? C.red : C.yellow;
        console.log(`  ${color}${t.state.padEnd(6)}${C.reset} ${C.white}${t.id}${C.reset} ${C.dim}v${t.version} · ${t.runs}× · ${t.examples} prova(s)${C.reset}\n         ${C.grey}${t.name} — ${t.summary}${C.reset}`);
      }
    }
    if (!s.tools) console.log(`${C.grey}nenhuma ferramenta ainda. Experimenta: node tools/forge.mjs forge marketing "contar as palavras do cérebro"${C.reset}`);
  } else if (cmd === 'forge') {
    const [room, ...need] = rest;
    if (!room || !need.length) throw new Error('uso: forge <sala> "<o que precisas>"');
    const r = await api('/api/forge/draft', { room, need: need.join(' ') });
    for (const t of r.trace || []) console.log(line({ ...t, room }));
    if (r.ok) console.log(`\n${C.green}${C.b}✦ ${r.tool.id} v${r.tool.version} activa${C.reset}`);
    else if (r.draft) console.log(`\n${C.yellow}◌ ${r.tool.id} v${r.tool.version} em rascunho — escreve no cérebro. Activa com: activate ${room} ${r.tool.id}${C.reset}`);
    else console.log(`\n${C.red}✗ ${r.error || 'não passou'}${C.reset}`);
    if (r.first?.result) console.log(`${C.cyan}▶ ${JSON.stringify(r.first.result).slice(0, 600)}${C.reset}`);
  } else if (cmd === 'run') {
    const [room, id, json] = rest;
    if (!room || !id) throw new Error('uso: run <sala> <id> [{"json"}]');
    let input = {};
    if (json) { try { input = JSON.parse(json); } catch { throw new Error('o JSON não abre'); } }
    const r = await api('/api/forge/run', { room, id, input });
    console.log(r.ok ? `${C.green}✓ ${id} · ${r.ms} ms${C.reset}\n${JSON.stringify(r.result, null, 2)}` : `${C.red}✗ ${r.error}${C.reset}`);
    process.exitCode = r.ok ? 0 : 1;
  } else if (cmd === 'adopt') {
    const [room, id, to] = rest;
    const r = await api('/api/forge/adopt', { room, id, to });
    console.log(r.ok ? `${C.violet}⇄ ${id} adoptada em ${to}${C.reset}` : `${C.red}✗ ${r.error}${C.reset}`);
  } else if (cmd === 'activate') {
    const [room, id] = rest;
    const r = await api('/api/forge/activate', { room, id });
    console.log(r.ok ? `${C.green}✦ ${id} activada · ${r.results?.length || 0} prova(s)${C.reset}` : `${C.red}✗ ${r.error}${C.reset}`);
  } else if (cmd === 'log' || cmd === 'events') {
    const d = await api(`/api/forge/events?n=${rest[0] || 40}`);
    for (const e of d.events) console.log(line(e));
  } else if (cmd === 'watch') {
    await watch(rest[0] || null);
  } else {
    console.log(`${C.b}Órbita · oficina${C.reset} ${C.grey}(${URL_BASE})${C.reset}
  ${C.white}ls${C.reset} [sala]                    catálogo de ferramentas
  ${C.white}forge${C.reset} <sala> <texto…>         forjar e provar uma ferramenta
  ${C.white}run${C.reset} <sala> <id> [json]        correr uma ferramenta
  ${C.white}adopt${C.reset} <sala> <id> <destino>   adoptar noutra sala
  ${C.white}activate${C.reset} <sala> <id>             aprovar uma ferramenta que escreve
  ${C.white}log${C.reset} [n]                       últimos eventos
  ${C.white}watch${C.reset} [sala]                  seguir o fluxo ao vivo`);
  }
} catch (e) {
  console.error(`${C.red}${e.message}${C.reset}`);
  process.exitCode = 1;
}
