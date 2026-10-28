#!/usr/bin/env node
/* ===========================================================================
   `npm run prontidao` — o que falta para lançar, dito antes do deploy.

   Corre na tua máquina, lê o `.env` (sem nunca imprimir valores) e imprime a
   lista do `api/_prontidao.mjs`, a mesma que `/api/health` resume e que
   `/sistema/prontidao` devolve. Se faltar algo CRÍTICO, sai com código 1 — é o
   que faz disto uma guarda e não um relatório.

     npm run prontidao
     npm run prontidao -- --json     (para encadear noutro script)
   =========================================================================== */
import { loadEnv } from '../config.mjs';
import { avaliarProntidao, variaveisEmFalta } from '../api/_prontidao.mjs';

const json = process.argv.includes('--json');
const carregadas = loadEnv();
const r = avaliarProntidao(process.env);

if (json) {
  console.log(JSON.stringify({ ...r, carregadasDoFicheiro: carregadas.length }, null, 2));
  process.exit(r.pronto ? 0 : 1);
}

const VERDE = '\x1b[32m', VERMELHO = '\x1b[31m', AMARELO = '\x1b[33m', CINZA = '\x1b[2m', FIM = '\x1b[0m';
const marca = (ok, critico) => (ok ? `${VERDE}✓${FIM}` : critico ? `${VERMELHO}✗${FIM}` : `${AMARELO}·${FIM}`);

console.log(`\n  ÓRBITA · prontidão para lançar ${CINZA}(.env: ${carregadas.length} variável(is) carregada(s))${FIM}\n`);

for (const g of r.grupos) {
  const estado = g.pronto ? `${VERDE}pronto${FIM}` : g.critico ? `${VERMELHO}falta${FIM}` : `${AMARELO}desligado${FIM}`;
  console.log(`  ${marca(g.pronto, g.critico)} ${g.nome.padEnd(22)} ${estado}`);
  if (!g.pronto) console.log(`    ${CINZA}${g.porque}${FIM}`);
  for (const i of g.itens) {
    if (i.pronto) {
      console.log(`      ${VERDE}·${FIM} ${i.variavel}`);
    } else {
      const alt = i.alternativas.length ? ` ${CINZA}(ou ${i.alternativas.join(' / ')})${FIM}` : '';
      const min = i.minimo ? ` ${CINZA}≥ ${i.minimo} caracteres${FIM}` : '';
      console.log(`      ${CINZA}·${FIM} ${i.variavel}${alt}${min} ${CINZA}— ${i.porque}${FIM}`);
    }
  }
  console.log('');
}

console.log(`  ${r.pronto ? VERDE + '✓' : VERMELHO + '✗'} ${r.resumo}${FIM}\n`);
if (!r.pronto) {
  console.log(`  ${CINZA}Cola no painel da Vercel (Settings → Environment Variables), e volta a correr isto.${FIM}`);
  console.log(`  ${CINZA}Em falta: ${variaveisEmFalta(process.env).join(', ')}${FIM}\n`);
}
process.exit(r.pronto ? 0 : 1);
