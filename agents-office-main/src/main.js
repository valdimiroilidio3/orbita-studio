// Órbita v2 — Three.js isometric office with zoom-driven LOD
// Far: clean pods + agent counts (Image 1 read). Near: diorama with 3D people + holo screens (Image 2 read).
import * as THREE from 'three';
/* 1.40.0 · a luz que acende (pedido: «leds acendendo realmente»). O modelo é
   puro e testado em `src/leds.js`; aqui só se aplicam os números ao `three`. */
import { LUZ, luzDaSala, aproximar } from './leds.js';
/* 1.20.0 · este import vem PRIMEIRO e de propósito: aplica as cores e os agentes
   que o dono configurou (e alarga as salas que precisam) antes de a cena assentar. */
import './escritorio.js';
import { DEPTS, DEPT_KEYS, AGENTS, LAYOUT, officeProblems, stationSpot, deskFront } from './data.js';
import { initA11y } from './a11y.js'; // 26 out 2026: o espelho acessível (teclado e leitor de ecrã)
import { createForgeTerminal } from './forge.js'; // 27 out 2026: o terminal da oficina de ferramentas
import { createLive } from './live.js'; // 26 out 2026: o trabalho real em cada monitor (SSE)
import { roleOf, doesOf } from './agentes.js'; // identidade (nome, função, descrição) — sem conteúdo de exemplo
import { explicarFalha, lerCorpo } from './falhas.js'; // 1.50.0: dizer o que falhou, não culpar a IA
// V7: só o que este ficheiro usa. Saíram sete nomes importados e nunca chamados (TOKENS,
// PLINTH_H, mat, rbox, makeFloorTitle, makeServerRack, makeMeetingTable) — o tipo de sobra que
// faz alguém procurar um título de chão que já não existe.
import {
  makePlinth, makeDesk, makeChair,
  makePlant, makeWalkway, makeWarnSprite, makeRoomWalls, makeRoomDressing, makeMasterHall,
  makeRoomEntrance, DOOR, WALL,
} from './builders.js';
import { glassLayers } from './palette.js';
import { corValida, tomDaParte } from './salas.js';
// 27 out 2026: o avatar saiu dos builders para `src/avatar.js` (35 looks, mãos com IK). O teclado e
// o rato têm mapa próprio (`src/deskmap.js`) para as mãos lhes chegarem a sério.
import { makePerson, posePerson, poseWork } from './avatar.js';
import { createCrew } from './crew.js'; // 28 out 2026: a circulação (chefes ao Cérebro)
/* 28 out 2026 (pedido 36) — ONDE FICA A PORTA. A conta saiu do `main.js` para `src/circulation.js`:
   uma regra só, para as seis salas, provada sem three por `circulation.test.mjs`. */
import { doorPlan } from './circulation.js';
/* 1.53.0 · A CÂMARA (pedido: «arrastar e mover, scroll para os lados, outros ângulos»).
   A conta vive em `src/camera.js` — pura, provada em `camera.test.mjs`. Aqui só se liga ao three:
   o arrasto move o chão, o Alt+arrasto (ou o botão do meio) roda, o scroll horizontal roda e a
   inclinação dá as vistas de cima. O ângulo isométrico da casa continua a ser o de origem. */
import {
  ANGULOS, AEREA, RAD_POR_PIXEL, direcaoDaCamara, rodar, inclinacaoValida,
  gestoDoScroll, gestoDoArrasto, etiquetaDoAngulo, proximoAngulo, INCLINACAO_BASE,
} from './camera.js';
import { lookFor, lookProblems, LOOK_STATS } from './looks.js';
import {
  contact as deskContact, keyCells, nearestKey, mouseAt,
  KEYBOARD, KEY_CAP_TOP, MOUSE, MOUSE_Y,
} from './deskmap.js';

/* ---------- as teclas e o rato: o que responde ao dedo ----------
   27 out 2026. O avatar não é um manequim a oscilar o ombro: a mão vai ao ponto que `deskmap.js`
   calcula, e o posto responde — a tecla sob o dedo afunda, o rato desliza no tapete. Este bloco é
   a metade «mundo» dessa história; a metade «corpo» está em `avatar.js` (IK). */
const KEY_CELLS = keyCells();
const CAP_MID_Y = KEY_CAP_TOP - KEYBOARD.capH / 2;   // o centro da tecla, não o topo
const _capM = new THREE.Matrix4(), _capQ = new THREE.Quaternion();
const _capP = new THREE.Vector3(), _capS = new THREE.Vector3();
function setCap(caps, i, press) {
  const c = KEY_CELLS[i];
  if (!c) return;
  _capP.set(c.x, CAP_MID_Y - 0.013 * press, c.z);
  _capS.set(c.w * 0.86, KEYBOARD.capH, c.d * 0.86);
  _capM.compose(_capP, _capQ, _capS);
  caps.setMatrixAt(i, _capM);
  caps.instanceMatrix.needsUpdate = true;
}

/** Afunda as teclas que os dedos estão a premir e põe o rato no tapete. */
function driveDesk(r, con, t, phase, dt) {
  const wants = [];
  if (con) {
    if (con.keys && con.keys.press > 0.02) wants.push([con.keys.cell, con.keys.press]);
    if (con.second && con.second.press > 0.02) wants.push([con.second.cell, con.second.press]);
  }
  const seen = new Set();
  for (const [i, v] of wants) {
    seen.add(i);
    if (Math.abs(r.press[i] - v) > 0.015) setCap(r.caps, i, v);
    r.press[i] = v;
    r.touched.add(i);
  }
  for (const i of r.touched) {          // as que deixaram de ser premidas voltam ao sítio
    if (seen.has(i)) continue;
    setCap(r.caps, i, 0); r.press[i] = 0; r.touched.delete(i);
  }
  // o rato vai ONDE A MÃO ESTÁ (não ao contrário): `con.mouse` já foi suavizado em `tickSim`, por isso
  // o ponteiro e a palma do avatar nunca se separam. É isto que se vê: uma mão a empurrar o rato.
  if (con && con.mouse) {
    r.mousePos.x = con.mouse.x; r.mousePos.z = con.mouse.z;
    r.mouse.position.set(con.mouse.x, MOUSE_Y, con.mouse.z);
  } else if (con && con.mode === 'type') {
    const m = mouseAt(t, phase);        // sem mão no rato, ele fica quieto onde o deixaram
    r.mousePos.x = m.x * 0.06 + r.mousePos.x * 0.94;
    r.mousePos.z = m.z * 0.06 + r.mousePos.z * 0.94;
  }
}
import { initMcp } from './mcp.js';
import { initComposer, chatBody, metaLine, dividirModelo, agenteDaOrbita, corpoDaOrbita, lerRespostaOrbita, juntarAnexos } from './composer.js'; // 27 out 2026: o conversador (modos, modelo, esforço, anexos, contexto)
import { fmtClock } from './time.js'; // 24 horas, sempre
import { initLeads } from './leads.js'; // V4 (25 out 2026): a pesquisa real da Google
import { initOps } from './ops.js'; // 26 out 2026: a operação a sério — base de dados, aprovações, fila e auditoria
import { initToday } from './today.js'; // 26 out 2026: o ecrã HOJE — decidir, o que aconteceu, o que vem
import { loadConnectors } from './connectors.js';
import { initTasks } from './tasks.js';
/* 1.53.0 · a loja de apps — o vidro que liga as ferramentas a sério. Vive em `src/apps.js`, que é
   DOM puro, para poder ser provada em jsdom (e não precisar do three para abrir). */
import { createApps } from './apps.js';
/* 1.52.4 · o cartão da tarefa diz quem respondeu. Havia aqui um mapa fixo
   `{ sonnet, opus, fable }` e, quando o modelo era um par da IA da Órbita
   (`fornecedor|modelo`), o cartão escrevia «modelo do escritório» — falso: tinha
   corrido a IA escolhida. `modelName()` já conhece os dois mundos (é a mesma
   função que o quadro e as rotinas usam). */
import { modelName } from './models.js';
import { initBrain } from './brain.js';
/* 29 out 2026 · PEDIDO: «configurações reais, tema claro↔escuro, notificações reais, afastar o campo
   de IA e o estado das tarefas, e fechar as janelas no telemóvel». Três módulos, cada um com o seu
   trabalho: o tema (preferência a sério, não uma tecla escondida), os avisos (só do que aconteceu) e
   o painel das configurações (tema + APIs com sonda real + avisos + painéis). */
import { readTheme, writeTheme, resolveTheme } from './theme.js';
import { createNotifier } from './notify.js';
import { createConfig, readPrefs, writePrefs } from './config.js';
let tasks = null; // V3 task boards — initialised after the rail constants exist

/* V7 (26 out 2026): o escritório valida-se primeiro. A lição de 1.9.2 foi essa — um erro pequeno
   num sítio apagou a cena inteira e o sintoma apareceu longe da causa. Se os dados não fizerem
   sentido, fica dito na consola com o nome do problema; o desenho continua (nunca uma tela em
   branco por causa de uma cor mal escrita). `office.test.mjs` exige a lista vazia. */
try {
  // 27 out 2026: os 35 avatares também se validam aqui (penteados distintos, chapéus, mulheres).
  // A validação vive em `looks.js`, que é puro, e não dentro do `data.js` para os dados não
  // passarem a depender do desenho.
  const problemas = officeProblems().concat(lookProblems());
  if (problemas.length) console.error('escritório inconsistente:\n  · ' + problemas.join('\n  · '));
} catch (e) {
  console.error('não foi possível validar o escritório: ' + e.message);
}

/* ---------- renderer / scene / camera ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;

const scene = new THREE.Scene();

const FR = 42; // frustum half-height at zoom 1
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -400, 800);
const ISO = new THREE.Vector3(1, 0.92, 1).normalize();
const CAM_DIST = 220;
// V3.2 overview (AJ, 5 Sep late): every dept card sits ON its own pod, over the wiring. With six
// pods the scene is pulled back to 0.86 and shifted down so the EMAILS and DELIVERY cards can
// float above their back rows instead of being shoved out to the screen edges.
// V3.3: the Task Status panel owns the right ~430px at every zoom, so the overview target slides
// along screen-right by half the panel width — the scene sits centred in what is left.
const OVERVIEW = { base: [-9, 0, -9], zoom: 0.8 }; // (-9,-9) shifts the scene straight DOWN the screen, no sideways drift
const SR_ = new THREE.Vector3(1, 0, -1).normalize();
function overviewPos() {
  const pw = (tasks ? tasks.panelWidth() : 400) + 30;
  const ppw = OVERVIEW.zoom * innerHeight / (2 * FR);
  const sh = (pw / 2) / ppw;
  return [OVERVIEW.base[0] + SR_.x * sh, 0, OVERVIEW.base[2] + SR_.z * sh];
}
const view = {
  target: new THREE.Vector3(...overviewPos()), zoom: OVERVIEW.zoom, arc: 0,
  yaw: 0,                                    // 0 = a isométrica de sempre
  tilt: INCLINACAO_BASE,                     // 0.92 = a altura de sempre
};
let tween = null;
const UPV = new THREE.Vector3(0, 1, 0);
const isoWork = new THREE.Vector3();

function applyCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = -FR * aspect; camera.right = FR * aspect;
  camera.top = FR; camera.bottom = -FR;
  camera.zoom = view.zoom;
  /* 1.53.0: a direcção deixa de ser fixa. `view.yaw` é o ângulo escolhido pelo dono (arrasto com
     Alt, scroll horizontal, botões ou teclas) e `view.arc` continua a ser o balanço do flyTo, que
     entra e sai sozinho — somam-se, para a animação nunca anular o ângulo escolhido. */
  const dir = direcaoDaCamara(view.yaw + view.arc, view.tilt);
  isoWork.set(dir.x, dir.y, dir.z);
  camera.position.copy(view.target).addScaledVector(isoWork, CAM_DIST);
  camera.lookAt(view.target);
  camera.updateProjectionMatrix();
}

// house easing cubic-bezier(0.2, 0.8, 0.2, 1)
function bezier(t) {
  const cx = 3 * 0.2, bx = 3 * (0.2 - 0.2) - cx, ax = 1 - cx - bx;
  const cy = 3 * 0.8, by = 3 * (1 - 0.8) - cy, ay = 1 - cy - by;
  let u = t;
  for (let i = 0; i < 5; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  return ((ay * u + by) * u + cy) * u;
}

function flyTo(targetPos, zoom, dur = 800, opts = {}) {
  tween = {
    t0: performance.now(), dur,
    fromT: view.target.clone(), toT: new THREE.Vector3(...targetPos),
    fromZ: view.zoom, toZ: zoom,
    arc: opts.arc || 0, onDone: opts.onDone,
  };
}
function tickTween(now) {
  if (!tween) return;
  const k = Math.min(1, (now - tween.t0) / tween.dur);
  const e = bezier(k);
  view.target.lerpVectors(tween.fromT, tween.toT, e);
  view.zoom = tween.fromZ + (tween.toZ - tween.fromZ) * e;
  view.arc = Math.sin(e * Math.PI) * tween.arc;
  if (k >= 1) {
    const cb = tween.onDone;
    view.arc = 0; tween = null;
    if (cb) cb();
  }
}

/* ---------- lights: one warm key top-left + soft fill ---------- */
const hemi = new THREE.HemisphereLight(0xfdfff8, 0xd8d4c8, 0.85);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff1dd, 2.2);
key.position.set(-60, 90, 20);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -95; key.shadow.camera.right = 95;
key.shadow.camera.top = 95; key.shadow.camera.bottom = -95;
key.shadow.camera.far = 400;
key.shadow.radius = 7; key.shadow.blurSamples = 12;
key.shadow.bias = -0.0004;
scene.add(key);

// shadow catcher — makes the pods float over the cream page
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500),
  new THREE.ShadowMaterial({ opacity: 0.13 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -7;
ground.receiveShadow = true;
scene.add(ground);

/* ---------- build the office ---------- */
const hud = document.getElementById('hud');
/* 27 out 2026 — o terminal da oficina (tecla F). Escuta o SSE do servidor: cada linha é uma coisa
   que ACONTECEU (uma ferramenta provada, uma nota lida, uma tarefa contada). Nada aqui é encenação. */
const forgeTerm = createForgeTerminal({ rooms: DEPT_KEYS });
const clickTargets = [];   // plinth meshes -> dept key
const personTargets = [];  // person meshes -> agent id
const R = {};              // runtime per agent
const deptRT = {};         // runtime per dept
const screenSets = [];
const dressingRT = [];     // 27 out 2026: o adereço de cada sala, para a inspecção e o teste
const DECK = ['emails', 'sales', 'marketing', 'fin', 'ops', 'delivery'];

/* 28 out 2026 (pedido 36) — a porta de cada sala, calculada UMA vez, antes de se construir o que ela
   afecta: o vão na parede, a porta, o corredor e o percurso dos chefes têm todos de ler o mesmo
   sítio, senão cada um inventa o seu. */
const PLATES = {};
for (const k of DEPT_KEYS) PLATES[k] = doorPlan(k, LAYOUT, { x: 8, z: 8 });

for (const [key_, L] of Object.entries(LAYOUT)) {
  const dept = DEPTS[key_];
  const g = new THREE.Group();
  g.position.set(L.pos[0], 0, L.pos[1]);
  const plinth = makePlinth(L.w, L.d, dept.glass); // V7: o chão é vidro com a cor da sala
  g.add(plinth);
  plinth.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
  // (as peças do chão já sabem o que são — `userData.part`/`userData.tint` saem do builder.
  //  O `children[0]/children[1]` que aqui estava partia-se à primeira camada nova.)

  // walls (25 out 2026): every sala gets a real room — an L of solid base + glass above,
  // on the two sides away from the camera, open at the corner the walkway arrives on.
  let walls = null;
  if (key_ !== 'brain') {
    try {
      /* O vão da porta: no pano de parede que a porta ocupa — o de FUNDO (-z) ou o LATERAL (-x),
         conforme a sala olhe para o Cérebro pelo eixo z ou pelo eixo x. Nas três salas cuja porta
         cai no lado aberto não há parede para abrir: a porta leva o seu próprio anteparo. */
      const pl = PLATES[key_];
      const opening = pl && pl.walled
        ? {
          side: pl.openingSide,
          at: pl.openingSide === '-z' ? pl.local.x : pl.local.z,
          w: DOOR.clearW + DOOR.frameW * 2 + 0.04,
          h: DOOR.clearH + DOOR.frameW + 0.04,
        }
        : null;
      walls = makeRoomWalls(L.w, L.d, dept.chip, dept.ink, dept.short, { glass: dept.glass, opening });
      walls.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
      g.add(walls);
    } catch (e) { walls = null; console.warn('paredes: ' + key_ + ' — ' + e.message); }
  }

  /* 27 out 2026 — «chique chique». O adereço da sala: tapete de entrada, salão à frente,
     aparadora no corredor, dois candeeiros de pé e uma árvore no canto que a câmara vê.
     Entra dentro do `try` das paredes: se um adereço falhar, a sala continua de pé sem ele. */
  let dressing = null;
  if (key_ !== 'brain') {
    try {
      dressing = makeRoomDressing(L.w, L.d, dept.glass, dept.chip, dept.ink, {
        seed: DECK.indexOf(key_) + 3,
        front: deskFront(key_),      // onde as secretárias acabam: a entrada começa depois daqui
      });
      dressing.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
      g.add(dressing);
      dressingRT.push({
        dept: key_, w: L.w, d: L.d, deskFront: deskFront(key_), ...dressing.userData.dressing,
        lamps: dressing.userData.dressing.lamps.length,
        tree: !!dressing.userData.dressing.tree,
      });
    } catch (e) { dressing = null; console.warn('adereço: ' + key_ + ' — ' + e.message); }
  }

  // no floor titles — the billboards name each department (AJ's call, M2.3)
  scene.add(g);
  deptRT[key_] = { group: g, L, walls, dressing };
}

// 1.9.6: o que cada planta é, e o que ela mede — lido depois por `window.CC.office.plants`
// e pelo teste de cena (nenhuma folha atravessa uma parede).
const plantsRT = [];
function plantHeight(g) {
  let h = 0;
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    if (b) h = Math.max(h, b.max.y + o.position.y);
  });
  return Math.round(h * 1000) / 1000;
}

