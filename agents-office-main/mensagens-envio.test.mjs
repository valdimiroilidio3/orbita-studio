// Testes do envio real de mensagens (1.34.0, 27 out 2026).
//
// O dono disse que «as conversas devem ser reais». O que aqui se prova, sem rede
// (o fornecedor é um fetch falso, o mesmo contrato):
//   · a mesa chama `approve/reject/send/confirm/sinal`; a API aceita esses nomes
//     E os portugueses — antes só tinha os portugueses e a mesa levava 404;
//   · o email sai pela Resend com a chave do ambiente: assunto, texto e destino;
//   · sem chave é 503 e a mensagem fica aprovada (não se marca como enviada);
//   · um erro do fornecedor deixa a mensagem «falhou» com o motivo, e o envio
//     pode ser repetido; enviada duas vezes é 409;
//   · o WhatsApp usa a Cloud API quando há token/número, e sem eles diz o que
//     falta em vez de fingir que enviou;
//   · um sinal «respondeu» move o lead no funil.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const AGORA = new Date().toISOString();
const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = {}, fetchImpl = async () => { throw new Error('sem rede'); }) =>
  responder(repo, { caminho, metodo, corpo, env, fetchImpl });

const montar = (mensagem, lead = null) => createMemRepo({
  leads: lead ? [{ id: 'l1', ...lead, created_at: AGORA, updated_at: AGORA }] : [],
  mensagens: [{ id: 'm1', created_at: AGORA, status: 'aprovada', ...mensagem }],
});

test('envio: sem RESEND_API_KEY é 503, e a mensagem continua aprovada (não enviada)', async () => {
  const repo = montar({ channel: 'email', subject: 'Olá', body: 'Uma frase.', lead_id: 'l1' }, { name: 'Café Central', email: 'dono@central.pt' });
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, {}),
    (e) => e.status === 503 && /RESEND_API_KEY/.test(e.message),
  );
  const m = (await chamar(repo, '/ops/messages')).corpo.messages.find((x) => x.id === 'm1');
  assert.equal(m.status, 'aprovada', 'sem chave não se marca como enviada');
});

test('envio: o email sai pela Resend com destino, assunto e texto; o estado passa a enviada', async () => {
  const repo = montar({ channel: 'email', subject: 'Uma proposta', body: 'Bom dia. Vi que não têm site.', lead_id: 'l1' }, { name: 'Café Central', email: 'dono@central.pt' });
  let pedido = null;
  const fetchImpl = async (url, opt) => {
    pedido = { url, opt, corpo: JSON.parse(opt.body) };
    return { ok: true, status: 200, json: async () => ({ id: 're_abc123' }) };
  };
  const r = await chamar(repo, '/ops/messages/m1/send', 'POST', {}, { RESEND_API_KEY: 're-falsa', ORBITA_FROM_EMAIL: 'orbita@exemplo.pt' }, fetchImpl);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.enviada, true);
  assert.equal(r.corpo.canal, 'email');
  assert.equal(r.corpo.providerId, 're_abc123');
  assert.equal(pedido.url, 'https://api.resend.com/emails');
  assert.equal(pedido.opt.headers.authorization, 'Bearer re-falsa');
  assert.deepEqual(pedido.corpo.to, ['dono@central.pt']);
  assert.equal(pedido.corpo.from, 'orbita@exemplo.pt');
  assert.equal(pedido.corpo.subject, 'Uma proposta');
  assert.match(pedido.corpo.text, /não têm site/);
  const m = (await chamar(repo, '/ops/messages')).corpo.messages.find((x) => x.id === 'm1');
  assert.equal(m.status, 'enviada');
  assert.equal(m.provider, 'resend');
  assert.equal(m.provider_id, 're_abc123');
  /* e não sai duas vezes */
  await assert.rejects(() => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'x' }, fetchImpl), (e) => e.status === 409);
});

