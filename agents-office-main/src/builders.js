// Órbita v2 — procedural mesh builders (stylised 3D, Image-1/2 blend on nominal palette)
import * as THREE from 'three';
// V7 (26 out 2026): os builders recebem CORES, nunca salas. Quem sabe que sala é qual é o
// main.js; quem sabe derivar tons de uma cor é a palette (pura, testável sem WebGL).
import { glassLayers, tint, shade, mix, brass } from './palette.js';
// 27 out 2026: o teclado, o tapete e o rato têm UM sítio onde estão definidos (`deskmap.js`), porque
// agora há mãos que têm de lhes chegar. Se estes números vivessem só aqui, o avatar adivinhava.
import {
  DESK_TOP_Y, KEYBOARD, KEY_CAP_TOP, MOUSE_PAD, MOUSE, MOUSE_Y, keyCells,
} from './deskmap.js';

export const PLINTH_H = 2.6;

/* 28 out 2026 — AS MEDIDAS DA CONSTRUÇÃO, num sítio só.
   A parede (`WALL`) e a porta (`DOOR`) são usadas por dois ficheiros que não se falam: o `main.js`
   assenta a porta no pano certo e o `makeRoomWalls` abre o vão. Se estes números vivessem em dois
   sítios, a porta ficava a flutuar 10 cm à frente do buraco — já aconteceu, e foi o dono que viu. */
export const WALL = { t: 0.34, base: 2.8, band: 1.9 };
export const DOOR = { clearW: 2.60, clearH: 2.18, frameW: 0.12, frameD: 0.24, headerH: 0.34 };
const WHITE = '#F7F7F2';

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0.02,
      ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.ei ?? 1 } : {}),
    }));
  }
  return matCache.get(key);
}

/* ---------- o LED que corre (28 out 2026) ----------
   Pedido do dono: «nos vidros deve passar uma luz led da cor». Uma tira acesa parada seria só um
   filete; o que se pede é LUZ A PASSAR. Faz-se com uma textura de cometa (uma cauda branca) que
   rola ao longo de uma faixa fina, em mistura aditiva — sobre o vidro lê-se como luz a atravessar
   o vidro, e custa um draw call por pano. A cor vem da sala, por isso o vidro e o LED dizem a
   mesma cor. Quem anima é o main (uma só passagem por frame, ver `ledFeed`). */
let cometCanvas = null;
function cometTexture(repeatX = 1) {
  if (!cometCanvas) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 4;
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    const g = x.createLinearGradient(0, 0, c.width, 0);
    // cauda longa, núcleo curto, corte seco à frente: é assim que uma luz em movimento se lê
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.80, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.90, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.955, 'rgba(255,255,255,0.55)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    cometCanvas = t;
  }
  const t = cometCanvas.clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.repeat.set(Math.max(1, repeatX), 1);
  return t;
}

