#!/usr/bin/env node
/**
 * Constroi o JSON que o `openclaw mem0 import` espera, a partir do workspace do
 * OpenClaw. Correr NO HOST onde o OpenClaw vive — não dentro de um sandbox.
 *
 *   node construir-import.mjs                    # ~/.openclaw/workspace → /tmp/mem0_import.json
 *   node construir-import.mjs --workspace DIR --out FICHEIRO --dias 30
 *   node construir-import.mjs --seco             # só conta, não escreve
 *
 * Regras (as pedidas):
 *   · lê SOUL.md, IDENTITY.md, USER.md, MEMORY.md
 *   · ignora AGENTS.md, BOOTSTRAP.md, HEARTBEAT.md, TOOLS.md
 *   · lê memory/YYYY-MM-DD.md dos últimos 30 dias (inclusive)
 *   · ficheiro com menos de 2000 palavras → 1 item
 *   · ficheiro maior → 1 item por secção de cabeçalho (# e, se preciso, ##)
 *
 * Formato de cada item — o que o plugin lê em dist/index.js do @mem0/openclaw-mem0:
 *   { memory: string, metadata?: object, user_id?: string }
 *   (aceita também text/content; `memory` é o campo canónico)
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const LIMITE_PALAVRAS = 2000;
const LIDOS = ['SOUL.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md'];
const IGNORADOS = ['AGENTS.md', 'BOOTSTRAP.md', 'HEARTBEAT.md', 'TOOLS.md'];

function argumentos(argv) {
  const o = { workspace: join(homedir(), '.openclaw', 'workspace'), out: '/tmp/mem0_import.json', dias: 30, seco: false, userId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workspace') o.workspace = resolve(argv[++i]);
    else if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--dias') o.dias = Number(argv[++i]);
    else if (a === '--user-id') o.userId = argv[++i];
    else if (a === '--seco') o.seco = true;
    else if (a === '--ajuda' || a === '-h') {
      console.log('uso: node construir-import.mjs [--workspace DIR] [--out FICHEIRO] [--dias N] [--user-id ID] [--seco]');
      process.exit(0);
    } else {
      console.error(`argumento desconhecido: ${a}`);
      process.exit(2);
    }
  }
  return o;
}

const palavras = (t) => t.split(/\s+/).filter(Boolean).length;

/** Corta um texto em secções por cabeçalho markdown. `nivel` 1 = só «# ». */
function porCabecalho(texto, nivel) {
  const marca = '#'.repeat(nivel) + ' ';
  const linhas = texto.split('\n');
  const secoes = [];
  let titulo = null;
  let corpo = [];
  const fechar = () => {
    if (titulo === null && corpo.join('').trim() === '') return;
    secoes.push({ titulo: titulo || '(sem título)', corpo: corpo.join('\n').trim() });
  };
  for (const linha of linhas) {
    if (linha.startsWith(marca) && !linha.startsWith(marca + '#')) {
      fechar();
      titulo = linha.slice(marca.length).trim();
      corpo = [];
    } else {
      corpo.push(linha);
    }
  }
  fechar();
  return secoes.filter((s) => s.corpo);
}

/** Divide um ficheiro em pedaços aceitáveis para o Mem0. */
function dividir(nome, texto, meta) {
  const total = palavras(texto);
  if (total < LIMITE_PALAVRAS) {
    return [{ memory: texto.trim(), metadata: { ...meta, fonte: nome, palavras: total } }];
  }
  // Grande: primeiro por «#», depois (se alguma secção ainda for enorme) por «##».
  let secoes = porCabecalho(texto, 1);
  if (secoes.length <= 1) secoes = porCabecalho(texto, 2);
  const itens = [];
  for (const s of secoes) {
    const corpo = `# ${s.titulo}\n\n${s.corpo}`.trim();
    const n = palavras(corpo);
    if (n > LIMITE_PALAVRAS * 1.5) {
      const sub = porCabecalho(s.corpo, 2);
      if (sub.length > 1) {
        for (const ss of sub) {
          const c = `# ${s.titulo} — ${ss.titulo}\n\n${ss.corpo}`.trim();
          itens.push({ memory: c, metadata: { ...meta, fonte: nome, seccao: `${s.titulo} — ${ss.titulo}`, palavras: palavras(c) } });
        }
        continue;
      }
    }
    itens.push({ memory: corpo, metadata: { ...meta, fonte: nome, seccao: s.titulo, palavras: n } });
  }
  return itens;
}

