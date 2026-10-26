// Órbita — OS AVATARES (27 out 2026, 1.10.0).
//
// Pedido do dono: «melhorar as interações do braço de avatar mexendo realmente o mouse e digitando
// nos teclados, e melhorar o avatar — uma vibe mais pessoa real, com roupa formal, mas cada sala
// mantém a coloração da roupa, ficando mais realista. Cabelo diferente para cada agente (35),
// alguns com chapéu, alguns serão mulheres.»
//
// O que mudou em relação ao avatar de 1.9.x, e porquê:
//
//   · ROUPA. Era uma cápsula na cor do departamento — um pijama pastel. Agora é um fato: casaco,
//     camisa, gravata (ou lenço/blusa), casaco cruzado, costura nas costas, cinto. A cor continua a
//     ser a da sala, mas assente (ver `looks.js`): olhando a sala lê-se a cor, olhando a pessoa
//     lê-se um fato.
//   · CABEÇA. 35 penteados diferentes (15 estilos × variantes de comprimento/risca), 8 chapéus,
//     11 barbas, 7 pares de óculos, 14 mulheres — escritos à mão em `looks.js`, não sorteados.
//     Ganhou olhos, sobrancelhas, nariz e boca: de costas não se vê, mas quando o agente se levanta
//     e vira para a câmara (a pedir ajuda, a festejar) via-se uma cara vazia.
//   · BRAÇOS. Era um único cotovelo falso: o ombro rodava e a cápsula do braço seguia. Não havia
//     mão, nem cotovelo, nem contacto com nada. Agora há ombro → cotovelo → punho → mão, com IK de
//     dois ossos: a mão *vai* ao ponto que `deskmap.js` diz (a tecla que está a ser premida, o rato
//     a deslizar no tapete) e o cotovelo resolve-se sozinho, para o lado de fora.
//
// NOTA DE CUSTO. São 35 avatares. Por isso a cabeça inteira (cara, cabelo, chapéu, barba, óculos)
// é UMA malha fundida com cor por vértice, e o tronco (casaco, camisa, gravata, cinto) é outra. Um
// avatar custa ~8 malhas sentado — menos do que o de 1.9.9 (9), com muito mais desenho.

import * as THREE from 'three';
import { GEO, mergeGeos } from './builders.js';
import {
  KEY_CAP_TOP, MOUSE_TOP, KEY_ROW_HOME, contact as deskContact, toAvatarLocal,
} from './deskmap.js';

/* ---------- materiais partilhados (a cor vem nos vértices) ----------
   Um material por família, para os 35. Se cada avatar tivesse os seus, eram 35 × 4 materiais e 35
   programas compilados — o escritório tem 6 salas e um portátil. */
export const AVATAR_MATS = {
  cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.02 }),
  skin: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 }),
  hair: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.05 }),
  hard: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.30 }),
};

