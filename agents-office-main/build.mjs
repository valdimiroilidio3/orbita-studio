// Bundle src/main.js (+three) into a single self-contained HTML that opens by double-click.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
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
