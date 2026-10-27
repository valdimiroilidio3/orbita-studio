/* ===========================================================================
   `GET /api/health` — a prova pública de que a base responde (1.17.0).

   Não é um cartão de visita: diz se a base existe, que nome tem, e que tabelas
   faltam. É o que se consulta para saber, sem adivinhar, se a mesa está a
   guardar na base ou a cair no modo local.

     200 { ok: true,  base: '<ref>', faltam: [] }
     503 { ok: false, base: '<ref>', faltam: ['orbita_leads', …] }
     503 { ok: false, modo: 'local', error: 'sem chaves' }
   =========================================================================== */
import { createSupabaseRepo, envBase } from './_repo.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const env = envBase();
  if (!env.pronto) {
    res.status(503).json({ ok: false, modo: 'local', error: 'sem SUPABASE_URL/SUPABASE_SECRET_KEY na Vercel' });
    return;
  }

  try {
    const h = await createSupabaseRepo(env).health();
    res.status(h.ok ? 200 : 503).json({ ...h, modo: 'base', versao: '1.17.0' });
  } catch (e) {
    res.status(503).json({ ok: false, modo: 'base', error: e.message || 'a base não respondeu' });
  }
}
