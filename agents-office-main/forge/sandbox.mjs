// Órbita Forge — o SANDBOX onde uma ferramenta corre (27 out 2026).
//
// Régua de segurança, sem promessas que não se cumprem:
//   · o código da ferramenta corre num contexto `vm` com o seu próprio reino — não tem `require`,
//     `process`, `fetch`, nem acesso ao sistema de ficheiros;
//   · não recebe NENHUM objecto do anfitrião: as primitivas devolvem o seu resultado como JSON
//     (texto) e quem o lê é o `JSON.parse` do próprio contexto. Assim os dados que a ferramenta
//     vê nunca trazem os protótipos do processo que os leu;
//   · a geração de código a partir de texto está desligada (`contextCodeGeneration.strings`), e o
//     manifesto já recusou `constructor`/`prototype`/`eval`/`Function` antes de chegar aqui;
//   · há um prazo de CPU (`timeout`) que corta um ciclo infinito à força, e um tecto de saída.
// O que isto NÃO é: uma fronteira contra código malicioso a sério. Quem quiser essa fronteira corre
// o servidor com `node --permission --allow-fs-read=… serve.mjs`; está escrito no FORGE.md. Aqui a
// confiança é a do dono: as ferramentas são escritas por agentes dele, e as que escrevem fora do
// rascunho só activam depois de ele carregar no botão.
import vm from 'node:vm';
import { LIMITS } from './manifest.mjs';

const CTX_CODE = { strings: false, wasm: false };

/**
 * Achata o contexto em folhas: `{ 'brain.notes': { fn } , 'room': { value: 'marketing' } }`.
 * As FUNÇÕES atravessam a ponte (devolvem JSON); os VALORES são literais no contexto — é assim
 * que uma ferramenta sabe em que sala está sem receber um único objecto do anfitrião.
 */
export function flatten(caps, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(caps || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'function') out[key] = { fn: v };
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (['string', 'number', 'boolean'].includes(typeof v)) out[key] = { value: v };
  }
  return out;
}

/** arranca o `ctx` dentro do contexto: cada chamada atravessa a ponte como texto. */
function bootstrap(leaves) {
  const paths = Object.keys(leaves);
  const tree = new Map();
  for (const p of paths) {
    const parts = p.split('.');
    let node = tree;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!node.has(parts[i])) node.set(parts[i], new Map());
      node = node.get(parts[i]);
    }
    // uma folha é uma FUNÇÃO (atravessa a ponte) ou um VALOR (entra como literal no contexto)
    node.set(parts[parts.length - 1], leaves[p].fn ? 'fn' : 'value');
  }
  const build = (node, prefix) => {
    const lines = [];
    for (const [k, v] of node) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v === 'fn') {
        lines.push(`${k}: (...a) => { const r = JSON.parse(__raw(${JSON.stringify(path)}, JSON.stringify(a))); if (!r.ok) { throw new Error(r.e); } return r.v; }`);
      } else if (v === 'value') {
        lines.push(`${k}: ${JSON.stringify(leaves[path].value)}`);
      } else {
        lines.push(`${k}: { ${build(v, path)} }`);
      }
    }
    return lines.join(', ');
  };
  return `const __ctx = { ${build(tree, '')} };`;
}

/**
 * Corre uma ferramenta. Devolve sempre um objecto — nunca atira:
 *   { ok, result, error, logs, timedOut, ms, outputBytes }
 */
export function runInSandbox({ source, input = {}, caps = {}, expect = null, timeoutMs = LIMITS.timeoutMs }) {
  const started = Date.now();
  const logs = [];
  const flat = flatten(caps);
  const safeCaps = {};
  for (const [k, entry] of Object.entries(flat)) {
    if (!entry.fn) continue;
    const fn = entry.fn;
    safeCaps[k] = (...args) => {
      try {
        const v = fn(...args);
        const json = JSON.stringify(v === undefined ? null : v);
        // o tecto não corta JSON a meio (isso daria dados corrompidos): recusa, e diz quanto é que
        // a ferramenta pediu. A mensagem aparece no terminal e ensina o autor a pedir menos.
        if (json.length > LIMITS.output) {
          return JSON.stringify({ ok: false, e: `a primitiva devolveu demasiado (${json.length} > ${LIMITS.output} caracteres) — pede menos` });
        }
        return JSON.stringify({ ok: true, v: JSON.parse(json) });
      } catch (e) {
        return JSON.stringify({ ok: false, e: String(e && e.message || e) });
      }
    };
  }
  safeCaps.log = (...args) => {
    const line = args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
    if (logs.length < 200) logs.push(line.slice(0, 600));
    return JSON.stringify({ ok: true, v: true });
  };

  let out = null;
  const sandbox = Object.create(null);
  sandbox.__raw = (name, argsJson) => {
    const fn = safeCaps[name];
    if (!fn) return JSON.stringify({ ok: false, e: `primitiva desconhecida: ${name}` });
    return fn(...(JSON.parse(argsJson || '[]')));
  };
  sandbox.__out = (s) => { out = String(s ?? ''); };
  sandbox.__input = JSON.parse(JSON.stringify(input ?? {}));

  const script = `${bootstrap(flat)}
${source}
;(function () {
  try { __out(JSON.stringify({ ok: true, v: run(__input, __ctx) })); }
  catch (e) { __out(JSON.stringify({ ok: false, e: String((e && e.message) || e), where: String((e && e.stack) || '').split('\\n').slice(1, 3).join(' | ') })); }
})();`;

  let timedOut = false;
  try {
    vm.runInNewContext(script, sandbox, { timeout: timeoutMs, contextCodeGeneration: CTX_CODE, filename: 'ferramenta.tool.js', microtaskMode: 'afterEvaluate' });
  } catch (e) {
    if (e && (e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /Script execution timed out/.test(String(e.message)))) timedOut = true;
    else return { ok: false, error: String(e && e.message || e), logs, timedOut: false, ms: Date.now() - started, outputBytes: 0 };
  }
  if (timedOut) return { ok: false, error: `a ferramenta passou de ${timeoutMs} ms e foi cortada`, logs, timedOut: true, ms: Date.now() - started, outputBytes: 0 };
  if (out == null) return { ok: false, error: 'a ferramenta não devolveu nada', logs, timedOut: false, ms: Date.now() - started, outputBytes: 0 };

  let parsed;
  try { parsed = JSON.parse(out); } catch { return { ok: false, error: 'resultado não é JSON', logs, timedOut: false, ms: Date.now() - started, outputBytes: out.length }; }
  const outputBytes = out.length;
  if (!parsed.ok) return { ok: false, error: parsed.e, where: parsed.where, logs, timedOut: false, ms: Date.now() - started, outputBytes };

  let verdict = null;
  if (expect) {
    try {
      // a prova vê o RESULTADO, não o envelope { ok, v } — era este detalhe que fazia uma
      // ferramenta correcta parecer partida
      const resultJson = JSON.stringify(parsed.v ?? null);
      verdict = !!vm.runInNewContext(
        `(() => { const result = JSON.parse(__r); return !!(${expect}); })()`,
        { __r: resultJson.length > LIMITS.output ? 'null' : resultJson },
        { timeout: 60, contextCodeGeneration: CTX_CODE },
      );
    } catch (e) { return { ok: false, error: `a prova não se avaliou: ${e.message}`, logs, timedOut: false, ms: Date.now() - started, outputBytes }; }
  }
  return { ok: true, result: parsed.v, expect: verdict, logs, timedOut: false, ms: Date.now() - started, outputBytes };
}
