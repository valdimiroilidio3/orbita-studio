// Órbita — A LUZ QUE ACENDE (28 out 2026, pedido: «falta iluminação nas coisas
// deste projecto, ganhando vida (leds acendendo realmente)»).
//
// Porque este ficheiro existe. A cena já tinha fitas de LED a correr nos
// corredores, mas a luz era CONSTANTE: a sala com três tarefas a correr tinha o
// mesmo brilho da sala vazia. Isto separa a conta (pura, testável aqui) do
// desenho (o `main.js` só aplica os números), para se poder provar — sem `three`
// e sem browser — que a luz responde ao trabalho real.
//
// Regras:
//   · sem trabalho, a sala não está apagada: fica num repouso baixo (uma sala às
//     escuras não é um escritório, é um armazém);
//   · com trabalho, acende — mais depressa do que apaga (a luz responde ao que
//     acontece, e despede-se devagar);
//   · ao arrancar, as salas acendem uma a uma (é o único momento em que há
//     teatro — e é honesto: o sistema está mesmo a ligar-se);
//   · quem pediu «menos movimento» não leva cintilação: a luz acende e respira
//     mais devagar, sem oscilar.

/** Os números da luz, num sítio só. Intensidades relativas (1 = acesa). */
export const LUZ = {
  repouso: 0.34,      // sala sem trabalho
  acesa: 1.0,         // sala com trabalho
  porTarefa: 0.08,    // cada tarefa a mais (até ao tecto)
  tecto: 1.42,        // nunca mais do que isto, senão o vidro estoura
  pulso: 0.09,        // amplitude do «respirar» (9 %)
  periodo: 4200,      // ms de um respirar completo
  acender: 620,       // ms para uma sala acender
  apagar: 1400,       // ms para voltar ao repouso (mais lento, de propósito)
  atraso: 95,         // ms entre salas no arranque
  cintilar: 0.07,     // amplitude do cintilar no arranque (só sem «menos movimento»)
};

/**
 * O alvo da luz de uma sala, a partir do trabalho real.
 * @param {{live?:number, waiting?:number, failed?:number}} estado
 */
export function alvo({ live = 0, waiting = 0, failed = 0 } = {}) {
  const emCurso = Math.max(0, Number(live) || 0);
  const espera = Math.max(0, Number(waiting) || 0);
  const falhas = Math.max(0, Number(failed) || 0);
  const n = emCurso + espera;
  if (!n) return Math.min(LUZ.tecto, LUZ.repouso + (falhas ? 0.05 : 0));
  const bruto = LUZ.acesa + Math.max(0, n - 1) * LUZ.porTarefa;
  // uma sala só com aprovações pendentes não está a produzir: fica acesa, mas
  // ligeiramente abaixo de quem está mesmo a trabalhar
  const factor = emCurso ? 1 : 0.86;
  return Math.min(LUZ.tecto, bruto * factor);
}

/** O respirar: devolve um multiplicador perto de 1. Desligado com «menos movimento». */
export function respirar(t, { calmo = false, periodo = LUZ.periodo, amplitude = LUZ.pulso } = {}) {
  if (calmo) return 1;
  const fase = ((Number(t) || 0) % periodo) / periodo;
  return 1 + amplitude * Math.sin(fase * Math.PI * 2);
}

/**
 * O arranque de uma sala: 0 antes da sua vez, sobe até 1, com um cintilar curto
 * (o filamento a pegar). Com `calmo`, sobe liso.
 */
export function acender(t, { inicio = 0, atraso = 0, duracao = LUZ.acender, calmo = false } = {}) {
  const x = ((Number(t) || 0) - (Number(inicio) || 0) - (Number(atraso) || 0)) / Math.max(1, duracao);
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const ease = 1 - Math.pow(1 - x, 3);
  if (calmo) return ease;
  const cintilar = LUZ.cintilar * Math.sin(x * Math.PI * 7) * (1 - x);
  return Math.max(0, Math.min(1, ease + cintilar));
}

/**
 * Aproximação suave do valor actual ao alvo, independente do fps.
 * `dp` = quanto falta andar neste frame (0 = parado, 1 = salta já).
 */
export function aproximar(actual, alvo_, ms, { subir = 420, descer = LUZ.apagar } = {}) {
  const a = Number(actual) || 0;
  const b = Number(alvo_) || 0;
  const dt = Math.max(0, Number(ms) || 0);
  const tau = b > a ? subir : descer;
  if (!tau) return b;
  const k = 1 - Math.exp(-dt / tau);
  const v = a + (b - a) * k;
  return Math.abs(b - v) < 0.0015 ? b : v;
}

/**
 * Tudo junto: o valor final de uma sala num instante.
 * @returns {{valor:number, alvo:number, aceso:number, respira:number}}
 */
export function luzDaSala(t, estado, { inicio = 0, atraso = 0, calmo = false } = {}) {
  const alvo_ = alvo(estado || {});
  const aceso = acender(t, { inicio, atraso, calmo });
  const respira = respirar(t, { calmo });
  return { valor: alvo_ * aceso * respira, alvo: alvo_, aceso, respira };
}

/** Quanto tempo até a última sala acender (para a apresentação saber quando parar). */
export function fimDoArranque(salas, { inicio = 0, atraso = LUZ.atraso, duracao = LUZ.acender } = {}) {
  const n = Math.max(0, Number(salas) || 0);
  return Number(inicio) + Math.max(0, n - 1) * atraso + duracao;
}