// brain centre (V3.6, AJ 6 Sep 2026): the particle nebula is RETIRED. The vault's wiki-link graph
// is etched into the pod floor (src/brain.js); reads glint, writes add notes, G opens the full graph.
let brain;
let hall = null;
{
  const bg = deptRT.brain.group;
  /* 28 out 2026 — O CÉREBRO PASSOU A SER UMA SALA (pedido do dono).
     O orbe já existia (brain.js); o que faltava era o sítio à volta: a praça de latão, o aro de LED
     que fecha a sala e os SEIS púlpitos — um por sala, com a cor dessa sala na aresta e na pastilha.
     Cada chefe tem o seu lugar no anel, e é para lá que ele anda quando há um trabalho novo ou
     uma dúvida (ver src/crew.js). A posição de cada chefe nasce AQUI e é a mesma nos dois sítios:
     desenho e coreografia não podem discordar. */
  hall = makeMasterHall({
    glass: DEPTS.brain.glass,
    ink: DEPTS.brain.ink,
    spots: DEPT_KEYS.map((k) => ({
      dept: k,
      color: DEPTS[k].glass,
      // o ângulo da sala: assim o lugar de cada chefe fica do lado do corredor da sua sala
      angle: Math.atan2(LAYOUT[k].pos[1], LAYOUT[k].pos[0]),
    })),
  });
  bg.add(hall);
  brain = initBrain({ scene, brainGroup: bg, getR: () => R, esc: (t) => esc(t), hud, toScreen: (p) => toScreen(p), getCamera: () => camera });
  // 1.9.6: a planta do centro é a peça de apresentação — folha larga, um pouco maior.
  // 28 out 2026: saiu do canto (−5,0) para (5,9,−1,6) — o canto passou a ser o lugar do chefe de
  // PROSPEÇÃO e a folhagem caía-lhe em cima.
  const plant = makePlant({ seed: 11, kind: 'broad', scale: 1.05 });
  plant.position.set(5.9, 0.12, -1.6);
  plant.rotation.y = 0.6;
  bg.add(plant);
  plantsRT.push({ dept: 'brain', kind: 'broad', seed: 11, leaves: plant.userData.plant.leaves, scale: 1.05, x: 5.9, z: -1.6, top: 0.12 + plantHeight(plant) });
}

/* ---------- A CIRCULAÇÃO (28 out 2026) ----------
   Quem manda levantar um chefe é a base de dados, não um relógio: `syncFromLive` emite um sinal
   quando aparece uma tarefa a correr (o chefe vai ao Cérebro buscá-la) ou alguém fica à espera de
   decisão (o chefe vai pedir ajuda). O `crew` só sabe andar e falar — nada inventa. */
const crew = createCrew({
  R, AGENTS, DEPTS, LAYOUT, deptRT,
  hall: hall && hall.userData.hall,
  deskFront,
  onEmote: (r, icon) => { try { spawnEmote(r, icon); } catch { /* um emote nunca derruba a cena */ } },
});

/* 26 out 2026: o «sweep» que acendia as salas uma a uma saiu. Era teatro: dava a ideia de que a
   sala estava a fazer algo quando não estava. Agora só o trabalho real acende alguma coisa. */

// corredores dept -> Cérebro (28 out 2026: passadeira rolante preta, entrada na cor da sala)
const ledRT = [];   // as faixas cujo offset se anima por frame (ver `tickLeds`)
/* 29 out 2026: as passadeiras como foram DESENHADAS (comprimento, pontas e o platô do pé da
   escada). O teste de cena lê daqui, em vez de repetir números à mão. */
const walkRT = [];
const entranceRT = [];   // 28 out 2026: a porta de cada sala (cor, sítio, direcção, anteparo)
for (const k of DEPT_KEYS) {
  const L = LAYOUT[k];
  const plan = PLATES[k];
  /* 28 out 2026 (1.13.2, pedido 36 «melhore os lugares das portas e analisa bem») — a porta e a
     passadeira nascem da MESMA conta (`doorPlan`, em `src/circulation.js`):

       · a porta fica no lado da sala que olha para o Cérebro — o ponto onde a linha
         «centro da sala → átrio» sai do pod, e não um canto nem o meio de um pano qualquer;
       · a passadeira começa 0,9 m à frente dessa porta (`bridge.from`) e acaba no canto do pod do
         Cérebro que lhe fica à frente (`bridge.to`), em linha recta. Antes corria encostada ao pod,
         porque a boca do corredor estava no meio do pano e o Cérebro no eixo da sala;
       · nas três salas em que a porta cai no lado ABERTO (emails e marketing a leste, delivery a
         sul), a porta traz o seu anteparo — um biombo de parede na cor da sala — em vez de ficar de
         pé no vazio.

     A ponte dos chefes (`deptRT.gate`/`brainGate`) lê o mesmo `bridge`, por isso o percurso que o
     `crew.js` desenha passa exactamente por cima da passadeira: uma só verdade. */
  const from = [plan.bridge.from.x, plan.bridge.from.z];
  const to = [plan.bridge.to.x, plan.bridge.to.z];
  const walk = makeWalkway(from, to, { glass: DEPTS[k].glass, chip: DEPTS[k].chip });
  walkRT.push({ dept: k, ...walk.userData.walkway });
  walk.userData.dept = k; walk.userData.part = 'walkway';
  walk.traverse((o) => { if (o.isMesh) { o.userData.dept = k; clickTargets.push(o); } });
  scene.add(walk);
  for (const m of (walk.userData.led && walk.userData.led.strips) || []) ledRT.push({ dept: k, mat: m });
  // 28 out 2026: o TAPETE também rola — a passadeira preta anda de verdade, não é só preta
  for (const m of (walk.userData.led && walk.userData.led.belts) || []) ledRT.push({ dept: k, mat: m });
  deptRT[k].gate = new THREE.Vector3(from[0], 0, from[1]);
  deptRT[k].brainGate = new THREE.Vector3(to[0], 0, to[1]);

  /* A ENTRADA da sala, na cor dela, virada ao Cérebro. O eixo do grupo (`+z`) é o lado do corredor:
     `dir` faz a porta olhar para fora, e é o mesmo vector que a passadeira segue. */
  try {
    const walled = plan.walled;
    /* Com parede, a porta assenta na face INTERIOR dela (o vão foi aberto pelo `makeRoomWalls`); sem
       parede, assenta no bordo do pod, e é o anteparo que lhe dá corpo. */
    const at = walled
      ? (plan.side === '-z'
        ? { x: plan.local.x, z: -L.d / 2 + WALL.t + DOOR.frameD / 2 }
        : { x: -L.w / 2 + WALL.t + DOOR.frameD / 2, z: plan.local.z })
      : (plan.side === '+z'
        ? { x: plan.local.x, z: L.d / 2 - 0.03 }
        : { x: L.w / 2 - 0.03, z: plan.local.z });
    // o anteparo cobre o lado que a porta ocupa, mas nunca a sala toda: a câmara tem de ver dentro
    const span = (plan.side === '+x' || plan.side === '-x') ? L.d : L.w;
    const ent = makeRoomEntrance({
      glass: DEPTS[k].glass, at, dir: plan.dir, label: DEPTS[k].short,
      screen: plan.screen, screenLen: plan.screen ? Math.min(span - 0.6, 6.6) : 0,
    });
    ent.traverse((o) => { if (o.isMesh) { o.userData.dept = k; clickTargets.push(o); } });
    deptRT[k].group.add(ent);
    deptRT[k].entrance = ent;
    entranceRT.push({ dept: k, glass: DEPTS[k].glass, ...ent.userData.entrance, side: plan.side });
  } catch (e) { console.warn('entrada: ' + k + ' — ' + e.message); }
}
// os LED das paredes entram no mesmo sítio (as faixas já nascem no builder)
for (const [k, rt] of Object.entries(deptRT)) {
  if (k === 'brain') continue;
  for (const m of (rt.walls && rt.walls.userData.led && rt.walls.userData.led.strips) || []) ledRT.push({ dept: k, mat: m });
}
// tag remaining brain furnishings (plinth, plant) for the focus-dim pass — these DO go
// dark in galaxy mode, unlike the 'brainCore' nebula tagged above
deptRT.brain.group.traverse(o => { if ((o.isMesh || o.isSprite) && !o.userData.dept) o.userData.dept = 'brain'; });

/* (M5.3 per AJ: the bridge cables are gone — the walkways alone carry the connection;
   the brain↔dept relationship shows through the badge sweep + meetings.) */

/* AO VIVO (26 out 2026): cada monitor mostra o trabalho registado no posto dele. A fonte é o
   servidor (`/api/ops/aovivo/stream`, SSE); sem trabalho registado o painel diz «sem tarefa em
   curso» em vez de rodar texto de exemplo. 1.9.1: deixou de haver cena de demonstração gravada —
   não há dois regimes, há um. */
const liveUi = createLive({ agents: AGENTS.map(x => x.id) });
function agentInfo(id) {
  const a = AGENTS.find(x => x.id === id);
  if (!a) return { id };
  const r = R[id];
  return { id, name: a.name, role: r?.role || roleOf(id), tagline: r?.does || doesOf(id), chip: DEPTS[a.dept].chip, deptName: DEPTS[a.dept].name };
}

/* desks + people per dept */
for (const a of AGENTS) {
  const dRT = deptRT[a.dept];
  const dept = DEPTS[a.dept];
  const L = dRT.L;
  // 1.10.4: a conta do lugar vive em `data.js` (fila encostada à parede de fundo, faixa da
  // frente reservada à entrada) — a cena e o `tools/room.mjs` usam a mesma função.
  const { x: gx, z: gz } = stationSpot(a.dept, a.grid);
  const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);

  // whole station rotated 45° so monitor screens face the camera square-on
  const ANG = Math.PI / 4;
  const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

  const station = new THREE.Group();
  station.position.copy(base);
  station.rotation.y = ANG;
  const live = liveUi.attach(agentInfo(a.id)); // um monitor por posto, ligado ao que a base de dados diz
  // 26 out 2026: a secretária passa a ser preta, com LED na cor do vidro da sala e acessórios
  // gamers. A semente muda o acessório de posto para posto (comando, telemóvel, barra de luz).
  const { group: desk, screenSet, caps, mouse } = makeDesk(dept.chip, live, { glass: dept.glass, seed: AGENTS.indexOf(a) });
  station.add(desk);
  screenSets.push({ screenSet, dept: a.dept, live, agentId: a.id });
  const chair = makeChair({ glass: dept.glass, chip: dept.chip });
  chair.position.set(0, 0, 1.75);
  station.add(chair);
  station.traverse(o => { if (o.isMesh) o.userData.dept = a.dept; }); // focus-dim tagging
  scene.add(station);

  const look = lookFor(a);   // quem é esta pessoa: cabelo, chapéu, barba, fato na cor da sala
  const person = makePerson({ look });
  person.position.copy(base).add(rot(new THREE.Vector3(0, 0, 1.7)));
  person.rotation.y = ANG + Math.PI; // face the monitor
  person.traverse(o => { if (o.isMesh) { o.userData.agentId = a.id; o.userData.dept = a.dept; personTargets.push(o); } });
  scene.add(person);

  const warn = makeWarnSprite();
  warn.visible = false;
  scene.add(warn);

  // name pill (HTML) — clickable, same as clicking the agent
  const pill = document.createElement('div');
  pill.className = 'pill';
  pill.style.setProperty('--glass', dept.glass); // V7: o nome do agente leva a cor da sala
  // 26 out 2026: 35 pastilhas flutuantes seriam 35 paragens de Tab a atravessar o ecrã. Fica uma
  // regra: só entra no Tab quem está na sala em foco (o resto continua focável por código).
  pill.setAttribute('role', 'button');
  pill.tabIndex = -1;
  pill.setAttribute('aria-label', `${a.name} — ${dept.name}. Abrir o agente.`);
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pill.click(); }
  });
  pill.innerHTML = (a.lead ? '<span class="star">★</span>' : '') + a.name;
  pill.addEventListener('click', () => openAgent(a.id, R[a.id] && R[a.id].state === 'stuck' ? 'chat' : 'live'));
  hud.appendChild(pill);

  R[a.id] = {
    a, person, warn, pill, seat: person.position.clone(), seatRot: ANG + Math.PI,
    stand: person.position.clone().add(rot(new THREE.Vector3(1.5, 0, 0.15))),
    state: 'idle', bob: Math.random() * 10, path: null, pathI: 0, speed: 9.5, ask: null, feed: [],
    station, desk, screenSet,
    // 27 out 2026: o posto guarda o que se mexe — as teclas que afundam e o rato que desliza
    caps, mouse, look,
    press: new Float32Array(KEY_CELLS.length), touched: new Set(),
    mouseRest: { x: MOUSE.x, z: MOUSE.z }, mousePos: { x: MOUSE.x, z: MOUSE.z },
    handOff: { x: MOUSE.x, z: MOUSE.z },
  };
}

/* CONNECTORS — per-dept dock of MCP logos with back-and-forth traffic (AJ's spec, 2 Aug rev 2)
   V3.1: served, the list is the user's REAL MCP servers (GET /api/mcp) — the strip waits for it.
   Opened as a file the demo list plays at once. `mcp` is a thin proxy so the rest of the office
   never cares which it got. */
let mcpImpl = null, mcpDark = false;
const mcp = {
  sprites: [],
  tick: (...a) => mcpImpl && mcpImpl.tick(...a),
  onToolsUsed: (...a) => mcpImpl && mcpImpl.onToolsUsed(...a),
  showTip: (...a) => mcpImpl && mcpImpl.showTip(...a),
  startReveal: (...a) => mcpImpl && mcpImpl.startReveal(...a),
  setDark: on => { mcpDark = on; if (mcpImpl) mcpImpl.setDark(on); },
  setUsage: u => { mcpUsage = u; if (mcpImpl) mcpImpl.setUsage(u); }, // V3.6: the plan's gauge; kept until the strip exists
  isLive: () => !!(mcpImpl && mcpImpl.live),
};
let mcpUsage = null;
loadConnectors()
  .then(c => { mcpImpl = initMcp({ scene, hud, LAYOUT, DEPTS, FR, R, connectors: c, semServidor: !c }); if (mcpDark) mcpImpl.setDark(true); if (mcpUsage) mcpImpl.setUsage(mcpUsage); })
  // 26 out 2026: uma falha nos conectores nunca pode derrubar a cena — fica sem a barra e diz porquê
  .catch(e => console.warn('conectores indisponíveis: ' + e.message));

/* ---------- as plantas (26 out 2026, 1.9.6) ----------
   Antes: cinco vasos iguais, com cinco esferas verdes cada, encostados ao canto a olho.
   Agora: uma espécie por sala (alto e vertical onde há pouco espaço, largo e aberto onde há
   mais), semente própria (a mesma planta em cada recarregamento) e — o que faltava — o LUGAR
   MEDIDO: mede-se o raio que a folhagem ocupa e afasta-se o vaso do canto o suficiente para
   nenhuma folha atravessar a parede de vidro. Duas plantas a mais: a DESIGN LAB, que não tinha
   nenhuma, e a do centro, que passa a ser a peça de apresentação. */
