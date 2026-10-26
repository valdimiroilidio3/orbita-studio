// Órbita v2 — Three.js isometric office with zoom-driven LOD
// Far: clean pods + agent counts (Image 1 read). Near: diorama with 3D people + holo screens (Image 2 read).
import * as THREE from 'three';
import { DEPTS, DEPT_KEYS, AGENTS, LAYOUT, officeProblems } from './data.js';
import { initA11y } from './a11y.js'; // 26 out 2026: o espelho acessível (teclado e leitor de ecrã)
import { createLive } from './live.js'; // 26 out 2026: o trabalho real em cada monitor (SSE)
import { roleOf, doesOf } from './agentes.js'; // identidade (nome, função, descrição) — sem conteúdo de exemplo
// V7: só o que este ficheiro usa. Saíram sete nomes importados e nunca chamados (TOKENS,
// PLINTH_H, mat, rbox, makeFloorTitle, makeServerRack, makeMeetingTable) — o tipo de sobra que
// faz alguém procurar um título de chão que já não existe.
import {
  makePlinth, makeDesk, makeChair, makePerson, posePerson, poseWork,
  makePlant, makeWalkway, makeWarnSprite, makeRoomWalls,
} from './builders.js';
import { initMcp } from './mcp.js';
import { fmtClock } from './time.js'; // 24 horas, sempre
import { initLeads } from './leads.js'; // V4 (25 out 2026): a pesquisa real da Google
import { initOps } from './ops.js'; // 26 out 2026: a operação a sério — base de dados, aprovações, fila e auditoria
import { initToday } from './today.js'; // 26 out 2026: o ecrã HOJE — decidir, o que aconteceu, o que vem
import { loadConnectors } from './connectors.js';
import { initTasks } from './tasks.js';
import { initBrain } from './brain.js';
let tasks = null; // V3 task boards — initialised after the rail constants exist

/* V7 (26 out 2026): o escritório valida-se primeiro. A lição de 1.9.2 foi essa — um erro pequeno
   num sítio apagou a cena inteira e o sintoma apareceu longe da causa. Se os dados não fizerem
   sentido, fica dito na consola com o nome do problema; o desenho continua (nunca uma tela em
   branco por causa de uma cor mal escrita). `office.test.mjs` exige a lista vazia. */
try {
  const problemas = officeProblems();
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
const view = { target: new THREE.Vector3(...overviewPos()), zoom: OVERVIEW.zoom, arc: 0 };
let tween = null;
const UPV = new THREE.Vector3(0, 1, 0);
const isoWork = new THREE.Vector3();

function applyCamera() {
  const aspect = innerWidth / innerHeight;
  camera.left = -FR * aspect; camera.right = FR * aspect;
  camera.top = FR; camera.bottom = -FR;
  camera.zoom = view.zoom;
  isoWork.copy(ISO);
  if (view.arc) isoWork.applyAxisAngle(UPV, view.arc); // cinematic swing-in, settles back to locked iso
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
const clickTargets = [];   // plinth meshes -> dept key
const personTargets = [];  // person meshes -> agent id
const R = {};              // runtime per agent
const deptRT = {};         // runtime per dept
const screenSets = [];

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
      walls = makeRoomWalls(L.w, L.d, dept.chip, dept.ink, dept.short, { glass: dept.glass });
      walls.traverse(o => { if (o.isMesh) { o.userData.dept = key_; clickTargets.push(o); } });
      g.add(walls);
    } catch (e) { walls = null; console.warn('paredes: ' + key_ + ' — ' + e.message); }
  }

  // no floor titles — the billboards name each department (AJ's call, M2.3)
  scene.add(g);
  deptRT[key_] = { group: g, L, walls };
}

// brain centre (V3.6, AJ 6 Sep 2026): the particle nebula is RETIRED. The vault's wiki-link graph
// is etched into the pod floor (src/brain.js); reads glint, writes add notes, G opens the full graph.
let brain;
{
  const bg = deptRT.brain.group;
  brain = initBrain({ scene, brainGroup: bg, getR: () => R, esc: (t) => esc(t), hud, toScreen: (p) => toScreen(p), getCamera: () => camera });
  const plant = makePlant(); plant.position.set(6.2, 0.12, -5.8); bg.add(plant);
}

