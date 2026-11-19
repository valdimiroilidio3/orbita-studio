// Regressão do cartão do agente: o papel «FUNÇÃO · SALA» (ex.: «... · DESIGN LAB») tem de caber
// dentro do cartão. O bloco de texto (.mh-t) é um filho flex com min-width auto: ficava do tamanho
// da linha inteira e o papel saía pela direita, por cima da cena 3D (1280 px, sala Design Lab).
//
// 1 · estático: a regra `#rail .mh-t { min-width: 0 }` existe em src/shell.html.
// 2 · browser: abre o bundle real, entra na sala Design Lab e mede — o papel não pode passar da
//     borda do cartão. Salta com aviso se não houver Chrome (indicar CHROME_PATH), como o check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SHELL = fs.readFileSync(path.join(ROOT, 'src/shell.html'), 'utf8');
const BUNDLE = path.join(ROOT, 'dist/command-centre-v2.html');

test('CSS: o bloco de texto do cartão do agente encolhe (min-width: 0)', () => {
  assert.match(SHELL, /#rail \.mh-t\s*\{[^}]*min-width:\s*0/);
});

let chromium = null;
try { ({ chromium } = await import('playwright-core')); } catch { chromium = null; }

const abrirBrowser = async () => {
  const args = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, args });
  try { return await chromium.launch({ args }); }
  catch { return chromium.launch({ channel: 'chrome', args }); }
};

test('browser: o papel do Design Lab cabe no cartão do agente (1280 px)', { timeout: 150000 }, async (t) => {
  if (!chromium) return t.skip('playwright-core não instalado');
  if (!fs.existsSync(BUNDLE)) return t.skip('dist/ por construir (node build.mjs)');
  let browser;
  try { browser = await abrirBrowser(); }
  catch { return t.skip('sem Chrome nesta máquina (indicar CHROME_PATH)'); }
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(pathToFileURL(BUNDLE).href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.CC && document.querySelector('canvas'), null, { timeout: 90000 });
    await page.evaluate(() => window.CC.zoomToDept('fin'));
    await page.waitForFunction(() => /DESIGN LAB/.test(document.querySelector('#railAgent .mh-role')?.textContent || ''), null, { timeout: 20000 });
    await page.waitForFunction(() => !document.getAnimations().some((a) => a.playState === 'running'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => {
      const cartao = document.querySelector('#railAgent .mh');
      const bloco = document.querySelector('#railAgent .mh-t');
      const papel = document.querySelector('#railAgent .mh-role');
      return {
        cartaoDireita: cartao.getBoundingClientRect().right,
        blocoDireita: bloco.getBoundingClientRect().right,
        papelDireita: papel.getBoundingClientRect().right,
      };
    });
    assert.ok(m.blocoDireita <= m.cartaoDireita + 1, `bloco do papel sai do cartão: ${m.blocoDireita} > ${m.cartaoDireita}`);
    assert.ok(m.papelDireita <= m.cartaoDireita + 1, `o papel sai do cartão: ${m.papelDireita} > ${m.cartaoDireita}`);
  } finally {
    await browser.close();
  }
});
