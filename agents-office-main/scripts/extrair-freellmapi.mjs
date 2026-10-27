/* ===========================================================================
   Extractor do freellmapi (MIT, © 2026 Tashfeen Ahmed) — 1.19.0

   Lê o código do projecto freellmapi (zip `freellmapi-main.zip`, na raiz do
   repositório) e escreve `api/_ia/catalogo-extra.json` com:
     · os fornecedores que ele sabe falar (id, nome, base, dialeto, keyless, chave);
     · os modelos com os números que ele declara (rpm/rpd/tpm/tpd, contexto,
       ranks de inteligência e velocidade, tamanho).

   Nada de rede: é leitura de ficheiros. Correr com o zip extraído:

     node scripts/extrair-freellmapi.mjs /caminho/para/freellmapi-main

   O que o extractor NÃO faz: prometer que o fornecedor responde. Isso é só o
   `/ia/testar`, com um pedido real.
   =========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const raiz = process.argv[2];
if (!raiz) {
  console.error('uso: node scripts/extrair-freellmapi.mjs <pasta freellmapi-main>');
  process.exit(2);
}

const dirProv = path.join(raiz, 'server/src/providers');
const ficheiros = fs.readdirSync(dirProv).filter((f) => f.endsWith('.ts'));
const fonte = (f) => fs.readFileSync(path.join(dirProv, f), 'utf8');

/* ---------- 1 · fornecedores (o registo vive em providers/index.ts) ---------- */
const FORNECEDORES = {};

