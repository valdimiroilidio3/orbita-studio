/* ===========================================================================
   `GET /api/health` — a prova pública de que a base responde (1.17.0 · 1.41.0)

   Não é um cartão de visita: diz se a base existe, quantas tabelas faltam, e
   desde a 1.41.0 diz também **o que falta para lançar** (nomes de variáveis,
   nunca valores). É o primeiro sítio a abrir depois de um deploy.

     200 { ok: true,  modo: 'base', base: '<ref>', faltam: [], versao, prontidao }
     503 { ok: false, modo: 'base', base: '<ref>', faltam: ['orbita_leads', …] }
     503 { ok: false, modo: 'local', error: 'sem chaves', versao, prontidao }

   Corrigido na 1.41.0: quando faltavam as chaves, esta função rebentava com
   `ReferenceError: Cannot access 'ia' before initialization` — o `ia` era usado
   no ramo de erro e só declarado 6 linhas abaixo. Em produção, sem base ligada,
   o `/api/health` respondia 500 da Vercel em vez do 503 explicativo. Um teste
   passou a chamar o handler com o ambiente vazio para isto não voltar.
   =========================================================================== */
import { VERSAO } from './_versao.mjs';
import { createSupabaseRepo, envBase } from './_repo.mjs';
import { comChave, MODELOS } from './_ia/catalogo.mjs';
import { envDoPedido } from './_env.mjs';
import { prontidaoCurta } from './_prontidao.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const env = envBase();
  const pedido = envDoPedido(req);
  /* 1.18.0 · a saúde inclui a IA: quantos fornecedores têm chave (nomes de
     variáveis, nunca valores) e quantos modelos o catálogo conhece. Não faz
     nenhum pedido a um fornecedor — isso é o `/ia/testar`, que é a sério. */
  const ia = { fornecedoresComChave: comChave(pedido).map((x) => x.id), modelosNoCatalogo: MODELOS.length };
  const prontidao = prontidaoCurta(pedido);

  if (!env.pronto) {
    res.status(503).json({ ok: false, modo: 'local', error: 'sem SUPABASE_URL/SUPABASE_SECRET_KEY na Vercel', versao: VERSAO, ia, prontidao });
    return;
  }

  try {
    const h = await createSupabaseRepo(env).health();
    res.status(h.ok ? 200 : 503).json({ ...h, modo: 'base', versao: VERSAO, ia, prontidao });
  } catch (e) {
    res.status(503).json({ ok: false, modo: 'base', error: e.message || 'a base não respondeu', versao: VERSAO, ia, prontidao });
  }
}
