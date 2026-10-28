// As respostas dos clientes — 1.37.0 (27 out 2026).
//
// A mesa sabia mandar e ficava à espera. Estes testes provam o lado que faltava:
// um webhook entra assinado, encontra a pessoa certa, grava a resposta uma só vez
// (a Meta repete) e move o funil sem estragar quem já é cliente.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { telefoneCanonico, emailCanonico, normalizarWhatsapp, normalizarEmail, assinaturaSvix, assinaturaMeta } from './api/_entrada.mjs';

const CHAVE_META = 'segredo-da-app-da-meta';
const CHAVE_SVIX = 'whsec_' + Buffer.from('segredo-do-resend-1234567890').toString('base64');

const repoCom = async ({ leads = [], mensagens = [] } = {}) => {
  const repo = createMemRepo({ leads, mensagens });
  return repo;
};

const lead = (x) => ({
  id: x.id, dedupe_key: `${x.id}`, name: x.name, email: x.email || null, phone: x.phone || null,
  status: x.status || 'contactado', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  ...x,
});

const envMeta = { WHATSAPP_APP_SECRET: CHAVE_META, WHATSAPP_VERIFY_TOKEN: 'a-minha-frase' };
const envSvix = { RESEND_WEBHOOK_SECRET: CHAVE_SVIX };

const assinarMeta = (bruto) => `sha256=${createHmac('sha256', CHAVE_META).update(bruto).digest('hex')}`;
const assinarSvix = (id, ts, bruto) => {
  const chave = Buffer.from(CHAVE_SVIX.replace(/^whsec_/, ''), 'base64');
  return `v1,${createHmac('sha256', chave).update(`${id}.${ts}.${bruto}`).digest('base64')}`;
};

const zap = (texto, de = '351912345678', extra = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: {
    messaging_product: 'whatsapp',
    metadata: { display_phone_number: '351300000000', phone_number_id: '123' },
    contacts: [{ wa_id: de, profile: { name: 'Ana' } }],
    messages: [{ from: de, id: extra.id || 'wamid.ABC', timestamp: '1761600000', type: 'text', text: { body: texto }, ...extra.msg }],
  } }] }],
});

/* ---------------- normalização ---------------- */

test('1 · telefone e email comparam-se como um humano os leria', () => {
  assert.equal(telefoneCanonico('+351 912 345 678'), telefoneCanonico('912345678'));
  assert.equal(telefoneCanonico('00351912345678'), '912345678');
  assert.equal(telefoneCanonico(''), '');
  assert.equal(emailCanonico('  Geral@Padaria.PT '), 'geral@padaria.pt');
  assert.equal(emailCanonico('sem-arroba'), '');
});

test('2 · o webhook do WhatsApp vira eventos legíveis (mensagem e estado)', () => {
  const ev = normalizarWhatsapp(zap('Boa tarde, quanto custa?'));
  assert.equal(ev.length, 1);
  assert.equal(ev[0].canal, 'whatsapp');
  assert.equal(ev[0].texto, 'Boa tarde, quanto custa?');
  assert.equal(ev[0].de, '351912345678');
  assert.equal(ev[0].idExterno, 'wa:wamid.ABC');

  const estados = normalizarWhatsapp({
    entry: [{ changes: [{ value: { metadata: { display_phone_number: '351300000000' },
      statuses: [{ id: 'wamid.SAIU', status: 'read', timestamp: '1761600100', recipient_id: '351912345678' }] } }] }],
  });
  assert.equal(estados.length, 1);
  assert.equal(estados[0].tipo, 'estado');
  assert.equal(estados[0].estado, 'read');
});

test('3 · um email de resposta vira um evento com remetente e texto', () => {
  const ev = normalizarEmail({ type: 'email.received', data: {
    email_id: 'em_1', from: 'ana@padaria.pt', to: ['geral@orbita.pt'], subject: 'Re: proposta',
    text: 'Podemos falar amanhã?', created_at: '2026-10-27T10:00:00.000Z',
  } });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].canal, 'email');
  assert.equal(ev[0].de, 'ana@padaria.pt');
  assert.equal(ev[0].texto, 'Podemos falar amanhã?');
});

/* ---------------- recepção ponta a ponta ---------------- */

