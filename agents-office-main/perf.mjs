#!/usr/bin/env node
/* ============================================================================
   ÓRBITA · MEDIDOR DE PERFORMANCE (3 nov 2026)

   «Melhorar a performance» só é uma frase até haver números. Isto é o que os
   produz: abre o bundle num Chrome a sério, deixa-o desenhar e mede o que a GPU
   recebe e quanto tempo cada frame leva.

   O que mede, por cenário:
     · frame    — p50, p95 e o pior intervalo entre frames (o que o utilizador sente);
     · desenho  — chamadas de desenho e triângulos por frame, lidos do `renderer.info`
                  através de `CC.desempenho()` (números exactos, não estimativas);
     · memória  — geometrias, texturas, programas de shader e heap usado;
     · main     — ms de trabalho na linha principal por frame (CDP `ScriptDuration`). Em
                  software isto inclui as chamadas WebGL, que correm na própria thread; não
                  é «só JavaScript».

   E o que NÃO prova: aqui o WebGL corre em SwiftShader (software), porque não há
   GPU nesta máquina. Os milissegundos servem para comparar ANTES/DEPOIS na mesma
   máquina — nunca para prometer fps num telemóvel. As chamadas de desenho e os
   triângulos são contas exactas e valem em qualquer GPU.

   Uso:
     node perf.mjs                  # mede os três cenários
     node perf.mjs --guardar        # mede e grava perf/ultima.json
     node perf.mjs --comparar       # mede e compara com perf/ultima.json
                                    # (ou com perf/linha-de-base.json, se não houver)
     node perf.mjs --frames=120     # mais amostras (mais lento, mais estável)
     node perf.mjs --json           # só o JSON, para outra ferramenta ler

   CHROME_PATH indica um binário; sem ele usa o Chrome do sistema.
   ============================================================================ */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(RAIZ, 'dist', 'command-centre-v2.html');
const RELATORIO = path.join(RAIZ, 'perf', 'ultima.json');
/* a linha de base de 3 nov 2026 (antes das sombras a meio ritmo) fica guardada para comparação */
const LINHA_DE_BASE = path.join(RAIZ, 'perf', 'linha-de-base.json');

const args = process.argv.slice(2);
const opcao = (nome, defeito) => {
  const a = args.find((x) => x.startsWith('--' + nome + '='));
  return a ? Number(a.split('=')[1]) : defeito;
};
const GUARDAR = args.includes('--guardar');
const COMPARAR = args.includes('--comparar');
const SO_JSON = args.includes('--json');
const FRAMES = Math.max(15, opcao('frames', 40));
const TETO_MS = opcao('teto', 45000); // um cenário nunca demora mais que isto
const AQUECIMENTO = 8; // os primeiros frames incluem compilação de shaders: não contam

/* Os cenários que interessam: a vista de quem chega, uma sala em foco (menos malha no
   ecrã, mais perto) e o telemóvel, onde o cartão e a câmara são outros. */
const CENAS = [
  /* A ESTRUTURA é o que a GPU recebe: chamadas, triângulos, geometrias. Não depende da
     resolução, por isso mede-se ao tamanho real — só alguns frames, que em software cada
     um custa caro. */
  { id: 'estrutura', rotulo: 'estrutura · 1440×900 @2x', viewport: { width: 1440, height: 900 }, dpr: 2, hash: '', frames: 3, aquecimento: 2, teto: 90000 },
  /* O RITMO mede-se mais pequeno: o rasterizador é software e a 5,2 Mpx um frame leva
     segundos. A 900×560 há frames que chegam para percentis, e as diferenças relativas
     (antes/depois) continuam a valer. */
  { id: 'ritmo', rotulo: 'ritmo · 900×560 @1x', viewport: { width: 900, height: 560 }, dpr: 1, hash: '', frames: 40, teto: 60000 },
  { id: 'sala', rotulo: 'sala em foco · 900×560 @1x', viewport: { width: 900, height: 560 }, dpr: 1, hash: '#view=sales', frames: 30, teto: 60000 },
  { id: 'telemovel', rotulo: 'telemóvel · 390×844 @3x', viewport: { width: 390, height: 844 }, dpr: 3, hash: '', frames: 12, teto: 60000 },
];

if (!fs.existsSync(BUNDLE)) {
  console.error('perf: falta ' + path.relative(RAIZ, BUNDLE) + ' — corre `node build.mjs` primeiro.');
  process.exit(1);
}