const PLANT_OF = { emails: 'upright', delivery: 'broad', sales: 'upright', marketing: 'broad', fin: 'upright', ops: 'broad' };
{
  let semente = 3;
  for (const [k, kind] of Object.entries(PLANT_OF)) {
    const L = LAYOUT[k];
    const p = makePlant({ seed: semente, kind });
    const caixa = new THREE.Box3().setFromObject(p);
    const raio = Math.max(-caixa.min.x, caixa.max.x, -caixa.min.z, caixa.max.z); // raio da folhagem
    const sx = Math.sign(L.pos[0]) || 1, sz = Math.sign(L.pos[1]) || 1;
    const folga = 0.45; // entre a última folha e a parede
    const dx = Math.max(1.2, L.w / 2 - raio - folga);
    const dz = Math.max(1.2, L.d / 2 - raio - folga);
    p.position.set(L.pos[0] + sx * dx, 0.12, L.pos[1] + sz * dz);
    p.rotation.y = (semente * 1.7) % (Math.PI * 2); // cada uma olha para um lado diferente
    p.traverse(o => { if (o.isMesh) o.userData.dept = k; });
    scene.add(p);
    plantsRT.push({
      dept: k, kind, seed: semente, leaves: p.userData.plant.leaves, scale: 1,
      x: Math.round(p.position.x * 100) / 100, z: Math.round(p.position.z * 100) / 100,
      radius: Math.round(raio * 100) / 100,
      top: Math.round((0.12 + plantHeight(p)) * 100) / 100,
      inside: Math.abs(p.position.x - L.pos[0]) + raio <= L.w / 2 && Math.abs(p.position.z - L.pos[1]) + raio <= L.d / 2,
    });
    semente++;
  }
  // a folhagem não pode entrar numa secretária: mede-se a distância do vaso a cada cadeira.
  // (as secretárias já existem — este bloco corre depois do ciclo dos postos.)
  for (const pl of plantsRT) {
    let perto = Infinity;
    for (const id of Object.keys(R)) {
      const st = R[id] && R[id].seat;
      if (st) perto = Math.min(perto, Math.hypot(pl.x - st.x, pl.z - st.z));
    }
    if (Number.isFinite(perto)) pl.deskGap = Math.round(perto * 100) / 100;
  }
}

/* ---------- focus dim: unfocused depts genuinely darken/desaturate in-scene ---------- */
let focusDimTarget = 0, focusDim = 0;
const dimSwapped = [];
const dimCache = new Map();
function dimTwin(m) {
  if (!dimCache.has(m.uuid)) {
    const d = m.clone();
    d.userData.baseColor = m.color.clone();
    const l = (m.color.r + m.color.g + m.color.b) / 3;
    d.userData.dimColor = new THREE.Color(l * 0.40 + 0.10, l * 0.40 + 0.10, l * 0.38 + 0.09);
    // 26 out 2026: um LED aceso numa sala que não está em foco continuava a brilhar — o corpo
    // apagava-se e a luz ficava. A emissão também entra no escurecimento.
    if (m.emissive) {
      d.userData.baseEmissive = m.emissive.clone();
      d.userData.dimEmissive = m.emissive.clone().multiplyScalar(0.22);
      d.emissive = m.emissive.clone();
    }
    dimCache.set(m.uuid, d);
  }
  return dimCache.get(m.uuid);
}
function applySceneDim(deptKey) {
  restoreSceneDim();
  scene.traverse(o => {
    if (!(o.isMesh || o.isLine || o.isSprite) || !o.material || o.material.isShadowMaterial || !o.userData.dept) return;
    if (o.userData.dept === deptKey) return;
    if (deptKey === 'brain' && o.userData.dept === 'brainCore') return; // brain focus keeps its nebula lit
    dimSwapped.push({ mesh: o, orig: o.material });
    o.material = dimTwin(o.material);
  });
}
function restoreSceneDim() {
  for (const s of dimSwapped) s.mesh.material = s.orig;
  dimSwapped.length = 0;
}
function tickDim(dt) {
  focusDim += (focusDimTarget - focusDim) * (1 - Math.exp(-dt * 5));
  if (focusDimTarget === 0 && focusDim < 0.02 && dimSwapped.length) restoreSceneDim();
  for (const m of dimCache.values()) {
    m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, focusDim);
    if (m.emissive && m.userData.baseEmissive) m.emissive.copy(m.userData.baseEmissive).lerp(m.userData.dimEmissive, focusDim);
  }
}

/* ---------- department billboards — os números que a base de dados tem, e mais nada ----------
   Antes: métricas de exemplo (KPIS/STATS) que subiam sozinhas. Agora: as tarefas reais de cada
   sala, por estado, lidas do fluxo ao vivo. Sem dados, o cartão mostra 0 e di-lo — não inventa. */
let brainNotes = brain.state.notes;
const DEPT_OF_SEAT = Object.fromEntries(AGENTS.map(a => [a.id, a.dept]));
const BB_ROWS = {
  emails: [['EM CURSO', () => deptCount('emails', 'live')], ['À ESPERA', () => deptCount('emails', 'waiting')], ['CONCLUÍDAS 24H', () => deptCount('emails', 'done')]],
  sales: [['EM CURSO', () => deptCount('sales', 'live')], ['À ESPERA', () => deptCount('sales', 'waiting')], ['CONCLUÍDAS 24H', () => deptCount('sales', 'done')]],
  ops: [['EM CURSO', () => deptCount('ops', 'live')], ['À ESPERA', () => deptCount('ops', 'waiting')], ['CONCLUÍDAS 24H', () => deptCount('ops', 'done')]],
  fin: [['EM CURSO', () => deptCount('fin', 'live')], ['À ESPERA', () => deptCount('fin', 'waiting')], ['CONCLUÍDAS 24H', () => deptCount('fin', 'done')]],
  delivery: [['EM CURSO', () => deptCount('delivery', 'live')], ['À ESPERA', () => deptCount('delivery', 'waiting')], ['CONCLUÍDAS 24H', () => deptCount('delivery', 'done')]],
  marketing: [['EM CURSO', () => deptCount('marketing', 'live')], ['À ESPERA', () => deptCount('marketing', 'waiting')], ['CONCLUÍDAS 24H', () => deptCount('marketing', 'done')]],
};
/* 30 out 2026: a mesma linha, escrita curta para o telemóvel (o CSS troca o texto
   quando a janela tem ≤ 640 px). É a mesma métrica — muda o comprimento, não o número. */
const BB_SHORT = { 'EM CURSO': 'CURSO', 'À ESPERA': 'ESPERA', 'CONCLUÍDAS 24H': '24H' };
/** Conta os postos daquela sala que estão em cada estado — do retrato do servidor, não da cena. */
function deptCount(dept, kind) {
  let n = 0;
  for (const [id, d] of Object.entries(liveUi.all())) {
    if (DEPT_OF_SEAT[id] !== dept) continue;
    const st = d.state;
    if (kind === 'live' && st === 'live') n++;
    else if (kind === 'waiting' && st === 'waiting') n++;
    else if (kind === 'done' && d.last && d.last.state === 'succeeded' && (Date.now() - new Date(d.last.finished_at || d.last.at || 0).getTime()) < 24 * 3600 * 1000) n++;
  }
  return n;
}
/* ---------- o que se diz a um leitor de ecrã (26 out 2026) ----------
   A cena não fala. Estas funções traduzem o estado real — o mesmo de que o cartão e o monitor
   vivem — numa frase que um leitor de ecrã consiga anunciar. Sem números inventados: o que não
   está na base de dados diz-se por palavras. */
function agentStateOf(id) {
  const r = R[id];
  const d = liveUi.forAgent(id);
  const t = d && d.task;
  // sem ligação ao vivo não se afirma o presente: diz-se que é o último estado conhecido
  const ligado = liveUi.status() === 'live';
  if (!ligado && (t || (r && r.state && r.state !== 'idle'))) return { label: 'último estado conhecido — sem ligação ao vivo', kind: 'idle' };
  if ((r && r.state === 'stuck') || (t && t.state === 'awaiting_approval')) return { label: 'à espera do teu OK', kind: 'waiting' };
  if (t && t.state === 'running') return { label: 'a trabalhar', kind: 'live' };
  if (t && t.state === 'queued') return { label: 'na fila', kind: 'queued' };
  if (t && t.state === 'succeeded') return { label: 'última tarefa concluída', kind: 'done' };
  if (t && t.state === 'failed') return { label: 'a última tarefa falhou', kind: 'risk' };
  if (t && t.state === 'cancelled') return { label: 'última tarefa cancelada', kind: 'idle' };
  return { label: 'sem tarefa registada', kind: 'idle' };
}
function badgeLabel(k) {
  if (k === 'brain') return `O Cérebro — ${brain.state.notes} notas. Abrir o grafo (G).`;
  const d = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const live = deptCount(k, 'live'), wait = deptCount(k, 'waiting');
  return `Abrir a sala ${d.name} — ${n} agentes${live ? `, ${live} a trabalhar` : ''}${wait ? `, ${wait} à espera de aprovação` : ''}.`;
}
function syncBadgeLabels() { // o que se ouve acompanha os números que mudam
  for (const k of Object.keys(deptRT)) {
    const b = deptRT[k].badge;
    if (b) b.setAttribute('aria-label', badgeLabel(k));
  }
}

for (const k of [...DEPT_KEYS, 'brain']) {
  const dept = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const b = document.createElement('div');
  b.className = 'badge';
  b.style.setProperty('--glass', dept.glass); // V7: o cartão usa a cor do vidro da sala que nomeia
  // 26 out 2026: o cartão passa a existir para quem usa teclado. Mesma acção do clique — a
  // acessibilidade não inventa um caminho paralelo, só dá teclas ao caminho que já existia.
  b.setAttribute('role', 'button');
  b.tabIndex = 0;
  b.setAttribute('aria-label', badgeLabel(k));
  b.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); }
  });
  b.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.short}<span class="live"></span></div>
    <div class="b-count">${k === 'brain' ? '<span class="b-num">∞</span><span class="b-lab">CONHECIMENTO</span>' : `<span class="b-num">${n}</span><span class="b-lab">AGENTES</span>`}</div>
    <div class="b-metrics">${(BB_ROWS[k] || []).map((row, i) => `
      <div class="m-row"><span class="m-lab" data-short="${BB_SHORT[row[0]] || row[0]}">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
    </div>
    <button type="button" class="b-appr" style="display:none" aria-label="decisões à tua espera — abrir a primeira">⚠ <span class="ap-n">0</span> <span class="ap-t">À ESPERA DE APROVAÇÃO</span></button>`;
  b.addEventListener('click', (e) => {
    if (e.target.closest('.b-appr')) { zoomToApproval(k); e.stopPropagation(); }
    else if (e.target.closest('.b-tasks') && tasks) { tasks.openFor(k); e.stopPropagation(); }
    else zoomToDept(k);
  });
  if (k === 'brain') {
    b.className = 'badge brainTag';
    b.innerHTML = `<div class="b-name"><span class="dot" style="background:${dept.chip}"></span>O CÉREBRO<b>${brain.state.notes.toLocaleString('pt-PT')}</b>NOTAS</div>`;
    b.onclick = (e) => { e.stopPropagation(); brain.open(); };
    b.title = 'abrir o Cérebro (G)';
  }
  hud.appendChild(b);
  deptRT[k].badge = b;
  deptRT[k].vals = (BB_ROWS[k] || []).map(row => String(row[1]()));
  deptRT[k].apprRow = b.querySelector('.b-appr');
  deptRT[k].apprN = b.querySelector('.ap-n');
  const ANCHOR = {
    marketing: [-36, 8.6, 13.4],
    emails:    [-30, 8.6, -32.6],
    delivery:  [0, 10.6, -57.6],
    sales:     [48, 8.6, -32],
    ops:       [-13.5, 4, 54],
    fin:       [43.5, 4, 17],
    brain:     [0, 9.7, 0],
  };
  deptRT[k].badgeAnchor = new THREE.Vector3(...ANCHOR[k]);
  if (k === 'fin') deptRT[k].sideBadge = true;
  if (k === 'ops') { deptRT[k].sideBadge = true; deptRT[k].sideLeft = true; }
}
function updateBillboards() {
  for (const k of Object.keys(BB_ROWS)) {
    BB_ROWS[k].forEach((row, i) => {
      const nv = String(row[1]());
      if (nv !== deptRT[k].vals[i]) {
        deptRT[k].vals[i] = nv;
        const el = deptRT[k].badge.querySelector(`[data-m="${k}-${i}"]`);
        if (!el) return;
        el.textContent = nv;
        el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        const rel = document.querySelector(`[data-rm="${k}-${i}"]`);
        if (rel) { rel.textContent = nv; rel.classList.remove('flash'); void rel.offsetWidth; rel.classList.add('flash'); }
      }
    });
  }
}
liveUi.onChange((e) => { if (e.type === 'update' || e.type === 'status') { updateBillboards(); syncBadgeLabels(); } });

/* ---------- controls: wheel zoom-to-cursor, drag pan, click to fly ---------- */
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function worldAt(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const p = new THREE.Vector3();
  ray.ray.intersectPlane(groundPlane, p);
  return p;
}
let focused = null; // dept key when zoomed into a dept

/* 1.53.0 · O SCROLL DECIDE. Com o trackpad, deslizar para o lado (deltaX) roda a câmara à volta
   do escritório; Shift+scroll também roda (é o que os ratos normais fazem quando se carrega em
   Shift). O scroll vertical continua a ser zoom, e o zoom continua a mirar o cursor — cada gesto
   faz uma coisa só. A decisão está em `gestoDoScroll()`, provada em `camera.test.mjs`. */
addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('#rail')) return; // let the rail scroll
  if (e.target.closest && e.target.closest('#apps')) return; // a loja de apps rola por dentro
  e.preventDefault();
  tween = null;
  view.arc = 0;
  const gesto = gestoDoScroll(e);
  if (gesto.tipo === 'rodar') {
    view.yaw = rodar(view.yaw, gesto.valor * RAD_POR_PIXEL);
    applyCamera();
    syncAngleBtn();
    return;
  }
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  const before = worldAt(nx, ny);
  view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0032), 0.72, 5.2);
  applyCamera();
  const after = worldAt(nx, ny);
  if (before && after) view.target.add(before.sub(after));
  if (view.zoom < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}, { passive: false });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  drag = {
    x: e.clientX, y: e.clientY, moved: false,
    /* Alt+arrastar (ou o botão do meio/direito) RODA; arrastar normal MOVE o chão. */
    modo: gestoDoArrasto({ altKey: e.altKey, botao: e.button }),
  };
  if (drag.modo === 'rodar') { try { canvas.setPointerCapture(e.pointerId); } catch { /* sem captura */ } }
});
// o botão direito não abre o menu: é uma pega para rodar
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  tween = null;
  if (drag.modo === 'rodar') {
    /* rotação: horizontal dá a volta, vertical inclina (com limites — nunca passa por baixo do chão) */
    view.yaw = rodar(view.yaw, dx * 0.007);
    view.tilt = inclinacaoValida(view.tilt + dy * 0.006);
    applyCamera();
    syncAngleBtn();
  } else {
    const a = worldAt((drag.x / innerWidth) * 2 - 1, -(drag.y / innerHeight) * 2 + 1);
    const b = worldAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (a && b) view.target.add(a.sub(b));
  }
  drag.x = e.clientX; drag.y = e.clientY;
});
addEventListener('pointerup', (e) => {
  const wasDrag = drag && drag.moved;
  drag = null;
  if (wasDrag) return;
  if (e.target !== canvas) return; // HTML chrome handles its own clicks
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const mHits = ray.intersectObjects(mcp.sprites, false);
  if (mHits.length) { // MCP logo tile → pulse + connection tooltip
    mcp.showTip(mHits[0].object, e.clientX, e.clientY, performance.now());
    return;
  }
  const pHits = ray.intersectObjects(personTargets, false);
  if (pHits.length) {
    // clicar num agente abre o painel de inspeção; quem está preso numa aprovação vai direto à conversa
    const clicked = pHits[0].object.userData.agentId;
    openAgent(clicked, R[clicked] && R[clicked].state === 'stuck' ? 'chat' : 'live');
    return;
  }
  const hits = ray.intersectObjects(clickTargets, false);
  if (hits.length) {
    const dk = hits[0].object.userData.dept;
    if (dk === 'brain') { brain.open(); return; } // V3.6: the Brain opens as the graph
    if (dk !== focused) enterFocus(dk);
  }
});
addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return; // typing in the bar, the big editor or a menu never fires a hotkey
  if (e.key === 'Escape' && forgeTerm.isOpen()) { forgeTerm.close(); return; }
  if (e.key === 'Escape') { if (tasks && tasks.calendar && tasks.calendar.isOpen()) { if (tasks.calendar.popOpen()) tasks.calendar.closePop(); else tasks.calendar.close(); } else if (brain.isOpen()) brain.close(); else if (tasks && tasks.isOpen()) tasks.close(); else zoomOut(); }
  else if (e.key === 'p' || e.key === 'P') { if (tasks && tasks.calendar) tasks.calendar.toggle(); } // V3.2.1 (16 Sep 2026): the calendar
  else if (tasks && tasks.calendar && tasks.calendar.isOpen()) return; // the calendar ficou com elas own keys (← → W M T)
  else if (e.key === 'l' || e.key === 'L') { a11y.toggle(document.activeElement); } // 26 out 2026: a lista do escritório
  else if (e.key === 'g' || e.key === 'G') brain.toggle(); // V3.6: the full-screen Brain graph
  else if (e.key === 'b' || e.key === 'B') { if (tasks) tasks.toggle(); } // V3: the company-wide board
  else if (e.key === '+' || e.key === '=') zoomStep(1.5);
  else if (e.key === '-' || e.key === '_') zoomStep(1 / 1.5);
  else if (e.key === '0') zoomOut();
  else if (e.key >= '1' && e.key <= '6') { // jump straight to a department
    const dept = ['marketing', 'emails', 'sales', 'ops', 'fin', 'delivery'][+e.key - 1];
    if (focused !== dept) enterFocus(dept);
  }
  else if (e.key === 'c' || e.key === 'C') { // in a department: open its (lead) agent's chat
    if (focused && focused !== 'brain') {
      const a = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
      if (a) openAgentRail(a.id, 'chat');
    }
  }
  else if (e.key === 'f' || e.key === 'F') { forgeTerm.toggle(); } // 27 out 2026: o terminal da oficina
  else if (e.key === 'v' || e.key === 'V') setCam(!document.body.classList.contains('cam'));
  else if (e.key === 'd' || e.key === 'D') applyTheme(darkOn ? 'light' : 'dark');
  else if (e.key === ',') { if (cfg) cfg.toggle(); }
});

