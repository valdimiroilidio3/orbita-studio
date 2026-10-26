// Órbita — a camada de operação, testada a sério.
//
// Tudo corre em SQLite em memória: nenhum ficheiro do dono é tocado, nenhum serviço externo é
// chamado. O que se prova aqui é o que separa uma demonstração de um sistema: pontuação com
// razões, sem duplicados, funil que não salta passos, opt-out que manda, aquecimento que trava,
// fila que tenta outra vez, e um rasto de auditoria para tudo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, audit } from './src/ops/db.mjs';
import * as leads from './src/ops/leads.mjs';
import * as messages from './src/ops/messages.mjs';
import { createQueue } from './src/ops/queue.mjs';
import * as metrics from './src/ops/metrics.mjs';

const fresh = () => openDb(':memory:');
const withLead = (db, extra = {}) => leads.upsertLead(db, {
  name: 'Clínica Dentária Alvalade', city: 'Lisboa', phone: '+351 210 000 001',
  email: 'geral@alvalade.pt', category: 'dentista', rating: 3.9, reviews: 12, ...extra,
}).lead;

test('pontuação: cada ponto tem uma razão escrita, e sem site vale mais', () => {
  const semSite = leads.scoreLead({ name: 'A', phone: '+351 210 000 001', rating: 3.9, reviews: 10, category: 'dentista' });
  const comSite = leads.scoreLead({ name: 'B', phone: '+351 210 000 001', rating: 3.9, reviews: 10, category: 'dentista', website: 'https://b.pt' });
  const rede = leads.scoreLead({ name: 'C', website: 'https://www.facebook.com/c' });
  assert.ok(semSite.score > comSite.score, 'sem site tem de pontuar mais');
  assert.match(semSite.reasons, /sem site \(\+25\)/);
  assert.match(comSite.reasons, /tem site próprio/);
  assert.match(rede.reasons, /rede social/);
  assert.ok(semSite.score <= 100 && semSite.score >= 0);
});

test('deduplicação: o mesmo negócio não entra duas vezes (domínio, telefone, nome+cidade)', () => {
  const db = fresh();
  const a = leads.upsertLead(db, { name: 'Salão X', website: 'https://salaox.pt', city: 'Lisboa' });
  const b = leads.upsertLead(db, { name: 'Salão X (novo nome)', website: 'https://www.salaox.pt/menu', city: 'Lisboa' });
  assert.equal(a.created, true);
  assert.equal(b.created, false);
  assert.equal(b.lead.id, a.lead.id);
  assert.equal(b.lead.name, 'Salão X (novo nome)', 'os dados factuais ficam frescos');
  const c = leads.upsertLead(db, { name: 'Barbearia Y', phone: '+351 912 345 678' });
  const d = leads.upsertLead(db, { name: 'Barbearia Y', phone: '00351 912 345 678' });
  assert.equal(d.created, false, 'o mesmo telefone escrito de outra forma é o mesmo lead');
  const e = leads.upsertLead(db, { name: 'Sem contactos', city: 'Porto' });
  const f = leads.upsertLead(db, { name: 'Sem Contactos', city: 'Porto' });
  assert.equal(f.created, false, 'nome+cidade iguais também deduplicam');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 3);
});

test('o que o dono decidiu não é apagado quando os dados vêm frescos', () => {
  const db = fresh();
  const { lead } = leads.upsertLead(db, { name: 'Óptica Z', website: 'https://z.pt' });
  leads.setStatus(db, lead.id, 'contactado');
  leads.scheduleFollowUp(db, lead.id, Date.now() + 86400000);
  const again = leads.upsertLead(db, { name: 'Óptica Z', website: 'https://z.pt', rating: 4.9, reviews: 300 });
  assert.equal(again.lead.status, 'contactado');
  assert.ok(again.lead.next_follow_up_at, 'o seguimento agendado mantém-se');
  assert.equal(again.lead.rating, 4.9, 'a avaliação foi atualizada');
});

