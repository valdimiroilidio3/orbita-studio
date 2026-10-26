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

/* ---------- passo 6: projetos, código, QA e entrega ---------- */

import * as projects from './src/ops/projects.mjs';
import { zipBuffer, crc32 } from './src/ops/zip.mjs';
import { createLimiter, authorized, adminMode } from './src/ops/guard.mjs';

function projetoDeTeste(db, dir, kind = 'landing') {
  const lead = leads.upsertLead(db, { name: `Negócio ${kind} ${Math.random().toString(36).slice(2, 7)}`, category: 'barbearia', city: 'Coimbra', phone: '+351 913 ' + String(Math.floor(Math.random() * 900000) + 100000) }).lead;
  return { lead, project: projects.fromLead(db, dir, lead.id, { kind }) };
}

test('projetos: nascem de um lead, um por negócio, com briefing escrito a partir do que se sabe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-projetos-'));
  const db = fresh();
  const { lead, project } = projetoDeTeste(db, dir);
  assert.equal(project.lead_id, lead.id);
  assert.match(project.brief, /Coimbra/);
  assert.equal(project.status, 'rascunho');
  assert.ok(project.pages.length >= 1 && project.acceptance.length >= 1);
  assert.throws(() => projects.fromLead(db, dir, lead.id), (e) => e.status === 409 && /já tem um projeto/.test(e.message));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('geração: quatro tipos escrevem ficheiros reais que passam o QA', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-geracao-'));
  const db = fresh();
  for (const kind of ['landing', 'institucional', 'loja', 'dashboard']) {
    const { project } = projetoDeTeste(db, dir, kind);
    const out = projects.generate(db, project.id);
    assert.ok(out.files.includes('index.html'), kind + ': sem index.html');
    assert.ok(out.files.includes('app.js') && out.files.includes('styles.css'), kind + ': faltam ficheiros base');
    assert.ok(fs.existsSync(path.join(project.dir, 'index.html')));
    const html = fs.readFileSync(path.join(project.dir, 'index.html'), 'utf8');
    assert.match(html, /<html lang="pt">/);
    assert.match(html, /name="viewport"/);
    const qa = projects.qa(db, project.id);
    assert.equal(qa.run.critical, 0, kind + ': ' + JSON.stringify(qa.run.items.filter(i => i.level === 'critico')));
    assert.equal(qa.run.important, 0, kind + ': ' + JSON.stringify(qa.run.items.filter(i => i.level === 'importante')));
    assert.equal(qa.run.passed, true, kind);
    if (kind === 'loja') assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project.dir, 'data/products.json'), 'utf8')), [], 'loja não inventa produtos');
    if (kind === 'dashboard') assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project.dir, 'data/dataset.json'), 'utf8')), [], 'sistema não inventa dados');
    assert.equal(projects.get(db, project.id).status, 'qa_passou');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('QA: apanha links partidos, falta de rótulos e lorem ipsum — e bloqueia a entrega', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-qa-'));
  const db = fresh();
  const { project } = projetoDeTeste(db, dir);
  projects.generate(db, project.id);
  const indexPath = path.join(project.dir, 'index.html');
  fs.writeFileSync(indexPath, fs.readFileSync(indexPath, 'utf8')
    .replace('href="#contacto"', 'href="pagina-que-nao-existe.html"')
    .replace('<label for="nome">Nome</label>', '')
    + '\n<p>Lorem ipsum dolor sit amet.</p>');
  const qa = projects.qa(db, project.id);
  assert.equal(qa.run.passed, false);
  const codes = qa.run.items.map(i => i.code);
  assert.ok(codes.includes('link-partido'), codes.join(','));
  assert.ok(codes.includes('label'), codes.join(','));
  assert.ok(codes.includes('lorem'), codes.join(','));
  assert.equal(projects.get(db, project.id).status, 'qa_falhou');
  assert.throws(() => projects.approve(db, project.id), /depois do QA passar|QA/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('entrega: só com QA aprovado e ficheiros iguais aos auditados; alterar depois bloqueia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-entrega-'));
  const db = fresh();
  const { project } = projetoDeTeste(db, dir);
  projects.generate(db, project.id);
  assert.throws(() => projects.approve(db, project.id), /QA/);
  projects.qa(db, project.id);
  assert.equal(projects.approve(db, project.id).project.status, 'aprovado');
  const out = projects.deliver(db, project.id, { target: 'preview' });
  assert.equal(out.url, `/preview/${project.id}/`);
  assert.equal(out.project.status, 'entregue');
  assert.equal(projects.deliveries(db, project.id).length, 1);
  // mexer num ficheiro depois do QA trava a entrega seguinte
  const outro = projetoDeTeste(db, dir);
  projects.generate(db, outro.project.id);
  projects.qa(db, outro.project.id);
  projects.approve(db, outro.project.id);
  fs.appendFileSync(path.join(outro.project.dir, 'styles.css'), '\n/* mexido depois do QA */\n');
  assert.throws(() => projects.deliver(db, outro.project.id, { target: 'preview' }), (e) => e.status === 409 && /mudaram depois do QA/.test(e.message));
  // Vercel sem credenciais: recusa com o nome exacto do que falta
  const semHook = { ...process.env }; delete process.env.VERCEL_DEPLOY_HOOK;
  try { assert.throws(() => projects.deliver(db, project.id, { target: 'vercel' }), /VERCEL_DEPLOY_HOOK/); } finally { process.env = semHook; }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('zip: entradas válidas, CRC certo e nomes com acentos preservados', () => {
  const { buffer } = zipBuffer([{ name: 'index.html', data: '<p>olá</p>' }, { name: 'data/produtos.json', data: '[]' }]);
  assert.equal(buffer.subarray(0, 4).toString('hex'), '504b0304', 'assinatura PKZIP');
  assert.equal(crc32(Buffer.from('123456789')), 0xCBF43926, 'CRC-32 de referência (0xCBF43926)');
  // o directório central tem de listar as duas entradas
  const text = buffer.toString('latin1');
  assert.ok(text.includes('index.html') && text.includes('data/produtos.json'));
  assert.ok(buffer.subarray(-22).readUInt32LE(0) === 0x06054b50, 'fim do directório central');
});

test('funil comercial: qualificar, negociar, proposta e ganho — sem saltos', () => {
  const db = fresh();
  const lead = leads.upsertLead(db, { name: 'Loja Nova', city: 'Braga', phone: '+351 913 555 666' }).lead;
  leads.setStatus(db, lead.id, 'qualificado');
  leads.setStatus(db, lead.id, 'contactado');
  leads.setStatus(db, lead.id, 'em_negociacao');
  leads.setStatus(db, lead.id, 'proposta');
  const ganho = leads.setStatus(db, lead.id, 'cliente');
  assert.equal(ganho.status, 'cliente');
  assert.throws(() => leads.setStatus(db, lead.id, 'novo'), /fim/);
  const outro = leads.upsertLead(db, { name: 'Outra', phone: '+351 913 777 888' }).lead;
  assert.throws(() => leads.setStatus(db, outro.id, 'cliente'), /segue o funil/);
});

test('guarda: modo local sem segredo, token exigido quando configurado, ritmo limitado', () => {
  const env = { ...process.env };
  delete env.ORBITA_ADMIN_TOKEN;
  assert.equal(adminMode(env), 'local');
  assert.equal(authorized({ headers: {} }, env).ok, true, 'sem token configurado não se barra ninguém');
  const comToken = { ...env, ORBITA_ADMIN_TOKEN: 'um-segredo-comprido-para-teste' };
  assert.equal(adminMode(comToken), 'token');
  assert.equal(authorized({ headers: {} }, comToken).ok, false);
  assert.equal(authorized({ headers: { 'x-orbita-admin': 'errado' } }, comToken).ok, false);
  assert.equal(authorized({ headers: { 'x-orbita-admin': 'um-segredo-comprido-para-teste' } }, comToken).ok, true);
  assert.equal(authorized({ headers: { authorization: 'Bearer um-segredo-comprido-para-teste' } }, comToken).ok, true);
  let t = 0;
  const limiter = createLimiter({ windowMs: 1000, max: 3, now: () => t });
  assert.equal(limiter.check('ip').ok, true);
  assert.equal(limiter.check('ip').ok, true);
  assert.equal(limiter.check('ip').ok, true);
  const blocked = limiter.check('ip');
  assert.equal(blocked.ok, false);
  assert.ok(blocked.espera >= 1);
  t += 1000;
  assert.equal(limiter.check('ip').ok, true, 'a janela volta a abrir');
  assert.equal(limiter.check('outro-ip').ok, true, 'um IP não paga pelo outro');
});

/* ---------- passo 7: tarefas dos departamentos, funil e pesquisa ---------- */

import * as tasks from './src/ops/tasks.mjs';
import * as search from './src/ops/search.mjs';
import { csrfOk, sameOrigin } from './src/ops/guard.mjs';

const semMotor = async () => { throw new Error('esta tarefa precisa de um motor de IA e não há nenhum configurado'); };

test('tarefas: cada tipo tem departamento, e um duplicado aberto devolve a mesma tarefa', () => {
  const db = fresh();
  const a = tasks.create(db, { kind: 'lead.qualificar', entity: 'lead', entityId: 'l_1' });
  const b = tasks.create(db, { kind: 'lead.qualificar', entity: 'lead', entityId: 'l_1' });
  assert.equal(b.existed, true);
  assert.equal(b.task.id, a.task.id, 'não pode haver duas abertas para o mesmo trabalho');
  assert.equal(a.task.dept, 'prospect');
  assert.equal(a.task.state, 'queued');
  assert.equal(tasks.DEPARTMENTS.length, 6);
  assert.deepEqual(tasks.DEPARTMENTS.map(d => d.name), ['ORION', 'LUNA', 'KAI', 'NOVA', 'ZEKE', 'MIRA']);
  assert.throws(() => tasks.create(db, { kind: 'inventar.tarefa', entityId: 'x' }), (e) => e.status === 400);
  // terminada, a chave volta a estar livre: repetir o trabalho é legítimo
  db.prepare("UPDATE tasks SET state='succeeded', finished_at=? WHERE id=?").run(new Date().toISOString(), a.task.id);
  const c = tasks.create(db, { kind: 'lead.qualificar', entity: 'lead', entityId: 'l_1' });
  assert.equal(c.existed, false);
});

test('tarefas: corre, falha com motivo escrito e não inventa resultado sem motor', async () => {
  const db = fresh();
  const ok = tasks.create(db, { kind: 'lead.qualificar', entity: 'lead', entityId: 'l_1' });
  const r1 = await tasks.run(db, ok.task.id, { handlers: { 'lead.qualificar': () => ({ result: { score: 70 }, evidence: [{ label: 'sem site (+25)' }] }) } });
  assert.equal(r1.ok, true);
  assert.equal(r1.task.state, 'succeeded');
  assert.equal(r1.task.result.score, 70);
  assert.equal(r1.task.evidence.length, 1);
  assert.ok(r1.task.duration_ms !== null);

  const sem = tasks.create(db, { kind: 'conteudo.rascunho', entity: 'projeto', entityId: 'p_1' });
  const r2 = await tasks.run(db, sem.task.id, { handlers: {} });
  assert.equal(r2.ok, false);
  assert.equal(r2.task.state, 'failed');
  assert.match(r2.task.error, /motor de IA/);
  assert.deepEqual(r2.task.result, {}, 'uma falha não deixa resultado inventado');

  const erro = tasks.create(db, { kind: 'projeto.qa', entity: 'projeto', entityId: 'p_2' });
  const r3 = await tasks.run(db, erro.task.id, { handlers: { 'projeto.qa': semMotor } });
  assert.equal(r3.task.state, 'failed');
  assert.match(r3.task.error, /motor de IA/);
});

test('tarefas: prazo esgotado falha em vez de ficar pendurada', async () => {
  const db = fresh();
  const t = tasks.create(db, { kind: 'lead.pesquisar', entity: 'lead', entityId: 'l_9', timeoutMs: 60 });
  const out = await tasks.run(db, t.task.id, { handlers: { 'lead.pesquisar': () => new Promise(r => setTimeout(() => r({ result: { tarde: true } }), 500)) } });
  assert.equal(out.ok, false);
  assert.equal(out.task.state, 'failed');
  assert.match(out.task.error, /tempo esgotado/);
});

test('tarefas: tentativas limitadas, e um falhanço pode ser repetido até ao limite', async () => {
  const db = fresh();
  const t = tasks.create(db, { kind: 'projeto.gerar', entity: 'projeto', entityId: 'p_3', maxAttempts: 2 });
  const boom = { 'projeto.gerar': () => { throw new Error('disco cheio'); } };
  const um = await tasks.run(db, t.task.id, { handlers: boom });
  assert.equal(um.task.attempts, 1);
  const dois = await tasks.run(db, t.task.id, { handlers: boom });
  assert.equal(dois.task.attempts, 2);
  assert.equal(dois.task.state, 'failed');
  await assert.rejects(() => tasks.run(db, t.task.id, { handlers: boom }), (e) => e.status === 409 && /esgotadas/.test(e.message));
  // repetir depois de consertar o problema é permitido numa tarefa nova
  const nova = tasks.create(db, { kind: 'projeto.gerar', entity: 'projeto', entityId: 'p_3' });
  const bom = await tasks.run(db, nova.task.id, { handlers: { 'projeto.gerar': () => ({ result: { files: ['index.html'] } }) } });
  assert.equal(bom.task.state, 'succeeded');
});

test('tarefas: acção de risco pára à espera do dono; aprovar e rejeitar ficam escritos', async () => {
  const db = fresh();
  const t = tasks.create(db, { kind: 'projeto.entregar', entity: 'projeto', entityId: 'p_4', approval: true });
  const out = await tasks.run(db, t.task.id, { handlers: { 'projeto.entregar': () => ({ result: { url: '/preview/p_4/' } }) } });
  assert.equal(out.task.state, 'awaiting_approval');
  assert.equal(tasks.approve(db, t.task.id, { actor: 'dono', note: 'visto' }).state, 'succeeded');
  assert.equal(tasks.get(db, t.task.id).approved_by, 'dono');
  assert.throws(() => tasks.approve(db, t.task.id), (e) => e.status === 409, 'aprovar duas vezes não faz sentido');
  const outra = tasks.create(db, { kind: 'projeto.entregar', entity: 'projeto', entityId: 'p_5', approval: true });
  await tasks.run(db, outra.task.id, { handlers: { 'projeto.entregar': () => ({ result: {} }) } });
  assert.equal(tasks.reject(db, outra.task.id, { reason: 'não é para já' }).state, 'cancelled');
});

test('tarefas: reinício recupera o que ficou a meio — volta à fila ou falha com o motivo', () => {
  const db = fresh();
  const velha = tasks.create(db, { kind: 'projeto.qa', entity: 'projeto', entityId: 'p_6', timeoutMs: 1000 });
  const nova = tasks.create(db, { kind: 'projeto.qa', entity: 'projeto', entityId: 'p_7', timeoutMs: 600000 });
  const atras = new Date(Date.now() - 60000).toISOString();
  db.prepare("UPDATE tasks SET state='running', started_at=?, attempts=1 WHERE id=?").run(atras, velha.task.id);
  db.prepare("UPDATE tasks SET state='running', started_at=? WHERE id=?").run(new Date().toISOString(), nova.task.id);
  const out = tasks.recover(db);
  assert.equal(out.requeued, 1);
  assert.equal(tasks.get(db, velha.task.id).state, 'queued');
  assert.equal(tasks.get(db, nova.task.id).state, 'running', 'a que ainda está dentro do prazo não se toca');
});

test('agentes: o painel lê estados reais e não inventa quem está a trabalhar', async () => {
  const db = fresh();
  const nada = tasks.board(db);
  assert.deepEqual(nada.emCurso, [], 'sem tarefas, ninguém está a trabalhar');
  assert.equal(nada.departamentos.length, 6);
  const t = tasks.create(db, { kind: 'projeto.gerar', entity: 'projeto', entityId: 'p_8' });
  db.prepare("UPDATE tasks SET state='running', started_at=? WHERE id=?").run(new Date().toISOString(), t.task.id);
  const com = tasks.board(db);
  assert.deepEqual(com.emCurso, ['ZEKE']);
  assert.equal(com.departamentos.find(d => d.key === 'engineering').running, 1);
});

test('funil: conversão por fase e por origem sai dos registos, não de estimativas', () => {
  const db = fresh();
  const a = leads.upsertLead(db, { name: 'A', phone: '+351 911 000 001', source: 'osm' }).lead;
  const b = leads.upsertLead(db, { name: 'B', phone: '+351 911 000 002', source: 'osm' }).lead;
  const c = leads.upsertLead(db, { name: 'C', phone: '+351 911 000 003', source: 'manual' }).lead;
  leads.setStatus(db, a.id, 'qualificado'); leads.setStatus(db, a.id, 'contactado'); leads.setStatus(db, a.id, 'em_negociacao'); leads.setStatus(db, a.id, 'proposta'); leads.setStatus(db, a.id, 'cliente');
  leads.setStatus(db, b.id, 'qualificado'); leads.setStatus(db, b.id, 'perdido');
  const p = metrics.pipeline(db);
  const fase = k => p.fases.find(f => f.key === k).leads;
  assert.equal(fase('novo'), 3);
  assert.equal(fase('qualificado'), 2);
  assert.equal(fase('cliente'), 1, 'só o A chegou a ganho');
  assert.equal(p.perdidos, 1);
  assert.equal(p.fases.find(f => f.key === 'qualificado').conversao, Math.round((2 / 3) * 1000) / 10);
  const osm = p.porOrigem.find(o => o.origem === 'osm');
  assert.equal(osm.total, 2);
  assert.equal(osm.ganhos, 1);
  assert.equal(osm.taxa, 50);
  assert.equal(p.paradas.lista.length, 0, 'tudo acabou de ser tocado');
  assert.ok(c.id);
});

test('funil: uma oportunidade abertas há semanas aparece como parada', () => {
  const db = fresh();
  const l = leads.upsertLead(db, { name: 'Parada', phone: '+351 911 000 009' }).lead;
  leads.setStatus(db, l.id, 'qualificado');
  db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(new Date(Date.now() - 30 * 86400000).toISOString(), l.id);
  const p = metrics.pipeline(db);
  assert.equal(p.paradas.lista.length, 1);
  assert.ok(p.paradas.lista[0].dias_parado >= 29);
});

test('pesquisa: encontra sem acentos e distingue leads, projetos e tarefas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-pesquisa-'));
  const db = fresh();
  const l = leads.upsertLead(db, { name: 'Clínica Aurora', city: 'Porto', category: 'dentista', phone: '+351 911 000 111' }).lead;
  const p = projects.create(db, dir, { leadId: l.id, name: 'Aurora — Página de conversão', client: 'Clínica Aurora', kind: 'landing' });
  tasks.create(db, { kind: 'projeto.gerar', entity: 'projeto', entityId: p.id, title: 'Gerar o código da Aurora' });
  const porNome = search.search(db, 'clinica');
  assert.equal(porNome.grupos.find(g => g.grupo === 'leads').itens[0].id, l.id);
  const porProjeto = search.search(db, 'aurora');
  assert.ok(porProjeto.grupos.some(g => g.grupo === 'projetos'));
  assert.ok(porProjeto.grupos.some(g => g.grupo === 'tarefas'));
  assert.equal(search.search(db, 'zzzz').total, 0);
  assert.equal(search.search(db, 'a').total, 0, 'uma letra não é pesquisa');
  assert.ok(porNome.grupos[0].itens[0].route.startsWith('#/lead/'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('csrf: credencial em cookie de outra origem é recusada; cabeçalho e GET passam', () => {
  assert.equal(csrfOk({ method: 'GET', headers: { cookie: 'orbita_admin=abc', origin: 'https://mau.example' } }).ok, true, 'GET não muda estado');
  assert.equal(csrfOk({ method: 'POST', headers: { cookie: 'orbita_admin=abc', origin: 'https://mau.example', host: 'localhost:4520' } }).ok, false);
  assert.equal(csrfOk({ method: 'POST', headers: { cookie: 'orbita_admin=abc', origin: 'http://localhost:4520', host: 'localhost:4520' } }).ok, true);
  assert.equal(csrfOk({ method: 'POST', headers: { 'x-orbita-admin': 'abc', origin: 'https://mau.example' } }).ok, true, 'sem cookie não há CSRF');
  assert.equal(sameOrigin({ headers: { origin: 'https://orbita.example', host: 'orbita.example' } }).ok, true);
});

/* ---------- passo 8: contas, sessões e papéis (autenticação ≠ autorização) ---------- */

import * as auth from './src/ops/auth.mjs';
import { authenticate, sessionCookie, clearSessionCookie, wantsSecureCookie } from './src/ops/guard.mjs';

const dono = (db, over = {}) => auth.createUser(db, { email: 'dono@orbita.pt', name: 'Chelton', password: 'uma-frase-bem-comprida', role: 'dono', ...over });

test('palavras-passe: scrypt com sal, nunca iguais, e as fracas são recusadas com o motivo', () => {
  const a = auth.hashPassword('uma-frase-bem-comprida');
  const b = auth.hashPassword('uma-frase-bem-comprida');
  assert.notEqual(a, b, 'duas hashes da mesma palavra-passe não podem ser iguais (sal próprio)');
  assert.match(a, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(auth.verifyPassword('uma-frase-bem-comprida', a), true);
  assert.equal(auth.verifyPassword('outra-frase-bem-comprida', a), false);
  assert.equal(auth.verifyPassword('qualquer', 'lixo'), false, 'formato desconhecido não autentica');
  assert.match(auth.checkPassword('curta'), /12 caracteres/);
  assert.match(auth.checkPassword('aaaaaaaaaaaaaa'), /mesmo carácter/);
  assert.match(auth.checkPassword('password1234'), /primeiras que alguém tenta/);
  assert.match(auth.checkPassword('clinica-aurora-2026', { email: 'clinica@x.pt' }), /o teu email/);
  assert.equal(auth.checkPassword('uma-frase-bem-comprida'), null);
});

test('papéis: a hierarquia decide, e o leitor não escreve nem aprova', () => {
  assert.deepEqual(auth.ROLE_KEYS, ['dono', 'gestor', 'operador', 'leitor']);
  assert.equal(auth.can('leitor', 'read'), true);
  assert.equal(auth.can('leitor', 'write'), false);
  assert.equal(auth.can('operador', 'write'), true);
  assert.equal(auth.can('operador', 'approve'), false);
  assert.equal(auth.can('gestor', 'approve'), true);
  assert.equal(auth.can('gestor', 'admin'), false);
  assert.equal(auth.can('dono', 'admin'), true);
  assert.equal(auth.can('inexistente', 'read'), false);
  assert.equal(auth.can('dono', 'inventada'), false);
});

test('contas: email único e normalizado, papel válido, e a primeira conta só nasce uma vez', () => {
  const db = fresh();
  const u = auth.createFirstOwner(db, { email: '  Dono@Orbita.PT ', name: 'Chelton', password: 'uma-frase-bem-comprida' });
  assert.equal(u.email, 'dono@orbita.pt');
  assert.equal(u.role, 'dono');
  assert.equal(u.password_hash, undefined, 'a hash nunca sai da camada de autenticação');
  assert.throws(() => auth.createFirstOwner(db, { email: 'outro@orbita.pt', password: 'outra-frase-comprida' }), (e) => e.status === 409);
  assert.throws(() => auth.createUser(db, { email: 'dono@orbita.pt', password: 'outra-frase-comprida', role: 'leitor' }), (e) => e.status === 409);
  assert.throws(() => auth.createUser(db, { email: 'nao-e-email', password: 'outra-frase-comprida' }), /email inválido/);
  assert.throws(() => auth.createUser(db, { email: 'a@b.pt', password: 'outra-frase-comprida', role: 'imperador' }), /papel desconhecido/);
  assert.equal(auth.listUsers(db).length, 1);
  // não se fica sem dono activo
  assert.throws(() => auth.setRole(db, u.id, 'leitor'), (e) => e.status === 409);
  const segundo = auth.createUser(db, { email: 'segundo@orbita.pt', password: 'outra-frase-comprida', role: 'dono' });
  assert.equal(auth.setRole(db, u.id, 'gestor').role, 'gestor', 'com dois donos já se pode descer um');
  // agora só resta um dono: descer esse é recusado — a instalação não fica sem ninguém que administre
  assert.throws(() => auth.setRole(db, segundo.id, 'operador'), (e) => e.status === 409 && /sem nenhum dono/.test(e.message));
  const terceiro = auth.createUser(db, { email: 'terceiro@orbita.pt', password: 'outra-frase-comprida', role: 'dono' });
  assert.equal(auth.setRole(db, segundo.id, 'operador').role, 'operador');
  assert.ok(terceiro.id);
});

test('sessões: expiram, revogam-se e o token não fica guardado em claro', () => {
  const db = fresh();
  const u = dono(db);
  const { token } = auth.openSession(db, u, { hours: 1, at: Date.parse('2026-10-26T10:00:00Z') });
  assert.ok(token.length >= 40);
  const guardado = db.prepare('SELECT token_hash FROM sessions').get().token_hash;
  assert.notEqual(guardado, token, 'na base fica o sha256, nunca o token');
  // dentro do prazo
  assert.equal(auth.sessionUser(db, token, { at: Date.parse('2026-10-26T10:30:00Z') }).user.id, u.id);
  // depois do prazo
  assert.match(auth.sessionUser(db, token, { at: Date.parse('2026-10-26T11:01:00Z') }).error, /expirada/);
  // revogada
  const outra = auth.openSession(db, u, { at: Date.now() });
  auth.revokeSession(db, outra.id, { actor: 'dono', reason: 'teste' });
  assert.match(auth.sessionUser(db, outra.token).error, /terminada/);
  // desactivar a conta fecha tudo — e não se desactiva o último dono
  assert.throws(() => auth.deactivate(db, u.id), /sem nenhum dono/);
  auth.createUser(db, { email: 'outro-dono@orbita.pt', password: 'outra-frase-comprida', role: 'dono' });
  const terceira = auth.openSession(db, u, { at: Date.now() });
  auth.deactivate(db, u.id);
  assert.match(auth.sessionUser(db, terceira.token).error, /terminada/);
  // e a conta desactivada já não entra, mesmo com a palavra-passe certa
  assert.throws(() => auth.login(db, { email: u.email, password: 'uma-frase-bem-comprida', at: Date.now() }), (e) => e.status === 401);
  assert.equal(auth.sessionUser(db, 'token-inventado').error !== undefined, true);
});

test('sessões: trocar a palavra-passe fecha todas as sessões antigas', () => {
  const db = fresh();
  const u = dono(db);
  const s = auth.openSession(db, u);
  assert.equal(auth.sessionUser(db, s.token).user.id, u.id);
  const r = auth.setPassword(db, u.id, 'outra-frase-muito-boa');
  assert.equal(r.sessoes_fechadas, 1);
  assert.match(auth.sessionUser(db, s.token).error, /terminada/);
  assert.throws(() => auth.setPassword(db, u.id, 'curta'), /12 caracteres/);
});

test('entrar: palavra-passe errada não entra e cinco falhas bloqueiam — sem revelar quem tem conta', () => {
  const db = fresh();
  dono(db);
  const t0 = Date.parse('2026-10-26T09:00:00Z');
  assert.throws(() => auth.login(db, { email: 'dono@orbita.pt', password: 'errada-mas-comprida', at: t0 }), (e) => e.status === 401);
  const desconhecido = (() => { try { auth.login(db, { email: 'ninguem@orbita.pt', password: 'errada-mas-comprida', at: t0 }); } catch (e) { return e; } })();
  assert.equal(desconhecido.status, 401);
  assert.equal(desconhecido.message, 'email ou palavra-passe errados', 'a mesma frase para os dois casos');
  for (let i = 0; i < 4; i++) { try { auth.login(db, { email: 'dono@orbita.pt', password: 'errada-mas-comprida', at: t0 + i * 1000 }); } catch { /* esperado */ } }
  assert.throws(() => auth.login(db, { email: 'dono@orbita.pt', password: 'uma-frase-bem-comprida', at: t0 + 6000 }), (e) => e.status === 423 && /demasiadas tentativas/.test(e.message));
  // o registo não guarda o email em claro
  const linhas = db.prepare('SELECT * FROM auth_attempts').all();
  assert.ok(linhas.length >= 5);
  assert.equal(JSON.stringify(linhas).includes('dono@orbita.pt'), false, 'o email vai em hash, não em claro');
  // passada a janela, entra
  const ok = auth.login(db, { email: 'DONO@orbita.pt', password: 'uma-frase-bem-comprida', at: t0 + 16 * 60000 });
  assert.equal(ok.user.role, 'dono');
  assert.ok(ok.token);
});

test('guarda: sessão manda no papel; máquina vale como dono; local só quando não há contas', () => {
  const db = fresh();
  const u = auth.createUser(db, { email: 'leitor@orbita.pt', password: 'uma-frase-bem-comprida', role: 'leitor' });
  const s = auth.openSession(db, u, { at: Date.now() });
  const req = (headers = {}) => ({ method: 'GET', headers });
  // sem credencial, com contas → 401 a pedir entrada
  const anon = authenticate(req(), { db, env: {} });
  assert.equal(anon.ok, false);
  assert.equal(anon.hint, 'sessao');
  // sessão válida → leitor, sem escrita
  const comSessao = authenticate(req({ cookie: `orbita_sessao=${s.token}` }), { db, env: {} });
  assert.equal(comSessao.ok, true);
  assert.equal(comSessao.mode, 'sessao');
  assert.equal(comSessao.role, 'leitor');
  assert.deepEqual(comSessao.perms, { read: true, write: false, approve: false, admin: false });
  // token de máquina, com contas → dono, mas marcado como máquina
  const envToken = { ORBITA_ADMIN_TOKEN: 'um-token-de-maquina-comprido' };
  const maquina = authenticate(req({ 'x-orbita-admin': 'um-token-de-maquina-comprido' }), { db, env: envToken });
  assert.equal(maquina.ok, true);
  assert.equal(maquina.mode, 'token');
  assert.equal(maquina.machine, true);
  assert.equal(maquina.can('admin'), true);
  // ORBITA_AUTH=sessao desliga a credencial de máquina
  const estrito = authenticate(req({ 'x-orbita-admin': 'um-token-de-maquina-comprido' }), { db, env: { ...envToken, ORBITA_AUTH: 'sessao' } });
  assert.equal(estrito.ok, false);
  // base sem contas e sem token → modo local explícito
  const vazia = fresh();
  const local = authenticate(req(), { db: vazia, env: {} });
  assert.equal(local.ok, true);
  assert.equal(local.local, true);
  assert.equal(local.can('admin'), true);
});

test('cookies: HttpOnly, SameSite=Strict, Path=/ e Secure só onde faz sentido', () => {
  const c = sessionCookie('abc123', { maxAgeSeconds: 3600, secure: true });
  assert.match(c, /^orbita_sessao=abc123; Path=\/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure$/);
  assert.doesNotMatch(sessionCookie('abc', { maxAgeSeconds: 60, secure: false }), /Secure/);
  assert.match(clearSessionCookie(), /Max-Age=0/);
  assert.equal(wantsSecureCookie({ headers: { 'x-forwarded-proto': 'https' } }, {}), true);
  assert.equal(wantsSecureCookie({ headers: {} }, {}), false);
  assert.equal(wantsSecureCookie({ headers: {} }, { ORBITA_SECURE_COOKIE: '1' }), true);
});

test('estado de autenticação: diz em palavras o que está aberto', () => {
  const db = fresh();
  assert.equal(auth.authState(db, {}).modo, 'local');
  assert.match(auth.authState(db, {}).descricao, /MODO LOCAL/);
  dono(db);
  const comContas = auth.authState(db, {});
  assert.equal(comContas.modo, 'sessao');
  assert.match(comContas.descricao, /1 conta/);
  const comToken = auth.authState(db, { ORBITA_ADMIN_TOKEN: 'um-token-de-maquina-comprido' });
  assert.equal(comToken.token, true);
  assert.equal(comToken.modo, 'sessao', 'com contas, quem manda são as contas');
});

/* ---------- 26 out 2026: o que o escritório 3D mostra em cada monitor ---------- */
import * as live from './src/ops/live.mjs';
import { AGENTS } from './src/data.js';

test('ao vivo: cada monitor pertence a um agente que já existia — nenhum posto inventado', () => {
  const ids = new Set(AGENTS.map(a => a.id));
  for (const [kind, seat] of Object.entries(live.SEAT)) {
    assert.ok(ids.has(seat), `${kind} → ${seat} não existe no escritório`);
  }
  assert.equal(new Set(Object.keys(live.SEAT)).size, Object.keys(live.SEAT).length, 'um tipo de tarefa por chave');
  for (const [op, scene] of Object.entries(live.DEPT_BRIDGE)) {
    assert.ok(AGENTS.some(a => a.dept === scene), `departamento ${op} → ${scene} não existe na cena`);
  }
});

test('ao vivo: sem trabalho registado o posto está idle e di-lo por palavras', () => {
  const db = fresh();
  const snap = live.snapshot(db);
  assert.equal(Object.keys(snap.agents).length, new Set(Object.values(live.SEAT)).size);
  for (const a of Object.values(snap.agents)) {
    assert.equal(a.state, 'idle');
    assert.equal(a.hasData, false);
    assert.match(a.lines[0].text, /sem tarefas registadas/);
    assert.deepEqual(a.artifacts, []);
    assert.equal(a.verification, null, 'sem QA não há resultado para mostrar');
  }
  assert.equal(snap.totais.live, 0);
  assert.match(snap.fonte, /base de dados/);
});

test('ao vivo: running → live, queued → waiting, falhada → error, e nada de percentagens', () => {
  const db = fresh();
  const r = tasks.create(db, { kind: 'projeto.gerar', entity: 'projeto', entityId: 'p_live' });
  db.prepare("UPDATE tasks SET state='running', started_at=?, attempts=2 WHERE id=?").run(new Date().toISOString(), r.task.id);
  const a1 = live.snapshot(db).agents.crep;
  assert.equal(a1.state, 'live');
  assert.equal(a1.task.id, r.task.id);
  assert.ok(a1.lines.some(l => /tentativa 2\/3/.test(l.text)), 'mostra a tentativa real, não uma percentagem');
  assert.ok(!a1.lines.some(l => /%/.test(l.text)), 'nenhuma percentagem inventada');

  const q = tasks.create(db, { kind: 'projeto.qa', entity: 'projeto', entityId: 'p_live' });
  assert.equal(live.snapshot(db).agents.qa.state, 'waiting');
  assert.match(live.snapshot(db).agents.qa.lines.map(l => l.text).join(' '), /Auditar|à espera/);
  assert.equal(tasks.get(db, q.task.id).state, 'queued');
});

test('ao vivo: uma falha pinta o posto de error, mas só enquanto é recente', () => {
  const db = fresh();
  const r = tasks.create(db, { kind: 'projeto.entregar', entity: 'projeto', entityId: 'p_f' });
  db.prepare("UPDATE tasks SET state='failed', error=?, finished_at=? WHERE id=?")
    .run('sem permissão no alvo /home/chelton/segredo', new Date().toISOString(), r.task.id);
  const agora = live.snapshot(db).agents.apay;
  assert.equal(agora.state, 'error');
  assert.ok(agora.lines.some(l => l.k === 'error'));
  assert.doesNotMatch(JSON.stringify(agora), /\/home\/chelton/, 'caminhos absolutos não saem do servidor');
  const tarde = live.snapshot(db, { now: Date.now() + 31 * 60 * 1000 }).agents.apay;
  assert.notEqual(tarde.state, 'error', 'uma falha de ontem não fica vermelha para sempre');
});

test('ao vivo: a impressão digital só muda quando o trabalho muda', () => {
  const db = fresh();
  const db2 = fresh();
  assert.equal(live.fingerprint(db), live.fingerprint(db2), 'bases iguais, impressões iguais');
  const before = live.fingerprint(db);
  const r = tasks.create(db, { kind: 'lead.qualificar', entity: 'lead', entityId: 'l_1' });
  const after = live.fingerprint(db);
  assert.notEqual(before, after, 'uma tarefa nova muda a impressão');
  db.prepare("UPDATE tasks SET state='running', started_at=? WHERE id=?").run(new Date().toISOString(), r.task.id);
  assert.notEqual(live.fingerprint(db), after, 'mudar de estado muda a impressão');
  const stable = live.fingerprint(db);
  assert.equal(live.fingerprint(db), stable, 'o tempo a passar, sozinho, não gera eventos');
});

test('ao vivo: redact esconde chaves, tokens e caminhos antes de chegarem ao cliente', () => {
  assert.doesNotMatch(live.redact('ficheiro /home/chelton/orbita/db.sqlite'), /\/home\/chelton/);
  assert.match(live.redact('/home/chelton/orbita/db.sqlite'), /…\/orbita\/db\.sqlite/);
  assert.equal(live.redact('ORBITA_ADMIN_TOKEN=abc123segredo'), 'ORBITA_ADMIN_TOKEN=[oculto]');
  assert.match(live.redact('chave ghp_abcdefghijklmnop'), /\[chave oculta\]/);
  assert.match(live.redact('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefgh'), /\[token oculto\]/);
});

test('ao vivo: uma tarefa falhada nunca aparece escrita como «concluída»', () => {
  const db = fresh();
  const r = tasks.create(db, { kind: 'projeto.qa', entity: 'projeto', entityId: 'p_sem' });
  db.prepare("UPDATE tasks SET state='failed', error='projeto não encontrado', finished_at=? WHERE id=?")
    .run(new Date().toISOString(), r.task.id);
  const a = live.snapshot(db).agents.qa;
  const texto = a.lines.map(l => l.text).join(' / ');
  assert.equal(a.state, 'error');
  assert.match(texto, /falhou/);
  assert.doesNotMatch(texto, /concluída/);
});

test('ao vivo: um posto sem tarefas próprias mostra a atividade do departamento, rotulada', () => {
  const db = fresh();
  const r = tasks.create(db, { kind: 'projeto.qa', entity: 'projeto', entityId: 'p_dep' });
  db.prepare("UPDATE tasks SET state='running', started_at=? WHERE id=?").run(new Date().toISOString(), r.task.id);
  const snap = live.snapshot(db, {
    agents: ['dlead', 'qa'],
    roster: { dlead: { dept: 'delivery' }, qa: { dept: 'delivery' } },
  });
  const outro = snap.agents.dlead;
  assert.equal(outro.hasData, false, 'o posto dlead não tem tarefas próprias');
  assert.ok(outro.deptActivity, 'mas o departamento dele tem trabalho');
  assert.equal(outro.deptActivity.dept, 'delivery');
  assert.equal(outro.deptActivity.task.state, 'running');
  assert.equal(snap.agents.qa.hasData, true, 'o dono da tarefa tem o trabalho no seu próprio registo');
});
