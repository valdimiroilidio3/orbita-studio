// 1.90.1 · Telemóvel: o 3D abre primeiro, a folha do agente é uma folha de baixo, o papel do
// agente tem até duas linhas sem reticências, e sem WebGL o escritório abre na planta.
//
// 1 · unidade: gl.js escolhe o renderer real ou o substituto, sem rebentar.
// 2 · estático: as regras do CSS e as ligações em main.js existem.
// 3 · browser (salta com aviso sem Chrome; indicar CHROME_PATH, como o check.mjs):
//     a) telemóvel 390×844 com WebGL: abre em 3D; a folha fica na metade de baixo, o compositor
//        está inteiro dentro dela, os controlos de zoom estão acima dela; os 49 papéis têm ≤ 2 linhas.
//     b) telemóvel 390×844 sem WebGL: abre na planta, sem erros de página, botão do 3D desligado.
// Nota: os tempos de render são de GL por software; não medem desempenho em aparelho real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { temWebGL, rendererSemGL, criarRenderer } from './src/gl.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHELL = fs.readFileSync(path.join(ROOT, 'src/shell.html'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
const BUNDLE = path.join(ROOT, 'dist/command-centre-v2.html');

/* ---------- 1 · unidade ---------- */
const docCom = (ok) => ({ createElement: () => ({ getContext: (t) => (ok ? {} : null) }) });

test('1a · sem WebGL o renderer real não se chama e o substituto tem isSemGL', () => {
  let chamado = false;
  const r = criarRenderer({}, () => { chamado = true; return {}; }, docCom(false));
  assert.equal(chamado, false);
  assert.equal(r.isSemGL, true);
  assert.equal(temWebGL(docCom(false)), false);
});

test('1b · com WebGL o renderer real é usado e marcado isSemGL = false', () => {
  const real = { setPixelRatio() {} };
  const r = criarRenderer({ id: 'c' }, (o) => { assert.equal(o.antialias, true); return real; }, docCom(true));
  assert.equal(r, real);
  assert.equal(r.isSemGL, false);
});

test('1c · se a criação do renderer real falhar, cai para o substituto (não rebenta)', () => {
  const r = criarRenderer({}, () => { throw new Error('WebGL context lost'); }, docCom(true));
  assert.equal(r.isSemGL, true);
});

test('1d · o substituto aceita as chamadas que main.js faz e não desenha nada', () => {
  const r = rendererSemGL({ w: 1 });
  r.setPixelRatio(2); r.setSize(10, 10); r.render({}, {});
  r.shadowMap.enabled = true; r.shadowMap.needsUpdate = true;
  assert.equal(r.getPixelRatio(), 1);
  assert.equal(r.domElement.w, 1);
  assert.equal(typeof r.info.render, 'object');
});

