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

/* ---------- as plantas: sete, duas espécies, e nenhuma folha dentro de uma parede ---------- */
// 1.9.6: a planta deixou de ser cinco esferas. O que aqui se prova não é o desenho (isso é o olho
// do dono) — é que existem sete, que cada uma é uma planta a sério (folhagem em malha própria,
// vaso, terra) e que CABE no seu pod: o raio da folhagem somado ao afastamento do canto não passa
// da meia-largura do pod, senão uma folha atravessava a parede de vidro.
const plantas = (office.plants || []);
ok(plantas.length === 7, `esperava 7 plantas (6 salas + centro), encontrei ${plantas.length}`);
for (const p of plantas) {
  const L = (office.depts && win.CC.office.depts) ? null : null;
  ok(['upright', 'broad'].includes(p.kind), `${p.dept}: espécie desconhecida (${p.kind})`);
  ok(p.leaves >= 10, `${p.dept}: uma planta com ${p.leaves} folhas não é folhagem`);
  ok(p.top > 1.6 && p.top < 4.2, `${p.dept}: altura fora do razoável (${p.top})`);
  if (p.dept !== 'brain') ok(p.inside === true, `${p.dept}: a folhagem sai do pod (raio ${p.radius})`);
}
ok(plantas.filter(p => p.dept === 'brain').length === 1, 'o centro devia ter uma planta, a peça de apresentação');

/* ---------- as 35 secretárias: pretas, com a luz da sala (1.9.8) ---------- */
// O pedido foi «mesa preta com LED na cor da sala». Aqui lê-se a cena MONTADA, posto a posto:
// cada secretária tem de ter a malha do LED com a cor emissiva igual ao vidro daquela sala, e o
// corpo tem de ser escuro. Se alguém trocar a cor ou voltar a pôr a madeira clara, cai aqui.
const LED_POR_SALA = {};
for (const id of Object.keys(R)) {
  const st = R[id] && R[id].station;
  const desk = R[id] && R[id].desk;          // a secretária (a cadeira fica ao lado, no station)
  const dept = R[id] && R[id].a && R[id].a.dept;
  if (!st || !desk || !dept) continue;
  let led = null, corpo = null, halos = 0;
  desk.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.part === 'deskLed') led = o;
    if (o.userData.part === 'desk') corpo = o;
    if (o.material && o.material.blending === 2) halos++; // 2 = AdditiveBlending (os halos são fundidos numa malha)
  });
  const esperado = (win.CC.office.depts[dept] || {}).glass;
  ok(!!led, `${id}: a secretária não tem LED`);
  if (led && esperado) {
    const cor = '#' + led.material.emissive.getHexString();
    ok(cor === esperado.toLowerCase(), `${id}: o LED da secretária é ${cor} e a sala é ${esperado}`);
    LED_POR_SALA[dept] = cor;
  }
  ok(!!corpo, `${id}: a secretária não tem corpo`);
  if (corpo) {
    const c = corpo.material.color;
    ok(Math.max(c.r, c.g, c.b) < 0.25, `${id}: o corpo da secretária não é preto (${c.getHexString()})`);
  }
  ok(halos >= 1, `${id}: a secretária tem luz mas não tem halo (${halos})`);
  // a cadeira também leva a costura na cor da sala
  let ledCadeira = null;
  st.traverse((o) => { if (o.isMesh && o.userData.part === 'deskLed' && !desk.getObjectById(o.id)) ledCadeira = o; });
  ok(!!ledCadeira && esperado && '#' + ledCadeira.material.emissive.getHexString() === esperado.toLowerCase(),
    `${id}: a costura da cadeira não está na cor da sala`);
}
ok(Object.keys(LED_POR_SALA).length === 6, `esperava as 6 salas iluminadas, encontrei ${Object.keys(LED_POR_SALA).length}`);

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

