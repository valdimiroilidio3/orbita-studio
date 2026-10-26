// Órbita — o Cérebro como folha de vidro suspensa (25 out 2026; antes era o grafo em tinta no ar).
// The particle nebula is gone. The vault's wiki-link graph (src/braingraph.js, baked by
// graph-build.mjs) is drawn into the floor of the centre pod as faint ink line-work: texture at
// overview, a graph when you lean in. It moves only when an agent READS (a note glints green and a
// dashed line runs to the desk for two seconds) or WRITES (a finished task becomes a new note off
// its department's hub). The Task Status panel carries a small Brain strip — last read, notes
// added today, Open the Brain — and G / clicking the pod opens the full-screen Obsidian graph.
import * as THREE from 'three';
import { BRAIN as BRAIN0 } from './braingraph.js';
const BRAIN = BRAIN0; // as notas reais vêm do servidor (GET /api/brain); nada de grafos de exemplo
import { AGENTS } from './data.js';
import { fmtTime } from './time.js';

const GROUP_COL = {
  '40-Marketing': '#E69393', '50-Products': '#98A5EF', '60-Sales': '#EADC8F', '70-Delivery': '#8FD3F4',
  '10-Business': '#BFA2E3', '00-Meta': '#F2B33D', '90-Skills': '#5ADEB7', '30-Customers': '#D1DECD',
  '95-Agents': '#B0ADA3', '80-Finance': '#A9B6F0', '05-Inbox': '#B0ADA3',
};
const GROUP_NAME = g => g.replace(/^\d\d-/, '');
// which folders each department reads from (and writes into)
const DEPT_FOLDERS = {
  marketing: ['40-Marketing', '20-Brand'], sales: ['60-Sales', '50-Products', '30-Customers'],
  emails: ['60-Sales', '30-Customers', '10-Business'], ops: ['10-Business', '00-Meta', '95-Agents', '90-Skills'],
  fin: ['80-Finance', '10-Business'], delivery: ['70-Delivery', '50-Products'],
};
let INK = '21,20,20'; // dark mode swaps this for the cream ink (setTheme)
const GREEN = '#1E9070';
const slug = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
const timeStr = ts => fmtTime(ts); // 24 horas, sempre (src/time.js)
const agentOf = id => AGENTS.find(a => a.id === id);