test('4 · a resposta por WhatsApp encontra o lead pelo telefone e move o funil', async () => {
  const repo = await repoCom({ leads: [lead({ id: 'l1', name: 'Padaria Ana', phone: '+351 912 345 678' })] });
  const corpo = zap('Quanto custa o site?');
  const bruto = JSON.stringify(corpo);
  const r = await responder(repo, {
    caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto,
    headers: { 'x-hub-signature-256': assinarMeta(bruto) }, env: envMeta,
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.recebidas, 1);
  assert.equal(r.corpo.eventos[0].lead.id, 'l1');
  assert.equal(r.corpo.eventos[0].lead.status, 'respondeu');

  const msgs = await repo.mensagens.list(10);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].status, 'recebida');
  assert.equal(msgs[0].direction, 'in');
  assert.equal(msgs[0].body, 'Quanto custa o site?');
  assert.equal(msgs[0].lead_id, 'l1');

  const l = await repo.leads.byId('l1');
  assert.equal(l.status, 'respondeu');
  assert.ok(l.responded_at, 'o lead tem de ficar com a data da resposta');
});

test('5 · o mesmo evento duas vezes não duplica nada (a Meta repete quando não recebe 200)', async () => {
  const repo = await repoCom({ leads: [lead({ id: 'l1', name: 'Padaria Ana', phone: '912345678' })] });
  const corpo = zap('Já vi, obrigado.', '351912345678', { id: 'wamid.REPETE' });
  const bruto = JSON.stringify(corpo);
  const pedido = { caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto, headers: { 'x-hub-signature-256': assinarMeta(bruto) }, env: envMeta };
  const a = await responder(repo, pedido);
  const b = await responder(repo, pedido);
  assert.equal(a.corpo.recebidas, 1);
  assert.equal(b.corpo.recebidas, 0);
  assert.equal(b.corpo.duplicadas, 1);
  assert.equal((await repo.mensagens.list(10)).length, 1, 'a resposta não pode aparecer duas vezes na mesa');
});

test('6 · um email de resposta casa pelo email e não pela mensagem antiga', async () => {
  const repo = await repoCom({
    leads: [lead({ id: 'l2', name: 'Óptica Nova', email: 'geral@optica.pt' })],
    mensagens: [{ id: 'm1', lead_id: 'l2', channel: 'email', body: 'Olá', status: 'enviada', provider_id: 're_1', created_at: new Date().toISOString() }],
  });
  const corpo = { type: 'email.received', data: { email_id: 'em_9', from: 'Geral@Optica.pt', to: ['eu@orbita.pt'], subject: 'Re: Olá', text: 'Sim, quero.' } };
  const bruto = JSON.stringify(corpo);
  const r = await responder(repo, {
    caminho: '/webhooks/resend', metodo: 'POST', corpo, corpoBruto: bruto,
    headers: { 'svix-id': 'msg_1', 'svix-timestamp': '1761600000', 'svix-signature': assinarSvix('msg_1', '1761600000', bruto) },
    env: envSvix,
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.eventos[0].lead.id, 'l2');
  assert.equal((await repo.leads.byId('l2')).status, 'respondeu');
});

test('7 · quem já é cliente não volta a «respondeu» por ter respondido', async () => {
  const repo = await repoCom({ leads: [lead({ id: 'l3', name: 'Cliente Antigo', phone: '913000000', status: 'ganho' })] });
  const corpo = zap('Está tudo bem com o site.', '351913000000');
  const bruto = JSON.stringify(corpo);
  const r = await responder(repo, { caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto, headers: { 'x-hub-signature-256': assinarMeta(bruto) }, env: envMeta });
  assert.equal(r.status, 200);
  const l = await repo.leads.byId('l3');
  assert.equal(l.status, 'ganho', 'o funil não pode andar para trás');
  assert.ok(l.responded_at, 'mas a resposta fica registada');
});

test('8 · quem não está no funil também não se perde: a resposta fica sem lead', async () => {
  const repo = await repoCom({ leads: [] });
  const corpo = zap('Vi o vosso anúncio.', '351969999999');
  const bruto = JSON.stringify(corpo);
  const r = await responder(repo, { caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto, headers: { 'x-hub-signature-256': assinarMeta(bruto) }, env: envMeta });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.semLead, 1);
  const msgs = await repo.mensagens.list(10);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].lead_id, null);
  assert.equal(msgs[0].from, '351969999999');
});

