// Órbita Forge — o AUTOCARRO DE EVENTOS (27 out 2026).
//
// Tudo o que a oficina faz passa por aqui: um evento com hora, sala, agente, ferramenta, fase e uma
// linha de texto. É o mesmo fluxo que o terminal do browser desenha, que o `node tools/forge.mjs
// watch` imprime e que fica gravado em data/forge/log.ndjson.
//
// Um só sítio para emitir é o que garante a promessa do produto: se apareceu no terminal, aconteceu.
// Nada é escrito no terminal que não tenha passado por uma execução real.
import fs from 'node:fs';
import path from 'node:path';

export function createBus({ file = null, ring = 600 } = {}) {
  const subs = new Set();
  const recent = [];
  let queue = [];
  let writing = false;

  const drain = () => {
    if (writing || !file || !queue.length) return;
    writing = true;
    const chunk = queue.join('');
    queue = [];
    fs.appendFile(file, chunk, () => { writing = false; drain(); });
  };

  return {
    emit(ev) {
      const e = { ts: Date.now(), seq: recent.length ? recent[recent.length - 1].seq + 1 : 1, ...ev };
      recent.push(e);
      if (recent.length > ring) recent.shift();
      for (const fn of subs) { try { fn(e); } catch { /* um terminal que cai não derruba a oficina */ } }
      if (file) { queue.push(JSON.stringify(e) + '\n'); drain(); }
      return e;
    },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    tail(n = 120) { return recent.slice(-n); },
    listeners: () => subs.size,
    file,
  };
}
