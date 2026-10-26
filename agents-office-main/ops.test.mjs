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
import * as outbox from './src/ops/outbox.mjs';
import * as events from './src/ops/events.mjs';
import * as today from './src/ops/today.mjs';

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
  const out = await messages.sendMessage(db, m.id, {
    deliver: async (item) => { called++; assert.equal(item.message_id, m.id); assert.equal(item.payload.body, 'Proposta de site'); return { id: 'rs_1' }; },
  });
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

/* ---------- 26 out 2026: eventos, outbox e idempotência (a base que não se vê) ---------- */

test('outbox: pedir o mesmo envio duas vezes é pedir uma', async () => {
  const db = fresh();
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'email', body: 'Olá' });
  messages.approveMessage(db, m.id);
  const a = outbox.enqueue(db, { messageId: m.id, channel: 'email', to: lead.email, payload: { to: lead.email, subject: '', body: 'Olá' } });
  const b = outbox.enqueue(db, { messageId: m.id, channel: 'email', to: lead.email, payload: { to: lead.email, subject: '', body: 'Olá' } });
  assert.equal(a.created, true);
  assert.equal(b.created, false, 'a segunda vez não cria outra linha');
  assert.equal(a.item.id, b.item.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM outbox').get().n, 1);
  let calls = 0;
  const deliver = async () => { calls++; return { id: 'rs_1' }; };
  const first = await outbox.drain(db, { deliver });
  const second = await outbox.drain(db, { deliver });
  assert.equal(first.length, 1);
  assert.equal(second.length, 0, 'já não há nada devido');
  assert.equal(calls, 1, 'o serviço foi chamado uma única vez');
  assert.equal(outbox.stats(db).feito, 1);
});

test('outbox: se o processo morre a meio, o aluguer expira — mas um email não se repete às cegas', async () => {
  const db = fresh();
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'email', body: 'Proposta' });
  messages.approveMessage(db, m.id);
  const { item } = outbox.enqueue(db, { messageId: m.id, channel: 'email', to: lead.email, payload: { body: 'Proposta' } });
  // simula o crash: alguém pegou no item e o processo morreu antes de o terminar
  const [held] = outbox.claim(db, { leaseMs: 5 });
  assert.equal(held.id, item.id);
  assert.equal(held.attempts, 1);
  assert.equal(outbox.get(db, item.id).status, 'em_voo');
  await new Promise(r => setTimeout(r, 20)); // o aluguer expira
  let calls = 0;
  const out = await outbox.drain(db, { deliver: async () => { calls++; return { id: 'rs_2' }; } });
  assert.equal(out.length, 1, 'o trabalho preso voltou a ser pegado');
  assert.equal(calls, 0, 'mas não se reenvia um email que pode já ter saído');
  assert.equal(outbox.get(db, item.id).status, 'revisao');
  const ev = db.prepare("SELECT action FROM events WHERE entity='mensagem'").all().map(r => r.action);
  assert.ok(ev.includes('outbox.revisao'));
});

test('interruptor de emergência: parado, nada sai e a recusa explica-se', async () => {
  const db = fresh();
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'email', body: 'Olá' });
  messages.approveMessage(db, m.id);
  outbox.setStop(db, true, 'dono', 'teste');
  let calls = 0;
  const blocked = await messages.sendMessage(db, m.id, { deliver: async () => { calls++; return { id: 'x' }; } });
  assert.equal(blocked.delivered, false);
  assert.match(blocked.reason, /interruptor de emergência/);
  assert.equal(calls, 0);
  const drained = await outbox.drain(db, { deliver: async () => { calls++; return { id: 'x' }; } });
  assert.deepEqual(drained, []);
  assert.equal(outbox.stats(db).parado, true);
  outbox.setStop(db, false, 'dono', 'teste');
  assert.equal(outbox.sendBlocked(db), false);
  assert.ok(db.prepare("SELECT 1 FROM events WHERE action IN ('envio.parado','envio.retomado')").all().length >= 2);
});