/* 1a · quem é registado inline: new XProvider({ platform, name, baseUrl, keyless }) */
const indexSrc = fs.readFileSync(path.join(dirProv, 'index.ts'), 'utf8');
const REGISTO = /new (\w+)\(\{([\s\S]*?)\}\)/g;
for (const m of indexSrc.matchAll(REGISTO)) {
  const [, classe, corpo] = m;
  const platform = (corpo.match(/platform:\s*'([^']+)'/) || [])[1];
  if (!platform) continue;
  const nome = (corpo.match(/name:\s*'([^']+)'/) || [])[1] || platform;
  const base = (corpo.match(/baseUrl:\s*'([^']+)'/) || [])[1] || null;
  FORNECEDORES[platform] = {
    id: platform, nome, base,
    dialeto: /Google|Cohere|AIHorde/.test(classe) ? 'proprio' : 'openai',
    tipo: 'chat',
    keyless: /keyless:\s*true/.test(corpo),
    chave: [platform.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'],
    ficheiro: 'providers/index.ts',
  };
}

/* 1a-bis · bases conhecidas que o registo não traz (dialetos e casos à parte).
   Só entram as que sabemos de cor; as outras ficam sem base e marcadas. */
const BASE_CONHECIDA = {
  google: 'https://generativelanguage.googleapis.com/v1beta',
  aihorde: 'https://aihorde.net/api/v2',
  cohere: 'https://api.cohere.com/v2',
};
const DIALETO_CONHECIDO = { google: 'google' };   // os restantes dialetos próprios não são OpenAI

/* 1b · os que têm ficheiro próprio: completam base/dialeto/tipo e acrescentam
   os que não estão no registo inline */
const lerConst = (src, nome) => (src.match(new RegExp(`const ${nome} = '([^']+)'`)) || [])[1] || null;

for (const f of ficheiros) {
  if (f === 'index.ts' || f === 'base.ts') continue;
  const src = fonte(f);
  if (!/extends (OpenAICompatProvider|BaseProvider|SearchOnlyProvider)/.test(src)) continue;

  const plataforma = (src.match(/platform:\s*'([^']+)'/) || src.match(/platform: Platform = '([^']+)'/) || [])[1];
  if (!plataforma) continue;
  /* só se declara o nome de forma explícita; caso contrário usa-se o id */
  const nome = (src.match(/readonly name = '([^']+)'/) || [])[1]
    || (src.match(/name:\s*'([A-Za-z0-9 .+&()-]{2,40})'/) || [])[1]
    || null;

  let base = (src.match(/baseUrl:\s*([A-Z_0-9]+)/) || [])[1];
  if (base) base = lerConst(src, base) || (src.match(new RegExp(`baseUrl:\\s*'([^']+)'`)) || [])[1];
  if (!base) base = (src.match(/([A-Z_0-9]*BASE_URL)\s*=\s*'([^']+)'/) || [])[2] || null;

  const pesquisa = /extends SearchOnlyProvider/.test(src);
  const media = /extends (?:.*)?(?:Speech|Media)/.test(src) || /(speech|audio|image|video)/i.test(nome);
  const anterior = FORNECEDORES[plataforma] || {};
  /* nome vindo de ficheiro só se parecer um nome (o código tem strings soltas) */
  const nomeLimpo = nome || anterior.nome || null;
  FORNECEDORES[plataforma] = {
    id: plataforma,
    nome: nomeLimpo || plataforma.charAt(0).toUpperCase() + plataforma.slice(1),
    base: anterior.base || base,
    dialeto: /extends OpenAICompatProvider/.test(src) ? 'openai' : (anterior.dialeto || 'proprio'),
    tipo: pesquisa ? 'pesquisa' : media ? 'media' : 'chat',
    keyless: anterior.keyless || /keyless:\s*true/.test(src),
    chave: anterior.chave || [plataforma.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_API_KEY'],
    nomeDeFicheiro: nome,
    ficheiro: `providers/${f}`,
  };
}

for (const [id, f] of Object.entries(FORNECEDORES)) {
  if (BASE_CONHECIDA[id] && !f.base) f.base = BASE_CONHECIDA[id];
  if (DIALETO_CONHECIDO[id]) f.dialeto = DIALETO_CONHECIDO[id];
  delete FORNECEDORES.custom;
  /* o nosso cliente fala openai/anthropic/google; o que é dialeto próprio diz-se */
  f.usavel = !!f.base && ['openai', 'google'].includes(f.dialeto);
  f.porque = f.usavel ? null
    : !f.base ? 'o código dele não declara base (precisa de conta/URL à medida)'
    : `dialeto próprio (${f.dialeto}), fora do nosso cliente`;
}

/* ---------- 2 · modelos (as sementes das migrações) ---------- */
const dirMig = path.join(raiz, 'server/src/db/migrations');
const migracoes = fs.readdirSync(dirMig).filter((f) => f.endsWith('.ts')).sort();
const MODELOS = new Map();

/* 12 colunas: platform, model_id, display_name, intel, speed, size,
   rpm, rpd, tpm, tpd, budget, context */
const LINHA = /\[\s*'([a-z0-9._-]+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*'(Frontier|Large|Medium|Small)'\s*,\s*(null|\d+),\s*(null|\d+),\s*(null|\d+),\s*(null|\d+),\s*'([^']*)',\s*(null|\d+)\s*\]/g;
const num = (v) => (v === 'null' ? null : Number(v));

for (const m of migracoes) {
  const src = fs.readFileSync(path.join(dirMig, m), 'utf8');
  for (const x of src.matchAll(LINHA)) {
    const [, plataforma, modelo, rotulo, intel, speed, tamanho, rpm, rpd, tpm, tpd, orcamento, ctx] = x;
    MODELOS.set(`${plataforma}\u0000${modelo}`, {
      plataforma, modelo, rotulo,
      inteligencia: Number(intel), velocidade: Number(speed), tamanho,
      rpm: num(rpm), rpd: num(rpd), tpm: num(tpm), tpd: num(tpd),
      orcamento, contexto: num(ctx), migracao: m,
    });
  }
}

/* ---------- 3 · capacidades: só o que o id/nome prova ---------- */
function etiquetas(m) {
  const t = new Set(['texto']);
  const s = `${m.modelo} ${m.rotulo}`.toLowerCase();
  if (/coder|codestral|code|deepseek-coder|devstral/.test(s)) t.add('codigo');
  if (/-vl|vision|llava|moondream|pixtral|gemma-3/.test(s)) t.add('visao');
  if (m.inteligencia <= 8) t.add('raciocinio');
  if (m.velocidade <= 4) t.add('rapido');
  if ((m.contexto || 0) >= 128000) t.add('contexto');
  if (/reason|thinking|-r1|deepseek-r/.test(s)) t.add('raciocinio');
  return [...t];
}

const modelos = [...MODELOS.values()]
  .filter((m) => FORNECEDORES[m.plataforma])
  .map((m) => ({
    ...m,
    etiquetas: etiquetas(m),
    buraco: (m.rpm === null && m.rpd === null) ? 'sem limites declarados' : null,
  }))
  .sort((a, b) => a.plataforma.localeCompare(b.plataforma) || a.modelo.localeCompare(b.modelo));

/* ---------- 4 · escrever ---------- */
const saida = {
  _fonte: 'freellmapi (MIT) — https://github.com/…  extraído por scripts/extrair-freellmapi.mjs',
  _quando: new Date().toISOString().slice(0, 10),
  _aviso: 'Os limites e modelos vêm do código dele, não de um teste nosso. Nenhum fornecedor está «funcional» até /ia/testar responder ok.',
  fornecedores: Object.values(FORNECEDORES).sort((a, b) => a.id.localeCompare(b.id)),
  modelos,
};

const destino = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'api/_ia/catalogo-extra.json');
fs.writeFileSync(destino, JSON.stringify(saida, null, 1) + '\n');
console.log(`fornecedores: ${saida.fornecedores.length}`);
console.log(`modelos: ${modelos.length}`);
console.log(`keyless: ${saida.fornecedores.filter((f) => f.keyless).map((f) => f.id).join(', ')}`);
console.log(`pesquisa: ${saida.fornecedores.filter((f) => f.tipo === 'pesquisa').map((f) => f.id).join(', ')}`);
console.log(`sem base: ${saida.fornecedores.filter((f) => !f.base).map((f) => f.id).join(', ') || '(nenhum)'}`);
console.log(`escrito em ${destino}`);