/* ---------- a marca e a conversa (1.9.7, 26 out 2026) ---------- */
// A marca: saiu o «BETA», entrou «ÓRBITA AGENTES» — e não muda quando o escritório fica ao vivo.
const marca = doc.querySelector('#topbar .brand');
ok(!!marca, 'a marca desapareceu da barra');
if (marca) {
  const texto = marca.textContent.replace(/\s+/g, ' ').trim().toUpperCase();
  ok(texto === 'ÓRBITA AGENTES', `a marca devia ler-se «ÓRBITA AGENTES» e lê «${texto}»`);
  ok(!/BETA/.test(texto), 'o «BETA» continua na marca');
}
ok(!/BETA/.test(doc.title.toUpperCase()), `o título da página ainda diz BETA: ${doc.title}`);

/* ---------- o canto esquerdo: licença e assinatura (27 out 2026) ----------
   O dono pediu «licença ÓRBITA PROJECT 1.0.0 — coloca mesmo de forma bem inteligente, POR CHELTON
   MAHOZE no canto esquerdo». Antes era uma linha de 130 caracteres ao centro, branca em
   mix-blend-mode sobre o escritório. Agora é uma placa de três linhas num canto só, com a frase
   legal inteira no aria-label. Aqui prova-se que está lá, que diz o que tem de dizer, que o canto
   é UM elemento (não duas coordenadas absolutas a poderem colidir) e que a assinatura continua a
   abrir o repositório. */
{
  const canto = doc.getElementById('corner');
  ok(!!canto, 'falta o canto esquerdo (#corner)');
  const placa = doc.getElementById('licence');
  ok(!!placa, 'falta a placa da licença');
  ok(!!canto && !!placa && canto.contains(placa), 'a licença tem de viver dentro do canto');
  const linhas = placa ? [...placa.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()) : [];
  ok(linhas.length === 3, `a placa devia ter três linhas (tem ${linhas.length}): ${linhas.join(' | ')}`);
  const nome = (linhas[1] || '').toUpperCase();
  ok(/ÓRBITA PROJECT/.test(nome) && /1\.0\.0/.test(nome), `a placa tem de dizer «ÓRBITA PROJECT 1.0.0» — diz «${linhas[1]}»`);
  ok(/POR CHELTON MAHOZE/i.test(linhas[2] || ''), `a placa tem de dizer «POR CHELTON MAHOZE» — diz «${linhas[2]}»`);
  const dito = (placa && placa.getAttribute('aria-label')) || '';
  ok(/PolyForm Noncommercial 1\.0\.0/.test(dito), 'o aria-label tem de manter a licença inteira (PolyForm Noncommercial 1.0.0)');
  ok(/Chelton Mahoze/.test(dito) && /2026/.test(dito), 'o aria-label tem de manter a autoria e o ano');
  // a linha antiga (o parágrafo de 130 caracteres a atravessar a cena) não pode voltar
  ok(!/não para revenda/.test((placa && placa.textContent) || ''), 'a placa não pode voltar a ser o parágrafo inteiro');
  const marcaAutor = doc.getElementById('sahniMark');
  ok(!!marcaAutor && canto.contains(marcaAutor), 'a assinatura tem de estar no mesmo canto');
  ok((marcaAutor.getAttribute('href') || '').includes('github.com/valdimiroilidio3/orbita-studio'), 'a assinatura tem de continuar a abrir o repositório');
}

// O compositor: um campo que cresce, uma seta que só responde quando há texto, Shift+Enter.
const mIn = doc.getElementById('mIn'), mSend = doc.getElementById('mSend');
ok(!!mIn && !!mSend, 'o compositor da conversa desapareceu');
if (mIn && mSend) {
  ok(mIn.tagName === 'TEXTAREA', `o campo da conversa devia aceitar mais de uma linha (é ${mIn.tagName})`);
  ok(mSend.tagName === 'BUTTON' && mSend.getAttribute('aria-label'), 'a seta de enviar tem de ser um botão com nome');
  ok(mSend.disabled === true, 'com o campo vazio, a seta começa apagada');
  mIn.value = 'olá';
  mIn.dispatchEvent(new win.Event('input', { bubbles: true }));
  ok(mSend.disabled === false, 'ao escrever, a seta tem de acordar');
  const enter = new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  mIn.dispatchEvent(enter);
  ok(enter.defaultPrevented === true, 'o Enter devia ser tratado pelo compositor (e não mudar de linha)');
  mIn.value = 'duas linhas';
  const shiftEnter = new win.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
  mIn.dispatchEvent(shiftEnter);
  ok(shiftEnter.defaultPrevented === false, 'Shift + Enter tem de deixar escrever uma linha nova');
  ok(doc.getElementById('mChat').querySelector('.m-foot .m-hint'), 'falta a linha de ajuda do compositor');
  mIn.value = ''; mIn.dispatchEvent(new win.Event('input', { bubbles: true }));
  ok(mSend.disabled === true, 'ao esvaziar, a seta volta a apagar-se');
}

