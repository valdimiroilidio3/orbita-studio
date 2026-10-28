#!/usr/bin/env node
/**
 * Envia o JSON do `construir-import.mjs` para a Órbita — e a Órbita põe-no no
 * Mem0. É o passo que faz as memórias do OpenClaw serem *usadas* aqui: passam a
 * aparecer na procura semântica do Orchestrator e no Control Center.
 *
 *   node enviar-para-orbita.mjs                          # plano (não envia nada)
 *   node enviar-para-orbita.mjs --enviar                 # envia mesmo
 *   node enviar-para-orbita.mjs --fonte /tmp/mem0_import.json --app https://outro.host
 *
 * O destino por omissão é a produção. Nada aqui guarda chaves: quem tem de ter
 * a `MEM0_API_KEY` é a Vercel, não este portátil.
 */
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (nome, omissao = null) => {
  const i = args.indexOf(nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : omissao;
};

const APP = (opt('--app', process.env.ORBITA_APP || 'https://orbita-agentes.vercel.app')).replace(/\/+$/, '');
const FONTE = opt('--fonte', '/tmp/mem0_import.json');
const ENVIAR = args.includes('--enviar');

if (!existsSync(FONTE)) {
  console.error(`não encontrei ${FONTE}`);
  console.error('corre primeiro: node construir-import.mjs');
  process.exit(1);
}

let itens;
try {
  itens = JSON.parse(readFileSync(FONTE, 'utf8'));
  if (!Array.isArray(itens)) itens = [itens];
} catch (e) {
  console.error(`o ficheiro não é JSON válido: ${e.message}`);
  process.exit(1);
}

console.log(`origem: ${FONTE} — ${itens.length} item(ns)`);
console.log(`destino: ${APP}/api/rpc → /ia/memoria/importar`);
console.log(`modo:   ${ENVIAR ? 'a enviar' : 'plano (passa --enviar para gravar)'}`);
console.log('');

async function chamar(corpo) {
  const r = await fetch(`${APP}/api/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caminho: '/ia/memoria/importar', metodo: 'POST', corpo }),
  });
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* corpo não-JSON */ }
  return { http: r.status, json, texto };
}

try {
  const r = await chamar(ENVIAR ? { itens, confirmar: true } : { itens });
  if (!r.json) {
    console.error(`a Órbita respondeu ${r.http} sem JSON: ${r.texto.slice(0, 200)}`);
    process.exit(1);
  }
  const corpo = r.json.corpo || r.json;
  const estado = r.json.status ?? r.http;

  if (estado >= 400) {
    const erro = corpo.error || (corpo.mem0 && corpo.mem0.porque) || 'erro sem explicação';
    console.error(`falhou (${estado}): ${erro}`);
    process.exit(1);
  }

  if (!corpo.confirmado) {
    console.log(`plano: ${corpo.quantos} item(ns) prontos a enviar`);
    for (const p of corpo.plano || []) console.log(`  · ${p.fonte} — ${p.titulo} (${p.caracteres} caracteres)`);
    console.log('\nnada foi enviado. Corre outra vez com --enviar.');
  } else {
    console.log(`importados: ${corpo.importados} de ${corpo.total} · falhados: ${corpo.falhados}`);
    for (const e of corpo.erros || []) console.log(`  · falhou: ${e.erro}${e.titulo ? ` (${e.titulo})` : ''}`);
    console.log(`\n${corpo.nota || ''}`);
    console.log('confirma no Control Center → Memória: o painel mostra a chave mascarada e a última resposta do Mem0.');
  }
} catch (e) {
  console.error(`sem ligação a ${APP}: ${e.cause?.code || e.message}`);
  process.exit(1);
}