/* ---------- O TEMA (29 out 2026) ----------
   A tecla D e o endereço `/dark` continuam a funcionar — mas a escolha passa a ser um valor a sério,
   guardado no browser: Claro, Escuro ou Automático (o que o sistema disser). No arranque, o tema é
   aplicado ANTES de se olhar para o `#dark=1`, para a preferência não ser atropelada por um link. */
let cfg = null;                        // o painel das configurações (criado mais abaixo, usado por applyTheme)
const themeMQ = (() => { try { return matchMedia('(prefers-color-scheme: dark)'); } catch { return null; } })();
let themePref = readTheme();
function applyTheme(pref = themePref) {
  themePref = writeTheme(pref);
  setDark(resolveTheme(themePref, !!(themeMQ && themeMQ.matches)) === 'dark');
  if (cfg) cfg.refresh({ theme: themePref });
  return themePref;
}
if (themeMQ && typeof themeMQ.addEventListener === 'function') {
  themeMQ.addEventListener('change', (e) => { if (themePref === 'auto') setDark(!!e.matches); });
}
/* O tema aplica-se mais abaixo, no arranque, e não aqui: `setDark` fala com materiais, luzes e o
   `mcp` — peças que ainda não existem neste ponto do ficheiro. Aplicar cedo demais foi, numa
   primeira tentativa, uma cena em branco. */

/* ---------- OS AVISOS (29 out 2026) ----------
   Só nascem do que o servidor diz: um posto que ficou à espera do teu OK, um posto que falhou. O
   primeiro retrato é o ponto de partida (não gera avisos) — senão, ao abrir, choviam janelas por
   trabalho que já estava parado. */
const notifier = createNotifier({ getLive: () => liveUi.all(), onStatus: () => { if (cfg) cfg.refresh(); } });
liveUi.onChange((e) => { if (e && e.type === 'update') { try { notifier.ingest(); } catch { /* um aviso nunca derruba a cena */ } } });

/* ---------- OS PAINÉIS QUE SE AFASTAM (29 out 2026) ----------
   O campo de IA e o estado das tarefas passam a poder recolher-se, e a escolha fica no browser. Num
   ecrã estreito a coluna das tarefas nasce recolhida: no telemóvel ela tapava meia cena. */
let panelPrefs = readPrefs();
function applyPanels(p = panelPrefs) {
  document.body.classList.toggle('mc-folded', !!p.ai);
  document.body.classList.toggle('tp-folded', !!p.tasks);
  const cb = document.querySelector('.chat-fold');
  if (cb) { cb.setAttribute('aria-pressed', String(!!p.ai)); cb.textContent = p.ai ? 'abrir campo ▴' : 'recolher campo ▾'; cb.title = p.ai ? 'abrir o campo de IA' : 'afastar o campo de IA — a conversa fica, a caixa recolhe'; }
  const tb = document.querySelector('.tp-fold');
  if (tb) {
    /* 1.40.0: o rótulo vive num `span` próprio — o ícone é desenhado e não se apaga ao escrever */
    tb.setAttribute('aria-pressed', String(!!p.tasks));
    const rotulo = tb.querySelector('.tpf-t');
    const texto = p.tasks ? 'estado das tarefas' : 'afastar';
    if (rotulo) rotulo.textContent = texto; else if (!tb.querySelector('.tpf-i')) tb.textContent = texto;
    tb.title = p.tasks ? 'trazer o estado das tarefas' : 'afastar o estado das tarefas — fica um botão, volta com um clique';
  }
}
function setPanel(kind, on) {
  panelPrefs = writePrefs({ ...panelPrefs, [kind]: !!on });
  applyPanels(panelPrefs);
  if (cfg) cfg.refresh({ collapse: panelPrefs });
}
{
  // primeiro arranque num telemóvel: a coluna das tarefas não começa por tapar a cena
  const estreito = (() => { try { return matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  if (estreito) { try { if (!localStorage.getItem('orbita.paineis')) setPanel('tasks', true); } catch { /* sem armazenamento */ } }
}
applyPanels(panelPrefs);

/* ---------- O PAINEL DAS CONFIGURAÇÕES (29 out 2026) ---------- */
cfg = createConfig({
  theme: themePref,
  collapse: panelPrefs,
  notify: notifier,
  onTheme: (t) => applyTheme(t),
  onCollapse: (k, on) => setPanel(k, on),
});
{
  const gear = document.getElementById('topCfg');
  if (gear) gear.addEventListener('click', (e) => { e.stopPropagation(); cfg.toggle(); });
  const tpf = document.querySelector('.tp-fold');
  if (tpf) tpf.addEventListener('click', () => setPanel('tasks', !panelPrefs.tasks));
  const chf = document.querySelector('.chat-fold');
  if (chf) chf.addEventListener('click', () => setPanel('ai', !panelPrefs.ai));
  // fechar a gaveta do posto (telemóvel): o ✕ a sério, não só a tecla Esc
  const rc = document.getElementById('railClose');
  if (rc) rc.addEventListener('click', () => exitFocus());
}

// camera mode: mid-tone backdrop for filming the screen (#cam=1 / V toggles)
function setCam(on) { document.body.classList.toggle('cam', !!on); }
// DARK MODE (AJ, 6 Sep 2026: "faz outro em modo escuro, vou mostrar os dois"): D toggles, #dark=1
// forces it, /dark on the server opens in it. The chrome follows the CSS tokens; the scene
// re-tints its shared materials (plinths, floors, walkways), relights, and the Brain/wires swap ink.
let darkOn = false;
const DARK = { plinth: 0x2c2d2b, walkway: 0x303230, ground: 0x1b1c1a, wall: 0x33342f };
// V7: quanto do tom fundo entra em cada peça do chão de vidro quando a luz baixa. O vidro escuro
// não é cinzento: fica mais fundo e mais rico, como vidro colorido numa sala sem luz.
const FLOOR_DARK = { floorBase: 0.62, floorEdge: 0.50, floorGlass: 0.42 };
const darken = (c, k) => new THREE.Color(c).lerp(new THREE.Color('#121316'), k);
function mix(hex, base, k) { const a = new THREE.Color(hex), b = new THREE.Color(base); return b.lerp(a, k); }
function setDark(on) {
  darkOn = !!on;
  document.body.classList.toggle('dark', darkOn);
  restoreSceneDim(); dimCache.clear(); // the dim twins cache base colours — rebuild them for the new palette
  scene.traverse(o => {
    if (!o.isMesh || !o.userData.part) return;
    const m = o.material; if (!m.userData.base) m.userData.base = m.color.clone();
    if (o.userData.part === 'plinth') m.color.set(darkOn ? DARK.plinth : m.userData.base);
    else if (o.userData.part === 'walkway') m.color.set(darkOn ? DARK.walkway : m.userData.base);
    else if (FLOOR_DARK[o.userData.part] != null) m.color.copy(darkOn ? darken(o.userData.tint, FLOOR_DARK[o.userData.part]) : m.userData.base);
    else if (o.userData.part === 'floorPool') { // a poça de luz fica na cena escura, mais discreta
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
      m.opacity = darkOn ? m.userData.baseOpacity * 0.7 : m.userData.baseOpacity;
    }
    else if (o.userData.part === 'wall') m.color.set(darkOn ? DARK.wall : m.userData.base);
    /* 27 out 2026: as peças novas do adereço e do remate das paredes. O latão no escuro não fica
       cinzento — fica latão velho (um tom mais fundo do mesmo metal), como numa sala sem luz. */
    else if (o.userData.part === 'wallTrim' || o.userData.part === 'dressMetal' || o.userData.part === 'wallSign' || o.userData.part === 'floorInlay') {
      m.color.set(darkOn ? '#7A6242' : m.userData.base);
    }
    else if (o.userData.part === 'wallCap') m.color.set(darkOn ? '#2B2C2A' : m.userData.base);
    else if (o.userData.part === 'wallGlass') m.color.copy(darkOn ? darken(m.userData.base, 0.34) : m.userData.base);
    else if (o.userData.part === 'wallCove') {
      if (m.userData.baseEmissiveIntensity == null) m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      m.emissiveIntensity = darkOn ? m.userData.baseEmissiveIntensity * 1.5 : m.userData.baseEmissiveIntensity;
    }
    else if (o.userData.part === 'dressRug') m.color.set(darkOn ? '#2C2C31' : m.userData.base);
    else if (o.userData.part === 'dressIvory') m.color.set(darkOn ? '#6F6C63' : m.userData.base);
    else if (o.userData.part === 'dress') m.color.set(darkOn ? '#26272C' : m.userData.base);
    else if (o.userData.part === 'dressGlow') {
      if (m.userData.baseEmissiveIntensity == null) m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      m.emissiveIntensity = darkOn ? m.userData.baseEmissiveIntensity * 1.6 : m.userData.baseEmissiveIntensity;
    }
    /* 28 out 2026: o Cérebro como sala e a luz que passa. No escuro o LED não se apaga — é a única
       coisa que continua acesa numa sala sem luz, e é isso que a torna uma sala a sério. */
    else if (o.userData.part === 'wallLed') {
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
      m.opacity = darkOn ? Math.min(1, m.userData.baseOpacity * 1.25) : m.userData.baseOpacity;
    }
    else if (o.userData.part === 'walkwayLed' || o.userData.part === 'hallLed' || o.userData.part === 'hallSpot') {
      if (m.userData.baseEmissiveIntensity == null) m.userData.baseEmissiveIntensity = m.emissiveIntensity || 1;
      if (m.emissive) m.emissiveIntensity = darkOn ? m.userData.baseEmissiveIntensity * 1.5 : m.userData.baseEmissiveIntensity;
    }
    else if (o.userData.part === 'hallRing') m.color.set(darkOn ? '#7A6242' : m.userData.base);
    /* 28 out 2026 (1.13.1): a porta da sala. De noite o latão fica velho, o vidro escurece, e a
       luz da entrada — como o LED das paredes — é a última coisa que se apaga. */
    else if (o.userData.part === 'entranceFrame') m.color.set(darkOn ? '#6E583A' : m.userData.base);
    else if (o.userData.part === 'entranceSill') m.color.set(darkOn ? '#111216' : m.userData.base);
    else if (o.userData.part === 'entranceLed') {
      if (m.userData.baseEmissiveIntensity == null) m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      m.emissiveIntensity = darkOn ? m.userData.baseEmissiveIntensity * 1.45 : m.userData.baseEmissiveIntensity;
    } else if (o.userData.part === 'entranceGlass') {
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
      m.opacity = darkOn ? Math.min(0.5, m.userData.baseOpacity * 1.35) : m.userData.baseOpacity;
      m.color.copy(darkOn ? darken(m.userData.base, 0.45) : m.userData.base);
    } else if (o.userData.part === 'entranceSpill') {
      if (m.userData.baseOpacity == null) m.userData.baseOpacity = m.opacity;
      m.opacity = darkOn ? m.userData.baseOpacity * 1.25 : m.userData.baseOpacity;
    /* 28 out 2026 (1.13.2): o ANTEPARO e a PRAÇA. O painel do anteparo é marfim — de noite desce
       como a parede; a praça é pedra, e fica um tom abaixo do chão para o latão do aro saltar. */
    } else if (o.userData.part === 'entrancePanel') {
      m.color.set(darkOn ? '#6F6C63' : m.userData.base);
    }
    // 26 out 2026: uma mesa preta sobre um fundo escuro desaparecia. No escuro, o corpo sobe um
    // tom (grafite) e o LED fica mais intenso — é assim que uma secretária com luz se comporta.
    else if (o.userData.part === 'desk') m.color.set(darkOn ? '#2E3138' : m.userData.base);
    else if (o.userData.part === 'deskMatte') m.color.set(darkOn ? '#23252A' : m.userData.base);
    else if (o.userData.part === 'deskLed') {
      if (m.userData.baseEmissiveIntensity == null) m.userData.baseEmissiveIntensity = m.emissiveIntensity;
      m.emissiveIntensity = darkOn ? m.userData.baseEmissiveIntensity * 1.45 : m.userData.baseEmissiveIntensity;
    }
  });
  hemi.color.set(darkOn ? 0x8e95a3 : 0xfdfff8); hemi.groundColor.set(darkOn ? 0x14151a : 0xd8d4c8); hemi.intensity = darkOn ? 0.75 : 0.85;
  key.color.set(darkOn ? 0xe4e9f2 : 0xfff1dd); key.intensity = darkOn ? 1.5 : 2.2;
  ground.material.opacity = darkOn ? 0.35 : 0.13;
  if (focused && focused !== 'brain') applySceneDim(focused);
  if (brain) brain.setTheme(darkOn);
  mcp.setDark(darkOn);
}

// double-click empty space → straight back to overview
canvas.addEventListener('dblclick', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  if (!ray.intersectObjects(clickTargets, false).length) zoomOut();
});

// on-screen zoom controls
function zoomStep(f) {
  flyTo([view.target.x, 0, view.target.z], clamp(view.zoom * f, 0.72, 5.2), 350);
  if (view.zoom * f < 1.6 && focused) {
    if (focused === 'brain') focused = null; else exitFocus(false);
  }
  syncOverviewBtn();
}
document.getElementById('zIn').addEventListener('click', () => zoomStep(1.5));
document.getElementById('zOut').addEventListener('click', () => zoomStep(1 / 1.5));
document.getElementById('zHome').addEventListener('click', zoomOut);
document.getElementById('zTerm')?.addEventListener('click', () => forgeTerm.toggle());

/* ---------- 1.53.0 · OS ÂNGULOS DA CÂMARA ----------
   Dois botões que rodam um quarto de volta e um que dá a vista aérea. O rótulo do meio diz sempre
   onde estamos («NE · 90°»), para se saber que há mais do que uma vista e em qual se está. A
   rotação é animada (380 ms, a mesma curva da casa): uma câmara que salta deixa de se perceber. */
let angleAnim = null;
function animarAngulo(paraYaw, paraTilt, dur = 380) {
  if (paraYaw == null) paraYaw = view.yaw;
  if (paraTilt == null) paraTilt = view.tilt;
  // o caminho mais curto: de 350° para 10° são 20°, não 340°
  const delta = Math.atan2(Math.sin(paraYaw - view.yaw), Math.cos(paraYaw - view.yaw));
  angleAnim = { t0: performance.now(), dur, yaw0: view.yaw, dYaw: delta, tilt0: view.tilt, tilt1: paraTilt };
  const passo = (t) => {
    if (!angleAnim) return;
    const k = Math.min(1, (t - angleAnim.t0) / angleAnim.dur);
    const e = bezier(k);
    view.yaw = rodar(angleAnim.yaw0, angleAnim.dYaw * e);
    view.tilt = angleAnim.tilt0 + (angleAnim.tilt1 - angleAnim.tilt0) * e;
    applyCamera();
    syncAngleBtn();
    if (k < 1) requestAnimationFrame(passo); else angleAnim = null;
  };
  requestAnimationFrame(passo);
}
function virarAngulo(sentido = 1) {
  tween = null; view.arc = 0; angleAnim = null;
  animarAngulo(proximoAngulo(view.yaw, sentido).yaw, view.tilt);
}
function virarAerea() {
  tween = null; view.arc = 0; angleAnim = null;
  animarAngulo(view.yaw, view.tilt >= 1.7 ? INCLINACAO_BASE : AEREA.inclinacao);
}
/* Volta à direcção isométrica da casa (yaw 0, inclinação 0.92), animado. Devolve `false` se já
   lá estava, para não haver rodopio de meio grau a cada clique. */
function voltarAoIso(dur = 380) {
  const jaEmCasa = Math.abs(view.yaw) < 1e-3 && Math.abs(view.tilt - INCLINACAO_BASE) < 1e-3;
  if (jaEmCasa) return false;
  animarAngulo(0, INCLINACAO_BASE, dur);
  return true;
}
function syncAngleBtn() {
  const b = document.getElementById('zAngle');
  if (b) b.textContent = etiquetaDoAngulo(view.yaw, view.tilt);
  const a = document.getElementById('zAerea');
  if (a) a.classList.toggle('on', view.tilt >= 1.7);
}
document.getElementById('zLeft')?.addEventListener('click', () => virarAngulo(-1));
document.getElementById('zRight')?.addEventListener('click', () => virarAngulo(1));
document.getElementById('zAngle')?.addEventListener('click', () => virarAngulo(1));
document.getElementById('zAerea')?.addEventListener('click', virarAerea);
/* teclado: [ e ] rodam; 9 dá a vista aérea; 0 endireita a câmara (0 continua a ser a visão geral) */
addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '[') { e.preventDefault(); virarAngulo(-1); }
  else if (e.key === ']') { e.preventDefault(); virarAngulo(1); }
  else if (e.key === '9') { e.preventDefault(); virarAerea(); }
  else if (e.key === '0') { e.preventDefault(); voltarAoIso(380); }
});
syncAngleBtn();

