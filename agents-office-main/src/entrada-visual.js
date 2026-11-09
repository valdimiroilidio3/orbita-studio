/* ===========================================================================
   1.71.0 · A ENTRADA, A DOIS TEMPOS (6 nov 2026)

   O dono pediu o ecrã de entrada do componente «modern-animated-sign-in»: metade
   esquerda com anéis e portas a girar, metade direita com o formulário, tudo a
   entrar em cascata. O pedido vinha em React + Tailwind + shadcn — e este
   produto não é isso: é JavaScript puro compilado para um HTML só, com o seu
   próprio CSS. Seguir as instruções à letra (instalar shadcn, Tailwind,
   TypeScript, `motion`) seria trocar o sistema por outro, e o que o dono pediu
   foi **o desenho**, não a stack.

   Por isso o mesmo efeito é feito com o que já existe:

     · `Ripple`          → anéis concêntricos, `@keyframes` de pulso;
     · `OrbitingCircles` → cada porta gira à volta do centro, com o ícone a
                            contra-girar para não ficar de pernas para o ar
                            (`animation-direction: inherit`);
     · `BoxReveal`       → a entrada em cascata, com atraso por bloco (`--atraso`);
     · `Input` com halo  → gradiente radial seguindo o rato, alimentado por
                            `--mx`/`--my` (ver `mesa.js`), sem `motion`.

   Este ficheiro é **puro**: devolve strings de HTML e não conhece DOM, rede nem
   estado. Os ícones entram por parâmetro, para o módulo não depender da mesa —
   e para o teste poder contar as portas sem um browser.
   =========================================================================== */

/** As portas que giram à volta do centro. `raio` em px, `duracao` em segundos. */
export const ORBITAS = [
  { id: 'github', raio: 96, duracao: 26, atraso: 0, reverso: false, tamanho: 44 },
  { id: 'google', raio: 96, duracao: 26, atraso: 13, reverso: false, tamanho: 44 },
  { id: 'email', raio: 168, duracao: 34, atraso: 3, reverso: true, tamanho: 38 },
  { id: 'codigo', raio: 168, duracao: 34, atraso: 20, reverso: true, tamanho: 38 },
  { id: 'orbita', raio: 240, duracao: 44, atraso: 6, reverso: false, tamanho: 34 },
];

/** Quantos anéis tem o pulso do fundo (o `numCircles` do componente). */
export const ANEIS = 9;

/** Uma porta: o ícone vem de fora (a mesa passa os dela). */
const PORTA_PADRAO = '<span class="porta-letra"></span>';

/**
 * Os anéis do fundo. Cada um cresce e pulsa com um atraso próprio — a única
 * coisa que aqui se decide é o tamanho e a opacidade de cada anel.
 */
export function aneisHTML(n = ANEIS, { tamanho = 120, passo = 54, opacidade = 0.2 } = {}) {
  const total = Math.max(1, Number(n) || ANEIS);
  let html = '';
  for (let i = 0; i < total; i += 1) {
    const px = tamanho + i * passo;
    const op = Math.max(0.03, opacidade - i * 0.021);
    const atraso = (i * 0.16).toFixed(2);
    html += `<span class="anel" style="--px:${px}px;opacity:${op.toFixed(3)};animation-delay:${atraso}s"></span>`;
  }
  return `<div class="aneis" aria-hidden="true">${html}</div>`;
}

/**
 * As portas a girar. `portas` é `{ id: '<svg…>' }`: o que aqui se faz é pôr cada
 * uma na sua órbita, com o sentido e a velocidade certos.
 */
export function orbitasHTML(portas = {}, orbitas = ORBITAS) {
  const lista = (Array.isArray(orbitas) ? orbitas : ORBITAS)
    .map((o) => {
      const icone = portas[o.id] || PORTA_PADRAO;
      return `<div class="orbita${o.reverso ? ' reversa' : ''}" style="--raio:${o.raio};--dur:${o.duracao};--atraso:${o.atraso};--tam:${o.tamanho}">
        <span class="porta porta-${o.id}" title="${o.id}">${icone}</span>
      </div>`;
    })
    .join('');
  return `<div class="orbitas" aria-hidden="true">${lista}</div>`;
}

/**
 * O palco completo: a arte à esquerda, o formulário à direita.
 * `corpo` é o HTML do formulário — este módulo não sabe o que ele faz.
 */
export function palcoHTML({
  titulo = 'Órbita', sub = '', portas = {}, corpo = '', aneis = ANEIS, rodape = '',
} = {}) {
  return `<div class="palco">
    <aside class="palco-arte" aria-hidden="true">
      <div class="palco-centro">
        ${aneisHTML(aneis)}
        ${orbitasHTML(portas)}
        <div class="palco-marca"><span class="mark"></span><b>${escapar(titulo)}</b></div>
      </div>
      ${sub ? `<p class="palco-sub">${escapar(sub)}</p>` : ''}
      ${rodape ? `<div class="palco-rodape">${rodape}</div>` : ''}
    </aside>
    <main class="palco-lado">
      <div class="palco-cartao">${corpo}</div>
    </main>
  </div>`;
}