/* 26 out 2026: o «sweep» que acendia as salas uma a uma saiu. Era teatro: dava a ideia de que a
   sala estava a fazer algo quando não estava. Agora só o trabalho real acende alguma coisa. */

// walkways dept -> brain
for (const k of DEPT_KEYS) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const from = [L.pos[0] - sx * (L.w / 2 - 1), L.pos[1] - sz * (L.d / 2 - 1)];
  const to = [sx * 6.5, sz * 6.5];
  const walk = makeWalkway(from, to);
  walk.userData.dept = k; walk.userData.part = 'walkway';
  scene.add(walk);
  deptRT[k].gate = new THREE.Vector3(from[0], 0, from[1]);
  deptRT[k].brainGate = new THREE.Vector3(to[0], 0, to[1]);
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
const COLS = { emails: 2, sales: 2, marketing: 2, ops: 2, fin: 2, delivery: 2 };
for (const a of AGENTS) {
  const dRT = deptRT[a.dept];
  const dept = DEPTS[a.dept];
  const L = dRT.L;
  const cols = COLS[a.dept];
  const gx = (a.grid[0] - (cols - 1) / 2) * 8.6;
  const gz = (a.grid[1] - 1) * 6.4 - 1;
  const base = new THREE.Vector3(L.pos[0] + gx, 0.12, L.pos[1] + gz);

  // whole station rotated 45° so monitor screens face the camera square-on
  const ANG = Math.PI / 4;
  const rot = (v) => v.applyAxisAngle(new THREE.Vector3(0, 1, 0), ANG);

  const station = new THREE.Group();
  station.position.copy(base);
  station.rotation.y = ANG;
  const live = liveUi.attach(agentInfo(a.id)); // um monitor por posto, ligado ao que a base de dados diz
  const { group: desk, screenSet } = makeDesk(dept.chip, live);
  station.add(desk);
  screenSets.push({ screenSet, dept: a.dept, live, agentId: a.id });
  const chair = makeChair();
  chair.position.set(0, 0, 1.75);
  station.add(chair);
  station.traverse(o => { if (o.isMesh) o.userData.dept = a.dept; }); // focus-dim tagging
  scene.add(station);

  const person = makePerson({ hair: a.hair, skin: a.skin, chip: dept.chip, lead: a.lead });
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
  .then(c => { mcpImpl = initMcp({ scene, hud, LAYOUT, DEPTS, FR, R, connectors: c }); if (mcpDark) mcpImpl.setDark(true); if (mcpUsage) mcpImpl.setUsage(mcpUsage); })
  // 26 out 2026: uma falha nos conectores nunca pode derrubar a cena — fica sem a barra e diz porquê
  .catch(e => console.warn('conectores indisponíveis: ' + e.message));

// plants on outer corners
for (const k of ['emails', 'sales', 'marketing', 'ops', 'delivery']) {
  const L = LAYOUT[k];
  const sx = Math.sign(L.pos[0]), sz = Math.sign(L.pos[1]);
  const p = makePlant();
  p.position.set(L.pos[0] + sx * (L.w / 2 - 1.6), 0.12, L.pos[1] + sz * (L.d / 2 - 1.6));
  p.traverse(o => { if (o.isMesh) o.userData.dept = k; });
  scene.add(p);
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
  for (const m of dimCache.values())
    m.color.copy(m.userData.baseColor).lerp(m.userData.dimColor, focusDim);
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
      <div class="m-row"><span class="m-lab">${row[0]}</span><span class="m-val" data-m="${k}-${i}">${row[1]()}</span></div>`).join('')}
    </div>
    <button type="button" class="b-appr" style="display:none" aria-label="decisões à tua espera — abrir a primeira">⚠ <span class="ap-n">1</span> À ESPERA DE APROVAÇÃO</button>`;
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

addEventListener('wheel', (e) => {
  if (e.target.closest && e.target.closest('#rail')) return; // let the rail scroll
  e.preventDefault();
  tween = null;
  view.arc = 0;
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
  drag = { x: e.clientX, y: e.clientY, moved: false };
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (drag.moved) {
    tween = null;
    const a = worldAt((drag.x / innerWidth) * 2 - 1, -(drag.y / innerHeight) * 2 + 1);
    const b = worldAt((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    if (a && b) view.target.add(a.sub(b));
    drag.x = e.clientX; drag.y = e.clientY;
  }
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
  else if (e.key === 'v' || e.key === 'V') setCam(!document.body.classList.contains('cam'));
  else if (e.key === 'd' || e.key === 'D') setDark(!darkOn);
});

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

function zoomToDept(k) { enterFocus(k); }
function zoomOut() {
  if (focused && focused !== 'brain') { exitFocus(true); return; }
  focused = null;
  flyTo(overviewPos(), OVERVIEW.zoom, 550);
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
    { who: 'agent', text: `${a.role || 'Agente'} · ${a.deptName}. ${a.tagline || ''} Pede trabalho na barra à direita ou abre AO VIVO para ver o que está registado.` },
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
    if (m.who === 'agent') return `<div class="m-agent">${esc(m.text)}</div>`;
    if (m.who === 'user') return `<div class="m-user">${esc(m.text)}</div>`;
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
    <button type="button" class="b-appr" style="display:${stuckIn(k).length ? 'flex' : 'none'}" aria-label="decisões à tua espera nesta sala — abrir a primeira">⚠ <span class="ap-n">${stuckIn(k).length}</span> À ESPERA DE APROVAÇÃO</button>`;
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
function sendChat(text) {
  const id = modalOpen;
  if (!id || !text.trim()) return;
  const r = R[id];
  chatPush(id, { who: 'user', text });
  document.getElementById('mIn').value = '';
  const low = text.toLowerCase();
  setTimeout(() => {
    if (tasks && tasks.pendingReject(id)) { tasks.rejectLive(id, text); return; } // V3.5: the line after REJECT is the note the agent reworks with
    if (r.state === 'stuck' && /\b(approve|reject)\b/.test(low)) {
      resolveApproval(id, /approve/.test(low));
      return;
    }
    const rv = tasks && tasks.isLive() && text.match(/^\s*revise\s*[:\-–]\s*(.+)$/i); // LIVE: "revise: …" re-runs the last deliverable
    if (rv && tasks.revise(id, rv[1].trim())) { chatPush(id, { who: 'agent', text: 'Já vou — a rever agora. Aparece aqui quando estiver pronto.' }); return; }
    const tr = tasks && tasks.handleChat(id, text); // "adicionar tarefa: …" / "o que está no quadro"
    if (tr) { chatPush(id, { who: 'agent', text: tr }); return; }
    if (tasks && tasks.isLive()) { // LIVE: a real conversation with the agent, grounded in the brain
      chatPush(id, { who: 'work', i: '…', text: `${r.a.name} está a pensar` });
      fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent: id, text, history: chatHist[id].filter(m => m.who === 'user' || m.who === 'agent').slice(-8) }) })
        .then(async res => { if (!res.ok) throw new Error((await res.json()).error || res.statusText); return res.json(); })
        .then(j => {
          const h = chatHist[id]; const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} está a pensar`); if (k >= 0) h.splice(k, 1);
          chatPush(id, { who: 'agent', text: j.reply });
          if (j.routines && tasks.refresh) tasks.refresh(); // a routine was set, paused, run or deleted in chat
          if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
          if (j.tools && j.tools.length) mcp.onToolsUsed(id, j.tools);
        })
        .catch(e => chatPush(id, { who: 'agent', text: `Não consegui chegar ao Claude (${e.message}).` }));
      return;
    }
    // sem motor de IA não há conversa inventada: pergunta ao servidor e mostra o que ele responder
    chatPush(id, { who: 'work', i: '…', text: `${r.a.name} está a ler o pedido` });
    fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: id, text, history: chatHist[id].filter(m => m.who === 'user' || m.who === 'agent').slice(-8) }) })
      .then(async res => {
        const j = await res.json().catch(() => ({}));
        const h = chatHist[id]; const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} está a ler o pedido`); if (k >= 0) h.splice(k, 1);
        if (!res.ok) throw new Error(j.error || res.statusText);
        chatPush(id, { who: 'agent', text: j.reply });
        if (j.routines && tasks.refresh) tasks.refresh();
        if (j.read) for (const n of j.read.slice(0, 2)) brain.readNote(id, n);
        if (j.tools && j.tools.length) mcp.onToolsUsed(id, j.tools);
      })
      .catch(e => {
        const h = chatHist[id]; const k = h.findIndex(m => m.who === 'work' && m.text === `${r.a.name} está a ler o pedido`); if (k >= 0) h.splice(k, 1);
        chatPush(id, { who: 'agent', text: `Não consigo responder: ${e.message}. Sem um motor de IA ligado, este posto não inventa uma resposta — o painel AO VIVO mostra o trabalho real.` });
      });
  }, 450 + Math.random() * 500);
}
document.getElementById('mSend').addEventListener('click', () =>
  sendChat(document.getElementById('mIn').value));
document.getElementById('mIn').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat(e.target.value);
  e.stopPropagation();
});
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
    if (!d) { r.state = 'idle'; if (r.warn) r.warn.visible = false; continue; }
    const want = d.state === 'live' ? 'working'
      : d.state === 'waiting' ? 'stuck'
      : d.state === 'error' ? 'error' : 'idle';
    if (want === 'stuck' && r.state !== 'stuck') requestApproval(id);       // só quando a base de dados diz que espera
    if (want !== 'stuck' && r.state === 'stuck') { r.state = want; if (r.warn) r.warn.visible = false; syncApprovals(); }
    else r.state = want;
    if (r.warn) r.warn.visible = want === 'stuck' || want === 'error';
    r.liveState = d.state;
  }
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

/* ---------- passos e postura: quem vai a pé e quem está sentado ---------- */
function walkStep(r, dt) {
  const cur = r.person.position, tgt = r.path[r.pathI];
  const d = new THREE.Vector3().subVectors(tgt, cur); d.y = 0;
  const dist = d.length();
  const step = r.speed * dt;
  if (dist <= step) {
    cur.copy(tgt);
    r.pathI++;
    if (r.pathI >= r.path.length) return true;
  } else {
    d.normalize();
    cur.addScaledVector(d, step);
    r.person.rotation.y = Math.atan2(d.x, d.z);
  }
  return false;
}

// standing modes drift the agent from the chair to a spot beside the desk, and can re-face the camera
const FACE_CAM = Math.PI / 4;
function applyStandAndFacing(r, mode, now, dt) {
  const u = r.person.userData;
  const sk = (u.cur && u.cur.standK) || 0;
  r.person.position.x = r.seat.x + (r.stand.x - r.seat.x) * sk;
  r.person.position.z = r.seat.z + (r.stand.z - r.seat.z) * sk;
  if (mode === 'spin') {
    const span = Math.max(400, (r.modeUntil - r.modeStart) || 1500);
    r.person.rotation.y = r.seatRot + ((now - r.modeStart) / span) * Math.PI * 2;
    return;
  }
  const target = (mode === 'stretch' || mode === 'cheer' || mode === 'wave') ? FACE_CAM : r.seatRot;
  let d = target - r.person.rotation.y;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  r.person.rotation.y += d * (1 - Math.exp(-dt * 6));
}

function tickSim(now, dt) {
  if (now - lastLiveSync > 1200) { lastLiveSync = now; syncFromLive(); }
  for (const r of Object.values(R)) {
    if (r.state === 'walking' || r.state === 'returning') { // um percurso pedido (p. ex. ir ao Cérebro) continua a andar
      posePerson(r.person, 'walk', now);
      if (walkStep(r, dt)) {
        if (r.state === 'walking') {
          r.state = 'atBrain';
          r.person.rotation.y = r.person.position.x < 2 ? Math.PI / 2 : -Math.PI / 2;
        } else {
          r.state = 'idle';
          r.person.position.copy(r.seat);
          r.person.rotation.y = r.seatRot;
        }
      }
    } else if (r.state === 'atBrain') {
      posePerson(r.person, 'stand', now);
    } else if (r.state === 'working') {
      // a trabalhar de verdade: a escrever. Sem trocas de pose ao acaso.
      poseWork(r.person, 'type', now + r.bob * 400, dt);
      applyStandAndFacing(r, 'type', now, dt);
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

function tickLOD() {
  const z = view.zoom;
  const detail = smooth(1.75, 2.5, z);
  const pillA = smooth(1.45, 1.85, z); // pills stay on at near — they name the agents
  // billboards persist at every zoom (v1 rule) — slightly larger when far, compact when near
  const badgeScale = 1.02 - 0.3 * smooth(1.2, 2.6, z);
  for (const [k, d] of Object.entries(deptRT)) {
    if (focused === k && k !== 'brain') continue; // this billboard is docked in the rail
    let [sx, sy] = toScreen(d.badgeAnchor);
    // keep billboards fully on screen (camera-readability rule)
    const bh = d.badge.offsetHeight * badgeScale, bw = d.badge.offsetWidth * badgeScale;
    let xf;
    if (d.sideBadge) { // anchored by an edge, vertically centred (emails/sales/fin/delivery)
      const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26); // V3.3: never under the panel
      sy = clamp(sy, 64 + bh / 2, innerHeight - bh / 2 - 8);
      if (d.sideLeft) { sx = clamp(sx, bw + 8, rightEdge); xf = 'translate(-100%,-50%)'; }
      else { sx = clamp(sx, 8, rightEdge - bw); xf = 'translate(0,-50%)'; }
    } else {
      const rightEdge = innerWidth - ((tasks ? tasks.panelWidth() : 400) + 26);
      sy = clamp(sy, bh + 64, innerHeight - 12);
      sx = clamp(sx, bw / 2 + 8, rightEdge - bw / 2);
      xf = 'translate(-50%,-100%)';
    }
    d.badge.style.transform = `translate(${sx}px,${sy}px) ${xf} scale(${badgeScale})`;
    d.badge.style.opacity = 1 - 0.75 * focusDim; // unfocused boards recede with the scene
    d.badge.style.pointerEvents = 'auto';
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
  onLive: (h) => { document.querySelector('#topbar .brand .ver').textContent = 'BETA'; document.title = `${h.name} — Órbita`; brain.setOwner(h.name); brain.setQuiet(true); applyRoster(h.agents); },
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
   centro e os 35 agentes, cada um um botão a sério. Abre pela tecla L, pelo botão da lista (ao
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
        empty: 'O centro não tem secretárias: é a tua pasta de notas, desenhada.',
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

window.CC = { flyTo, zoomToDept, zoomOut, zoomToApproval, requestApproval, openAgent, view, applyCamera, R, emotes,
  a11y,
  office: { depts: DEPTS, floors: floorReport(), problems: officeProblems() },
  setCam, setDark, brain, connectorReveal: () => mcp.startReveal(),
  toggleBoard: () => tasks.toggle(), tasks, routines: () => tasks.routines };

/* AO VIVO: quando chega um retrato novo, o chip e (se estiver aberto) o painel acompanham. */
liveUi.onChange(() => {
  if (!modalOpen) return;
  renderLiveChip(modalOpen);
  if (modalTab === 'live') renderActivity(modalOpen);
});
liveUi.start();
window.CC.live = liveUi; // para inspeção: CC.live.status(), CC.live.all()

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  tickTween(now);
  applyCamera();
  tickDim(dt);
  tickSim(now, dt);
  tickLOD();
  tasks.tick(now);
  mcp.tick(now, dt, view, camera, focused, focusDim);
  syncOverviewBtn();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