function dataDosDias(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.md$/.exec(texto);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : { iso: `${m[1]}-${m[2]}-${m[3]}`, d };
}

const opcoes = argumentos(process.argv.slice(2));
const ws = opcoes.workspace;
if (!existsSync(ws)) {
  console.error(`workspace não encontrado: ${ws}`);
  console.error('corre isto no host do OpenClaw, ou passa --workspace DIR');
  process.exit(1);
}

const encontrados = [];
const saltados = [];
const itens = [];
const agora = new Date();
const corte = new Date(agora.getTime() - opcoes.dias * 86400000);
const corteIso = corte.toISOString().slice(0, 10);

// 1 · ficheiros de identidade
for (const nome of LIDOS) {
  const p = join(ws, nome);
  if (!existsSync(p)) { saltados.push(`${nome} (não existe)`); continue; }
  const texto = readFileSync(p, 'utf8').trim();
  if (!texto) { saltados.push(`${nome} (vazio)`); continue; }
  encontrados.push(nome);
  itens.push(...dividir(nome, texto, { origem: 'workspace', tipo: nome.replace('.md', '').toLowerCase(), importado: agora.toISOString() }));
}
for (const nome of IGNORADOS) {
  if (existsSync(join(ws, nome))) saltados.push(`${nome} (por instrução)`);
}

// 2 · diários memory/YYYY-MM-DD.md dos últimos N dias
const dirMem = join(ws, 'memory');
if (existsSync(dirMem) && statSync(dirMem).isDirectory()) {
  const diarios = readdirSync(dirMem)
    .map((n) => ({ n, info: dataDosDias(n) }))
    .filter((x) => x.info)
    .sort((a, b) => b.info.iso.localeCompare(a.info.iso));
  for (const { n, info } of diarios) {
    if (info.d < corte) { saltados.push(`memory/${n} (mais antigo que ${opcoes.dias} dias)`); continue; }
    const texto = readFileSync(join(dirMem, n), 'utf8').trim();
    if (!texto) { saltados.push(`memory/${n} (vazio)`); continue; }
    encontrados.push(`memory/${n}`);
    itens.push(...dividir(`memory/${n}`, texto, { origem: 'diario', data: info.iso, importado: agora.toISOString() }));
  }
} else {
  saltados.push('memory/ (não existe)');
}

const saida = itens.map((i) => (opcoes.userId ? { ...i, user_id: opcoes.userId } : i));

console.log(`workspace: ${ws}`);
console.log(`janela:    ${corteIso} → ${agora.toISOString().slice(0, 10)} (${opcoes.dias} dias)`);
console.log(`lidos:     ${encontrados.length}${encontrados.length ? ' — ' + encontrados.join(', ') : ''}`);
if (saltados.length) console.log(`saltados:  ${saltados.length}${saltados.length ? ' — ' + saltados.join(', ') : ''}`);
console.log(`itens:     ${saida.length}`);
for (const i of saida) {
  console.log(`  · ${i.metadata.fonte}${i.metadata.seccao ? ' › ' + i.metadata.seccao : ''} — ${i.metadata.palavras} palavras`);
}

if (!saida.length) {
  console.error('\n0 itens: nada a importar. Nada foi escrito.');
  process.exit(1);
}
if (opcoes.seco) {
  console.log('\n(--seco) não escrevi ficheiro nenhum.');
} else {
  writeFileSync(opcoes.out, JSON.stringify(saida, null, 2) + '\n', 'utf8');
  console.log(`\nescrito: ${opcoes.out}  (${saida.length} itens)`);
  console.log(`próximo:  openclaw mem0 import ${opcoes.out}`);
}