// 27 out 2026: o conversador. O cartão tem de ter os três modos, o menu do modelo, os anexos, o
// contexto e o aviso do motor — e o aviso tem de estar calado quando o servidor responde.
{
  const modes = doc.querySelectorAll('#mcModes button');
  ok(modes.length === 3, `o compositor devia ter três modos (tem ${modes.length})`);
  const nomes = [...modes].map((b) => b.textContent.trim()).join(' · ');
  ok(nomes === 'Planear · Perguntar · Construir', `os modos lêem-se «${nomes}»`);
  ok([...modes].filter((b) => b.getAttribute('aria-pressed') === 'true').length === 1, 'só um modo pode estar escolhido');
  ok(modes[1].classList.contains('on'), 'o modo por omissão é Perguntar');
  modes[0].dispatchEvent(new win.Event('click', { bubbles: true }));
  ok(modes[0].getAttribute('aria-pressed') === 'true' && modes[1].getAttribute('aria-pressed') === 'false', 'carregar em Planear tem de trocar o modo');
  ok(doc.getElementById('mc').dataset.mode === 'plan', 'o cartão tem de dizer em que modo está');
  modes[1].dispatchEvent(new win.Event('click', { bubbles: true }));

  const mb = doc.getElementById('mcModel'), menu = doc.getElementById('mcMenu');
  ok(!!mb && mb.getAttribute('aria-haspopup') === 'menu', 'o modelo tem de ser um botão com menu');
  ok(!!menu && menu.hidden === true, 'o menu do modelo começa fechado');
  mb.dispatchEvent(new win.Event('click', { bubbles: true }));
  ok(menu.hidden === false && mb.getAttribute('aria-expanded') === 'true', 'o botão do modelo tem de abrir o menu');
  ok(!!doc.querySelector('#mcMenu .mc-tabs button[data-tab="all"]'), 'o menu tem de ter os separadores de favoritos e todos');
  mb.dispatchEvent(new win.Event('click', { bubbles: true }));
  ok(menu.hidden === true, 'o mesmo botão fecha o menu');

  ok(!!doc.getElementById('mcAdd') && !!doc.getElementById('mcFile'), 'falta o botão de anexar ficheiros');
  ok(doc.getElementById('mcFile').type === 'file', 'os anexos têm de ser um seletor de ficheiros a sério');
  const ctx = doc.getElementById('mcCtx');
  ok(!!ctx && ctx.getAttribute('aria-haspopup') === 'menu', 'falta o menu de contexto');
  ctx.dispatchEvent(new win.Event('click', { bubbles: true }));
  const ctxMenu = doc.getElementById('mcCtxMenu');
  ok(ctxMenu.hidden === false, 'o menu de contexto tem de abrir');
  const rows = ctxMenu.querySelectorAll('.mc-crow');
  ok(rows.length === 3, `o menu de contexto devia ter três linhas (tem ${rows.length})`);
  const term = [...rows].find((r) => r.dataset.ctx === 'terminal');
  ok(term && term.disabled === true, 'o terminal não existe: a linha tem de estar desactivada, não a fingir');
  ok(/terminal/i.test(term.textContent) && /não há terminal/i.test(term.textContent), 'a linha do terminal tem de dizer porque não está disponível');
  ctx.dispatchEvent(new win.Event('click', { bubbles: true }));

  ok(!!doc.getElementById('mcMic'), 'falta o botão de ditar');
  ok(!!doc.querySelector('#mc .mc-pop'), 'o menu tem de viver dentro do cartão');

  // o aviso do motor: o harness responde 503, logo não há motor — tem de estar visível e explicado
  const pro = doc.getElementById('mcPro');
  ok(!!pro && pro.hidden === false, 'sem motor ligado, o aviso tem de aparecer');
  ok(/motor/i.test(pro.textContent), 'o aviso tem de dizer que falta o motor');
  ok(!!doc.getElementById('mcProBtn') && !!doc.getElementById('mcModal'), 'o aviso tem de abrir o estado do motor');

  // o modal não pode viver dentro da gaveta: #rail tem overflow e transform, e um fixed lá dentro fica cortado
  ok(!doc.getElementById('rail').contains(doc.getElementById('mcModal')), 'o modal do motor tem de estar fora do #rail');
}