test('9 · «lido» e «entregue» actualizam a mensagem que saiu, sem criar outra', async () => {
  const repo = await repoCom({
    leads: [lead({ id: 'l4', name: 'Café Central', phone: '914000000' })],
    mensagens: [{ id: 'm4', lead_id: 'l4', channel: 'whatsapp', body: 'Olá', status: 'enviada', provider_id: 'wamid.SAIU', created_at: new Date().toISOString() }],
  });
  const corpo = { entry: [{ changes: [{ value: {
    metadata: { display_phone_number: '351300000000' },
    statuses: [{ id: 'wamid.SAIU', status: 'read', timestamp: '1761600100', recipient_id: '351914000000' }],
  } }] }] };
  const bruto = JSON.stringify(corpo);
  const r = await responder(repo, { caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto, headers: { 'x-hub-signature-256': assinarMeta(bruto) }, env: envMeta });
  assert.equal(r.status, 200);
  const msgs = await repo.mensagens.list(10);
  assert.equal(msgs.length, 1, 'um estado não é uma mensagem nova');
  assert.ok(msgs[0].lido_at, 'a mensagem tem de ficar marcada como lida');
});

/* ---------------- segurança ---------------- */

test('10 · sem segredo configurado não se aceita nada (503, não 200)', async () => {
  const repo = await repoCom();
  const corpo = zap('olá');
  const bruto = JSON.stringify(corpo);
  const semSegredo = await responder(repo, { caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto, headers: { 'x-hub-signature-256': assinarMeta(bruto) }, env: { WHATSAPP_VERIFY_TOKEN: 'x' } });
  assert.equal(semSegredo.status, 503);
  assert.match(semSegredo.corpo.error, /WHATSAPP_APP_SECRET/);

  const semSvix = await responder(repo, { caminho: '/webhooks/resend', metodo: 'POST', corpo: { data: {} }, corpoBruto: '{}', headers: {}, env: {} });
  assert.equal(semSvix.status, 503);
  assert.match(semSvix.corpo.error, /RESEND_WEBHOOK_SECRET/);
});

test('11 · assinatura errada é 401 e nada é gravado', async () => {
  const repo = await repoCom({ leads: [lead({ id: 'l5', name: 'X', phone: '915000000' })] });
  const corpo = zap('resposta');
  const bruto = JSON.stringify(corpo);
  const meta = await responder(repo, { caminho: '/webhooks/whatsapp', metodo: 'POST', corpo, corpoBruto: bruto, headers: { 'x-hub-signature-256': 'sha256=00' }, env: envMeta });
  assert.equal(meta.status, 401);
  assert.equal((await repo.mensagens.list(10)).length, 0);

  const svix = await responder(repo, { caminho: '/webhooks/resend', metodo: 'POST', corpo: { data: { from: 'a@b.pt' } }, corpoBruto: '{"data":{"from":"a@b.pt"}}', headers: { 'svix-id': 'x', 'svix-timestamp': '1', 'svix-signature': 'v1,AAAA' }, env: envSvix });
  assert.equal(svix.status, 401);
});

test('12 · a verificação da Meta devolve o desafio em texto puro', async () => {
  const repo = await repoCom();
  const bom = await responder(repo, { caminho: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=a-minha-frase&hub.challenge=42', metodo: 'GET', env: envMeta });
  assert.equal(bom.status, 200);
  assert.equal(bom.corpo, '42', 'a Meta exige o número em texto puro');

  const mau = await responder(repo, { caminho: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=42', metodo: 'GET', env: envMeta });
  assert.equal(mau.status, 403);

  const semToken = await responder(repo, { caminho: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1', metodo: 'GET', env: {} });
  assert.equal(semToken.status, 501);
});

test('13 · as assinaturas calculadas pelo módulo são as mesmas dos fornecedores', () => {
  const bruto = '{"a":1}';
  assert.equal(assinaturaMeta({ segredo: CHAVE_META, corpoBase: bruto, assinatura: assinarMeta(bruto) }), true);
  assert.equal(assinaturaSvix({ segredo: CHAVE_SVIX, id: 'msg_1', timestamp: '1761600000', corpoBase: bruto, assinatura: assinarSvix('msg_1', '1761600000', bruto) }), true);
  assert.equal(assinaturaMeta({ segredo: CHAVE_META, corpoBase: bruto, assinatura: assinarMeta('outro corpo') }), false);
  assert.equal(assinaturaSvix({ segredo: CHAVE_SVIX, id: 'msg_1', timestamp: '1761600000', corpoBase: bruto, assinatura: 'v1,AAAA' }), false);
});