export function initBrain({ scene, brainGroup, getR, esc, hud, toScreen, getCamera }) {
  /* ---------- data ---------- */
  let nodes = BRAIN.nodes.map((n, i) => ({ ...n, i }));
  let links = BRAIN.links.map(([a, b]) => [a, b]);
  let adj = nodes.map(() => new Set());
  for (const [a, b] of links) { adj[a].add(b); adj[b].add(a); }
  let byId = new Map(nodes.map(n => [n.id, n.i]));
  const state = { notes: BRAIN.notes, lastRead: null, newToday: 0, reads: new Map(), written: new Map() };
  let hubs = nodes.slice(0, 8);
  const folderNodes = f => nodes.filter(n => n.g === f && n.d >= 2);
  function pickFor(dept) {
    const pool = (DEPT_FOLDERS[dept] || []).flatMap(folderNodes);
    const cands = pool.length ? pool : nodes.slice(0, 40);
    // weight by link count so hubs are read more often, like a real vault
    const tot = cands.reduce((s, n) => s + Math.sqrt(n.d), 0);
    let x = Math.random() * tot;
    for (const n of cands) { x -= Math.sqrt(n.d); if (x <= 0) return n; }
    return cands[0];
  }


  /* ---------- o Cérebro: um orbe de notas, em 3D ----------
     Segunda passagem (25 out 2026). O grafo é um objecto, não um desenho: os nós são esferas
     dentro de uma lente — hubs ao centro, notas na superfície —, as arestas são curvas que
     passam pelo interior do orbe, cada hub leva um anel na cor da pasta e um halo difuso.
     O orbe roda devagar: é a rotação que dá a profundidade que um desenho plano não tem. */
  const CENTRE = new THREE.Vector3(0, 4.05, 0);
  const RAD = 4.2;                       // raio do orbe
  const LENS = 0.88;                     // achatamento em Z
  let darkOrb = false;

  const orb = new THREE.Group();
  orb.position.copy(CENTRE);
  orb.rotation.x = -0.16;                // inclinação fixa: o topo mostra o interior
  orb.userData.dept = 'brain';
  brainGroup.add(orb);
  const spin = new THREE.Group();        // o que roda com o tempo
  orb.add(spin);

  let pos = new Map();                   // índice → Vector3 local ao orbe
  // O orbe é um arquipélago: cada pasta é um aglomerado na superfície, com o hub no meio e as
  // notas à volta. As ligações ficam curtas e radiais — é isso que faz ler «cérebro» e não «nuvem».
  function layout3() {
    pos = new Map();
    const folders = [...new Set(nodes.map(n => n.g))];
    const NF = Math.max(1, folders.length);
    const GA = Math.PI * (3 - Math.sqrt(5));
    folders.forEach((f, fi) => {
      const group = nodes.filter(n => n.g === f);
      const lat0 = Math.asin(-1 + 2 * ((fi + 0.5) / NF));
      const lon0 = fi * GA;
      const d0 = new THREE.Vector3(Math.cos(lat0) * Math.cos(lon0), Math.sin(lat0), Math.cos(lat0) * Math.sin(lon0)).normalize();
      // dois eixos tangentes ao ponto do aglomerado
      const up = Math.abs(d0.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const ax = new THREE.Vector3().crossVectors(up, d0).normalize();
      const ay = new THREE.Vector3().crossVectors(d0, ax).normalize();
      const hub = group.reduce((best, n) => (n.d > best.d ? n : best), group[0]);
      group.forEach((n, j) => {
        const deg = Math.min(1, (n.d || 1) / 8);
        const rad = RAD * (0.99 - 0.12 * deg);
        let dir;
        if (n === hub) dir = d0.clone();
        else {
          const k = j + 1;
          const theta = 0.34 * Math.sqrt(k / group.length) * (0.9 + 0.2 * Math.sin(n.i * 5.3));
          const phi = k * 2.39996;
          dir = d0.clone().multiplyScalar(Math.cos(theta))
            .addScaledVector(ax, Math.sin(theta) * Math.cos(phi))
            .addScaledVector(ay, Math.sin(theta) * Math.sin(phi)).normalize();
        }
        const v = dir.multiplyScalar(rad);
        v.z *= LENS;
        pos.set(n.i, v);
      });
    });
  }
  layout3();
  const onFloor = n => pos.has(n.i);
  const W = n => {                       // posição no mundo (o orbe roda, por isso o mundo muda)
    const v = pos.get(n.i);
    if (!v) return CENTRE.clone();
    spin.updateMatrixWorld(true);
    return spin.localToWorld(v.clone());
  };

  // texturas suaves: um disco radial branco, tingido pelo material de cada sprite
  function radialTex(stops) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 1, 64, 64, 62);
    for (const [at, col] of stops) g.addColorStop(at, col);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const haloTex = radialTex([[0, 'rgba(255,255,255,.95)'], [.30, 'rgba(255,255,255,.42)'], [1, 'rgba(255,255,255,0)']]);
  const coreTex = radialTex([[0, 'rgba(255,255,255,1)'], [.55, 'rgba(255,255,255,.92)'], [.78, 'rgba(255,255,255,.25)'], [1, 'rgba(255,255,255,0)']]);

  // núcleo luminoso: a luz que se vê através do vidro — é isto que dá a sensação de volume
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloTex, color: new THREE.Color('#C9DCC4'), transparent: true, opacity: 0.34,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  coreGlow.scale.set(RAD * 1.15, RAD * 1.15, 1);
  coreGlow.renderOrder = 0; coreGlow.userData.dept = 'brain';
  spin.add(coreGlow);

  // a lente: uma casca de vidro com orla de Fresnel — só as bordas apanham luz, como uma esfera
  // de vidro de verdade. É o que dá o volume ao orbe sem o fechar.
  const shellMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    uniforms: {
      uRim: { value: new THREE.Color('#9FB79E') },
      uTint: { value: new THREE.Color('#FFFFFF') },
      uPow: { value: 2.6 },
      uOpacity: { value: 1 },
      uDark: { value: 0 },
    },
    vertexShader: `
      varying vec3 vN; varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uRim; uniform vec3 uTint; uniform float uPow; uniform float uOpacity; uniform float uDark;
      varying vec3 vN; varying vec3 vV;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
        // uma luz suave a vir de cima, como nas lentes da Apple
        float top = clamp(vN.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(uTint, uRim, 0.55) * (0.35 + 0.65 * top);
        float a = (f * 0.55 + f * f * 0.45) * uOpacity * (uDark > 0.5 ? 0.85 : 0.65);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(RAD * 1.005, 64, 40), shellMat);
  shell.userData.dept = 'brain'; shell.renderOrder = 7;
  orb.add(shell);
  // e uma segunda casca por dentro, muito ténue, para o interior não ficar vazio
  const shellIn = new THREE.Mesh(
    new THREE.SphereGeometry(RAD * 0.86, 40, 26),
    new THREE.MeshBasicMaterial({ color: '#D8E4D4', transparent: true, opacity: 0.035, side: THREE.BackSide, depthWrite: false })
  );
  shellIn.userData.dept = 'brain'; shellIn.renderOrder = 1;
  orb.add(shellIn);

  // o halo por trás do orbe: o objecto acende a relva em vez de a cobrir
  const bloomTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 6, 128, 128, 126);
    g.addColorStop(0, 'rgba(214,228,210,.90)'); g.addColorStop(.42, 'rgba(198,214,194,.26)'); g.addColorStop(1, 'rgba(198,214,194,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: bloomTex, transparent: true, opacity: 0.26, depthWrite: false, blending: THREE.AdditiveBlending }));
  bloom.scale.set(RAD * 3.1, RAD * 3.1, 1); bloom.position.copy(CENTRE);
  bloom.renderOrder = 0; bloom.userData.dept = 'brain';
  brainGroup.add(bloom);

  // dois anéis de luz na relva — o «stand» do objecto
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(RAD * 1.02, RAD * 1.05, 128),
    new THREE.MeshBasicMaterial({ color: '#8FA98F', transparent: true, opacity: 0.34, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; ring.renderOrder = 3; ring.userData.dept = 'brain';
  brainGroup.add(ring);
  const ring2 = new THREE.Mesh(
    new THREE.RingGeometry(RAD * 1.36, RAD * 1.385, 128),
    new THREE.MeshBasicMaterial({ color: '#A9BBA8', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
  );
  ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.15; ring2.renderOrder = 3; ring2.userData.dept = 'brain';
  brainGroup.add(ring2);

  let nodeVis = [];
  function clearGroup(g) {
    if (g === spin) nodeVis = [];
    for (const o of [...g.children]) {
      g.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map && o.material.map !== haloTex && o.material.map !== coreTex) o.material.map.dispose(); o.material.dispose(); }
    }
  }

  function buildOrb() {
    clearGroup(spin);
    const inkCol = new THREE.Color(darkOrb ? '#ECEADF' : '#1B1A18');
    const edgeCol = new THREE.Color(darkOrb ? '#CBD3C8' : '#6F776E');

    // ── arestas: curvas que passam pelo interior do orbe. Curta = firme, longa = quase sussurro
    const near = [], mid_ = [], far = [];
    const CEN = CENTRE.clone();
    for (const [a, b] of links) {
      const pa = pos.get(a), pb = pos.get(b);
      if (!pa || !pb) continue;
      const len = pa.distanceTo(pb) / (RAD * 2);          // 0 … 1
      // o arco abraça a superfície em vez de mergulhar no centro: sem o nó de aranhas ao meio
      const mid = pa.clone().add(pb).multiplyScalar(0.5).sub(CEN);
      if (mid.lengthSq() < 1e-6) mid.set(0, 1, 0);
      mid.normalize().multiplyScalar(RAD * 1.02).add(CEN);
      const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
      const pts = curve.getPoints(16);
      const target = len < 0.30 ? near : len < 0.62 ? mid_ : far;
      for (let i = 0; i < pts.length - 1; i++) target.push(pts[i], pts[i + 1]);
    }
    const k0 = darkOrb ? 1.0 : 1.0;
    for (const [pts, op, order] of [[near, (darkOrb ? 0.42 : 0.34) * k0, 3], [mid_, darkOrb ? 0.20 : 0.16, 2], [far, darkOrb ? 0.09 : 0.07, 1]]) {
      if (!pts.length) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: edgeCol, transparent: true, opacity: op, depthWrite: false });
      const ls = new THREE.LineSegments(geo, mat);
      ls.renderOrder = order; ls.userData.dept = 'brain';
      spin.add(ls);
    }

    // ── nós: halo difuso + núcleo + anel na cor da pasta para os hubs
    const sorted = nodes.filter(onFloor).sort((x, y) => x.d - y.d);
    for (const n of sorted) {
      const p = pos.get(n.i);
      const deg = Math.min(1, (n.d || 1) / 8);
      const col = new THREE.Color(n.fresh ? '#1E9070' : (GROUP_COL[n.g] || '#B0ADA3'));

      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: haloTex, color: col, transparent: true,
        opacity: (n.d >= 6 ? 0.44 : n.d >= 4 ? 0.30 : 0.14) * (darkOrb ? 1.15 : 1),
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      const hs = 0.85 + deg * 0.95;
      halo.scale.set(hs, hs, 1); halo.position.copy(p); halo.renderOrder = 5;
      halo.userData.dept = 'brain'; spin.add(halo);

      const neutral = GROUP_COL[n.g] === '#B0ADA3';
      const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: coreTex, color: n.fresh ? new THREE.Color('#1E9070') : (n.d >= 4 && !neutral ? col : inkCol),
        transparent: true, opacity: n.d >= 4 ? 0.95 : 0.78, depthWrite: false,
      }));
      const cs = 0.34 + deg * 0.40;
      core.scale.set(cs, cs, 1); core.position.copy(p); core.renderOrder = 6;
      core.userData.dept = 'brain'; spin.add(core);

      let torus = null;
      const neutralRing = GROUP_COL[n.g] === '#B0ADA3';
      if (n.d >= 3) { // anel 3D: cada um numa inclinação própria, para ler como órbita
        const ringGeo = new THREE.TorusGeometry(0.34 + deg * 0.30, 0.016, 8, 56);
        const ringMat = new THREE.MeshBasicMaterial({ color: neutralRing ? new THREE.Color('#8C8A82') : col, transparent: true, opacity: n.d >= 4 ? 0.72 : 0.4, depthWrite: false });
        torus = new THREE.Mesh(ringGeo, ringMat);
        torus.position.copy(p);
        torus.rotation.set(1.1 + n.i * 0.7, n.i * 0.9, 0.5 + n.i * 0.35);
        torus.renderOrder = 4; torus.userData.dept = 'brain';
        spin.add(torus);
      }
      nodeVis.push({ p, halo, core, torus, hOp: (n.d >= 6 ? 0.44 : n.d >= 4 ? 0.30 : 0.14), cOp: n.d >= 4 ? 0.95 : 0.72, tOp: torus ? torus.material.opacity : 0 });
    }
  }
  function etch() { buildOrb(); }
  etch();
  const pulses = [];
  let nextPulse = performance.now() + 2500;

  /* ---------- reads: a glint on the note + a dashed line to the desk ---------- */
  const glintTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 4, 64, 64, 60); g.addColorStop(0, 'rgba(30,144,112,1)'); g.addColorStop(0.35, 'rgba(30,144,112,.55)'); g.addColorStop(1, 'rgba(30,144,112,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const fx = []; // { sprite, line, born }
  const labels = []; // read pills
  // the mock's glint: a soft green disc that swells and fades on the note for 2 s
  function flatPulse(n) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, opacity: 0, depthTest: false }));
    m.position.copy(W(n)); m.renderOrder = 61;
    scene.add(m);
    pulses.push({ m, born: performance.now() });
  }
  function glint(n, seat, label) {
    flatPulse(n);
    const p = W(n);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthTest: false }));
    s.position.copy(p); s.scale.set(0.9, 0.9, 1); s.renderOrder = 60;
    scene.add(s);
    if (label && hud && toScreen) { // "E-MAILS DE CLIENTES LERAM MOC-DELIVERY" — the mock's little pill
      const el = document.createElement('div'); el.className = 'readlab'; el.textContent = label; hud.appendChild(el);
      labels.push({ el, at: p.clone(), born: performance.now() });
    }
    let line = null;
    if (seat) {
      const geo = new THREE.BufferGeometry().setFromPoints([p.clone(), new THREE.Vector3(seat.x, 2.4, seat.z)]);
      line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x1E9070, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.85, depthTest: false }));
      line.computeLineDistances(); line.renderOrder = 59;
      scene.add(line);
    }
    fx.push({ sprite: s, line, born: performance.now() });
  }
  let quiet = false; // V3.5 (AJ: "os alertas no Cérebro distraem"): a live office shows only REAL reads and writes — no theatre glints, no ambient pulse
  function setQuiet(on) { quiet = !!on; }
  function read(agentId) {
    const a = agentOf(agentId); if (!a) return;
    const n = pickFor(a.dept);
    const r = getR()[agentId];
    if (!quiet) glint(n, r && r.seat, `${a.name} leu ${n.id}`);
    state.lastRead = { note: n.id, agent: a.name, ts: Date.now() };
    state.reads.set(n.id, { agent: a.name, ts: Date.now() });
    updateStrip();
  }
  // writes: a finished task becomes a new note off its department's hub
  function write(agentId, title) {
    const a = agentOf(agentId); if (!a) return;
    const folder = (DEPT_FOLDERS[a.dept] || ['00-Meta'])[0];
    const hubPool = folderNodes(folder).slice(0, 5); const hub = hubPool.length ? hubPool[Math.floor(Math.random() * hubPool.length)] : hubs[0];
    const id = slug(title) || 'note';
    if (byId.has(id)) { glint(nodes[byId.get(id)]); return; }
    const ang = Math.random() * Math.PI * 2, dist = 0.10 + Math.random() * 0.06;
    const n = { id, g: folder, d: 1, x: Math.max(-0.95, Math.min(0.95, hub.x + Math.cos(ang) * dist)), y: Math.max(-0.95, Math.min(0.95, hub.y + Math.sin(ang) * dist)), i: nodes.length, fresh: true };
    nodes.push(n); byId.set(id, n.i); adj.push(new Set([hub.i])); adj[hub.i].add(n.i); links.push([hub.i, n.i]); hub.d++;
    layout3();
    { // a nota nova nasce colada ao hub dela, não no sítio que a espiral lhe deu
      const hv = pos.get(hub.i), nv = pos.get(n.i);
      if (hv && nv) nv.copy(hv).add(new THREE.Vector3(Math.cos(ang) * 0.62, Math.sin(ang) * 0.45, Math.cos(ang * 1.7) * 0.55));
    }
    state.notes++; state.newToday++;
    state.written.set(id, { agent: a.name, task: title, ts: Date.now() });
    etch(); glint(n);
    updateStrip();
  }
  // LIVE: replace the graph with the server's (the user's real vault), keeping today's state
  function setGraph(g) {
    if (!g || !g.nodes || !g.nodes.length) return;
    const today = new Date().toISOString().slice(0, 10);
    nodes = g.nodes.map((n, i) => ({ ...n, i, fresh: n.g === 'Órbita' && n.id.startsWith(today) })); // notes the office wrote today glow green
    links = g.links.map(([a, b]) => [a, b]);
    adj = nodes.map(() => new Set()); for (const [a, b] of links) { adj[a].add(b); adj[b].add(a); }
    byId = new Map(nodes.map(n => [n.id, n.i])); hubs = nodes.slice(0, 8);
    layout3();
    state.notes = g.notes; sel = null;
    etch(); updateStrip();
  }
  // LIVE: an agent read a named note (the server tells us which) — glint it if it is on the floor
  function readNote(agentId, name) {
    const a = agentOf(agentId); const i = byId.get(name);
    if (!a) return;
    if (i != null && onFloor(nodes[i])) { const r = getR()[agentId]; glint(nodes[i], r && r.seat, `${a.name} leu ${name}`); }
    state.lastRead = { note: name, agent: a.name, ts: Date.now() }; state.reads.set(name, { agent: a.name, ts: Date.now() });
    updateStrip();
  }
  let lastSpin = performance.now();
  function tick(now) {
    // o orbe roda devagar — uma volta a cada ~62 s, com um balanço lateral quase imperceptível
    const dt = Math.min(0.06, (now - lastSpin) / 1000); lastSpin = now;
    spin.rotation.y += dt * 0.101;
    orb.rotation.z = Math.sin(now / 11000) * 0.03;
    orb.position.y = CENTRE.y + Math.sin(now / 5200) * 0.05;

    // profundidade: quem está atrás esbate-se. Sem isto o orbe lê-se plano.
    if (nodeVis.length) {
      const cam = getCamera();
      const cz = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 2).normalize();   // eixo para a câmara
      spin.updateMatrixWorld(true);
      for (const v of nodeVis) {
        const wp = v.p.clone().applyMatrix4(spin.matrixWorld).sub(CENTRE);
        const t = THREE.MathUtils.clamp(wp.dot(cz) / (RAD * LENS), -1, 1);   // −1 (fundo) … 1 (frente)
        const k = 0.42 + 0.58 * ((t + 1) / 2);
        v.halo.material.opacity = v.hOp * (0.45 + 0.55 * k) * (darkOrb ? 1.15 : 1);
        v.core.material.opacity = v.cOp * (0.55 + 0.45 * k);
        if (v.torus) v.torus.material.opacity = v.tOp * (0.35 + 0.65 * k);
      }
    }
    if (now > nextPulse && !quiet) { flatPulse(nodes[0]); nextPulse = now + 6000; } // o brilho de 6 s no hub maior (só demonstração)
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], k = (now - p.born) / 2000;
      if (k >= 1) { scene.remove(p.m); p.m.material.dispose(); pulses.splice(i, 1); continue; }
      const a = Math.sin(k * Math.PI);
      p.m.material.opacity = 0.55 * a; const r = 0.9 + 2.4 * k; p.m.scale.set(r, r, 1);
    }
    for (let i = labels.length - 1; i >= 0; i--) {
      const l = labels[i], k = (now - l.born) / 2600;
      if (k >= 1) { l.el.remove(); labels.splice(i, 1); continue; }
      const [sx, sy] = toScreen(l.at);
      l.el.style.transform = `translate(${sx}px,${sy - 18}px) translate(-50%,-100%)`;
      l.el.style.opacity = k < 0.1 ? k / 0.1 : k > 0.8 ? (1 - k) / 0.2 : 1;
    }
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i], k = (now - f.born) / 2000;
      if (k >= 1) { scene.remove(f.sprite); if (f.line) scene.remove(f.line); fx.splice(i, 1); continue; }
      const a = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      f.sprite.material.opacity = a; const sc = 1.2 + k * 1.6; f.sprite.scale.set(sc, sc, 1);
      if (f.line) f.line.material.opacity = 0.85 * a;
    }
  }

  /* ---------- the panel strip: the door ---------- */
  const strip = document.getElementById('tpBrain');
  const micro = strip && strip.querySelector('canvas');
  if (micro) {
    const r = 3, w = 160, h = 100; micro.width = w * r; micro.height = h * r;
    const x = micro.getContext('2d'); x.scale(r, r);
    const Q = n => [w / 2 + n.x * 44, h / 2 + n.y * 44];
    x.lineWidth = .6; x.strokeStyle = `rgba(${INK},.22)`;
    for (const [a, b] of links) { const [x1, y1] = Q(nodes[a]), [x2, y2] = Q(nodes[b]); x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke(); }
    for (const n of nodes) { const [px, py] = Q(n); x.fillStyle = GROUP_COL[n.g] || '#B0ADA3'; x.beginPath(); x.arc(px, py, .8 + Math.sqrt(n.d) * .32, 0, 7); x.fill(); }
    strip.addEventListener('click', open);
  }
  function updateStrip() {
    if (!strip) return;
    strip.querySelector('.tb-count').textContent = state.notes.toLocaleString('en-NZ');
    const lr = strip.querySelector('.tb-last');
    lr.innerHTML = state.lastRead ? `Última leitura <b>${esc(state.lastRead.note)}</b> por ${esc(state.lastRead.agent)} · ${timeStr(state.lastRead.ts)}` : `${BRAIN.links.length} ligações wiki · ainda nada lido`;
    strip.querySelector('.tb-new').textContent = state.newToday ? `+${state.newToday} nota${state.newToday > 1 ? 's' : ''} hoje` : '';
  }
  updateStrip();

  /* ---------- the full-screen graph (G / click the pod / the strip) ---------- */
  const ov = document.getElementById('brainOv');
  const bcv = document.getElementById('bvCv'); const bctx = bcv.getContext('2d');
  const search = document.getElementById('bvSearch'); const chipsEl = document.getElementById('bvChips');
  const pane = document.getElementById('bvPane'); const meta = document.getElementById('bvMeta');
  let openNow = false, k = 1.2, tx = 0, ty = 0, hover = null, sel = null, drag = null, match = null, freshOnly = false;
  const groups = [...new Set(nodes.map(n => n.g))].sort();
  const on = new Set(groups);
  function chips() {
    chipsEl.innerHTML = groups.map(g => `<button class="bv-chip${on.has(g) ? ' on' : ''}" data-g="${g}"><i style="background:${GROUP_COL[g] || '#B0ADA3'}"></i>${GROUP_NAME(g)}</button>`).join('') +
      `<button class="bv-chip live${freshOnly ? ' on' : ''}" data-g="__fresh">Novas hoje · ${state.newToday}</button>`;
  }
  chipsEl.addEventListener('click', e => {
    const b = e.target.closest('.bv-chip'); if (!b) return;
    if (b.dataset.g === '__fresh') freshOnly = !freshOnly; else on.has(b.dataset.g) ? on.delete(b.dataset.g) : on.add(b.dataset.g);
    chips();
  });
  search.addEventListener('input', () => { const q = search.value.trim().toLowerCase(); match = q ? new Set(nodes.filter(n => n.id.toLowerCase().includes(q)).map(n => n.i)) : null; });
  search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { search.value = ''; match = null; search.blur(); } });
  const visible = n => on.has(n.g) && (!freshOnly || n.fresh);
  function S() { return Math.min(bcv.clientWidth, bcv.clientHeight) * 0.44 * k; }
  function sx(n) { return bcv.clientWidth * 0.42 + n.x * S() + tx; }
  function sy(n) { return bcv.clientHeight * 0.5 + n.y * S() + ty; }
  bcv.addEventListener('mousemove', e => {
    if (drag) { tx += e.clientX - drag.x; ty += e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; drag.moved = true; return; }
    let best = null, bd = 12;
    for (const n of nodes) { if (!visible(n)) continue; const d = Math.hypot(sx(n) - e.clientX, sy(n) - e.clientY); if (d < bd) { bd = d; best = n; } }
    hover = best; bcv.style.cursor = best ? 'pointer' : 'grab';
  });
  bcv.addEventListener('mousedown', e => { drag = { x: e.clientX, y: e.clientY, moved: false }; });
  addEventListener('mouseup', e => { if (!drag) return; const moved = drag.moved; drag = null; if (!moved && hover && openNow) select(hover); });
  bcv.addEventListener('wheel', e => {
    e.preventDefault(); e.stopPropagation();
    const f = Math.exp(-e.deltaY * 0.0025); const nk = Math.max(0.5, Math.min(7, k * f)); const r = nk / k;
    const cx = bcv.clientWidth * 0.42, cy = bcv.clientHeight * 0.5;
    tx = (tx + cx - e.clientX) * r + e.clientX - cx; ty = (ty + cy - e.clientY) * r + e.clientY - cy; k = nk;
  }, { passive: false });
  function select(n) {
    sel = n;
    const out = [...adj[n.i]].map(i => nodes[i]).sort((a, b) => b.d - a.d);
    const rd = state.reads.get(n.id), wr = state.written.get(n.id);
    pane.innerHTML = `<h3>${esc(n.id)}</h3><div class="bv-path"><i style="background:${GROUP_COL[n.g] || '#B0ADA3'}"></i>${esc(GROUP_NAME(n.g))} · ${n.d} link${n.d === 1 ? '' : 's'}${n.fresh ? ' · <span class="bv-g">novo hoje</span>' : ''}</div>` +
      (wr ? `<div class="bv-lab">Escrito por</div><p>${esc(wr.agent)} · ${timeStr(wr.ts)} · da tarefa «${esc(wr.task)}»</p>` : '') +
      (rd ? `<div class="bv-lab">Lido por último por</div><p>${esc(rd.agent)} · ${timeStr(rd.ts)}</p>` : '') +
      `<div class="bv-lab">Links · ${out.length}</div>` + out.slice(0, 18).map(o => `<div class="bv-lk" data-i="${o.i}">${esc(o.id)}</div>`).join('') +
      (out.length > 18 ? `<div class="bv-more">+${out.length - 18} mais</div>` : '');
    pane.querySelectorAll('.bv-lk').forEach(el => el.addEventListener('click', () => { const t = nodes[+el.dataset.i]; select(t); centre(t); }));
  }
  function centre(n) { tx = -n.x * S(); ty = -n.y * S(); }
  function draw() {
    if (!openNow) return;
    const dpr = devicePixelRatio || 1, Wd = bcv.clientWidth, Hd = bcv.clientHeight;
    if (bcv.width !== Math.round(Wd * dpr)) { bcv.width = Math.round(Wd * dpr); bcv.height = Math.round(Hd * dpr); }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.clearRect(0, 0, Wd, Hd);
    const focus = hover || sel; const hi = focus ? new Set([focus.i, ...adj[focus.i]]) : null;
    bctx.lineWidth = Math.max(.5, .8 * Math.sqrt(k));
    for (const [a, b] of links) {
      const A = nodes[a], B = nodes[b]; if (!visible(A) || !visible(B)) continue;
      const lit = hi && hi.has(a) && hi.has(b);
      bctx.strokeStyle = lit ? 'rgba(232,230,223,.85)' : `rgba(232,230,223,${hi || match ? .05 : .15})`;
      bctx.beginPath(); bctx.moveTo(sx(A), sy(A)); bctx.lineTo(sx(B), sy(B)); bctx.stroke();
    }
    bctx.font = `${Math.max(9, 10 * Math.sqrt(k))}px Inter, -apple-system, sans-serif`; bctx.textBaseline = 'middle';
    for (const n of nodes) {
      if (!visible(n)) continue;
      const x = sx(n), y = sy(n); const r = (1.6 + Math.sqrt(n.d) * .75) * Math.sqrt(k);
      const dim = (hi && !hi.has(n.i)) || (match && !match.has(n.i));
      bctx.globalAlpha = dim ? .2 : 1;
      bctx.fillStyle = GROUP_COL[n.g] || '#B0ADA3'; bctx.beginPath(); bctx.arc(x, y, r, 0, 7); bctx.fill();
      if (n.fresh) { bctx.strokeStyle = GREEN; bctx.lineWidth = 1.5; bctx.beginPath(); bctx.arc(x, y, r + 3, 0, 7); bctx.stroke(); }
      if (sel === n) { bctx.strokeStyle = '#E8E6DF'; bctx.lineWidth = 1.5; bctx.beginPath(); bctx.arc(x, y, r + 4, 0, 7); bctx.stroke(); }
      const label = n.d >= 18 || k > 2.2 || (hi && hi.has(n.i)) || (match && match.has(n.i)) || n.fresh;
      if (label) { bctx.fillStyle = dim ? 'rgba(232,230,223,.35)' : '#E8E6DF'; bctx.fillText(n.id, x + r + 4, y); }
      bctx.globalAlpha = 1;
    }
    requestAnimationFrame(draw);
  }
  let owner = 'AS TUAS NOTAS'; // o nome da empresa vem do servidor (/api/health) quando há um
  function setOwner(name) { owner = String(name || 'AS TUAS NOTAS').toUpperCase(); if (openNow) meta.textContent = `${owner} · ${state.notes.toLocaleString('en-NZ')} NOTES · ${links.length} LINKS`; }
  function open() {
    if (openNow) return;
    openNow = true; ov.classList.add('on'); document.body.classList.add('brainOpen');
    meta.textContent = `${owner} · ${state.notes.toLocaleString('en-NZ')} NOTES · ${links.length} LINKS`;
    chips(); if (!sel) pane.innerHTML = '<div class="bv-empty">Clica numa nota para a ler. Passa o rato para ver as vizinhas.</div>';
    requestAnimationFrame(draw);
  }
  function close() { if (!openNow) return; openNow = false; ov.classList.remove('on'); document.body.classList.remove('brainOpen'); }
  function toggle() { openNow ? close() : open(); }
  document.getElementById('bvClose').addEventListener('click', close);
  addEventListener('resize', () => { if (openNow) draw(); });

  function setTheme(dark) {
    INK = dark ? '236,234,227' : '21,20,20';
    darkOrb = !!dark;
    bloom.material.opacity = dark ? 0.14 : 0.26;
    ring.material.opacity = dark ? 0.5 : 0.34;
    ring2.material.opacity = dark ? 0.24 : 0.16;
    coreGlow.material.opacity = dark ? 0.24 : 0.34;
    eqMat.opacity = dark ? 0.2 : 0.16;
    coreGlow.material.color.set(dark ? '#A9C2A4' : '#C9DCC4');
    shellMat.uniforms.uDark.value = dark ? 1 : 0;
    shellMat.uniforms.uRim.value.set(dark ? '#B9CBB4' : '#9FB79E');
    etch();
  }
  return { read, readNote, write, setGraph, setTheme, setOwner, setQuiet, tick, open, close, toggle, isOpen: () => openNow, state, get nodes() { return nodes; }, get links() { return links; } };
}