test('registo imutável: a cadeia fecha e denuncia a linha que foi mexida', () => {
  const db = fresh();
  const lead = withLead(db);
  leads.setStatus(db, lead.id, 'contactado');
  const okChain = events.verify(db);
  assert.equal(okChain.ok, true);
  assert.ok(okChain.count >= 2);
  // alguém reescreve uma linha à socapa
  const victim = db.prepare('SELECT id FROM events ORDER BY id LIMIT 1 OFFSET 1').get();
  db.prepare("UPDATE events SET detail = 'falsificado' WHERE id = ?").run(victim.id);
  const broken = events.verify(db);
  assert.equal(broken.ok, false);
  assert.equal(broken.brokenAt, victim.id);
});

test('«Hoje»: só mostra o que existe, com o porquê tirado dos dados', () => {
  const db = fresh();
  const lead = withLead(db);
  const a = messages.draftMessage(db, { leadId: lead.id, channel: 'email', subject: 'Uma ideia', body: 'Texto' });
  const b = messages.draftMessage(db, { leadId: lead.id, channel: 'whatsapp', body: 'Outro' });
  messages.approveMessage(db, b.id);
  leads.scheduleFollowUp(db, lead.id, new Date(Date.now() + 86400000).toISOString());
  const view = today.screen(db, { office: { tasks: [], routines: [] } });
  assert.equal(view.decidir.length, 2);
  const draftCard = view.decidir.find(c => c.id === a.id);
  assert.match(draftCard.why, /sem site|telefone|avaliação/, 'o porquê vem das razões guardadas');
  assert.ok(view.decidir.every(c => c.why), 'nenhum cartão sem justificação');
  assert.ok(view.aSeguir.some(x => x.kind === 'seguimento'));
  assert.equal(view.presenca.parado, false);
  assert.ok(view.aconteceu.length > 0, 'o que aconteceu tem eventos');
  const empty = today.screen(fresh(), { office: {} });
  assert.deepEqual(empty.decidir, []);
  assert.equal(empty.resumo.decidir, 0);
});

/* ---------- 26 out 2026 · passo 3: ver o negócio, escrever com factos, aprender ---------- */

import http from 'node:http';
import * as research from './src/ops/research.mjs';
import * as personalize from './src/ops/personalize.mjs';

// Uma página que parece um site real de um salão: velha, sem versão móvel, com Instagram.
const SALAO = `<!doctype html><html lang="pt-PT"><head><title>Salão Bela Vista — Lisboa</title>
<meta name="description" content="Cortes, coloração e tratamentos no coração de Alvalade, com marcação pelo telefone.">
</head><body><h1>Salão Bela Vista</h1><h2>Cortes</h2><h2>Coloração</h2>
<p>Horário: 9h às 19h, de terça a sábado. Telefone 21 000 11 22.</p>
<a href="https://instagram.com/salaobelavista">Instagram</a>
<footer>© 2019 Salão Bela Vista</footer></body></html>
<script>var x=1;</script>`;

