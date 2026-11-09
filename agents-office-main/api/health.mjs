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
import { opcoesDeEntrada } from './_entrada.mjs';   // 1.69.0: quem entra e por onde
/* 1.79.0 · o curador da mesa inteira: se faltar uma tabela, aplica o esquema
   versionado (idempotente) em vez de responder «corre o SQL à mão». */
import { garantirEsquemaDaMesa } from './_autoesquema.mjs';
/* 1.79.2 · os conectores que o SERVIDOR tem, por nome de variável (nunca por
   valor). É a prova pública que a barra do escritório lê sem sessão. */
import { resumoDosConectores } from './_servicos.mjs';

/**
 * 1.76.1 · «a porta tem as colunas que a entrada usa?»
 *
 * Separada do handler para poder ser provada sem rede. Devolve `null` quando o
 * repositório não sabe responder (uma base em memória, um duplo antigo) — nesse
 * caso o health não inventa um estado.
 */
export async function sondaDaPorta(repo) {
  if (typeof repo?.contas?.sonda !== 'function') return null;
  try {
    await repo.contas.sonda();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      erro: String(e.message || e).slice(0, 200),
      ficheiro: e.ficheiro || null,
      semEsquema: !!e.semEsquema,
    };
  }
}

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

  /* 1.79.2 · os conectores do servidor. A página publicada não lê a máquina do
     dono (`claude mcp list`) — mas pode ler isto, que é a verdade da instalação:
     quais serviços têm chave no ambiente. Nomes, nunca valores. */
  const conectores = resumoDosConectores(pedido);

  /* 1.69.0 · a entrada: quem entra, por onde, e o que falta a cada caminho.
     Só nomes de variáveis e o email mascarado — o health é público. */
  const entrada = (() => {
    const o = opcoesDeEntrada(pedido);
    return {
      dono: o.donos[0] || null,
      soDono: true,
      github: o.fornecedores.find((f) => f.id === 'github')?.pronto || false,
      /* 1.74.0 · a conta GitHub do dono é reconhecida pelo id/login? (só o facto) */
      donoGithub: !!o.donoGithub,
      google: o.fornecedores.find((f) => f.id === 'google')?.pronto || false,
      codigo: o.codigo.pronto,
      falta: o.fornecedores.filter((f) => !f.pronto).map((f) => ({ fornecedor: f.id, falta: f.falta })),
      porque: o.codigo.pronto
        ? 'email + código de 6 dígitos: a palavra-passe sozinha não abre a sessão'
        : 'sem RESEND_API_KEY o código não sai; até lá entra-se com a palavra-passe (e o ecrã di-lo)',
    };
  })();

  if (!env.pronto) {
    res.status(503).json({ ok: false, modo: 'local', error: 'sem SUPABASE_URL/SUPABASE_SECRET_KEY na Vercel', versao: VERSAO, conectores, ia, prontidao, acesso, ciclo, entrada });
    return;
  }

  try {
    const repo = createSupabaseRepo(env);
    let h = await repo.health();
    /* 1.79.0 · a base cura-se sozinha. Em produção o health respondia
       `ok:false · faltam:['orbita_faturas']` e ninguém ia correr SQL à mão: o
       curador da porta só olhava para contas e sessões. Agora, quando falta uma
       tabela da mesa, o esquema versionado é aplicado (é idempotente) e a base é
       perguntada outra vez. `esquema` diz o que aconteceu — sem inventar nada. */
    let esquema = null;
    if (!h.ok && Array.isArray(h.faltam) && h.faltam.length) {
      esquema = await garantirEsquemaDaMesa(repo, pedido).catch((e) => ({ ok: false, motivo: e.message }));
      if (esquema && esquema.ok) h = await repo.health();
    }
    /* 1.76.1 · a PORTA, à vista: a base tem as colunas que a entrada usa?
       A lista `faltam` acima olha para as tabelas; esta sonda olha para as
       colunas (código, OAuth, confirmação) — foi a falta delas que deu «a base
       de dados recusou a conta do dono» com o health a dizer que estava tudo
       bem. Sem segredos: só sim/não e a frase da base. */
    const porta = await sondaDaPorta(repo);
    res.status(h.ok ? 200 : 503).json({ ...h, modo: 'base', versao: VERSAO, porta, esquema, conectores, ia, prontidao, acesso, ciclo, entrada });
  } catch (e) {
    res.status(503).json({ ok: false, modo: 'base', error: e.message || 'a base não respondeu', versao: VERSAO, conectores, ia, prontidao, acesso, ciclo, entrada });
  }
}
