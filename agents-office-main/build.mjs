// Bundle src/main.js (+three) into a single self-contained HTML that opens by double-click.
//
// 29 out 2026 · LANÇAMENTO. O `dist/` deixou de ser só a pasta onde cai o ficheiro único: passou a ser
// um SÍTIO a sério — um `index.html`, a mesa em `/app`, o ícone, a imagem de partilha, o manifesto e a
// página de 404. É esta pasta que o Vercel publica (ver `vercel.json` na raiz), e é por isso que a cena
// continua a funcionar quando não há servidor: abre e diz que está em só-visualização.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'fs';
import { buildBrainGraph } from './graph-build.mjs';
await buildBrainGraph(); // V3.6: bake the vault's wiki-link graph into src/braingraph.js

const res = await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
});
const js = res.outputFiles[0].text;
const shell = readFileSync('src/shell.html', 'utf8');
const html = shell.replace('<!--APP-->', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/command-centre-v2.html', html);

// dev variant with external script for faster iteration
mkdirSync('dist', { recursive: true });
writeFileSync('dist/app.js', js);
writeFileSync('dist/dev.html', shell.replace('<!--APP-->', '<script src="app.js"></script>'));
console.log(`built dist/command-centre-v2.html (${(html.length / 1024).toFixed(0)} KB)`);

// A mesa de trabalho: a superfície onde o dono decide. Mesmo tratamento — um ficheiro só, sem
// pedidos externos — mas uma entrada própria, para não arrastar o three.js para dentro dela.
const mesaRes = await build({
  entryPoints: ['src/mesa.js'],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: 'es2020',
});
const mesaJs = mesaRes.outputFiles[0].text;
const mesaShell = readFileSync('src/mesa.html', 'utf8');
const mesaHtml = mesaShell.replace('<!--APP-->', () => `<script>${mesaJs}</script>`);
writeFileSync('dist/mesa.html', mesaHtml);
writeFileSync('dist/mesa.js', mesaJs);
writeFileSync('dist/mesa-dev.html', mesaShell.replace('<!--APP-->', '<script src="mesa.js"></script>'));
console.log(`built dist/mesa.html (${(mesaHtml.length / 1024).toFixed(0)} KB)`);

/* ---------- o que faz de `dist/` um sítio (29 out 2026) ---------- */

// 1 · a raiz do sítio: o mesmo ficheiro, com o nome que um servidor procura
copyFileSync('dist/command-centre-v2.html', 'dist/index.html');
// 2 · a mesa em `/app` — o servidor local serve-a, e a cópia em pasta resolve as duas convenções
//     (com `cleanUrls` ligado e desligado)
mkdirSync('dist/app', { recursive: true });
copyFileSync('dist/mesa.html', 'dist/app/index.html');
copyFileSync('dist/mesa.html', 'dist/app.html');

// 3 · a marca: ícone, ícone do iOS e imagem de partilha (gerados por `node tools/brand.mjs`)
const marca = ['icon.svg', 'icon-180.png', 'icon-512.png', 'og.png'];
if (marca.some((f) => !existsSync(`assets/brand/${f}`))) {
  throw new Error('falta um ficheiro de marca — corre `node tools/brand.mjs` antes do build');
}
copyFileSync('assets/brand/icon.svg', 'dist/icon.svg');
copyFileSync('assets/brand/icon-180.png', 'dist/apple-touch-icon.png');
copyFileSync('assets/brand/icon-512.png', 'dist/icon-512.png');
copyFileSync('assets/brand/og.png', 'dist/og.png');

// 4 · o manifesto (para a página poder ser guardada no ecrã inicial) e o `robots.txt`
writeFileSync('dist/manifest.webmanifest', JSON.stringify({
  name: 'Órbita Agentes',
  short_name: 'Órbita',
  description: 'Um escritório isométrico 3D com seis salas, 47 agentes e um Cérebro no centro.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#FDFFF8',
  theme_color: '#FDFFF8',
  lang: 'pt-PT',
  icons: [
    { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  ],
}, null, 2) + '\n');
writeFileSync('dist/robots.txt', 'User-agent: *\nAllow: /\n');

/* A página de 404. O Vercel serve `404.html` sozinho; um servidor estático também. Diz a verdade em
   vez de um erro de servidor: o escritório é uma página só, e esta parte não existe. */
writeFileSync('dist/404.html', `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="utf-8">
<title>Não há nada aqui — Órbita Agentes</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta name="robots" content="noindex">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #FDFFF8; color: #151414;
    font: 15px/1.6 Inter, -apple-system, "Helvetica Neue", sans-serif; text-align: center; padding: 24px; }
  h1 { font-family: "Instrument Serif", Georgia, serif; font-weight: 400; font-size: 40px; margin: 0 0 8px; }
  p { color: #5A5A5A; max-width: 46ch; margin: 0 auto 22px; }
  a { display: inline-block; padding: 11px 20px; border-radius: 99px; background: #151414; color: #FDFFF8;
    text-decoration: none; letter-spacing: .04em; font-size: 13px; }
  img { width: 76px; height: 76px; margin-bottom: 18px; }
</style>
</head>
<body>
  <main>
    <img src="/icon.svg" alt="" width="76" height="76">
    <h1>Esta parte do escritório não existe</h1>
    <p>O Órbita é uma página só: a cena, o painel e o Cérebro vivem todos na entrada. O endereço que
       pediste não é um deles.</p>
    <a href="/">Voltar ao escritório</a>
  </main>
</body>
</html>
`);

console.log('publicado para a web: index.html · app/ · icon.svg · og.png · manifest.webmanifest · robots.txt · 404.html');