/* ---------- o compositor de tarefas (27 out 2026) ----------
   O dono apontou para esta caixa — «o chat deve ter um design bonito nesta área» — e o que lá estava
   eram seis pastilhas de 8,5 px na mesma linha («SONNET · AUTOMÁTICO · REPETIR · EQUIPA · SEM IA ·
   ADICIONAR»): lia-se como uma legenda e nada dizia o que era escolha e o que era interruptor.
   Aqui verifica-se a ESTRUTURA que faz o desenho: dois campos com rótulo, um grupo segmentado, e o
   ADICIONAR sólido. E verifica-se a língua: o esforço estava em inglês dentro de uma casa portuguesa. */
{
  const cmd = doc.querySelector('#tpanel .tp-cmd');
  ok(!!cmd, 'falta o compositor de tarefas (#tpanel .tp-cmd)');
  const flds = cmd.querySelectorAll('.tp-r2 .tp-fld');
  ok(flds.length === 2, `a barra devia ter dois campos (modelo e esforço) — tem ${flds.length}`);
  ok([...flds].every((f) => !!f.querySelector('.tp-fld-k') && !!f.querySelector('select')), 'cada campo tem um rótulo e um select');
  const model = cmd.querySelector('.tp-model'), effort = cmd.querySelector('.tp-effort');
  ok(!!model && !!effort, 'faltam os selects do modelo e do esforço');
  ok(flds[0].contains(model) && flds[1].contains(effort), 'o modelo e o esforço têm de estar dentro dos seus campos');
  const modelos = [...model.options].map((o) => o.textContent).join(' · ');
  ok(modelos === 'Sonnet · Opus · Fable', `os modelos lêem-se «${modelos}»`);
  const esforcos = [...effort.options].map((o) => o.textContent);
  ok(esforcos[0] === 'Automático', `a primeira opção do esforço é «Automático» (é «${esforcos[0]}»)`);
  ok(esforcos.includes('Muito alto') && esforcos.includes('Máximo') && !esforcos.includes('X-high'),
    `o esforço tem de estar em português: ${esforcos.join(' · ')}`);
  const tools = cmd.querySelectorAll('.tp-r3 .tp-tools > button');
  ok(tools.length === 3, `o grupo dos interruptores devia ter três botões — tem ${tools.length}`);
  ok(!!cmd.querySelector('.tp-tools .tp-rep') && !!cmd.querySelector('.tp-tools .tp-team') && !!cmd.querySelector('.tp-tools .tp-ai'),
    'repetir, equipa e motor têm de viver no mesmo grupo');
  ok([...tools].every((b) => b.classList.contains('on') === (b.getAttribute('aria-pressed') === 'true') || !b.hasAttribute('aria-pressed')),
    'o estado dos interruptores tem de estar no aria-pressed, não só na cor');
  ok(!!cmd.querySelector('.tp-r2 .tp-add'), 'o ADICIONAR tem de estar na barra dos campos');
  const nota = cmd.querySelector('.tp-r3-note');
  ok(!!nota && /padrão:/.test(nota.textContent), `a nota tem de dizer o que a tarefa usa por omissão («${nota && nota.textContent}»)`);
}

