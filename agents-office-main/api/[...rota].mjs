/* ===========================================================================
   O `/api` que faltava (30 out 2026).

   A mesa publicada chamava `/api/ops/...` e recebia 404, porque a Vercel só
   servia ficheiros. Esta função é esse servidor: o mesmo contrato, agora com
   o Postgres do Supabase atrás (via PostgREST, com a chave secreta que vive
   SÓ no ambiente da Vercel).

   Sem `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, ou sem o esquema aplicado,
   responde 503 com `modo: 'local'` — e a mesa sabe voltar ao armazém do
   browser em vez de ficar em branco. Nunca inventa dados.
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { responder } from './_rotas.mjs';

function lerCorpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return null; } }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const env = envBase();
  if (!env.pronto) {
    res.status(503).json({
      modo: 'local',
      error: 'esta instalação não tem base de dados ligada (faltam SUPABASE_URL e SUPABASE_SECRET_KEY na Vercel)',
    });
    return;
  }

  const caminho = String(req.url || '/').replace(/^\/api/, '') || '/';
  let repo;
  try {
    repo = createSupabaseRepo(env);
  } catch (e) {
    res.status(503).json({ modo: 'local', error: e.message });
    return;
  }

  try {
    const r = await responder(repo, { caminho, metodo: req.method, corpo: lerCorpo(req) });
    res.status(r.status).json(r.corpo);
  } catch (e) {
    const estado = e.status || 500;
    // «a base existe mas falta o esquema» é uma instrução, não uma avaria
    res.status(estado).json({
      error: e.message || 'erro na base',
      ...(e.semEsquema ? { modo: 'local', semEsquema: true, instrucao: 'corre supabase/orbita_mesa.sql no SQL Editor do Supabase' } : {}),
    });
  }
}
