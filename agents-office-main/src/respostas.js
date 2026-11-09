/* ===========================================================================
   1.54.4 · LER UMA RESPOSTA DA BASE (2 nov 2026)

   Um `404` deixou de ser ambíguo. Antes desta versão havia dois 404 com
   significados opostos e a mesa tratava-os da mesma maneira:

     · a ROTA não existe  → esta instalação é antiga: usa o armazém do browser
       e diz-se «modo local»;
     · o RECURSO não existe → o projeto/lead/ficheiro não existe (foi apagado,
       o link está errado) → tem de aparecer o motivo, não um modo local falso.

   O teste que revelou isto: abrir `#/projeto/p_fantasma` mostrava «Modo local —
   A base de dados não está a responder» com a base perfeitamente viva.

   A decisão vive aqui, pura e testável, e a mesa só a aplica.
   =========================================================================== */

const AVISO_ROTA = /a base ainda n[ãa]o serve|rota desconhecida|rota n[ãa]o encontrada/i;

/** Este corpo diz que a ROTA não existe (e não que o recurso não existe)? */
export function rotaAusente(corpo = null) {
  /* sem corpo nenhum: só pode ser uma versão antiga da função — mantém-se o
     comportamento antigo (cair para o armazém do browser) */
  if (corpo === null || corpo === undefined) return true;
  if (typeof corpo !== 'object') return true;
  if (corpo.rota === true) return true;
  if (corpo.rota === false) return false;
  const frase = String(corpo.error || corpo.erro || corpo.mensagem || corpo.message || '');
  /* sem frase nenhuma não há como distinguir: fica o comportamento antigo
     (armazém do browser), que nunca esconde um «HTTP 404» sem sentido */
  if (!frase) return true;
  return AVISO_ROTA.test(frase);
}

/**
 * 1.73.0 · um 503 que diz o que FALTA não é uma avaria da base.
 *
 * `/auth/codigo` responde 503 quando não há `RESEND_API_KEY`: é uma recusa
 * deliberada, com a lista do que falta. Tratá-la como «a base não responde»
 * fazia a mesa cair para o armazém do browser e mostrar «o modo local ainda não
 * faz «/auth/codigo»» — uma frase que não é verdade nenhuma: o servidor estava
 * vivo e tinha explicado tudo. Um 503 com `falta` é um erro a mostrar, com o
 * corpo à mão.
 */
export function recusaConfigurada(corpo = null) {
  if (!corpo || typeof corpo !== 'object') return false;
  return Array.isArray(corpo.falta) && corpo.falta.length > 0;
}

/** A frase que se mostra ao dono, seja qual for a chave que o servidor usou. */
export function mensagemDe(corpo = null, estado = 0) {
  if (corpo && typeof corpo === 'object') {
    const t = corpo.error || corpo.erro || corpo.mensagem || corpo.message;
    if (t) return String(t);
    if (corpo.hint) return String(corpo.hint);
  }
  return `HTTP ${estado}`;
}

/**
 * A decisão, a partir do que a rede devolveu.
 *
 * @param {object} p
 * @param {boolean} p.httpOk       a resposta HTTP foi 2xx?
 * @param {number}  p.httpStatus   o status HTTP
 * @param {object}  p.envelope     o corpo recebido (`{status, corpo}` ou `{error}`)
 * @returns {{tipo:'ok'|'local'|'base'|'erro'|'login', corpo?:any, estado?:number,
 *            mensagem?:string, motivo?:string, codigo?:string|null}}
 */
export function decidirResposta({ httpOk = true, httpStatus = 200, envelope = null } = {}) {
  const j = envelope && typeof envelope === 'object' ? envelope : {};

  /* HTTP falhou (não é 2xx): o `/api/rpc` só devolve isto em avaria, em 401/503
     ou quando o caminho não existe nesta instalação */
  if (!httpOk) {
    if (httpStatus === 404 || httpStatus === 405) {
      return rotaAusente(j) ? { tipo: 'local' } : { tipo: 'erro', estado: httpStatus, mensagem: mensagemDe(j, httpStatus) };
    }
    if (httpStatus === 503) {
      if (recusaConfigurada(j)) return { tipo: 'erro', estado: 503, mensagem: mensagemDe(j, 503), codigo: j.codigo || null, corpo: j };
      return { tipo: 'base', motivo: mensagemDe(j, httpStatus) };
    }
    if (httpStatus === 401) return { tipo: 'login', mensagem: mensagemDe(j, 401), corpo: j };
    return { tipo: 'erro', estado: httpStatus, mensagem: mensagemDe(j, httpStatus) };
  }

  /* HTTP 200 com o envelope `{ status, corpo }` do `/api/rpc` */
  const estado = Number(j.status) || 200;
  const corpo = j.corpo !== undefined ? j.corpo : j;

  if (estado === 404 || estado === 405) {
    return rotaAusente(corpo)
      ? { tipo: 'local' }
      : { tipo: 'erro', estado, mensagem: mensagemDe(corpo, estado), codigo: corpo?.codigo || null };
  }
  if (estado === 503) {
    if (recusaConfigurada(corpo)) return { tipo: 'erro', estado, mensagem: mensagemDe(corpo, estado), codigo: corpo.codigo || null, corpo };
    return { tipo: 'base', motivo: mensagemDe(corpo, estado) };
  }
  if (estado === 401) return { tipo: 'login', mensagem: mensagemDe(corpo, estado), corpo };
  if (estado >= 400) {
    return { tipo: 'erro', estado, mensagem: mensagemDe(corpo, estado), codigo: corpo?.codigo || null, corpo };
  }
  if (corpo && typeof corpo === 'object' && corpo.ok === false) {
    return { tipo: 'erro', estado, mensagem: mensagemDe(corpo, estado), codigo: corpo.codigo || null, corpo };
  }
  return { tipo: 'ok', corpo };
}