function zoomToDept(k) { enterFocus(k); }
function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null;
  flyTo(overviewPos(), OVERVIEW.zoom, 550);
  /* 1.53.0: «vista geral» devolve TAMBÉM o ângulo de origem. Quem rodou para SO e subiu à vista
     aérea, ao voltar ao geral tem de reencontrar a isométrica de sempre — senão a câmara ficava
     torcida e sem botão para a endireitar. */
  voltarAoIso(550);
  syncOverviewBtn();
}
document.getElementById('overviewBtn').addEventListener('click', zoomOut);
function syncOverviewBtn() {
  document.getElementById('overviewBtn').classList.toggle('show',
    (view.zoom > 1.45 && !(tween && tween.toZ <= OVERVIEW.zoom + 0.05)) || !!focused);
}

/* ---------- focus rail: dept billboard + activity rows; agent CHAT & ACTIVITY slide-over ---------- */
const chatHist = {};
const rail = document.getElementById('rail');
const vignette = document.getElementById('vignette');
const mMsgs = document.getElementById('mMsgs');
let modalOpen = null, modalTab = 'chat'; // modalOpen = agent id open in the rail slide-over
// V3.3: the rail docks LEFT for every department — the task panel has the right side
const RAIL_SIDE = { marketing: 'left', emails: 'left', sales: 'left', ops: 'left', fin: 'left', delivery: 'left' };
const SCREEN_RIGHT = new THREE.Vector3(1, 0, -1).normalize();

function ensureChat(id) {
  if (chatHist[id]) return;
  const a = agentInfo(id);
  // sem texto de exemplo: diz quem é (nome e função reais) e como se trabalha aqui
  chatHist[id] = [
    { who: 'agent', text: `${a.role || 'Agente'} · ${a.deptName}. ${a.tagline || ''} Escreve aqui em baixo, ou abre «Ao vivo» para ver o que está registado.` },
  ];
}
function chatPush(id, msg) {
  ensureChat(id);
  chatHist[id].push(msg);
  if (chatHist[id].length > 80) chatHist[id].splice(2, 1);
  if (modalOpen === id && modalTab === 'chat') renderChat(id);
}
function renderChat(id) {
  const r = R[id];
  mMsgs.innerHTML = chatHist[id].map((m, i) => {
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}${m.meta ? `<div class="m-meta">${esc(m.meta)}</div>` : ''}</div>`;
    if (m.who === 'user') return `<div class="m-user">${esc(m.text)}${m.meta ? `<div class="m-meta">${esc(m.meta)}</div>` : ''}</div>`;
    if (m.who === 'work') return `<div class="m-work"><span class="wi">${m.i || '▸'}</span>${esc(m.text)}</div>`;
    if (m.who === 'file') return `
      <div class="m-file" data-i="${i}">
        <div class="f-head"><span>${m.icon}</span><div><div class="f-name">${esc(m.name)}</div><div class="f-meta">${esc(m.meta)}</div></div></div>
        <pre>${esc(m.content)}</pre>
      </div>`;
    if (m.who === 'appr') return `
      <div class="m-appr" data-i="${i}">
        <div class="a-who">precisa da tua aprovação</div>
        <div class="a-ask">${esc(m.text)}</div>
        ${m.mock ? `<div class="a-mock">${m.mock}</div>` : ''}
        ${m.pending
          ? '<div class="a-btns"><button class="a-yes">APROVAR</button><button class="a-no">REJEITAR</button></div>'
          : `<div class="a-done">${m.approved ? '✓ Aprovado' : '✗ Rejeitado'} pelo proprietário</div>`}
      </div>`;
    return '';
  }).join('');
  mMsgs.querySelectorAll('.m-file').forEach(el =>
    el.addEventListener('click', () => el.classList.toggle('exp')));
  mMsgs.querySelectorAll('.m-appr .a-yes').forEach(el =>
    el.addEventListener('click', () => resolveApproval(id, true)));
  mMsgs.querySelectorAll('.m-appr .a-no').forEach(el =>
    el.addEventListener('click', () => resolveApproval(id, false)));
  mMsgs.scrollTop = mMsgs.scrollHeight;
}
// 26 out 2026: a aba ATIVIDADE passa a ser o painel de inspeção — identidade, estado operacional,
// atividade real, monitor, verificações, artefactos, histórico e eventos. O que não existe é dito
// por palavras (o painel faz isso); os números de exemplo que aqui estavam foram retirados.
function renderActivity(id) {
  liveUi.renderPanel(id, agentInfo(id));
}
function renderLiveChip(id) {
  const chip = document.getElementById('mhLive');
  if (!chip) return;
  const d = liveUi.forAgent(id);
  const st = d ? (liveUi.status() === 'stale' || liveUi.status() === 'off' ? 'stale' : d.state) : 'off';
  chip.dataset.s = st;
  chip.hidden = false;
  const label = ({ live: 'AO VIVO', waiting: 'À ESPERA', error: 'FALHOU', idle: 'SEM TAREFA', stale: 'DESATUALIZADO' }[st] || 'SEM DADOS');
  chip.innerHTML = `<span class="d"></span>${label}<span class="t">${esc(d?.task?.title || d?.last?.title || 'sem tarefa registada')}</span>`;
  chip.title = 'Abrir o painel ao vivo deste posto';
}
document.getElementById('mhLive')?.addEventListener('click', () => setTab('live'));
/* camera target offset so the pod sits beside the rail, not behind it */
function focusTarget(k, atPos) {
  const base = atPos ? [atPos.x, 0, atPos.z] : [LAYOUT[k].pos[0], 0, LAYOUT[k].pos[1] + 1];
  const boardW = (tasks ? tasks.panelWidth() : 400) + 30; // V3.3: the task panel is always on the right
  const zoom = atPos ? 3.3 : 2.5;
  const pxPerWorld = zoom * innerHeight / (2 * FR);
  const railW = Math.min(400, innerWidth * 0.92);
  // pod sits in the middle of whatever screen is left: rail on one side, board (if open) on the other
  const shift = ((railW - boardW) / 2 + (boardW ? 0 : 30)) / pxPerWorld;
  const dir = RAIL_SIDE[k] === 'left' ? -shift : shift;
  return { pos: [base[0] + SCREEN_RIGHT.x * dir, 0, base[2] + SCREEN_RIGHT.z * dir], zoom };
}
function enterFocus(k, pendingAgentId) {
  if (k === 'brain') { // the Brain keeps its plain fly-in (AJ's call)
    focused = 'brain';
    if (tasks) tasks.onFocusChange('brain');
    flyTo([LAYOUT.brain.pos[0], 0, LAYOUT.brain.pos[1] + 1.5], 3.1, 700);
    syncOverviewBtn();
    return;
  }
  if (focused === k && !pendingAgentId) return;
  if (focused && focused !== k) {
    rail.classList.remove('open', 'agentOpen'); modalOpen = null;
    // dept → dept without passing through overview: the old billboard was hidden when it flew into the
    // rail (flyBillboardIntoRail) and only exitFocus restores it — bring it back or it stays gone (AJ, 15 Sep)
    if (focused !== 'brain' && deptRT[focused] && deptRT[focused].badge) deptRT[focused].badge.style.display = '';
  }
  focused = k;
  if (tasks) tasks.onFocusChange(k);
  focusDimTarget = 1;
  applySceneDim(k);
  vignette.classList.add('on');
  const t = focusTarget(k);
  flyTo(t.pos, t.zoom, 950, {
    arc: RAIL_SIDE[k] === 'left' ? 0.10 : -0.10,
    onDone: () => { if (pendingAgentId) openAgentRail(pendingAgentId, pendingTab, true); pendingTab = 'chat'; },
  });
  buildDeptRail(k);
  rail.className = RAIL_SIDE[k];
  rail.style.display = 'block';
  document.body.classList.toggle('railLeft', RAIL_SIDE[k] === 'left'); // the Sahni.ai mark steps right of a docked-left rail
  // V3.4: the rail IS the chat — it opens on the department lead (or first agent) at once
  // (after the className reset above, which would otherwise drop the agentOpen state)
  const first = pendingAgentId || (AGENTS.find(x => x.dept === k && x.lead) || AGENTS.find(x => x.dept === k)).id;
  openAgentRail(first, pendingAgentId ? pendingTab : 'chat', false);
  document.getElementById('overviewBtn').classList.toggle('right', RAIL_SIDE[k] === 'left');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    rail.classList.add('open');
    flyBillboardIntoRail(k);
    cascadeRows();
  }));
  syncOverviewBtn();
}
function exitFocus(flyOut = true) {
  if (!focused) return;
  const k = focused;
  focused = null;
  modalOpen = null;
  if (tasks) tasks.onFocusChange(null);
  focusDimTarget = 0;
  vignette.classList.remove('on');
  rail.classList.remove('open', 'agentOpen');
  document.body.classList.remove('railLeft');
  setTimeout(() => { if (!focused) rail.style.display = 'none'; }, 650);
  document.getElementById('overviewBtn').classList.remove('right');
  if (k !== 'brain' && deptRT[k] && deptRT[k].badge) deptRT[k].badge.style.display = '';
  if (flyOut) flyTo(overviewPos(), OVERVIEW.zoom, 700);
  syncOverviewBtn();
}
function buildDeptRail(k) {
  const dept = DEPTS[k];
  const n = AGENTS.filter(a => a.dept === k).length;
  const rh = document.getElementById('railHeader');
  rh.classList.remove('show');
  rh.innerHTML = `
    <div class="b-name"><span class="dot" style="background:${dept.chip}"></span>${dept.name}<span class="live"></span></div>
    <div class="b-count"><span class="b-num">${n}</span><span class="b-lab">AGENTES</span></div>
    <div class="b-metrics">${BB_ROWS[k].map((row, i) => `
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-rm="${k}-${i}">${row[1]()}</span></div>`).join('')}</div>
    ${tasks ? tasks.rowHTML(k) : ''}
    <button type="button" class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}" aria-label="decisões à tua espera nesta sala — abrir a primeira">⚠ <span class="ap-n">${stuckIn(k).length}</span> <span class="ap-t">À ESPERA DE APROVAÇÃO</span></button>`;
  const trow = rh.querySelector('.b-tasks');
  if (trow) trow.addEventListener('click', () => tasks.toggle());
  rh.querySelector('.b-appr').addEventListener('click', () => {
    const s = stuckIn(k)[0];
    if (s) openAgentRail(s.a.id);
  });
  // V3.7 (AJ, 6 Sep): the agent-chip strip is gone — click an agent in the scene to talk to them
}
function cascadeRows() {
  document.querySelectorAll('#railRows .arow').forEach((el, i) => {
    el.style.transitionDelay = (280 + i * 85) + 'ms';
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => { el.style.transitionDelay = '0ms'; }, 1600);
  });
}
/* the floating billboard physically FLIES and docks as the rail header (the hero beat) */
function flyBillboardIntoRail(k) {
  const badge = deptRT[k].badge;
  const from = badge.getBoundingClientRect();
  badge.style.display = 'none';
  const side = RAIL_SIDE[k];
  const railW = rail.offsetWidth;
  const tLeft = side === 'left' ? 18 : innerWidth - railW + 18;
  const clone = badge.cloneNode(true);
  clone.style.cssText = `position:fixed;box-sizing:border-box;left:${from.left}px;top:${from.top}px;` +
    `width:${from.width}px;margin:0;transform:none;transition:all .72s var(--ease);z-index:40;pointer-events:none;opacity:1;`;
  document.body.appendChild(clone);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    clone.style.left = tLeft + 'px';
    clone.style.top = (52 + 18) + 'px';
    clone.style.width = (railW - 36) + 'px';
  }));
  setTimeout(() => {
    clone.remove();
    document.getElementById('railHeader').classList.add('show');
  }, 740);
}
function openAgentRail(id, tab = 'chat', fly = true) {
  const r = R[id];
  ensureChat(id);
  modalOpen = id;
  const dept = DEPTS[r.a.dept];
  document.querySelector('#railAgent .mh-dot').style.background = dept.chip;
  document.querySelector('#railAgent .mh-name').innerHTML =
    (r.a.lead ? '<span class="star">★ </span>' : '') + r.a.name;
  const info = agentInfo(id);
  document.querySelector('#railAgent .mh-role').textContent = `${info.role} · ${dept.name}`;
  document.querySelector('#railAgent .mh-tag').textContent = info.tagline;
  document.getElementById('mChips').innerHTML = ['O que estás a fazer?', 'O que tenho à espera?', 'Que ferramentas podes usar?'].map(c =>
    `<button>${esc(c)}</button>`).join('');
  document.getElementById('mChips').querySelectorAll('button').forEach(b =>
    b.addEventListener('click', () => sendChat(b.textContent)));
  rail.classList.add('agentOpen');
  renderLiveChip(id);
  setTab(tab);
  if (tasks && tasks.railFor) tasks.railFor(id); // V3.5: the agent's routines strip
  if (fly) { const t = focusTarget(r.a.dept, r.seat); flyTo(t.pos, t.zoom, 500); }
}
// V3: the board opening/closing re-centres the pod without leaving focus
function reframe() {
  if (!focused || focused === 'brain' || modalOpen) return;
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 600);
}
function railBack() { // V3.4: "back" = back to the pod view, chat stays on the lead
  if (!focused || focused === 'brain') return;
  const lead = AGENTS.find(x => x.dept === focused && x.lead) || AGENTS.find(x => x.dept === focused);
  openAgentRail(lead.id, 'chat', false);
  const t = focusTarget(focused);
  flyTo(t.pos, t.zoom, 500);
}
document.getElementById('railBack').addEventListener('click', railBack);
let pendingTab = 'chat';
// compat entry point (person clicks, pills, CC export): route through focus mode
function openAgent(id, tab = 'chat') {
  const dept = R[id].a.dept;
  if (focused === dept) { openAgentRail(id, tab); return; }
  pendingTab = tab;
  enterFocus(dept, id);
}
function setTab(tab) {
  const live = tab === 'live' || tab === 'activity';
  modalTab = live ? 'live' : 'chat';
  document.querySelectorAll('#rail .mtabs button').forEach(b =>
    b.classList.toggle('on', (b.dataset.tab === 'live') === live));
  document.getElementById('mChat').style.display = live ? 'none' : 'flex';
  document.getElementById('mAct').style.display = live ? 'flex' : 'none';
  if (live) renderActivity(modalOpen); else renderChat(modalOpen);
}
document.querySelectorAll('#rail .mtabs button').forEach(b =>
  b.addEventListener('click', () => setTab(b.dataset.tab)));
/* ---------- enviar (27 out 2026) ----------
   O compositor escolhe modo, modelo, esforço, anexos e contexto; esta função entrega-os ao
   servidor e mostra o que ele respondeu. Nada acontece a fingir: «Construir» cria mesmo uma
   tarefa na base de dados, «Planear» pede um plano ao motor sem ferramentas, e o resto é a
   conversa de sempre. O que correu volta por baixo da resposta (modelo · esforço · modo). */
const CHAT_MODES = ['ask', 'plan', 'build'];
/* 1.50.0 · a mesma leitura honesta de falhas que a barra de tarefas usa: um 404
   em HTML nunca mais é explicado como «sem motor de IA» (ver src/falhas.js). */
function dropWork(id, text) {
  const h = chatHist[id] || [];
  const k = h.findIndex(m => m.who === 'work' && m.text === text);
  if (k >= 0) h.splice(k, 1);
}
async function buildFromChat(id, text, m) {
  const r = R[id];
  if (!tasks || !tasks.isLive()) throw new Error('Construir precisa do servidor: uma tarefa criada só no ecrã seria ficção. Arranca o Órbita com «npm start».');
  const line = 'A criar a tarefa no quadro…';
  chatPush(id, { who: 'work', i: '…', text: line });
  try {
    const res = await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dept: r.a.dept, text, run: true, model: m.auto ? undefined : (m.model || undefined), effort: m.auto ? undefined : (m.effort || undefined) }) });
    const lido = lerCorpo(await res.text());
    dropWork(id, line);
    if (!res.ok) {
      const f = explicarFalha({ status: res.status, texto: lido.texto, json: lido.json, rota: '/api/tasks' });
      throw Object.assign(new Error(f.detalhe || f.frase), { falha: f });
    }
    const st = lido.json || {};
    if (!st.id) {
      const f = explicarFalha({ status: res.status, texto: lido.texto, json: lido.json, rota: '/api/tasks' });
      throw Object.assign(new Error(f.detalhe || f.frase), { falha: f });
    }
    const who = R[st.agent]?.a?.name || st.agent;
    if (spawnEmote && R[st.agent]) spawnEmote(R[st.agent], '📋');
    /* o servidor devolve o modelo que ficou na tarefa: `sonnet|opus|fable` ou o par
       `fornecedor|modelo` da IA da Órbita. `modelName()` sabe ler os dois. */
    const mdl = st.model ? modelName(st.model) : null;
    chatPush(id, { who: 'agent', text: `Tarefa criada — «${st.title}» ficou com ${who}${st.why ? ' (' + st.why + ')' : ''}. Está no quadro com o id ${st.id} e já está a correr; o resultado cai aqui e na nota do Cérebro.`, meta: 'Construir · ' + (mdl || 'modelo do escritório') });
    if (tasks.refresh) tasks.refresh();
    composer?.toast('Tarefa criada no quadro.', 'ok');
  } catch (e) {
    dropWork(id, line);
    const f = e.falha || explicarFalha({ status: 0, texto: '', rota: '/api/tasks', erro: e.message });
    throw Object.assign(new Error('Não foi criada. ' + f.frase + (f.detalhe ? ' — ' + f.detalhe : '') + ' ' + f.ajuda), { falha: f });
  }
}
/* 1.51.0 · a conversa com a IA da Órbita.
   Quando a escolha do compositor é um par fornecedor|modelo (a lista real de
   /ia/modelos), o caminho do servidor local não serve: `/api/chat` é o motor do
   CLI desta máquina e não existe na página publicada. Vai por `/api/rpc` →
   `POST /ia/chat`, que é o mesmo sítio onde a mesa conversa. O esforço escolhido
   vira o tecto de tokens (o servidor diz quanto); quem respondeu volta escrito. */
