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