/* ---------- o servidor: uma página, e uma API que responde «não há servidor» ----------
   Servir por HTTP (em vez de file://) evita o ruído de CORS da vista estática e deixa o
   EventSource da vista ao vivo ligado, como em produção. */
const html = fs.readFileSync(BUNDLE);
const servidor = http.createServer((req, res) => {
  const u = (req.url || '/').split('?')[0];
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(html);
  }
  if (u === '/api/ops/aovivo/stream') { // fluxo SSE vazio, aberto: o EventSource não fica a repetir
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': medidor\n\n');
    req.on('close', () => res.end());
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end('{"erro":"sem servidor"}');
});
await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + servidor.address().port;

/* ---------- chrome ---------- */
let chromium = null;
try { ({ chromium } = await import('playwright')); } catch { try { ({ chromium } = await import('playwright-core')); } catch {} }
if (!chromium) { servidor.close(); console.error('perf: falta playwright-core (npm i).'); process.exit(1); }

const abrir = async () => {
  const a = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, args: a });
  try { return await chromium.launch({ args: a }); } catch { return await chromium.launch({ channel: 'chrome', args: a }); }
};

/* ---------- contas ---------- */
const percentil = (valores, p) => {
  if (!valores.length) return 0;
  const o = [...valores].sort((x, y) => x - y);
  return o[Math.min(o.length - 1, Math.max(0, Math.ceil((p / 100) * o.length) - 1))];
};
const mediana = (v) => percentil(v, 50);
const um = (n, casas = 1) => Number(n).toFixed(casas).replace('.', ',');
const mb = (b) => um(b / 1048576, 1) + ' MB';

const passo = (m) => { if (!SO_JSON) process.stderr.write('  · ' + m + '\n'); };
passo('chrome: a abrir');
const browser = await abrir();
passo('chrome: aberto');
const leituras = [];
const erros = [];

