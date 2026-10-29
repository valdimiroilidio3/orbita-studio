/* ===========================================================================
   O `/api` que a mesa chama (30 out 2026 · 1.17.0).

   Porque não é um encaminhador de caminhos (`/api/ops/leads/...`): na Vercel, a
   função de `api/` só é alcançada no caminho exacto do ficheiro — um catch-all
   `api/[...rota].mjs` responde em `/api` e em `/api/qualquer-coisa`, mas NÃO em
   `/api/ops/summary` (verificado em produção: 404 da Vercel). Em vez de inventar
   reescritas que dependem de detalhes do construtor, a mesa manda o caminho
   dentro do pedido:

     POST /api/rpc   { "caminho": "/ops/leads", "metodo": "POST", "corpo": {…} }
     → 200 { "status": <o do caminho>, "corpo": <a resposta do caminho> }

   O contrato das rotas é exactamente o mesmo (`api/_rotas.mjs`), e a mesa não
   sabe a diferença: o envelope é aberto em `src/mesa.js`.

   `GET /api/rpc?caminho=/ops/summary` existe só para leitura de diagnóstico
   (nunca aceita escrita por GET). `GET /api/health` é a prova pública.

   Sem `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, ou sem esquema, responde 503 com
   `modo: 'local'` — e a mesa sabe voltar ao armazém do browser. Nunca inventa
   dados.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';

/* 1.32.0 · o OVH responde em 13–45 s. Sem isto, a função morria ao fim do tempo
   por omissão do plano e a resposta chegava a meio — o tecto de 75 s do
   fornecedor não serve de nada se a função é cortada antes. */
export const config = { maxDuration: 60 };
import { responder } from './_rotas.mjs';
import { envDoPedido } from './_env.mjs';

const SEM_BASE = 'esta instalação não tem base de dados ligada (faltam SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel)';

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return null; } }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  /* o pedido: por POST (envelope) ou por GET (só leitura, para diagnóstico) */
  let caminho, metodo, corpo = null;
  if (req.method === 'GET') {
    const q = new URL(String(req.url || '/'), 'http://local').searchParams;
    caminho = q.get('caminho') || '';
    const qs = q.get('query');
    metodo = 'GET';
    if (qs) caminho += `?${qs}`;
  } else if (req.method === 'POST') {
    const j = lerCorpo(req) || {};
    caminho = String(j.caminho || '');
    metodo = String(j.metodo || 'GET').toUpperCase();
    corpo = j.corpo ?? null;
  } else {
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ error: 'usa POST (ou GET para leitura)' });
    return;
  }
  if (!caminho) { res.status(400).json({ error: 'falta o caminho' }); return; }

  const env = envBase();
  if (!env.pronto) { res.status(503).json({ modo: 'local', error: SEM_BASE }); return; }

  let repo;
  try {
    repo = createSupabaseRepo(env);
  } catch (e) {
    res.status(503).json({ modo: 'local', error: e.message });
    return;
  }

  try {
    /* 1.54.0 · a porta precisa de ver o cookie e de poder pôr o seu: os cabeçalhos
       do pedido entram, e o `Set-Cookie` da sessão sai por aqui. Sem esta linha,
       entrar funcionava na base e não no browser. */
    const r = await responder(repo, {
      caminho, metodo, corpo, env: envDoPedido(req),
      headers: req.headers || {},
      ip: String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '').split(',')[0].trim() || null,
    });
    const cookie = r.cabecalhos && r.cabecalhos['Set-Cookie'];
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.status(200).json({ status: r.status, corpo: r.corpo });
  } catch (e) {
    const estado = e.status || 500;
    // «a base existe mas falta o esquema» é uma instrução, não uma avaria
    if (e.semEsquema) {
      res.status(503).json({
        modo: 'local',
        error: e.message || 'falta o esquema',
        instrucao: 'corre supabase/orbita_mesa.sql no SQL Editor do Supabase',
      });
      return;
    }
    res.status(estado).json({ error: e.message || 'erro na base' });
  }
}
