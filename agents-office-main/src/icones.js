/* ===========================================================================
   1.78.0 · OS ÍCONES SÃO A SÉRIO — Lucide (7 nov 2026)

   A barra do escritório tinha glifos feitos à mão: um ⌂ aqui, um ◍ ali, um «+»
   de texto acolá. Cada um com o seu peso e o seu traço — e o resultado lia-se
   como uma mistura, não como um produto.

   Aqui os ícones vêm do **Lucide** (ISC, 1.70.0), a biblioteca que o dono
   escolheu: 24×24, traço de 2, cantos redondos, forma consistente. Não se
   importa a biblioteca inteira — importa-se o ficheiro de cada ícone
   (`lucide/dist/esm/icons/<nome>.mjs`), que é só um array de `[tag, atributos]`.
   O `esbuild` leva para o pacote apenas os que este módulo usa (cerca de 20),
   e não os 2 000.

   Três decisões que valem a pena escrever:

     · o SVG é criado com `createElementNS`, não com `innerHTML` — os atributos
       vêm da biblioteca, mas um ícone não deve ser o único sítio do produto onde
       se aceita HTML de fora;
     · cada ícone é decorativo por omissão (`aria-hidden`): quem lê o ecrã ouve
       o botão («Visão geral»), não «ícone de casa». Quando faz sentido um
       título, `titulo` põe um `<title>` e o ícone passa a ter nome;
     · o crédito (ISC) vive aqui e no `NOTICE` do pacote — a licença viaja com o
       código, como as outras.
   =========================================================================== */
import Gauge from 'lucide/dist/esm/icons/gauge.mjs';
import House from 'lucide/dist/esm/icons/house.mjs';
import Grid from 'lucide/dist/esm/icons/layout-grid.mjs';
import Scan from 'lucide/dist/esm/icons/scan.mjs';
import Sun from 'lucide/dist/esm/icons/sun.mjs';
import Moon from 'lucide/dist/esm/icons/moon.mjs';
import ChevronDown from 'lucide/dist/esm/icons/chevron-down.mjs';
import ChevronUp from 'lucide/dist/esm/icons/chevron-up.mjs';
import RotateLeft from 'lucide/dist/esm/icons/rotate-ccw.mjs';
import RotateRight from 'lucide/dist/esm/icons/rotate-cw.mjs';
import Users from 'lucide/dist/esm/icons/users.mjs';
import Sparkles from 'lucide/dist/esm/icons/sparkles.mjs';
import Check from 'lucide/dist/esm/icons/check.mjs';
import X from 'lucide/dist/esm/icons/x.mjs';
import Refresh from 'lucide/dist/esm/icons/refresh-cw.mjs';
import Zap from 'lucide/dist/esm/icons/zap.mjs';
import Clock from 'lucide/dist/esm/icons/clock.mjs';
import Power from 'lucide/dist/esm/icons/power.mjs';
import Activity from 'lucide/dist/esm/icons/activity.mjs';
import Settings from 'lucide/dist/esm/icons/settings.mjs';
import ArrowUpRight from 'lucide/dist/esm/icons/arrow-up-right.mjs';
import Panel from 'lucide/dist/esm/icons/panel-right.mjs';
import Alert from 'lucide/dist/esm/icons/triangle-exclamation-point.mjs';
import Plus from 'lucide/dist/esm/icons/plus.mjs';
import Minus from 'lucide/dist/esm/icons/minus.mjs';

/** O conjunto que o produto usa. Nome em português → dados do Lucide. */
export const ICONES = {
  remoto: Gauge,
  geral: House,
  planta: Grid,
  aerea: Scan,
  claro: Sun,
  escuro: Moon,
  fechar: ChevronDown,
  abrir: ChevronUp,
  esquerda: RotateLeft,
  direita: RotateRight,
  salas: Users,
  ia: Sparkles,
  feito: Check,
  erro: X,
  refrescar: Refresh,
  activo: Zap,
  espera: Clock,
  parado: Power,
  trabalho: Activity,
  config: Settings,
  abrirFora: ArrowUpRight,
  painel: Panel,
  aviso: Alert,
  mais: Plus,
  menos: Minus,
};

const NS = 'http://www.w3.org/2000/svg';

/**
 * Constrói o `<svg>` de um ícone. `doc` entra por parâmetro para o teste poder
 * usar um DOM falso sem tocar no global.
 */
export function icone(nome, { doc = globalThis.document, size = 16, stroke = 1.9, cls = '', titulo = '' } = {}) {
  const dados = ICONES[nome];
  if (!dados || !doc || typeof doc.createElementNS !== 'function') return null;
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  if (cls) svg.setAttribute('class', cls);
  if (titulo) {
    svg.setAttribute('role', 'img');
    const t = doc.createElementNS(NS, 'title');
    t.textContent = titulo;
    svg.appendChild(t);
  } else {
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
  }
  for (const [tag, attrs] of dados) {
    const no = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) no.setAttribute(k, String(v));
    svg.appendChild(no);
  }
  return svg;
}

/** O mesmo ícone como texto SVG — para os sítios que escrevem HTML (o painel da mesa). */
export function iconeTexto(nome, { size = 16, stroke = 1.9, cls = '' } = {}) {
  const dados = ICONES[nome];
  if (!dados) return '';
  const attrs = (o) => Object.entries(o || {}).map(([k, v]) => `${k}="${v}"`).join(' ');
  const corpo = dados.map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('');
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" `
    + `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"`
    + `${cls ? ` class="${cls}"` : ''}>${corpo}</svg>`;
}
