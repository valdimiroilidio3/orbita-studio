#!/usr/bin/env node
/**
 * Verifica uma chave Mem0 antes de a pores no OpenClaw — e prova que as
 * memórias ficam pesquisáveis depois do import.
 *
 *   MEM0_API_KEY=... node verificar-mem0.mjs
 *   MEM0_API_KEY=... node verificar-mem0.mjs --pesquisa "preferences"
 *   MEM0_API_KEY=... node verificar-mem0.mjs --org org_... --proj proj_...
 *
 * Nunca imprime a chave: só os primeiros 4 e os últimos 4 caracteres.
 * Saída: 0 = tudo bem; 1 = alguma verificação falhou.
 */
const base = (process.env.MEM0_BASE_URL || 'https://api.mem0.ai').replace(/\/+$/, '');
const chave = process.env.MEM0_API_KEY || '';
if (!chave) {
  console.error('falta MEM0_API_KEY no ambiente');
  process.exit(2);
}
const mask = (k) => (k.length <= 10 ? '****' : `${k.slice(0, 4)}…${k.slice(-4)}`);

const args = process.argv.slice(2);
const opt = (nome, omissao = null) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : omissao;
};
const org = opt('--org', process.env.MEM0_ORG_ID);
const proj = opt('--proj', process.env.MEM0_PROJECT_ID);
const pesquisa = opt('--pesquisa', null);

const cabecalhos = {
  Authorization: `Token ${chave}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
};
// O plugin não envia estes dois; só os usamos se os passares, para diagnóstico.
if (org) cabecalhos['X-Org-Id'] = org;
if (proj) cabecalhos['X-Project-Id'] = proj;

async function pedir(metodo, caminho, corpo) {
  const t0 = Date.now();
  const r = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: cabecalhos,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* corpo não-JSON */ }
  return { status: r.status, json, texto, ms: Date.now() - t0 };
}

const falhas = [];
const dizer = (ok, linha) => {
  console.log(`${ok ? '✓' : '✗'} ${linha}`);
  if (!ok) falhas.push(linha);
};

console.log(`base:  ${base}`);
console.log(`chave: ${mask(chave)}`);
if (org) console.log(`org:   ${org}`);
if (proj) console.log(`proj:  ${proj}`);
console.log('');

// 1 · a chave é válida?
try {
  const r = await pedir('GET', '/v1/ping/');
  const bem = r.status === 200 && (r.json?.status === 'ok' || r.json?.status === 'OK');
  dizer(bem, `chave válida — GET /v1/ping/ → ${r.status} ${r.texto.slice(0, 120)}`);
} catch (e) {
  dizer(false, `não cheguei a ${base} — ${e.cause?.code || e.message}`);
  console.error('\nrede bloqueada: nada mais a testar. Corre isto no host do OpenClaw.');
  process.exit(1);
}

// 2 · há memórias? quantas?
let total = null;
try {
  const r = await pedir('GET', '/v1/memories/?page=1&page_size=5');
  if (r.status === 200) {
    const lista = Array.isArray(r.json) ? r.json : r.json?.results || [];
    total = r.json?.count ?? lista.length;
    dizer(true, `memórias legíveis — ${total} nesta página/projecto`);
    if (lista.length) console.log(`   ex.: ${String(lista[0].memory || '').slice(0, 90)}`);
  } else {
    dizer(false, `GET /v1/memories/ → ${r.status} ${r.texto.slice(0, 160)}`);
  }
} catch (e) {
  dizer(false, `GET /v1/memories/ falhou — ${e.message}`);
}

// 3 (opcional) · a pesquisa devolve o que interessa?
if (pesquisa) {
  try {
    const r = await pedir('POST', '/v2/memories/search/', { query: pesquisa, version: 'v2' });
    if (r.status === 200) {
      const res = Array.isArray(r.json) ? r.json : r.json?.results || [];
      dizer(res.length > 0, `pesquisa "${pesquisa}" — ${res.length} resultado(s)`);
      for (const m of res.slice(0, 3)) {
        console.log(`   · ${String(m.memory || m.text || '').slice(0, 100)}`);
      }
      if (!res.length) console.log('   (0 resultados: ou o import não correu, ou a chave é de outro projecto)');
    } else {
      dizer(false, `POST /v2/memories/search/ → ${r.status} ${r.texto.slice(0, 160)}`);
    }
  } catch (e) {
    dizer(false, `pesquisa falhou — ${e.message}`);
  }
}

console.log('');
if (falhas.length) {
  console.log(`${falhas.length} verificação(ões) falharam.`);
  process.exit(1);
}
console.log('tudo verificado.');
