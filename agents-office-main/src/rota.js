/* ===========================================================================
   1.53.1 · PARA ONDE VAI UM «OI» — a decisão, pura e testável.

   O que aconteceu a 29 out 2026: o dono escolheu a Groq, escreveu «oi», e o
   compositor estava em CONSTRUIR. Esse modo cria uma tarefa no quadro, e o
   quadro (`/api/tasks`) não existe na página publicada — a Vercel devolveu uma
   página de erro e o cartão dizia «Não foi criada». A Groq nunca foi chamada.

   A regra que este ficheiro passa a impor: **um pedido de conversa nunca morre
   por falta do quadro.** Se o quadro não existe, responde-se em conversa, com
   o motor escolhido, e diz-se a verdade sobre o que se fez.

   Três caminhos, e só três:
     · `quadro`        — criar a tarefa (só quando há servidor local);
     · `conversa`      — /api/rpc → /ia/chat (a Órbita; é o que existe publicado);
     · `motor-local`   — /api/chat (o CLI desta máquina, com as notas da casa).

   Sem three, sem DOM, sem fetch: só a decisão. Quem a executa é o `main.js`.
   =========================================================================== */

export const CAMINHOS = Object.freeze({
  QUADRO: 'quadro',
  CONVERSA: 'conversa',
  MOTOR_LOCAL: 'motor-local',
});

/**
 * Para onde vai este envio?
 *
 * @param {object} o
 * @param {string} o.modo     'ask' | 'plan' | 'build'
 * @param {object|null} o.par  `{fornecedor, modelo}` escolhido à mão, ou null (automático)
 * @param {boolean} o.quadro   o servidor das tarefas responde? (`tasks.isLive()`)
 * @param {boolean} o.temCli   há modelos do CLI da casa (`/api/health` com `models`)
 * @param {boolean} o.temOrbita há modelos da Órbita no catálogo (`/ia/modelos`)
 * @returns {'quadro'|'conversa'|'motor-local'}
 */
export function rotaDoEnvio({ modo = 'ask', par = null, quadro = false, temCli = true, temOrbita = false } = {}) {
  /* construir é o único modo que precisa do quadro. Sem quadro NÃO se cai no motor
     local: ele voltaria a tentar criar a tarefa. Vai-se à conversa — é o pedido
     «as IAs devem responder a tudo». */
  if (modo === 'build') return quadro ? CAMINHOS.QUADRO : CAMINHOS.CONVERSA;
  /* um par escolhido à mão só existe na Órbita: `/api/chat` não o conhece */
  if (par) return CAMINHOS.CONVERSA;
  /* a página publicada não tem motor local; a Órbita responde por /api/rpc */
  if (!temCli && temOrbita) return CAMINHOS.CONVERSA;
  /* sem motor nenhum à vista, a conversa é o último sítio que pode responder:
     pedir-lhe é melhor do que bater numa rota que não existe */
  if (!temCli && !temOrbita) return CAMINHOS.CONVERSA;
  return CAMINHOS.MOTOR_LOCAL;
}

/**
 * Depois de bater no quadro e falhar: ainda vale a pena responder em conversa?
 * Só quando o servidor disse que a rota não existe (`sem-servidor`) e há Órbita
 * para falar. Um erro de base de dados (500) não se disfarça de conversa.
 */
export function deveCairParaConversa({ falha = null, temOrbita = false } = {}) {
  return !!falha && falha.tipo === 'sem-servidor' && !!temOrbita;
}

/** O que se diz ao dono quando o quadro não existe e a resposta vem da conversa. */
export function avisoDaQueda({ modo = 'build' } = {}) {
  return modo === 'build'
    ? 'O quadro de tarefas só existe no Órbita do teu computador. Aqui respondo em conversa.'
    : 'O quadro não respondeu nesta publicação. Respondi em conversa.';
}

/** A etiqueta que fica por baixo da resposta, para não haver dúvida do caminho. */
export function metaDaQueda({ modo = 'build' } = {}) {
  return `${modo === 'build' ? 'Construir' : 'Conversa'} · sem quadro nesta publicação`;
}
