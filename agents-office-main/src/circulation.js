// Órbita — ONDE FICA CADA PORTA (28 out 2026, pedido 35: «melhore os lugares das portas»).
//
// Isto é geometria pura: não desenha nada, não sabe o que é three. Recebe a planta (`LAYOUT`, com a
// posição e o tamanho de cada sala) e o átrio (o Cérebro) e responde, para cada sala, uma pergunta
// só: **onde é que a porta tem de estar para abrir para o Cérebro, com a ponte a sair dela?**
//
// Porque é que isto passou a ser um ficheiro:
//   · na 1.13.0 a porta estava 1,1 m à frente da parede, num canto, e a ponte passava por baixo do
//     pod a caminho do Cérebro — a porta abria para nada;
//   · na 1.13.1 a porta foi para o meio do pano de fundo, mas a ponte continuava a correr ENCOSTADA
//     ao pod (a sala e o braço do Cérebro estão no mesmo z), e nas salas de canto a porta ficava
//     perpendicular à parede que a recebia.
//
// A regra, agora, é uma só e vale para as seis salas:
//
//   a porta fica no lado da sala que olha para o Cérebro, no ponto onde a linha
//   «centro da sala → Cérebro» sai do pod; a ponte vai desse ponto ao Cérebro, em linha recta,
//   e chega-lhe em esquadria (perpendicular à porta).
//
// O resultado é uma coroa de seis pontes a irradiar do átrio — quatro diagonais (as salas de canto)
// e duas direitas (as do eixo) — e cada porta virada para dentro, para o sítio para onde as pessoas
// vão: o Cérebro.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {string} key        a sala (`marketing`, `emails`, …)
 * @param {object} layout     `LAYOUT` de `src/data.js`
 * @param {object} atrium     meio-lado do pod do Cérebro (8 para um pod de 16×16)
 * @returns {{key, side, dir, at, local, atrium, bridge, walled, screen, angle}}
 */
export function doorPlan(key, layout, atrium = { x: 8, z: 8 }) {
  const L = layout[key];
  if (!L) throw new Error('sala desconhecida: ' + key);
  const C = { x: L.pos[0], z: L.pos[1] };
  // o ponto do átrio mais próximo do centro desta sala (o canto que lhe fica à frente)
  const A = { x: clamp(C.x, -atrium.x, atrium.x), z: clamp(C.z, -atrium.z, atrium.z) };
  const dx = A.x - C.x, dz = A.z - C.z;
  // onde é que essa linha sai do pod? (o primeiro dos dois lados que ela corta)
  const tx = dx ? (L.w / 2) / Math.abs(dx) : Infinity;
  const tz = dz ? (L.d / 2) / Math.abs(dz) : Infinity;
  const t = Math.min(tx, tz, 1);
  const ex = C.x + t * dx, ez = C.z + t * dz;
  const axis = tx < tz ? 'x' : 'z';
  const side = axis === 'x' ? (dx > 0 ? '+x' : '-x') : (dz > 0 ? '+z' : '-z');
  const dir = { x: axis === 'x' ? Math.sign(dx) : 0, z: axis === 'z' ? Math.sign(dz) : 0 };

  // a porta, em coordenadas LOCAIS da sala (o pod não está rodado: local = mundo − posição)
  const local = { x: ex - C.x, z: ez - C.z };
  // a ponte começa 0,9 m à frente da porta (o patamar) e acaba no Cérebro
  const from = { x: ex + dir.x * 0.9, z: ez + dir.z * 0.9 };
  const len = Math.hypot(A.x - from.x, A.z - from.z);

  /* As paredes de cada sala estão sempre no lado -x e -z (é o lado que a câmara não vê). Por isso
     o lado da porta diz logo se há parede para abrir ou se é preciso um GUARDA-CORPO de verdade
     (um pano de parede próprio, senão a porta fica de pé no vazio). */
  const walled = side === '-x' || side === '-z';

  return {
    key, side, dir,
    at: { x: ex, z: ez },          // mundo
    local,                          // no referencial da sala
    atrium: A,                      // onde a ponte chega
    bridge: { from, to: A, len },
    // o ângulo que o grupo da porta tem de rodar para o seu +z olhar para o Cérebro
    angle: Math.atan2(dir.x, dir.z),
    walled, screen: !walled,
    // o eixo do vão na parede: '-z' corta o pano de fundo, '-x' corta o pano lateral
    openingSide: walled ? (side === '-z' ? '-z' : '-x') : null,
  };
}

/** As seis salas de uma vez, na ordem do `layout` (estável, para os testes poderem comparar). */
export function doorPlans(layout, atrium = { x: 8, z: 8 }) {
  return Object.keys(layout).filter((k) => k !== 'brain').map((k) => doorPlan(k, layout, atrium));
}