/* ---------- os avatares (27 out 2026) ----------
   O dono pediu 35 pessoas diferentes, com fato, chapéu e mulheres, e mãos que mexem mesmo o rato e
   o teclado. A geometria e o IK provam-se em `office.test.mjs`; aqui prova-se que a CENA é feita
   deles: 35 looks distintos, todos com fato na cor da sala, com teclas que afundam e um rato que é
   uma malha própria (não um enfeite fundido no tampo). */
{
  const av = office.avatars;
  ok(!!av, 'a cena não publica os avatares em window.CC.office.avatars');
  if (av) {
    ok(av.problems.length === 0, 'avatares inconsistentes: ' + av.problems.join(' · '));
    ok(av.stats.total === 35, `deviam ser 35 looks (são ${av.stats.total})`);
    ok(new Set(Object.values(av.looks).map((l) => l.signature)).size === 35, 'há dois agentes com a mesma aparência');
    ok(av.stats.women >= 8, `poucas mulheres (${av.stats.women}) — o dono pediu «alguns serão mulheres»`);
    ok(av.stats.hats >= 5, `poucos chapéus (${av.stats.hats}) — o dono pediu «alguns com chapéu»`);
    const SALAS = new Set(Object.values(av.looks).map((l) => l.suit));
    ok(SALAS.size === 6, `devia haver um fato por sala (seis cores), há ${SALAS.size}`);
    ok(av.meshes > 0 && av.meshes <= 35 * 12, `avatares com demasiadas malhas: ${av.meshes}`);
    // cada posto tem as teclas (uma malha instanciada) e o rato (uma malha que se move)
    const semTeclas = Object.values(R).filter((r) => !r.caps || r.caps.count !== 57);
    ok(semTeclas.length === 0, `${semTeclas.length} postos sem as 57 teclas`);
    const semRato = Object.values(R).filter((r) => !r.mouse || r.mouse.name !== 'mouseG');
    ok(semRato.length === 0, `${semRato.length} postos sem rato móvel`);
  }
}

if (falhas.length) {
  console.error(`✗ cena: ${falhas.length} falha(s)`);
  for (const f of falhas) console.error('  · ' + f);
  process.exit(1);
}
const mapaCores = [...familiaDaSala.entries()].map(([cor, sala]) => `${sala} ${cor}`).join(' · ');
const resumoPlantas = (() => {
  const ps = (office.plants || []);
  if (!ps.length) return 'sem plantas';
  const alturas = ps.map(p => p.top);
  const up = ps.filter(p => p.kind === 'upright').length;
  return `${ps.length} plantas (${up} verticais · ${ps.length - up} de folha larga, ${Math.min(...alturas).toFixed(1)}–${Math.max(...alturas).toFixed(1)} de altura)`;
})();
// 27 out 2026 (1.10.0): as pessoas — 35 aparências distintas, mulheres, chapéus, e um rato que
// é uma malha própria em cada posto (é ele que desliza no tapete quando a mão o empurra)
const avatares = (() => {
  const av = office.avatars || {};
  if (!av.stats) return 'sem avatares';
  return `${av.stats.total} avatares (${av.stats.women} mulheres · ${av.stats.hats} chapéus · ${av.stats.beards} barbas · ${av.stats.glasses} óculos · ${av.stats.styles} estilos), 57 teclas e 1 rato por posto`;
})();
console.log(`✓ cena: ${postos.length} postos, chão de vidro em 7 pods (${mapaCores}), ${resumoPlantas}, 35 secretárias pretas com LED na cor da sala, ${avatares}, espelho acessível com 7 salas + 35 agentes (tecla L), marca ÓRBITA AGENTES e compositor da conversa, sem erros no bundle (${path.basename(ALVO)})`);
if (ruido.length) console.log(`  (nota: ${ruido.length} erro(s) do three por o WebGL do harness ser falso — render targets)`);
process.exit(0);
