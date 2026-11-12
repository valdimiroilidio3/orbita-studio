#!/usr/bin/env node
// CLI do núcleo. Uso:
//   node src/cli.mjs elenco
//   node src/cli.mjs motor [claude-cli|api]
//   node src/cli.mjs criar "Nome do projeto" "pedido em texto livre" [pasta-raiz]
//   node src/cli.mjs correr <pasta-do-projeto> [claude-cli|api]
// A chave da API lê-se de ORBITA_CORE_API_KEY e nunca é impressa.

import path from 'node:path';
import { AGENTES, DIVISOES, daDivisao } from './elenco.mjs';
import { escolherMotor } from './motores.mjs';
import { criarProjeto, correrFluxo } from './equipa.mjs';

const [, , comando, ...resto] = process.argv;

function main() {
  if (comando === 'elenco') {
    for (const [id, nome] of Object.entries(DIVISOES)) {
      console.log(`\n${nome} (${daDivisao(id).length})`);
      for (const a of daDivisao(id)) console.log(`  · ${a.nome} [${a.id}] — ${a.papel}`);
    }
    console.log(`\nTotal: ${AGENTES.length} agentes`);
    return;
  }
  if (comando === 'motor') {
    const r = escolherMotor({ preferido: resto[0] });
    const { motivo, ...limpo } = r;
    console.log(JSON.stringify(limpo));
    if (motivo) console.log(motivo);
    return;
  }
  if (comando === 'criar') {
    const [nome, pedido, raiz = 'projetos'] = resto;
    if (!nome || !pedido) throw new Error('uso: criar "Nome" "pedido" [pasta-raiz]');
    const { id, pasta } = criarProjeto(path.resolve(raiz), { nome, pedido });
    console.log(`projeto criado: ${id} em ${pasta}`);
    return;
  }
  if (comando === 'correr') {
    const [pasta, preferido] = resto;
    if (!pasta) throw new Error('uso: correr <pasta-do-projeto> [claude-cli|api]');
    const motor = escolherMotor({ preferido });
    if (motor.motor === 'sem-motor') console.log(`sem motor: ${motor.motivo}`);
    correrFluxo(path.resolve(pasta), { motor }).then((r) => {
      for (const e of r.etapas) console.log(`${e.estado.padEnd(10)} ${e.agente}${e.erro ? ' — ' + e.erro : ''}`);
      console.log(`\nestado do projeto: ${r.estado}`);
      process.exitCode = r.estado === 'concluido' ? 0 : 1;
    });
    return;
  }
  console.log('comandos: elenco | motor [claude-cli|api] | criar "Nome" "pedido" [raiz] | correr <pasta> [claude-cli|api]');
  process.exitCode = comando ? 1 : 0;
}

try {
  main();
} catch (e) {
  console.error(`erro: ${e.message}`);
  process.exitCode = 1;
}
