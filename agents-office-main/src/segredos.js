/* ===========================================================================
   1.65.0 · OS SEGREDOS QUE O DONO TEM DE INVENTAR (4 nov 2026)

   O arranque dizia «falta `ORBITA_API_TOKEN` (32 caracteres ou mais)» e ficava
   por ali. Quem lê isso tem de saber (a) que valor pôr, (b) que esse valor não
   pode ser curto, e (c) que não o pode ler outra vez na Vercel — as variáveis
   sensíveis são escritas às cegas. Era o último passo que ainda pedia uma
   consola.

   Aqui gera-se o valor no browser (`crypto.getRandomValues`) com o tamanho
   mínimo que `api/_prontidao.mjs` exige, e mostra-se uma vez para copiar. Três
   regras que este ficheiro não quebra:

     · sem gerador aleatório NÃO se inventa um valor previsível — diz-se que não
       dá e manda-se usar `openssl rand -hex 24`;
     · o valor não é guardado em lado nenhum (nem `localStorage`, nem URL, nem
       registo): vive no estado da página e sai quando se sai dela;
     · o mínimo não é copiado para aqui à mão — um teste confronta esta tabela
       com `GRUPOS` de `api/_prontidao.mjs`, para não haver duas verdades.
   =========================================================================== */

/**
 * Tamanho mínimo de cada segredo que o dono inventa.
 *
 * Só entram aqui os que `api/_prontidao.mjs` exige de facto. Os outros segredos
 * (chave do Resend, segredo da Meta) vêm do fornecedor e não têm mínimo nosso:
 * pôr um número inventado era criar uma regra que o servidor não aplica.
 */
export const MINIMOS = {
  ORBITA_API_TOKEN: 32,
  ORBITA_ADMIN_TOKEN: 16,
  SETUP_TOKEN: 12,
};

/** As variáveis que a página sabe gerar (o resto é colado do fornecedor). */
export const GERAVEIS = Object.keys(MINIMOS);

/** Onde o valor entra, em palavras: a Vercel não é óbvia na primeira vez. */
export const PASSOS = [
  'Vercel → o projeto → Settings → Environment Variables',
  'Add New: o nome exacto à esquerda, o valor à direita',
  'marca Production (e Preview, se quiseres testar antes)',
  'Save e depois Deployments → o último → Redeploy',
];

/**
 * Gera um segredo novo para `variavel`. Hexadecimal (só `0-9a-f`: nada de
 * caracteres que se percam ao copiar ou que a Vercel tenha de escapar).
 * Devolve sempre um objecto — nunca lança, porque quem chama está a desenhar
 * um ecrã e um `throw` deixava o botão morto sem explicação.
 */
export function gerarSegredo(variavel, fonte = globalThis.crypto) {
  const nome = String(variavel || '');
  const minimo = MINIMOS[nome];
  if (!minimo) {
    return {
      ok: false, variavel: nome, minimo: null,
      motivo: `Não sei o tamanho mínimo de ${nome || 'um segredo sem nome'}: gera-o no fornecedor ou com \`openssl rand -hex 24\`.`,
    };
  }
  if (!fonte || typeof fonte.getRandomValues !== 'function') {
    return {
      ok: false, variavel: nome, minimo,
      motivo: `Este browser não expõe um gerador de números aleatórios (página servida sem HTTPS?). Gera com \`openssl rand -hex ${Math.ceil(minimo / 2)}\`.`,
    };
  }
  const bytes = Math.ceil(minimo / 2);
  const buf = new Uint8Array(bytes);
  fonte.getRandomValues(buf);
  const valor = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return { ok: true, variavel: nome, valor, tamanho: valor.length, minimo };
}

/**
 * Confere um valor contra o mínimo da variável. `ok: null` quando não se sabe o
 * mínimo — que não é o mesmo que «está bem» nem que «está mal».
 */
export function avaliarSegredo(variavel, valor) {
  const nome = String(variavel || '');
  const v = String(valor || '');
  const minimo = MINIMOS[nome] || null;
  const tamanho = v.length;
  if (!v) return { ok: false, tamanho, minimo, motivo: 'está vazio' };
  const bonito = /^[A-Za-z0-9_-]+$/.test(v);
  if (minimo === null) {
    return {
      ok: null, tamanho, minimo, motivo: `não sei o mínimo de ${nome || 'esta variável'}; ${tamanho} caracteres${bonito ? '' : ' (e há caracteres que podem perder-se ao copiar)'}`,
    };
  }
  if (tamanho < minimo) {
    return { ok: false, tamanho, minimo, motivo: `${tamanho} caracteres, e o mínimo é ${minimo}` };
  }
  return { ok: true, tamanho, minimo, motivo: `${tamanho} caracteres — chega` };
}

/** Mostra um segredo sem o mostrar: as pontas e o tamanho. */
export function mascara(valor) {
  const v = String(valor || '');
  if (!v) return '';
  if (v.length <= 8) return `${'•'.repeat(v.length)} (${v.length})`;
  return `${v.slice(0, 4)}…${v.slice(-4)} (${v.length})`;
}

/** A frase que acompanha um valor gerado: aparece uma vez e não fica guardado. */
export function avisoDoGerado(variavel, tamanho) {
  return `${variavel}: ${tamanho} caracteres. Copia agora — não fica guardado nesta página nem no browser, e a Vercel não volta a mostrá-lo depois de gravar.`;
}
