// Órbita — A CÂMARA (29 out 2026, 1.53.0).
//
// Pedido do dono: «arrastar e mover, scroll para os lados, outros ângulos da câmara».
//
// Até aqui o escritório tinha UMA direcção: a isométrica fixa (1, 0.92, 1). O rato servia para
// pan e zoom — nunca para rodar à volta. Este ficheiro é a conta, pura: sem three, sem DOM.
//
// A regra é simples e dita em voz alta:
//   · rodar  = girar a direcção da câmara à volta do eixo Y (yaw, em radianos);
//   · inclinar = subir/descer o olhar (0.45 rasante … 2.2 a pino), e é isso que dá as «outras
//     vistas»: a mesma planta, vista de outro ângulo;
//   · o zoom NÃO muda de ângulo, e o ângulo NÃO muda o zoom — cada gesto faz uma coisa.
//
// O que se prova em `camera.test.mjs`: os quatro ângulos fecham um quarto de volta exacto, o
// yaw nunca cresce sem fim (dá a volta em vez de acumular), a inclinação tem limites, e a
// direcção devolvida tem sempre comprimento 1 (senão o zoom parecia mudar sozinho).

const TAU = Math.PI * 2;

/** A direcção isométrica da casa: quem nunca tocou em nada vê exactamente o que via antes. */
export const ISO_BASE = Object.freeze({ x: 1, y: 0.92, z: 1 });

/** Quatro vistas laterais + uma aérea. `yaw` é relativo à isométrica (0 = a de sempre). */
export const ANGULOS = Object.freeze([
  { id: 'ne', nome: 'Nordeste', curto: 'NE', yaw: 0 },
  { id: 'no', nome: 'Noroeste', curto: 'NO', yaw: -Math.PI / 2 },
  { id: 'so', nome: 'Sudoeste', curto: 'SO', yaw: -Math.PI },
  { id: 'se', nome: 'Sudeste', curto: 'SE', yaw: -3 * Math.PI / 2 },
]);

/** A vista aérea: mesma planta, olhada quase de cima. */
export const AEREA = Object.freeze({ id: 'aerea', nome: 'Vista aérea', curto: 'AÉREA', yaw: 0, inclinacao: 2.1 });

export const INCLINACAO_MIN = 0.45;   // rasante, quase ao nível das secretárias
export const INCLINACAO_MAX = 2.2;    // a pino
export const INCLINACAO_BASE = ISO_BASE.y;

/** Normaliza um ângulo para (-π, π]: rodar 400 vezes não deixa a conta a crescer. */
export function normalizarAngulo(a) {
  const n = Number(a);
  if (!Number.isFinite(n)) return 0;
  let r = n % TAU;
  if (r > Math.PI) r -= TAU;
  if (r <= -Math.PI) r += TAU;
  return r;
}

/** Soma um delta de rotação ao yaw, já normalizado (uma volta é uma volta, não 6.28 acumulados). */
export function rodar(yaw, deltaRad) {
  return normalizarAngulo(normalizarAngulo(yaw) + (Number(deltaRad) || 0));
}

/** A inclinação que fica: dentro dos limites, e um valor inválido não estraga a vista. */
export function inclinacaoValida(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return INCLINACAO_BASE;
  return Math.min(INCLINACAO_MAX, Math.max(INCLINACAO_MIN, n));
}

/**
 * A direcção da câmara para um yaw e uma inclinação.
 * `y` é a altura (inclinação); `x`/`z` são o plano girado. O resultado é sempre unitário.
 */
export function direcaoDaCamara(yaw = 0, inclinacao = INCLINACAO_BASE) {
  const y = inclinacaoValida(inclinacao);
  // o raio no plano, para a vista ficar com o mesmo «peso» em qualquer ângulo
  const raio = Math.hypot(ISO_BASE.x, ISO_BASE.z);
  const base = Math.atan2(ISO_BASE.z, ISO_BASE.x);
  const a = base + normalizarAngulo(yaw);
  const x = Math.cos(a) * raio;
  const z = Math.sin(a) * raio;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** O ângulo mais próximo de um yaw qualquer — para o botão saber em que vista estamos. */
export function anguloActual(yaw) {
  const y = normalizarAngulo(yaw);
  let melhor = ANGULOS[0], dist = Infinity;
  for (const a of ANGULOS) {
    const d = Math.abs(normalizarAngulo(y - a.yaw));
    if (d < dist) { dist = d; melhor = a; }
  }
  return melhor;
}

/** O próximo ângulo ao rodar para a direita (sentido horário) ou para a esquerda. */
export function proximoAngulo(yaw, sentido = 1) {
  const ordem = ANGULOS.map((a) => a.yaw);
  const actual = normalizarAngulo(yaw);
  const i = ordem.findIndex((v) => Math.abs(normalizarAngulo(v - actual)) < 1e-6);
  const passo = sentido >= 0 ? 1 : -1;
  const proximo = i < 0 ? 0 : (i + passo + ordem.length) % ordem.length;
  return ANGULOS[proximo];
}

/** Texto curto para o botão: «NE · 0°» ou «AÉREA · 2.1». */
export function etiquetaDoAngulo(yaw, inclinacao = INCLINACAO_BASE) {
  const a = anguloActual(yaw);
  const graus = Math.round(normalizarAngulo(yaw) * 180 / Math.PI);
  const soGraus = graus === 0 ? '' : ` · ${graus}°`;
  const vista = inclinacao >= 1.7 ? 'AÉREA' : a.curto;
  return `${vista}${soGraus}`;
}

/** Decisão de gesto: o que um `wheel` significa. Horizontal (ou Shift) roda; o resto dá zoom. */
export function gestoDoScroll({ deltaX = 0, deltaY = 0, shiftKey = false } = {}) {
  const dx = Number(deltaX) || 0, dy = Number(deltaY) || 0;
  if (Math.abs(dx) > Math.abs(dy) || (shiftKey && Math.abs(dy) >= Math.abs(dx))) {
    return { tipo: 'rodar', valor: (shiftKey && Math.abs(dy) >= Math.abs(dx)) ? dy : dx };
  }
  return { tipo: 'zoom', valor: dy };
}

/** Quantos radianos vale um scroll. Trackpads mandam dezenas; ratos mandam 100. */
export const RAD_POR_PIXEL = 0.0042;

/**
 * O que um arrasto significa.
 *
 * 1.53.2 · o pedido do dono: «os giros não serão por botões, serão pelo mouse
 * mesmo, clicando na área sem nada e arrastando». Então a regra passou a ser:
 *
 *   · carregar no VAZIO do escritório e arrastar → RODA a câmara (`vazio: true`);
 *   · arrastar com Shift → MOVE o chão (o pan precisa de casa);
 *   · Alt, botão do meio ou direito → RODA (para quem já tem o hábito);
 *   · arrastar sobre uma secretária/agente → MOVE (o clique continua a abrir a ficha).
 */
export function gestoDoArrasto({ altKey = false, botao = 0, vazio = false, shiftKey = false } = {}) {
  if (altKey || botao === 1 || botao === 2) return 'rodar';
  if (shiftKey) return 'mover';
  if (vazio) return 'rodar';
  return 'mover';
}