for (const cena of CENAS) {
  const contexto = await browser.newContext({ viewport: cena.viewport, deviceScaleFactor: cena.dpr });
  const page = await contexto.newPage();
  page.on('pageerror', (e) => erros.push(cena.id + ': ' + e.message));

  const t0 = Date.now();
  passo(cena.id + ': a carregar');
  await page.goto(BASE + '/' + cena.hash, { waitUntil: 'load' });
  passo(cena.id + ': página carregada');
  await page.waitForFunction(() => window.CC && typeof window.CC.desempenho === 'function', null, { timeout: 30000 });
  const arranque = Date.now() - t0;
  passo(cena.id + ': CC pronto em ' + arranque + ' ms');
  await page.waitForTimeout(2500); // texturas, primeiro shader de cada material, fontes

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const lerMetricas = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const antes = await lerMetricas();

  /* Amostra até haver frames suficientes OU até o tecto de tempo. Em software um frame
     pesado pode levar um segundo; sem tecto, medir três cenários demorava uma eternidade. */
  passo(cena.id + ': a medir');
  const amostras = await page.evaluate(async ({ frames, aquecimento, teto }) => {
    const out = [];
    const inicio = performance.now();
    let anterior = inicio;
    await new Promise((feito) => {
      const passo = (agora) => {
        const d = window.CC.desempenho();
        out.push({ dt: agora - anterior, calls: d.calls, triangles: d.triangles, frame: d.frame });
        anterior = agora;
        if (out.length >= frames + aquecimento || agora - inicio > teto) return feito();
        requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    });
    return out.slice(aquecimento);
  }, { frames: cena.frames || FRAMES, aquecimento: cena.aquecimento ?? AQUECIMENTO, teto: cena.teto || TETO_MS });

  passo(cena.id + ': ' + amostras.length + ' frames');
  const depois = await lerMetricas();
  const info = await page.evaluate(() => window.CC.desempenho());
  const dts = amostras.map((a) => a.dt);
  const janela = (depois.Timestamp - antes.Timestamp) * 1000;
  const jsMs = (depois.ScriptDuration - antes.ScriptDuration) * 1000;

  leituras.push({
    id: cena.id,
    rotulo: cena.rotulo,
    frames: amostras.length,
    arranqueMs: arranque,
    frameP50: mediana(dts),
    frameP95: percentil(dts, 95),
    frameMax: Math.max(...dts),
    fps: 1000 / mediana(dts),
    framesPorSegundo: amostras.length / (janela / 1000),
    calls: mediana(amostras.map((a) => a.calls)),
    callsMedio: amostras.reduce((t, a) => t + a.calls, 0) / amostras.length,
    callsMax: Math.max(...amostras.map((a) => a.calls)),
    triangles: mediana(amostras.map((a) => a.triangles)),
    trianglesMedio: amostras.reduce((t, a) => t + a.triangles, 0) / amostras.length,
    geometrias: info.geometries,
    texturas: info.textures,
    programas: info.programas,
    pixelRatio: info.pixelRatio,
    buffer: info.tamanho,
    heapMB: depois.JSHeapUsedSize / 1048576,
    nosDom: depois.Nodes,
    jsMsFrame: jsMs / amostras.length,
    jsMs,
    janelaMs: janela,
  });

  await contexto.close();
}

const versao = browser.version();
await browser.close();
servidor.close();

if (erros.length) {
  console.error('perf: a página lançou erros — os números não valem:\n  · ' + erros.join('\n  · '));
  process.exit(1);
}

const quando = new Date().toISOString();
const relatorio = { quando, node: process.version, chrome: versao, frames: FRAMES, casos: leituras };

if (SO_JSON) {
  console.log(JSON.stringify(relatorio, null, 2));
} else {
 /* ---------- a tabela ---------- */
  const w = [26, 9, 9, 9, 7, 10, 10, 10, 9, 8];
  const linha = (c) => c.map((x, i) => String(x).padEnd(w[i])).join('');
  console.log('\nÓRBITA · MEDIDOR DE PERFORMANCE');
  console.log('Chrome ' + versao + ' · WebGL em software (SwiftShader)\n');
  console.log(linha(['cenário', 'frame p50', 'frame p95', 'frame máx', 'fps', 'desenhos', 'média', 'triângulos', 'main/f', 'heap']));
  console.log('─'.repeat(w.reduce((a, b) => a + b, 0)));
  for (const l of leituras) {
    console.log(linha([l.rotulo, um(l.frameP50) + ' ms', um(l.frameP95) + ' ms', um(l.frameMax) + ' ms',
      um(l.fps, 0), um(l.calls, 0) + ' ×', um(l.callsMedio, 0) + ' ×', um(l.trianglesMedio / 1000, 0) + 'k',
      um(l.jsMsFrame) + ' ms', um(l.heapMB) + ' MB']));
  }
  console.log('');
  for (const l of leituras) {
    console.log(`  ${l.id}: arranque ${l.arranqueMs} ms · ${l.geometrias} geometrias · ${l.texturas} texturas · ${l.programas} shaders · ${l.buffer.w}×${l.buffer.h} px (DPR ${l.pixelRatio})`);
  }
  console.log('\n  Nota: os milissegundos são de um rasterizador em software — valem para comparar');
  console.log('  antes/depois nesta máquina, não para prometer fps num telemóvel. Desenhos e');
  console.log('  triângulos são contas exactas do renderer, iguais em qualquer GPU.\n');
}

if (GUARDAR) {
  fs.mkdirSync(path.dirname(RELATORIO), { recursive: true });
  fs.writeFileSync(RELATORIO, JSON.stringify(relatorio, null, 2) + '\n');
  console.log('  gravado em ' + path.relative(process.cwd(), RELATORIO) + '\n');
}

if (COMPARAR) {
  const alvo = fs.existsSync(RELATORIO) ? RELATORIO : (fs.existsSync(LINHA_DE_BASE) ? LINHA_DE_BASE : null);
  if (!alvo) { console.log('  nada para comparar: corre `node perf.mjs --guardar` primeiro.\n'); process.exit(0); }
  const velho = JSON.parse(fs.readFileSync(alvo, 'utf8'));
  const sinal = (n) => (n > 0 ? '+' : '') + um(n);
  console.log('  contra ' + path.basename(alvo) + ' (' + velho.quando.slice(0, 16).replace('T', ' ') + '):');
  for (const agora of leituras) {
    const antes = velho.casos.find((c) => c.id === agora.id);
    if (!antes) continue;
    const pct = (a, b) => (a ? ((b - a) / a) * 100 : 0);
    console.log(`  · ${agora.id}: frame p95 ${sinal(pct(antes.frameP95, agora.frameP95))}% · ` +
      `desenhos/frame ${sinal(pct(antes.callsMedio || antes.calls, agora.callsMedio))}% · triângulos/frame ${sinal(pct(antes.trianglesMedio || antes.triangles, agora.trianglesMedio))}% · ` +
      `guião/f ${sinal(pct(antes.jsMsFrame, agora.jsMsFrame))}%`);
  }
  console.log('');
}
