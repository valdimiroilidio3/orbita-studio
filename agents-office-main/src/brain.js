// Órbita — o Cérebro como folha de vidro suspensa (25 out 2026; antes era o grafo em tinta no ar).
// The particle nebula is gone. The vault's wiki-link graph (src/braingraph.js, baked by
// graph-build.mjs) is drawn into the floor of the centre pod as faint ink line-work: texture at
// overview, a graph when you lean in. It moves only when an agent READS (a note glints green and a
// dashed line runs to the desk for two seconds) or WRITES (a finished task becomes a new note off
// its department's hub). The Task Status panel carries a small Brain strip — last read, notes
// added today, Open the Brain — and G / clicking the pod opens the full-screen Obsidian graph.
import * as THREE from 'three';
import { BRAIN as BRAIN0 } from './braingraph.js';
import { PROFILE } from './profile.js';
const BRAIN = (PROFILE && PROFILE.graph && PROFILE.graph.nodes && PROFILE.graph.nodes.length) ? PROFILE.graph : BRAIN0; // INDUSTRY PROFILE: the demo company's own graph
import { AGENTS } from './data.js';

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
const timeStr = ts => new Date(ts).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const agentOf = id => AGENTS.find(a => a.id === id);

// a composição da folha, isolada para poder ser desenhada fora do escritório (testes, imagens)
export function drawBrainSheet(ctx, o) {
  const { nodes, links, onFloor, pt, ink, dark, PX, PY, notes } = o;
  const C = o.C ?? PX / 2, CY = o.CY ?? Math.round(PY * 0.447);
  const P = pt;
  const darkSheet = !!dark;
  const rounded = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };
  const tracked = (text, x, y, sp, align = 'left') => {
    const w = [...text].reduce((s2, ch) => s2 + ctx.measureText(ch).width + sp, 0) - sp;
    let cx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  };
    ctx.clearRect(0, 0, PX, PY);
    const L = 26, T = 26, R = PX - 26, B = PY - 26, RAD = 36;

    // a folha
    rounded(L, T, R - L, B - T, RAD);
    const sheet = ctx.createLinearGradient(0, T, 0, B);
    if (darkSheet) {
      sheet.addColorStop(0, 'rgba(46,49,45,.90)'); sheet.addColorStop(.55, 'rgba(26,28,25,.84)'); sheet.addColorStop(1, 'rgba(18,20,18,.88)');
    } else {
      sheet.addColorStop(0, 'rgba(255,255,255,.88)'); sheet.addColorStop(.58, 'rgba(252,253,248,.74)'); sheet.addColorStop(1, 'rgba(243,246,238,.82)');
    }
    ctx.fillStyle = sheet; ctx.fill();

    // bloom interior, dentro da folha
    ctx.save(); rounded(L, T, R - L, B - T, RAD); ctx.clip();
    const bl = ctx.createRadialGradient(C, CY - 6, 30, C, CY - 6, 430);
    bl.addColorStop(0, darkSheet ? 'rgba(209,222,205,.18)' : 'rgba(86,116,92,.11)');
    bl.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bl; ctx.fillRect(L, T, R - L, B - T);
    ctx.restore();

    // contorno: hairline exterior + brilho interior em cima
    rounded(L, T, R - L, B - T, RAD);
    ctx.lineWidth = 2; ctx.strokeStyle = `rgba(${ink},.17)`; ctx.stroke();
    rounded(L + 3, T + 3, R - L - 6, B - T - 6, RAD - 3);
    ctx.lineWidth = 2; ctx.strokeStyle = darkSheet ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.85)'; ctx.stroke();
    // sombra interior em baixo — dá espessura ao vidro
    ctx.save(); rounded(L, T, R - L, B - T, RAD); ctx.clip();
    const sh = ctx.createLinearGradient(0, B - 190, 0, B);
    sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, darkSheet ? 'rgba(0,0,0,.22)' : 'rgba(30,40,32,.07)');
    ctx.fillStyle = sh; ctx.fillRect(L, B - 190, R - L, 190);
    ctx.restore();

    // arestas — curvas, hairline; as que tocam num hub ficam um tom mais firmes
    for (const [a, b] of links) {
      if (!onFloor(nodes[a]) || !onFloor(nodes[b])) continue;
      const [x1, y1] = P(nodes[a]), [x2, y2] = P(nodes[b]);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const bow = Math.min(13, len * 0.055);
      const qx = (x1 + x2) / 2 - (dy / len) * bow, qy = (y1 + y2) / 2 + (dx / len) * bow;
      const strong = nodes[a].d >= 4 || nodes[b].d >= 4;
      ctx.strokeStyle = `rgba(${ink},${strong ? .17 : .10})`;
      ctx.lineWidth = strong ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(qx, qy, x2, y2); ctx.stroke();
    }

    // nós — halos nos hubs, pontos nas folhas, verde nos de hoje
    const drawn = nodes.filter(onFloor).sort((a, b) => a.d - b.d);
    for (const n of drawn) {
      const [x, y] = P(n);
      const r = n.d >= 6 ? 5.6 : n.d >= 4 ? 4.4 : n.d >= 3 ? 3.4 : 2.6;
      if (n.d >= 4) {
        const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 5);
        halo.addColorStop(0, n.fresh ? 'rgba(30,144,112,.28)' : `rgba(${ink},.10)`);
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, r * 5, 0, 7); ctx.fill();
      }
      ctx.fillStyle = n.fresh ? '#1E9070' : `rgba(${ink},${n.d >= 4 ? .62 : .38})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      if (n.d >= 4) { // anel na cor da pasta — a única cor da folha, e com significado
        ctx.strokeStyle = (GROUP_COL[n.g] || '#B0ADA3');
        ctx.globalAlpha = n.d >= 6 ? 0.85 : 0.55;
        ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.arc(x, y, r + 4.6, 0, 7); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // legenda
    ctx.strokeStyle = `rgba(${ink},.11)`; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(L + 52, B - 96); ctx.lineTo(R - 52, B - 96); ctx.stroke();
    ctx.fillStyle = '#1E9070'; ctx.beginPath(); ctx.arc(L + 33, B - 58, 5.2, 0, 7); ctx.fill();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillStyle = `rgba(${ink},.74)`; ctx.font = '500 30px Georgia, "Times New Roman", serif';
    tracked('O Cérebro', L + 52, B - 57, 5.5);
    ctx.fillStyle = `rgba(${ink},.34)`; ctx.font = '500 19px ui-monospace, Menlo, monospace';
    tracked('GRAFO DE NOTAS', R - 52, B - 57, 3.6, 'right');
    ctx.fillStyle = `rgba(${ink},.26)`; ctx.font = '500 17px ui-monospace, Menlo, monospace';
    tracked(`${notes ?? nodes.length} NOTAS · ${links.length} LIGAÇÕES`, (L + R) / 2, B - 57, 3.2, 'center');
  }

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


  /* ---------- o Cérebro: uma folha de vidro suspensa ----------
     Passagem «restrição Apple» (25 out 2026). O grafo deixou de ser tinta a flutuar no ar: vive
     dentro de uma folha de vidro fosco virada para a câmara — hairline, brilho interior em cima,
     uma bloom radial por trás do desenho, arestas ligeiramente curvas, halo nos nós que mais ligam
     e uma legenda com letra espaçada ao longo da base. Respira devagar; nada mais se mexe. */
  const BW = 11.5, BH = 6.9;                 // tamanho da folha no mundo
  const PX = 1200, PY = 720;                 // tela (5:3)
  const CENTRE = new THREE.Vector3(0, 4.05, 0);
  const FX = 470, FY = 250;                  // px de tela por unidade do grafo
  const C = PX / 2, CY = 322;
  let darkSheet = false;

  let floorPos = new Map(BRAIN.floor.map(([x, y], i) => [i, { x, y }]));
  // centrar e caber: o layout vem do cofre com folga irregular — a folha exige composição
  function fitFloor() {
    const pts = [...floorPos.values()];
    if (!pts.length) return;
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    // anisotrópico de propósito: o layout vem de uma projecção e é mais alto que largo;
    // esticar cada eixo até à margem da folha é o que faz a composição respirar
    const kx = 1.92 / ((maxx - minx) || 1), ky = 1.32 / ((maxy - miny) || 1);
    for (const p of pts) { p.x = (p.x - cx) * kx; p.y = (p.y - cy) * ky; }
  }
  fitFloor();
  const onFloor = n => floorPos.has(n.i);
  const FP = n => floorPos.get(n.i);
  const cv = document.createElement('canvas'); cv.width = PX; cv.height = PY;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const board = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  board.scale.set(BW, BH, 1); board.position.copy(CENTRE); board.renderOrder = 6;
  board.userData.dept = 'brain';
  brainGroup.add(board);

  const P = n => { const f = FP(n); return [C + f.x * FX, CY + f.y * FY]; };
  const _r = new THREE.Vector3(), _u = new THREE.Vector3();
  const W = n => { // unidade → mundo, no plano da folha (direita e cima da câmara)
    const f = FP(n) || { x: n.x, y: n.y }; const cam = getCamera();
    _r.setFromMatrixColumn(cam.matrixWorld, 0).normalize(); _u.setFromMatrixColumn(cam.matrixWorld, 1).normalize();
    return CENTRE.clone()
      .addScaledVector(_r, (f.x * FX) * (BW / PX))
      .addScaledVector(_u, -(f.y * FY) * (BH / PY));
  };

  // a bloom por trás da folha — levanta-a do fundo em vez de a colar lá
  const bloomTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 8, 128, 128, 126);
    g.addColorStop(0, 'rgba(210,224,206,.85)'); g.addColorStop(.45, 'rgba(198,214,194,.30)'); g.addColorStop(1, 'rgba(198,214,194,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: bloomTex, transparent: true, opacity: 0.30, depthWrite: false, blending: THREE.AdditiveBlending }));
  bloom.scale.set(BW * 1.85, BH * 2.05, 1); bloom.position.copy(CENTRE).add(new THREE.Vector3(0, -0.1, -0.05));
  bloom.renderOrder = 2; bloom.userData.dept = 'brain';
  brainGroup.add(bloom);

  // o anel de luz na base — o «stand» do objecto
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.34, 3.44, 128),
    new THREE.MeshBasicMaterial({ color: '#8FA98F', transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; ring.renderOrder = 3; ring.userData.dept = 'brain';
  brainGroup.add(ring);
  const ring2 = new THREE.Mesh(
    new THREE.RingGeometry(4.5, 4.53, 128),
    new THREE.MeshBasicMaterial({ color: '#A9BBA8', transparent: true, opacity: 0.20, side: THREE.DoubleSide, depthWrite: false })
  );
  ring2.rotation.x = -Math.PI / 2; ring2.position.y = 0.15; ring2.renderOrder = 3; ring2.userData.dept = 'brain';
  brainGroup.add(ring2);

  function etch() {
    drawBrainSheet(ctx, { nodes, links, onFloor, pt: P, ink: INK, dark: darkSheet, PX, PY, C, CY, notes: state.notes });
    tex.needsUpdate = true;
  }
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
    const hf = FP(hub) || { x: hub.x, y: hub.y };
    floorPos.set(n.i, { x: Math.max(-0.98, Math.min(0.98, hf.x + Math.cos(ang) * 0.09)), y: Math.max(-0.98, Math.min(0.98, hf.y + Math.sin(ang) * 0.09)) });
    nodes.push(n); byId.set(id, n.i); adj.push(new Set([hub.i])); adj[hub.i].add(n.i); links.push([hub.i, n.i]); hub.d++;
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
    floorPos = new Map((g.floor || []).map(([x, y], i) => [i, { x, y }]));
    fitFloor();
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
  function tick(now) {
    // a folha respira: 0,4 % de escala e 6 cm de deriva — o suficiente para se ler como objecto
    const br = 1 + Math.sin(now / 2600) * 0.004;
    board.scale.set(BW * br, BH * br, 1);
    board.position.y = CENTRE.y + Math.sin(now / 3400) * 0.06;
    bloom.position.y = CENTRE.y - 0.1 + Math.sin(now / 3400) * 0.06;
    if (now > nextPulse && !quiet) { flatPulse(nodes[0]); nextPulse = now + 6000; } // o brilho de 6 s no hub maior (só demonstração)
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], k = (now - p.born) / 2000;
      if (k >= 1) { scene.remove(p.m); p.m.material.dispose(); pulses.splice(i, 1); continue; }
      const a = Math.sin(k * Math.PI);
      p.m.material.opacity = 0.55 * a; const r = (0.5 + 0.75 * k) * BW / 130 * 4; p.m.scale.set(r, r, 1);
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
  let owner = PROFILE && PROFILE.company ? String(PROFILE.company).toUpperCase() : 'AS TUAS NOTAS'; // V3.1: the business name when served (was hard-coded to one company); INDUSTRY PROFILE: the demo company
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
    darkSheet = !!dark;
    bloom.material.opacity = dark ? 0.16 : 0.30;
    ring.material.opacity = dark ? 0.55 : 0.42;
    ring2.material.opacity = dark ? 0.28 : 0.20;
    etch();
  }
  return { read, readNote, write, setGraph, setTheme, setOwner, setQuiet, tick, open, close, toggle, isOpen: () => openNow, state, get nodes() { return nodes; }, get links() { return links; } };
}
