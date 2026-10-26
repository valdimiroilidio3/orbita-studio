// Órbita — correr as avaliações do rascunho, à mão ou depois de mexer no prompt.
//
//   node evals.mjs            os casos contra o modelo local
//   node evals.mjs --json     o resultado em JSON (para CI)
//
// Sem base de dados do dono: cada caso corre numa base em memória e é deitado fora.
import { openDb } from './src/ops/db.mjs';
import { runAll } from './src/ops/evals.mjs';

const db = openDb(':memory:');
const out = await runAll(db);
db.close();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out));
} else {
  for (const r of out.resultados) {
    console.log(`${r.ok ? '✓' : '✗'} ${r.id} — ${r.nome}${r.ok ? '' : '\n    ' + r.falhas.join('\n    ')}`);
  }
  console.log(`\n${out.falhou ? '✗' : '✓'} ${out.passou}/${out.total} · prompt ${out.promptVersion}${out.aviso ? ' · ' + out.aviso : ''}`);
}
process.exit(out.falhou ? 1 : 0);