/** Um bloco que entra em cascata (o `BoxReveal`). `atraso` em segundos. */
export function revelar(html, atraso = 0, classe = '') {
  const a = Number(atraso) || 0;
  return `<div class="rev${classe ? ` ${classe}` : ''}" style="animation-delay:${a.toFixed(2)}s">${html}</div>`;
}

/** O mínimo para não injetar HTML por engano nos dois textos que este módulo escreve. */
export function escapar(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ===========================================================================
   1.72.1 · QUANDO O FORNECEDOR RECUSA, DIZ-SE O QUE FAZER

   O Google devolve `403: org_internal` quando a app OAuth está configurada com
   o tipo de utilizador «Interno»: só contas da organização entram — e uma conta
   `@gmail.com` nunca é da organização. O texto que a Google manda é em inglês e
   fala de «desenvolvedor», o que não ajuda quem tem a consola aberta noutro
   separador.

   Os códigos conhecidos traduzem-se aqui, com o sítio exacto onde se resolve —
   porque um ecrã que diz «falhou» e não diz «onde» não serve de nada.
   =========================================================================== */

export const RECUSAS = {
  org_internal: {
    titulo: 'a app do Google está fechada à organização',
    oQue: 'O cliente OAuth está com o tipo de utilizador «Interno», por isso só contas da organização entram — e uma conta @gmail.com nunca é da organização.',
    como: 'Google Cloud Console → Google Auth Platform (ou «OAuth consent screen») → Público → muda o tipo de utilizador de «Interno» para «Externo»; depois, em «Utilizadores de teste», acrescenta cheltonmahoze7@gmail.com.',
  },
  access_denied: {
    titulo: 'a entrada foi cancelada no fornecedor',
    oQue: 'Quem estava a entrar fechou a janela do fornecedor, ou a conta escolhida não tem permissão para esta app.',
    como: 'Carrega em «Continuar com Google» (ou com GitHub) outra vez e escolhe a conta do dono.',
  },
  redirect_uri_mismatch: {
    titulo: 'o endereço de retorno não é o que está registado',
    oQue: 'O fornecedor recusa devolver a pessoa a um endereço que não esteja registado ao carácter.',
    como: 'Regista exactamente https://orbita-agentes.vercel.app/ (Google) ou https://orbita-agentes.vercel.app/api/oauth?fornecedor=github (GitHub) e tenta outra vez.',
  },
  deleted_client: {
    titulo: 'o cliente OAuth já não existe',
    oQue: 'A aplicação foi apagada (ou recriada) na consola e as chaves na Vercel ficaram a apontar para o cliente antigo.',
    como: 'Cria um cliente novo, actualiza GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET (ou as do GitHub) na Vercel e faz Redeploy.',
  },
  invalid_client: {
    titulo: 'o cliente e o segredo não combinam',
    oQue: 'O ID e o segredo guardados na Vercel não são o par que o fornecedor conhece — normalmente de uma chave rodada.',
    como: 'Copia outra vez o ID e o segredo da consola para a Vercel e faz Redeploy.',
  },
  invalid_scope: {
    titulo: 'o fornecedor não aceita os âmbitos pedidos',
    oQue: 'A app pede openid/email/profile; se o ecrã de consentimento não tiver esses âmbitos, recusa.',
    como: 'Na consola, em «Âmbitos», acrescenta email e profile (e openid) ao ecrã de consentimento.',
  },
};

/**
 * Traduz uma recusa do fornecedor. Aceita o código puro (`org_internal`) ou o
 * formato que a volta usa (`google:org_internal`). Nunca inventa: um código
 * desconhecido devolve-se tal e qual, com a frase honesta de que não o conheço.
 *
 * @returns {{codigo:string, fornecedor:string|null, conhecido:boolean, titulo:string, oQue:string, como:string, texto:string}}
 */
export function explicarRecusa(valor) {
  const bruto = String(valor == null ? '' : valor).trim();
  const [talvezFornecedor, ...resto] = bruto.split(':');
  const temFornecedor = resto.length > 0 && ['google', 'github'].includes(talvezFornecedor.toLowerCase());
  const codigo = (temFornecedor ? resto.join(':') : bruto).trim();
  const fornecedor = temFornecedor ? talvezFornecedor.toLowerCase() : null;
  const r = RECUSAS[codigo];
  if (!r) {
    return {
      codigo, fornecedor, conhecido: false,
      titulo: 'o fornecedor recusou a entrada',
      oQue: codigo || 'não veio nenhuma razão do fornecedor',
      como: 'Tenta outra vez. Se repetir, vê os detalhes na consola do fornecedor (OAuth) e nas variáveis da Vercel.',
      texto: `o fornecedor recusou a entrada (${codigo || 'sem razão'}) — tenta outra vez`,
    };
  }
  return {
    codigo, fornecedor, conhecido: true, ...r,
    texto: `${r.titulo}: ${r.oQue} Como resolver: ${r.como}`,
  };
}

/** A frase pronta para o ecrã — ou vazia, quando não há nada a explicar. */
export function textoDaRecusa(valor) {
  const t = String(valor == null ? '' : valor).trim();
  if (!t) return '';
  /* uma frase já escrita por nós (por exemplo a do `state`) passa intacta */
  if (!/^[a-z0-9_]+$/i.test(t.split(':').pop() || '') || /\s/.test(t)) return t;
  return explicarRecusa(t).texto;
}