function serveSite(pages) {
  const srv = http.createServer((req, res) => {
    const p = pages[req.url];
    if (!p) { res.writeHead(404); return res.end('não'); }
    res.writeHead(p.status || 200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(p.body);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('pesquisa: lê o site, tira frases verdadeiras e datou o abandono', async () => {
  const { srv, base } = await serveSite({
    '/robots.txt': { body: 'User-agent: *\nDisallow: /admin\n' },
    '/': { body: SALAO },
  });
  try {
    const db = fresh();
    const lead = leads.upsertLead(db, { name: 'Salão Bela Vista', website: `${base}/`, city: 'Lisboa', category: 'cabeleireiro', rating: 4.1, reviews: 10 }).lead;
    const r = await research.researchSite(db, lead, { allowPrivate: true });
    assert.equal(r.status, 'ok', r.reason);
    assert.equal(r.data.platform, '');
    assert.equal(r.data.hasViewport, false);
    assert.equal(r.data.copyrightYear, 2019);
    const keys = r.evidence.map(e => e.key);
    assert.ok(keys.includes('sem-mobile'), 'tinha de notar a falta de versão móvel');
    assert.ok(keys.includes('desactualizado'), 'tinha de notar o rodapé de 2019');
    assert.ok(keys.includes('sem-formulario'));
    const desc = r.evidence.find(e => e.key === 'descricao');
    assert.match(desc.quote, /Cortes, coloração/, 'a frase da casa vem inteira, para poder ser citada');
    assert.ok(!/Horário|Cortes/.test(JSON.stringify(r.data.text || '')), 'o texto inteiro não fica guardado');
  } finally { srv.close(); }
});

test('pesquisa: não lê o que o robots.txt proíbe, nem endereços privados', async () => {
  const { srv, base } = await serveSite({
    '/robots.txt': { body: 'User-agent: *\nDisallow: /\n' },
    '/': { body: SALAO },
  });
  try {
    const db = fresh();
    const lead = leads.upsertLead(db, { name: 'Barrada', website: `${base}/` }).lead;
    const r = await research.researchSite(db, lead, { allowPrivate: true });
    assert.equal(r.status, 'bloqueado');
    assert.match(r.reason, /robots/);
    // e o endereço de casa nunca é lido, mesmo que alguém meta um lead com ele
    for (const bad of ['http://127.0.0.1:8080', 'http://localhost/x', 'http://192.168.1.1', 'http://10.0.0.5/']) {
      assert.ok(research.unsafeTarget(bad), bad + ' devia ser recusado');
    }
    const l2 = leads.upsertLead(db, { name: 'Rede de casa', website: 'http://192.168.1.1/admin' }).lead;
    const r2 = await research.researchSite(db, l2); // sem permissão: o guarda tem de travar
    assert.equal(r2.status, 'bloqueado');
    assert.match(r2.reason, /privado/);
  } finally { srv.close(); }
});

test('pesquisa: quando falha, fica o motivo — nunca um dossiê inventado', async () => {
  const db = fresh();
  const semSite = leads.upsertLead(db, { name: 'Sem site Lda', phone: '+351 912 000 111' }).lead;
  const r1 = await research.researchSite(db, semSite);
  assert.equal(r1.status, 'sem_site');
  assert.match(r1.reason, /oportunidade/);

  const morto = leads.upsertLead(db, { name: 'Dominio Morto', website: 'https://nao-existe-mesmo-xyz.pt' }).lead;
  const r2 = await research.researchSite(db, morto, { fetchImpl: async () => { const e = new Error('getaddrinfo ENOTFOUND'); throw e; } });
  assert.equal(r2.status, 'falhou');
  assert.match(r2.reason, /domínio não existe/);

  const recusa = leads.upsertLead(db, { name: 'Recusa', website: 'https://recusa.pt' }).lead;
  const r3 = await research.researchSite(db, recusa, { allowPrivate: true, fetchImpl: async (u) => ({ ok: false, status: u.endsWith('/robots.txt') ? 404 : 403, text: async () => '' }) });
  assert.equal(r3.status, 'falhou');
  assert.match(r3.reason, /403/);
  const d = research.dossier(db, recusa);
  assert.equal(d.evidence.length, 0, 'sem leitura não há evidência nenhuma');
});

test('personalização: a mensagem cita o que se leu e prevê as objeções', async () => {
  const { srv, base } = await serveSite({ '/robots.txt': { body: 'User-agent: *\nDisallow: /admin\n' }, '/': { body: SALAO } });
  try {
    const db = fresh();
    const lead = leads.upsertLead(db, { name: 'Salão Bela Vista', website: `${base}/`, city: 'Lisboa', phone: '+351 210 001 122', category: 'cabeleireiro', rating: 4.1, reviews: 10 }).lead;
    await research.researchSite(db, lead, { allowPrivate: true });
    const d = personalize.templateDraft(db, lead, { channel: 'whatsapp' });
    assert.match(d.body, /Salão Bela Vista/);
    assert.match(d.body, /350 €/, 'a oferta entra com o preço do dono');
    assert.match(d.body, /7 dias/);
    const c = await personalize.compose(db, lead, { channel: 'whatsapp' });
    assert.equal(c.generatedBy, 'modelo');
    assert.ok(c.evidenceUsed.length >= 3);
    assert.ok(c.predictions.length >= 3, 'tem de prever objeções');
    assert.ok(c.predictions.every(p => p.if && p.answer), 'cada objeção traz a resposta');
    assert.match(c.why, /vi o site/);
    assert.ok(c.predictions.some(p => /Quanto custa/.test(p.if)));
  } finally { srv.close(); }
});

test('personalização: um motor que inventa citações é travado', async () => {
  const db = fresh();
  const lead = leads.upsertLead(db, { name: 'Óptica Central', city: 'Porto', phone: '+351 913 000 000' }).lead;
  const inventivo = async () => JSON.stringify({
    assunto: 'Uma ideia',
    corpo: 'Bom dia! Reparei que «abrem ao domingo e fazem entregas em 24 horas em todo o país» na vossa página. Posso ajudar?',
    facto_usado: 'abrem ao domingo',
  });
  const c = await personalize.compose(db, lead, { channel: 'whatsapp', ask: inventivo });
  assert.equal(c.generatedBy, 'modelo', 'a versão inventada tinha de ser recusada');
  assert.match(c.rejectedReason, /citava coisas que não li|não está no que li/);
  assert.ok(!/domingo/.test(c.body), 'a citação inventada não pode sobreviver');

  // e quando a citação é verdadeira, passa
  const honesto = async () => JSON.stringify({ assunto: 'Ideia', corpo: 'Bom dia! Vi que não tem site e que o telefone é público. Faz sentido falarmos?', facto_usado: 'não tem site' });
  const ok = await personalize.compose(db, lead, { channel: 'whatsapp', ask: honesto });
  assert.equal(ok.generatedBy, 'ia');
  assert.match(ok.why, /presa aos factos/);
});

test('guardDraft: corta promessas e citações inventadas frase a frase', () => {
  const facts = ['o rodapé ainda diz 2019', 'horizontal'];
  const out = personalize.guardDraft(
    'O rodapé diz 2019. «Somos a número um de Portugal em coloração». Garantimos resultados em 24 horas. Falamos?',
    facts, { channel: 'email' });
  assert.match(out.text, /rodapé diz 2019/);
  assert.match(out.text, /Falamos/);
  assert.ok(!/número um/.test(out.text), 'a citação inventada saiu');
  assert.ok(!/Garantimos/.test(out.text), 'a promessa saiu');
  assert.equal(out.dropped.length, 2);
});

test('ciclo fechado: os sinais viram pesos, e a nota dos outros leads mexe-se com razão', () => {
  const db = fresh();
  // três respostas em leads sem site; três ignorados em leads com site
  for (let i = 0; i < 3; i++) {
    const a = leads.upsertLead(db, { name: `Sem site ${i}`, phone: `+351 912 000 10${i}` }).lead;
    personalize.recordSignal(db, { leadId: a.id, kind: 'respondeu', note: 'respondeu no WhatsApp' });
    const b = leads.upsertLead(db, { name: `Com site ${i}`, website: `https://site${i}.pt`, phone: `+351 912 000 20${i}` }).lead;
    personalize.recordSignal(db, { leadId: b.id, kind: 'ignorou' });
  }
  const w = personalize.learnedWeights(db);
  assert.ok(w['sem-site'].peso > 0, 'sem site devia valorizar: ' + JSON.stringify(w['sem-site']));
  assert.ok(w['tem-site'].peso < 0, 'com site devia desvalorizar: ' + JSON.stringify(w['tem-site']));
  assert.equal(w['sem-site'].amostra, true);

  const novo = leads.upsertLead(db, { name: 'Outro sem site', phone: '+351 913 000 999' }).lead;
  const adj = personalize.scoreAdjustment(db, novo);
  assert.ok(adj.delta > 0);
  assert.match(adj.reasons, /\+.* aprendido: sem-site/);

  const antes = novo.score;
  personalize.recalibrate(db);
  const depois = leads.getLead(db, novo.id);
  assert.ok(depois.score > antes - 1, 'a nota aprendeu');
  assert.ok(depois.score_base > 0);
  assert.match(depois.score_reasons, /aprendido/);
  assert.equal(depois.score, Math.max(0, Math.min(100, depois.score_base + depois.score_learned)));

  const resumo = personalize.learningSummary(db);
  assert.equal(resumo.totalSinais, 6);
  assert.ok(resumo.aprendido.some(x => /sem-site/.test(x)));
});

test('ciclo fechado: amostra pequena não se escreve na pontuação', () => {
  const db = fresh();
  const a = leads.upsertLead(db, { name: 'Um só', phone: '+351 912 111 222' }).lead;
  personalize.recordSignal(db, { leadId: a.id, kind: 'respondeu' });
  const w = personalize.learnedWeights(db);
  assert.equal(w['sem-site'].amostra, false);
  assert.equal(w['sem-site'].peso, 0, 'um caso é coincidência, não é regra');
  assert.ok(personalize.learningSummary(db).aEsperar.some(x => /sem-site \(1\/3\)/.test(x)));
});

test('ciclo fechado: «respondeu» move o funil e «recusou» fecha o lead', () => {
  const db = fresh();
  const lead = withLead(db);
  leads.setStatus(db, lead.id, 'contactado');
  personalize.recordSignal(db, { leadId: lead.id, kind: 'respondeu' });
  assert.equal(leads.getLead(db, lead.id).status, 'respondeu');
  const b = leads.upsertLead(db, { name: 'Outro', website: 'https://outro.pt' }).lead;
  leads.setStatus(db, b.id, 'contactado');
  personalize.recordSignal(db, { leadId: b.id, kind: 'recusou', note: 'disse que não' });
  assert.equal(leads.getLead(db, b.id).status, 'perdido');
  assert.throws(() => personalize.recordSignal(db, { leadId: b.id, kind: 'talvez' }), /sinal desconhecido/);
});

test('a oferta é do dono e entra nas mensagens', async () => {
  const db = fresh();
  personalize.setOffer(db, { preco_eur: 500, prazo_dias: 10, nome: 'um site de 3 páginas' });
  const lead = leads.upsertLead(db, { name: 'Padaria Nova', city: 'Coimbra', phone: '+351 912 333 444' }).lead;
  const c = await personalize.compose(db, lead, {});
  assert.match(c.body, /500 €/);
  assert.match(c.body, /10 dias/);
  assert.match(c.body, /3 páginas/);
  assert.equal(personalize.offerOf(db).preco_eur, 500);
});

/* ---------- passo 4: autonomia graduada, ensaio e avaliações ---------- */

import * as autonomy from './src/ops/autonomy.mjs';
import * as evals from './src/ops/evals.mjs';

/** Escreve e decide N mensagens do mesmo tipo, para criar amostra a sério. */
function amostra(db, n, { canal = 'whatsapp', evidencia = 'sem-site', aprovar = true } = {}) {
  const feitas = [];
  for (let i = 0; i < n; i++) {
    const lead = leads.upsertLead(db, { name: `Negócio ${canal} ${evidencia} ${i}`, phone: `+351 9${String(10000000 + i).slice(0, 8)}` }).lead;
    const m = messages.draftMessage(db, {
      leadId: lead.id, channel: canal, body: `olá ${i}, vi que não tem site`, evidenceUsed: [{ key: evidencia }],
    });
    if (aprovar) messages.approveMessage(db, m.id); else messages.rejectMessage(db, m.id, 'não');
    feitas.push(m);
  }
  return feitas;
}

test('autonomia: começa a pedir sempre, e diz quanto falta em vez de fingir', () => {
  const db = fresh();
  amostra(db, 3);
  const scope = autonomy.scopeOf({ channel: 'whatsapp', evidenceUsed: [{ key: 'sem-site' }] });
  const rec = autonomy.recommendation(db, scope);
  assert.equal(rec.status, 'pedir_sempre');
  assert.equal(rec.elegivel, false);
  assert.equal(rec.propose, false);
  assert.match(rec.text, /faltam 47 casos/);
  assert.throws(() => autonomy.grant(db, scope), /não subo sem casos/);
  assert.equal(autonomy.isAutonomous(db, scope), false);
});

test('autonomia: 50 casos a 95%+ propõem; dado, grava a base em que foi dado', () => {
  const db = fresh();
  amostra(db, 50);
  const scope = autonomy.scopeOf({ channel: 'whatsapp', evidenceUsed: [{ key: 'sem-site' }] });
  const rec = autonomy.recommendation(db, scope);
  assert.equal(rec.elegivel, true);
  assert.equal(rec.taxaPct, 100);
  assert.equal(autonomy.proposals(db).length, 1, 'a proposta aparece em «Hoje»');
  const t = autonomy.grant(db, scope);
  assert.equal(t.status, 'autonomo');
  assert.equal(t.baseline.casos, 50);
  assert.ok(events.timeline(db, { limit: 200 }).some(e => e.action === 'autonomia.autonomo'));
});

test('autonomia: com autonomia, a mensagem desse tipo aprova-se sozinha — mas o opt-out manda', () => {
  const db = fresh();
  amostra(db, 50);
  const scope = autonomy.scopeOf({ channel: 'whatsapp', evidenceUsed: [{ key: 'sem-site' }] });
  autonomy.grant(db, scope);
  const l1 = leads.upsertLead(db, { name: 'Sem opt-out', phone: '+351 911 000 111' }).lead;
  const m1 = messages.draftMessage(db, { leadId: l1.id, channel: 'whatsapp', body: 'olá', evidenceUsed: [{ key: 'sem-site' }] });
  assert.equal(m1.status, 'aprovada', 'não pede autorização a quem já provou');
  // outro tipo de mensagem continua a pedir
  const l2 = leads.upsertLead(db, { name: 'Outro tipo', phone: '+351 911 000 222' }).lead;
  const m2 = messages.draftMessage(db, { leadId: l2.id, channel: 'email', body: 'olá', evidenceUsed: [{ key: 'com-marcacao' }] });
  assert.equal(m2.status, 'rascunho');
  // opt-out bloqueia mesmo com autonomia
  const l3 = leads.upsertLead(db, { name: 'Pediu para sair', email: 'sai@fora.pt', phone: '+351 911 000 333' }).lead;
  leads.optOut(db, { email: 'sai@fora.pt', reason: 'pediu' });
  const m3 = messages.draftMessage(db, { leadId: l3.id, channel: 'whatsapp', body: 'olá', evidenceUsed: [{ key: 'sem-site' }] });
  assert.equal(m3.status, 'rascunho', 'ser autónomo não passa por cima de um pedido de saída');
});

test('autonomia: revogar nunca falha e volta a pedir autorização', () => {
  const db = fresh();
  amostra(db, 50);
  const scope = autonomy.scopeOf({ channel: 'whatsapp', evidenceUsed: [{ key: 'sem-site' }] });
  autonomy.grant(db, scope);
  const t = autonomy.revoke(db, scope);
  assert.equal(t.status, 'pedir_sempre');
  assert.equal(autonomy.isAutonomous(db, scope), false);
  assert.equal(autonomy.revoke(db, 'nunca-existiu').status, 'pedir_sempre', 'descer é sempre possível');
});

test('autonomia: os limiares são configuráveis e ficam guardados', () => {
  const db = fresh();
  assert.deepEqual(autonomy.thresholds(db), { minCasos: 50, minTaxa: 0.95 });
  const t = autonomy.setThresholds(db, { minCasos: 5, minTaxa: 0.8 });
  assert.deepEqual(t, { minCasos: 5, minTaxa: 0.8 });
  amostra(db, 5);
  const scope = autonomy.scopeOf({ channel: 'whatsapp', evidenceUsed: [{ key: 'sem-site' }] });
  assert.equal(autonomy.recommendation(db, scope).elegivel, true);
});

test('ensaio: escreve-se tudo, não sai nada, e o relatório conta o que teria saído', () => {
  const db = fresh();
  autonomy.setTrial(db, true);
  const lead = withLead(db);
  const m = messages.draftMessage(db, { leadId: lead.id, channel: 'whatsapp', body: 'olá, sem site', evidenceUsed: [{ key: 'sem-site' }] });
  assert.equal(m.status, 'ensaio');
  const r = autonomy.trialReport(db);
  assert.equal(r.activo, true);
  assert.equal(r.total, 1);
  assert.match(r.nota, /nada disto saiu/);
  assert.equal(autonomy.trialReport(db).amostra[0].corpo, m.body);
  // promover põe no caminho normal
  const p = messages.promoteFromTrial(db, m.id);
  assert.equal(p.status, 'rascunho');
  messages.approveMessage(db, m.id);
  // rejeitar em ensaio também conta como decisão
  const m2 = messages.draftMessage(db, { leadId: lead.id, channel: 'whatsapp', body: 'outra', evidenceUsed: [{ key: 'sem-site' }] });
  assert.equal(messages.rejectMessage(db, m2.id, 'não gostei').status, 'rejeitada');
  autonomy.setTrial(db, false);
  assert.equal(autonomy.trial(db).activo, false);
  const m3 = messages.draftMessage(db, { leadId: lead.id, channel: 'whatsapp', body: 'fora do ensaio', evidenceUsed: [{ key: 'sem-site' }] });
  assert.equal(m3.status, 'rascunho');
});

test('evals: os casos fixos correm, ficam guardados com a versão do prompt, e detetam regressão', async () => {
  const db = fresh();
  const out = await evals.runAll(db);
  assert.equal(out.total, evals.CASES.length + evals.GUARD_CASES.length);
  assert.equal(out.falhou, 0, JSON.stringify(out.resultados.filter(r => !r.ok)));
  assert.equal(out.regressao, false);
  const h = evals.history(db);
  assert.equal(h.length, 1);
  assert.equal(h[0].prompt_version, evals.PROMPT_VERSION);
  assert.equal(h[0].passed, out.passou);
  // uma corrida pior tem de ser vista como regressão, não como sorte
  db.prepare("UPDATE evals SET passed = passed + 1").run();
  const pior = await evals.runAll(db);
  assert.equal(pior.regressao, true);
  assert.match(pior.aviso, /qualidade desceu/);
});

/* ---------- passo 5: saldo e clientes ---------- */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as money from './src/ops/money.mjs';
import * as tenants from './src/ops/tenants.mjs';

test('saldo: receita menos custos, e sem receita a margem é negativa — não é zero', () => {
  const db = fresh();
  withLead(db);
  messages.recordUsage(db, { provider: 'google-places', units: 10, costCents: 320 });
  const vazio = money.balance(db);
  assert.equal(vazio.receitaCentimos, 0);
  assert.equal(vazio.custoCentimos, 320);
  assert.equal(vazio.margemCentimos, -320, 'gastar sem receita tem de aparecer como prejuízo');
  assert.match(vazio.semDados.receita, /ainda não registaste/);
  money.record(db, { amountCents: 35000, campaign: 'Coimbra · barbearias' });
  const b = money.balance(db);
  assert.equal(b.receitaCentimos, 35000);
  assert.equal(b.margemCentimos, 34680);
  assert.equal(b.porCampanha[0].campanha, 'Coimbra · barbearias');
  assert.equal(b.custosPorFornecedor[0].provider, 'google-places');
  assert.equal(b.unitarios.custoPorLead, 320, 'um lead, 3,20 € de pesquisa');
  const r = money.listRevenue(db)[0];
  money.remove(db, r.id);
  assert.equal(money.listRevenue(db).length, 0);
});

test('agência: cada cliente tem a sua base de dados, e nada se mistura', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-clientes-'));
  const reg = tenants.openRegistry(dir);
  const a = tenants.create(reg, { nome: 'Óptica Central', nicho: 'ópticas', cidade: 'Porto', dadosDir: dir });
  const b = tenants.create(reg, { nome: 'Barbearia Norte', nicho: 'barbearias', cidade: 'Braga', dadosDir: dir });
  assert.notEqual(a.dbFile, b.dbFile);
  assert.ok(fs.existsSync(a.dbFile) && fs.existsSync(b.dbFile));
  assert.equal(tenants.list(reg).length, 2);
  // um lead escrito na base do cliente A não aparece na do cliente B
  const dbA = openDb(a.dbFile);
  leads.upsertLead(dbA, { name: 'Só do A', phone: '+351 912 999 000' });
  dbA.close();
  const dbB = openDb(b.dbFile);
  assert.equal(leads.listLeads(dbB, { limit: 10 }).length, 0, 'os leads de um cliente não existem no outro');
  dbB.close();
  // a oferta vive na base do cliente
  const oferta = tenants.create(reg, { nome: 'Clínica Sul', oferta: { preco_eur: 500 }, dadosDir: dir });
  const dbC = openDb(oferta.dbFile);
  assert.equal(personalize.offerOf(dbC).preco_eur, 500, 'a oferta do cliente é a dele');
  dbC.close();
  assert.throws(() => tenants.create(reg, { nome: 'Óptica Central', dadosDir: dir }), /já existe um espaço/);
  // activo é um de cada vez
  tenants.setActive(reg, a.id);
  assert.equal(tenants.active(reg).id, a.id);
  tenants.setActive(reg, b.id);
  assert.equal(tenants.active(reg).id, b.id);
  const roll = tenants.rollup(reg);
  assert.equal(roll.clientes.length, 3);
  assert.ok(roll.total);
  assert.ok(a.proximosPassos.length >= 3, 'o onboarding diz o que falta fazer');
  reg.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
