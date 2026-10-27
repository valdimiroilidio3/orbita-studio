#!/usr/bin/env node
// ORBITA MCP bridge. Native Node only; newline-delimited JSON-RPC over stdio.
// Never write logs to stdout: that channel is reserved for MCP protocol messages.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../../integrations.mjs';
import * as ferramentas from '../../api/_ferramentas.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA_DIR = path.join(ROOT, 'data');
const PROTOCOL_VERSION = '2025-06-18';

const leadSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    companyName: { type: 'string', minLength: 1, maxLength: 180 },
    website: { type: 'string', maxLength: 500 }, category: { type: 'string', maxLength: 80 },
    address: { type: 'string', maxLength: 300 }, city: { type: 'string', maxLength: 120 },
    phone: { type: 'string', maxLength: 80 }, publicEmail: { type: 'string', maxLength: 160 },
    source: { type: 'string', enum: ['manual', 'openstreetmap', 'website', 'referral', 'import'] },
    sourceUrl: { type: 'string', maxLength: 500 }, osmType: { type: 'string', maxLength: 20 }, osmId: { type: 'string', maxLength: 60 },
    digitalPresence: { type: 'string', maxLength: 40 }, status: { type: 'string', enum: ['new', 'qualified', 'contacted', 'meeting', 'proposal', 'won', 'lost', 'suppressed'] },
    notes: { type: 'string', maxLength: 2000 },
  }, required: ['companyName'],
};
const businessDataSchema = {
  type: 'object', additionalProperties: false, properties: {
    companyName: { type: 'string', maxLength: 160 }, category: { type: 'string', maxLength: 80 }, website: { type: 'string', maxLength: 500 },
    city: { type: 'string', maxLength: 100 }, publicDescription: { type: 'string', maxLength: 1200 }, projectName: { type: 'string', maxLength: 160 },
    projectType: { type: 'string', maxLength: 100 }, audience: { type: 'string', maxLength: 300 }, objective: { type: 'string', maxLength: 500 },
    keyFeatures: { type: 'string', maxLength: 500 }, tone: { type: 'string', maxLength: 100 },
  },
};
const TOOLS = [
  { name: 'orbita_integration_status', description: 'Verifica quais integrações da ORBITA estão configuradas, sem revelar chaves ou segredos.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'orbita_business_discover', description: 'Procura empresas por cidade e categoria em dados do OpenStreetMap. Pesquisa manual, não exaustiva; confirma cada resultado e respeita a atribuição OSM. Não concluir que um negócio precisa de website apenas por ter presença digital ausente nos dados.', inputSchema: { type: 'object', properties: { location: { type: 'string', minLength: 2, maxLength: 120 }, category: { type: 'string', enum: ['salon', 'restaurant', 'cafe', 'dentist', 'clinic', 'hotel', 'school', 'shop', 'office', 'service'] }, radiusMeters: { type: 'integer', minimum: 500, maximum: 10000 }, limit: { type: 'integer', minimum: 1, maximum: 30 } }, required: ['location', 'category'], additionalProperties: false } },
  { name: 'orbita_leads_list', description: 'Lista os leads guardados no CRM ORBITA, local ou Supabase configurado.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false } },
  { name: 'orbita_leads_save', description: 'Guarda até 30 leads validados no CRM interno da ORBITA. Deduplica por ID OpenStreetMap, domínio ou nome+cidade. Não contacta ninguém.', inputSchema: { type: 'object', properties: { leads: { type: 'array', minItems: 1, maxItems: 30, items: leadSchema } }, required: ['leads'], additionalProperties: false } },
  { name: 'orbita_lead_update', description: 'Atualiza fase e notas de um lead já existente. Não envia mensagens.', inputSchema: { type: 'object', properties: { id: { type: 'string', minLength: 1, maxLength: 60 }, status: { type: 'string', enum: ['new', 'qualified', 'contacted', 'meeting', 'proposal', 'won', 'lost', 'suppressed'] }, notes: { type: 'string', maxLength: 2000 } }, required: ['id'], additionalProperties: false } },
  { name: 'orbita_ai_assist', description: 'Usa Gemini opcional para criar rascunhos assistidos: qualify, outreach, social ou project_brief. Não verifica factos externos, não envia emails e não publica.', inputSchema: { type: 'object', properties: { task: { type: 'string', enum: ['qualify', 'outreach', 'social', 'project_brief'] }, data: businessDataSchema }, required: ['task'], additionalProperties: false } },
  { name: 'orbita_github_repository', description: 'Obtém metadados públicos de um repositório GitHub, apenas leitura.', inputSchema: { type: 'object', properties: { owner: { type: 'string', minLength: 1, maxLength: 100 }, repo: { type: 'string', minLength: 1, maxLength: 100 } }, required: ['owner', 'repo'], additionalProperties: false } },
  { name: 'orbita_github_file_commit', description: 'CRIA ou atualiza um único ficheiro num branch GitHub e cria commit. Só usar quando o dono pedir explicitamente esta alteração de ficheiro nesta tarefa; requer approved=true, GITHUB_TOKEN com Contents:write, revisão do conteúdo e branch/path específicos. Recusa segredos, ficheiros .env e workflows GitHub Actions. Não enviar tokens, credenciais ou dados pessoais.', inputSchema: { type: 'object', properties: { approved: { type: 'boolean' }, owner: { type: 'string', minLength: 1, maxLength: 100 }, repo: { type: 'string', minLength: 1, maxLength: 100 }, path: { type: 'string', minLength: 1, maxLength: 240 }, content: { type: 'string', minLength: 1, maxLength: 700000 }, message: { type: 'string', minLength: 1, maxLength: 160 }, branch: { type: 'string', minLength: 1, maxLength: 120 } }, required: ['approved', 'owner', 'repo', 'path', 'content', 'message', 'branch'], additionalProperties: false } },
  { name: 'orbita_whatsapp_link', description: 'Gera um link wa.me com mensagem pré-preenchida. Não envia a mensagem: o responsável deve rever o texto e tocar em Enviar no WhatsApp. Exige número internacional começado por + ou 00.', inputSchema: { type: 'object', properties: { phone: { type: 'string', minLength: 8, maxLength: 80 }, message: { type: 'string', maxLength: 1500 } }, required: ['phone'], additionalProperties: false } },
  { name: 'orbita_content_drafts_list', description: 'Lista os rascunhos no calendário editorial; não publica.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } }, additionalProperties: false } },
  { name: 'orbita_content_draft_create', description: 'Guarda um rascunho de marketing para um projeto da ORBITA. O estado inicial é sempre draft; não publica.', inputSchema: { type: 'object', properties: { projectName: { type: 'string', minLength: 1, maxLength: 160 }, platform: { type: 'string', enum: ['instagram', 'linkedin', 'facebook', 'x', 'website'] }, caption: { type: 'string', minLength: 1, maxLength: 3000 }, imageUrl: { type: 'string', maxLength: 2000 }, hashtags: { type: 'string', maxLength: 500 } }, required: ['projectName', 'caption'], additionalProperties: false } },
  { name: 'orbita_email_send', description: 'ENVIA email individual através do Resend. Usa apenas se o dono pedir explicitamente, nesta tarefa, o envio desta mensagem exata a este destinatário exato. Nunca enviar em massa nem inferir consentimento. Requer approved=true, recipientConsent=true, consentReference verificável e purpose requested_follow_up ou transactional; respeita a suppression list. Se falta aprovação, prepara apenas um rascunho via orbita_ai_assist.', inputSchema: { type: 'object', properties: { approved: { type: 'boolean' }, recipientConsent: { type: 'boolean' }, consentReference: { type: 'string', minLength: 4, maxLength: 200 }, purpose: { type: 'string', enum: ['requested_follow_up', 'transactional'] }, to: { type: 'string', format: 'email' }, subject: { type: 'string', minLength: 1, maxLength: 200 }, text: { type: 'string', minLength: 1, maxLength: 12000 } }, required: ['approved', 'recipientConsent', 'consentReference', 'purpose', 'to', 'subject', 'text'], additionalProperties: false } },
  { name: 'orbita_email_suppress', description: 'Regista um endereço na lista de supressão para prevenir futuros envios. Usa quando alguém pede para não ser contactado.', inputSchema: { type: 'object', properties: { email: { type: 'string', format: 'email' }, reason: { type: 'string', maxLength: 120 } }, required: ['email'], additionalProperties: false } },
  { name: 'orbita_instagram_publish', description: 'PUBLICA UMA IMAGEM no Instagram profissional via Meta Graph API. Só chamar quando o dono pedir explicitamente, nesta tarefa, para publicar este conteúdo. Requer approved=true, um draftId existente com URL de imagem HTTPS pública ou imageUrl+caption, e credenciais Meta válidas. Não publica Reels, Stories ou carrosséis.', inputSchema: { type: 'object', properties: { approved: { type: 'boolean' }, draftId: { type: 'string', maxLength: 60 }, imageUrl: { type: 'string', maxLength: 2000 }, caption: { type: 'string', maxLength: 2200 } }, required: ['approved'], additionalProperties: false } },
  { name: 'orbita_vercel_deploy', description: 'DISPARA um novo deployment do projeto e branch vinculados ao Vercel Deploy Hook configurado. Só chamar após pedido explícito do dono para fazer o deploy nesta tarefa. Requer approved=true e VERCEL_DEPLOY_HOOK_URL. A URL do hook é secreta e não deve ser exposta. O retorno apenas confirma aceitação do pedido, não sucesso do build.', inputSchema: { type: 'object', properties: { approved: { type: 'boolean' } }, required: ['approved'], additionalProperties: false } },
  /* ---- 1.30.0 · pesquisa real para os agentes ----
     Duas ferramentas que faltavam: a web (Tavily) e as empresas (Geoapify).
     Passam ambas pela mesma camada (`api/_ferramentas.mjs`), por isso o agente
     recebe sempre o mesmo envelope — ferramenta, fornecedor, estado, fontes,
     erro — e trocar de fornecedor não muda o que o agente vê. */
  { name: 'orbita_web_search', description: 'Pesquisa a web em tempo real (Tavily) e devolve título, URL, excerto e data de cada fonte, mais uma resposta curta opcional. Usa para factos atuais, notícias, concorrência e contexto de mercado. Diz sempre a fonte e a data; o que não vier da resposta é inferência tua, não facto. Só para notícias usa topic=news com days.', inputSchema: { type: 'object', properties: { query: { type: 'string', minLength: 2, maxLength: 400 }, limit: { type: 'integer', minimum: 1, maximum: 20 }, topic: { type: 'string', enum: ['general', 'news'] }, days: { type: 'integer', minimum: 1, maximum: 365 }, domains: { type: 'array', items: { type: 'string', maxLength: 120 }, maxItems: 10 }, depth: { type: 'string', enum: ['basic', 'advanced'] }, minScore: { type: 'number', minimum: 0, maximum: 1 } }, required: ['query'], additionalProperties: false } },
  { name: 'orbita_business_search', description: 'Procura empresas reais por atividade e cidade (Geoapify: nome, morada, telefone, site e email quando existem nos dados). Aceita atividade em português ou a categoria do Geoapify. Remove duplicados. Nunca inventa telefone, email ou site: campo vazio quer dizer desconhecido, não inexistente. Resultados públicos a confirmar antes de qualquer contacto.', inputSchema: { type: 'object', properties: { location: { type: 'string', minLength: 2, maxLength: 120 }, activity: { type: 'string', minLength: 2, maxLength: 120 }, category: { type: 'string', maxLength: 120 }, countryCode: { type: 'string', minLength: 2, maxLength: 2 }, radiusMeters: { type: 'integer', minimum: 100, maximum: 50000 }, limit: { type: 'integer', minimum: 1, maximum: 50 } }, required: ['location'], additionalProperties: false } },
  { name: 'orbita_research_usage', description: 'Mostra quanto da pesquisa já foi gasto (por fornecedor, dia e mês, com tecto e o que resta) e as últimas execuções com estado, tempo e fontes. Não revela chaves. Usa antes de pedir muitas pesquisas seguidas.', inputSchema: { type: 'object', properties: { executions: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
];

function resultText(value, isError = false) {
  return { jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) } };
}
/* O enum antigo da descoberta era em inglês; as categorias da casa são em português. */
const EN_PARA_PT = {
  salon: 'cabeleireiro', restaurant: 'restaurante', cafe: 'cafe', dentist: 'dentista',
  clinic: 'clinica', hotel: 'hotel', school: 'escola', shop: 'loja', office: 'escritorio',
  service: 'servicos',
};

async function invokeTool(name, args = {}) {
  switch (name) {
    case 'orbita_integration_status': return api.integrationStatus();
    /* 1.30.0: com Geoapify configurado, a descoberta de empresas passa por lá
       (mais rica e sem duplicados); sem chave, continua o OSM de antes. */
    case 'orbita_business_discover': {
      const geo = await ferramentas.executar('pesquisar_empresas', {
        oQue: EN_PARA_PT[String(args.category || '').toLowerCase()] || args.category,
        onde: args.location,
        limite: args.limit || 20,
        raio: args.radiusMeters || 5000,
      }, { env: process.env });
      if (!geo.ok) return api.discoverBusinesses(args);
      return {
        ok: true, provider: geo.fornecedor, location: args.location, category: args.category,
        radiusMeters: geo.dados?.pedido?.raio || args.radiusMeters || 5000,
        count: geo.dados?.empresas?.length || 0,
        results: (geo.dados?.empresas || []).map((l) => ({
          name: l.nome, category: l.categoria, website: l.website || null, phone: l.telefone || null,
          publicEmail: l.email || null, address: l.morada || null, city: l.cidade || null,
          lat: l.lat, lon: l.lon, distanceMeters: l.distancia ?? null,
        })),
        resolvedPlace: geo.dados?.centro?.nome || null,
        duplicatesRemoved: geo.dados?.repetidos || 0,
        warnings: geo.avisos || [], creditsUsed: geo.custo ?? null,
        note: geo.avisos?.length ? geo.avisos.join(' · ') : 'Dados públicos do Geoapify/OSM a confirmar antes de contactar.',
        via: 'geoapify',
      };
    }
    case 'orbita_web_search': {
      const r = await ferramentas.executar('pesquisar_web', {
        consulta: args.query,
        limite: args.limit || 8,
        topico: args.topic || 'general',
        dias: args.days || null,
        dominios: args.domains || null,
        profundidade: args.depth || 'basic',
        minRelevancia: args.minScore,
      }, { env: process.env });
      return {
        ok: r.ok,
        provider: r.fornecedor,
        tool: r.ferramenta,
        query: r.pedido?.consulta || args.query,
        topic: r.pedido?.topico || args.topic || 'general',
        answer: r.dados?.respostaCurta || null,
        results: (r.dados?.resultados || []).map((x) => ({
          title: x.titulo, url: x.url, snippet: x.excerto, score: x.relevancia, published: x.publicado || null,
        })),
        sources: r.fontes || [],
        dropped: r.dados?.descartados || 0,
        threshold: r.dados?.limiar ?? null,
        warnings: r.avisos || [],
        creditsUsed: r.custo ?? null,
        cached: !!r.cache, ms: r.ms,
        error: r.erro || null, code: r.codigo || null,
        real: !!r.ok, inferred: false,
        note: 'São resultados de pesquisa com data de publicação; não os tomes por verificação independente sem abrir a fonte.',
      };
    }
    case 'orbita_business_search': {
      const r = await ferramentas.executar('pesquisar_empresas', {
        oQue: args.activity || args.category || null,
        onde: args.location,
        categoria: args.activity ? null : (EN_PARA_PT[String(args.category || '').toLowerCase()] ? null : args.category || null),
        limite: args.limit || 20,
        raio: args.radiusMeters || 12000,
        pais: args.countryCode || null,
      }, { env: process.env });
      return {
        ok: r.ok,
        provider: r.fornecedor,
        tool: r.ferramenta,
        location: args.location,
        resolvedPlace: r.dados?.centro ? { city: r.dados.centro.cidade, country: r.dados.centro.codigoPais, lat: r.dados.centro.lat, lon: r.dados.centro.lon } : null,
        category: r.dados?.categoria || null,
        count: r.dados?.empresas?.length || 0,
        results: (r.dados?.empresas || []).map((l) => ({
          name: l.nome, category: l.categoria, address: l.morada || null, city: l.cidade || null,
          phone: l.telefone || null, website: l.website || null, email: l.email || null,
          lat: l.lat, lon: l.lon, distanceMeters: l.distancia ?? null, note: l.nota ?? null, why: l.porque ?? null,
        })),
        duplicatesRemoved: r.dados?.repetidos || 0,
        warnings: r.avisos || [],
        creditsUsed: r.custo ?? null,
        cached: !!r.cache, ms: r.ms,
        error: r.erro || null, code: r.codigo || null,
        real: !!r.ok, inferred: false,
        note: 'Telefone, email e site só aparecem se estiverem nos dados públicos. Vazio = desconhecido.',
      };
    }
    case 'orbita_research_usage': {
      const lim = await import('../../api/_limites.mjs');
      const emFicheiro = ferramentas.execucoesEmFicheiro(args.executions || 20);
      return {
        ok: true, ...lim.uso(process.env),
        executions: ferramentas.execucoes(args.executions || 20),
        executionsFromFiles: emFicheiro,
        note: 'Contadores por instância do processo; a factura real está no painel do fornecedor.',
      };
    }
    case 'orbita_leads_list': return { ok: true, storage: process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'local-json', leads: await api.listLeads(DATA_DIR, args.limit || 100) };
    case 'orbita_leads_save': return api.saveLeads(DATA_DIR, args.leads || []);
    case 'orbita_lead_update': {
      const lead = await api.updateLead(DATA_DIR, args.id, args);
      if (!lead) { const e = new Error('Lead não encontrado.'); e.status = 404; throw e; }
      return { ok: true, lead };
    }
    case 'orbita_ai_assist': return api.geminiAssist({ task: args.task, data: args.data || {} });
    case 'orbita_github_repository': return api.githubRepository(args.owner, args.repo);
    case 'orbita_github_file_commit': return api.githubWriteFile(args);
    case 'orbita_whatsapp_link': return api.whatsappClickToChatUrl(args.phone, args.message || '');
    case 'orbita_content_drafts_list': return { ok: true, drafts: api.listContentDrafts(DATA_DIR, args.limit || 100) };
    case 'orbita_content_draft_create': return api.createContentDraft(DATA_DIR, args);
    case 'orbita_email_send': return api.sendApprovedEmail(DATA_DIR, args);
    case 'orbita_email_suppress': return api.suppressEmail(DATA_DIR, args.email, args.reason || 'requested');
    case 'orbita_vercel_deploy': return api.triggerVercelDeploy({ approved: args.approved });
    case 'orbita_instagram_publish': {
      let target = args;
      let draft = null;
      if (args.draftId) {
        draft = api.listContentDrafts(DATA_DIR, 500).find(item => item.id === args.draftId);
        if (!draft) { const e = new Error('Rascunho não encontrado.'); e.status = 404; throw e; }
        target = { ...args, imageUrl: draft.imageUrl, caption: [draft.caption, draft.hashtags].filter(Boolean).join('\n\n') };
      }
      const published = await api.publishInstagram(target);
      const saved = draft ? api.markContentPublished(DATA_DIR, draft.id, published) : null;
      return { ...published, draft: saved };
    }
    default: throw new Error(`Ferramenta ORBITA desconhecida: ${name}`);
  }
}

async function handle(message) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return;
  const id = message.id;
  const method = message.method;
  if (method === 'notifications/initialized' || method === 'notifications/cancelled' || method === 'notifications/progress') return;
  if (method === 'initialize') {
    if (id === undefined) return;
    send({ jsonrpc: '2.0', id, result: { protocolVersion: message.params?.protocolVersion || PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'orbita-integrations', version: '1.0.0' }, instructions: 'ORBITA business integrations. External communication and publishing must only happen when the owner explicitly asks for the exact action; public OSM results must be verified.' } });
    return;
  }
  if (method === 'ping') { if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} }); return; }
  if (method === 'tools/list') { if (id !== undefined) send({ jsonrpc: '2.0', id, result: { tools: TOOLS } }); return; }
  if (method === 'tools/call') {
    if (id === undefined) return;
    try {
      const output = await invokeTool(message.params?.name, message.params?.arguments || {});
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(output) }] } });
    } catch (error) {
      const safe = api.getIntegrationError(error);
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify({ error: safe.error, status: safe.status }) }], isError: true } });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método não suportado: ${method}` } });
}
function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    try { void handle(JSON.parse(line)).catch(error => process.stderr.write(`ORBITA MCP handler error: ${error.message}\n`)); }
    catch (error) { process.stderr.write(`ORBITA MCP invalid JSON: ${error.message}\n`); }
  }
});
process.stdin.on('end', () => { if (buffer.trim()) { try { void handle(JSON.parse(buffer.trim())); } catch {} } });