async function sendChatOrbita(id, texto, m, par) {
  const r = R[id];
  /* o histórico já leva esta mensagem (foi escrita antes de chegar aqui): tira-se a última,
     senão a IA lia a pergunta duas vezes */
  const anteriores = [...(chatHist[id] || [])];
  const ultima = anteriores[anteriores.length - 1];
  if (ultima && ultima.who === 'user' && ultima.text === texto) anteriores.pop();
  const hist = anteriores.filter(x => x.who === 'user' || x.who === 'agent')
    .slice(-8).map(x => ({ role: x.who === 'agent' ? 'assistant' : 'user', content: x.text }));
  const agente = agenteDaOrbita(r?.a || {});
  /* A rota /ia/chat leva uma mensagem (máx. 8000 caracteres), não um envelope de
     ficheiros: os anexos entram no texto, e o que não couber é dito — nunca
     desaparece em silêncio. O @Cérebro é do servidor local (as notas da casa);
     nesta via a IA da Órbita usa a memória dela, e isso também é dito. */
  const { mensagem, cortados } = juntarAnexos(texto, m.files || []);
  if (cortados) composer?.toast(`A mensagem passou do limite de 8000 caracteres: ${cortados} anexo(s) ficaram de fora.`, 'err');
  if ((m.context || []).length) composer?.toast('As notas do Cérebro são do servidor local. Aqui a IA da Órbita usa a memória dela — esta resposta não leu essas notas.', '');
  const line = `${R[id]?.a?.name || 'O agente'} está a pensar`;
  chatPush(id, { who: 'work', i: '…', text: line });
  try {
    const res = await fetch('/api/rpc', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpoDaOrbita({ agente, mensagem, historico: hist, par, esforco: m.effort })),
    });
    const lido = lerCorpo(await res.text());
    dropWork(id, line);
    if (!res.ok) {
      const f = explicarFalha({ status: res.status, texto: lido.texto, json: lido.json, rota: '/api/rpc' });
      throw Object.assign(new Error(f.detalhe || f.frase), { falha: f });
    }
    const out = lerRespostaOrbita(lido.json, par);
    if (!out.ok) {
      chatPush(id, { who: 'agent', text: `Não consigo responder. O servidor respondeu: ${out.erro}.${par ? ` A escolha foi ${par.fornecedor} · ${par.modelo}.` : ''}` });
      composer?.toast(out.erro, 'err');
      return;
    }
    chatPush(id, { who: 'agent', text: out.texto, meta: out.meta });
    /* a escolha fica para a próxima: o agente guarda o par no servidor */
    if (par) saveEscolha(agente, par);
  } catch (e) {
    dropWork(id, line);
    const f = e.falha || explicarFalha({ status: 0, texto: '', rota: '/api/rpc', erro: e.message });
    chatPush(id, { who: 'agent', text: `Não consigo responder. ${f.frase}${f.detalhe ? ` — ${f.detalhe}` : ''} ${f.ajuda}` });
    throw e;
  }
}
/* A escolha não se perde ao mudar de agente: fica no agente, no servidor
   (PATCH /ia/config). Se a gravação falhar, a conversa continua — e é dito. */
let escolhaAVisar = false;
async function saveEscolha(agente, par) {
  if (escolhaAVisar) return;
  escolhaAVisar = true;
  try {
    await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ caminho: '/ia/config', metodo: 'PATCH', corpo: { agentes: { [agente]: { fornecedor: par.fornecedor, modelo: par.modelo } } } }) });
  } catch { /* a conversa não depende disto */ }
  setTimeout(() => { escolhaAVisar = false; }, 30000);
}
async function sendChat(text, meta = {}) {
  const id = modalOpen;
  const clean = String(text || '').trim();
  if (!id || !clean) return;
  const r = R[id];
  const m = {
    mode: CHAT_MODES.includes(meta.mode) ? meta.mode : 'ask',
    auto: meta.auto !== false,
    model: meta.model || '',
    effort: meta.effort || '',
    files: Array.isArray(meta.files) ? meta.files.slice(0, 5) : [],
    context: Array.isArray(meta.context) ? meta.context : [],
  };
  const par = m.auto ? null : dividirModelo(m.model);
  if (m.mode === 'build') {
    chatPush(id, { who: 'user', text: clean });
    /* construir cria uma tarefa no quadro, e o quadro só existe com o servidor local */
    if (par) {
      chatPush(id, { who: 'agent', text: 'Construir precisa do quadro de tarefas, que vive no servidor local (npm start). Com a IA da Órbita escolhida podes conversar e planear aqui; para criar a tarefa, abre o Órbita no teu computador ou usa a Mesa.' });
      return;
    }
    return buildFromChat(id, clean, m);
  }

  const hist = (chatHist[id] || []).filter(x => x.who === 'user' || x.who === 'agent').slice(-8).map(x => ({ who: x.who, text: x.text }));
  chatPush(id, { who: 'user', text: clean });

  if (m.mode === 'ask') { // os atalhos da casa só valem a perguntar: planear e construir não mexem em nada por baixo
    const low = clean.toLowerCase();
    if (tasks && tasks.pendingReject(id)) { tasks.rejectLive(id, clean); return; } // V3.5: a linha depois de REJECT é a nota com que o agente refaz
    if (r.state === 'stuck' && /\b(approve|reject)\b/.test(low)) { resolveApproval(id, /approve/.test(low)); return; }
    const rv = tasks && tasks.isLive() && clean.match(/^\s*revise\s*[:\-–]\s*(.+)$/i); // LIVE: "revise: …" corre outra vez a última entrega
    if (rv && tasks.revise(id, rv[1].trim())) { chatPush(id, { who: 'agent', text: 'Já vou — a rever agora. Aparece aqui quando estiver pronto.' }); return; }
    const tr = tasks && tasks.handleChat(id, clean); // "adicionar tarefa: …" / "o que está no quadro"
    if (tr) { chatPush(id, { who: 'agent', text: tr }); return; }
  }

  /* 1.51.0 · quando a página não tem motor local (é o caso da publicada), o «automático»
     não pode bater em `/api/chat` — a Órbita responde por /api/rpc e o router escolhe. */
  const est = (composer && composer.state ? composer.state() : {}) || {};
  const temCli = Array.isArray(est.health?.models) && est.health.models.length > 0;
  const temOrbita = (est.catalogo?.modelos || []).length > 0;
  if (par || (!temCli && temOrbita)) return sendChatOrbita(id, clean, m, par);

  const line = m.mode === 'plan' ? `${r.a.name} está a preparar o plano` : `${r.a.name} está a pensar`;
  chatPush(id, { who: 'work', i: '…', text: line });
  try {
    const res = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: id, ...chatBody({ text: clean, mode: m.mode, model: m.model, effort: m.effort, auto: m.auto, files: m.files, context: m.context, history: hist }) }) });
    /* 1.50.0 · a mesma leitura honesta da barra: um 404 em HTML não é «sem motor» */
    const lido = lerCorpo(await res.text());
    dropWork(id, line);
    if (!res.ok) {
      const f = explicarFalha({ status: res.status, texto: lido.texto, json: lido.json, rota: '/api/chat' });
      throw Object.assign(new Error(f.detalhe || f.frase), { falha: f });
    }
    const j = lido.json || {};
    if (!j.reply) {
      const f = explicarFalha({ status: res.status, texto: lido.texto, json: lido.json, rota: '/api/chat' });
      throw Object.assign(new Error(f.detalhe || f.frase), { falha: f });
    }
    chatPush(id, { who: 'agent', text: j.reply, meta: metaLine(j, m) });
    if (j.routines && tasks.refresh) tasks.refresh(); // uma rotina foi criada, pausada ou apagada na conversa
    if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
    if (j.tools && j.tools.length) mcp.onToolsUsed(id, j.tools);
    if (j.contextIgnored && j.contextIgnored.length) composer?.toast(`O servidor não conhece @${j.contextIgnored.join(', @')} — não foi enviado.`, 'err');
  } catch (e) {
    dropWork(id, line);
    /* 1.50.0 · a frase diz o que falhou: a rota ausente, o motor, ou a recusa do
       fornecedor. Antes, tudo caía em «sem motor de IA» — e era mentira sempre
       que a página estava publicada sem servidor. */
    const f = e.falha || explicarFalha({ status: 0, texto: '', rota: '/api/chat', erro: e.message });
    chatPush(id, { who: 'agent', text: `Não consigo responder. ${f.frase}${f.detalhe ? ` — ${f.detalhe}` : ''} ${f.ajuda}` });
    throw e;
  }
}
/* ---------- o compositor (27 out 2026) ----------
   O cartão substitui o campo de uma linha. Toda a lógica de desenho e de teclado vive em
   src/composer.js; aqui só se liga o envio. */
const composer = initComposer({ onSubmit: (text, meta) => sendChat(text, meta) });
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
}

/* ---------- approvals: agent STUCK → amber billboard row → chat approval message ---------- */
/** Uma aprovação só existe quando a base de dados tem uma tarefa `awaiting_approval` para este
 *  posto: quem chama é `syncFromLive()`, nunca um temporizador. */
