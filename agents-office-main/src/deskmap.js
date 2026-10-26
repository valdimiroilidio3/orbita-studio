// Órbita — O MAPA DA SECRETÁRIA (27 out 2026, 1.10.0).
//
// Porque existe. O pedido foi: «melhorar as interações do braço de avatar mexendo realmente o
// mouse e digitando nos teclados». Para as mãos *tocarem* o teclado e o rato, três sítios têm de
// concordar sobre onde essas coisas estão:
//
//   1. `builders.js` — desenha a secretária, o teclado, as teclas e o rato;
//   2. `avatar.js`   — resolve o braço (IK) até ao ponto de contacto;
//   3. `main.js`     — move o rato e afunda as teclas que estão a ser premidas.
//
// Se cada um tivesse os seus números, as mãos pairavam ao lado das teclas — e ninguém dava por
// isso num teste. Aqui os números vivem num sítio só, são puros (sem `three`, sem DOM) e por isso
// podem ser verificados em `node --test`.
//
// FRAME. Todas as posições deste ficheiro estão no referencial do POSTO (`station` em main.js):
// o posto assenta a `STATION_Y` acima do chão e é rodado 45° para o ecrã do visitante. O avatar
// senta-se em `SEAT` e olha para `-z` (o monitor); `toAvatarLocal()` faz a conta que o avatar
// precisa — e é a mesma conta que o `main.js` usa para o pôr no lugar.

/* ---------- chão do posto ---------- */
/** a estação (secretária + cadeira) assenta 12 cm acima do chão da sala. */
export const STATION_Y = 0.12;
/** a face de cima do tampo: é aqui que pousa tudo o que está em cima da mesa. */
export const DESK_TOP_Y = 2.32;

/** onde o avatar sentado tem a raiz (pés do modelo). `poseWork` escreve o mesmo valor. */
export const SEAT = { x: 0, y: 0.55, z: 1.7 };

/* ---------- o teclado ---------- */
export const KEYBOARD = {
  x: -0.22,        // ligeiramente à esquerda do monitor: deixa o tapete do rato à direita
  y: 2.398,        // a face das teclas (o plano desenhado)
  z: 0.86,         // encostado à beira da mesa, onde uma pessoa o põe
  w: 1.68, d: 0.52,
  baseH: 0.075,    // a altura da caixa do teclado
  capH: 0.024,     // a altura de uma tecla (a que se afunda)
};

/** a grelha de teclas — os mesmos números que a textura do teclado desenha. */
export const KEY_GRID = { texW: 320, texH: 110, cols: 14, rows: 4, pad: 7, gap: 3, spaceH: 10 };

/** a superfície onde o dedo pousa (topo das teclas, no referencial do posto). */
export const KEY_CAP_TOP = KEYBOARD.y + KEYBOARD.capH / 2 + 0.001;

/* ---------- o rato ---------- */
export const MOUSE_PAD = { x: 1.16, y: DESK_TOP_Y + 0.019, z: 0.84, w: 0.94, d: 0.86 };
export const MOUSE = {
  x: MOUSE_PAD.x, z: MOUSE_PAD.z,
  r: 0.115, sy: 0.58, sz: 1.42,
};
/** a altura do centro do rato: pousado no tapete. */
export const MOUSE_Y = MOUSE_PAD.y + MOUSE.r * MOUSE.sy;
/** a superfície onde a mão pousa no rato. */
export const MOUSE_TOP = MOUSE_Y + MOUSE.r * MOUSE.sy;
/** o rato não sai do tapete. */
export const MOUSE_TRAVEL = { x: 0.20, z: 0.28 };

/* ---------- a grelha de teclas, célula a célula ---------- */

/**
 * As 56 teclas (14×4) e a barra de espaço, com o centro de cada uma em coordenadas do posto.
 * A conta é a da textura (`keyboardTexture`): pixels do canto superior esquerdo → centímetros.
 */
export function keyCells() {
  const { texW, texH, cols, rows, pad, gap, spaceH } = KEY_GRID;
  const kw = (texW - pad * 2 - gap * (cols - 1)) / cols;
  const kh = (texH - pad * 2 - gap * (rows - 1) - spaceH) / rows;
  const toX = (px) => KEYBOARD.x + (px / texW - 0.5) * KEYBOARD.w;
  const toZ = (py) => KEYBOARD.z + (py / texH - 0.5) * KEYBOARD.d;
  const w = (kw / texW) * KEYBOARD.w;
  const d = (kh / texH) * KEYBOARD.d;
  const out = [];
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      out.push({
        i, r, w, d,
        x: toX(pad + i * (kw + gap) + kw / 2),
        z: toZ(pad + r * (kh + gap) + kh / 2),
      });
    }
  }
  const sw = kw * 6 + gap * 5;
  out.push({
    i: -1, r: rows, space: true, w: (sw / texW) * KEYBOARD.w, d: (8 / texH) * KEYBOARD.d,
    x: toX(pad + kw * 2 + sw / 2),
    z: toZ(texH - pad - 8 + 4),
  });
  return out;
}

/** a tecla mais próxima de um ponto (x, z) do posto. Devolve o índice em `keyCells()`. */
export function nearestKey(x, z, cells = keyCells()) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const dx = Math.max(0, Math.abs(x - c.x) - c.w / 2);
    const dz = Math.max(0, Math.abs(z - c.z) - c.d / 2);
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/* ---------- as duas metades do teclado ---------- */
// O avatar chega ao teclado com os dois braços. O braço do lado do rato cobre a metade direita
// (vista de quem escreve), o outro a metade esquerda. Cada zona é um rectângulo em x do posto.
export const KEY_ZONE = {
  // `armKeys` = o braço do lado oposto ao rato (x positivo no referencial do avatar)
  keys: { x0: KEYBOARD.x - KEYBOARD.w * 0.46, x1: KEYBOARD.x + KEYBOARD.w * 0.02 },
  // `armMouse` = o braço que também vai ao rato
  mouse: { x0: KEYBOARD.x + KEYBOARD.w * 0.02, x1: KEYBOARD.x + KEYBOARD.w * 0.46 },
};
/** a fila onde as mãos repousam (0 = a mais afastada, 3 = a mais perto de quem escreve). */
export const KEY_ROW_HOME = 2;

