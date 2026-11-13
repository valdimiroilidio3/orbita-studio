// Fluxo de equipa: um projeto passa por etapas. Cada etapa é um agente com entregas definidas.
// As passagens entre agentes são ficheiros na pasta do projeto (handoffs/), com metadados
// (de, para, fase, prioridade), contexto, pedido com critérios e a evidência exigida.
// Forma inspirada em strategy/coordination/handoff-templates.md do agency-agents (MIT).

import fs from 'node:fs';
import path from 'node:path';
import { AGENTES, agente } from './elenco.mjs';
import { executarAgente, escolherMotor, listarFicheiros } from './motores.mjs';

/** Ordem do fluxo de Programação, Produto e Design (primeira entrega). */
export const FLUXO = [
  { fase: 'produto', agente: 'gestor-produto', entregas: ['PROJETO.md'], recebe: 'o pedido do dono' },
  { fase: 'produto', agente: 'priorizador-sprint', entregas: ['BACKLOG.md'], recebe: 'PROJETO.md' },
  { fase: 'design', agente: 'guardiao-marca', entregas: ['MARCA.md'], recebe: 'PROJETO.md' },
  { fase: 'design', agente: 'arquiteto-ux', entregas: ['UX.md'], recebe: 'PROJETO.md e BACKLOG.md' },
  { fase: 'design', agente: 'designer-ui', entregas: ['UI.md'], recebe: 'UX.md' },
  { fase: 'programacao', agente: 'arquiteto-backend', entregas: ['API.md'], recebe: 'PROJETO.md e UX.md' },
  { fase: 'programacao', agente: 'dev-frontend', entregas: ['site/index.html', 'site/styles.css'], recebe: 'UI.md, MARCA.md e API.md' },
  { fase: 'programacao', agente: 'dev-backend', entregas: ['server/server.mjs', 'server/server.test.mjs'], recebe: 'API.md' },
  { fase: 'programacao', agente: 'dev-senior', entregas: ['README.md'], recebe: 'site/ e server/' },
  { fase: 'programacao', agente: 'revisor-codigo', entregas: ['REVISAO.md'], recebe: 'PROJETO.md, site/ e server/' },
];

/** Cria a estrutura de um projeto novo. Não sobrescreve um projeto existente. */
export function criarProjeto(raiz, { nome, pedido }) {
  const id = nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'projeto';
  const pasta = path.join(raiz, id);
  if (fs.existsSync(path.join(pasta, 'project.json'))) throw new Error(`o projeto ${id} já existe`);
  fs.mkdirSync(path.join(pasta, 'handoffs'), { recursive: true });
  fs.writeFileSync(path.join(pasta, 'PROJETO-BRIEF.md'), `# ${nome}\n\n${pedido.trim()}\n`, 'utf8');
  const estado = { id, nome, criadoEm: new Date().toISOString(), etapas: FLUXO.map((e) => ({ agente: e.agente, fase: e.fase, estado: 'por-fazer', ficheiros: [] })) };
  fs.writeFileSync(path.join(pasta, 'project.json'), JSON.stringify(estado, null, 2) + '\n', 'utf8');
  return { id, pasta };
}

/** Escreve a passagem de trabalho de um agente para outro. */
export function escreverPassagem(pasta, { de, para, fase, prioridade = 'normal', contexto, pedido, criterios, evidencia }) {
  const nomeDe = agente(de).nome;
  const nomePara = agente(para).nome;
  const nome = `${String(Date.now())}-${de}-para-${para}.md`;
  const texto = [
    `# Passagem: ${nomeDe} → ${nomePara}`,
    '',
    `- de: ${de}`,
    `- para: ${para}`,
    `- fase: ${fase}`,
    `- prioridade: ${prioridade}`,
    '',
    '## Contexto', contexto,
    '',
    '## Pedido', pedido,
    '',
    '## Critérios de aceitação', ...criterios.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## Evidência exigida', evidencia,
    '',
  ].join('\n');
  const dir = path.join(pasta, 'handoffs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, nome), texto, 'utf8');
  return nome;
}

/**
 * Corre o fluxo a partir da primeira etapa que não está concluída.
 * Para na primeira etapa que falha ou que não tem motor: não salta à frente.
 * @returns {Promise<{estado:'concluido'|'parado', etapas:object[]}>}
 */
export async function correrFluxo(pasta, { motor, env, fetchImpl } = {}) {
  const ficheiroEstado = path.join(pasta, 'project.json');
  const estado = JSON.parse(fs.readFileSync(ficheiroEstado, 'utf8'));
  const motorEscolhido = motor || escolherMotor({ env });
  for (let i = 0; i < FLUXO.length; i++) {
    const passo = FLUXO[i];
    const etapa = estado.etapas[i];
    if (etapa.estado === 'concluido') continue;
    const ag = agente(passo.agente);
    const anteriores = FLUXO.slice(0, i).map((p) => p.agente);
    if (i > 0) {
      escreverPassagem(pasta, {
        de: FLUXO[i - 1].agente, para: passo.agente, fase: passo.fase,
        contexto: `Projeto ${estado.nome}. Etapas anteriores: ${anteriores.join(', ') || 'nenhuma'}.`,
        pedido: `Produz ${passo.entregas.join(', ')} a partir de ${passo.recebe}.`,
        criterios: [ag.criterio],
        evidencia: 'Os ficheiros indicados existem na pasta do projeto e cumprem o critério acima.',
      });
    }
    etapa.estado = 'a-correr';
    gravar(ficheiroEstado, estado);
    const r = await executarAgente({
      motor: motorEscolhido, agente: ag, tarefa: `${estado.nome}: ${passo.recebe} → ${passo.entregas.join(', ')}`,
      entregas: passo.entregas, pasta, env, fetchImpl,
    });
    // uma etapa só é concluída se as entregas existirem em disco
    const emDisco = passo.entregas.every((f) => fs.existsSync(path.join(pasta, f)));
    etapa.estado = r.ok && emDisco ? 'concluido' : (r.estado === 'sem-motor' ? 'sem-motor' : 'falhou');
    etapa.ficheiros = listarFicheiros(pasta).filter((f) => !f.startsWith('handoffs') && f !== 'project.json');
    etapa.erro = etapa.estado === 'concluido' ? undefined : (r.erro || 'entregas em falta');
    gravar(ficheiroEstado, estado);
    if (etapa.estado !== 'concluido') return { estado: 'parado', etapas: estado.etapas };
  }
  return { estado: 'concluido', etapas: estado.etapas };
}

function gravar(ficheiro, obj) {
  fs.writeFileSync(ficheiro, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export { AGENTES };
