/* ===========================================================================
   1.49.0 · MEM0 (memória semântica) — 28 out 2026

   O que isto é: o cliente do Mem0 Platform que a memória da Órbita usa quando há
   chave. Não é um plugin do OpenClaw nem um substituto da memória local — é a
   camada que transforma «procurar por palavras» em «procurar por sentido».

   Regras que o código cumpre, sem excepções:

     · Sem `MEM0_API_KEY` não se faz um único pedido de rede. O estado di-lo
       (`configurada: false`) e a memória local continua a funcionar.
     · A chave nunca sai daqui: o exterior vê `m0-F…T149`, nada mais.
     · Os IDs de organização e projecto viajam em `X-Org-Id`/`X-Project-Id`
       (são opcionais; a chave já é de um projecto). Não são configuração do
       plugin do OpenClaw, que os recusaria — aqui não há esse schema.
     · Nenhuma função atira por causa da rede: devolve `{ok:false, motivo}` e
       quem chamou decide. Uma memória em baixo não pode derrubar um plano.
     · Tempo máximo por pedido (7 s por omissão): a Vercel não é sítio para
       esperar por um fornecedor que não responde.

   Endpoints usados (API pública do Mem0 Platform):
     GET    /v1/ping/                 — a chave responde?
     POST   /v2/memories/search/      — procura semântica (v2, com filters)
     POST   /v1/memories/             — guardar (infer:false = texto verbatim)
     GET    /v1/memories/             — listar
     DELETE /v1/memories/:id/         — apagar
   =========================================================================== */

const BASE_PADRAO = 'https://api.mem0.ai';
const MS_PADRAO = 7000;
const MAX_TEXTO = 8000;

/** Configuração a partir do ambiente. `chave` só circula aqui dentro. */
export function config(env = process.env) {
  return {
    chave: String(env.MEM0_API_KEY || '').trim(),
    base: String(env.MEM0_BASE_URL || BASE_PADRAO).trim().replace(/\/+$/, ''),
    orgId: env.MEM0_ORG_ID ? String(env.MEM0_ORG_ID).trim() : null,
    projectId: env.MEM0_PROJECT_ID ? String(env.MEM0_PROJECT_ID).trim() : null,
    userId: String(env.MEM0_USER_ID || 'orbita').trim() || 'orbita',
  };
}

export const configurada = (cfg) => Boolean(cfg && cfg.chave);

/** `m0-Fqda…T149` — o suficiente para reconhecer a chave, nunca para a usar. */
export function mascarar(chave) {
  const c = String(chave || '');
  if (!c) return null;
  if (c.length <= 12) return `${c.slice(0, 2)}…`;
  return `${c.slice(0, 4)}…${c.slice(-4)}`;
}

const LIMPAR = (v) => String(v || '').replace(/\/+$/, '');

function motivoDeEstado(estado, texto) {
  if (estado === 401 || estado === 403) return `a chave do Mem0 foi recusada (${estado}) — confirma MEM0_API_KEY`;
  if (estado === 404) return 'o Mem0 respondeu 404 — a base ou o caminho da API não batem certo';
  if (estado === 429) return 'o Mem0 está a limitar os pedidos (429) — tenta daqui a pouco';
  if (estado >= 500) return `o Mem0 respondeu ${estado} — do lado deles`;
  return `o Mem0 respondeu ${estado}: ${String(texto || '').slice(0, 160)}`;
}

