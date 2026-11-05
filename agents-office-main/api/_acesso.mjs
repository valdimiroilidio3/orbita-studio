/* ===========================================================================
   1.66.0 · O ACESSO POR TOKEN (4 nov 2026)

   Porque este ficheiro existe: a lista de prontidão dizia, desde a 1.41.0, que
   o `ORBITA_API_TOKEN` «fecha o `/api/*`» e que o `ORBITA_ADMIN_TOKEN` «protege a
   página e a mesa». Não era verdade — nenhum ficheiro do servidor lia os dois.
   O `/api/*` estava fechado, sim, mas pela PORTA (`_porta.mjs`), com sessões; os
   dois tokens não faziam nada. Uma lista que pede ao dono que invente dois
   segredos de 32 e 16 caracteres e depois não os usa é a mentira mais cara
   desta casa: dá trabalho e não dá segurança.

   O que passa a ser verdade, e é só isto:

     · um pedido a `/api/rpc` sem sessão pode trazer o token no cabeçalho
       (`Authorization: Bearer …` ou `x-orbita-token: …`) ou no corpo (`token`);
     · o token NUNCA se aceita no endereço — é a lição da 1.64 (um segredo num
       URL fica no histórico, nos registos e no `Referer`);
     · `ORBITA_API_TOKEN` vale como **operador** (lê e escreve, não aprova nem
       entrega);
     · `ORBITA_ADMIN_TOKEN` vale como **dono** (aprova, entrega, pára envios);
     · **nenhum dos dois mexe em contas nem em palavras-passe.** Isso faz-se com
       sessão, na app, com o papel à frente: um token roubado não cria um dono
       novo nem muda uma palavra-passe;
     · variável vazia, curta ou ausente = não existe. Um `undefined` no ambiente
       nunca pode valer como «igual a tudo».

   É pura: recebe cabeçalhos, corpo e ambiente, e devolve quem é — ou ninguém.
   Não faz rede, não toca na base, e por isso se prova em teste.
   =========================================================================== */

/** Os dois tokens, do mais forte para o mais fraco. A primeira coluna é a verdade. */
export const TOKENS = [
  {
    variavel: 'ORBITA_ADMIN_TOKEN', papel: 'dono', id: 'token-admin', nome: 'Token de administração',
    porque: 'acesso total à API por token: aprova, entrega e pára envios sem sessão',
  },
  {
    variavel: 'ORBITA_API_TOKEN', papel: 'operador', id: 'token-api', nome: 'Token da API',
    porque: 'lê e escreve na API por token, sem sessão; não aprova nem entrega',
  },
];

/** Tamanho mínimo aceitável de cada um (abaixo disto é como se não estivesse lá). */
export const MINIMOS = { ORBITA_API_TOKEN: 32, ORBITA_ADMIN_TOKEN: 16 };

/** Os únicos caminhos que um token nunca abre: contas e palavras-passe. */
export const ADMINISTRACAO = ['utilizadores', 'sessoes', 'contas'];

const limpo = (v) => String(v == null ? '' : v).trim();

/** O token que vem no pedido — cabeçalho primeiro, corpo depois. Nunca no URL. */
export function tokenDoPedido(headers = {}, corpo = null) {
  const h = headers || {};
  const autorizacao = limpo(h.authorization || h.Authorization);
  if (autorizacao) {
    const m = /^Bearer\s+(.+)$/i.exec(autorizacao);
    if (m) return m[1].trim();
  }
  const proprio = limpo(h['x-orbita-token'] || h['X-Orbita-Token']);
  if (proprio) return proprio;
  if (corpo && typeof corpo === 'object' && typeof corpo.token === 'string') return corpo.token.trim();
  return '';
}

/**
 * Comparação que não pára na primeira letra diferente (tempo ~constante).
 * `''` nunca é igual a `''`: um ambiente sem a variável não abre nada.
 */
export function iguais(a, b) {
  const x = limpo(a);
  const y = limpo(b);
  if (!x || !y) return false;
  if (x.length !== y.length) return false;
  let diferente = 0;
  for (let i = 0; i < x.length; i += 1) diferente |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diferente === 0;
}

/**
 * Quem é este pedido pelo token? `null` quando nenhum serve.
 * Devolve também `variavel` — para se poder dizer QUAL dos dois entrou, sem
 * nunca escrever o valor.
 */
export function quemPeloToken({ headers = {}, corpo = null, env = {} } = {}) {
  const trazido = tokenDoPedido(headers, corpo);
  if (!trazido) return null;
  for (const t of TOKENS) {
    const esperado = limpo(env[t.variavel]);
    if (esperado.length < MINIMOS[t.variavel]) continue;   // curto = não configurado
    if (iguais(trazido, esperado)) {
      return { id: t.id, nome: t.nome, papel: t.papel, via: 'token', variavel: t.variavel };
    }
  }
  return null;
}

/** O retrato dos dois, para a saúde e para a prontidão: nomes e booleanos, nunca valores. */
export function estadoDosTokens(env = {}) {
  const mapa = {};
  for (const t of TOKENS) {
    const v = limpo(env[t.variavel]);
    mapa[t.variavel] = { configurado: v.length >= MINIMOS[t.variavel], curto: v.length > 0 && v.length < MINIMOS[t.variavel] };
  }
  return mapa;
}

/** O que se pode fazer com um token, em palavras — o que o ecrã e o `/api` dizem. */
export const EXPLICACAO = {
  como: 'manda o token no cabeçalho: Authorization: Bearer <token> (ou x-orbita-token: <token>); nunca no endereço',
  contas: 'contas e palavras-passe mudam-se com sessão, na app — o token não as abre',
};