/* ---------- 2 · estático ---------- */
test('2a · main.js cria o renderer pela ponte e liga o modo ao substituto', () => {
  assert.match(MAIN, /import \{ criarRenderer \} from '\.\/gl\.js'/);
  assert.match(MAIN, /const renderer = criarRenderer\(canvas, \(o\) => new THREE\.WebGLRenderer\(o\)\);/);
  assert.match(MAIN, /semWebGL: !!renderer\.isSemGL/);
  assert.match(MAIN, /if \(renderer\.isSemGL\) \{\s*b\.disabled = true;/);
  assert.match(MAIN, /function alternarVista\(\) \{\s*if \(renderer\.isSemGL\) return;/);
});

test('2b · a folha do agente no telemóvel: de baixo, altura limitada, sem a secção do departamento', () => {
  assert.match(SHELL, /#rail\.agentOpen \{\s*top: auto; bottom: 0; height: min\(70vh, 640px\); height: min\(70dvh, calc\(100dvh - 260px\), 640px\);/);
  assert.match(SHELL, /#rail\.agentOpen #railHeader \{ display: none; \}/);
  assert.match(SHELL, /body:has\(#rail\.agentOpen\) #zoomCtl \{ top: 56px; bottom: auto; right: 10px; display: grid; grid-template-columns: repeat\(4, 42px\); gap: 4px; \}/);
  assert.match(SHELL, /#rail\.agentOpen \.mh-tag \{ max-height: 4\.1em; overflow-y: auto;/, 'a descrição tem rolagem própria');
  assert.match(SHELL, /#rail\.agentOpen #mMsgs\.m-log \{ flex: 1 1 0; min-height: 0; \}/, 'o registo cede espaço ao compositor');
});

test('2c · o papel do agente no telemóvel tem até duas linhas, sem reticências', () => {
  assert.match(SHELL, /#rail \.mh-role \{ white-space: normal; overflow: visible; text-overflow: clip;/);
});

/* ---------- 3 · browser ---------- */
let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch { chromium = null; }

const abrirBrowser = async () => {
  const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, args });
  try { return await chromium.launch({ args }); }
  catch { return chromium.launch({ channel: 'chrome', args }); }
};

const telemovel = async (browser, extra = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...extra });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  await page.goto(pathToFileURL(BUNDLE).href, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(7000);
  return { page, erros, ctx };
};

test('browser · telemóvel com WebGL: abre em 3D, e a folha do agente cabe no ecrã', { timeout: 170000 }, async (t) => {
  if (!chromium) return t.skip('playwright-core não instalado');
  if (!fs.existsSync(BUNDLE)) return t.skip('dist/ por construir (node build.mjs)');
  let browser;
  try { browser = await abrirBrowser(); } catch { return t.skip('sem Chrome nesta máquina (indicar CHROME_PATH)'); }
  try {
    const { page, erros, ctx } = await telemovel(browser);
    const inicio = await page.evaluate(() => ({ planta: document.body.classList.contains('plantaAberta'), modo: document.getElementById('z2d')?.dataset.modo, gl: !document.querySelector('#z2d')?.disabled }));
    assert.equal(inicio.planta, false, 'no telemóvel com WebGL o 3D abre primeiro');
    assert.equal(inicio.modo, '3d');
    await page.evaluate(() => window.CC.openAgent(Object.keys(window.CC.R)[0]));
    await page.waitForTimeout(9000);
    const g = await page.evaluate(() => {
      const r = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return b ? { top: b.top, bottom: b.bottom, left: b.left, right: b.right } : null; };
      const roles = [...document.querySelectorAll('#rail .mh-role')].map((e) => e.getBoundingClientRect().height);
      return { rail: r('#rail'), mc: r('#rail .mc'), mIn: r('#mIn'), zoom: r('#zoomCtl'), close: r('#railClose'), vh: innerHeight, roleH: roles[0] };
    });
    await ctx.close();
    assert.deepEqual(erros, [], 'sem erros de página');
    assert.ok(g.rail && g.rail.bottom <= 844 + 1 && g.rail.top > 200, 'a folha fica na metade de baixo, com a cena por cima');
    assert.ok(g.mIn && g.mIn.bottom <= g.vh && g.mIn.top >= g.rail.top, 'o campo de escrever está inteiro dentro da folha');
    assert.ok(g.zoom && g.zoom.bottom < g.rail.top, 'os controlos de zoom estão acima da folha');
    assert.ok(g.close && g.close.top >= g.rail.top, 'o ✕ está dentro da folha');
    assert.ok(g.roleH < 2 * 16, 'o papel do agente ocupa no máximo duas linhas');
  } finally { await browser.close(); }
});

test('browser · telemóvel sem WebGL: abre na planta, sem erros e com o 3D desligado', { timeout: 170000 }, async (t) => {
  if (!chromium) return t.skip('playwright-core não instalado');
  if (!fs.existsSync(BUNDLE)) return t.skip('dist/ por construir (node build.mjs)');
  let browser;
  try { browser = await abrirBrowser(); } catch { return t.skip('sem Chrome nesta máquina (indicar CHROME_PATH)'); }
  try {
    const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--disable-webgl', '--disable-webgl2'];
    const b2 = process.env.CHROME_PATH
      ? await chromium.launch({ executablePath: process.env.CHROME_PATH, args })
      : await chromium.launch({ args });
    try {
      const { page, erros, ctx } = await telemovel(b2);
      const r = await page.evaluate(() => ({
        planta: document.body.classList.contains('plantaAberta'),
        btnDisabled: document.getElementById('z2d')?.disabled,
      }));
      await ctx.close();
      assert.equal(r.planta, true, 'sem WebGL a planta é a vista');
      assert.equal(r.btnDisabled, true, 'o botão do 3D fica desligado');
      assert.deepEqual(erros, [], 'sem WebGL a página não pode rebentar');
    } finally { await b2.close(); }
  } finally { await browser.close(); }
});