/** Um pedido ao Mem0. Nunca atira por rede: devolve o motivo. */
async function pedir(cfg, caminho, { metodo = 'GET', corpo = null, fetchImpl = fetch, ms = MS_PADRAO } = {}) {
  const cabecalhos = { Authorization: `Token ${cfg.chave}`, Accept: 'application/json' };
  if (corpo) cabecalhos['Content-Type'] = 'application/json';
  if (cfg.orgId) cabecalhos['X-Org-Id'] = cfg.orgId;
  if (cfg.projectId) cabecalhos['X-Project-Id'] = cfg.projectId;

  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), ms);
  const t0 = Date.now();
  try {
    const r = await fetchImpl(`${LIMPAR(cfg.base)}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal,
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* corpo não-JSON */ }
    return { ok: r.ok, estado: r.status, json, texto, ms: Date.now() - t0 };
  } catch (e) {
    const abortado = e && (e.name === 'AbortError' || e.name === 'TimeoutError');
    const codigo = (e && e.cause && e.cause.code) || (e && e.code) || null;
    const motivo = abortado
      ? `o Mem0 não respondeu em ${Math.round(ms / 1000)} s`
      : codigo === 'ENOTFOUND'
        ? 'não encontrei api.mem0.ai (DNS)'
        : `sem ligação ao Mem0 (${codigo || (e && e.message) || 'erro de rede'})`;
    return { ok: false, estado: 0, json: null, texto: '', motivo, ms: Date.now() - t0, rede: true };
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * A chave responde? É isto que o Control Center mostra. Não inventa: quando não
 * há chave diz que não há; quando há e falha, diz o que o Mem0 respondeu.
 */
export async function saude(cfg, { fetchImpl = fetch, ms = 5000 } = {}) {
  if (!configurada(cfg)) {
    return {
      configurada: false,
      ligada: false,
      chave: null,
      base: cfg ? cfg.base : BASE_PADRAO,
      porque: 'falta MEM0_API_KEY no ambiente — a memória fica lexical (por palavras)',
    };
  }
  const r = await pedir(cfg, '/v1/ping/', { fetchImpl, ms });
  if (!r.ok) {
    return {
      configurada: true,
      ligada: false,
      chave: mascarar(cfg.chave),
      base: cfg.base,
      ms: r.ms,
      porque: r.motivo || motivoDeEstado(r.estado, r.texto),
    };
  }
  const estado = String((r.json && r.json.status) || '').toLowerCase();
  const ligada = estado === 'ok' || r.estado === 200;
  return {
    configurada: true,
    ligada,
    chave: mascarar(cfg.chave),
    base: cfg.base,
    orgId: cfg.orgId ? `${cfg.orgId.slice(0, 8)}…` : null,
    projectId: cfg.projectId ? `${cfg.projectId.slice(0, 9)}…` : null,
    userId: cfg.userId,
    ms: r.ms,
    porque: ligada ? null : `o Mem0 respondeu ${r.estado} mas sem "status":"ok"`,
  };
}

function achadoDeMemoria(m) {
  const texto = String(m.memory || m.text || '').trim();
  const primeira = texto.split('\n')[0].replace(/^#+\s*/, '').slice(0, 140) || 'nota do Mem0';
  return {
    id: `mem0:${m.id || ''}`,
    titulo: primeira,
    texto,
    etiquetas: Array.isArray(m.categories) ? m.categories : [],
    fonte: 'mem0',
    projeto: (m.metadata && m.metadata.projeto) || 'orbita',
    criado: m.created_at || null,
    actualizado: m.updated_at || m.created_at || null,
    pontos: typeof m.score === 'number' ? Math.round(m.score * 100) / 10 : null,
    origem: 'mem0',
  };
}

/** Procura semântica. `achados` no mesmo formato das notas locais + `origem`. */
export async function pesquisar(cfg, { consulta, limite = 8, userId = null, fetchImpl = fetch, ms = MS_PADRAO } = {}) {
  if (!configurada(cfg)) return { ok: false, configurada: false, motivo: 'falta MEM0_API_KEY', achados: [] };
  const q = String(consulta || '').trim();
  if (!q) return { ok: false, configurada: true, motivo: 'consulta vazia', achados: [] };
  const r = await pedir(cfg, '/v2/memories/search/', {
    metodo: 'POST',
    corpo: {
      query: q.slice(0, 1000),
      version: 'v2',
      filters: { user_id: userId || cfg.userId },
    },
    fetchImpl,
    ms,
  });
  if (!r.ok) return { ok: false, configurada: true, motivo: r.motivo || motivoDeEstado(r.estado, r.texto), estado: r.estado, ms: r.ms, achados: [] };
  const lista = Array.isArray(r.json) ? r.json : (r.json && (r.json.results || r.json.memories)) || [];
  return {
    ok: true,
    configurada: true,
    modo: 'semântico',
    achados: lista.slice(0, Math.max(1, Number(limite) || 8)).map(achadoDeMemoria),
    ms: r.ms,
  };
}

/** Guarda uma nota. `infer:false` = o texto fica como está, sem extracção por LLM. */
export async function adicionar(cfg, { texto, titulo = null, metadados = {}, userId = null, infer = false, fetchImpl = fetch, ms = MS_PADRAO } = {}) {
  if (!configurada(cfg)) return { ok: false, configurada: false, motivo: 'falta MEM0_API_KEY' };
  const t = String(texto || '').trim().slice(0, MAX_TEXTO);
  if (t.length < 10) return { ok: false, configurada: true, motivo: 'texto demasiado curto para guardar' };
  const r = await pedir(cfg, '/v1/memories/', {
    metodo: 'POST',
    corpo: {
      messages: [{ role: 'user', content: t }],
      user_id: userId || cfg.userId,
      metadata: { ...(metadados || {}), ...(titulo ? { titulo } : {}) },
      infer: !!infer,
    },
    fetchImpl,
    ms,
  });
  if (!r.ok) return { ok: false, configurada: true, motivo: r.motivo || motivoDeEstado(r.estado, r.texto), estado: r.estado, ms: r.ms };
  const id = (Array.isArray(r.json) ? r.json[0] && r.json[0].id : r.json && r.json.id) || null;
  return { ok: true, configurada: true, id, evento: (r.json && r.json.message) || null, ms: r.ms };
}

/** Lista o que está no Mem0 (para o estado e para a auditoria). */
export async function listar(cfg, { limite = 50, userId = null, fetchImpl = fetch, ms = MS_PADRAO } = {}) {
  if (!configurada(cfg)) return { ok: false, configurada: false, motivo: 'falta MEM0_API_KEY', total: 0, memorias: [] };
  const n = Math.min(200, Math.max(1, Number(limite) || 50));
  const r = await pedir(cfg, `/v1/memories/?user_id=${encodeURIComponent(userId || cfg.userId)}&page=1&page_size=${n}`, { fetchImpl, ms });
  if (!r.ok) return { ok: false, configurada: true, motivo: r.motivo || motivoDeEstado(r.estado, r.texto), total: 0, memorias: [] };
  const lista = Array.isArray(r.json) ? r.json : (r.json && (r.json.results || r.json.memories)) || [];
  return { ok: true, configurada: true, total: (r.json && r.json.count) ?? lista.length, memorias: lista.map(achadoDeMemoria), ms: r.ms };
}

export async function apagar(cfg, id, { fetchImpl = fetch, ms = MS_PADRAO } = {}) {
  if (!configurada(cfg)) return { ok: false, configurada: false, motivo: 'falta MEM0_API_KEY' };
  const limpo = String(id || '').replace(/^mem0:/, '').trim();
  if (!/^[A-Za-z0-9_-]{4,}$/.test(limpo)) return { ok: false, configurada: true, motivo: 'id inválido' };
  const r = await pedir(cfg, `/v1/memories/${encodeURIComponent(limpo)}/`, { metodo: 'DELETE', fetchImpl, ms });
  if (!r.ok) return { ok: false, configurada: true, motivo: r.motivo || motivoDeEstado(r.estado, r.texto), estado: r.estado };
  return { ok: true, configurada: true, apagada: limpo, ms: r.ms };
}

/**
 * Importa um lote — o mesmo formato que o `openclaw mem0 import` lê:
 * `[{ memory|text|content, metadata? }]`. Sequencial, para não disparar limites.
 */
export async function importar(cfg, itens, { fetchImpl = fetch, userId = null, infer = false, ms = MS_PADRAO, max = 200 } = {}) {
  const lista = (Array.isArray(itens) ? itens : []).slice(0, max);
  if (!configurada(cfg)) return { ok: false, configurada: false, motivo: 'falta MEM0_API_KEY', total: lista.length, importados: 0, falhados: lista.length, erros: [] };
  let importados = 0;
  const erros = [];
  const ids = [];
  for (const item of lista) {
    const texto = String((item && (item.memory ?? item.text ?? item.content)) || '').trim();
    if (!texto) { erros.push({ erro: 'item sem texto' }); continue; }
    const r = await adicionar(cfg, { texto, metadados: (item && item.metadata) || {}, userId, infer, fetchImpl, ms });
    if (r.ok) { importados += 1; if (r.id) ids.push(r.id); }
    else if (erros.length < 10) erros.push({ erro: r.motivo, titulo: (item && item.metadata && item.metadata.fonte) || null });
  }
  return { ok: importados > 0, configurada: true, total: lista.length, importados, falhados: lista.length - importados, erros, ids };
}
