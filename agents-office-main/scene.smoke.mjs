// Teste de fumo da CENA — corre o bundle construído num DOM (jsdom) com um contexto WebGL falso.
//
// Porque existe: `node --check` e `npm run build` passam sempre, mesmo quando o código chama uma
// função que já não existe. Aconteceu a 26 out 2026: a limpeza da demonstração apagou `spawnEmote`
// e `addTask` mas deixou as chamadas; a ReferenceError abortava main.js antes de arrancar o ciclo de
// desenho e o escritório aparecia em branco — sem salas, sem pessoas, sem plataforma. Nenhum build
// apanha isso. Este teste apanha: carrega o ficheiro real, espera 3 s e verifica que o módulo
// chegou ao fim (window.CC), que os 35 postos existem e que nada rebentou.
//
// 26 out 2026 (V7): passou também a OLHAR O CHÃO. O dono pediu «um chão da cor dos vidros —
// vermelho, verde, azul, roxo, amarelo e azul céu». Aqui lê-se o material que ficou desenhado
// (window.CC.office.floors), não o que os dados pedem: sete pods, quatro camadas cada, a laje
// translúcida, e cada uma das seis famílias de cor presente exactamente uma vez. O centro
// (Cérebro) tem de ser vidro fosco — é a única excepção, e é de propósito.
//
//   node scene.smoke.mjs            (usa dist/command-centre-v2.html)
//   node scene.smoke.mjs outro.html
import { JSDOM, VirtualConsole } from 'jsdom';
import { familyOf } from './src/palette.js'; // o mesmo módulo puro que a cena usa para derivar o vidro
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ALVO = process.argv[2] || path.join(ROOT, 'dist', 'command-centre-v2.html');
if (!fs.existsSync(ALVO)) { console.error(`sem bundle: ${ALVO} — corre \`npm run build\``); process.exit(2); }

