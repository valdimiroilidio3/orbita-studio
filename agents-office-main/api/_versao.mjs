/* A versão da aplicação, num sítio só.

   Estava escrita à mão em `api/health.mjs` (1.18.0) e em `api/_rotas.mjs`
   (1.17.0) e as duas ficaram para trás do `package.json` — a produção dizia
   1.18.0 quando o código era 1.19.1. Aqui lê-se do `package.json`, que é a
   fonte da verdade, e o `build.mjs` injeta a mesma nos ficheiros do cliente. */
import fs from 'node:fs';

function ler() {
  try {
    const json = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return String(json.version || '');
  } catch {
    return '';
  }
}

export const VERSAO = ler() || 'desconhecida';
