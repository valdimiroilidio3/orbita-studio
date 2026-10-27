#!/usr/bin/env node
// ORBITA — Google, nas mãos dos agentes.
//
// O dono já tinha a gaveta LEADS (src/leads.js) e as rotas /api/google e /api/leads. O que faltava
// era os 35 agentes poderem procurar por sua conta enquanto trabalham — em vez de só lerem os leads
// que o dono guardou. Este servidor MCP (stdio, JSON-RPC, sem dependências) expõe as mesmas duas
// APIs da Google como ferramentas:
//
//   google_places_search  — empresas reais (nome, morada, telefone, site, avaliação) = leads
//   google_web_search     — resultados da web com excertos = informação e contexto
//   google_leads_saved    — o que já está guardado (leitura)
//   google_leads_save     — guarda resultados já verificados (deduplicado)
//
// Regras: nunca escreve logs no stdout (é o canal do protocolo), nunca devolve chaves, e sem chave
// diz exatamente qual variável de ambiente falta — não inventa resultados.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as google from '../../google.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'data');
const PROTOCOL_VERSION = '2025-06-18';

const leadSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    address: { type: 'string', maxLength: 300 }, city: { type: 'string', maxLength: 120 },
    phone: { type: 'string', maxLength: 60 }, website: { type: 'string', maxLength: 500 },
    category: { type: 'string', maxLength: 120 }, rating: { type: 'number' }, reviews: { type: 'integer' },
    mapsUrl: { type: 'string', maxLength: 500 }, placeId: { type: 'string', maxLength: 200 },
  }, required: ['name'],
};

const TOOLS = [
  {
    name: 'google_places_search',
    description: 'Procura empresas reais na Google Places API (New) e devolve nome, morada, telefone, site, avaliação e nota de oportunidade. É a fonte para leads. Resultados públicos podem estar incompletos ou desatualizados: confirma antes de contactar e não concluir que um negócio precisa de site só porque o campo veio vazio.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: {
        what: { type: 'string', minLength: 2, maxLength: 120, description: 'O tipo de negócio, ex.: "clínicas dentárias"' },
        where: { type: 'string', minLength: 2, maxLength: 120, description: 'Zona/cidade, ex.: "Lisboa"' },
        limit: { type: 'integer', minimum: 1, maximum: 20 },
      }, required: ['what', 'where'],
    },
  },
  {
    name: 'google_web_search',
    description: 'Pesquisa na web através da Programmable Search (Custom Search JSON API) e devolve título, link e excerto. Serve para informação, concorrência e contexto — não é um diretório de empresas.',
    inputSchema: {
      type: 'object', additionalProperties: false,
      properties: { q: { type: 'string', minLength: 2, maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 10 } },
      required: ['q'],
    },
  },
  {
    name: 'google_leads_saved',
    description: 'Lista os leads já guardados no escritório (data/leads.json), com estado e nota. Leitura apenas.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } } },
  },
  {
    name: 'google_leads_save',
    description: 'Guarda leads já verificados pelo dono ou por ti (deduplicado por domínio, telefone ou nome+morada). Não contacta ninguém e não envia nada.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { leads: { type: 'array', minItems: 1, maxItems: 25, items: leadSchema } }, required: ['leads'] },
  },
];

async function invokeTool(name, args) {
  if (name === 'google_places_search') {
    const places = await google.searchPlaces({ what: args.what, where: args.where, limit: args.limit || 10 });
    return {
      ok: true, provider: 'google-places', what: args.what, where: args.where, found: places.length,
      places: places.map(p => ({ ...p, score: p.score ?? google.scoreLead(p) })),
      note: 'Dados públicos da Google Places. Confirma morada/telefone antes de contactar; site vazio pode significar só que não está nos dados.',
    };
  }
  if (name === 'google_web_search') {
    const results = await google.searchWeb({ q: args.q, limit: args.limit || 8 });
    return { ok: true, provider: 'google-cse', q: args.q, found: results.length, results, note: 'Resultados da web; lê a fonte antes de citar.' };
  }
  if (name === 'google_leads_saved') {
    const saved = google.list({ limit: args.limit || 50 }, DATA_DIR);
    const stats = google.stats(DATA_DIR);
    return { ok: true, stats, ...saved };
  }
  if (name === 'google_leads_save') {
    const result = google.saveAll((args.leads || []).map(l => ({ ...l, city: l.city || '', source: 'manual' })), DATA_DIR);
    return { ok: true, added: result.added, updated: result.updated, total: result.total };
  }
  throw new Error(`Ferramenta desconhecida: ${name}`);
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }

function why(error) {
  // Falta de chave não é falha do servidor: é um recado para o dono, com a variável certa.
  const g = google.state();
  const missing = !g.places.available ? g.places.reason : !g.web.available ? g.web.reason : null;
  return { error: error?.message || 'falhou', missing, status: 503 };
}

async function handle(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
  const { id, method } = message;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled' || method === 'notifications/progress') return;
  if (method === 'initialize') {
    if (id === undefined) return;
    send({ jsonrpc: '2.0', id, result: {
      protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'orbita-google', version: '1.0.0' },
      instructions: 'Pesquisa real da Google para o escritório ORBITA. Resultados públicos: confirma antes de contactar. Nunca envies nada em nome do dono.',
    } });
    return;
  }
  if (method === 'ping') { if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} }); return; }
  if (method === 'tools/list') { if (id !== undefined) send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
  if (method === 'tools/call') {
    if (id === undefined) return;
    try {
      const out = await invokeTool(message.params?.name, message.params?.arguments || {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
    } catch (error) {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(why(error)) }], isError: true } });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método não suportado: ${method}` } });
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { void handle(JSON.parse(line)).catch(e => process.stderr.write(`ORBITA Google MCP: ${e.message}\n`)); }
    catch (e) { process.stderr.write(`ORBITA Google MCP JSON inválido: ${e.message}\n`); }
  }
});
process.stdin.on('end', () => { if (buffer.trim()) { try { void handle(JSON.parse(buffer.trim())); } catch { /* ignora */ } } });