/* ---------- WebGL falso: devolve as constantes e os objectos que o three espera ---------- */
const ENUM = { VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C, VENDOR: 0x1F00, RENDERER: 0x1F01, SCISSOR_BOX: 0x0C10, VIEWPORT: 0x0BA2 };
let seq = 0x9000;
function fakeGL() {
  const t = {
    canvas: null, drawingBufferWidth: 1280, drawingBufferHeight: 800,
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default', failIfMajorPerformanceCaveat: false }),
    getParameter: (p) => {
      if (p === ENUM.VERSION) return 'WebGL 2.0';
      if (p === ENUM.SHADING_LANGUAGE_VERSION) return 'WebGL GLSL ES 3.00';
      if (p === ENUM.VENDOR || p === ENUM.RENDERER) return 'falso';
      if (p === ENUM.SCISSOR_BOX || p === ENUM.VIEWPORT) return [0, 0, 1280, 800];
      return 8192;
    },
    getExtension: () => null, getSupportedExtensions: () => [],
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getProgramParameter: () => true, getShaderParameter: () => true,
    getProgramInfoLog: () => '', getShaderInfoLog: () => '',
    getUniformLocation: () => ({}), getAttribLocation: () => 0,
    getActiveUniform: () => ({ name: 'u', type: 5126, size: 1 }),
    getActiveAttrib: () => ({ name: 'a', type: 5126, size: 1 }),
    checkFramebufferStatus: () => 36053, isContextLost: () => false,
  };
  // qualquer chamada desconhecida é uma função vazia; qualquer CONSTANTE tem um número estável
  return new Proxy(t, {
    get(o, k) {
      if (typeof k === 'symbol') return undefined;
      if (k in o) return o[k];
      if (ENUM[k] !== undefined) return ENUM[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return 0x9000 + (seq++ % 400);
      return () => undefined;
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

/* ---------- contexto 2D falso: a cena só pinta texturas, não precisa de as rasterizar ---------- */
function fake2d(canvas) {
  const grad = { addColorStop() {}, };
  const c = {
    canvas, font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, textAlign: '', textBaseline: '',
    globalCompositeOperation: 'source-over', lineCap: 'butt', lineJoin: 'miter', shadowColor: '', shadowBlur: 0, filter: 'none', imageSmoothingEnabled: true,
    measureText: (s) => ({ width: String(s).length * 7, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => ({}),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData() {}, createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    clip() {}, ellipse() {},
  };
  return new Proxy(c, {
    get(o, k) {
      if (typeof k === 'symbol') return undefined;
      if (k in o) return o[k];
      return () => undefined;      // beginPath, fill, fillText, drawImage, save, restore…
    },
    set(o, k, v) { o[k] = v; return true; },
  });
}

let html = fs.readFileSync(ALVO, 'utf8');
// caça-erros instalado ANTES do bundle, para ter linha e coluna
html = html.replace('<script>', '<script>window.__errs=[];addEventListener("error",function(e){window.__errs.push({m:e.message,l:e.lineno,c:e.colno})});</script><script>');

const gl = fakeGL();
const erros = [];
// consola silenciosa: o jsdom despeja o ficheiro inteiro quando um script rebenta, e isso
// enterrava o resultado do teste. Os erros que interessam são os do caça-erros do bundle.
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = String((e && e.message) || e); if (!/^Uncaught/.test(m)) erros.push(m.slice(0, 200)); });
vc.on('error', () => {}); vc.on('warn', () => {}); vc.on('log', () => {}); vc.on('info', () => {});

const dom = new JSDOM(html, {
  url: 'http://localhost:4520/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(win) {
    win.HTMLCanvasElement.prototype.getContext = function (type) {
      if (type === '2d') return fake2d(this);
      if (String(type).startsWith('webgl') || type === 'experimental-webgl') { gl.canvas = this; return gl; }
      return null;
    };
    win.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
    win.requestAnimationFrame = (f) => setTimeout(() => { try { f(Date.now()); } catch (e) { erros.push('ciclo de desenho: ' + e.message + '  »  ' + String(e.stack || '').split('\n').slice(1, 4).join(' | ').slice(0, 300)); } }, 16);
    win.cancelAnimationFrame = (id) => clearTimeout(id);
    // sem servidor: a cena tem de aguentar. 503 é o caso honesto (nada de dados a fingir)
    win.fetch = async () => ({ ok: false, status: 503, statusText: 'offline', json: async () => ({}), text: async () => '' });
    win.EventSource = class { constructor() { this.readyState = 0; } addEventListener() {} close() {} };
  },
});

// uma promessa rejeitada (o initMcp corre depois do módulo) não pode matar o teste em silêncio:
// passa a ser uma falha reportada como as outras
const rejeicoes = [];
process.on('unhandledRejection', (e) => rejeicoes.push(String((e && e.message) || e)));
process.on('uncaughtException', (e) => { console.error('✗ cena: excepção não tratada — ' + ((e && e.message) || e)); process.exit(1); });

await new Promise(r => setTimeout(r, 3000));
const win = dom.window;

const falhas = [];
const ok = (cond, msg) => { if (!cond) falhas.push(msg); };

const doBundle = (win.__errs || []).map(e => `${e.m} @ ${e.l}:${e.c}`);
ok(doBundle.length === 0, 'o bundle rebentou: ' + doBundle.join(' · '));
// O WebGL falso não simula render targets (shadow map VSM, PMREM): o three rebenta lá dentro com
// "Invalid value used as weak map key". Isso é limitação do harness, não do escritório — o que
// interessa é que NADA do nosso código rebente. Os erros do three são anotados, não contados.
const doHarness = (m) => /weak map key|drawBuffers|setRenderTarget|framebuffer|Framebuffer/i.test(m);
const reais = erros.filter(m => !doHarness(m));
const ruido = erros.filter(doHarness);
ok(reais.length === 0, 'erro no ciclo de desenho: ' + reais.join(' · '));
ok(rejeicoes.length === 0, 'promessa rejeitada sem tratamento: ' + rejeicoes.join(' · '));
ok(!!win.CC, 'main.js não chegou ao fim (window.CC não existe) — há uma ReferenceError pelo caminho');
const R = (win.CC && win.CC.R) || {};
const postos = Object.keys(R);
ok(postos.length === 35, `esperava 35 postos na cena, encontrei ${postos.length}`);
ok(postos.every(id => R[id] && R[id].station && R[id].person), 'há postos sem secretária ou sem pessoa');
ok(!!win.document.getElementById('scene'), 'o canvas #scene desapareceu');
ok(!!win.document.getElementById('hud'), 'o HUD desapareceu');

/* ---------- o chão de vidro: sete pods, quatro camadas, seis cores ---------- */
const office = (win.CC && win.CC.office) || {};
const floors = office.floors || {};
const pods = Object.keys(floors);
ok((office.problems || []).length === 0, 'os dados do escritório não validam: ' + (office.problems || []).join(' · '));
ok(pods.length === 7, `esperava 7 pods com chão, encontrei ${pods.length}`);

const CAMADAS = ['floorBase', 'floorEdge', 'floorGlass', 'floorPool'];
const CORES = ['vermelho', 'verde', 'azul', 'roxo', 'amarelo', 'azul céu'];
const familiaDaSala = new Map();
for (const k of pods) {
  const parts = (floors[k] || {}).parts || {};
  for (const camada of CAMADAS) ok(!!parts[camada], `${k}: falta a camada ${camada} do chão de vidro`);
  const vidro = parts.floorGlass || {}, base = parts.floorBase || {}, poça = parts.floorPool || {};
  ok(vidro.transparent === true, `${k}: a laje do chão não é translúcida`);
  ok(vidro.opacity > 0.3 && vidro.opacity < 0.9, `${k}: opacidade do vidro fora do razoável (${vidro.opacity})`);
  ok(/^#[0-9a-f]{6}$/i.test(base.color || ''), `${k}: a base do chão não tem cor`);
  ok(poça.color === '#ffffff', `${k}: a poça de luz não é branca`);
  // as camadas empilham-se: fundo (0.10) → aresta (0.115) → vidro (0.12, o nível do chão) → poça
  ok(Math.abs(base.top - 0.10) < 0.001, `${k}: a base devia acabar aos 0.10, acaba aos ${base.top}`);
  ok(Math.abs((parts.floorEdge.top) - 0.115) < 0.001, `${k}: a aresta devia acabar aos 0.115, acaba aos ${parts.floorEdge.top}`);
  ok(Math.abs(vidro.top - 0.12) < 0.001, `${k}: o vidro tem de acabar aos 0.12 (onde as secretárias pousam), acaba aos ${vidro.top}`);
  ok(poça.top > vidro.top, `${k}: a poça de luz tem de ficar acima do vidro (${poça.top} ≤ ${vidro.top})`);
  const fam = familyOf(vidro.color);
  if (k === 'brain') { ok(fam === 'neutro', `o centro devia ser vidro fosco, e é ${fam} (${vidro.color})`); continue; }
  ok(fam && fam !== 'neutro', `${k}: o vidro (${vidro.color}) não é de nenhuma família pedida`);
  ok(!familiaDaSala.has(fam), `${k} repete a cor de ${familiaDaSala.get(fam)} (${fam})`);
  familiaDaSala.set(fam, k);
}
for (const cor of CORES) ok(familiaDaSala.has(cor), `falta a cor pedida: ${cor}`);

/* ---------- o espelho acessível: a mesma cena, por palavras (V8, 26 out 2026) ---------- */
// A cena correu; agora exige-se que o escritório exista TAMBÉM fora dela. Não se testa a cor de
// um anel de foco (isso é o olho), testa-se o que um leitor de ecrã e um teclado precisam: nome no
// canvas, uma lista montada com as 7 salas e os 35 agentes, a tecla L a abrir e o Esc a fechar.
const doc = win.document;
const canvas = doc.getElementById('scene');
ok(canvas && canvas.getAttribute('role') === 'img', 'o canvas não tem role="img"');
ok(!!(canvas && (canvas.getAttribute('aria-label') || '').length > 20), 'o canvas não tem nome acessível');
const desc = canvas && canvas.getAttribute('aria-describedby');
ok(!!(desc && doc.getElementById(desc)), 'o canvas aponta para uma descrição que não existe');
ok(!!doc.getElementById('skipIndex'), 'falta a ligação «saltar para a lista»');
const indice = doc.getElementById('officeIndex');
ok(!!indice, 'a lista do escritório não foi montada em #officeIndex');
ok(!!(win.CC && win.CC.a11y), 'window.CC.a11y não existe — o espelho não ficou ligado');
if (indice && win.CC && win.CC.a11y) {
  const salas = indice.querySelectorAll('.oi-room');
  const agentes = indice.querySelectorAll('button.oi-agent');
  ok(salas.length === 7, `a lista devia ter 7 salas (6 + centro), tem ${salas.length}`);
  ok(agentes.length === 35, `a lista devia ter os 35 agentes, tem ${agentes.length}`);
  ok(indice.hidden === true, 'a lista devia começar fechada');
  ok(indice.getAttribute('role') === 'dialog', 'a lista devia ser um diálogo');
  ok([...agentes].every(b => b.tagName === 'BUTTON'), 'há agentes na lista que não são <button>');
  const abertos = Object.keys(R).filter(id => R[id].pill && R[id].pill.getAttribute('role') === 'button');
  ok(abertos.length === 35, `as pastilhas dos agentes deviam ser botões: ${abertos.length}/35`);
  // o caminho do utilizador: a tecla L
  doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'l', bubbles: true }));
  ok(indice.hidden === false, 'a tecla L não abriu a lista');
  ok(doc.activeElement && indice.contains(doc.activeElement), 'ao abrir, o foco não entrou na lista');
  indice.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  ok(indice.hidden === true, 'o Esc não fechou a lista');
  // e o botão visível ao lado do zoom faz o mesmo (não é preciso saber atalhos)
  doc.getElementById('zIndex').click();
  ok(indice.hidden === false, 'o botão da lista não abriu nada');
  win.CC.a11y.close();
}

if (falhas.length) {
  console.error(`✗ cena: ${falhas.length} falha(s)`);
  for (const f of falhas) console.error('  · ' + f);
  process.exit(1);
}
const mapaCores = [...familiaDaSala.entries()].map(([cor, sala]) => `${sala} ${cor}`).join(' · ');
console.log(`✓ cena: ${postos.length} postos, chão de vidro em 7 pods (${mapaCores}), espelho acessível com 7 salas + 35 agentes (tecla L), sem erros no bundle (${path.basename(ALVO)})`);
if (ruido.length) console.log(`  (nota: ${ruido.length} erro(s) do three por o WebGL do harness ser falso — render targets)`);
process.exit(0);