test('funil: não se salta de «novo» para «cliente»', () => {
  const db = fresh();
  const lead = withLead(db);
  assert.throws(() => leads.setStatus(db, lead.id, 'cliente'), /segue o funil/);
  leads.setStatus(db, lead.id, 'contactado');
  assert.throws(() => leads.setStatus(db, lead.id, 'cliente'), /segue o funil/);
  leads.setStatus(db, lead.id, 'respondeu');
  leads.setStatus(db, lead.id, 'reuniao');
  const won = leads.setStatus(db, lead.id, 'cliente');
  assert.equal(won.status, 'cliente');
  assert.ok(won.contacted_at && won.responded_at, 'as datas do percurso ficam registadas');
});

test('mensagem: rascunho não sai sem aprovação; aprovada sai e marca o lead', async () => {
  const db = fresh();
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'email', subject: 'Olá', body: 'Proposta de site' });
  assert.equal(m.status, 'rascunho');
  await assert.rejects(() => messages.sendMessage(db, m.id, { deliver: async () => ({ id: 'x' }) }), /só se envia uma mensagem aprovada/);
  const approved = messages.approveMessage(db, m.id);
  assert.equal(approved.status, 'aprovada');
  let called = 0;
  const out = await messages.sendMessage(db, m.id, { deliver: async (msg, l) => { called++; assert.equal(l.id, lead.id); return { id: 'rs_1' }; } });
  assert.equal(out.delivered, true);
  assert.equal(called, 1);
  assert.equal(messages.getMessage(db, m.id).status, 'enviada');
  assert.equal(leads.getLead(db, lead.id).status, 'contactado');
});

test('opt-out manda: bloqueia a aprovação e o envio, e rebaixa o lead', async () => {
  const db = fresh();
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'email', subject: 'Olá', body: 'Texto' });
  leads.optOut(db, { email: 'geral@alvalade.pt' }, 'pediu para parar');
  const blocked = messages.approveMessage(db, m.id);
  assert.equal(blocked.status, 'bloqueada');
  assert.match(blocked.reason, /não ser contactado/);
  const leadAfter = leads.getLead(db, lead.id);
  assert.equal(leadAfter.consent, 'retirado');
  assert.equal(leadAfter.status, 'perdido');
  assert.throws(() => leads.optOut(db, {}, 'sem endereço'), /email ou o telefone/);
});

test('aquecimento: o limite do dia trava o envio e diz porque', async () => {
  const db = fresh();
  messages.setWarmup(db, 'email', { start: 1, step: 0, max: 1 });
  const a = withLead(db, { name: 'Lead A', website: 'https://a.pt', email: 'a@a.pt' });
  const b = leads.upsertLead(db, { name: 'Lead B', website: 'https://b.pt', email: 'b@b.pt' }).lead;
  for (const lead of [a, b]) {
    const m = messages.draftMessage(db, { leadId: lead.id, channel: 'email', body: 'Olá' });
    messages.approveMessage(db, m.id);
    if (lead.id === a.id) {
      const ok = await messages.sendMessage(db, m.id, { deliver: async () => ({ id: 'rs' }) });
      assert.equal(ok.delivered, true);
    } else {
      const capped = await messages.sendMessage(db, m.id, { deliver: async () => ({ id: 'rs2' }) });
      assert.equal(capped.delivered, false);
      assert.match(capped.reason, /aquecimento do canal: 1 por dia/);
      assert.equal(messages.getMessage(db, m.id).status, 'aprovada', 'não sai e não se marca como enviada');
    }
  }
});

test('WhatsApp: gera link e não finge que enviou', async () => {
  const db = fresh();
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'whatsapp', body: 'Olá!' });
  messages.approveMessage(db, m.id);
  const out = await messages.sendMessage(db, m.id, {
    deliver: async () => ({ doesNotSend: true, url: 'https://wa.me/351210000001?text=Ol%C3%A1', note: 'link' }),
  });
  assert.equal(out.delivered, false);
  assert.equal(out.manual, true);
  assert.equal(messages.getMessage(db, m.id).status, 'aprovada');
  assert.equal(leads.getLead(db, lead.id).status, 'novo', 'o lead só é contactado quando o dono confirma');
  const confirmed = messages.confirmSent(db, m.id);
  assert.equal(confirmed.status, 'enviada');
  assert.equal(leads.getLead(db, lead.id).status, 'contactado');
});

