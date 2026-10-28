/* ===========================================================================
   1.50.0 · AS FALHAS, DITAS COM VERDADE — 28 out 2026

   O escritório publicado na Vercel responde a `/api/health` (é uma função a
   sério) mas NÃO tem `/api/tasks` (essa rota só existe no `serve.mjs`, no
   computador do dono). Até aqui a barra de tarefas fazia `res.json()` sobre a
   página de erro em HTML da Vercel, rebentava com
   «Unexpected token 'T', "The page c"...» e concluía, por cima da mentira:
   «Sem um motor de IA ligado».

   Duas coisas erradas numa: o motor podia estar bom, e o problema era a rota
   não existir. Este módulo existe para que um erro de rede nunca volte a ser
   explicado como falta de IA. É puro (sem DOM, sem fetch) para poder ser
   testado em `falhas.test.mjs`.

   Quatro falhas, quatro frases:
     sem-servidor → a rota não existe nesta publicação
     sem-motor    → o servidor respondeu e disse que falta o motor (ou a chave)
     servidor     → o servidor respondeu e recusou (com o que ele disse)
     rede         → não se chegou ao servidor
   =========================================================================== */

export const ROTA_DA_MESA = '/app#/ia';

/** A resposta é uma página HTML no lugar de JSON? (a assinatura da rota ausente) */
export function pareceHTML(texto) {
  const t = String(texto || '').trim().slice(0, 400).toLowerCase();
  if (!t) return false;
  return t.startsWith('<') || t.includes('<!doctype') || t.includes('<html');
}

/** Lê o corpo com cuidado: JSON quando é JSON, texto quando não é. Nunca atira. */
export function lerCorpo(texto) {
  const t = String(texto || '');
  if (!t.trim()) return { json: null, html: false, texto: t };
  if (pareceHTML(t)) return { json: null, html: true, texto: t };
  try {
    return { json: JSON.parse(t), html: false, texto: t };
  } catch {
    return { json: null, html: false, texto: t };
  }
}

const corta = (s, n = 160) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

/**
 * Explica uma falha a partir do que veio do servidor.
 * `{ status, texto, rota }` — devolve `{ tipo, frase, detalhe, ajuda, html }`.
 * `html` já vem escapado? Não: vem como texto. Quem desenha usa `esc()`.
 */
export function explicarFalha({ status = 0, texto = '', rota = '/api/tasks', erro = null } = {}) {
  const lido = lerCorpo(texto);
  const dito = String(erro || (lido.json && (lido.json.error || lido.json.erro || lido.json.motivo)) || '').trim();

  /* 1 · a rota não existe nesta publicação */
  if (lido.html || (status === 404 && !lido.json)) {
    return {
      tipo: 'sem-servidor',
      frase: 'Esta página está publicada sem o servidor das tarefas.',
      detalhe: `a rota ${rota} não existe aqui — a Vercel respondeu com uma página de erro em vez de dados`,
      ajuda: `Nada foi criado e nada foi perdido. A mesa (${ROTA_DA_MESA}) fala com o motor a sério; no teu computador, «npm start» levanta o escritório com a rota das tarefas.`,
      html: false,
    };
  }

  /* 2 · o servidor respondeu e o motivo é o motor */
  if (dito && /motor|sem ia|nenhum fornecedor|chave|api key|\bPATH\b|modelo indispon|não respondeu nenhum/i.test(dito)) {
    return {
      tipo: 'sem-motor',
      frase: 'O servidor respondeu: não há motor de IA a responder.',
      detalhe: corta(dito),
      ajuda: 'Escolhe outro motor na barra (botão do motor) ou liga-o na mesa, em AI · Control Center. Sem motor, a tarefa não é inventada.',
      html: false,
    };
  }

  /* 3 · o servidor respondeu e recusou, com uma razão própria */
  if (dito) {
    return {
      tipo: 'servidor',
      frase: `O servidor recusou${status ? ` (HTTP ${status})` : ''}.`,
      detalhe: corta(dito),
      ajuda: 'O que está escrito acima é o que o servidor disse — não foi o escritório a inventá-lo.',
      html: false,
    };
  }

  /* 4 · não se chegou lá */
  if (!status) {
    return {
      tipo: 'rede',
      frase: 'Não cheguei ao servidor.',
      detalhe: 'o pedido não saiu ou a resposta não voltou',
      ajuda: `Verifica que o escritório está a correr («npm start»). A mesa (${ROTA_DA_MESA}) continua a funcionar na nuvem.`,
      html: false,
    };
  }

  /* 5 · respondeu, mas sem explicação legível */
  return {
    tipo: 'servidor',
    frase: `O servidor respondeu ${status} sem explicação.`,
    detalhe: corta(lido.texto) || '(corpo vazio)',
    ajuda: 'Isto não é falta de IA — é uma resposta que não traz motivo. Vale a pena ver o terminal do escritório.',
    html: false,
  };
}

/**
 * O que a barra deve dizer sobre o estado do motor quando o servidor local não
 * tem a rota (Vercel): em vez de «SEM IA» — que era falso — diz onde a IA está.
 * Recebe o `/ia/estado` da mesa (pode ser `null`).
 */
export function motorNaMesa(estado) {
  const lista = Array.isArray(estado?.fornecedores) ? estado.fornecedores : [];
  const prontos = lista.filter((f) => f && f.configurado && !f.desligado);
  return {
    disponivel: prontos.length > 0,
    quantos: prontos.length,
    total: lista.length,
    frase: prontos.length
      ? `${prontos.length} fornecedor(es) prontos na mesa`
      : (lista.length ? 'nenhum fornecedor pronto na mesa' : 'a mesa não respondeu'),
    nomes: prontos.slice(0, 4).map((f) => f.nome || f.id),
  };
}

/** Uma linha para o `<title>`/tooltip — sem prometer o que não há. */
export function fraseDaBarra({ temServidorLocal = false, motorLocal = null, mesa = null } = {}) {
  if (temServidorLocal) {
    return motorLocal
      ? `servidor local · motor ${motorLocal}`
      : 'servidor local · sem motor ligado';
  }
  if (mesa && mesa.disponivel) return `sem servidor local · ${mesa.frase} (${mesa.nomes.join(', ')})`;
  return 'sem servidor local · as tarefas criam-se na mesa';
}
