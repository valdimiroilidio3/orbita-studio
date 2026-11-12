// Motores de execução. Dois caminhos, escolhidos por tarefa:
//   · claude-cli: o Claude Code instalado nesta máquina, a correr dentro da pasta do projeto.
//                 Escreve os ficheiros diretamente. Usa a sessão de quem o instalou.
//   · api:        um endpoint compatível com OpenAI (chat completions). A chave fica no ambiente
//                 do servidor (ORBITA_CORE_API_KEY) e nunca é escrita em ficheiros nem em registos.
//   · sem-motor:  nenhum dos dois está disponível. Nada é inventado: a etapa para e fica registada.
//
// Nenhum caminho usa shell. Os ficheiros que um agente escreve ficam sempre dentro da pasta do projeto.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MOTORES = ['claude-cli', 'api'];
const TEMPO_MAX_MS = 10 * 60 * 1000;
const MAX_SAIDA = 2 * 1024 * 1024;

/** Verifica se o CLI do Claude responde. Sem shell, com tempo limite curto. */
export function claudeDisponivel(bin = 'claude') {
  try {
    const r = spawnSync(bin, ['--version'], { stdio: 'ignore', timeout: 8000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

/**
 * Escolhe o motor. Com `preferido` força esse motor e diz claramente se não está disponível.
 * Sem `preferido`: CLI se existir, senão API se houver URL e chave, senão sem-motor.
 */
export function escolherMotor({ preferido, env = process.env, detetarCli = claudeDisponivel } = {}) {
  const bin = env.ORBITA_CORE_CLAUDE_BIN || 'claude';
  const temApi = Boolean(env.ORBITA_CORE_API_URL && env.ORBITA_CORE_API_KEY);
  if (preferido === 'claude-cli') {
    return detetarCli(bin) ? { motor: 'claude-cli', bin } : { motor: 'sem-motor', motivo: 'O CLI do Claude Code não responde a `claude --version` nesta máquina.' };
  }
  if (preferido === 'api') {
    return temApi ? { motor: 'api', modelo: env.ORBITA_CORE_MODEL || '' } : { motor: 'sem-motor', motivo: 'Faltam ORBITA_CORE_API_URL ou ORBITA_CORE_API_KEY no ambiente do servidor.' };
  }
  if (detetarCli(bin)) return { motor: 'claude-cli', bin };
  if (temApi) return { motor: 'api', modelo: env.ORBITA_CORE_MODEL || '' };
  return { motor: 'sem-motor', motivo: 'Nenhum motor disponível: instala o Claude Code (claude) ou define ORBITA_CORE_API_URL e ORBITA_CORE_API_KEY no servidor.' };
}

/** Caminho dentro da pasta do projeto, ou erro. Recusa absolutos, `..` e fugas por links. */
export function dentroDaPasta(pasta, relativo) {
  if (typeof relativo !== 'string' || !relativo.trim()) throw new Error('caminho vazio');
  if (path.isAbsolute(relativo) || relativo.includes('\0')) throw new Error(`caminho fora do projeto: ${relativo}`);
  const partes = relativo.split(/[\\/]+/);
  if (partes.includes('..')) throw new Error(`caminho fora do projeto: ${relativo}`);
  const raiz = path.resolve(pasta);
  const alvo = path.resolve(raiz, relativo);
  if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) throw new Error(`caminho fora do projeto: ${relativo}`);
  return alvo;
}

/** Lista ficheiros (caminhos relativos) de uma pasta, recursivamente. */
export function listarFicheiros(pasta, base = pasta, saida = []) {
  if (!fs.existsSync(pasta)) return saida;
  for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'handoffs' || e.name === 'project.json') continue;
    const p = path.join(pasta, e.name);
    if (e.isDirectory()) listarFicheiros(p, base, saida);
    else saida.push(path.relative(base, p));
  }
  return saida;
}

/** Texto que descreve o papel do agente, para qualquer motor. */
export function instrucaoDoAgente(agente, tarefa, entregas) {
  return [
    `Papel: ${agente.nome}. ${agente.papel}`,
    `Jeito de trabalhar: ${agente.jeito}`,
    `Missão: ${agente.missao}`,
    `Critério de pronto: ${agente.criterio}`,
    `Lês estas passagens (ficheiros na pasta do projeto): ${agente.recebe.join(', ')}.`,
    `Escreves estas entregas (caminhos relativos à pasta do projeto): ${entregas.join(', ')}.`,
    `Tarefa: ${tarefa}`,
    'Escreve apenas dentro da pasta do projeto. Não inventes resultados de testes: se não correste um teste, diz que não o correste.',
  ].join('\n');
}

/**
 * Corre um agente. Devolve sempre um objeto com `ok`, `motor` e `estado`; nunca lança por
 * falha do motor (uma etapa falhada é um dado, não uma exceção).
 * @returns {Promise<{ok:boolean, motor:string, estado:string, ficheiros:string[], erro?:string}>}
 */
export async function executarAgente({ motor, agente, tarefa, entregas, pasta, timeoutMs = TEMPO_MAX_MS, env = process.env, fetchImpl = globalThis.fetch }) {
  fs.mkdirSync(pasta, { recursive: true });
  const prompt = instrucaoDoAgente(agente, tarefa, entregas);
  if (motor.motor === 'sem-motor') {
    return { ok: false, motor: 'sem-motor', estado: 'sem-motor', ficheiros: [], erro: motor.motivo };
  }
  if (motor.motor === 'claude-cli') return correrClaudeCli({ bin: motor.bin, prompt, pasta, timeoutMs, agente });
  if (motor.motor === 'api') return correrApi({ prompt, pasta, timeoutMs, env, fetchImpl, modelo: motor.modelo, agente });
  return { ok: false, motor: motor.motor, estado: 'erro', ficheiros: [], erro: `motor desconhecido: ${motor.motor}` };
}

function correrClaudeCli({ bin, prompt, pasta, timeoutMs, agente }) {
  return new Promise((resolve) => {
    const antes = new Set(listarFicheiros(pasta));
    const args = ['-p', prompt, '--output-format', 'text', '--no-session-persistence', '--allowedTools', 'Read,Write,Edit'];
    let saida = '';
    let fim = false;
    const acabar = (r) => { if (!fim) { fim = true; resolve(r); } };
    let filho;
    try {
      filho = spawn(bin, args, { cwd: pasta, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return acabar({ ok: false, motor: 'claude-cli', estado: 'erro', ficheiros: [], erro: `não arrancou: ${e.message}` });
    }
    const relogio = setTimeout(() => { filho.kill('SIGTERM'); acabar({ ok: false, motor: 'claude-cli', estado: 'tempo-esgotado', ficheiros: [], erro: `o agente ${agente.nome} não terminou em ${Math.round(timeoutMs / 1000)} s` }); }, timeoutMs);
    filho.stdout.on('data', (d) => { if (saida.length < MAX_SAIDA) saida += d; });
    filho.stderr.on('data', (d) => { if (saida.length < MAX_SAIDA) saida += d; });
    filho.on('error', (e) => { clearTimeout(relogio); acabar({ ok: false, motor: 'claude-cli', estado: 'erro', ficheiros: [], erro: e.message }); });
    filho.on('close', (codigo) => {
      clearTimeout(relogio);
      const novos = listarFicheiros(pasta).filter((f) => !antes.has(f));
      if (codigo !== 0) return acabar({ ok: false, motor: 'claude-cli', estado: 'erro', ficheiros: novos, erro: `saiu com código ${codigo}: ${saida.slice(-400)}` });
      acabar({ ok: novos.length > 0, motor: 'claude-cli', estado: novos.length ? 'concluido' : 'sem-ficheiros', ficheiros: novos, erro: novos.length ? undefined : 'o agente terminou sem escrever nenhum ficheiro' });
    });
  });
}

const FORMATO = [
  'Responde só com os ficheiros pedidos, neste formato exato, sem texto fora dos blocos:',
  '=== ficheiro: CAMINHO ===',
  'conteúdo do ficheiro',
  '=== fim ===',
].join('\n');

async function correrApi({ prompt, pasta, timeoutMs, env, fetchImpl, modelo, agente }) {
  const url = env.ORBITA_CORE_API_URL;
  const chave = env.ORBITA_CORE_API_KEY;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
      body: JSON.stringify({ model: modelo, temperature: 0.2, messages: [{ role: 'system', content: FORMATO }, { role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, motor: 'api', estado: 'erro', ficheiros: [], erro: `o fornecedor respondeu HTTP ${res.status}` };
    const j = await res.json();
    const texto = j?.choices?.[0]?.message?.content || '';
    const blocos = [...texto.matchAll(/=== ficheiro: (.+?) ===\n([\s\S]*?)\n=== fim ===/g)];
    if (!blocos.length) {
      return { ok: false, motor: 'api', estado: 'sem-ficheiros', ficheiros: [], erro: `${agente.nome} respondeu sem blocos de ficheiro` };
    }
    // valida todos os caminhos antes de escrever o primeiro: nada fica a meio se um for inválido
    let destinos;
    try {
      destinos = blocos.map(([, caminho, conteudo]) => ({ alvo: dentroDaPasta(pasta, caminho.trim()), conteudo }));
    } catch (e) {
      return { ok: false, motor: 'api', estado: 'erro', ficheiros: [], erro: e.message };
    }
    const escritos = [];
    for (const { alvo, conteudo } of destinos) {
      fs.mkdirSync(path.dirname(alvo), { recursive: true });
      fs.writeFileSync(alvo, conteudo, 'utf8');
      escritos.push(path.relative(path.resolve(pasta), alvo));
    }
    return { ok: true, motor: 'api', estado: 'concluido', ficheiros: escritos };
  } catch (e) {
    // sem a chave na mensagem: só o nome do erro e a causa curta
    return { ok: false, motor: 'api', estado: e.name === 'TimeoutError' ? 'tempo-esgotado' : 'erro', ficheiros: [], erro: e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de ligação ao fornecedor' };
  }
}