test('fila: falha, tenta outra vez com espera, e desiste no limite', async () => {
  const db = fresh();
  let calls = 0;
  const q = createQueue(db, { concurrency: 1, pollMs: 50 });
  q.register('rebentar', async () => { calls++; throw new Error('serviço em baixo'); });
  const job = q.enqueue('rebentar', {}, { maxAttempts: 3 });
  await q.tick();
  let j = q.get(job.id);
  assert.equal(j.status, 'fila');
  assert.equal(j.attempts, 1);
  assert.ok(new Date(j.run_at) > new Date(), 'a segunda tentativa espera (backoff)');
  // adelanta o relógio da fila e corre até desistir
  for (let i = 0; i < 2; i++) {
    db.prepare("UPDATE jobs SET run_at = ? WHERE id = ?").run(new Date(0).toISOString(), job.id);
    await q.tick();
  }
  j = q.get(job.id);
  assert.equal(j.status, 'falhou');
  assert.equal(j.attempts, 3);
  assert.equal(calls, 3);
  const events = db.prepare("SELECT action FROM events WHERE entity='job' ORDER BY id").all().map(r => r.action);
  assert.ok(events.includes('fila.retentativa') && events.includes('fila.desistiu'));
});

test('fila: um trabalho que corre fica feito e o resultado é auditável', async () => {
  const db = fresh();
  const q = createQueue(db, { concurrency: 2, pollMs: 50 });
  q.register('importar', async (p) => { leads.importLeads(db, p.leads, 'fila'); });
  const job = q.enqueue('importar', { leads: [{ name: 'Empresa 1', website: 'https://um.pt' }, { name: 'Empresa 2', phone: '+351911111111' }] });
  await q.tick();
  assert.equal(q.get(job.id).status, 'feito');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 2);
  assert.equal(q.stats().feito, 1);
});

test('auditoria: cada ação deixa nome, ação e hora', () => {
  const db = fresh();
  const lead = withLead(db);
  leads.setStatus(db, lead.id, 'contactado', 'dono');
  const rows = db.prepare('SELECT actor, action, entity_id FROM events ORDER BY id').all();
  assert.ok(rows.some(r => r.action === 'lead.criado'));
  assert.ok(rows.some(r => r.action === 'lead.estado' && r.actor === 'dono' && r.entity_id === lead.id));
  audit(db, { actor: 'teste', action: 'x', entity: 'y', entityId: '1' });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM events WHERE action='x'").get().n, 1);
});

test('métricas: números que saem das tabelas, com null quando não há dados', async () => {
  const db = fresh();
  const empty = metrics.summary(db);
  assert.equal(empty.leads.total, 0);
  assert.equal(empty.conversao.taxaResposta, null);
  assert.match(empty.semDados.taxaResposta, /contactados/);

  const a = withLead(db);
  const b = leads.upsertLead(db, { name: 'Outra', website: 'https://o.pt', email: 'o@o.pt', phone: '+351 911 000 000' }).lead;
  leads.setStatus(db, a.id, 'contactado');
  leads.setStatus(db, a.id, 'respondeu');
  const m = messages.draftMessage(db, { leadId: b.id, channel: 'email', body: 'Olá' });
  messages.approveMessage(db, m.id);
  await messages.sendMessage(db, m.id, { deliver: async () => ({ id: 'rs_9' }) });
  const s = metrics.summary(db);
  assert.equal(s.leads.total, 2);
  assert.equal(s.funil.contactados, 2);
  assert.equal(s.mensagens.enviadas, 1);
  assert.ok(s.custos.apiCentimos >= 0);
  assert.match(metrics.summaryLine(db), /2 leads/);
});
