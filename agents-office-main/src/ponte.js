/* ===========================================================================
   1.79.0 · A PONTE PARA O SERVIDOR QUE JÁ EXISTE (9 nov 2026)

   O dono escreveu, com o endereço publicado à frente: **«coloca servidor no
   projeto já»** — e o ecrã dizia «Este escritório está aberto sem servidor».

   Não era verdade. A Vercel tem funções a responder: `/api/health`,
   `/api/rpc`, `/ia/*`, `/ops/*`, a porta de entrada. O que faltava era o
   escritório saber disso. Três coisas, todas nossas:

     1 · `connect()` exigia `health.ok === true`. Em produção o `/api/health`
         responde `ok: false` só porque falta UMA tabela opcional
         (`orbita_faturas`) — e o escritório concluía «não há servidor». Uma
         tabela em falta não é um servidor em falta;
     2 · as rotas do quadro (`/api/tasks`, `/api/routines`, `/api/usage`) só
         existem no `serve.mjs` da tua máquina. Na publicação, o MESMO trabalho
         vive atrás de `/api/rpc` (`/ops/tarefas`), que é o caminho que a mesa
         usa desde a 1.17.0;
     3 · ninguém tentava o segundo caminho quando o primeiro não existia.

   Este ficheiro é a peça 3: uma função que fala com `/api/rpc` com o envelope
   `{status, corpo}` já aberto, e as três traduções que a barra de tarefas
   precisa. Nada aqui inventa dados: se o servidor não responder, devolve-se o
   erro com a razão dele.

   Regra que se mantém: **uma leitura que falha não vira um zero.** Quem chama
   recebe `null` (não há números) e diz «sem ligação» — nunca `0`.
   =========================================================================== */

export const RPC = '/api/rpc';

/**
 * A resposta é de um Órbita a sério? Um `ok:false` com versão/base/porta é um
 * servidor que respondeu e tem uma falta — é diferente de não haver servidor.
 */
export function respostaNossa(h) {
  if (!h || typeof h !== 'object') return false;
  if (h.ok === true) return true;
  return ['versao', 'base', 'porta', 'nome', 'name', 'modo'].some((k) => h[k] != null);
}

/** O endereço do `/api/rpc` para um caminho — GET leva a query, POST leva o corpo. */
export function urlDoRpc(caminho, { metodo = 'GET', query = '' } = {}) {
  let url = `${RPC}?caminho=${encodeURIComponent(caminho)}`;
  if (String(metodo).toUpperCase() === 'GET' && query) url += `&query=${encodeURIComponent(query)}`;
  return url;
}

/**
 * Chama um caminho do servidor por `/api/rpc` e devolve o corpo já aberto.
 * Lança com a frase do servidor quando ele recusa — é isso que o ecrã mostra.
 */
export async function chamarRpc(caminho, { metodo = 'GET', corpo = null, query = '', sinal = null, fetchImpl = fetch } = {}) {
  const m = String(metodo || 'GET').toUpperCase();
  const init = { method: m === 'GET' ? 'GET' : 'POST', headers: { accept: 'application/json' } };
  if (sinal) init.signal = sinal;
  if (m !== 'GET') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify({ caminho, metodo: m, corpo: corpo ?? {} });
  }
  const r = await fetchImpl(urlDoRpc(caminho, { metodo: m, query }), init);
  let env = null;
  try { env = await r.json(); } catch { /* uma página em HTML não é JSON */ }
  if (!r.ok && !(env && typeof env === 'object' && 'status' in env)) {
    const e = new Error(r.status === 404 ? 'esta publicação não tem o caminho ' + caminho : 'HTTP ' + r.status);
    e.status = r.status; throw e;
  }
  if (!env || typeof env !== 'object') { const e = new Error('o servidor respondeu sem JSON'); e.status = r.status; throw e; }
  const status = Number(env.status ?? r.status ?? 200);
  const corpoLido = env.corpo ?? env;
  if (status >= 400) {
    const e = new Error((corpoLido && (corpoLido.error || corpoLido.mensagem)) || `HTTP ${status}`);
    e.status = status; e.corpo = corpoLido; throw e;
  }
  return corpoLido;
}

/* ---------- as traduções da barra de tarefas ---------- */

/** O que a base chama `kind` para cada sala do escritório (as seis, com os nomes da mesa). */
export const SALA_PARA_TIPO = {
  emails: 'command', delivery: 'engineering', sales: 'prospect',
  marketing: 'media', fin: 'design', ops: 'sales',
};

/** O corpo que `/ops/tarefas` aceita para uma tarefa escrita à mão no escritório. */
export function corpoDeTarefaDoEscritorio({ dept = 'emails', texto = '', agente = '', modelo = '', equipa = false } = {}) {
  const pedido = String(texto || '').trim();
  return {
    kind: 'escritorio',
    texto: pedido,
    titulo: pedido.slice(0, 90),
    dept: SALA_PARA_TIPO[dept] || 'command',
    agente: String(agente || ''),
    modelo: String(modelo || ''),
    equipa: !!equipa,
  };
}

/** A lista de tarefas de `/ops/tarefas`, seja qual for o formato em que vem. */
export function tarefasDoServidor(corpo) {
  const lista = corpo && (Array.isArray(corpo.tarefas) ? corpo.tarefas : Array.isArray(corpo) ? corpo : null);
  return Array.isArray(lista) ? lista : null;
}

/**
 * Lê o quadro do servidor: primeiro o caminho do `serve.mjs` (a tua máquina),
 * depois o `/api/rpc` da publicação. Devolve `{tarefas, via}` ou lança com a
 * razão da última tentativa.
 */
export async function lerTarefasDoServidor({ fetchImpl = fetch, sinal = null, limite = 120 } = {}) {
  try {
    const r = await fetchImpl(`/api/ops/tarefas?limit=${limite}`, sinal ? { signal: sinal } : undefined);
    if (r && r.ok) {
      const j = await r.json().catch(() => null);
      const lista = tarefasDoServidor(j);
      if (lista) return { tarefas: lista, via: 'local', tipos: j.tipos || null };
    }
  } catch { /* sem servidor local: tenta-se a publicação */ }
  const j = await chamarRpc('/ops/tarefas', { metodo: 'GET', query: `limit=${limite}`, sinal, fetchImpl });
  const lista = tarefasDoServidor(j);
  if (!lista) throw new Error('o servidor respondeu sem a lista de tarefas');
  return { tarefas: lista, via: 'rpc', tipos: j.tipos || null };
}