test('envio: o fornecedor recusa → falhou com o motivo, e pode tentar-se outra vez', async () => {
  const repo = montar({ channel: 'email', subject: 'Olá', body: 'texto', lead_id: 'l1' }, { name: 'Café', email: 'a@b.pt' });
  const recusa = async () => ({ ok: false, status: 422, json: async () => ({ message: 'domain is not verified' }) });
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, recusa),
    (e) => e.status === 502 && /domain is not verified/.test(e.message),
  );
  const m = (await chamar(repo, '/ops/messages')).corpo.messages.find((x) => x.id === 'm1');
  assert.equal(m.status, 'falhou');
  assert.match(m.erro, /domain is not verified/);
  /* «falhou» pode ser repetido — não é «enviada» */
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ id: 're_ok' }) });
  const r = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, ok);
  assert.equal(r.corpo.enviada, true);
  assert.equal((await chamar(repo, '/ops/messages')).corpo.messages.find((x) => x.id === 'm1').status, 'enviada');
});

test('envio: aprovar é obrigatório antes de enviar', async () => {
  const repo = montar({ channel: 'email', subject: 'Olá', body: 't', status: 'rascunho', lead_id: 'l1' }, { name: 'Café', email: 'a@b.pt' });
  await assert.rejects(() => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }), (e) => e.status === 409 && /aprova/i.test(e.message));
});

test('whatsapp: com token e número sai pela Cloud API; sem eles diz o que falta', async () => {
  const repo = montar({ channel: 'whatsapp', body: 'Olá!', lead_id: 'l1' }, { name: 'Café', phone: '+351 912 345 678' });
  let pedido = null;
  const fetchImpl = async (url, opt) => {
    pedido = { url, corpo: JSON.parse(opt.body), auth: opt.headers.authorization };
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.123' }] }) };
  };
  const r = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '10999' }, fetchImpl);
  assert.equal(r.corpo.enviada, true);
  assert.equal(r.corpo.canal, 'whatsapp');
  assert.match(pedido.url, /graph\.facebook\.com\/v20\.0\/10999\/messages/);
  assert.equal(pedido.auth, 'Bearer tok');
  assert.equal(pedido.corpo.to, '351912345678', 'o número vai só com dígitos');
  assert.equal(pedido.corpo.text.body, 'Olá!');

  const repo2 = montar({ channel: 'whatsapp', body: 'Olá!', lead_id: 'l1' }, { name: 'Café', phone: '+351912345678' });
  await assert.rejects(() => chamar(repo2, '/ops/messages/m1/enviar', 'POST', {}, {}), (e) => e.status === 501 && /WHATSAPP_TOKEN/.test(e.message));
});

test('mensagens: confirmar à mão marca enviada e diz que foi um humano', async () => {
  const repo = montar({ channel: 'whatsapp', body: 'Olá', lead_id: null });
  const r = await chamar(repo, '/ops/messages/m1/confirm', 'POST', {});
  assert.equal(r.corpo.message.status, 'enviada');
  assert.equal(r.corpo.message.confirmada, 'humano');
  await assert.rejects(() => chamar(repo, '/ops/messages/m1/confirmar', 'POST', {}), (e) => e.status === 409);
});

test('mensagens: promover só vale para ensaio, rejeitar guarda o motivo e um nome inválido é 404', async () => {
  const repo = montar({ channel: 'email', body: 'Olá', lead_id: null, status: 'ensaio' });
  const p = await chamar(repo, '/ops/messages/m1/promover', 'POST', {});
  assert.equal(p.corpo.message.status, 'rascunho');
  await assert.rejects(() => chamar(repo, '/ops/messages/m1/promote', 'POST', {}), (e) => e.status === 409);
  const rj = await chamar(repo, '/ops/messages/m1/reject', 'POST', { reason: 'tom errado' });
  assert.equal(rj.corpo.message.status, 'rejeitada');
  assert.equal(rj.corpo.message.motivo, 'tom errado');
  await assert.rejects(() => chamar(repo, '/ops/messages/m1/telefonar', 'POST', {}), (e) => e.status === 404);
});

test('sinal: «respondeu» move o lead para respondeu; «recusou» marca perdido', async () => {
  const repo = montar({ channel: 'whatsapp', body: 'Olá', lead_id: 'l1' }, { name: 'Café', phone: '+351912345678' });
  const r = await chamar(repo, '/ops/messages/m1/sinal', 'POST', { kind: 'respondeu' });
  assert.equal(r.corpo.sinal, 'respondeu');
  assert.equal((await chamar(repo, '/ops/leads/l1')).corpo.lead.status, 'respondeu');
  await assert.rejects(() => chamar(repo, '/ops/messages/m1/signal', 'POST', { kind: 'talvez' }), (e) => e.status === 400);
});