/* ---------- do posto para o avatar ---------- */

/**
 * Converte um ponto do posto para o referencial do avatar sentado.
 * O avatar está rodado 180° (olha para o monitor), por isso x e z trocam de sinal.
 */
export function toAvatarLocal(p) {
  return { x: -(p.x - SEAT.x), y: p.y - SEAT.y, z: -(p.z - SEAT.z) };
}

/* ---------- o rato mexe-se ---------- */

/**
 * Onde está o rato dentro do tapete, em coordenadas do posto. Duas sinusoides de períodos que não
 * se dividem: o rasto nunca repete o mesmo caminho, e nunca sai do tapete. `phase` separa os 35.
 */
export function mouseAt(t, phase = 0) {
  const a = t / 1000 + phase * 6.283185307179586;
  const x = MOUSE.x + Math.sin(a * 0.37) * MOUSE_TRAVEL.x * 0.82 + Math.sin(a * 0.93 + 1.7) * 0.05;
  const z = MOUSE.z + Math.cos(a * 0.29) * MOUSE_TRAVEL.z * 0.70 + Math.sin(a * 1.31 + 0.4) * 0.04;
  const lim = (v, c, half) => Math.min(c + half, Math.max(c - half, v));
  return {
    x: lim(x, MOUSE.x, MOUSE_PAD.w / 2 - MOUSE.r - 0.04),
    z: lim(z, MOUSE.z, MOUSE_PAD.d / 2 - MOUSE.r * MOUSE.sz - 0.04),
  };
}

/**
 * O ritmo de escrita de uma mão. Devolve onde está o dedo (x, z no posto) e há quanto tempo está a
 * premir (0..1). A mão deriva devagar pelas teclas; o toque vem em batidas regulares, com pausas
 * de leitura — é assim que se lê «está a escrever» em vez de «está a tremer».
 */
export function typingHand(t, phase, which = 0, op = {}) {
  const T = t / 1000 + phase;
  const zone = which === 0 ? KEY_ZONE.keys : KEY_ZONE.mouse;
  const drift = op.drift ?? 1;
  const cx = (zone.x0 + zone.x1) / 2, halfW = (zone.x1 - zone.x0) / 2;
  const dz = KEYBOARD.d * 0.29;
  const x = cx + (Math.sin(T * 0.83 + which * 2.4) * 0.62 + Math.sin(T * 1.9 + which) * 0.2) * halfW * drift;
  const z = KEYBOARD.z + (Math.sin(T * 0.57 + which * 1.3) * 0.5 + (KEY_ROW_HOME - 1.5) * 0.34) * dz;
  const beat = 0.2;
  const ph = (T % beat) / beat;
  const pausa = Math.sin(T * 0.31 + which * 2.7) > 0.82;   // de vez em quando pára e lê
  const press = pausa ? 0 : Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 2.2);
  const cell = nearestKey(x, z);
  return { x, z, press: Math.min(1, press), cell, pause: pausa };
}

/** O ritmo de um clique no rato: curto, e só de vez em quando. */
export function clickBeat(t, phase) {
  const T = t / 1000 + phase;
  const slot = 1.9;                                   // um clique a cada ~2 s
  const ph = (T % slot) / slot;
  const ativo = ph < 0.16;                            // o clique dura 0,3 s
  const press = ativo ? Math.sin((ph / 0.16) * Math.PI) : 0;
  return { press: Math.max(0, press), down: press > 0.35 };
}

/**
 * O estado completo de contacto de um posto. `mode`:
 *   · `'type'`  — as duas mãos escrevem (o braço do rato fica na metade dele do teclado);
 *   · `'mouse'` — a mão do rato está no rato (e clica de vez em quando), a outra continua a escrever;
 *   · `'none'`  — ninguém toca em nada (a ler, a olhar, de pé).
 *
 * Devolve `keys` (a mão do teclado, sempre) e `mouse` (só no modo rato) ou `second` (a segunda mão
 * no teclado). Tudo em coordenadas do posto — quem precisa do referencial do avatar usa
 * `toAvatarLocal`, e quem desenha as teclas usa `cell`/`nd` para saber o que afundar.
 */
export function contact(t, phase = 0, mode = 'type') {
  const a = typingHand(t, phase, 0);   // o braço do teclado (x positivo no referencial do avatar)
  const b = typingHand(t, phase, 1);   // o braço do rato
  // o dedo desce com a tecla que está a premir (é isso que se lê como «a digitar»)
  const k = (h) => ({ x: h.x, y: KEY_CAP_TOP - 0.014 * h.press, z: h.z, press: h.press, cell: h.cell, pause: h.pause });
  const rato = mouseAt(t, phase);
  const clk = clickBeat(t, phase);
  if (mode === 'none') return { mode, keys: null, mouse: null, second: null };
  if (mode === 'mouse') {
    return {
      mode,
      keys: k(a),
      mouse: { x: rato.x, y: MOUSE_TOP + 0.004, z: rato.z, press: clk.press, down: clk.down },
      second: null,
    };
  }
  return { mode: 'type', keys: k(a), mouse: null, second: k(b) };
}
