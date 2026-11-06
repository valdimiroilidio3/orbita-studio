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
import { prontidaoCurta, GRUPOS } from './_prontidao.mjs';
/* 1.66.0 · nomes e booleanos dos dois tokens: prova, sem mostrar nenhum valor,
   que a instalação os lê de facto */
import { TOKENS, estadoDosTokens, nomesParecidos } from './_acesso.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const env = envBase();
  const pedido = envDoPedido(req);
  /* 1.18.0 · a saúde inclui a IA: quantos fornecedores têm chave (nomes de
     variáveis, nunca valores) e quantos modelos o catálogo conhece. Não faz
     nenhum pedido a um fornecedor — isso é o `/ia/testar`, que é a sério. */
  const ia = { fornecedoresComChave: comChave(pedido).map((x) => x.id), modelosNoCatalogo: MODELOS.length };
  const prontidao = prontidaoCurta(pedido);
  /* 1.66.1 · cada nome é comparado com os que a app lê de facto: um
     `ORBITA_APITOKEN` (sem o segundo `_`) aparece aqui como «quase», em vez de
     ficar invisível. Só nomes, nunca valores. */
  const conhecidos = [
    ...GRUPOS.flatMap((g) => g.itens.flatMap((i) => i.aliases)),
    ...TOKENS.map((t) => t.variavel),
  ];
  const acesso = { ...estadoDosTokens(pedido), nomesErrados: nomesParecidos(pedido, conhecidos) };
  /* 1.67.0 · o ciclo só corre sozinho se o agendador tiver com que se
     autenticar. Dizer isto aqui evita a pergunta «porque é que a fila não
     anda?» quando a resposta é uma variável que falta. */
  const ciclo = {
    agendador: !!pedido.CRON_SECRET,
    porque: pedido.CRON_SECRET
      ? 'o agendador da Vercel chama /api/ciclo uma vez por dia (o máximo deste plano)'
      : 'sem CRON_SECRET o agendador não se autentica: a fila só corre quando carregares em «Correr a fila agora»',
  };

  if (!env.pronto) {
    res.status(503).json({ ok: false, modo: 'local', error: 'sem SUPABASE_URL/SUPABASE_SECRET_KEY na Vercel', versao: VERSAO, ia, prontidao, acesso, ciclo });
    return;
  }

  try {
    const h = await createSupabaseRepo(env).health();
    res.status(h.ok ? 200 : 503).json({ ...h, modo: 'base', versao: VERSAO, ia, prontidao, acesso, ciclo });
  } catch (e) {
    res.status(503).json({ ok: false, modo: 'base', error: e.message || 'a base não respondeu', versao: VERSAO, ia, prontidao, acesso, ciclo });
  }
}
