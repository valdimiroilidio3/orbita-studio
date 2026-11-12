// Ponte entre o escritório e a base nova de agentes (orbita-core).
//
// O escritório continua a ser o dono do servidor, das chaves e das tarefas. Esta ponte só:
//   · diz quem está na equipa (elenco e fluxo) e que motor seria usado;
//   · cria um projeto e corre o fluxo em segundo plano, em data/empresa/projetos/<id>/;
//   · lê o estado de um projeto (project.json + passagens em handoffs/).
// Os projetos e os ficheiros que os agentes escrevem ficam dentro de data/, que não vai para o Git.
// Criar um projeto segue a guarda do escritório (como as tarefas): sessão e papel em modo com contas; aberto em modo local.

import fs from 'node:fs';
import path from 'node:path';
import { AGENTES, DIVISOES } from '../orbita-core/src/elenco.mjs';
import { FLUXO, criarProjeto, correrFluxo } from '../orbita-core/src/equipa.mjs';
import { escolherMotor } from '../orbita-core/src/motores.mjs';

export const LIMITE_NOME = 80;
export const LIMITE_PEDIDO = 4000;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const correm = new Map(); // id → promessa do fluxo em curso (só neste processo)
let cacheMotor = { quando: 0, valor: null };
const VALIDADE_MOTOR_MS = 60_000;

export const raizProjetos = (dataDir) => path.join(dataDir, 'empresa', 'projetos');

/** Esquece o motor detetado (testes, ou depois de instalar o Claude Code sem reiniciar). */
export function limparCacheMotor() { cacheMotor = { quando: 0, valor: null }; }

/** Motor a usar agora. Cacheado 60 s, porque `claude --version` é síncrono. */
export function motorAgora(env = process.env, { agora = Date.now(), detetar } = {}) {
  if (cacheMotor.valor && agora - cacheMotor.quando < VALIDADE_MOTOR_MS) return cacheMotor.valor;
  const valor = detetar ? escolherMotor({ env, detetarCli: detetar }) : escolherMotor({ env });
  cacheMotor = { quando: agora, valor };
  return valor;
}

function listarProjetos(raiz) {
  if (!fs.existsSync(raiz)) return [];
  return fs.readdirSync(raiz, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SLUG.test(e.name) && fs.existsSync(path.join(raiz, e.name, 'project.json')))
    .map((e) => resumo(raiz, e.name))
    .sort((a, b) => (a.criadoEm < b.criadoEm ? 1 : -1));
}

function resumo(raiz, id) {
  const e = JSON.parse(fs.readFileSync(path.join(raiz, id, 'project.json'), 'utf8'));
  const feitas = e.etapas.filter((x) => x.estado === 'concluido').length;
  const parada = e.etapas.find((x) => x.estado !== 'concluido' && x.estado !== 'por-fazer');
  return {
    id: e.id, nome: e.nome, criadoEm: e.criadoEm,
    etapasFeitas: feitas, etapasTotal: e.etapas.length,
    estado: correm.has(id) ? 'a-correr' : (feitas === e.etapas.length ? 'concluido' : (parada ? parada.estado : 'por-fazer')),
  };
}

/** Estado geral: equipa, fluxo, motor e projetos. Não expõe chaves. */
export function estado({ dataDir, env = process.env, agora, detetar } = {}) {
  const motor = motorAgora(env, { agora, detetar });
  return {
    divisoes: DIVISOES,
    agentes: AGENTES.map(({ id, divisao, nome, papel }) => ({ id, divisao, nome, papel })),
    fluxo: FLUXO.map(({ fase, agente, entregas }) => ({ fase, agente, entregas })),
    motor: { motor: motor.motor, ...(motor.motivo ? { motivo: motor.motivo } : {}), ...(motor.modelo ? { modelo: motor.modelo } : {}) },
    projetos: listarProjetos(raizProjetos(dataDir)),
  };
}

/** Valida o pedido. Devolve { erro } ou { nome, pedido }. */
export function validarPedido(b = {}) {
  const nome = typeof b.nome === 'string' ? b.nome.trim() : '';
  const pedido = typeof b.pedido === 'string' ? b.pedido.trim() : '';
  if (!nome) return { erro: 'falta o nome do projeto' };
  if (nome.length > LIMITE_NOME) return { erro: `o nome tem no máximo ${LIMITE_NOME} caracteres` };
  if (!pedido) return { erro: 'falta o pedido' };
  if (pedido.length > LIMITE_PEDIDO) return { erro: `o pedido tem no máximo ${LIMITE_PEDIDO} caracteres` };
  if (b.motor !== undefined && !['claude-cli', 'api'].includes(b.motor)) return { erro: 'motor inválido: usa claude-cli ou api' };
  return { nome, pedido, motor: b.motor };
}

/**
 * Cria o projeto e começa o fluxo em segundo plano. Não espera pelo fim (pode levar minutos).
 * Sem motor, não cria nada: devolve o motivo.
 */
export function criar({ dataDir, nome, pedido, motor: preferido, env = process.env, fetchImpl, agora, detetar }) {
  const m = preferido ? escolherMotor({ preferido, env, detetarCli: detetar }) : motorAgora(env, { agora, detetar });
  if (m.motor === 'sem-motor') return { status: 422, corpo: { erro: 'sem motor', motivo: m.motivo } };
  const raiz = raizProjetos(dataDir);
  fs.mkdirSync(raiz, { recursive: true });
  let projeto;
  try {
    projeto = criarProjeto(raiz, { nome, pedido });
  } catch (e) {
    return { status: 409, corpo: { erro: e.message } };
  }
  const execucao = correrFluxo(projeto.pasta, { motor: m, env, fetchImpl })
    .catch((e) => ({ estado: 'erro', erro: e.message }))
    .finally(() => correm.delete(projeto.id));
  correm.set(projeto.id, execucao);
  return { status: 202, corpo: { id: projeto.id, estado: 'a-correr', motor: m.motor } };
}

/** Lê um projeto. Devolve null se não existir. */
export function lerProjeto({ dataDir, id }) {
  if (typeof id !== 'string' || !SLUG.test(id)) return null;
  const raiz = raizProjetos(dataDir);
  const ficheiro = path.join(raiz, id, 'project.json');
  if (!fs.existsSync(ficheiro)) return null;
  const e = JSON.parse(fs.readFileSync(ficheiro, 'utf8'));
  const passagens = fs.existsSync(path.join(raiz, id, 'handoffs'))
    ? fs.readdirSync(path.join(raiz, id, 'handoffs')).sort()
    : [];
  return { ...e, correndo: correm.has(id), passagens };
}

/** Espera pelo fim do fluxo em curso (para testes e para o encerramento limpo). */
export async function esperarFluxo(id) {
  const p = correm.get(id);
  if (p) await p;
}