/** Material de uma faixa de LED em movimento. `len` = metros do pano (a luz repete a cada ~3,4 m). */
export function ledComet(color, len, { speed = 0.06, opacity = 0.95, width = 0.09 } = {}) {
  const tex = cometTexture(len / 3.4);
  const m = new THREE.MeshBasicMaterial({
    map: tex, color: tint(color, 0.42), transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  // o main anima o que tiver `userData.led` (ver `tickLeds`)
  m.userData.led = true;
  m.userData.ledTex = tex;
  m.userData.ledSpeed = speed;
  return { material: m, width };
}

/* ---------- o tapete da passadeira ----------
   Uma textura de ripas em relevo, escura, que se repete ao longo do tapete e rola. O padrão é
   cinzento sobre preto: o material multiplica, por isso o tapete continua preto e as ripas apanham
   a luz — é assim que uma passadeira de aeroporto se lê, e não com riscas brancas. */
let beltCanvas = null;
function beltTexture(len = 10) {
  if (!beltCanvas) {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#2A2C31'; x.fillRect(0, 0, 64, 64);
    // a ripa: um degrau claro em cima e uma sombra em baixo — relevo, não pintura
    x.fillStyle = '#8A8E96'; x.fillRect(0, 6, 64, 5);
    x.fillStyle = '#4A4D54'; x.fillRect(0, 11, 64, 3);
    x.fillStyle = '#15171A'; x.fillRect(0, 14, 64, 18);
    x.fillStyle = '#71757D'; x.fillRect(0, 38, 64, 5);
    x.fillStyle = '#3A3D44'; x.fillRect(0, 43, 64, 3);
    x.fillStyle = '#101215'; x.fillRect(0, 46, 64, 18);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, 1);
    t.anisotropy = 4;
    beltCanvas = t;
  }
  const t = beltCanvas.clone();
  t.needsUpdate = true;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  // uma ripa a cada ~1,15 m ao longo do tapete; três ripas na largura
  t.repeat.set(Math.max(2, len / 1.15), 3);
  return t;
}

// Rounded-rectangle prism via extrusion. Origin at centre, extruded along Y.
const geoCache = new Map();
export function rboxGeo(w, d, h, r = 0.35) {
  const key = `${w}|${d}|${h}|${r}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const s = new THREE.Shape();
  const x = -w / 2, y = -d / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r); s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d); s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2); // extrude along +Y
  geoCache.set(key, g);
  return g;
}

export function rbox(w, d, h, color, r) {
  const m = new THREE.Mesh(rboxGeo(w, d, h, r), typeof color === 'string' ? mat(color) : color);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/* ---------- plinth: floating white pod with a coloured glass floor ----------
   V7 (26 out 2026), pedido do dono: «um chão da cor dos vidros». Antes era uma laje pastel
   opaca. Agora são quatro camadas, como um painel de vidro laminado visto de cima:

     0 · body  — o volume branco do pod (não mudou; é o que faz o pod flutuar)
     1 · base  — o tom fundo, opaco, 0.10 de altura: dá profundidade ao vidro e garante a cor
                 num ecrã que não faça transparência. É esta camada que recebe as sombras.
     2 · edge  — a aresta polida, mais clara, 0.115: é assim que o vidro real apanha a luz na
                 espessura. Aparece como um filete de 4 cm por dentro da base.
     3 · glass — a laje translúcida, 0.12 (o nível do chão, exactamente onde as secretárias
                 pousam), com verniz: o brilho duro vem daqui.
     4 · pool  — a poça de luz do candeeiro, branca e suave, por cima de tudo.

   Cada peça leva `userData.part` e `userData.tint` — nada de índices mágicos (`children[1]`)
   como antes, que se partiam à primeira camada nova. O modo escuro e o teste de cena leem isto.
   ---------------------------------------------------------------- */
let poolTex = null;
function lightPoolTexture() {
  if (poolTex) return poolTex;
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  x.clearRect(0, 0, S, S);
  const g = x.createRadialGradient(S * 0.36, S * 0.32, S * 0.01, S * 0.36, S * 0.32, S * 0.66);
  g.addColorStop(0, 'rgba(255,255,255,.46)');
  g.addColorStop(.38, 'rgba(255,255,255,.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  poolTex = new THREE.CanvasTexture(c);
  poolTex.colorSpace = THREE.SRGBColorSpace;
  return poolTex;
}

export function makePlinth(w, d, glassColor) {
  const L = glassLayers(glassColor); // valida a cor e deriva base/edge/pool
  const g = new THREE.Group();
  g.userData.glass = glassColor;

  const body = rbox(w, d, PLINTH_H, WHITE, 0.9);
  body.position.y = -PLINTH_H;
  body.userData.part = 'plinth';
  g.add(body);

  const part = (mesh, name, tone, extra = {}) => {
    mesh.userData.part = name;
    mesh.userData.tint = tone;
    mesh.castShadow = false;
    Object.assign(mesh, extra);
    g.add(mesh);
    mesh.userData.layer = name; // apelido legível na inspecção
    return mesh;
  };

  // 1 · o tom fundo (opaco, recebe sombras — as sombras das secretárias vêem-se ATRAVÉS do vidro)
  const base = rbox(w - 0.70, d - 0.70, 0.10, new THREE.MeshStandardMaterial({
    color: L.base, roughness: 0.88, metalness: 0.0,
  }), 0.7);
  base.position.y = 0;
  part(base, 'floorBase', L.base, { receiveShadow: true });

  // 2 · a aresta polida
  const edge = rbox(w - 0.79, d - 0.79, 0.115, new THREE.MeshStandardMaterial({
    color: L.edge, roughness: 0.34, metalness: 0.06,
  }), 0.68);
  edge.position.y = 0;
  part(edge, 'floorEdge', L.edge, { receiveShadow: true });

  // 3 · a laje de vidro (translúcida, com verniz). depthWrite desligado: quem manda na
  //     profundidade é a base; o vidro só pinta por cima.
  const glass = rbox(w - 0.88, d - 0.88, 0.12, new THREE.MeshPhysicalMaterial({
    color: L.glass, roughness: 0.06, metalness: 0.1,
    clearcoat: 1, clearcoatRoughness: 0.06,
    transparent: true, opacity: 0.62, depthWrite: false,
  }), 0.66);
  glass.position.y = 0;
  part(glass, 'floorGlass', L.glass, { receiveShadow: false });

  // 4 · a poça de luz. É um PLANO, não uma caixa: o ExtrudeGeometry mapeia as UVs das tampas em
  //     unidades de mundo, e o gradiente saía clampado (a poça desaparecia). Um plano tem UV
  //     0..1; e como o desvanecimento chega a zero na borda, o recorte recto não se vê — o plano
  //     fica 0.575 por dentro da laje, portanto dentro do canto arredondado.
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(w - 1.15, d - 1.15),
    new THREE.MeshBasicMaterial({
      map: lightPoolTexture(), transparent: true, opacity: 0.38,
      depthWrite: false, toneMapped: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.122;
  part(pool, 'floorPool', L.pool, { receiveShadow: false });

  // 5 · o vinco: um vão de sombra de 3 cm entre o tampo do plinto e o corpo. É o detalhe que faz
  //     uma peça flutuar em vez de pousar — o mesmo truque de mobiliário que a secretária já usa.
  // (o vinco tem de ser mais LARGO que o corpo: é uma sombra na face exterior, não uma peça dentro)
  const gapMat = new THREE.MeshStandardMaterial({ color: '#26272B', roughness: 0.9, metalness: 0.05 });
  const gap = rbox(w + 0.012, d + 0.012, 0.045, gapMat, 0.9);
  gap.position.y = -0.055;
  part(gap, 'plinthGap', '#26272B', { receiveShadow: false });

  // 6 · o filé de latão à volta da laje: um aro fino que apanha a luz na espessura do vidro. Não é
  //     decoração — é o que separa «plástico cor-de-rosa» de «vidro numa moldura de metal».
  const brassMat = new THREE.MeshStandardMaterial({
    color: brass(glassColor, 0.22), roughness: 0.28, metalness: 0.92,
  });
  const ix = (w - 0.88) / 2 + 0.02, iz = (d - 0.88) / 2 + 0.02;
  for (const [bw, bd, bx, bz] of [
    [(w - 0.84), 0.045, 0, -iz], [(w - 0.84), 0.045, 0, iz],
    [0.045, (d - 0.84), -ix, 0], [0.045, (d - 0.84), ix, 0],
  ]) {
    const bar = rbox(bw + 0.045, bd + 0.045, 0.035, brassMat, 0.02);
    bar.position.set(bx, 0.10, bz);
    part(bar, 'floorInlay', brass(glassColor, 0.22), { receiveShadow: false });
  }

  // as peças, por nome: quem desenha ou re-tinge não adivinha índices
  g.userData.parts = { body, base, edge, glass, pool, gap };
  return g;
}

/* ---------- floor title: serif letterspaced dept name lying on the floor ---------- */
export function makeFloorTitle(text, inkColor, width) {
  const c = document.createElement('canvas');
  const W = 1024, H = 192; c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.font = '700 92px Georgia, "Times New Roman", serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const sp = 14; // letterspacing via manual draw
  let total = 0;
  for (const ch of text) total += x.measureText(ch).width + sp;
  let cx0 = (W - total + sp) / 2;
  x.fillStyle = inkColor;
  for (const ch of text) {
    const cw = x.measureText(ch).width;
    x.fillText(ch, cx0 + cw / 2, H / 2 + 6);
    cx0 += cw + sp;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const h = width * (H / W);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.14;
  return m;
}

/* ---------- desk: wood top, white pedestals, monitor with live screen, chair ---------- */
export function makeDeskScreenTexture(chip) {
  // sem `document` (testes em Node) não há tela desenhada: devolve-se vazia em vez de rebentar.
  // A geometria do monitor é a mesma; só o conteúdo do ecrã é que não existe.
  if (typeof document === 'undefined' || !document.createElement) return { tex: null, canvas: null, draw: () => {} };
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const x = c.getContext('2d');
  const draw = (lines) => {
    // live cream screen (v1 rule: wood desks with live cream/mint screens)
    x.fillStyle = '#FDFFF8'; x.fillRect(0, 0, 256, 160);
    x.fillStyle = chip; x.fillRect(0, 0, 256, 26);
    x.fillStyle = '#151414'; x.font = 'bold 15px Menlo, monospace'; x.fillText('● working', 10, 18);
    x.font = '13px Menlo, monospace';
    lines.forEach((l, i) => {
      x.fillStyle = i === lines.length - 1 ? '#1E9070' : 'rgba(21,20,20,.78)';
      x.fillText(l, 10, 48 + i * 22);
    });
  };
  draw(['▸ …', '▸ …', '▸ …']);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, canvas: c, ctx: x, draw };
}

/* ===========================================================================
   A SECRETÁRIA (26 out 2026) — pedido do dono: «mesa moderna preta com LED,
   acessórios gamers, muito bonito e chamativo», com as luzes na cor da sala.

   O que havia: tampo de madeira clara, dois pés brancos, um teclado branco e
   uma caneca. Lia-se como mobiliário de escritório de 2014 — e era, com a
   cadeira verde, a coisa menos «Órbita» da cena.

   O que há agora: uma secretária de secretária-gaming-bem-feita. E há uma
   regra que atravessa tudo: **a luz é da sala**. O LED de baixo do tampo, a
   luz de trás do monitor, a barra que ilumina o teclado, o contorno do tapete
   do rato, os anéis das colunas e as ventoinhas da torre — todos na cor do
   vidro daquela sala (`dept.glass`), a mesma do chão. Uma sala, uma cor, sete
   luzes. É o que faz o conjunto ler como um sistema e não como sete objetos.

   E, como não há post-processing nesta cena (o polimento de 1.9.1 foi
   revertido a pedido do dono: sem PMREM, sem tone mapping), o brilho não vem
   de um bloom: vem de **material emissivo** (o LED em si) mais **quês
   aditivos** com gradiente radial (o halo, a luz na secretária, a luz no
   chão). É o truque de sempre dos jogos — e não mexe no pipeline de render.

   Custo: as peças são fundidas por material (corpo, luz, acento, halo), pelo
   que uma secretária inteira são ~5 draw calls, não 30. Cada secretária tem
   uma semente: a variante de acessório muda de posto para posto, para a sala
   parecer vivida e não clonada.
   =========================================================================== */

/* o teclado: teclas claras sobre preto. O material multiplica esta textura pela cor da sala,
   por isso as teclas acendem na cor do vidro e os intervalos ficam pretos — um teclado
   retroiluminado, sem uma luz por tecla. */
let _keyTex = null;
function keyboardTexture() {
  if (_keyTex !== null) return _keyTex;
  if (typeof document === 'undefined' || !document.createElement) return (_keyTex = null);
  const W = 320, H = 110;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#08090B'; x.fillRect(0, 0, W, H);
  const rr = (a, b, w, h, r) => {
    x.beginPath();
    x.moveTo(a + r, b); x.lineTo(a + w - r, b); x.quadraticCurveTo(a + w, b, a + w, b + r);
    x.lineTo(a + w, b + h - r); x.quadraticCurveTo(a + w, b + h, a + w - r, b + h);
    x.lineTo(a + r, b + h); x.quadraticCurveTo(a, b + h, a, b + h - r);
    x.lineTo(a, b + r); x.quadraticCurveTo(a, b, a + r, b); x.fill();
  };
  const cols = 14, rows = 4, gap = 3, pad = 7;
  const kw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const kh = (H - pad * 2 - gap * (rows - 1) - 10) / rows;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < cols; i++) {
      const lit = (i * 7 + r * 13) % 11 === 0;      // algumas teclas mais vivas: o resto do teclado respira
      x.fillStyle = lit ? '#ffffff' : 'rgba(226,232,240,.82)';
      rr(pad + i * (kw + gap), pad + r * (kh + gap), kw, kh, 2.2);
    }
  }
  x.fillStyle = 'rgba(226,232,240,.7)';             // a barra de espaço
  rr(pad + kw * 2, H - pad - 8, kw * 6 + gap * 5, 8, 2.2);
  _keyTex = new THREE.CanvasTexture(c);
  _keyTex.colorSpace = THREE.SRGBColorSpace;
  _keyTex.anisotropy = 4;
  return _keyTex;
}

/* o tapete do rato: contorno aceso, centro preto. Mesma ideia do teclado. */
let _padTex = null;
function mousepadTexture() {
  if (_padTex !== null) return _padTex;
  if (typeof document === 'undefined' || !document.createElement) return (_padTex = null);
  const W = 192, H = 160;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#0A0B0E'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#ffffff'; x.lineWidth = 7;
  x.shadowColor = '#ffffff'; x.shadowBlur = 14;
  const r = 20, a = 4, w = W - 8, h = H - 8;
  x.beginPath();
  x.moveTo(a + r, a); x.lineTo(a + w - r, a); x.quadraticCurveTo(a + w, a, a + w, a + r);
  x.lineTo(a + w, a + h - r); x.quadraticCurveTo(a + w, a + h, a + w - r, a + h);
  x.lineTo(a + r, a + h); x.quadraticCurveTo(a, a + h, a, a + h - r);
  x.lineTo(a, a + r); x.quadraticCurveTo(a, a, a + r, a); x.stroke();
  _padTex = new THREE.CanvasTexture(c);
  _padTex.colorSpace = THREE.SRGBColorSpace;
  return _padTex;
}

/** um halo: disco de raios com o alfa a cair do centro para fora (cor por vértice, com alfa).
 *  Não usa textura — por isso existe em Node (testes) e no browser, e é sempre igual. */
function glowDisc(w, h, strength = 0.9, rings = 7, seg = 40) {
  const pos = [], col = [], idx = [];
  pos.push(0, 0, 0); col.push(1, 1, 1, strength);          // centro
  for (let r = 1; r <= rings; r++) {
    const t = r / rings;
    const a = strength * Math.pow(1 - t, 2.1);             // queda suave, como uma luz difusa
    for (let j = 0; j < seg; j++) {
      const ang = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(ang) * 0.5 * w * t, Math.sin(ang) * 0.5 * h * t, 0);
      col.push(1, 1, 1, a);
    }
  }
  for (let j = 0; j < seg; j++) idx.push(0, 1 + j, 1 + ((j + 1) % seg));
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, b0 = 1 + r * seg;
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      idx.push(a0 + j, b0 + j, a0 + j1, a0 + j1, b0 + j, b0 + j1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* materiais por (sala, cor): seis salas, seis jogos. Nunca um por secretária. */
const deskMatCache = new Map();
function deskMaterials(chip, glass) {
  const key = `${chip}|${glass}`;
  if (deskMatCache.has(key)) return deskMatCache.get(key);
  const std = (o) => new THREE.MeshStandardMaterial({ metalness: 0, ...o });
  const M = {
    body: std({ color: '#1C1E23', roughness: 0.40, metalness: 0.28 }),   // preto acetinado
    edge: std({ color: '#33363E', roughness: 0.33, metalness: 0.50 }),   // aresta maquinada, um tom acima
    matte: std({ color: '#101114', roughness: 0.95 }),                   // borracha: teclado, tapete, torre
    metal: std({ color: '#3A3D44', roughness: 0.3, metalness: 0.8 }),
    accent: std({ color: chip, roughness: 0.55 }),
    led: std({ color: '#050507', emissive: glass, emissiveIntensity: 1.25, roughness: 0.6 }),
    glow: new THREE.MeshBasicMaterial({
      color: glass, vertexColors: true, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }),
    glassPanel: std({ color: '#0B0D10', roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.55 }),
    // a tecla: preta, com a luz da sala por baixo (é assim que um teclado retroiluminado se lê)
    keycap: std({ color: '#1E2127', roughness: 0.58, emissive: glass, emissiveIntensity: 0.5 }),
  };
  deskMatCache.set(key, M);
  return M;
}

/** funde uma lista de geometrias já transformadas numa malha só. */
export function meshOf(geos, material, { shadow = true } = {}) {
  if (!geos.length) return null;
  const m = new THREE.Mesh(mergeGeos(geos), material);
  m.castShadow = shadow; m.receiveShadow = shadow;
  geos.forEach((g) => g.dispose());
  return m;
}

export const GEO = {
  box: (w, d, h, r = 0.04) => rboxGeo(w, d, h, r),
  disc: (r, seg = 18) => new THREE.CylinderGeometry(r, r, 0.03, seg),
  post: (r, h, seg = 10) => new THREE.CylinderGeometry(r, r * 0.92, h, seg),
  ring: (r, tube = 0.014, seg = 14) => new THREE.TorusGeometry(r, tube, 5, seg),
  ball: (r, a = 12, b = 8) => new THREE.SphereGeometry(r, a, b),
  quad: (w, h) => new THREE.PlaneGeometry(w, h),
};
/** coloca uma geometria (nunca partilhada — clone) no sítio pedido. */
export function place(geo, x, y, z, { rx = 0, ry = 0, rz = 0 } = {}) {
  const g = geo.clone();
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

export function makeDesk(chip, live, opts = {}) {
  const glass = opts.glass || chip;   // a cor da sala: vem de data.js, com o chip como recurso
  const seed = opts.seed || 0;
  const rnd = seededRandom(seed * 977 + 13);
  const M = deskMaterials(chip, glass);
  const g = new THREE.Group();

  const body = [], edge = [], matte = [], metal = [], led = [], accent = [], glow = [], glassy = [];

  /* ---------- o tampo ---------- */
  // `GEO.box(w, d, h)` cresce a partir da base: y vai de `y` a `y + h`. (Foi por isso que uma tarde
  // inteira de «o tampo está 11 cm abaixo do teclado» era falsa — o tampo já acabava em 2.32.)
  body.push(place(GEO.box(5.2, 2.6, 0.22, 0.18), 0, DESK_TOP_Y - 0.22, 0));
  edge.push(place(GEO.box(5.24, 2.64, 0.035, 0.19), 0, DESK_TOP_Y - 0.245, 0)); // o filete que apanha a luz
  /* os pés: duas lâminas finas de metal, à moderna — em vez dos armários brancos */
  for (const sx of [-2.35, 2.35]) {
    edge.push(place(GEO.box(0.26, 2.28, 2.02, 0.09), sx, 0.02, 0));       // a perna em grafite
    metal.push(place(GEO.box(0.34, 2.32, 0.06, 0.02), sx, 0.02, 0));      // a sapata de metal
    led.push(place(GEO.box(0.02, 0.02, 1.9, 0.01), sx + (sx > 0 ? 0.14 : -0.14), 0.18, 0)); // a luz da perna
  }
  body.push(place(GEO.box(4.5, 0.13, 0.14, 0.05), 0, 1.52, -1.02));       // travessa
  matte.push(place(GEO.box(3.4, 0.40, 0.10, 0.04), 0, 1.88, -0.98));      // calha de cabos

  /* ---------- o LED: por baixo do tampo, à volta, na cor da sala ---------- */
  led.push(place(GEO.box(4.86, 0.06, 0.05, 0.02), 0, DESK_TOP_Y - 0.252, 1.27));  // aresta da frente
  for (const sx of [-2.52, 2.52]) led.push(place(GEO.box(0.06, 2.28, 0.05, 0.02), sx, DESK_TOP_Y - 0.252, 0));

  /* ---------- o monitor: a mesma tela (AO VIVO), com moldura preta e luz atrás ---------- */
  const screenSet = live ? { tex: live.tex, canvas: live.canvas, draw: () => {}, live } : makeDeskScreenTexture(chip);
  const [mw, mh] = live ? [3.4, 2.125] : [2.1, 1.3];
  const monBack = rbox(mw + 0.2, 0.14, mh + 0.2, '#0E0F12', 0.08);
  monBack.position.set(0, 2.75, -0.85); g.add(monBack);
  monBack.name = 'monBack';
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(mw, mh),
    new THREE.MeshBasicMaterial(screenSet.tex ? { map: screenSet.tex } : { color: '#0C0D10' })
  );
  screen.position.set(0, 2.85 + mh / 2, -0.77); screen.name = 'screen'; g.add(screen);
  const screenTopY = 2.85 + mh;
  // a moldura: um lábio por baixo e um pilar/arm que a segura
  body.push(place(GEO.box(mw + 0.22, 0.06, 0.10, 0.03), 0, 2.785, -0.79));
  body.push(place(GEO.box(0.20, 0.24, 0.46, 0.06), 0, 2.33, -0.92));
  body.push(place(GEO.box(0.90, 0.52, 0.05, 0.03), 0, 2.325, -0.92));
  led.push(place(GEO.box(0.10, 0.02, 0.02, 0.01), 0.42, 2.795, -0.74));   // o ponto de marca no lábio

  /* a luz de trás do monitor: o halo que se vê à volta do ecrã */
  glow.push(place(glowDisc(mw * 1.22, mh * 1.30, 0.62), 0, 2.85 + mh / 2, -1.03));
  /* a barra de luz (Aukora) presa no cimo do ecrã: acende o teclado, não os olhos */
  const barY = screenTopY + 0.14;
  body.push(place(GEO.box(mw * 0.86, 0.10, 0.09, 0.03), 0, barY, -0.70));
  body.push(place(GEO.box(0.10, 0.05, 0.22, 0.02), 0, barY - 0.04, -0.85)); // a dobra que prende
  led.push(place(GEO.box(mw * 0.82, 0.085, 0.02, 0.01), 0, barY - 0.055, -0.70));
  // o halo da barra a cair sobre o teclado e o tapete: um disco deitado, a apontar para cima
  glow.push(place(glowDisc(mw * 1.10, 1.75, 0.34), 0, 2.325, -0.30, { rx: -Math.PI / 2 }));

  /* ---------- o teclado mecânico (posição: deskmap.js) ---------- */
  matte.push(place(GEO.box(1.80, 0.62, 0.075, 0.05), KEYBOARD.x, DESK_TOP_Y, KEYBOARD.z));  // 2.32→2.395
  metal.push(place(GEO.box(1.74, 0.02, 0.02, 0.01), KEYBOARD.x, DESK_TOP_Y + 0.0575, KEYBOARD.z + 0.30));
  led.push(place(GEO.box(1.72, 0.04, 0.02, 0.01), KEYBOARD.x, DESK_TOP_Y + 0.0645, KEYBOARD.z + 0.305));
  const keyTex = keyboardTexture();
  if (keyTex) {   // com textura, lê-se um teclado retroiluminado; sem ela, não se inventa uma cor chapada
    const keys = new THREE.Mesh(
      new THREE.PlaneGeometry(KEYBOARD.w, KEYBOARD.d),
      new THREE.MeshBasicMaterial({ map: keyTex, color: glass, transparent: true })
    );
    keys.rotation.x = -Math.PI / 2; keys.position.set(KEYBOARD.x, KEYBOARD.y, KEYBOARD.z); g.add(keys);
    keys.name = 'keys';
  }

  /* as teclas: uma malha só, com 57 instâncias. É esta que o `main.js` afunda quando um dedo
     pousa numa tecla — sem 57 malhas por posto (e são 35 postos). */
  const capGeo = GEO.box(1, 1, 1, 0.22);
  capGeo.translate(0, -0.5, 0);   // `GEO.box` cresce a partir da base: aqui quer-se centrada
  const caps = new THREE.InstancedMesh(capGeo, M.keycap, 57);
  caps.name = 'keysCaps';
  caps.userData.part = 'deskMatte';
  caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const capCells = keyCells();
  const capTopY = KEY_CAP_TOP - KEYBOARD.capH / 2;   // o centro da tecla: meia altura abaixo do topo
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion();
  for (let i = 0; i < capCells.length; i++) {
    const c = capCells[i];
    _m4.compose(
      new THREE.Vector3(c.x, capTopY, c.z),
      _q4,
      new THREE.Vector3(c.w * 0.86, KEYBOARD.capH, c.d * 0.86)
    );
    caps.setMatrixAt(i, _m4);
  }
  caps.instanceMatrix.needsUpdate = true;
  caps.castShadow = false; caps.receiveShadow = false;
  g.add(caps);

  /* ---------- o tapete do rato, o rato ---------- */
  matte.push(place(GEO.box(MOUSE_PAD.w, MOUSE_PAD.d, 0.018, 0.03), MOUSE_PAD.x, DESK_TOP_Y, MOUSE_PAD.z));
  const padTex = mousepadTexture();
  if (padTex) {
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(MOUSE_PAD.w - 0.04, MOUSE_PAD.d - 0.04),
      new THREE.MeshBasicMaterial({ map: padTex, color: glass, transparent: true })
    );
    pad.rotation.x = -Math.PI / 2; pad.position.set(MOUSE_PAD.x, MOUSE_PAD.y, MOUSE_PAD.z); g.add(pad);
  }
  led.push(place(GEO.box(0.30, 0.012, 0.012, 0.006), MOUSE_PAD.x, MOUSE_PAD.y + 0.004, MOUSE_PAD.z - MOUSE_PAD.d / 2 + 0.05));
  // o rato é uma malha própria e move-se: o `main.js` põe-no a deslizar no tapete, e a mão segue-o.
  // Corpo + botão numa malha só (o botão é uma aresta no mesmo preto), para o custo não subir.
  const mouseGeo = GEO.ball(MOUSE.r, 14, 10).clone();
  mouseGeo.scale(1, MOUSE.sy, MOUSE.sz);     // a esfera está centrada na origem: escalar aqui é seguro
  mouseGeo.translate(0, 0, 0);
  const btnGeo = place(GEO.box(0.09, 0.11, 0.05, 0.028), -0.045, 0.006, 0.06);
  const mouseMesh = new THREE.Mesh(mergeGeos([mouseGeo, btnGeo]), M.matte);
  mouseMesh.name = 'mouse';
  mouseMesh.userData.part = 'deskMatte';
  mouseMesh.castShadow = true;
  const mouseG = new THREE.Group();
  mouseG.name = 'mouseG';
  mouseG.position.set(MOUSE.x, MOUSE_Y, MOUSE.z);
  mouseG.add(mouseMesh);
  g.add(mouseG);

  /* ---------- as colunas, com um anel de luz na base ---------- */
  for (const sx of [-1.94, 1.94]) {
    body.push(place(GEO.box(0.28, 0.28, 0.82, 0.07), sx, 2.34, -0.78));
    matte.push(place(GEO.box(0.20, 0.20, 0.60, 0.05), sx, 2.42, -0.70));
    led.push(place(GEO.ring(0.135, 0.012), sx, 2.352, -0.78, { rx: Math.PI / 2 }));
  }

  /* ---------- o suporte do auricular, com o auricular pendurado ---------- */
  const hsX = -2.02, hsZ = 0.16;
  metal.push(place(GEO.disc(0.20), hsX, 2.345, hsZ));
  metal.push(place(GEO.post(0.045, 0.92), hsX, 2.81, hsZ));
  body.push(place(new THREE.TorusGeometry(0.30, 0.052, 5, 12, Math.PI), hsX, 3.02, hsZ));
  for (const sx of [-0.30, 0.30]) {
    body.push(place(new THREE.CylinderGeometry(0.155, 0.155, 0.13, 14), hsX + sx, 2.93, hsZ, { rz: Math.PI / 2 }));
    accent.push(place(new THREE.CylinderGeometry(0.115, 0.115, 0.02, 14), hsX + sx * 1.06, 2.93, hsZ, { rz: Math.PI / 2 }));
  }
  led.push(place(GEO.ring(0.10, 0.011), hsX - 0.33, 2.93, hsZ, { ry: Math.PI / 2 }));

  /* ---------- a caneca (na cor da sala) com um prato de luz ---------- */
  accent.push(place(new THREE.CylinderGeometry(0.16, 0.145, 0.32, 14), 1.98, 2.48, 0.02));
  led.push(place(GEO.ring(0.185, 0.012), 1.98, 2.335, 0.02, { rx: Math.PI / 2 }));

  /* ---------- a torre, debaixo da mesa, com três ventoinhas acesas ---------- */
  const twX = -1.70, twZ = -0.42;
  body.push(place(GEO.box(0.80, 1.32, 1.46, 0.07), twX, 0.02, twZ));
  edge.push(place(GEO.box(0.86, 1.38, 0.06, 0.02), twX, 0.02, twZ - 0.02));    // a chapa de topo
  metal.push(place(GEO.box(0.84, 0.06, 0.04, 0.02), twX, 1.36, twZ + 0.66));    // a grelha
  led.push(place(GEO.box(0.62, 0.02, 0.02, 0.01), twX, 0.10, twZ + 0.68));      // a linha da base
  glassy.push(place(GEO.quad(1.22, 1.34), twX + 0.41, 0.74, twZ, { ry: Math.PI / 2 })); // o vidro lateral
  for (let i = 0; i < 3; i++) {
    const y = 0.34 + i * 0.38;
    matte.push(place(GEO.ring(0.245, 0.045), twX, y, twZ + 0.66, {}));
    led.push(place(GEO.ring(0.225, 0.013), twX, y, twZ + 0.675, {}));
  }
  glow.push(place(glowDisc(1.1, 1.5, 0.30), twX, 0.72, twZ + 0.70));   // o brilho que sai das ventoinhas
  led.push(place(GEO.box(0.30, 0.02, 0.02, 0.01), twX, 1.46, twZ + 0.70));  // a tira do topo da torre

  /* ---------- a luz no chão: o que sai de baixo da mesa ---------- */
  glow.push(place(glowDisc(5.7, 3.05, 0.50), 0, 0.012, 0.05, { rx: -Math.PI / 2 }));

  /* ---------- um acessório por posto, para a sala parecer vivida ---------- */
  const variant = Math.abs(seed) % 3;
  if (variant === 0) {                                   // comando de jogos
    const cx = -1.36, cy = 2.385, cz = 0.42;
    body.push(place(GEO.box(0.52, 0.30, 0.10, 0.10), cx, cy, cz));
    for (const sx of [-0.40, 0.40]) {
      const grip = place(GEO.ball(0.13), cx + sx, cy - 0.02, cz + 0.02);
      grip.scale(0.9, 0.62, 1.05);
      body.push(grip);
    }
    matte.push(place(GEO.ball(0.055), cx - 0.13, cy + 0.07, cz));
    matte.push(place(GEO.ball(0.055), cx + 0.13, cy + 0.07, cz));
    led.push(place(GEO.box(0.02, 0.012, 0.20, 0.006), cx, cy + 0.06, cz - 0.02));
  } else if (variant === 1) {                            // telemóvel num suporte
    const px = -1.38, pz = 0.34;
    metal.push(place(GEO.box(0.26, 0.20, 0.04, 0.02), px, 2.33, pz));
    body.push(place(GEO.box(0.46, 0.055, 0.86, 0.03), px, 2.62, pz, { rx: -0.32 }));
    const ecra = new THREE.Mesh(
      new THREE.PlaneGeometry(0.40, 0.78),
      new THREE.MeshBasicMaterial({ color: glass, transparent: true, opacity: 0.55 })
    );
    ecra.position.set(px, 2.635, pz + 0.032); ecra.rotation.x = -0.32 - Math.PI / 2; ecra.rotation.z = 0;
    // (a tela do telemóvel fica no plano do vidro; a rotação é a mesma do corpo)
    ecra.rotation.set(-0.32, 0, 0); ecra.position.set(px, 2.635, pz + 0.031);
    g.add(ecra);
  } else {                                               // mini barra de luz Aukora
    const lx = -1.40, lz = 0.30;
    accent.push(place(GEO.disc(0.16), lx, 2.34, lz));
    metal.push(place(GEO.post(0.028, 0.62), lx, 2.65, lz));
    body.push(place(GEO.box(0.80, 0.09, 0.09, 0.03), lx + 0.34, 2.96, lz));
    led.push(place(GEO.box(0.76, 0.02, 0.075, 0.01), lx + 0.34, 2.905, lz));
    glow.push(place(glowDisc(1.0, 0.8, 0.45), lx + 0.34, 2.90, lz, { rx: -Math.PI / 2 }));
  }
  if (rnd() > 0.55) {                                    // uns papéis, umas notas: nem todos iguais
    accent.push(place(GEO.box(0.34, 0.26, 0.012, 0.01), 2.10, 2.335, 0.72, { ry: 0.3 }));
    accent.push(place(GEO.box(0.34, 0.26, 0.012, 0.01), 2.12, 2.348, 0.76, { ry: -0.2 }));
  }

  /* ---------- as malhas: cinco por secretária ---------- */
  const bodyMesh = meshOf(body, M.body); bodyMesh.userData.part = 'desk'; g.add(bodyMesh);
  const edgeMesh = meshOf(edge, M.edge); edgeMesh.userData.part = 'desk'; g.add(edgeMesh);
  const matteMesh = meshOf(matte, M.matte); matteMesh.userData.part = 'deskMatte'; g.add(matteMesh);
  const metalMesh = meshOf(metal, M.metal); g.add(metalMesh);
  const ledMesh = meshOf(led, M.led, { shadow: false }); ledMesh.userData.part = 'deskLed'; g.add(ledMesh);
  const accentMesh = meshOf(accent, M.accent); g.add(accentMesh);
  const glassMesh = meshOf(glassy, M.glassPanel, { shadow: false }); if (glassMesh) g.add(glassMesh);
  // o halo: quês aditivas, uma malha só, e nunca a tapar nada (depthWrite falso)
  const haloMesh = meshOf(glow, M.glow, { shadow: false });
  if (haloMesh) { haloMesh.renderOrder = 2; g.add(haloMesh); }

  g.userData.desk = { glass, chip, variant, led: true };
  return { group: g, screenSet, caps, mouse: mouseG, mouseY: MOUSE_Y, cellTop: KEY_CAP_TOP };
}

/* ---------- a cadeira: preta, com a costura na cor da sala ---------- */
export function makeChair(opts = {}) {
  const glass = opts.glass || '#8E998B';
  const M = deskMaterials(opts.chip || '#2B3245', glass);
  const g = new THREE.Group();
  const dark = [], led = [], metal = [];

  // o assento e as costas: uma peça só, em concha, com o vinco aceso
  dark.push(place(GEO.box(1.32, 1.24, 0.18, 0.42), 0, 1.16, 0));      // assento
  dark.push(place(GEO.box(1.26, 0.17, 1.42, 0.40), 0, 1.42, 0.64));    // costas
  dark.push(place(GEO.box(1.10, 0.14, 0.20, 0.30), 0, 1.30, 0.60));    // o apoio lombar
  led.push(place(GEO.box(1.30, 0.02, 0.02, 0.01), 0, 2.02, 0.56));     // a costura do topo
  led.push(place(GEO.box(1.30, 0.02, 0.02, 0.01), 0, 1.10, 0.56));
  metal.push(place(GEO.post(0.075, 0.62), 0, 0.82, 0));                 // a coluna a gás
  // a estrela de cinco braços, com rodas
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    metal.push(place(GEO.box(0.86, 0.11, 0.08, 0.03), Math.cos(a) * 0.43, 0.42, Math.sin(a) * 0.43, { ry: -a }));
    metal.push(place(GEO.ball(0.075, 8, 6), Math.cos(a) * 0.82, 0.36, Math.sin(a) * 0.82));
  }
  metal.push(place(GEO.disc(0.16), 0, 0.46, 0));

  const d = meshOf(dark, M.body); d.userData.part = 'desk'; g.add(d);
  const l = meshOf(led, M.led, { shadow: false }); l.userData.part = 'deskLed'; g.add(l);
  const mm = meshOf(metal, M.metal); g.add(mm);
  return g;
}

/* ---------- a pessoa ----------
   27 out 2026: o avatar (roupa, cabelo, mãos e IK) saiu daqui para `src/avatar.js` — este ficheiro
   já ia em 900 linhas e o avatar passou a ter regras próprias (35 looks, chapéus, braços). O
   `makePerson`/`poseWork`/`posePerson` vivem lá agora; o main.js importa-os de lá. */

/* ---------- holo work-screen (Image-2 style floating glass panel) ---------- */
export function makeHolo(agentName, chip, lines) {
  const c = document.createElement('canvas');
  const W = 512, H = 320; c.width = W; c.height = H;
  const x = c.getContext('2d');
  const draw = (ls) => {
    x.clearRect(0, 0, W, H);
    // glass card
    x.fillStyle = 'rgba(253,255,248,0.93)';
    roundRect(x, 6, 6, W - 12, H - 12, 26); x.fill();
    x.strokeStyle = chip; x.lineWidth = 5;
    roundRect(x, 6, 6, W - 12, H - 12, 26); x.stroke();
    // header
    x.fillStyle = chip;
    x.beginPath(); x.arc(40, 44, 11, 0, 7); x.fill();
    x.fillStyle = '#151414'; x.font = '700 27px Georgia, serif';
    x.fillText(agentName, 62, 54);
    x.strokeStyle = 'rgba(21,20,20,0.12)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(28, 76); x.lineTo(W - 28, 76); x.stroke();
    // terminal lines
    x.font = '20px Menlo, monospace';
    ls.forEach((l, i) => {
      x.fillStyle = i === ls.length - 1 ? '#1E9070' : 'rgba(21,20,20,0.72)';
      x.fillText(l.length > 40 ? l.slice(0, 40) + '…' : l, 30, 116 + i * 36);
    });
    // blinking caret line
    x.fillStyle = '#151414';
    x.fillRect(30, 116 + ls.length * 36 - 16, 12, 20);
  };
  draw(lines);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 3.0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.96, depthWrite: false, side: THREE.DoubleSide })
  );
  m.userData.draw = draw;
  m.userData.tex = tex;
  return m;
}

function roundRect(x, a, b, w, h, r) {
  x.beginPath();
  x.moveTo(a + r, b);
  x.arcTo(a + w, b, a + w, b + h, r);
  x.arcTo(a + w, b + h, a, b + h, r);
  x.arcTo(a, b + h, a, b, r);
  x.arcTo(a, b, a + w, b, r);
  x.closePath();
}

/* ---------- props ---------- */

/* ===========================================================================
   PLANTAS (26 out 2026) — pedido do dono: «melhorias nível Apple design 3D nas
   plantas, dando total realismo nelas».

   O que havia: um vaso de tronco-de-cone e cinco esferas verdes. Lia-se como um
   arbusto de plástico — e, ao lado de pessoas com pescoço, era a peça que mais
   denunciava a cena.

   O que há agora: uma planta construída como uma planta. As regras que fazem a
   diferença entre «esferas» e «folhagem»:

     1 · A FOLHA NÃO É UMA ESFERA. É uma superfície paramétrica: estreita na base,
         larga a um terço, em bico no fim; dobrada ao meio (o nervo central é uma
         aresta, não uma linha pintada), com o bordo ondulado e uma queda que
         cresce com o quadrado do comprimento — é assim que uma folha real
         pendura quando o pecíolo a larga.
     2 · A COR VARIA ONDE A LUZ VARIA. Cada vértice leva a sua própria cor
         (escura na base e na nervura, mais clara a meio e nos bordos) e cada
         folha leva um desvio de matiz próprio. Uma folha pintada de uma cor só
         parece plástico, mesmo com a melhor luz do mundo.
     3 · O PECÍOLO É UM TUBO, NÃO UM CILINDRO. Segue uma curva (sai do tronco,
         arqueia, entrega a folha) e afina da base para a ponta.
     4 · FILOTAXIA. As folhas nascem em espiral de ângulo dourado (137,5°), em
         três alturas, com as velhas a pendurar e as novas a apontar para cima.
         É o que faz a planta ter silhueta em vez de ter volume.
     5 · O VASO É CERÂMICA. Perfil torneado (LatheGeometry) com lábio e pé, terra
         escura por dentro, pedras à superfície, e uma sombra de contacto suave
         na base — sem ela, o objeto flutua, por muito bom que seja o material.
     6 · TUDO É DETERMINÍSTICO. Cada planta tem uma semente; a mesma semente dá
         sempre a mesma planta. Sem isto, a cena mudava a cada recarregamento e
         nenhum teste podia olhar para ela.

   E, porque o dono mandou reverter o polimento de 1.9.1 (sem PMREM, sem tone
   mapping, sem vernizes), o realismo vem de geometria e de cor — não de um
   environment map. Os materiais são MeshStandardMaterial simples: o brilho das
   folhas é o especular largo da luz-chave que já existia.
   =========================================================================== */

/** sorteio reprodutível (mulberry32): a mesma semente, a mesma planta, sempre. */
export function seededRandom(seed) {
  let a = (seed >>> 0) || 0x9E3779B9;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** junta geometrias nossas (posição, normal, uv, cor). Evita uma malha por folha. */
export function mergeGeos(geos) {
  let nVert = 0, nIdx = 0;
  for (const g of geos) {
    nVert += g.attributes.position.count;
    nIdx += g.index ? g.index.count : g.attributes.position.count;
  }
  // a cor pode ter 3 (RGB) ou 4 (RGBA) componentes: os halos usam alfa por vértice, e o three
  // só o respeita se o atributo tiver quatro. Junta-se na largura máxima e o que falta fica 1.
  const colorItem = geos.reduce((n, g) => Math.max(n, g.attributes.color ? g.attributes.color.itemSize : 0), 0);
  const pos = new Float32Array(nVert * 3), nor = new Float32Array(nVert * 3);
  const uv = new Float32Array(nVert * 2);
  const col = colorItem ? new Float32Array(nVert * colorItem).fill(1) : null;
  const idx = new Uint32Array(nIdx);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position;
    pos.set(p.array, vo * 3);
    if (g.attributes.normal) nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const c = g.attributes.color;
    if (c && col) {
      const it = c.itemSize;
      for (let i = 0; i < p.count; i++) {
        for (let k = 0; k < it; k++) col[(vo + i) * colorItem + k] = c.array[i * it + k];
      }
    }
    if (g.index) {
      const a = g.index.array;
      for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo;
      io += a.length;
    } else {
      for (let i = 0; i < p.count; i++) idx[io + i] = vo + i;
      io += p.count;
    }
    vo += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, colorItem));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/**
 * Uma folha: grelha paramétrica no plano local (comprimento em +Z, largura em X).
 * A cor de cada vértice vem em `color` e multiplica o verde do material — é o que
 * dá a variação dentro da folha sem uma textura por folha.
 */
export function leafGeometry({
  len = 0.9, wid = 0.42, droop = 0.30, fold = 0.16, wave = 0.05,
  ring = 16, seg = 10, tint = 1, warm = 0,
} = {}) {
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= ring; i++) {
    const v = i / ring;
    // perfil da folha: bico na base, ombro a ~35 %, ponta fina
    const w = wid * Math.pow(Math.sin(Math.PI * Math.pow(v, 0.78)), 0.85) * (1 - 0.22 * v);
    for (let j = 0; j <= seg; j++) {
      const x = ((j / seg) * 2 - 1) * w;
      const u = w > 1e-5 ? x / w : 0;
      // dobra em V ao longo do nervo + queda quadrática + bordo ondulado
      const y = fold * Math.abs(u) * w * 2.4 - droop * v * v + wave * Math.sin(v * 7.5) * u * u * w;
      pos.push(x, y, len * v);
      uv.push(j / seg, v);
      // luz dentro da folha: escura na base, clara a meio, levemente escura na ponta
      const fv = 0.64 + 0.36 * Math.sin(Math.PI * Math.min(1, 0.10 + 0.90 * v));
      const fu = 1 - 0.10 * Math.pow(Math.abs(u), 1.6); // o nervo é mais escuro que o limbo
      const rib = Math.abs(u) < 0.085 ? 0.90 : 1;       // a nervura central, marcada
      const f = fv * fu * rib * tint;
      col.push(
        Math.min(1, f * (1 + 0.06 * warm)),
        Math.min(1, f * (1 + 0.015 * Math.abs(warm))),
        Math.min(1, f * (1 - 0.07 * warm)),
      );
    }
  }
  for (let i = 0; i < ring; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j, b = a + seg + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Um pecíolo/caule: tubo ao longo de uma curva, a afinar da base para a ponta. */
export function stemGeometry(points, r0 = 0.045, r1 = 0.022, segs = 12, radial = 5) {
  const curve = new THREE.CatmullRomCurve3(points);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      pos.push(p.x + (N.x * ca + B.x * sa) * r, p.y + (N.y * ca + B.y * sa) * r, p.z + (N.z * ca + B.z * sa) * r);
      uv.push(j / radial, t);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* o desenho das nervuras: cinzento muito claro, para multiplicar o verde e não o lavar.
   Sem `document` (testes em Node) não há textura — a geometria fica igual. */
let veinTex = null;
function veinTexture() {
  if (veinTex !== null) return veinTex;
  if (typeof document === 'undefined' || !document.createElement) return (veinTex = null);
  const W = 64, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(52,74,44,.105)'; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(W / 2, H); x.lineTo(W / 2, 0); x.stroke();      // nervo central
  x.strokeStyle = 'rgba(52,74,44,.055)'; x.lineWidth = 1;
  for (let k = 0; k < 9; k++) {                                            // nervuras laterais
    const y = H * (0.06 + k * 0.105);
    x.beginPath(); x.moveTo(W / 2, y); x.lineTo(W * 0.03, y - H * 0.075); x.stroke();
    x.beginPath(); x.moveTo(W / 2, y); x.lineTo(W * 0.97, y - H * 0.075); x.stroke();
  }
  x.fillStyle = 'rgba(52,74,44,.022)';                                     // manchas
  for (let k = 0; k < 90; k++) {
    const r = 1 + (k % 4);
    x.beginPath(); x.arc((k * 37) % W, (k * 61) % H, r, 0, 7); x.fill();
  }
  veinTex = new THREE.CanvasTexture(c);
  veinTex.colorSpace = THREE.SRGBColorSpace;
  veinTex.anisotropy = 4;
  return veinTex;
}

/* a sombra de contacto: um disco com gradiente radial. Sem ela, o vaso flutua. */
let contactTex = null;
function contactTexture() {
  if (contactTex !== null) return contactTex;
  if (typeof document === 'undefined' || !document.createElement) return (contactTex = null);
  const S = 128;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.04, S / 2, S / 2, S * 0.5);
  g.addColorStop(0, 'rgba(20,24,18,.40)');
  g.addColorStop(0.45, 'rgba(20,24,18,.16)');
  g.addColorStop(1, 'rgba(20,24,18,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  contactTex = new THREE.CanvasTexture(c);
  contactTex.colorSpace = THREE.SRGBColorSpace;
  return contactTex;
}

/** As duas espécies. Números em unidades de cena (as pessoas têm ~3,3 de altura). */
export const PLANT_KINDS = {
  upright: { // ficus/oliveira: tronco alto e limpo, folhas pequenas e muitas, em três andares
    potR: 0.36, potH: 0.70, trunkTo: 1.72, trunkR: 0.070, leaves: 24, lowLeaf: 0.40, rise: 1.22,
    reach: 0.50, len: 0.56, wid: 0.26, droop: 0.24, fold: 0.07, wave: 0.035,
    pitchOld: -0.78, pitchNew: -0.06, // radianos: as velhas pendem, as novas abrem para fora
    leaf: '#71975B', stem: '#5D7B49',
  },
  broad: { // monstera/philodendron: sem tronco à vista, folhas grandes em pecíolos que arqueiam
    potR: 0.42, potH: 0.62, trunkTo: 1.00, trunkR: 0.050, leaves: 15, lowLeaf: 0.04, rise: 1.15,
    reach: 0.64, len: 0.98, wid: 0.62, droop: 0.40, fold: 0.12, wave: 0.05,
    pitchOld: -0.62, pitchNew: -0.05,
    leaf: '#4F7F53', stem: '#4C6B40',
  },
};

let plantMats = null;
function plantMaterials() {
  if (plantMats) return plantMats;
  const std = (o) => new THREE.MeshStandardMaterial({ metalness: 0, ...o });
  plantMats = {
    pot: std({ color: '#E6DED0', roughness: 0.58 }),           // cerâmica mate: brilho largo, não espelho
    foot: std({ color: '#CFC5B4', roughness: 0.7 }),
    soil: std({ color: '#3A2C24', roughness: 0.98 }),
    pebble: std({ color: '#A9A39A', roughness: 0.9 }),
    contact: new THREE.MeshBasicMaterial({
      map: contactTexture(), transparent: true, opacity: 0.42, depthWrite: false,
    }),
  };
  for (const [k, p] of Object.entries(PLANT_KINDS)) {
    plantMats[`leaf_${k}`] = std({
      color: p.leaf, roughness: 0.58, side: THREE.DoubleSide,
      vertexColors: true, map: veinTexture(),
    });
    plantMats[`stem_${k}`] = std({ color: p.stem, roughness: 0.82 });
  }
  return plantMats;
}

/**
 * A planta. `seed` fixa a forma; `kind` escolhe a espécie; `scale` ajusta o tamanho.
 * Devolve um Group com poucas malhas (folhagem, caules, vaso, terra, pedras, sombra):
 * uma planta = 6 draw calls, não 40.
 */
export function makePlant({ seed = 1, kind = 'upright', scale = 1 } = {}) {
  const P = PLANT_KINDS[kind] || PLANT_KINDS.upright;
  const rnd = seededRandom(seed);
  const M = plantMaterials();
  const g = new THREE.Group();
  const potR = P.potR * scale, potH = P.potH * scale, trunkTop = P.trunkTo * scale;

  /* o vaso: perfil torneado — pé, pança, lábio que se vira para dentro */
  const perfil = [
    [0.00, 0.000], [potR * 0.78, 0.000], [potR * 0.84, 0.022], [potR * 0.90, 0.080],
    [potR * 0.99, potH * 0.70], [potR * 1.04, potH * 0.90], [potR * 1.11, potH * 0.97],
    [potR * 1.12, potH * 1.02], [potR * 1.06, potH * 1.045], [potR * 0.97, potH * 1.03],
    [potR * 0.94, potH * 0.96],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(perfil, 30), M.pot);
  pot.castShadow = true; pot.receiveShadow = true;
  pot.position.y = 0.004;
  g.add(pot);

  /* a boca do vaso: terra escura (abaixo do lábio) e umas pedras */
  const soilY = potH * 0.90;
  const soil = new THREE.Mesh(new THREE.CircleGeometry(potR * 0.96, 28), M.soil);
  soil.rotation.x = -Math.PI / 2; soil.position.y = soilY;
  soil.receiveShadow = true;
  g.add(soil);
  const pedras = [];
  const nPedras = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < nPedras; i++) {
    const a = rnd() * Math.PI * 2, dd = (0.28 + rnd() * 0.52) * potR;
    const r = (0.030 + rnd() * 0.022) * scale;
    const geo = new THREE.IcosahedronGeometry(r, 0);
    geo.scale(1, 0.7, 1);
    geo.translate(Math.cos(a) * dd, soilY + r * 0.18, Math.sin(a) * dd);
    pedras.push(geo);
  }
  if (pedras.length) {
    const m = new THREE.Mesh(mergeGeos(pedras), M.pebble);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    pedras.forEach((geo) => geo.dispose());
  }

  /* o caule principal: um tubo que afina, ligeiramente inclinado (nada na natureza é vertical) */
  const inclina = (rnd() - 0.5) * 0.18 * scale;
  const tronco = stemGeometry([
    new THREE.Vector3(0, soilY - 0.08 * scale, 0),
    new THREE.Vector3(inclina * 0.35, soilY + (trunkTop - soilY) * 0.45, 0.01),
    new THREE.Vector3(inclina, trunkTop, 0),
  ], P.trunkR * scale, P.trunkR * 0.55 * scale, 12, 7);

  const folhas = [], caules = [];
  const GOLD = 2.399963229728653; // o ângulo dourado: 137,5°
  const up = new THREE.Vector3(0, 1, 0);
  const X = new THREE.Vector3(1, 0, 0), Z = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < P.leaves; i++) {
    const t = P.leaves > 1 ? i / (P.leaves - 1) : 0.5;      // 0 = velha (baixa) · 1 = nova (alta)
    const ang = i * GOLD + (rnd() - 0.5) * 0.40;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const tt = Math.pow(t, 0.86); // mais folhas em baixo do que no topo, como numa planta que cresceu
    const y0 = soilY + P.lowLeaf * (trunkTop - soilY) + tt * P.rise * scale + (rnd() - 0.5) * 0.17 * scale;
    const alcance = P.reach * scale * (0.55 + 0.45 * Math.sin(Math.PI * (0.22 + 0.62 * t)));
    const arco = alcance * (0.30 + 0.20 * (1 - t));         // o pecíolo sobe antes de sair para fora
    const raiz = new THREE.Vector3(dir.x * 0.05 * scale, y0, dir.z * 0.05 * scale);
    const p1 = raiz.clone().addScaledVector(dir, alcance * 0.34); p1.y += arco * 0.70;
    const p2 = raiz.clone().addScaledVector(dir, alcance * 0.76); p2.y += arco * 0.95;
    const ponta = raiz.clone().addScaledVector(dir, alcance); ponta.y += arco * 0.82;

    caules.push(stemGeometry([raiz, p1, p2, ponta], 0.042 * scale, 0.017 * scale, 10, 5));

    const q = (0.66 + 0.42 * Math.sin(Math.PI * (0.22 + 0.72 * t))) * (0.94 + rnd() * 0.12) * scale;
    const pitch = P.pitchOld + (P.pitchNew - P.pitchOld) * t + (rnd() - 0.5) * 0.26;
    const geo = leafGeometry({
      len: P.len * q, wid: P.wid * q,
      droop: P.droop * (0.60 + 0.60 * (1 - t)),   // as velhas pendem mais
      fold: P.fold, wave: P.wave,
      tint: 0.92 + rnd() * 0.10,
      warm: (rnd() - 0.5) * 2,
    });
    // a folha inclina-se para baixo (a ponta cai) e rola um pouco; só depois é levada para a ponta
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(pitch));   // -0 em cima · velhas pendem
    geo.applyMatrix4(new THREE.Matrix4().makeRotationZ((rnd() - 0.5) * 0.45));
    const z = dir.clone();                                        // +Z da folha: para fora, na horizontal
    const x = new THREE.Vector3().crossVectors(up, z).normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(x, y, z));
    geo.translate(ponta.x, ponta.y, ponta.z);
    folhas.push(geo);
  }
  caules.unshift(tronco);

  const foliage = new THREE.Mesh(mergeGeos(folhas), M[`leaf_${kind}`] || M.leaf_upright);
  foliage.castShadow = true; foliage.receiveShadow = true;
  g.add(foliage);
  const stems = new THREE.Mesh(mergeGeos(caules), M[`stem_${kind}`] || M.stem_upright);
  stems.castShadow = true;
  g.add(stems);
  folhas.forEach((geo) => geo.dispose());
  caules.forEach((geo) => geo.dispose());

  /* a sombra de contacto (aditiva ao shadow map, muito discreta) */
  if (M.contact && M.contact.map) {
    const blob = new THREE.Mesh(new THREE.CircleGeometry(potR * 1.75, 24), M.contact);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.010; // acima da poça de luz do chão (0,122), para não haver z-fighting
    blob.renderOrder = 1;
    g.add(blob);
  }

  g.userData.plant = { kind, seed, leaves: P.leaves, scale };
  return g;
}

export function makeServerRack(chip) {
  const g = new THREE.Group();
  const body = rbox(1.6, 1.2, 3.4, '#232326', 0.14); g.add(body);
  for (let r = 0; r < 5; r++) {
    const slot = rbox(1.3, 0.06, 0.3, '#2E2E33', 0.04);
    slot.position.set(0, 0.5 + r * 0.6, 0.62); g.add(slot);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6),
      mat(r % 2 ? chip : '#E69393', { emissive: r % 2 ? chip : '#E69393', ei: 2.2 }));
    led.position.set(0.45, 0.65 + r * 0.6, 0.64); g.add(led);
  }
  return g;
}

export function makeMeetingTable() {
  const g = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 0.2, 28), mat('#EFEADF'));
  top.position.y = 1.9; top.castShadow = true; top.receiveShadow = true; g.add(top);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.9, 12), mat('#C9C4B8'));
  leg.position.y = 0.95; g.add(leg);
  return g;
}

/* ---------- the Brain: GALACTIC-CORE nebula + knowledge web + swirling outer band ----------
   M4 "HERO BRAIN" (AJ chose A+D from the reference video — a dark galaxy-core map where the
   centre is a dense multicolour particle nebula and departments light up one at a time):
   A = the nebula — ~1100 particles in the nominal + chip palette, packed bright at the
       centre, differential swirl (core spins faster, like a galaxy), per-particle shimmer,
       periodic "thought flashes" where a random cluster blooms.
   D = the thinking sweep — tick() accepts {theta, strength, col}: particles in that azimuth
       window brighten toward the dept chip colour while main.js orbits a comet + glows the
       dept billboard. The knowledge web stays as a compact hub lattice so the brain still
       reads as a knowledge graph, not just dust. */
export function makeNeuralBrain() {
  const g = new THREE.Group();
  const R = 5.2;
  const PI2 = Math.PI * 2;
  const gauss = () => (Math.random() + Math.random() + Math.random()) / 1.5 - 1;
  const dummy = new THREE.Object3D();

  /* the nebula — cylindrical coords so the swirl is a pure per-frame azimuth advance.
     DUAL PALETTE (M5): every particle carries a CREAM colour (ink-dominant dust that reads
     on the cream office with no dark backing — the M4 orb read as a storm-cloud shadow and
     is gone) and a GALAXY colour (the M4 bright set) — tick lerps between them by gk. */
  const N = 1100;
  const parts = [];
  const PAL_G = [ // galaxy mode: white-hot core + chip sparkle (needs a dark field)
    ['#FFFFFF', .24], ['#B9B9B2', .13], ['#8B8B85', .10],
    ['#5ADEB7', .12], ['#EADC8F', .12], ['#E69393', .09], ['#98A5EF', .09],
    ['#4C7A57', .05], ['#D9A05B', .03], ['#151414', .03],
  ];
  const PAL_C = [ // cream mode: ink/graphite carries the mass, deep chip tones sparkle
    ['#151414', .20], ['#3E3E3A', .16], ['#6E6E68', .15], ['#9A9A92', .08],
    ['#2E8B57', .11], ['#C8A438', .10], ['#C2574F', .08], ['#5A6ACF', .08],
    ['#4C7A57', .03], ['#D9A05B', .01],
  ];
  const pick = (PAL) => { let x = Math.random(); for (const [c, w] of PAL) { if ((x -= w) <= 0) return c; } return PAL[0][0]; };
  for (let i = 0; i < N; i++) {
    const rad = R * Math.pow(Math.random(), 0.62);              // clustered toward the core
    parts.push({
      rad, az: Math.random() * PI2,
      y: gauss() * R * 0.34 * (0.35 + 0.65 * (rad / R)),        // thin bright plane, puffier rim
      w: 0.00005 + 0.00013 * (1 - rad / R),                     // differential swirl speed
      base: (0.6 + Math.random() * 0.7) * (1 + 0.55 * (1 - rad / R)), // bigger toward centre
      colC: new THREE.Color(pick(PAL_C)),
      colG: new THREE.Color(pick(PAL_G)),
      phase: Math.random() * 7,
    });
  }
  const inst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.10, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
  parts.forEach((p, i) => {
    dummy.position.set(p.rad * Math.cos(p.az), p.y, p.rad * Math.sin(p.az));
    dummy.scale.setScalar(p.base);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    inst.setColorAt(i, p.colC);
  });
  g.add(inst);

  /* knowledge web: a compact hub lattice INSIDE the nebula. Its nodes+edges live in their
     own group that rotates as one (edges must stay attached), while the dust swirls past. */
  const webG = new THREE.Group();
  g.add(webG);
  const NW = 90;
  const wnodes = [];
  for (let i = 0; i < NW; i++) {
    const dir = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
    const p = dir.multiplyScalar(R * (0.1 + 0.6 * Math.cbrt(Math.random())));
    p.y *= 0.7;
    const big = Math.random() < 0.3;
    wnodes.push({ p, big });
  }
  const winst = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.10, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), NW);
  wnodes.forEach((n, i) => {
    n.colC = new THREE.Color(n.big ? '#7A7A74' : '#454540'); // graphite on cream
    n.colG = new THREE.Color(n.big ? '#A8A8A1' : '#FFFFFF'); // light on the night field
    dummy.position.copy(n.p);
    dummy.scale.setScalar(n.big ? 1.7 : 0.9);
    dummy.updateMatrix();
    winst.setMatrixAt(i, dummy.matrix);
    winst.setColorAt(i, n.colC);
  });
  webG.add(winst);
  const edges = [];
  for (const n of wnodes) {
    const near = wnodes
      .filter(m => m !== n)
      .sort((a, b) => a.p.distanceToSquared(n.p) - b.p.distanceToSquared(n.p));
    for (let j = 0; j < (n.big ? 5 : 2); j++)
      if (near[j]) edges.push([n.p, near[j].p]);
  }
  const epos = new Float32Array(edges.length * 6);
  edges.forEach(([a, b], i) => epos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(epos, 3));
  const webLineMat = new THREE.LineBasicMaterial({ color: 0x3A3A38, transparent: true, opacity: 0.15 });
  webG.add(new THREE.LineSegments(egeo, webLineMat)); // ink on cream, lerped light in galaxy mode
  // signal pulses along the web
  const pulses = [];
  const pulseCols = ['#5ADEB7', '#E69393', '#98A5EF', '#D9A05B', '#FFF8EC', '#EADC8F', '#5ADEB7', '#4C7A57'];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6),
      new THREE.MeshBasicMaterial({ color: pulseCols[i] }));
    webG.add(m);
    pulses.push({ m, edge: edges[Math.floor(Math.random() * edges.length)], t: Math.random(), speed: 0.35 + Math.random() * 0.6 });
  }

  /* outer band: hundreds of loose dots in a swirling annulus (the "circle" read) */
  const bandG = new THREE.Group();
  g.add(bandG);
  const bandPts = [];
  let guard = 0;
  while (bandPts.length < 320 && guard++ < 5000) {
    // 3D shell: random direction, swirl gaps by azimuth, gently squashed vertically
    const dir = new THREE.Vector3(gauss(), gauss(), gauss()).normalize();
    const r = R * (1.35 + 0.75 * Math.random());
    const az = Math.atan2(dir.z, dir.x);
    if (Math.sin(az * 2.2 + r * 1.6) < -0.45) continue; // swirl gaps
    const p = dir.multiplyScalar(r);
    p.y *= 0.55;
    const x = Math.random();
    bandPts.push({
      p,
      colC: new THREE.Color(x < 0.32 ? '#C8A438' : x < 0.54 ? '#8B8B85' : x < 0.68 ? '#3E3E3A'
        : x < 0.80 ? '#2E8B57' : x < 0.90 ? '#C2574F' : '#5A6ACF'),
      colG: new THREE.Color(x < 0.32 ? '#EADC8F' : x < 0.54 ? '#8B8B85' : x < 0.68 ? '#FFFFFF'
        : x < 0.80 ? '#5ADEB7' : x < 0.90 ? '#E69393' : '#98A5EF'),
      phase: Math.random() * 7,
    });
  }
  const NB = bandPts.length;
  const band = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.085, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0xffffff }), NB);
  bandPts.forEach((n, i) => {
    dummy.position.copy(n.p);
    dummy.scale.setScalar(0.8 + Math.random() * 0.5);
    dummy.updateMatrix();
    band.setMatrixAt(i, dummy.matrix);
    band.setColorAt(i, n.colC);
  });
  bandG.add(band);
  /* links to the outer nodes (M5.5 per AJ — the band dots floated unconnected): local
     nearest-neighbour edges so the ring reads as constellations, plus sparse inward spokes
     tying the outer nodes back to the core. Lives INSIDE bandG so the lines rotate with
     their endpoints (M3.4 lesson: edges must stay attached). */
  const bandLineMat = new THREE.LineBasicMaterial({ color: 0x3A3A38, transparent: true, opacity: 0.12 });
  {
    const bedges = [];
    bandPts.forEach((n, i) => {
      const near = bandPts
        .filter(m => m !== n)
        .sort((a, b) => a.p.distanceToSquared(n.p) - b.p.distanceToSquared(n.p));
      if (near[0] && near[0].p.distanceTo(n.p) < 3.0) bedges.push([n.p, near[0].p]);
      if (near[1] && Math.random() < 0.45 && near[1].p.distanceTo(n.p) < 3.0) bedges.push([n.p, near[1].p]);
      if (i % 7 === 0) bedges.push([n.p, n.p.clone().multiplyScalar(0.45)]); // inward spoke to the core
    });
    const bpos = new Float32Array(bedges.length * 6);
    bedges.forEach(([a, b], i) => bpos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6));
    const bgeo = new THREE.BufferGeometry();
    bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
    bandG.add(new THREE.LineSegments(bgeo, bandLineMat));
  }

  /* M5: the M4 "space orb" dark backing is DELETED — on the cream office it read as a
     storm-cloud shadow (AJ). The cream palette above needs no backing; galaxy mode (gk→1)
     supplies the dark field page-wide instead. */
  /* tight warm-white glow at the very centre — near-invisible on cream, blooms in galaxy */
  let coreMat;
  {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    const rg = x.createRadialGradient(128, 128, 4, 128, 128, 126);
    rg.addColorStop(0, 'rgba(255,252,240,0.95)');
    rg.addColorStop(0.3, 'rgba(255,250,232,0.45)');
    rg.addColorStop(1, 'rgba(255,250,232,0)');
    x.fillStyle = rg; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    coreMat = new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.2 });
    const core = new THREE.Sprite(coreMat);
    core.scale.set(7.5, 7.5, 1);
    core.renderOrder = -1;
    g.add(core);
  }

  /* thought flashes: every few seconds a random cluster blooms bright — "having uma ideia" */
  let flash = null, nextFlashAt = 2200;
  const sweepCol = new THREE.Color('#FFFFFF');
  const tmpCol = new THREE.Color();
  const flashCol = new THREE.Color();
  const FLASH_C = new THREE.Color('#D9A05B'); // amber bloom reads on cream…
  const FLASH_G = new THREE.Color('#FFFFFF'); // …white bloom on the night field
  const WEB_LINE_C = new THREE.Color(0x3A3A38), WEB_LINE_G = new THREE.Color(0xFFF8EC);
  let lastGk = -1;

  const tick = (t, dt, sw, gk = 0) => {
    const swS = sw ? sw.strength : 0;
    const swTheta = sw ? sw.theta : 0;
    if (sw && sw.col) sweepCol.set(sw.col);
    // galaxy-mode crossfades (skip the instanced recolours when gk hasn't moved)
    coreMat.opacity = 0.2 + 0.8 * gk;
    webLineMat.color.copy(WEB_LINE_C).lerp(WEB_LINE_G, gk);
    webLineMat.opacity = 0.15 + 0.05 * gk;
    bandLineMat.color.copy(webLineMat.color);
    bandLineMat.opacity = 0.12 + 0.04 * gk;
    flashCol.copy(FLASH_C).lerp(FLASH_G, gk);
    if (Math.abs(gk - lastGk) > 0.004) {
      lastGk = gk;
      wnodes.forEach((n, i) => winst.setColorAt(i, tmpCol.copy(n.colC).lerp(n.colG, gk)));
      winst.instanceColor.needsUpdate = true;
      bandPts.forEach((n, i) => band.setColorAt(i, tmpCol.copy(n.colC).lerp(n.colG, gk)));
      band.instanceColor.needsUpdate = true;
    }
    webG.rotation.y = t * 0.00008;
    bandG.rotation.y = -t * 0.000035; // counter-rotating galaxy shear
    if (t > nextFlashAt) {
      flash = { az: Math.random() * PI2, rad: R * (0.15 + 0.55 * Math.random()), r: R * 0.38, t0: t };
      nextFlashAt = t + 2600 + Math.random() * 2600;
    }
    let fk = 0, fx = 0, fz = 0;
    if (flash) {
      const k = (t - flash.t0) / 950;
      if (k >= 1) flash = null;
      else { fk = Math.sin(k * Math.PI); fx = flash.rad * Math.cos(flash.az); fz = flash.rad * Math.sin(flash.az); }
    }
    for (let i = 0; i < N; i++) {
      const p = parts[i];
      const az = p.az + t * p.w; // differential swirl
      const x = p.rad * Math.cos(az), z = p.rad * Math.sin(az);
      let s = p.base * (1 + 0.32 * Math.sin(t / 620 + p.phase)); // shimmer
      tmpCol.copy(p.colC);
      if (gk > 0.004) tmpCol.lerp(p.colG, gk);
      if (swS > 0.01) { // the thinking sweep: this side of the brain leans toward the dept colour
        const d = Math.atan2(Math.sin(az - swTheta), Math.cos(az - swTheta));
        let sk = Math.max(0, 1 - Math.abs(d) / 0.62);
        sk = sk * sk * (3 - 2 * sk) * swS;
        if (sk > 0.01) { s *= 1 + 0.85 * sk; tmpCol.lerp(sweepCol, 0.6 * sk); }
      }
      if (fk > 0) { // thought flash bloom
        const dx = x - fx, dz = z - fz;
        const fb = fk * Math.max(0, 1 - Math.sqrt(dx * dx + dz * dz) / flash.r);
        if (fb > 0.01) { s *= 1 + 0.9 * fb; tmpCol.lerp(flashCol, 0.5 * fb); }
      }
      dummy.position.set(x, p.y, z);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, tmpCol);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.instanceColor.needsUpdate = true;
    for (const p of pulses) {
      p.t += dt * p.speed;
      if (p.t >= 1) { p.t = 0; p.edge = edges[Math.floor(Math.random() * edges.length)]; }
      p.m.position.lerpVectors(p.edge[0], p.edge[1], p.t);
    }
  };
  return { group: g, tick };
}

/* ---------- pulsing ⚠ sprite for stuck agents (v1 rule) ---------- */
export function makeWarnSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  x.beginPath(); x.moveTo(64, 12); x.lineTo(120, 112); x.lineTo(8, 112); x.closePath();
  x.fillStyle = '#F2B84B'; x.fill();
  x.lineWidth = 7; x.strokeStyle = '#151414'; x.lineJoin = 'round'; x.stroke();
  x.fillStyle = '#151414'; x.font = '900 64px Inter, sans-serif';
  x.textAlign = 'center'; x.fillText('!', 64, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(2.6, 2.6, 1);
  return s;
}

/* ---------- walkway bridge between two XZ points ---------- */
export function makeWalkway(from, to, opts = {}) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const len = Math.hypot(dx, dz);
  const room = opts.glass || opts.chip || '#AEB6AB';
  /* 28 out 2026 — A PASSADEIRA ROLANTE (pedido do dono: «faça passadeiras rolantes no corredor,
     preta»). O que era uma laje branca é agora uma passadeira de aeroporto: TAPETE PRETO com ripas
     em relevo, GUARDAS de latão dos dois lados, uma linha de LED na cor da sala e — o que faz a
     diferença — o tapete a ANDAR. O movimento é uma textura de ripas que rola ao longo do tapete,
     a subir para o Cérebro; a luz da sala corre por cima, na mesma direcção. Quem olha percebe para
     onde vai o trabalho sem uma seta.
     Geometria: tudo fundido por material — 5 malhas por corredor (tapete, latão, LED, luz, tapete
     em movimento), sem contar o aro de chegada, que vai dentro do latão. */
  const g = new THREE.Group();
  const beltMat = new THREE.MeshStandardMaterial({
    color: '#23252B', map: beltTexture(Math.max(2, len - 1.4)), roughness: 0.86, metalness: 0.12,
  });
  const kerbMat = new THREE.MeshStandardMaterial({ color: brass(room, 0.24), roughness: 0.3, metalness: 0.9 });
  const ledMat = new THREE.MeshStandardMaterial({
    color: shade(room, 0.45), roughness: 0.5, metalness: 0.1,
    emissive: room, emissiveIntensity: 1.05,
  });
  const deck = [], kerb = [], line = [];
  // o corpo do corredor: uma laje preta que dá espessura ao vão e o tapete por cima
  deck.push(place(rboxGeo(len, 3.2, 0.34, 0.16), 0, -0.35, 0));
  deck.push(place(rboxGeo(len - 0.4, 2.72, 0.06, 0.06), 0, -0.03, 0));
  /* guardas de latão: um perfil fino e comprido de cada lado, com folga para o pé. Em 1.13.1
     encurtaram do lado da sala: passavam à frente da porta e cortavam a entrada ao meio. Agora
     acabam 1,15 m antes, como o corrimão de uma passadeira que entrega as pessoas à porta. */
  for (const s of [-1, 1]) {
    kerb.push(place(rboxGeo(len - 3.1, 0.10, 0.16, 0.04), 0, 0.02, s * 1.42));
    kerb.push(place(rboxGeo(len - 3.1, 0.06, 0.06, 0.02), 0, 0.11, s * 1.45));
  }
  // a linha de LED ao centro (o canal) e o aro de chegada (dentro do latão)
  line.push(place(rboxGeo(len - 1.6, 0.09, 0.04, 0.02), 0, 0.015, 0));
  {
    const anel = new THREE.TorusGeometry(1.45, 0.045, 8, 44).rotateX(-Math.PI / 2);
    anel.translate(len / 2 - 1.9, 0.035, 0);
    kerb.push(anel);
  }
  const dMesh = meshOf(deck, beltMat, { shadow: true });
  g.add(dMesh);
  const kMesh = meshOf(kerb, kerbMat, { shadow: true });
  g.add(kMesh);
  const lMesh = meshOf(line, ledMat, { shadow: false });
  lMesh.receiveShadow = false; lMesh.userData.part = 'walkwayLed';
  g.add(lMesh);
  // a luz a correr — sempre para o Cérebro (o `to`)
  const comet = ledComet(room, Math.max(2, len - 2), { speed: 0.16, opacity: 0.75, width: 0.30 });
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(2, len - 2), comet.width), comet.material);
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.048, 0);
  runner.userData.part = 'walkwayLed';
  runner.castShadow = false; runner.receiveShadow = false;
  g.add(runner);
  // o tapete em movimento: as ripas rolam na direcção do Cérebro (offset a subir)
  beltMat.userData.belt = true;
  beltMat.userData.ledTex = beltMat.map;
  beltMat.userData.ledSpeed = -0.62;

  g.position.set((from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2);
  g.rotation.y = -Math.atan2(dz, dx);
  g.userData.walkway = { from, to, len, room, width: 3.2, belt: true };
  g.userData.led = { room, strips: [comet.material], belts: [beltMat], count: 2 };
  return g;
}

/* ---------- a ENTRADA de cada sala (28 out 2026 · redesenhada em 1.13.1) ----------
   Pedido do dono: «entradas na sala (roxa, azul e amarela)» e, depois de ver: «melhore o design 3D
   das portas».

   A primeira versão era um pórtico de 4,6 m com dois montantes que — por um erro de convenção do
   `rboxGeo` (a caixa cresce a partir da BASE, não do centro) — começavam a 1,3 m do chão e ficavam
   a flutuar. O que se vê agora é uma PORTA a sério, à escala de uma pessoa e de um corredor de
   3,2 m:

     · vão livre de 2,92 × 2,46 m — cabe uma pessoa com folga e lê-se como porta, não como portal;
     · aro de latão com 0,24 m de espessura (ler-se o interior do vão é o que dá profundidade);
     · duas FOLHAS de vidro fosco que deslizam no mesmo carril, uma delas ABERTA 0,62 m — a sala
       está aberta e vê-se para dentro, como numa empresa em hora de trabalho;
     · puxador de latão vertical (uma barra, dois afastadores), no montante da folha fechada;
     · carril de latão no topo, com os dois carros das folhas à vista;
     · luz: uma cova acesa debaixo do lintel (dos dois lados), dois filetes no piso, e a mancha de
       luz que a porta deixa cair no corredor;
     · placa com o NOME da sala (a mesma cor do vidro), legível dos dois lados — é a única peça
       escrita na cena, e é o nome do sítio, não um número inventado.

   Geometria fundida por material: 6 malhas por porta (latão, luz, escuro, vidro, placa, mancha).
   O `+z` do grupo é o lado do corredor: quem coloca decide a direcção. */
let signCanvasCache = new Map();
function signTexture(label, glass) {
  const key = label + '|' + glass;
  if (signCanvasCache.has(key)) return signCanvasCache.get(key);
  const W = 512, H = 128;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#12131A';
  x.fillRect(0, 0, W, H);
  // o filete interior: a cor da sala, um tom acima do vidro para se ler à distância
  x.strokeStyle = glass;
  x.lineWidth = 5;
  x.globalAlpha = 0.85;
  x.strokeRect(9, 9, W - 18, H - 18);
  x.globalAlpha = 1;
  x.fillStyle = glass;
  x.font = 'bold 54px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(label || '').slice(0, 12), W / 2, H / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  signCanvasCache.set(key, t);
  return t;
}

let spillTextureCache = null;
function spillTexture() {
  if (spillTextureCache) return spillTextureCache;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.34)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  spillTextureCache = t;
  return t;
}

export function makeRoomEntrance({ glass = '#AEB6AB', at = { x: 0, z: 0 }, dir = { x: 1, z: 0 }, label = '' } = {}) {
  const g = new THREE.Group();
  const brassMat = new THREE.MeshStandardMaterial({ color: brass(glass, 0.18), roughness: 0.24, metalness: 0.96 });
  const ledMat = new THREE.MeshStandardMaterial({
    color: shade(glass, 0.42), roughness: 0.35, metalness: 0.1,
    emissive: glass, emissiveIntensity: 1.3,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#191A1F', roughness: 0.62, metalness: 0.3 });
  // vidro fosco: translúcido, mas a deixar ver a sala (sem isto a porta tapava o escritório)
  const glassMat = new THREE.MeshStandardMaterial({
    color: tint(glass, 0.14), roughness: 0.3, metalness: 0.06,
    transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false,
  });
  const signMat = new THREE.MeshStandardMaterial({
    color: '#0E0F14', roughness: 0.5, metalness: 0.3,
    map: label ? signTexture(label, glass) : null,
    emissive: label ? glass : '#000000', emissiveIntensity: label ? 0.12 : 0,
  });
  const spillMat = new THREE.MeshBasicMaterial({
    color: glass, map: spillTexture(), transparent: true, opacity: 0.26,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const B = [], L = [], D = [], V = [];
  /* `place(geo, x, y, z)` com y = BASE: o `rboxGeo` cresce de 0 para cima. Foi este o erro da
     primeira versão — os montantes nasciam a meio do vão e a porta flutuava. */
  const OW = DOOR.clearW, OH = DOOR.clearH, FW = DOOR.frameW, FD = DOOR.frameD, HH = DOOR.headerH;
  /* as duas folhas abrem AO MEIO (bi-parting, como uma porta automática): cada uma desliza para o
     seu lado e o vão fica livre no centro — é por ali que as pessoas entram e saem. Uma porta
     entreaberta de um lado só deixava o chefe a passar pelo vidro. */
  const open = Math.min(0.45, OW / 4);

  /* ---- o aro: dois montantes, a padieira e os remates de topo e de pé ---- */
  for (const s of [-1, 1]) {
    B.push(place(rboxGeo(FW, FD, OH + FW, 0.03), s * (OW / 2 + FW / 2), 0, 0));
    B.push(place(rboxGeo(FW + 0.07, FD + 0.07, 0.05, 0.02), s * (OW / 2 + FW / 2), 0, 0));      // pé do montante
    B.push(place(rboxGeo(FW + 0.07, FD + 0.07, 0.04, 0.02), s * (OW / 2 + FW / 2), OH + FW - 0.07, 0)); // ombro
  }
  B.push(place(rboxGeo(OW + FW * 2, FD, FW, 0.03), 0, OH, 0));

  /* ---- o aro do lado do CORREDOR ----
     A porta está assente na face interior da parede, mas quem vem pelo corredor vê um buraco de
     0,34 m de espessura. Um aro de latão na face exterior fecha esse vão, dá sombra à entrada e
     faz o mesmo desenho dos dois lados. O `+z` do grupo é o lado do corredor. */
  {
    const zc = -(WALL.t + FD / 2);            // face exterior da parede, em coordenadas da porta
    const az = zc + 0.06;                     // meio perfil de fora: lê-se em relevo, não colado
    B.push(place(rboxGeo(OW + FW * 2 + 0.34, 0.26, 0.16, 0.03), 0, OH + FW - 0.03, az));
    for (const s of [-1, 1]) {
      B.push(place(rboxGeo(0.16, 0.26, OH + FW + 0.02, 0.03), s * (OW / 2 + FW + 0.06), 0, az));
      B.push(place(rboxGeo(0.20, 0.30, 0.06, 0.02), s * (OW / 2 + FW + 0.06), 0, az));  // pé do aro
    }
    // a luz no vão: uma linha acesa por dentro da espessura, que apara a soleira do corredor
    L.push(place(rboxGeo(OW - 0.10, 0.04, 0.04, 0.015), 0, OH - 0.02, -(WALL.t / 2) - 0.06));
  }

  /* ---- a banda do nome: escura, com filetes de latão, entre a porta e a parede ---- */
  D.push(place(rboxGeo(OW + FW * 2 + 0.10, 0.13, HH, 0.03), 0, OH + FW, 0));
  /* os filetes do topo e do pé da banda ficam 5 mm FORA dela: faces exactamente coincidentes
     (duas faces no mesmo plano) dão aquele xadrez de z-fighting — viu-se no primeiro rascunho. */
  B.push(place(rboxGeo(OW + FW * 2 + 0.14, 0.17, 0.040, 0.02), 0, OH + FW - 0.005, 0));
  B.push(place(rboxGeo(OW + FW * 2 + 0.14, 0.17, 0.045, 0.02), 0, OH + FW + HH - 0.040, 0));
  /* o sublinhado aceso: é ele que faz a banda ler como caixa de luz, e não como placa preta.
     E a BARRA DE TOPO acesa — é a peça que se vê da câmara isométrica (que olha o escritório de
     cima): de cima lê-se a cor da sala na entrada, mesmo antes de se ver a porta. */
  L.push(place(rboxGeo(OW * 0.62, 0.045, 0.018, 0.008), 0, OH + FW + 0.045, 0.075));
  L.push(place(rboxGeo(OW + FW * 2 + 0.10, 0.16, 0.022, 0.01), 0, OH + FW + HH - 0.006, 0));

  /* ---- as duas folhas: vidro + caixilho de latão, uma aberta ---- */
  const LW = OW / 2 + 0.05, LH = OH - 0.10;
  const leaves = [
    { x: -(OW / 4 + open), z: 0.06, lead: 1 },        // folha de dentro, deslizada para a esquerda
    { x: (OW / 4 + open), z: -0.06, lead: -1 },       // folha de fora, deslizada para a direita
  ];
  for (const lf of leaves) {
    V.push(place(rboxGeo(LW - 0.09, 0.032, LH - 0.17, 0.02), lf.x, 0.14, lf.z));
    B.push(place(rboxGeo(LW, 0.05, 0.10, 0.015), lf.x, 0.08, lf.z));            // soleira da folha
    B.push(place(rboxGeo(LW, 0.05, 0.07, 0.015), lf.x, 0.08 + LH - 0.07, lf.z)); // topo da folha
    B.push(place(rboxGeo(0.05, 0.05, LH - 0.14, 0.012), lf.x + lf.lead * (LW / 2 - 0.025), 0.12, lf.z));
    {   // o puxador, no bordo de ataque de cada folha: uma barra e dois afastadores
      const hx = lf.x + lf.lead * (LW / 2 - 0.14);
      const hz = lf.z + (lf.z > 0 ? 0.075 : -0.075);
      for (const yy of [0.70, 1.56]) {
        B.push(place(new THREE.CylinderGeometry(0.011, 0.011, 0.09, 8), hx, yy, hz, { rx: Math.PI / 2 }));
      }
      B.push(place(new THREE.CylinderGeometry(0.022, 0.022, 0.94, 10), hx, 1.13, hz + (lf.z > 0 ? 0.045 : -0.045)));
    }
  }

  /* ---- o carril de topo, com os carros das folhas à vista ----
     Nas pontas, dois BOLSOS de latão (montantes verticais) onde a folha deslizada se recolhe. Sem
     eles, uma folha aberta ficava pendurada no ar — e nas salas do bordo aberto não há parede para
     a esconder. É também o que segura o carril: uma viga de 3,4 m não se apoia no nada. */
  const pocketX = Math.abs(leaves[0].x) + LW / 2 + 0.07;
  B.push(place(rboxGeo(OW + 0.52, 0.11, 0.09, 0.02), 0, OH - 0.03, 0));
  for (const lf of leaves) B.push(place(rboxGeo(0.22, 0.07, 0.045, 0.02), lf.x, OH + 0.06, lf.z));
  for (const s of [-1, 1]) {
    B.push(place(rboxGeo(0.12, 0.20, OH + 0.06, 0.03), s * pocketX, 0, 0));
    B.push(place(rboxGeo(0.20, 0.28, 0.05, 0.02), s * pocketX, 0, 0));   // pé do bolso
  }

  /* ---- a luz: cova sob a padieira (dos dois lados), filetes no piso e a mancha no corredor ---- */
  L.push(place(rboxGeo(OW - 0.08, 0.05, 0.045, 0.02), 0, OH - 0.10, 0.055));
  L.push(place(rboxGeo(OW - 0.08, 0.05, 0.045, 0.02), 0, OH - 0.10, -0.055));
  for (const s of [-1, 1]) L.push(place(rboxGeo(0.028, 0.028, OH - 0.34, 0.01), s * (OW / 2 - 0.014), 0.12, 0.075));
  D.push(place(rboxGeo(OW + FW * 2, 0.34, 0.045, 0.02), 0, 0, 0));               // soleira
  for (const s of [-1, 1]) L.push(place(rboxGeo(OW - 0.32, 0.035, 0.018, 0.01), 0, 0.062, s * 0.135));
  const spill = new THREE.Mesh(new THREE.PlaneGeometry(OW + 1.3, 1.9), spillMat);
  spill.rotation.x = -Math.PI / 2;
  spill.position.set(0, 0.072, 1.0);
  spill.userData.part = 'entranceSpill';

  const bm = meshOf(B, brassMat, { shadow: true }); if (bm) { bm.userData.part = 'entranceFrame'; g.add(bm); }
  const lm = meshOf(L, ledMat, { shadow: false }); if (lm) { lm.userData.part = 'entranceLed'; lm.castShadow = false; lm.receiveShadow = false; g.add(lm); }
  const dm = meshOf(D, darkMat, { shadow: true }); if (dm) { dm.userData.part = 'entranceSill'; g.add(dm); }
  const vm = meshOf(V, glassMat, { shadow: false }); if (vm) { vm.userData.part = 'entranceGlass'; vm.castShadow = false; vm.receiveShadow = false; g.add(vm); }

  /* ---- a placa com o nome da sala: duas faces, para se ler dos dois lados ---- */
  if (label) {
    const SW = Math.min(OW * 0.44, 1.12), SH = Math.min(HH - 0.10, 0.26);
    const y = OH + FW + HH / 2;
    for (const s of [1, -1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), signMat);
      pl.position.set(0, y, s * 0.082);
      pl.rotation.y = s > 0 ? 0 : Math.PI;
      pl.userData.part = 'entranceSign';
      g.add(pl);
    }
  }
  g.add(spill);

  g.position.set(at.x, 0, at.z);
  g.rotation.y = Math.atan2(dir.x, dir.z);   // o +z do pórtico olha para o corredor
  g.userData.entrance = {
    glass, at: { x: at.x, z: at.z }, dir: { x: dir.x, z: dir.z },
    width: OW + FW * 2, height: OH + FW + HH,        // contorno exterior (com a banda do nome)
    clear: { w: OW, h: OH },
    leaves: 2, open, label: String(label || ''),
  };
  return g;
}

/* ---------- a SALA-MESTRE: o Cérebro como sala, não como objecto (28 out 2026) ----------
   Pedido do dono: o Cérebro deixa de ser uma peça exposta e passa a ser a sala onde os chefes se
   reúnem — «futurística, coisa de outro mundo, rodeada de LED», com o orbe ainda mais em destaque.
   O que aqui se acrescenta ao que já existe (o orbe é do brain.js, não se lhe toca):

     · um ANEL DE LED no chão, a toda a volta do pod — a fronteira da sala-mestre;
     · SEIS PÚLPITOS, um por sala, cada um com a cor dessa sala acesa na aresta e na pastilha do
       tampo: é o lugar de cada chefe, e vê-se de longe quem é de onde;
     · TRÊS COLUNAS de latão com a ponta acesa, a marcar a sala sem a fechar (o pod não tem tecto);
     · dois aros de latão no chão (o desenho de uma praça) para o olho ter escala.

   Não é decoração solta: as posições dos chefes saem daqui (`userData.hall.spots`) e são as mesmas
   que o `crew.js` usa para os pôr a andar. Uma só verdade para o desenho e para a coreografia. */
export function makeMasterHall({ spots = [], glass = '#AEB6AB', ink = '#4C7A57' } = {}) {
  const g = new THREE.Group();
  const R_CHIEF = 5.70;   // onde o chefe pára (à distância de quem lê um púlpito)
  const R_DESK = 5.00;    // o púlpito, à frente dele
  const R_RING = 7.10;    // o aro de LED que fecha a sala
  const LED_COL = tint(glass, 0.55);
  const brassMat = new THREE.MeshStandardMaterial({ color: brass(glass, 0.26), roughness: 0.26, metalness: 0.94 });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#15171B', roughness: 0.44, metalness: 0.3 });
  const ledMat = new THREE.MeshStandardMaterial({
    color: shade(LED_COL, 0.35), roughness: 0.35, metalness: 0.2,
    emissive: LED_COL, emissiveIntensity: 1.15,
  });

  const brassG = [], darkG = [], ledG = [];

  // 1 · a praça: dois aros de latão no chão e o aro de LED a fechar a sala
  for (const [rin, rout] of [[3.02, 3.10], [6.40, 6.46]]) {
    const ring = new THREE.RingGeometry(rin, rout, 128);
    const m = new THREE.Mesh(ring, brassMat);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.152;
    m.userData.part = 'hallRing';
    g.add(m);
  }
  {
    const ring = new THREE.RingGeometry(R_RING - 0.075, R_RING, 128);
    const m = new THREE.Mesh(ring, ledMat);
    m.rotation.x = -Math.PI / 2; m.position.y = 0.158;
    m.userData.part = 'hallLed';
    g.add(m);
  }
  // 2 · as colunas: três, com um colar de luz a meio (marcam a sala, não a fecham)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const x = Math.cos(a) * 7.35, z = Math.sin(a) * 7.35;
    brassG.push(place(new THREE.CylinderGeometry(0.075, 0.115, 2.70, 14), x, 1.35, z));
    brassG.push(place(new THREE.CylinderGeometry(0.30, 0.34, 0.07, 20), x, 0.16, z));
    brassG.push(place(new THREE.CylinderGeometry(0.16, 0.10, 0.16, 14), x, 2.72, z));
    // o colar de luz: um anel a meio fuste, na cor da casa
    const colar = new THREE.TorusGeometry(0.105, 0.022, 8, 22);
    colar.rotateX(Math.PI / 2);
    colar.translate(x, 1.78, z);
    ledG.push(colar);
  }
  /* 2b · O ORBE EM DESTAQUE. Oito apliques rasos em volta do globo, a apontar para cima: é o gesto
     de museu que faz de um objecto a peça da sala. Ficam a 4,45 — por dentro dos púlpitos (5,0) e
     por fora dos anéis do orbe (4,28 / 5,71), e desfasados dos seis chefes para ninguém tropeçar. */
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * 4.45, z = Math.sin(a) * 4.45;
    brassG.push(place(new THREE.CylinderGeometry(0.115, 0.135, 0.16, 14), x, 0.24, z));
    ledG.push(place(new THREE.CylinderGeometry(0.085, 0.085, 0.02, 14), x, 0.325, z));
  }

  /* 3 · os SEIS PÚLPITOS. Desenho: um pilar fino de latão, um tampo de vidro escuro inclinado para
     quem está de pé, e uma aresta acesa na cor da sala — a mesma do vidro dela. A primeira versão
     era um caixote preto baixo: no render lia-se como uma mala de mão. Um púlpito tem de ter PÉ. */
  const spotsOut = [];
  spots.forEach((sp) => {
    const a = Number(sp.angle) || 0;
    const cx = Math.cos(a) * R_DESK, cz = Math.sin(a) * R_DESK;
    const toWorld = (gg) => { gg.rotateY(-a); gg.translate(cx, 0, cz); return gg; };

    // pé e fuste (latão)
    brassG.push(toWorld(place(new THREE.CylinderGeometry(0.24, 0.28, 0.05, 22), 0, 0.155, 0)));
    brassG.push(toWorld(place(new THREE.CylinderGeometry(0.055, 0.075, 0.76, 12), 0, 0.56, 0)));
    brassG.push(toWorld(place(new THREE.CylinderGeometry(0.10, 0.10, 0.05, 16), 0, 0.95, 0)));

    // tampo inclinado para o chefe (o +x local é o lado de FORA, onde ele está)
    const tilt = -0.40;
    const topo = rboxGeo(0.70, 0.48, 0.045, 0.03).clone();
    topo.rotateZ(tilt);
    topo.translate(0, 1.03, 0);
    darkG.push(toWorld(topo));
    // a aresta acesa (na cor da sala) e a pastilha do tampo
    const edge = rboxGeo(0.70, 0.05, 0.05, 0.02).clone();
    edge.rotateZ(tilt);
    edge.translate(0, 1.055, 0.225);
    const edgeMat = new THREE.MeshStandardMaterial({
      color: shade(sp.color || glass, 0.42), roughness: 0.35, metalness: 0.3,
      emissive: sp.color || glass, emissiveIntensity: 1.35,
    });
    const edgeMesh = new THREE.Mesh(toWorld(edge), edgeMat);
    edgeMesh.userData.part = 'hallSpot';
    edgeMesh.userData.dept = sp.dept;
    g.add(edgeMesh);
    // o ecrã do púlpito: vidro escuro, com a cor da sala por baixo (é a única coisa que se acende
    // quando o chefe chega, e é o que diz de quem é o lugar)
    const ecra = rboxGeo(0.50, 0.30, 0.012, 0.015).clone();
    ecra.rotateZ(tilt);
    ecra.translate(0, 1.062, -0.02);
    const ecraMat = new THREE.MeshStandardMaterial({
      color: '#0E1013', roughness: 0.22, metalness: 0.4,
      emissive: sp.color || glass, emissiveIntensity: 0.42,
    });
    const ecraMesh = new THREE.Mesh(toWorld(ecra), ecraMat);
    ecraMesh.userData.part = 'hallSpot';
    ecraMesh.userData.dept = sp.dept;
    g.add(ecraMesh);

    spotsOut.push({
      dept: sp.dept, color: sp.color || glass,
      angle: a,
      x: Math.round(cx * 1000) / 1000, z: Math.round(cz * 1000) / 1000,   // o púlpito
      standX: Math.round(Math.cos(a) * R_CHIEF * 1000) / 1000,            // onde o chefe pára
      standZ: Math.round(Math.sin(a) * R_CHIEF * 1000) / 1000,
      faceY: Math.atan2(-Math.cos(a), -Math.sin(a)),  // virado ao centro
    });
  });
  const bm = meshOf(brassG, brassMat, { shadow: true }); if (bm) g.add(bm);
  const dm = meshOf(darkG, darkMat, { shadow: true }); if (dm) g.add(dm);
  const lm = meshOf(ledG, ledMat, { shadow: false });
  if (lm) { lm.castShadow = false; lm.receiveShadow = false; lm.userData.part = 'hallLed'; g.add(lm); }

  g.userData.hall = { spots: spotsOut, ring: R_RING, chief: R_CHIEF, desk: R_DESK, glass, ink };
  return g;
}

/* ---------- room walls: a solid base plus a glass upper band, in an L on the two sides
   that face away from the camera. The corner nearest the Cérebro stays open — that is
   where the walkway arrives, so every sala has a doorway without a door. ---------- */
export function makeWallSign(text, inkColor, width) {
  const c = document.createElement('canvas');
  const W = 1024, H = 128; c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.font = '700 64px Georgia, "Times New Roman", serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const sp = 10;
  let total = 0;
  for (const ch of text) total += x.measureText(ch).width + sp;
  let cx0 = (W - total + sp) / 2;
  x.fillStyle = inkColor;
  for (const ch of text) {
    const cw = x.measureText(ch).width;
    x.fillText(ch, cx0 + cw / 2, H / 2 + 4);
    cx0 += cw + sp;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const h = width * (H / W);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, h),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false })
  );
}

export function makeRoomWalls(w, d, chip, ink, label, opts = {}) {
  const base = opts.base ?? WALL.base;   // parte sólida, até ao tampo das secretárias
  const band = opts.band ?? WALL.band;   // altura da banda de vidro por cima
  const t = opts.t ?? WALL.t;            // espessura da parede
  const H = base + band;              // altura total
  const room = opts.glass || chip;    // (atenção: `glass` é a COR; `band` é a altura)
  const g = new THREE.Group();

  /* 27 out 2026 — «chique chique». A parede era uma caixa branca com uma faixa colorida em baixo e
     uma banda de vidro quase invisível: lia-se como uma maquete de cartão. Agora tem os gestos que
     fazem uma parede de hotel — RIPAADO vertical (sombras reais, de graça em 3D), RODAPÉ e MONTANTES
     de latão, uma COVA DE LUZ na cor da sala debaixo do remate e a placa em latão. E, sobretudo,
     tudo isto é FUNDIDO em cinco malhas (era uma malha por ripa: 48 por sala): cinco draw calls por
     sala em vez de sessenta. */
  const wallMat = new THREE.MeshStandardMaterial({ color: '#F5F4EE', roughness: 0.94, metalness: 0 });
  const ribMat = new THREE.MeshStandardMaterial({ color: '#EDEBE2', roughness: 0.92, metalness: 0 });
  const brassMat = new THREE.MeshStandardMaterial({ color: brass(room, 0.2), roughness: 0.3, metalness: 0.9 });
  const capMat = new THREE.MeshStandardMaterial({ color: ink, roughness: 0.55, metalness: 0.1 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: tint(room, 0.26), roughness: 0.08, metalness: 0.08,
    transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide,
  });
  const coveMat = new THREE.MeshStandardMaterial({
    color: tint(room, 0.55), roughness: 0.4, metalness: 0.1, emissive: room, emissiveIntensity: 0.55,
  });

  const wallG = [], ribG = [], trimG = [], glassG = [], capG = [], coveG = [];
  const boxAt = (arr, ww, dd, hh, r, x, y, z) => {
    const geo = rboxGeo(ww, dd, hh, r).clone();
    geo.translate(x, y, z);
    arr.push(geo);
  };

  const backZ = -d / 2 + t / 2;
  const sideX = -w / 2 + t / 2;

  /* 28 out 2026 — O VÃO DA PORTA. Uma porta encostada a uma parede inteira é um adereço: não há
     buraco, não há passagem, e de fora não se vê nada. Aqui o pano de fundo (-z) parte-se em dois
     troços e fica uma verga por cima do vão, com a altura do `DOOR`. É a única parede que se abre:
     a outra (-x) nunca recebe porta, porque a circulação vai para o Cérebro pelo eixo do -z. */
  const op = opts.opening || null;    // { x, w, h } em coordenadas locais da sala
  const segX = op
    ? [[-w / 2, op.x - op.w / 2], [op.x + op.w / 2, w / 2]].filter(([a, b]) => b - a > 0.05)
    : [[-w / 2, w / 2]];

  // base das duas paredes + pilares de canto
  for (const [a, b] of segX) boxAt(wallG, b - a, t, base, 0.1, (a + b) / 2, 0, backZ);
  if (op) boxAt(wallG, op.w, t, base - op.h, 0.1, op.x, op.h, backZ);   // a verga
  boxAt(wallG, t, d, base, 0.1, sideX, 0, 0);
  for (const [px, pz] of [[w / 2 - 0.3, backZ], [sideX, d / 2 - 0.3], [-w / 2 + 0.3, backZ]]) {
    boxAt(wallG, 0.54, 0.54, H, 0.1, px, 0, pz);
    boxAt(capG, 0.62, 0.62, 0.14, 0.05, px, H - 0.14, pz);
  }
  // ripaado (só no pano acima do rodapé)
  for (let x = -w / 2 + 0.62; x < w / 2 - 0.5; x += 0.92) {
    if (op && Math.abs(x - op.x) < op.w / 2 + 0.75) continue;   // a ripa não atravessa a porta nem as folhas deslizadas
    boxAt(ribG, 0.17, 0.09, base - 1.05, 0.03, x, 0.42, backZ + t / 2 + 0.035);
  }
  for (let z = -d / 2 + 0.62; z < d / 2 - 0.5; z += 0.92) boxAt(ribG, 0.09, 0.17, base - 1.05, 0.03, sideX + t / 2 + 0.035, 0.42, z);

  // rodapé de latão (baixo e fino) — também parte em dois quando há porta
  for (const [a, b] of segX) boxAt(trimG, b - a, t + 0.10, 0.20, 0.04, (a + b) / 2, 0, backZ);
  boxAt(trimG, t + 0.10, d, 0.20, 0.04, sideX, 0, 0);

  // banda de vidro + remate
  boxAt(glassG, w, 0.08, band, 0.03, 0, base, backZ);
  boxAt(glassG, 0.08, d, band, 0.03, sideX, base, 0);
  // remate de latão à cabeça do vidro (é a linha que faz a parede parecer um pavilhão) e
  // uma faixa fina de tinta por cima, para o vidro não acabar em aresta viva
  boxAt(trimG, w + 0.10, t + 0.18, 0.15, 0.05, 0, H - 0.15, backZ);
  boxAt(trimG, t + 0.18, d + 0.10, 0.15, 0.05, sideX, H - 0.15, 0);
  boxAt(capG, w + 0.04, t + 0.10, 0.06, 0.03, 0, H - 0.02, backZ);
  boxAt(capG, t + 0.10, d + 0.04, 0.06, 0.03, sideX, H - 0.02, 0);
  boxAt(trimG, w, t + 0.07, 0.07, 0.03, 0, base - 0.05, backZ);
  boxAt(trimG, t + 0.07, d, 0.07, 0.03, sideX, base - 0.05, 0);

  // montantes de latão no vidro
  for (const zz of [d / 2 - 0.8, 0, -d / 2 + 0.8]) boxAt(trimG, 0.11, t + 0.08, band, 0.02, 0, base, zz);
  for (const xx of [-w / 2 + 0.8, 0, w / 2 - 0.8]) boxAt(trimG, t + 0.08, 0.11, band, 0.02, xx, base, 0);

  // cova de luz (na cor da sala), encostada ao remate
  boxAt(coveG, w - 0.5, 0.05, 0.05, 0.02, 0, base - 0.26, backZ + t / 2 + 0.05);
  boxAt(coveG, 0.05, d - 0.5, 0.05, 0.02, sideX + t / 2 + 0.05, base - 0.26, 0);

  /* 28 out 2026 — O LED NO VIDRO. A calha: um canal aceso (a mesma malha da cova, sem draw call
     novo) no arranque da banda de vidro. A luz: a cometa que corre por cima da calha, um pano por
     parede. As duas coisas na cor da sala — o vidro, a calha e a luz dizem o mesmo tom. */
  boxAt(coveG, w - 0.55, 0.045, 0.065, 0.02, 0, base + 0.05, backZ + t / 2 + 0.055);
  boxAt(coveG, 0.045, d - 0.55, 0.065, 0.02, sideX + t / 2 + 0.055, base + 0.05, 0);
  const ledMeshes = [];
  {
    const back = ledComet(room, Math.max(2, w - 1.4), { speed: 0.055 });
    const m1 = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(2, w - 1.4), back.width), back.material);
    m1.position.set(0, base + 0.58, backZ + t / 2 + 0.075);
    m1.userData.part = 'wallLed';
    ledMeshes.push(m1);
    const side = ledComet(room, Math.max(2, d - 1.4), { speed: -0.055 });
    const m2 = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(2, d - 1.4), side.width), side.material);
    m2.rotation.y = Math.PI / 2;
    m2.position.set(sideX + t / 2 + 0.075, base + 0.58, 0);
    m2.userData.part = 'wallLed';
    ledMeshes.push(m2);
  }

  const add = (geos, material, part, shadow = true) => {
    const m = meshOf(geos, material, { shadow });
    if (!m) return null;
    m.userData.part = part;
    if (part === 'wallGlass' || part === 'wallCove') { m.castShadow = false; m.receiveShadow = false; }
    g.add(m);
    return m;
  };
  add(wallG, wallMat, 'wall');
  add(ribG, ribMat, 'wall');
  add(trimG, brassMat, 'wallTrim');
  add(glassG, glassMat, 'wallGlass');
  add(capG, capMat, 'wallCap');
  add(coveG, coveMat, 'wallCove', false);

  // o nome da sala: latão sobre a parede, e não branco sobre branco
  if (label) {
    const signW = Math.min(w * 0.34, 6.6);
    const sign = makeWallSign(String(label).toUpperCase(), '#8A6F45', signW);
    sign.position.set(w / 2 - signW / 2 - 0.95, 2.36, backZ + t / 2 + 0.06);
    sign.userData.part = 'wallSign';
    g.add(sign);
  }
  // a luz que passa: entra no grupo e fica anunciada para o main a animar
  for (const m of ledMeshes) { m.castShadow = false; m.receiveShadow = false; g.add(m); }
  // o vão fica anunciado para o teste poder provar que a parede foi mesmo aberta
  g.userData.wall = { w, d, t, base, band, opening: op ? { ...op } : null };
  g.userData.led = {
    room,
    strips: ledMeshes.map((m) => m.material),
    // duas faixas por sala: uma em cada pano de parede
    count: ledMeshes.length,
  };
  return g;
}

/* ---------- o adereço da sala (27 out 2026, revisto) ----------
   O que uma sala destas tem a mais do que secretárias: um SÍTIO. Nasceu daí o adereço — e a
   primeira versão falhou por duas razões que se vêem no render: (1) o tapete caía no meio das
   secretárias, onde ninguém o vê e onde estorva; (2) os candeeiros de 4,1 m liam-se como
   microfones de pé alto, não como luz.

   A planta da sala diz onde há espaço: as secretárias ocupam z de -7,4 a +5,4 e ficam entre
   x ±5,3; as paredes estão em -x e -z (o canto aberto é o que a câmara vê). Sobra uma faixa de
   ~7 m à frente — a mais visível de todas — e dois corredores laterais. É aí que entra o adereço:
   uma ENTRADA (tapete de marfim com filete de latão e soleira gravada), um SALÃO à frente
   (duas poltronas de latão, mesa redonda, taça) e LUZ nos dois corredores. Tudo dentro do mesmo
   gesto de hotelaria: marfim, carvão e latão.

   Regra de desenho: nada disto pode parecer mobília de maquete — por isso as peças têm pés,
   folgas e alturas de gente (poltrona 1,15 a encosto, mesa 0,60, candeeiro 1,95). E regra de
   motor: TUDO é fundido por material no fim (4 malhas), porque um adereço por sala a 20 draw
   calls eram 120 draw calls que ninguém pediu. */
export function makeRoomDressing(w, d, glass, chip, ink, opts = {}) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: brass(glass, 0.22), roughness: 0.26, metalness: 0.94 });
  const dark = new THREE.MeshStandardMaterial({ color: mix(shade(glass, 0.55), '#15161A', 0.55), roughness: 0.5, metalness: 0.22 });
  const ivory = new THREE.MeshStandardMaterial({ color: mix('#EFE9DC', glass, 0.05), roughness: 0.95, metalness: 0 });
  // o campo do tapete: escuro, para o marfim das poltronas e o latão terem onde brilhar
  const rugDeep = new THREE.MeshStandardMaterial({ color: mix(shade(glass, 0.52), '#20222A', 0.5), roughness: 0.97, metalness: 0 });
  const glow = new THREE.MeshStandardMaterial({
    color: tint(glass, 0.55), roughness: 0.4, metalness: 0.06, emissive: glass, emissiveIntensity: 0.6,
    transparent: true, opacity: 0.92,
  });
  const bags = { dressRug: [], dressIvory: [], dress: [], dressMetal: [], dressGlow: [] };
  const put = (mesh, part) => {
    const geo = mesh.geometry.clone();
    mesh.updateMatrix();
    geo.applyMatrix4(mesh.matrix);
    bags[part].push(geo);
    return mesh;
  };
  // põe uma peça num sítio LOCAL (lx, lz) de um móvel centrado em (cx, cz) e virado de `rot`
  const seat = (mesh, cx, cz, rot, lx, lz, ly) => {
    mesh.position.set(cx + lx * Math.cos(rot) + lz * Math.sin(rot), ly, cz - lx * Math.sin(rot) + lz * Math.cos(rot));
    mesh.rotation.y = rot;
    mesh.updateMatrix();
    return mesh;
  };

  /* 1 · A ENTRADA. Tapete de marfim com moldura de carvão e filete de latão, na faixa da frente,
     com uma soleira de latão gravada do lado de fora — o gesto de quem chega. */
  // o tapete é do SALÃO, não da sala: cobre a mesa e as duas poltronas com folga, e deixa
  // respiração à volta. Um tapete de parede a parede lia-se como uma alcatifa preta no render.
  const rw = Math.min(8.0, w - 3.4), rd = 3.4;
  // a faixa da frente tem de existir em TODAS as salas: nas de 26 de fundo há menos 4 m do que
  // nas de 30, e o tapete da primeira versão ficava a rasar as secretárias (visto no render).
  /* 1.10.4: o salão encosta ao fim das secretárias, não a um número fixo. `opts.front` é o z local
     onde a última fila acaba (vem de `deskFront()` em data.js); o tapete começa 1,2 m depois disso
     e nunca sai do pod. Sem `front` (chamadas antigas) cai na faixa de sempre. */
  const front = opts.front != null ? opts.front : d / 2 - 6.5;
  const rz = Math.min(d / 2 - rd / 2 - 0.9, Math.max(front + 1.2 + rd / 2, d / 2 - 3.4));
  /* Onde o salão assenta dentro da faixa da frente. Deslocado para +x de propósito: a câmara olha
     a sala pela diagonal (+x,+z), e ao centro o salão ficava por trás da fila da esquerda. Assim
     cai no vão que a câmara vê de facto, e deixa a árvore sozinha no canto oposto. */
  const rx = Math.min(w / 2 - rw / 2 - 1.5, 2.8);
  const rugY = 0.124, rugH = 0.03;
  const rug = rbox(rw, rd, rugH, rugDeep, 0.14);
  rug.position.set(rx, rugY, rz); put(rug, 'dressRug');
  // moldura de carvão (quatro barras) e filete de latão por dentro dela
  for (const [bw, bd, px, pz] of [
    [rw, 0.16, 0, -rd / 2 + 0.08], [rw, 0.16, 0, rd / 2 - 0.08],
    [0.16, rd - 0.32, -rw / 2 + 0.08, 0], [0.16, rd - 0.32, rw / 2 - 0.08, 0],
  ]) {
    const bar = rbox(bw, bd, 0.028, ivory, 0.02);
    bar.position.set(rx + px, rugY + 0.022, rz + pz); put(bar, 'dressIvory');
  }
  for (const [bw, bd, px, pz] of [
    [rw - 0.72, 0.03, 0, -rd / 2 + 0.40], [rw - 0.72, 0.03, 0, rd / 2 - 0.40],
    [0.03, rd - 0.72, -rw / 2 + 0.40, 0], [0.03, rd - 0.72, rw / 2 - 0.40, 0],
  ]) {
    const line = rbox(bw, bd, 0.012, metal, 0.006);
    line.position.set(rx + px, rugY + 0.036, rz + pz); put(line, 'dressMetal');
  }
  // soleira de latão à frente do tapete
  const sill = rbox(Math.min(rw - 2.2, 9), 0.34, 0.05, metal, 0.03);
  sill.position.set(rx, rugY + 0.01, rz + rd / 2 + 0.52); put(sill, 'dressMetal');

  /* 2 · O SALÃO. Duas poltronas de carvão com pés de latão, viradas umas para as outras, e uma
     mesa redonda de latão com uma taça de marfim. Alturas de gente: assento 0,42, encosto 1,15. */
  const armchair = (cx, cz, rot) => {
    const base = rbox(1.08, 1.04, 0.26, ivory, 0.12);
    seat(base, cx, cz, rot, 0, 0, 0.40); put(base, 'dressIvory');
    const cushion = rbox(0.94, 0.88, 0.10, dark, 0.07);   // a almofada de assento, noutro tom
    seat(cushion, cx, cz, rot, 0, 0.02, 0.55); put(cushion, 'dress');
    const back = rbox(1.08, 0.18, 0.74, ivory, 0.09);
    seat(back, cx, cz, rot, 0, -0.44, 0.83); put(back, 'dressIvory');
    for (const ax of [-0.48, 0.48]) {
      const arm = rbox(0.14, 0.94, 0.22, ivory, 0.07);
      seat(arm, cx, cz, rot, ax, 0.02, 0.62); put(arm, 'dressIvory');
    }
    for (const [lx, lz] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.38], [0.42, 0.38]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.30, 8), metal);
      seat(leg, cx, cz, rot, lx, lz, 0.27); put(leg, 'dressMetal');
    }
  };
  const tableX = rx, tableZ = rz - 0.1;
  armchair(tableX - 2.35, tableZ, Math.PI / 2);
  armchair(tableX + 2.35, tableZ, -Math.PI / 2);
  {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.50, 0.05, 26), metal);
    foot.position.set(tableX, 0.145, tableZ); put(foot, 'dressMetal');
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.42, 14), metal);
    stem.position.set(tableX, 0.36, tableZ); put(stem, 'dressMetal');
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.86, 0.06, 34), metal);
    top.position.set(tableX, 0.60, tableZ); put(top, 'dressMetal');
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.17, 0.17, 22), ivory);
    bowl.position.set(tableX, 0.72, tableZ); put(bowl, 'dressIvory');
  }

  /* 3 · A APARADORA do corredor esquerdo: baixa, comprida, tampo de latão, dois livros e um jarro. */
  const cx = -(w / 2 - 0.95), cz = d * 0.02, clen = Math.min(d * 0.42, 7.5);
  const body = rbox(0.56, clen, 0.74, dark, 0.05);
  body.position.set(cx, 0.12, cz); put(body, 'dress');
  const top = rbox(0.62, clen + 0.06, 0.045, metal, 0.02);
  top.position.set(cx, 0.87, cz); put(top, 'dressMetal');
  const bookA = rbox(0.30, 0.34, 0.05, ivory, 0.01);
  bookA.position.set(cx, 0.93, cz - clen * 0.30); put(bookA, 'dressIvory');
  const bookB = rbox(0.26, 0.30, 0.05, dark, 0.01);
  bookB.position.set(cx, 0.99, cz - clen * 0.28); put(bookB, 'dress');
  const vase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.20, 0.42, 16), metal);
  vase.position.set(cx, 1.10, cz + clen * 0.32); put(vase, 'dressMetal');

  /* 4 · A LUZ. Dois candeeiros de pé de 1,95 m — fuste fino, cúpula de linho acesa — nos topos
     dos corredores, junto ao salão. Não são candeeiros de tecto porque a sala não tem tecto. */
  const lamps = [];
  for (const lx of [-(w / 2 - 1.8), w / 2 - 1.8]) {
    const lz = rz - 2.4;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.30, 0.05, 22), metal);
    foot.position.set(lx, 0.145, lz); put(foot, 'dressMetal');
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.036, 1.52, 12), metal);
    pole.position.set(lx, 0.93, lz); put(pole, 'dressMetal');
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.31, 0.38, 24, 1, true), glow);
    shade.position.set(lx, 1.69, lz); put(shade, 'dressGlow');
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 24), metal);
    cap.position.set(lx, 1.89, lz); put(cap, 'dressMetal');
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow);
    bulb.position.set(lx, 1.61, lz); put(bulb, 'dressGlow');
    lamps.push({ x: lx, z: lz, h: 1.90 });
  }

  /* 4b · A LUZ DO SALÃO: um candeeiro de braço — fuste de latão de 2,45 m, braço horizontal e
     cúpula acesa pendurada sobre a mesa. É a peça que se vê POR CIMA das secretárias; sem ela o
     salão ficava rente ao chão e a sala lia-se como uma fila de mesas e nada mais. */
  const lpX = rx + rw / 2 + 0.75, lpZ = rz + 0.35;
  {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.40, 0.06, 24), metal);
    foot.position.set(lpX, 0.15, lpZ); put(foot, 'dressMetal');
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.30, 14), metal);
    pole.position.set(lpX, 1.33, lpZ); put(pole, 'dressMetal');
    const armLen = lpX - tableX - 0.1;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, armLen, 12), metal);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(lpX - armLen / 2, 2.46, lpZ); put(arm, 'dressMetal');
    const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.30, 10), metal);
    drop.position.set(lpX - armLen, 2.31, lpZ); put(drop, 'dressMetal');
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.30, 24, 1, true), glow);
    bell.rotation.x = Math.PI;   // a boca para baixo
    bell.position.set(lpX - armLen, 2.04, lpZ); put(bell, 'dressGlow');
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.10, 10, 8), glow);
    bulb.position.set(lpX - armLen, 1.98, lpZ); put(bulb, 'dressGlow');
  }

  /* 5 · A ÁRVORE do canto direito da frente: o canto que a câmara vê e que estava vazio. A planta
     da sala existe do lado oposto (é a peça de 1.9.6), por isso esta é outra espécie e outra
     semente — duas plantas iguais à mesma distância lêem-se como decoração de catálogo. */
  let tree = null;
  try {
    tree = makePlant({ seed: (opts.seed || 7) + 5, kind: 'broad', scale: 1.12 });
    tree.position.set(w / 2 - 2.1, 0.12, d / 2 - 2.2);
    tree.rotation.y = 1.15;
    tree.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.add(tree);
  } catch (e) { tree = null; }

  const M_ = { dressRug: rugDeep, dressIvory: ivory, dress: dark, dressMetal: metal, dressGlow: glow };
  for (const part of ['dressRug', 'dressIvory', 'dress', 'dressMetal', 'dressGlow']) {
    if (!bags[part].length) continue;
    const m = meshOf(bags[part], M_[part], { shadow: part !== 'dressGlow' });
    if (!m) continue;
    m.userData.part = part;
    if (part === 'dressGlow') { m.castShadow = false; m.receiveShadow = false; }
    if (part === 'dressRug') { m.castShadow = false; m.receiveShadow = true; }
    g.add(m);
  }

  g.userData.dressing = {
    rug: { w: rw, d: rd, x: rx, z: rz }, lamps, table: { x: tableX, z: tableZ },
    pendant: { x: lpX - (lpX - tableX - 0.1), z: lpZ, h: 2.46 },
    console: { x: cx, z: cz, len: clen }, tree: tree ? { x: w / 2 - 2.1, z: d / 2 - 2.2 } : null,
  };
  return g;
}