function requestApproval(id, ask) {
  const r = R[id];
  if (!r) return;
  const d = liveUi.forAgent(id);
  const real = d && d.task && d.task.state === 'awaiting_approval';
  if (!real) return;
  r.state = 'stuck';
  r.ask = ask || `«${d.task.title}» está à espera da tua aprovação`;
  if (r.warn) r.warn.visible = true;
  chatPush(id, { who: 'appr', text: r.ask, pending: true, opsTask: d.task.id });
  syncApprovals();
}
// V3.5: a routine o rascunho está à espera do proprietário's OK — the agent stands and waves like any approval; the chat already holds the draft card
function setStuckLive(id, ask, sid) {
  const r = R[id]; if (!r) return;
  r.state = 'stuck'; r.ask = ask; r.liveSid = sid; r.warn.visible = true;
  syncApprovals();
}
function resolveApproval(id, approved) {
  const r = R[id];
  if (!r || r.state !== 'stuck') return;
  const msg = chatHist[id] && [...chatHist[id]].reverse().find(m => m.who === 'appr' && m.pending);
  // a decisão é registada na base de dados: é a rota da operação que aprova ou rejeita a tarefa
  if (msg && msg.opsTask) {
    fetch(`/api/ops/tarefas/${encodeURIComponent(msg.opsTask)}/${approved ? 'aprovar' : 'rejeitar'}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
      .then(async res => { const j = await res.json().catch(() => ({})); if (!res.ok) throw new Error(j.error || res.statusText); return j; })
      .then(() => { msg.pending = false; msg.approved = approved; r.state = 'working'; r.ask = null; if (r.warn) r.warn.visible = false; liveUi.refresh(); syncApprovals(); renderChat(id); renderActivity(id); })
      .catch(e => chatPush(id, { who: 'agent', text: `Não consegui registar a decisão: ${e.message}` }));
    return;
  }
  r.state = 'working';
  r.ask = null;
  r.warn.visible = false;
  if (msg) { msg.pending = false; msg.approved = approved; }
  // visible reaction in the scene: cheer + ✅, or slump + ❌
  const now = performance.now();
  if (approved) r.cheerUntil = now + 2400; else r.slumpUntil = now + 2600;
  spawnEmote(r, approved ? '✅' : '❌');
  if (r.liveSid) { r.liveSid = null; if (tasks) tasks.resolveLive(id, approved); syncApprovals(); return; } // live: APPROVE sends, REJECT asks for the note
  if (tasks) tasks.onResolve(id, approved);
  chatPush(id, {
    who: 'agent',
    text: approved ? '✓ Aprovado — altero já e registo o resultado na minha atividade.'
                   : '✗ Entendido — em espera. Ajusto e volto com uma versão melhor.',
  });
  syncApprovals();
}
function stuckIn(dept) { return Object.values(R).filter(r => r.state === 'stuck' && r.a.dept === dept); }
function syncApprovals() {
  let total = 0;
  for (const k of DEPT_KEYS) {
    const n = stuckIn(k).length; total += n;
    deptRT[k].apprRow.style.display = n ? 'flex' : 'none';
    deptRT[k].apprN.textContent = n;
  }
  const top = document.getElementById('topAppr');
  top.style.display = total ? 'inline-flex' : 'none';
  top.querySelector('span').textContent = total;
  // mirror into the docked rail header + row status tags
  if (focused && focused !== 'brain') {
    const n = stuckIn(focused).length;
    const rh = document.getElementById('railHeader');
    const ap = rh.querySelector('.b-appr');
    if (ap) { ap.style.display = n ? 'flex' : 'none'; ap.querySelector('.ap-n').textContent = n; }
  }
}
function zoomToApproval(dept) {
  const s = stuckIn(dept)[0];
  if (!s) { enterFocus(dept); return; }
  if (focused === dept) openAgentRail(s.a.id);
  else enterFocus(dept, s.a.id);
}
document.getElementById('topCal').addEventListener('click', () => { if (tasks && tasks.calendar) tasks.calendar.toggle(); }); // V3.2.1: the top-bar calendar button (same as P)
document.getElementById('topAppr').addEventListener('click', () => {
  const s = Object.values(R).find(r => r.state === 'stuck');
  if (s) zoomToApproval(s.a.dept);
});

/* ---------- estados reais → postura na cena ----------
   26 out 2026. O que aqui estava: um simulador que sorteava modos de trabalho, disparava eventos,
   pedia aprovações de 50 em 50 segundos e enchia os cartões com métricas inventadas. Saiu tudo.
   Agora a cena é um espelho do fluxo ao vivo: quem tem trabalho a correr escreve; quem espera uma
   aprovação levanta-se e chama por ti; quem não tem nada está sentado e quieto.                       */
let lastLiveSync = 0;

/** O estado de cada agente vem de `liveUi` (a base de dados), não de um relógio. */
function syncFromLive() {
  for (const [id, r] of Object.entries(R)) {
    const d = liveUi.forAgent(id);
    if (!d) {
      r.liveState = 'idle';
      if (!r.trip) { r.state = 'idle'; if (r.warn) r.warn.visible = false; }
      continue;
    }
    const want = d.state === 'live' ? 'working'
      : d.state === 'waiting' ? 'stuck'
      : d.state === 'error' ? 'error' : 'idle';
    r.liveState = d.state;
    /* 28 out 2026 — OS SINAIS DA CIRCULAÇÃO. Só a base de dados os dá:
         · uma tarefa NOVA a correr numa sala → o chefe vai ao Cérebro buscá-la;
         · alguém à espera de uma decisão → o chefe vai ao Cérebro pedir ajuda.
       O `crew` trata do resto (e ignora repetições do mesmo trabalho). */
    const tid = d.task && d.task.id;
    if (tid) {
      if (d.state === 'live') crew.signal('brief', r.a.dept, tid);
      else if (d.state === 'waiting') crew.signal('help', r.a.dept, tid);
    }
    /* e o terceiro gesto: acabou. O chefe leva o trabalho ao Cérebro — é o «passar o projecto» do
       pedido do dono. Só conta o que acabou nos últimos cinco minutos: uma tarefa de ontem não é
       motivo para ninguém se levantar hoje. */
    const fim = d.last && d.last.state === 'succeeded' && d.last.id;
    if (fim) {
      const quando = d.last.finished_at ? Date.parse(d.last.finished_at) : 0;
      if (Date.now() - quando < 5 * 60 * 1000) crew.signal('handoff', r.a.dept, d.last.id);
    }
    if (r.trip) continue;                                    // a caminho do Cérebro não se muda o estado por baixo dos pés
    if (want === 'stuck' && r.state !== 'stuck') requestApproval(id);       // só quando a base de dados diz que espera
    if (want !== 'stuck' && r.state === 'stuck') { r.state = want; if (r.warn) r.warn.visible = false; syncApprovals(); }
    else r.state = want;
    if (r.warn) r.warn.visible = want === 'stuck' || want === 'error';
  }
  crew.direct(performance.now());
}

/* ---------- emotes ----------
   Um sprite de emoji sobe por cima do posto quando acontece algo real (tarefa atribuída, aprovação,
   erro). 26 out 2026: o bloco foi apagado por engano na limpeza da demonstração, mas continuava a
   ser chamado — e a ReferenceError em `spawnEmote` matava o módulo antes de arrancar o ciclo de
   desenho, deixando a cena em branco. Fica aqui, com a mesma geometria de antes. */
const emoteTex = {};
function getEmoteTex(icon) {
  if (emoteTex[icon]) return emoteTex[icon];
  {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    // cream bubble disc so the icon reads at any zoom
    x.beginPath(); x.arc(64, 60, 52, 0, 7);
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.lineWidth = 3; x.strokeStyle = 'rgba(21,20,20,0.25)'; x.stroke();
    x.beginPath(); x.moveTo(50, 106); x.lineTo(64, 124); x.lineTo(74, 104); x.closePath();
    x.fillStyle = 'rgba(253,255,248,0.97)'; x.fill();
    x.font = '58px "Apple Color Emoji", serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = '#151414';
    x.fillText(icon, 64, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    emoteTex[icon] = t;
  }
  return emoteTex[icon];
}
const emotes = [];
function spawnEmote(r, icon) {
  if (!r || !r.person) return;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getEmoteTex(icon), depthTest: false, transparent: true }));
  const p = r.person.position;
  s.position.set(p.x + 0.7, p.y + 5.6, p.z);
  s.scale.set(2.9, 2.9, 1);
  scene.add(s);
  emotes.push({ s, born: performance.now() });
}
function tickEmotes(now, dt) {
  for (let i = emotes.length - 1; i >= 0; i--) {
    const e = emotes[i], age = (now - e.born) / 1700;
    if (age >= 1) {
      scene.remove(e.s); e.s.material.dispose(); emotes.splice(i, 1);
    } else {
      e.s.position.y += dt * 1.7;
      e.s.material.opacity = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
    }
  }
}

/* ---------- passos e postura: quem vai a pé e quem está sentado ----------
   O passo (`walkStep`) vive agora em src/crew.js — é lá que mora a circulação. */

// standing modes drift the agent from the chair to a spot beside the desk, and can re-face the camera
const FACE_CAM = Math.PI / 4;
function applyStandAndFacing(r, mode, now, dt, face) {
  const u = r.person.userData;
  const sk = (u.cur && u.cur.standK) || 0;
  r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * sk;
  r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * sk;
  if (mode === 'spin') {
    const span = Math.max(400, (r.modeUntil - r.modeStart) || 1500);
    r.person.rotation.y = r.seatRot + ((now - r.modeStart) / span) * Math.PI * 2;
    return;
  }
  // 28 out 2026: `face` = olhar para um ponto (o chefe a explicar, no topo da sala)
  const target = face
    ? Math.atan2(face.x - r.person.position.x, face.z - r.person.position.z)
    : (mode === 'stretch' || mode === 'cheer' || mode === 'wave') ? FACE_CAM : r.seatRot;
  let d = target - r.person.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
}

function tickSim(now, dt) {
  if (now - lastLiveSync > 1200) { lastLiveSync = now; syncFromLive(); }
  for (const r of Object.values(R)) {
    // 28 out 2026: quem está a caminho do Cérebro — ou a explicar ao grupo — é conduzido pelo
    // `crew`. Sai do laço aqui para não haver duas mãos a mexer no mesmo corpo.
    if (r.trip) { crew.tick(r, now, dt); continue; }
    // o grupo levanta-se para ouvir o chefe que voltou do Cérebro (ninguém ouve sentado e calado)
    const hd = crew.huddle(r.a.dept);
    if (hd && r.state !== 'stuck' && r.state !== 'error') {
      poseWork(r.person, 'listen', now + r.bob * 300, dt);
      applyStandAndFacing(r, 'huddle', now, dt, hd);
      if (r.touched.size) driveDesk(r, null, now, 0, dt);
      continue;
    }
    if (r.state === 'working') {
      // A trabalhar de verdade: escreve e, de vez em quando, vai ao rato. As duas coisas são o mesmo
      // gesto — a mão segue o ponto que `deskmap.js` calcula, e o posto responde (tecla a afundar,
      // rato a deslizar). 27 out 2026.
      const phase = (r.bob * 0.137) % 1;
      const mode = Math.sin(now / 5200 + r.bob) > 0.66 ? 'mouse' : 'type';
      const t = now + r.bob * 400;
      const con = deskContact(t, phase, mode);
      // a mão do rato desliza entre o teclado e o rato em vez de saltar (e não prime teclas a caminho)
      const alvo = con.mouse || con.second;
      if (alvo) {
        const k = 1 - Math.exp(-dt * 9);
        r.handOff.x += (alvo.x - r.handOff.x) * k;
        r.handOff.z += (alvo.z - r.handOff.z) * k;
        const emTransito = Math.hypot(alvo.x - r.handOff.x, alvo.z - r.handOff.z) > 0.06;
        alvo.x = r.handOff.x; alvo.z = r.handOff.z;
        if (emTransito && !con.mouse) { alvo.press = 0; alvo.cell = nearestKey(alvo.x, alvo.z); }
      }
      poseWork(r.person, mode, t, dt, con);
      applyStandAndFacing(r, mode, now, dt);
      driveDesk(r, con, t, phase, dt);
      r.mode = mode;
    } else if (r.state === 'stuck') {
      poseWork(r.person, 'wave', now + r.bob * 500, dt);
      applyStandAndFacing(r, 'wave', now, dt);
      const p = r.person.position;
      r.warn.position.set(p.x, p.y + 5.9, p.z);
      const k = 2.6 + Math.sin(now / 240) * 0.5;
      r.warn.scale.set(k, k, 1);
    } else if (r.state === 'error') {
      poseWork(r.person, 'read', now + r.bob * 400, dt);
      applyStandAndFacing(r, 'read', now, dt);
      const p = r.person.position;
      r.warn.position.set(p.x, p.y + 5.9, p.z);
      const k = 2.2 + Math.sin(now / 420) * 0.25;
      r.warn.scale.set(k, k, 1);
    } else {
      // sem tarefa: sentado, sem gestos de trabalho
      poseWork(r.person, 'read', now + r.bob * 200, dt);
      applyStandAndFacing(r, 'read', now, dt);
    }
    // quem não está a trabalhar não deixa uma tecla premida nem a mão no ar
    if (r.state !== 'working' && r.touched.size) driveDesk(r, null, now, 0, dt);
  }
  tickEmotes(now, dt);
  brain.tick(now);
  // monitores: o que mudou no servidor é redesenhado; o resto fica quieto (sem tremor, sem sorteio)
  liveUi.tick(now, view.zoom < 1.4);
}

/* ---------- zoom LOD + HTML overlay projection ---------- */
const v3 = new THREE.Vector3();
function toScreen(p) {
  v3.copy(p).project(camera);
  return [(v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight];
}
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

/* ---------- os cartões das salas: quanto encolhem e como se arrumam ---------- */
/* 30 out 2026 — pedido do dono: «diminui o tamanho dos quadrados de indicação da sala …
   deixa bem responsivo na versão mobile». Duas coisas, e o ecrã grande fica exactamente
   como estava:
   1) `badgeFit()` dá a escala geométrica conforme a largura da janela (1 a partir de 900 px);
   2) em ecrã estreito, `arrumarCartoes()` empurra para baixo quem colidir com outro — os
      cartões deixam de se tapar, e nenhum sai do ecrã (o topo e o fundo são limites). */
function badgeFit(w = innerWidth) {
  if (w >= 900) return 1;                 // secretária: como sempre foi
  if (w <= 400) return 0.88;              // telemóvel estreito
  return 0.88 + 0.12 * ((w - 400) / 500); // 0,88 → 1,00 entre 400 e 900 px
}
function arrumarCartoes(caixas) {
  const gap = 6, topo = 64, fundo = innerHeight - 8;
  const postos = [];
  for (const c of [...caixas].sort((a, b) => (a.top - b.top) || (a.left - b.left))) {
    for (let n = 0; n < 12; n++) {
      const choque = postos.find(p => c.left < p.left + p.bw + gap && c.left + c.bw + gap > p.left
        && c.top < p.top + p.bh + gap && c.top + c.bh + gap > p.top);
      if (!choque) break;
      c.top = choque.top + choque.bh + gap; // empurra para baixo — o cartão continua debaixo da sua sala
    }
    c.top = clamp(c.top, topo, Math.max(topo, fundo - c.bh));
    postos.push(c);
  }
}
function tickLOD() {
  const z = view.zoom;
  const detail = smooth(1.75, 2.5, z);
  const pillA = smooth(1.45, 1.85, z); // pills stay on at near — they name the agents
  // billboards persist at every zoom (v1 rule) — slightly larger when far, compact when near,
  // and smaller again on a narrow window (30 out 2026)
  const badgeScale = (1.02 - 0.3 * smooth(1.2, 2.6, z)) * badgeFit();
  /* V3.3: os cartões nunca ficam por baixo do painel das tarefas. No telemóvel o painel é uma
     folha em baixo (não uma coluna à direita): descontar a largura dele empurrava os sete
     cartões todos para a margem esquerda. Aí o limite é a janela inteira (30 out 2026). */
  const rightEdge = innerWidth <= 640
    ? innerWidth - 8
    : innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26);
  const caixas = [];
  for (const [k, d] of Object.entries(deptRT)) {
    if (focused === k && k !== 'brain') continue; // this billboard is docked in the rail
    let [sx, sy] = toScreen(d.badgeAnchor);
    // keep billboards fully on screen (camera-readability rule)
    const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
    let xf, left, top;
    if (d.sideBadge) { // anchored by an edge, vertically centred (emails/sales/fin/delivery)
      sy = clamp(sy, 64 + bh / 2, innerHeight - bh / 2 - 8);
      if (d.sideLeft) { sx = clamp(sx, bw + 8, rightEdge); xf = 'translate(-100%,-50%)'; left = sx - bw; }
      else { sx = clamp(sx, 8, rightEdge - bw); xf = 'translate(0,-50%)'; left = sx; }
      top = sy - bh / 2;
    } else {
      sy = clamp(sy, bh + 64, innerHeight - 12);
      sx = clamp(sx, bw / 2 + 8, rightEdge - bw / 2);
      xf = 'translate(-50%,-100%)';
      left = sx - bw / 2; top = sy - bh;
    }
    caixas.push({ d, sx, sy, xf, left, top, bw, bh });
  }
  if (innerWidth <= 640) arrumarCartoes(caixas); // telemóvel: um cartão não tapa outro
  for (const c of caixas) {
    // o mesmo ponto de ancoragem, agora com o desvio que a arrumação impôs
    const sx = c.left + (c.xf === 'translate(0,-50%)' ? 0 : c.xf === 'translate(-100%,-50%)' ? c.bw : c.bw / 2);
    const sy = c.top + (c.xf.endsWith('-100%)') ? c.bh : c.bh / 2);
    c.d.badge.style.transform = `translate(${sx}px,${sy}px) ${c.xf} scale(${badgeScale})`;
    c.d.badge.style.opacity = 1 - 0.75 * focusDim; // unfocused boards recede with the scene
    c.d.badge.style.pointerEvents = 'auto';
  }
  // name pills stay on at EVERY zoom (AJ's call) — smaller when far, full-size when near
  const pillScale = 0.62 + 0.38 * smooth(1.2, 2.4, z);
  for (const r of Object.values(R)) {
    const p = r.person.position;
    const [sx, sy] = toScreen(v3.set(p.x, p.y + 5.9 * (r.a.lead ? 1.12 : 1), p.z).clone());
    r.pill.style.display = 'block';
    r.pill.style.transform = `translate(${sx}px,${sy}px) translate(-50%,-100%) scale(${pillScale})`;
    const dimmed = focused && focused !== 'brain' && r.a.dept !== focused;
    r.pill.style.opacity = dimmed ? 1 - 0.85 * focusDim : 1;
    const alvoTab = focused === r.a.dept ? 0 : -1; // só a sala em foco põe as pastilhas no Tab
    if (r.pill.tabIndex !== alvoTab) r.pill.tabIndex = alvoTab;
  }
}

/* ---------- clock (REAL local time — locked rule) ---------- */
function tickClock() {
  const d = new Date();
  document.getElementById('clock').textContent =
    fmtClock(d); // 13:05:42 — 24 horas, sempre
}
setInterval(tickClock, 1000); tickClock();

/* ---------- helpers ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* ---------- V3 task boards ---------- */
function feedPush(r, i, text) {
  r.feed.unshift({ i, text, ts: Date.now() });
  if (r.feed.length > 30) r.feed.pop();
  if (focused === r.a.dept) {
    const line = document.querySelector(`[data-line="${r.a.id}"]`);
    if (line) line.textContent = i + ' ' + text;
  }
  if (modalOpen === r.a.id && modalTab === 'activity') renderActivity(r.a.id);
}
// V3.1 LIVE: the served roster (office.agents.json) renames the seats and rewrites what each
// agent says about itself; the demo's fake greetings and stat chips are wrong in a real office
function applyRoster(agents) {
  if (!Array.isArray(agents)) return;
  for (const a of agents) {
    const r = R[a.id]; if (!r) continue;
    r.a.name = a.name;
    r.pill.innerHTML = (r.a.lead ? '<span class="star">★</span>' : '') + esc(a.name);
    // a função e a descrição vêm do roster do servidor (office.agents.json) — é o mesmo texto que o painel mostra
    if (a.role) r.role = a.role; if (a.does) r.does = a.does;
    if (chatHist[a.id] && chatHist[a.id][0] && chatHist[a.id][0].who === 'agent' && !chatHist[a.id][0].userEdited) {
      chatHist[a.id][0].text = `${a.role || 'Agente'} · ${DEPTS[r.a.dept].name}. ${a.does || ''}`;
    }
    if (modalOpen === a.id) openAgentRail(a.id, modalTab, false);
  }
  if (tasks && tasks.syncPills) tasks.syncPills(); // the pills were rebuilt — put the clock chips back
}
tasks = initTasks({
  hud, R, deptRT, RAIL_SIDE, spawnEmote, chatPush, chatHist, feedPush, zoomToApproval, enterFocus, openAgent, esc,
  brainWrite: (id, title) => brain.write(id, title), brain,
  // 26 out 2026: a marca não se reescreve quando o escritório fica ao vivo. Antes esta linha
  // trocava a etiqueta por «BETA»; agora a marca é «ÓRBITA AGENTES» e fica quieta.
  onLive: (h) => {
    if (!h) return;                      // vista publicada (sem servidor): a marca e o título ficam
    document.title = `${h.name} — Órbita Agentes`;
    brain.setOwner(h.name); brain.setQuiet(true); applyRoster(h.agents);
  },
  onTools: (agentId, keys) => mcp.onToolsUsed(agentId, keys),
  requestApproval, setStuck: setStuckLive,
  onUsage: (u) => { if (mcp && mcp.setUsage) mcp.setUsage(u); }, // V3.6: the plan's gauge in the top bar
  getFocused: () => focused, getZoom: () => view.zoom, getFocusDim: () => focusDim,
  toScreen: (p) => toScreen(p), reframe,
});
const leadsDrawer = initLeads({ api: '/api' }); // a gaveta LEADS na barra: empresas reais e informação (Google Places + Programmable Search)
const opsDrawer = initOps({ api: '/api' }); // a gaveta OPERAÇÃO: o que está guardado, o que espera OK, o rasto
// HOJE: abre por cima de tudo. Sem decisões, ensina o próximo passo em vez de dizer «sem resultados».
const today = initToday({ api: '/api', onOpenLeads: () => { today.close(); leadsDrawer.open(); }, onOpenOps: () => { today.close(); opsDrawer.open(); } });
// primeira visita do dia → o ecrã abre sozinho; nas seguintes, a barra mostra o número à espera
fetch('/api/ops/today').then(r => r.json()).then(d => {
  const n = d?.resumo?.decidir || 0;
  const badge = document.querySelector('#topToday .td-badge');
  if (badge) { badge.textContent = n ? String(n) : ''; badge.hidden = !n; }
  const seen = (() => { try { return localStorage.getItem('orbita.today.seen'); } catch { return null; } })();
  const fresh = !seen || (Date.now() - new Date(seen).getTime()) > 6 * 3600 * 1000;
  if (n && fresh && today) today.open();
}).catch(() => {});
view.target.set(...overviewPos());
addEventListener('resize', () => { if (!focused && !tween) view.target.set(...overviewPos()); });

/* ---------- boot ---------- */
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  applyCamera();
}
addEventListener('resize', resize);
resize();
applyTheme(themePref);   // 29 out 2026: a preferência de tema vale no arranque (Claro · Escuro · Automático)

// deterministic view hooks for headless screenshots: #view=sales | #zoom=2.2
{
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('zoom')) view.zoom = parseFloat(h.get('zoom')) || 1;
  if (h.get('view') && LAYOUT[h.get('view')]) enterFocus(h.get('view'));
  if (h.get('cam')) setCam(h.get('cam') === '1');
  if (h.get('dark') === '1' || document.body.classList.contains('dark')) setDark(true);
  // typing #dark=1 into an OPEN tab is a same-document hash change (no reload) — react to it live
  addEventListener('hashchange', () => { const d = new URLSearchParams(location.hash.slice(1)).get('dark'); if (d === '1') setDark(true); else if (d === '0') setDark(false); });
  if (h.get('board')) { // #board=1 → company board · #board=marketing → that dept's board
    const b = h.get('board');
    if (LAYOUT[b] && b !== 'brain') tasks.openFor(b); else tasks.open();
  }
  syncOverviewBtn();
}
/* ---------- inspecção: o chão que ficou DESENHADO, não o que os dados pedem ----------
   O `npm run test:scene` lê isto para provar que as seis cores pedidas estão mesmo na cena —
   que é diferente de «o ficheiro diz vermelho». Lê o material, não a intenção. */
function floorReport() {
  const out = {};
  for (const [k, rt] of Object.entries(deptRT)) {
    const parts = {};
    rt.group.traverse((o) => {
      if (!o.isMesh || !String(o.userData.part || '').startsWith('floor')) return;
      const world = new THREE.Box3().setFromObject(o); // a altura REAL da camada, em unidades de cena
      parts[o.userData.part] = {
        color: '#' + o.material.color.getHexString(),
        opacity: o.material.opacity,
        transparent: !!o.material.transparent,
        top: Math.round(world.max.y * 1000) / 1000,
      };
    });
    out[k] = { glass: DEPTS[k].glass, parts };
  }
  return out;
}
/* ---------- o espelho acessível (26 out 2026) ----------
   A cena é um canvas: para um leitor de ecrã não há lá nada dentro, e as salas e as pessoas só
   se abriam com o rato. `src/a11y.js` constrói o mesmo escritório por palavras — 6 salas, o
   centro e os 47 agentes, cada um um botão a sério. Abre pela tecla L, pelo botão da lista (ao
   lado do zoom) ou pela ligação «saltar para a lista», que é a primeira coisa no Tab. */
function focusIntoRail() {
  requestAnimationFrame(() => {
    const rail = document.getElementById('rail');
    if (!rail || rail.style.display === 'none') return;
    const visivel = [...rail.querySelectorAll('input, textarea, button, [href], [tabindex]:not([tabindex="-1"])')]
      .find((n) => n.offsetParent !== null);
    const alvo = visivel || rail;
    if (alvo === rail) rail.tabIndex = -1;
    alvo.focus();
  });
}
const a11y = initA11y({
  deptKeys: [...DEPT_KEYS, 'brain'],
  agents: AGENTS,
  describeRoom: (k) => {
    if (k === 'brain') {
      return {
        name: 'o Cérebro', short: 'O CÉREBRO', glass: DEPTS.brain.glass, action: 'Abrir',
        meta: `${brain.state.notes} notas no vault · o grafo completo abre em ecrã inteiro`,
        empty: 'O centro não tem secretárias: é a sala-mestre — seis lugares, um por chefe — e, debaixo dela, a tua pasta de notas desenhada.',
      };
    }
    const d = DEPTS[k];
    const n = AGENTS.filter((x) => x.dept === k).length;
    const live = deptCount(k, 'live'), wait = deptCount(k, 'waiting');
    return { name: d.name, short: d.short, glass: d.glass, action: 'Abrir a sala', meta: `${n} agentes · ${live} a trabalhar · ${wait} à espera` };
  },
  describeAgent: (id) => {
    const a = AGENTS.find((x) => x.id === id);
    const r = R[id];
    const st = agentStateOf(id);
    return { name: a.name, role: (r && r.role) || roleOf(id), deptName: DEPTS[a.dept].name, label: st.label, kind: st.kind };
  },
  onRoom: (k) => { if (k === 'brain') brain.open(); else zoomToDept(k); focusIntoRail(); },
  onAgent: (id) => { openAgent(id, R[id] && R[id].state === 'stuck' ? 'chat' : 'live'); focusIntoRail(); },
});
document.getElementById('skipIndex').addEventListener('click', (e) => a11y.open(e.currentTarget));
document.getElementById('zIndex').addEventListener('click', (e) => a11y.open(e.currentTarget));

/* ---------- 1.53.0 · A LOJA DE APPS (botão, tecla A, ou o endereço #apps) ---------- */
const apps = createApps({ doc: document });
document.getElementById('zApps')?.addEventListener('click', () => apps.toggle());
addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'a' || e.key === 'A') { e.preventDefault(); apps.toggle(); }
});
if (location.hash === '#apps') setTimeout(() => apps.open(), 60);

/* ---------- a luz que passa nos vidros e nos corredores (28 out 2026) ----------
   Uma só passagem por frame para todas as faixas. A luz nunca pára (é a vida da sala), mas ACELERA
   onde há trabalho a sério — e só onde há: `deptCount` lê a base de dados, não um relógio. */
const ledBusy = {};
let lastLedSync = 0;

/* ---------- 1.40.0 · A LUZ DE CADA SALA ----------
   Cada sala ganha uma lâmpada própria (uma `PointLight` no alto) e a lista de
   materiais que emitem: as fitas da passadeira, o ecrã da entrada e o aro de LED.
   A intensidade não é decorativa — vem do trabalho real (`deptCount`), com um
   arranque escalonado quando a página abre e um respirar lento depois. */
const luzRT = {};
const ARRANQUE_LUZ = performance.now() + 260;
DEPT_KEYS.forEach((k, i) => {
  const mats = [];
  for (const L of ledRT) {
    if (L.dept !== k || !L.mat) continue;
    if (!mats.includes(L.mat)) mats.push(L.mat);
  }
  const ent = deptRT[k] && deptRT[k].entrance;
  if (ent && ent.traverse) {
    ent.traverse((o) => {
      const m = o.isMesh && o.material;
      if (m && m.emissive && !mats.includes(m)) mats.push(m);
    });
  }
  const L = LAYOUT[k];
  const luz = new THREE.PointLight(new THREE.Color(DEPTS[k].glass), 0, Math.max(L.w, L.d) * 1.5, 2);
  luz.position.set(0, 3.5, 0);
  luz.userData.part = 'roomLamp';
  deptRT[k].group.add(luz);
  luzRT[k] = { mats, luz, atraso: i * LUZ.atraso, valor: 0 };
});
/* o Cérebro respira ao ritmo do átrio: uma luz baixa, que nunca se apaga */
const luzCerebro = new THREE.PointLight(new THREE.Color(DEPTS.brain ? DEPTS.brain.glass : '#AFB8A6'), 0.4, 26, 2);
luzCerebro.position.set(0, 4.2, 0);
if (deptRT.brain && deptRT.brain.group) deptRT.brain.group.add(luzCerebro); else scene.add(luzCerebro);
let luzCerebroValor = 0.4;
/* 29 out 2026 (lançamento): quem pediu ao sistema «menos movimento» não quer o vídeo de LED a correr.
   O CSS já respeita a preferência nas transições; a cena passa a abrandar a luz e o tapete para um
   terço da velocidade — continua vivo (é a vida das salas), mas deixa de puxar pelo olho. */
const CALMO = (() => {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
})();
function tickLeds(now, dt) {
  if (now - lastLedSync > 700) {
    lastLedSync = now;
    for (const k of DEPT_KEYS) ledBusy[k] = deptCount(k, 'live') + deptCount(k, 'waiting');
  }
  for (const L of ledRT) {
    const tex = L.mat.userData.ledTex;
    if (!tex) continue;
    // 28 out 2026: sala ocupada → a fita de luz e o tapete da passadeira andam mais depressa
    const speed = (L.mat.userData.ledSpeed || 0.06) * (ledBusy[L.dept] ? 2.6 : 1) * (CALMO ? 0.34 : 1);
    tex.offset.x = (tex.offset.x - dt * speed) % 1;
  }
  tickLuz(now, dt);
}

/* A luz: alvo vindo do trabalho real → aproximação suave → `emissiveIntensity` e
   a lâmpada da sala. `aproximar` é independente do fps (ver `src/leds.js`). */
function tickLuz(now, dt) {
  const ms = Math.max(0, dt * 1000);
  for (const k of DEPT_KEYS) {
    const r = luzRT[k];
    if (!r) continue;
    const estado = { live: deptCount(k, 'live'), waiting: deptCount(k, 'waiting') };
    const alvoLuz = luzDaSala(now, estado, { inicio: ARRANQUE_LUZ, atraso: r.atraso, calmo: CALMO }).valor;
    r.valor = aproximar(r.valor, alvoLuz, ms);
    if (r.luz) r.luz.intensity = r.valor * 2.1;
    for (const m of r.mats) {
      if (m.userData.baseEI == null) m.userData.baseEI = m.emissiveIntensity == null ? 1 : m.emissiveIntensity;
      m.emissiveIntensity = m.userData.baseEI * (0.42 + r.valor * 0.9);
    }
  }
  /* o átrio não pisca com o trabalho: pulsa devagar, sempre aceso */
  const alvoCerebro = 0.42 + (CALMO ? 0 : 0.1 * Math.sin(now / 5200 * Math.PI * 2));
  luzCerebroValor = aproximar(luzCerebroValor, alvoCerebro, ms, { subir: 900, descer: 900 });
  if (luzCerebro) luzCerebro.intensity = luzCerebroValor;
}

window.CC = { flyTo, zoomToDept, zoomOut, zoomToApproval, requestApproval, openAgent, view, applyCamera, R, emotes,
  a11y,
  office: {
    depts: DEPTS, layout: LAYOUT, floors: floorReport(), plants: plantsRT, dressing: dressingRT,
    // 28 out 2026: a sala-mestre e a circulação, para se poder olhar para elas sem adivinhar
    hall: hall && { ...hall.userData.hall },
    // 28 out 2026 (1.13.1): as paredes e o vão da porta — o teste lê daqui se a porta assenta num buraco
    walls: Object.fromEntries(Object.entries(deptRT).filter(([, r]) => r.walls).map(([k, r]) => [k, { ...r.walls.userData.wall }])),
    // 28 out 2026: os pórticos de entrada e as passadeiras (para o teste poder olhar para eles)
    entrances: entranceRT,
    /* 28 out 2026 (1.13.2, pedido 36): a PLANTA das portas — onde cada porta cai, para que lado abre,
       onde começa e acaba a ponte. É a mesma conta que constrói a cena; o teste compara-a com o que
       foi construído, em vez de repetir os números à mão. */
    plates: PLATES,
    // 29 out 2026: as passadeiras e o platô do pé da escada (a ponta que assenta na sala)
    walkways: walkRT,
    // 28 out 2026: as passadeiras — a cor do tapete, para onde vai e quanto já rolou (o teste lê isto)
    belts: () => ledRT.filter((l) => l.mat.userData.belt).map((l) => ({
      dept: l.dept,
      offset: l.mat.map ? l.mat.map.offset.x : null,
      speed: l.mat.userData.ledSpeed,
      color: l.mat.color ? '#' + l.mat.color.getHexString() : null,
    })),
    crew: () => crew.state(),
    // a fase da luz (para o teste poder provar que ela ANDA, e não só que existe)
    ledPhase: () => ledRT.reduce((n, l) => n + (l.mat.userData.ledTex ? l.mat.userData.ledTex.offset.x : 0), 0),
    /* 1.40.0 · a luz de cada sala: o valor que o modelo deu e a intensidade que está
       mesmo na cena. É daqui que o teste de fumo prova que a luz ACENDE (e não que existe). */
    lights: () => Object.fromEntries(DEPT_KEYS.map((k) => {
      const r = luzRT[k] || {};
      return [k, { valor: r.valor || 0, intensity: r.luz ? r.luz.intensity : 0, mats: (r.mats || []).length }];
    })),
    lightModel: LUZ,
    brainLamp: () => luzCerebroValor,
    circulation: () => ({
      led: ledRT.length,
      ledByDept: Object.fromEntries(DEPT_KEYS.map((k) => [k, ledRT.filter((l) => l.dept === k && !l.mat.userData.belt).length])),
      beltsByDept: Object.fromEntries(DEPT_KEYS.map((k) => [k, ledRT.filter((l) => l.dept === k && l.mat.userData.belt).length])),
      corridors: DEPT_KEYS.map((k) => ({ dept: k, gate: deptRT[k].gate && deptRT[k].gate.toArray(), brainGate: deptRT[k].brainGate && deptRT[k].brainGate.toArray() })),
    }),
    problems: officeProblems().concat(lookProblems()),
    // 27 out 2026: os 35 avatares, para o teste de cena poder olhar para eles
    avatars: {
      stats: LOOK_STATS,
      problems: lookProblems(),
      looks: Object.fromEntries(Object.values(R).map((r) => [r.a.id, {
        signature: r.look.signature, female: r.look.female, hat: r.look.hat,
        suit: r.look.suit, tie: r.look.tie, dept: r.look.dept,
      }])),
      meshes: Object.values(R).reduce((n, r) => { let k = 0; r.person.traverse((o) => { if (o.isMesh) k++; }); return n + k; }, 0),
    },
  },
  setCam, setDark, brain, crew, connectorReveal: () => mcp.startReveal(), // `crew`: a circulação (28 out 2026)
  /* 28 out 2026 — um passo manual da simulação, para o teste de cena poder avançar o tempo sem
     depender do ciclo de desenho. Existe porque o WebGL falso do harness não chega aos *render
     targets* e o first render mata o `requestAnimationFrame`; sem isto, nada que se mexa (uma luz a
     passar, um chefe a andar) podia ser provado. Em browser não é preciso: o ciclo corre sozinho. */
  stepSim: (dt = 0.016) => { const t = performance.now(); tickLeds(t, dt); tickSim(t, dt); return t; },
  // a preferência de movimento do sistema, tal como a cena a leu (para a inspecção poder prová-lo)
  motion: { reduced: CALMO },
  forge: { toggle: () => forgeTerm.toggle(), open: () => forgeTerm.open(), close: () => forgeTerm.close(),
    isOpen: () => forgeTerm.isOpen(), command: (c) => forgeTerm.command(c), stats: () => forgeTerm.stats() },
  toggleBoard: () => tasks.toggle(), tasks, routines: () => tasks.routines,
  /* 29 out 2026: as configurações reais, para se poder provar (e para quem quiser automatizar):
     o tema é uma preferência a sério, os painéis afastam-se, e o painel lê o catálogo do servidor. */
  cfg: { open: () => cfg.open(), close: () => cfg.close(), toggle: () => cfg.toggle(), isOpen: () => cfg.isOpen() },
  tema: { ler: () => themePref, aplicar: (t) => applyTheme(t), escuro: () => darkOn },
  paineis: { ler: () => ({ ...panelPrefs }), por: (k, on) => setPanel(k, on) },
  avisos: { estado: () => notifier.state(), ligar: () => notifier.ask(), desligar: () => notifier.setEnabled(false) },
  /* 30 out 2026: os cartões das salas em ecrã pequeno — a escala e a arrumação, ao alcance
     do teste: uma conta que só se vê no telemóvel tem de poder provar-se fora dele. */
  badges: { escala: (w) => badgeFit(w), arrumar: (caixas) => { arrumarCartoes(caixas); return caixas; },
    compacto: () => innerWidth <= 640 } };

/* AO VIVO: quando chega um retrato novo, o chip e (se estiver aberto) o painel acompanham. */
liveUi.onChange(() => {
  if (!modalOpen) return;
  renderLiveChip(modalOpen);
  if (modalTab === 'live') renderActivity(modalOpen);
});
liveUi.start();
window.CC.live = liveUi; // para inspeção: CC.live.status(), CC.live.all()

/* ===========================================================================
   1.21.0 · APLICAR UMA COR SEM RECARREGAR (27 out 2026)

   O painel de Configurações muda a cor de uma sala e pede isto. Só se toca no
   que é seguro pintar à mão — o LED das secretárias, as passadeiras, a entrada e
   o vidro do chão. Paredes, adereço e geometria continuam a vir do arranque: uma
   sala nova (mais agentes, outra profundidade) precisa de ser construída, e isso
   não se finge a meio do voo.

   Devolve quantas peças mudaram — a interface mostra o número em vez de dizer
   «feito» sem saber se tocou em alguma coisa.
   =========================================================================== */
function recolor(dept, cor) {
  const d = DEPTS[dept];
  if (!d || !corValida(cor)) return 0;
  let camadas;
  try { camadas = glassLayers(cor); } catch { return 0; }
  let n = 0;
  scene.traverse((o) => {
    if (!o.isMesh || o.userData.dept !== dept) return;
    const tom = tomDaParte(o.userData.part, camadas, cor);
    if (!tom) return;                       // paredes, mobiliário, adereço: não se toca
    const m = o.material;
    if (!m || !m.color) return;
    m.color.set(tom);                       // materiais são por sala, não partilhados
    n += 1;
  });
  d.chip = cor;
  d.glass = camadas.glass;
  d.ink = camadas.base;
  return n;
}

/* Porta pública para o painel de Configurações (e para a consola, ao inspeccionar). */
window.ORBITA = Object.assign(window.ORBITA || {}, {
  recolor,
  /* 1.40.0 · o trabalho real de uma sala, para o Centro de Controlo mostrar o mesmo que a luz
     acende. Mesma conta (`deptCount`), mesma fonte: nada de números paralelos. */
  trabalho: (dept) => ({ live: deptCount(dept, 'live'), waiting: deptCount(dept, 'waiting'), done: deptCount(dept, 'done') }),
  luz: () => Object.fromEntries(Object.entries(luzRT).map(([k, r]) => [k, r.valor])),
});

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tickTween(now);
  applyCamera();
  tickDim(dt);
  tickLeds(now, dt);
  tickSim(now, dt);
  tickLOD();
  tasks.tick(now);
  mcp.tick(now, dt, view, camera, focused, focusDim);
  syncOverviewBtn();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
