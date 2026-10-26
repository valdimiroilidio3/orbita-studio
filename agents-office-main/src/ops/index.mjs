// Órbita — a camada de operação, num sítio só.
//
// Abre a base de dados, liga a fila aos trabalhos que o escritório sabe fazer, e devolve tudo o que
// o servidor precisa. Sem estado escondido: `db`, `queue` e as funções são o que se vê.
import path from 'node:path';
import { openDb, audit, getSetting, setSetting, now } from './db.mjs';
import { createQueue } from './queue.mjs';
import * as leadsModule from './leads.mjs';
import * as messagesModule from './messages.mjs';
import * as metricsModule from './metrics.mjs';
import * as outboxModule from './outbox.mjs';
import * as eventsModule from './events.mjs';
import * as todayModule from './today.mjs';
import * as researchModule from './research.mjs';
import * as personalizeModule from './personalize.mjs';
import * as autonomyModule from './autonomy.mjs';
import * as evalsModule from './evals.mjs';
import * as moneyModule from './money.mjs';
import * as tenantsModule from './tenants.mjs';
import * as projectsModule from './projects.mjs';
import * as tasksModule from './tasks.mjs';
import * as searchModule from './search.mjs';
import * as liveModule from './live.mjs';

export function openOps({ dataDir, dbFile = null, concurrency = 2, pollMs = 1500, autostart = true } = {}) {
  const file = dbFile || process.env.ORBITA_DB || path.join(dataDir, 'orbita.db');
  const db = openDb(file);
  const queue = createQueue(db, { concurrency, pollMs });
  const leads = leadsModule, messages = messagesModule, metrics = metricsModule;
  const outbox = outboxModule, events = eventsModule, today = todayModule;
  const research = researchModule, personalize = personalizeModule;
  const autonomy = autonomyModule, evals = evalsModule, money = moneyModule, tenants = tenantsModule, projects = projectsModule;
  const tasks = tasksModule;
  const search = searchModule;
  const live = liveModule;

  // ---- tarefas dos departamentos: tratadores determinísticos, um por tipo ----
  // Nada aqui inventa: cada um lê a base, faz trabalho verificável e devolve resultado + evidência.
  // O que precisa de um modelo de IA não tem tratador e falha com o motivo escrito (`tasks.run`).
  // O identificador vem do payload ou da própria tarefa (entity_id) — uma tarefa criada com
  // `entityId` tem de saber sobre o que é sem repetir dados.
  const alvo = (p, t) => ({ leadId: p.leadId || (t.entity === 'lead' ? t.entityId : ''), projectId: p.projectId || (t.entity === 'projeto' ? t.entityId : '') });
  const taskHandlers = {
    'lead.qualificar': (p, t) => {
      const { leadId } = alvo(p, t);
      const lead = leads.getLead(db, leadId);
      if (!lead) throw new Error('lead não encontrado');
      const { score, reasons } = leads.scoreLead(lead);
      db.prepare('UPDATE leads SET score = ?, score_reasons = ?, updated_at = ? WHERE id = ?').run(score, reasons, now(), lead.id);
      audit(db, { actor: 'LUNA', action: 'lead.pontuado', entity: 'lead', entityId: lead.id, detail: { score } });
      // Qualificar é um passo do funil: um lead novo com nota suficiente passa a «qualificado».
      // Não é contacto nem envio — nada sai para fora; e o passo fica escrito em `events`.
      let estado = lead.status;
      const LIMIAR = 60;
      if (lead.status === 'novo' && score >= LIMIAR) {
        estado = leads.setStatus(db, lead.id, 'qualificado', 'LUNA', `qualificado pela pontuação (${score} ≥ ${LIMIAR})`).status;
      }
      return {
        result: { leadId: lead.id, nome: lead.name, score, estado, limiar: LIMIAR },
        evidence: reasons.split(' · ').filter(Boolean).map(r => ({ label: r })),
      };
    },
    'lead.pesquisar': async (p, t) => {
      const { leadId } = alvo(p, t);
      const lead = leads.getLead(db, leadId);
      if (!lead) throw new Error('lead não encontrado');
      const r = await research.researchSite(db, lead, { actor: 'LUNA' });
      if (r.status === 'falhou') throw new Error(r.reason || 'a leitura do site falhou');
      return { result: { status: r.status, factos: Object.keys(r.data || {}).length }, evidence: (r.evidence || []).map(e => ({ label: e.label, url: e.url })) };
    },
    'proposta.preparar': (p, t) => {
      const { leadId, projectId } = alvo(p, t);
      const lead = leads.getLead(db, leadId);
      if (!lead) throw new Error('lead não encontrado');
      const offer = personalize.offerOf(db);
      const d = research.dossier(db, lead);
      const projeto = projectId ? projects.get(db, projectId) : null;
      const linhas = [
        `Proposta para ${lead.name}`,
        '',
        `O que fazemos: ${offer.nome}.`,
        `Valor: ${offer.preco_eur} € · prazo: ${offer.prazo_dias} dias.`,
        `Garantia: ${offer.garantia}.`,
        projeto ? `Inclui: ${projeto.pages.length} página(s) — ${projeto.pages.join(', ')}.` : '',
        `Critérios de aceitação: ${projeto ? projeto.acceptance.join('; ') : 'a definir com o cliente'}.`,
        d.evidence?.length ? `Base: ${d.evidence.slice(0, 3).map(e => e.label).join('; ')}.` : '',
      ].filter(Boolean);
      return { result: { texto: linhas.join('\n'), preco_eur: offer.preco_eur, prazo_dias: offer.prazo_dias }, evidence: [{ label: `oferta: ${offer.nome}` }, ...(d.evidence || []).slice(0, 2).map(e => ({ label: e.label }))] };
    },
    'projeto.briefing': (p, t) => {
      const { projectId } = alvo(p, t);
      const projeto = projects.get(db, projectId);
      if (!projeto) throw new Error('projeto não encontrado');
      return {
        result: {
          briefing: projeto.brief, paginas: projeto.pages, objectivos: projeto.goals, criterios: projeto.acceptance,
          design: { cor: '#B9FF00', fundo: '#0A0A0B', tipografia: 'editorial, sem serifa decorativa', grelha: '12 colunas, 24 px' },
        },
        evidence: [{ label: `${projeto.pages.length} página(s) planeadas` }, { label: `${projeto.acceptance.length} critério(s) de aceitação` }],
      };
    },
    'projeto.gerar': (p, t) => {
      const { projectId } = alvo(p, t);
      const out = projects.generate(db, projectId, 'ZEKE');
      return { result: { files: out.files, bytes: out.bytes, jobId: out.jobId }, evidence: out.files.map(f => ({ label: f })) };
    },
    'projeto.qa': (p, t) => {
      const { projectId } = alvo(p, t);
      const out = projects.qa(db, projectId, 'ZEKE');
      const r = out.run;
      return {
        result: { runId: r.id, total: r.total, critico: r.critical, importante: r.important, menor: r.minor, passou: r.passed },
        evidence: (r.items || []).slice(0, 8).map(i => ({ label: `[${i.level}] ${i.code}: ${i.message}` })),
      };
    },
    'projeto.entregar': (p, t) => {
      const { projectId } = alvo(p, t);
      const target = p.target || 'preview';
      if (target !== 'preview') throw new Error(`entrega «${target}» é externa: usa POST /api/ops/projetos/:id/entregar, que exige credenciais e fica registada como pedido`);
      const out = projects.deliver(db, projectId, { target: 'preview', actor: 'ZEKE' });
      return { result: { url: out.url, estado: out.project.status }, evidence: [{ label: `preview em ${out.url}` }] };
    },
    'command.revisao': () => {
      const espera = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state = 'awaiting_approval'").get().n;
      const falhou = db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE state = 'failed'").get().n;
      const semQa = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status IN ('gerado','qa_falhou')").get().n;
      const parados = db.prepare("SELECT COUNT(*) AS n FROM leads WHERE status IN ('qualificado','contactado','em_negociacao','proposta') AND updated_at < ?").get(new Date(Date.now() - 14 * 86400000).toISOString()).n;
      return {
        result: { esperaAprovacao: espera, tarefasFalhadas: falhou, projetosSemQa: semQa, oportunidadesParadas: parados },
        evidence: [
          { label: `${espera} tarefa(s) à espera de aprovação` },
          { label: `${falhou} falhada(s) a repetir` },
          { label: `${semQa} projeto(s) sem QA aprovado` },
          { label: `${parados} oportunidade(s) sem atividade há 14 dias` },
        ],
      };
    },
  };
  const runTask = async (id, { actor = 'sistema' } = {}) => tasks.run(db, id, { handlers: taskHandlers, actor });

  // trabalho que a fila sabe fazer — nomes explícitos, sem `eval` nem magia
  queue.register('tarefa.correr', async (p) => {
    const out = await runTask(p.taskId, { actor: p.actor || 'fila' });
    if (!out.ok) throw new Error(out.error); // a fila trata das tentativas; a tarefa já guardou o motivo
    return out.task.result;
  });
  queue.register('leads.importar', async (p) => leads.importLeads(db, p.leads || [], p.actor || 'fila', p.source || 'import'));
  queue.register('seguimento.verificar', async () => {
    const due = leads.dueFollowUps(db);
    for (const l of due) audit(db, { actor: 'fila', action: 'seguimento.devido', entity: 'lead', entityId: l.id, detail: { nome: l.name, quando: l.next_follow_up_at } });
    return { devidos: due.length };
  });
  // Pesquisar o site de um lead é trabalho de rede: vai para a fila, com tentativas, para não
  // prender um pedido HTTP do dono enquanto se lê meia dúzia de páginas.
  queue.register('lead.pesquisar', async (p) => {
    const lead = leads.getLead(db, p.leadId);
    if (!lead) throw new Error('lead não encontrado');
    const r = await research.researchSite(db, lead, { actor: 'fila' });
    if (r.status === 'falhou') throw new Error(r.reason); // o backoff trata do resto
    return { status: r.status, evidencia: r.evidence.length };
  });
  // Correr as avaliações é trabalho de fila: não prende o ecrã e o resultado fica guardado.
  queue.register('evals.correr', async (p) => evalsModule.runAll(db, { ask: p.ask ? globalThis.__orbitaAsk : null }));
  queue.register('mensagem.enviar', async (p, job) => {
    if (!globalThis.__orbitaDeliver) throw new Error('não há serviço de envio configurado');
    const out = await messages.sendMessage(db, p.messageId, { deliver: globalThis.__orbitaDeliver, actor: 'fila' });
    if (!out.delivered && !out.manual) throw new Error(out.reason || 'não saiu');
    return out;
  });

  if (autostart) queue.start();

  // ---- o outbox drena sozinho ----
  // O que ficou escrito para sair tenta sair aqui, a cada 3 s, com o mesmo `deliver` do servidor.
  // Se o processo morrer, o aluguer expira e o item volta — ninguém fica com trabalho preso.
  let outboxTimer = null;
  const drainOutbox = async () => {
    if (!globalThis.__orbitaDeliver) return [];
    try { return await outboxModule.drain(db, { deliver: globalThis.__orbitaDeliver, limit: 5 }); }
    catch (e) { console.warn('outbox:', e.message); return []; }
  };
  if (autostart) {
    outboxTimer = setInterval(() => { drainOutbox(); }, 3000);
    if (outboxTimer.unref) outboxTimer.unref();
  }
  setSetting(db, 'ops.iniciado_em', getSetting(db, 'ops.iniciado_em', now()));

  // Um processo que morre a meio deixa tarefas em `running`. Ao arrancar, as que passaram do prazo
  // voltam à fila ou falham com o motivo — nunca ficam penduradas a fingir que estão a correr.
  const recuperadas = tasks.recover(db);

  return {
    db, queue, leads, messages, metrics, outbox, events, today, research, personalize, autonomy, evals, money, tenants, projects, tasks, search, live,
    taskHandlers, runTask, recuperadas,
    drainOutbox,
    audit: (event) => audit(db, event),
    close: () => {
      queue.stop();
      if (outboxTimer) clearInterval(outboxTimer);
      try { db.close(); } catch { /* já fechada */ }
    },
  };
}

export { openDb, audit, getSetting, setSetting } from './db.mjs';
// O registo de clientes é do processo, não de uma base: vive aqui e não dentro de cada `openOps`.
export * as tenants from './tenants.mjs';