const _c = new THREE.Color();
/** pinta uma geometria com cor por vértice (o `mergeGeos` aceita 3 ou 4 componentes). */
function paint(geo, hex) {
  _c.set(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* ---------- geometria ---------- */
const sphere = (r, ws = 14, hs = 10, phiStart = 0, phiLen = Math.PI * 2, thStart = 0, thLen = Math.PI) =>
  new THREE.SphereGeometry(r, ws, hs, phiStart, phiLen, thStart, thLen);
const capsule = (r, len, cs = 4, rs = 10) => new THREE.CapsuleGeometry(r, len, cs, rs);
const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const ring = (r, tube, seg = 14) => new THREE.TorusGeometry(r, tube, 5, seg);
/** caixa arredondada CENTRADA em (w=x, h=y, d=z). `GEO.box` é (w, d, h) e cresce a partir da base
 *  (0..h em y) — para um avatar, com peças penduradas em pivôs, o centro é o que faz sentido. */
function box(w, h, d, r = 0.03) {
  // `.clone()` não é decoração: `rboxGeo` guarda as caixas numa cache por medidas e devolve a MESMA
  // geometria; transladar o original movia todas as caixas já desenhadas (e os avatares iam
  // crescendo a cada `makePerson`, um em cima do outro, até a folha dos 35 parecer um bolo).
  const g = GEO.box(w, d, h, r).clone();
  g.translate(0, -h / 2, 0);
  return g;
}

/** põe uma geometria num sítio (translação + rotações), devolvendo-a. */
function at(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

/* ---------- o cabelo: 15 estilos × 4 variantes ----------
   Tudo em coordenadas do grupo da cabeça (`headG`), com o centro da cabeça em (0, C, 0). */
function hairGeos(look, S) {
  const C = 0.25 * S;
  const v = look.variant | 0;
  const side = v % 2 ? 1 : -1;                    // a risca muda de lado com a variante
  const len = 1 + v * 0.16;                       // comprimentos (para os estilos compridos)
  const out = [];
  const R = (0.528 + v * 0.008) * S;
  const hat = look.hat && look.hat !== 'none';

  // A coroa cobre o alto da cabeça. NÃO pode descer até aos olhos: o avatar passou a ter cara, e
  // uma calote de 0.55π tapava-lhe a cara toda (era o que acontecia antes de existir cara).
  const cap = (theta, r = R, opts = {}) => {
    const { y = C, z = 0, sx = 1, sy = 1, sz = 1 } = opts;
    const g = sphere(r, 18, 10, 0, Math.PI * 2, 0, theta);
    g.scale(sx, sy, sz); g.translate(0, y, z);
    out.push(g); return g;
  };
  // A massa de trás: uma casca que dá a volta às costas e aos lados, com a frente aberta (a cara).
  // φ: 0 = -x, π/2 = +z (frente), π = +x, 3π/2 = -z (nuca).
  const back = (fromTh, toTh, r = R, phiLen = Math.PI * 1.42, opts = {}) => {
    const { y = C, z = 0, sx = 1, sy = 1, sz = 1 } = opts;
    const g = sphere(r, 18, 10, Math.PI * 0.79, phiLen, fromTh, toTh - fromTh);
    g.scale(sx, sy, sz); g.translate(0, y, z);
    out.push(g); return g;
  };
  const blob = (r, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const g = sphere(r, 10, 8); g.scale(sx, sy, sz); g.translate(x, y, z);
    out.push(g); return g;
  };
  const slab = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const g = box(w, h, d, Math.min(w, h, d) * 0.42);
    at(g, x, y, z, rx, ry, rz); out.push(g); return g;
  };

  switch (look.style) {
    case 'short':
      cap(Math.PI * 0.40 + v * 0.02);
      back(Math.PI * 0.34, Math.PI * 0.74);
      slab(0.50 * S, 0.13 * S, 0.18 * S, side * 0.05 * S, C + 0.34 * S, 0.30 * S, -0.45);
      break;
    case 'crop':
      cap(Math.PI * 0.36, R - 0.01 * S);
      back(Math.PI * 0.30, Math.PI * 0.62);
      slab(0.44 * S, 0.09 * S, 0.13 * S, side * 0.06 * S, C + 0.38 * S, 0.26 * S, -0.55);
      break;
    case 'sidepart':
      cap(Math.PI * 0.40);
      back(Math.PI * 0.34, Math.PI * 0.80);
      blob(0.17 * S, side * 0.18 * S, C + 0.30 * S, 0.24 * S, 1.5, 0.72, 1.0);
      slab(0.025 * S, 0.26 * S, 0.22 * S, side * 0.11 * S, C + 0.34 * S, 0.27 * S, -0.3);
      break;
    case 'quiff':
      cap(Math.PI * 0.36);
      back(Math.PI * 0.32, Math.PI * 0.72);
      blob(0.19 * S, 0, C + 0.44 * S, 0.10 * S, 1.5, 0.80, 0.95);
      blob(0.12 * S, side * 0.15 * S, C + 0.50 * S, 0.26 * S, 1.2, 0.7, 0.9);
      break;
    case 'slick':
      cap(Math.PI * 0.44);
      back(Math.PI * 0.36, Math.PI * 0.86, R, Math.PI * 1.5);
      blob(0.28 * S, 0, C + 0.08 * S, -0.22 * S, 1.02, 1.05, 1.05);
      slab(0.60 * S, 0.035 * S, 0.26 * S, 0, C + 0.40 * S, -0.12 * S, -0.2);
      break;
    case 'curly':
      cap(Math.PI * 0.34, R - 0.005 * S);
      back(Math.PI * 0.30, Math.PI * 0.80);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 1.6 + 0.6 + v * 0.4;
        blob((0.10 + (i % 3) * 0.022) * S, Math.cos(a) * 0.42 * S * len, C + 0.16 * S + Math.sin(a) * 0.14 * S, Math.sin(a) * 0.36 * S - 0.02 * S);
      }
      break;
    case 'afro':
      back(Math.PI * 0.18, Math.PI * 0.98, 0.55 * S * len, Math.PI * 1.5);
      blob(0.30 * S, 0, C + 0.26 * S, -0.20 * S, 1.15, 0.9, 1.0);
      break;
    case 'bald':
      // careca: só um resto muito baixo nas costas, para o crânio não ficar liso de plástico
      back(Math.PI * 0.62, Math.PI * 0.76, R - 0.015 * S);
      break;
    case 'ponytail':
      cap(Math.PI * 0.40);
      back(Math.PI * 0.34, Math.PI * 0.82);
      at(ring(0.13 * S, 0.028 * S), 0, C + 0.02 * S, -0.46 * S, Math.PI * 0.5);
      blob(0.14 * S, 0, C - 0.10 * S, -0.50 * S, 1, 1.1, 1);
      blob(0.12 * S, 0, C - 0.26 * S * len, -0.52 * S, 1, 1.15 * len, 1);
      blob(0.085 * S, 0, C - 0.42 * S * len, -0.50 * S, 1, 1.1 * len, 1);
      break;
    case 'bun':
      cap(Math.PI * 0.40);
      back(Math.PI * 0.34, Math.PI * 0.82);
      blob(0.19 * S * len, 0, C + 0.30 * S, -0.40 * S);
      at(ring(0.12 * S, 0.026 * S), 0, C + 0.14 * S, -0.42 * S, Math.PI * 0.5);
      break;
    case 'bob':
      cap(Math.PI * 0.40);
      back(Math.PI * 0.30, Math.PI * 1.02);
      slab(0.20 * S, 0.52 * S * len, 0.34 * S, 0.40 * S, C - 0.02 * S, -0.02 * S);
      slab(0.20 * S, 0.52 * S * len, 0.34 * S, -0.40 * S, C - 0.02 * S, -0.02 * S);
      slab(0.72 * S, 0.46 * S * len, 0.20 * S, 0, C + 0.02 * S, -0.36 * S);
      break;
    case 'long':
      cap(Math.PI * 0.38);
      back(Math.PI * 0.30, Math.PI * 1.05);
      slab(0.19 * S, 0.92 * S * len, 0.30 * S, side * 0.40 * S, C - 0.20 * S, -0.04 * S);
      slab(0.19 * S, 0.92 * S * len, 0.30 * S, -side * 0.40 * S, C - 0.20 * S, -0.04 * S);
      slab(0.66 * S, 0.96 * S * len, 0.18 * S, 0, C - 0.16 * S, -0.38 * S);
      break;
    case 'wavy':
      cap(Math.PI * 0.38);
      back(Math.PI * 0.32, Math.PI * 1.00);
      blob(0.21 * S, side * 0.38 * S, C - 0.02 * S, 0.02 * S, 0.95, 1.55 * len, 0.95);
      blob(0.21 * S, -side * 0.38 * S, C - 0.02 * S, 0.02 * S, 0.95, 1.55 * len, 0.95);
      blob(0.15 * S, side * 0.10 * S, C + 0.30 * S, 0.34 * S, 1.5, 0.8, 1.0);
      break;
    case 'pixie':
      cap(Math.PI * 0.36, R - 0.005 * S);
      back(Math.PI * 0.30, Math.PI * 0.68);
      at(GEO.box(0.22 * S, 0.10 * S, 0.26 * S, 0.03).clone(), side * 0.18 * S, C + 0.36 * S, 0.30 * S, -0.85, 0, side * 0.5);
      slab(0.08 * S, 0.24 * S, 0.16 * S, side * 0.40 * S, C + 0.10 * S, 0.20 * S);
      break;
    case 'braids':
      cap(Math.PI * 0.38);
      back(Math.PI * 0.32, Math.PI * 0.86);
      for (let j = 0; j < 2; j++) {
        const sx = (j ? 1 : -1) * 0.34 * S;
        for (let k = 0; k < 5; k++) {
          const t = k / 4;
          blob((0.085 - k * 0.008) * S, sx + Math.sin(t * 3 + j) * 0.03 * S, C - 0.06 * S - t * 0.62 * S * len, -0.26 * S + t * 0.10 * S);
        }
      }
      break;
    default:
      cap(Math.PI * 0.40);
      back(Math.PI * 0.32, Math.PI * 0.76);
  }
  // com chapéu, o cabelo de cima encolhe (senão atravessa o feltro)
  if (hat) out.forEach((g) => { g.scale(0.97, 0.97, 0.97); });
  return out;
}

/* ---------- chapéus ---------- */
function hatGeos(look, S) {
  const C = 0.25 * S;
  const h = look.hatColor;
  const dark = mixHex(look.hatColor, '#101114', 0.42);   // a fita, mais funda que o feltro
  const out = [];
  const add = (g, hex) => { out.push(paint(g, hex)); };
  switch (look.hat) {
    case 'cap':
      add(at(sphere(0.54 * S, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.40), 0, C + 0.02 * S, 0), h);
      add(at(box(0.62 * S, 0.05 * S, 0.36 * S, 0.05), 0, C + 0.11 * S, 0.42 * S, -0.12), dark);
      add(at(sphere(0.055 * S), 0, C + 0.42 * S, 0), mixHex(look.hatColor, '#F2EFE6', 0.35));
      break;
    case 'fedora':
      add(at(cyl(0.70 * S, 0.70 * S, 0.045 * S, 20), 0, C + 0.16 * S, 0), h);
      add(at(cyl(0.40 * S, 0.44 * S, 0.40 * S, 16), 0, C + 0.38 * S, 0), h);
      add(at(cyl(0.445 * S, 0.445 * S, 0.09 * S, 16), 0, C + 0.24 * S, 0), dark);
      break;
    case 'beret': {
      const b = sphere(0.48 * S, 16, 8);
      b.scale(1.12, 0.52, 1.12);                       // primeiro achata-se, depois põe-se
      add(at(b, 0.06 * S, C + 0.34 * S, -0.02 * S), h);
      add(at(sphere(0.05 * S), 0.06 * S, C + 0.58 * S, -0.02 * S), dark);
      break;
    }
      break;
    case 'beanie':
      add(at(sphere(0.54 * S, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.44), 0, C + 0.04 * S, 0), h);
      add(at(ring(0.49 * S, 0.07 * S, 18), 0, C + 0.13 * S, 0, Math.PI / 2), dark);
      add(at(sphere(0.10 * S), 0, C + 0.50 * S, 0), mixHex(look.hatColor, '#F2EFE6', 0.45));
      break;
    default: return [];
  }
  return out;
}

/* ---------- barbas e óculos ---------- */
function faceExtras(look, S, head) {
  const C = 0.25 * S;
  const out = [];
  const add = (g, hex) => out.push(paint(g, hex));
  switch (look.beard) {
    // barbas: ficam ABAIXO da boca. A primeira versão era um elipsóide centrado na cara toda e
    // engolia os lábios (parecia dentes); agora é uma mancha de queixo, e o bigode é peça à parte.
    case 'stubble': {
      const b = sphere(0.40 * S, 12, 8);
      b.scale(0.94, 0.40, 0.80);
      add(at(b, 0, C - 0.30 * S, 0.10 * S), mixHex(look.hair, look.skin, 0.55));
      break;
    }
    case 'beard': {
      const b = sphere(0.42 * S, 14, 9);
      b.scale(0.98, 0.46, 0.88);
      add(at(b, 0, C - 0.30 * S, 0.09 * S), look.hair);
      add(at(box(0.30 * S, 0.06 * S, 0.07 * S, 0.03), 0, C - 0.095 * S, 0.425 * S), look.hair); // bigode
      break;
    }
    case 'moustache':
      add(at(box(0.28 * S, 0.07 * S, 0.08 * S, 0.03), 0, C - 0.045 * S, 0.425 * S), look.hair);
      break;
    default: break;
  }
  if (look.glasses) {
    const gx = 0.175 * S, gy = C + 0.06 * S, gz = 0.465 * S;
    add(at(ring(0.115 * S, 0.016 * S, 12), -gx, gy, gz), look.glasses);
    add(at(ring(0.115 * S, 0.016 * S, 12), gx, gy, gz), look.glasses);
    add(at(box(0.09 * S, 0.018 * S, 0.02 * S, 0.008), 0, gy, gz), look.glasses);
    add(at(box(0.24 * S, 0.018 * S, 0.02 * S, 0.008), -gx - 0.16 * S, gy, gz - 0.06 * S, 0, 0.5), look.glasses);
    add(at(box(0.24 * S, 0.018 * S, 0.02 * S, 0.008), gx + 0.16 * S, gy, gz - 0.06 * S, 0, -0.5), look.glasses);
  }
  return out;
}

/** mistura de duas cores hex (local — a palette já tem `mix`, mas aqui evita um import extra). */
function mixHex(a, b, k) {
  _c.set(a); const A = { r: _c.r, g: _c.g, b: _c.b };
  _c.set(b); const B = { r: _c.r, g: _c.g, b: _c.b };
  return new THREE.Color(A.r + (B.r - A.r) * k, A.g + (B.g - A.g) * k, A.b + (B.b - A.b) * k);
}

/* ---------- o tronco: casaco, camisa, gravata, cinto ---------- */
function torsoGeos(look, S) {
  const out = [];
  const side2 = look.variant % 2 ? 1 : -1;
  const add = (g, hex) => out.push(paint(g, hex));
  const suit = look.suit, dark = look.suitDark;

  // casaco — uma cápsula achatada: do ombro à anca, e não até aos pés.
  // 27 out 2026: tinha `0.85S` de comprimento e descia a y=0.05 — o tronco chegava aos tornozelos e
  // lia-se como uma saia. Agora vai da anca (1.0S) ao ombro (2.5S), que é onde um tronco acaba.
  // um tronco é mais estreito na cintura do que nos ombros: um cilindro afunilado com duas calotes
  add(at(cyl(0.40 * S, 0.32 * S, 0.96 * S, 16), 0, 0.76 * S, 0), suit);
  add(at(sphere(0.40 * S, 16, 10), 0, 1.24 * S, 0), suit);
  add(at(sphere(0.32 * S, 16, 10), 0, 0.28 * S, 0), suit);
  // ombros: duas calotes dão a linha do casaco (à altura do pescoço, não da cintura)
  add(at(sphere(0.15 * S), -0.41 * S, 1.41 * S, 0), suit);
  add(at(sphere(0.15 * S), 0.41 * S, 1.41 * S, 0), suit);
  // gola e costas
  add(at(ring(0.175 * S, 0.05 * S, 16), 0, 1.50 * S, 0, Math.PI / 2), dark);
  add(at(cyl(0.155 * S, 0.175 * S, 0.40 * S, 12), 0, 1.62 * S, 0), look.skin);   // o pescoço
  add(at(box(0.03 * S, 0.78 * S, 0.02 * S, 0.012), 0, 0.82 * S, -0.318 * S), dark);      // a costura central
  add(at(box(0.30 * S, 0.20 * S, 0.02 * S, 0.01), 0, 0.30 * S, -0.30 * S), dark);        // a abertura de baixo
  // camisa à frente (o V do casaco aberto)
  add(at(box(0.24 * S, 0.44 * S, 0.09 * S, 0.02), 0, 1.22 * S, 0.295 * S), look.shirt);
  // lapelas
  add(at(box(0.13 * S, 0.54 * S, 0.07 * S, 0.02), -0.13 * S, 1.24 * S, 0.322 * S, 0, 0, 0.20), dark);
  add(at(box(0.13 * S, 0.54 * S, 0.07 * S, 0.02), 0.13 * S, 1.24 * S, 0.322 * S, 0, 0, -0.20), dark);
  if (look.female) {
    // lenço/blusa: um pano curto em vez de gravata
    add(at(box(0.09 * S, 0.24 * S, 0.06 * S, 0.02), side2 * 0.025 * S, 1.31 * S, 0.352 * S, 0, 0, 0.10), look.tie);
    add(at(sphere(0.05 * S, 8, 6), 0, 1.44 * S, 0.352 * S), look.tie);
  } else {
    // gravata e nó
    add(at(box(0.105 * S, 0.12 * S, 0.07 * S, 0.02), 0, 1.42 * S, 0.358 * S), look.tie);
    add(at(box(0.115 * S, 0.40 * S, 0.065 * S, 0.02), 0, 1.22 * S, 0.352 * S), look.tie);
  }
  // cinto: achatado em z, encostado ao casaco (um aro redondo flutuava à volta do corpo)
  const belt = ring(0.398 * S, 0.024 * S, 20);
  belt.rotateX(Math.PI / 2); belt.scale(1, 1, 0.74); belt.translate(0, 0.22 * S, 0);
  add(belt, look.shoes);
  // saia (vestido) ou calças: as pernas são malhas à parte
  if (look.outfit === 'dress') {
    add(at(cyl(0.40 * S, 0.50 * S, 0.62 * S, 18), 0, -0.24 * S, 0), suit);
    add(at(ring(0.50 * S, 0.02 * S, 18), 0, -0.55 * S, 0, Math.PI / 2), dark);
  }
  return out;
}

/* ---------- a cabeça: cara + cabelo + chapéu + barba + óculos ---------- */
function headGeos(look, S) {
  const C = 0.25 * S;
  const out = [];
  const add = (g, hex) => out.push(paint(g, hex));
  // pescoço
  add(at(cyl(0.17 * S, 0.19 * S, 0.26 * S, 12), 0, 0.02 * S, 0), look.skin);
  // cabeça (levemente oval)
  const skull = sphere(0.5 * S, 20, 14);
  skull.scale(0.95, 1.0, 0.93);
  add(at(skull, 0, C, 0), look.skin);
  // orelhas
  add(at(sphere(0.075 * S, 8, 6), -0.47 * S, C + 0.02 * S, 0), look.skin);
  add(at(sphere(0.075 * S, 8, 6), 0.47 * S, C + 0.02 * S, 0), look.skin);
  // olhos, sobrancelhas, nariz, boca
  // a superfície do crânio (achatado em z a 0.93) fica a z≈0.46; as peças têm de a atravessar
  add(at(sphere(0.048 * S, 10, 8), -0.17 * S, C + 0.06 * S, 0.445 * S), '#20191A');
  add(at(sphere(0.048 * S, 10, 8), 0.17 * S, C + 0.06 * S, 0.445 * S), '#20191A');
  add(at(box(0.13 * S, 0.026 * S, 0.03 * S, 0.01), -0.17 * S, C + 0.15 * S, 0.418 * S, 0, 0, 0.12), look.hair);
  add(at(box(0.13 * S, 0.026 * S, 0.03 * S, 0.01), 0.17 * S, C + 0.15 * S, 0.418 * S, 0, 0, -0.12), look.hair);
  add(at(cyl(0.006 * S, 0.06 * S, 0.13 * S, 8), 0, C - 0.045 * S, 0.452 * S, Math.PI / 2), look.skin);
  add(at(box(0.16 * S, 0.032 * S, 0.03 * S, 0.012), 0, C - 0.165 * S, 0.418 * S), look.lip);

  for (const g of hairGeos(look, S)) add(g, look.hair);
  for (const g of hatGeos(look, S)) out.push(g);       // já pintados
  for (const g of faceExtras(look, S)) out.push(g);

  return out;
}

/* ---------- a mão: palma, quatro dedos, polegar ----------
   Modelada com os dedos ao longo de -y e a palma virada para +z. O `poseWork` roda-a para o sítio
   certo (o eixo -y aponta para a tecla, +z é a palma). */
/** altura do pivô do ombro, no referencial da anca (`hips`, a 1.0S). Um número, dois usos:
 *  a geometria do braço e o IK — se divergirem, a mão erra o alvo e o teste apanha. */
const SH_Y = 1.42;
/** comprimentos do braço (em unidades de `S`): ombro→cotovelo e cotovelo→punho. O IK usa ESTES
 *  números; antes usava 0.60/0.55 enquanto a geometria media 0.54/0.50 — a mão ficava 8 cm
 *  aquém do alvo e o erro só se via num teste que comparasse a ponta do dedo com a tecla. */
const ARM_A = 0.54, ARM_B = 0.50;

export const HAND_TIP = { y: -0.238, z: 0.02 };   // ponta do dedo médio, no referencial da mão

function handMesh(S, skin) {
  const geos = [];
  const add = (g) => geos.push(paint(g, skin));
  add(at(box(0.15 * S, 0.175 * S, 0.062 * S, 0.048), 0, -0.052 * S, 0));                 // palma
  for (let i = 0; i < 4; i++) {
    const x = (-0.050 + i * 0.033) * S;
    const len = (i === 0 || i === 3 ? 0.070 : 0.085) * S;
    add(at(capsule(0.0185 * S, len, 3, 6), x, (-0.152 - len / 2 + 0.02) * S, 0.018 * S));  // dedos
  }
  const thumb = capsule(0.021 * S, 0.078 * S, 3, 6);
  add(at(thumb, 0.083 * S, -0.085 * S, 0.030 * S, -0.30, 0, -0.95));
  const m = new THREE.Mesh(mergeGeos(geos), AVATAR_MATS.skin);
  m.castShadow = true; m.receiveShadow = true;
  geos.forEach((g) => g.dispose());
  return m;
}

/* ---------- a pessoa ---------- */
export function makePerson(opts = {}) {
  const look = opts.look || opts;                    // compatível com a chamada antiga
  const S = look.lead ? 1.12 : 1;
  const g = new THREE.Group();

  // pernas (visíveis de pé; escondidas ao sentar)
  const legs = new THREE.Group();
  const legGeo = capsule(0.16 * S, 0.75 * S, 3, 8);
  paint(legGeo, look.trousers || '#3E4048');
  const legL = new THREE.Mesh(legGeo.clone(), AVATAR_MATS.cloth);
  const legR = new THREE.Mesh(legGeo, AVATAR_MATS.cloth);
  legL.position.set(-0.2 * S, 0.6 * S, 0); legR.position.set(0.2 * S, 0.6 * S, 0);
  legL.castShadow = legR.castShadow = true;
  legs.add(legL, legR); g.add(legs);

  // anca (pivô da inclinação do tronco)
  const hips = new THREE.Group(); hips.position.y = 1.0 * S; g.add(hips);
  const chest = new THREE.Group(); hips.add(chest);

  const tg = torsoGeos(look, S);
  const torso = new THREE.Mesh(mergeGeos(tg), AVATAR_MATS.cloth);
  torso.castShadow = true; torso.receiveShadow = true;
  tg.forEach((x) => x.dispose());
  chest.add(torso);

  // cabeça
  const headG = new THREE.Group();
  headG.position.set(0, 1.86 * S, 0);   // com pescoço: o crânio deixa de nascer dentro do casaco
  const hg = headGeos(look, S);
  const head = new THREE.Mesh(mergeGeos(hg), AVATAR_MATS.skin);
  head.castShadow = true; head.receiveShadow = true;
  hg.forEach((x) => x.dispose());
  headG.add(head);
  chest.add(headG);

  // braços: ombro → cotovelo → punho → mão
  const arm = (sign) => {
    const sh = new THREE.Group();
    sh.position.set(sign * 0.5 * S, SH_Y * S, 0);
    const upperG = capsule(0.155 * S, 0.32 * S, 4, 10); paint(upperG, look.suit);
    const upper = new THREE.Mesh(upperG, AVATAR_MATS.cloth);
    upper.position.y = -0.27 * S; upper.castShadow = true;
    sh.add(upper);
    const elbow = new THREE.Group(); elbow.position.y = -ARM_A * S; sh.add(elbow);
    const foreG = capsule(0.135 * S, 0.28 * S, 4, 10); paint(foreG, look.suit);
    const fore = new THREE.Mesh(foreG, AVATAR_MATS.cloth);
    fore.position.y = -0.25 * S; fore.castShadow = true;   // cobre metade do antebraço (0.28S)
    elbow.add(fore);
    // punho da camisa
    const cuffG = cyl(0.132 * S, 0.122 * S, 0.045 * S, 10); paint(cuffG, look.shirt);
    elbow.add(new THREE.Mesh(at(cuffG, 0, -0.455 * S, 0), AVATAR_MATS.cloth));
    const hand = new THREE.Group(); hand.position.y = -ARM_B * S; elbow.add(hand);
    hand.add(handMesh(S, look.skin));
    chest.add(sh);
    return { sh, elbow, hand, upper, fore };
  };
  const armL = arm(1);      // lado +x do avatar = lado do teclado (o rato está no -x)
  const armR = arm(-1);     // lado -x = lado do rato

  g.userData = {
    look, S, legs, legL, legR, hips, chest, torso, headG, head,
    armKeys: armL, armMouse: armR,
    // nomes antigos (alguns sítios ainda os procuram)
    shL: armR.sh, shR: armL.sh,
    A: ARM_A * S, B: ARM_B * S, shY: SH_Y * S,
    cur: null, phase: 0,
  };
  return g;
}

/* ---------- IK de dois ossos ---------- */
const DOWN = new THREE.Vector3(0, -1, 0);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _a3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler();

/**
 * Resolve ombro→cotovelo→punho para um alvo. Devolve as rotações locais do ombro e do cotovelo
 * (o cotovelo é relativo ao ombro) e a distância que ficou por alcançar (0 = chegou).
 * `pole` é a direcção para onde o cotovelo deve fugir — o lado de fora do corpo.
 */
export function solveArm(shoulder, target, a, b, pole, out = {}) {
  const toT = _v2.copy(target).sub(shoulder);
  const dist0 = toT.length();
  const dist = Math.min(Math.max(dist0, Math.abs(a - b) + 0.001), a + b - 0.001);
  const dir = toT.normalize();
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const ang = Math.acos(Math.min(1, Math.max(-1, cosA)));
  const axis = _v3.crossVectors(dir, pole);
  if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
  axis.normalize();
  const e1 = _v.copy(dir).applyAxisAngle(axis, ang);
  const e2 = _v.copy(dir).applyAxisAngle(axis, -ang);
  const elbowDir = e1.dot(pole) >= e2.dot(pole) ? e1 : e2;
  const elbow = shoulder.clone().addScaledVector(elbowDir, a);
  const end = shoulder.clone().addScaledVector(dir, dist);
  const foreDir = end.sub(elbow).normalize();
  const qUp = new THREE.Quaternion().setFromUnitVectors(DOWN, elbowDir.clone().normalize());
  // a direcção do antebraço no referencial do ombro
  const foreLocal = foreDir.clone().applyQuaternion(qUp.clone().invert()).normalize();
  out.qShoulder = qUp;
  out.qElbow = new THREE.Quaternion().setFromUnitVectors(DOWN, foreLocal);
  out.elbow = elbow;
  out.foreDir = foreLocal;
  out.short = Math.max(0, dist0 - dist);
  return out;
}

/** quaternião que leva o -y local a `dir`, com o +z local a apontar para `palmN`. */
function handQuat(dir, palmN, out = new THREE.Quaternion()) {
  const y = _v.copy(dir).normalize().multiplyScalar(-1);   // +y local sobe ao longo do braço
  const z = _v2.copy(palmN).addScaledVector(y, -palmN.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  z.normalize();
  const x = _v3.crossVectors(y, z).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  return out.setFromRotationMatrix(m);
}

/* ---------- poses ---------- */
const HAND_DIR = {
  type: new THREE.Vector3(0, -0.70, 0.71).normalize(),
  mouse: new THREE.Vector3(0, -0.55, 0.83).normalize(),
};
// a palma é +z local; para os dedos a apontar para `d`, a palma virada para baixo e para trás
const palmOf = (d) => new THREE.Vector3(0, -d.z, d.y).normalize();

/**
 * A pose de trabalho sentado. `mode` decide o que as mãos fazem:
 *   'type' / 'mouse' → IK até às teclas / ao rato (via `contact` de deskmap.js)
 *   'read' | 'glance' | 'sip' | 'phone' | 'spin' | 'slump' → pose de ombro, sem contacto
 *   'stretch' | 'wave' | 'cheer' → de pé, braços no ar
 */
export function poseWork(g, mode, t, dt, con) {
  const u = g.userData;
  u.legs.visible = false;
  const ikMode = mode === 'type' || mode === 'mouse';
  const tg = {
    shLx: -1.05, shLz: 0.25, shRx: -1.05, shRz: -0.25,
    elbL: 0.15, elbR: 0.15,
    headRx: 0.04, headRy: 0, torsoRx: 0, chestRy: 0,
    posY: 0.55, standK: 0, ikK: 0, ikM: 0,
  };
  switch (mode) {
    case 'type':
      tg.ikK = 1; tg.ikM = 1; tg.torsoRx = 0.10;
      tg.headRx = 0.10 + Math.sin(t / 520) * 0.03;
      break;
    case 'mouse':
      tg.ikK = 1; tg.ikM = 1; tg.torsoRx = 0.22; tg.chestRy = -0.05;
      tg.headRx = 0.08;
      break;
    case 'read':
      tg.shLx = -0.30; tg.shLz = -0.35; tg.shRx = -0.30; tg.shRz = 0.35;
      tg.elbL = 0.55; tg.elbR = 0.55;
      tg.torsoRx = -0.10;
      tg.headRx = 0.16 + Math.sin(t / 650) * 0.05;
      break;
    case 'phone':
      tg.shRx = -2.30; tg.shRz = 0.55; tg.shLx = -0.40; tg.shLz = -0.20;
      tg.elbR = 0.05; tg.elbL = 0.45;
      tg.headRy = -0.18; tg.headRx = 0.05 + (Math.sin(t / 330) > 0.55 ? 0.09 : 0);
      break;
    case 'glance':
      tg.shLx = -0.90; tg.shRx = -0.90; tg.elbL = 0.35; tg.elbR = 0.35;
      tg.headRy = u.glanceDir || 0.55;
      break;
    case 'sip':
      tg.shRx = -2.00; tg.shRz = 0.50; tg.shLx = -0.60; tg.elbR = 0.10; tg.elbL = 0.30;
      tg.headRx = -0.12;
      break;
    case 'spin':
      tg.shLx = -0.70; tg.shLz = -0.55; tg.shRx = -0.70; tg.shRz = 0.55;
      tg.elbL = 0.25; tg.elbR = 0.25; tg.headRx = -0.05;
      break;
    case 'stretch':
      tg.standK = 1; tg.posY = 0.12;
      tg.shLx = -2.60; tg.shLz = -0.75; tg.shRx = -2.60; tg.shRz = 0.75;
      tg.elbL = 0.05; tg.elbR = 0.05; tg.headRx = -0.15; tg.torsoRx = -0.05;
      break;
    case 'wave':
      tg.standK = 1; tg.posY = 0.12;
      tg.shRx = -2.60; tg.shRz = 0.55 + Math.sin(t / 150) * 0.40;
      tg.shLx = -0.30; tg.shLz = -0.25; tg.elbR = 0.35; tg.elbL = 0.20;
      tg.headRx = -0.05;
      break;
    case 'cheer':
      tg.standK = 1;
      tg.posY = 0.12 + Math.abs(Math.sin(t / 150)) * 0.16;
      tg.shLx = -2.70; tg.shLz = -0.85 + Math.sin(t / 190) * 0.12;
      tg.shRx = -2.70; tg.shRz = 0.85 - Math.sin(t / 190) * 0.12;
      tg.elbL = 0.10; tg.elbR = 0.10; tg.headRx = -0.20;
      break;
    case 'slump':
      tg.shLx = -0.20; tg.shLz = -0.30; tg.shRx = -0.20; tg.shRz = 0.30;
      tg.elbL = 0.35; tg.elbR = 0.35; tg.headRx = 0.45; tg.posY = 0.50;
      break;
    default: break;
  }

  if (!u.cur) u.cur = { ...tg };
  const k = 1 - Math.exp(-(dt || 0.016) * 7);
  for (const key in tg) u.cur[key] += (tg[key] - u.cur[key]) * k;
  const c = u.cur;

  // o tronco inclina-se a partir da anca (e leva ombros e cabeça com ele)
  u.chest.rotation.x = c.torsoRx;
  u.chest.rotation.y = c.chestRy;
  u.headG.rotation.x = c.headRx;
  u.headG.rotation.y = c.headRy;
  u.legs.visible = c.standK > 0.4;
  // a respiração sobe e desce 2 cm — mas com as mãos em contacto a respiração pára no tronco, senão
  // os dedos deslizavam pelas teclas (e um teste apanha isso)
  g.position.y = c.posY + (ikMode ? 0 : Math.sin(t / 460) * 0.02);

  // ---- braços: pose de ombro, e por cima o IK (blend) ----
  const con2 = ikMode ? (con || deskContact(t, u.phase || 0, mode)) : null;
  const chestQ = new THREE.Quaternion().setFromEuler(_e.set(c.torsoRx, c.chestRy, 0));
  const hipsPos = new THREE.Vector3(0, 1.0 * u.S, 0);

  const doArm = (A, shSign, shX, shZ, elb, ikWeight, target) => {
    // 1. pose de ombro/cotovelo (a de sempre)
    const qShE = new THREE.Quaternion().setFromEuler(new THREE.Euler(shX, 0, shZ));
    const qElE = new THREE.Quaternion().setFromEuler(new THREE.Euler(elb, 0, 0));
    let qSh = qShE, qEl = qElE, qHa = _q2.identity();

    if (ikWeight > 0.002 && target) {
      // 2. ombro no mundo do avatar (já com a inclinação do tronco)
      const shLocal = _a1.set(shSign * 0.5 * u.S, u.shY, 0).applyQuaternion(chestQ).add(hipsPos);
      const wrist = target.wrist;
      const pole = _a2.set(shSign * 0.92, -0.42, -0.34).normalize();
      const sol = solveArm(shLocal, wrist, u.A, u.B, pole);
      A.diag = { short: sol.short, dist: shLocal.distanceTo(wrist), reach: u.A + u.B };
      // 3. do referencial do avatar para o do ombro (o pai é o tronco inclinado)
      const qShIK = new THREE.Quaternion().copy(chestQ).invert().multiply(sol.qShoulder);
      const qShMix = qShE.clone().slerp(qShIK, ikWeight);
      const shWorld = chestQ.clone().multiply(qShMix);
      // o antebraço é relativo ao ombro *já misturado*, e o ombro vive dentro do tronco inclinado
      const qElIK = shWorld.clone().invert().multiply(sol.qShoulder).multiply(sol.qElbow);
      const qElMix = qElE.clone().slerp(qElIK, ikWeight);
      const qForeWorld = shWorld.clone().multiply(qElMix);
      // a mão herda a direcção DO PRÓPRIO alvo: o pulso foi calculado com ela, e usar a do teclado
      // para a mão do rato punha os dedos 15 cm ao lado do rato (foi um bug apanhado pelo teste)
      const qHandWorld = handQuat(target.dir, target.palm);
      const qHaIK = qForeWorld.invert().multiply(qHandWorld);
      qSh = qShMix; qEl = qElMix; qHa = qHaIK.slerp(_q3.identity(), 1 - ikWeight);
    }
    if (!A.diag) A.diag = { short: 0, dist: 0, reach: u.A + u.B };
    if (ikWeight <= 0.002) A.diag = { short: 0, dist: 0, reach: u.A + u.B };
    A.sh.quaternion.copy(qSh);
    A.elbow.quaternion.copy(qEl);
    A.hand.quaternion.copy(qHa);
  };

  // o braço do teclado e o do rato: cada um com o seu alvo
  const mkTarget = (pt, dir) => {
    if (!pt) return null;
    const L = toAvatarLocal(pt);
    const S = u.S;
    const back = new THREE.Vector3(0, HAND_TIP.y * S, HAND_TIP.z * S).applyQuaternion(handQuat(dir, palmOf(dir)));
    return {
      wrist: new THREE.Vector3(L.x, L.y, L.z).sub(back),
      dir, palm: palmOf(dir),
    };
  };

  let tKeys = null, tMouse = null;
  if (con2) {
    tKeys = mkTarget(con2.keys, HAND_DIR.type);
    if (con2.mouse) tMouse = mkTarget(con2.mouse, HAND_DIR.mouse);
    else if (con2.second) tMouse = mkTarget(con2.second, HAND_DIR.type);
  }

  doArm(u.armKeys, 1, c.shRx, c.shRz, c.elbR, c.ikK, tKeys);
  doArm(u.armMouse, -1, c.shLx, c.shLz, c.elbL, c.ikM, tMouse);

  // diagnóstico (testes e depuração): onde os dedos ficaram
  u.contact = con2;
  u.tip = (which) => {
    const A = which === 'mouse' ? u.armMouse : u.armKeys;
    return A.hand.localToWorld(new THREE.Vector3(0, HAND_TIP.y * u.S, HAND_TIP.z * u.S));
  };
  return u.cur;
}

/** De pé e a andar — sem IK, e a cabeça a olhar para a frente. */
export function posePerson(g, pose, t = 0) {
  const u = g.userData;
  u.cur = null;
  u.chest.rotation.set(0, 0, 0);
  u.headG.rotation.set(0, 0, 0);
  u.legs.visible = true;
  const setArm = (A, shX, shZ, elb) => {
    A.sh.rotation.set(shX, 0, shZ);
    A.elbow.rotation.set(elb, 0, 0);
    A.hand.rotation.set(0, 0, 0);
  };
  if (pose === 'walk') {
    const sw = Math.sin(t / 110);
    g.position.y = Math.abs(Math.cos(t / 110)) * 0.08;
    u.legL.rotation.x = sw * 0.55; u.legR.rotation.x = -sw * 0.55;
    setArm(u.armKeys, -sw * 0.45, 0.08, 0.25);
    setArm(u.armMouse, sw * 0.45, -0.08, 0.25);
  } else { // stand (reunião)
    g.position.y = 0;
    u.legL.rotation.x = u.legR.rotation.x = 0;
    const sway = Math.sin(t / 500) * 0.05;
    setArm(u.armKeys, -0.15 + sway, 0.15, 0.20);
    setArm(u.armMouse, -0.15 - sway, -0.15, 0.20);
    u.headG.rotation.y = Math.sin(t / 900) * 0.12;   // olha para o outro lado da mesa
  }
}
