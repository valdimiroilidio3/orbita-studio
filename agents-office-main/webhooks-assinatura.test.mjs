// Webhooks de entrada (WhatsApp e Resend): sem assinatura válida, nada entra.
// Antes desta versão a assinatura era exigida no texto, mas as funções que a
// verificavam não existiam — o pedido rebentava com «não é uma função».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { assinaturaMeta, assinaturaSvix } from './api/_entrada.mjs';

const CORPO = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });
const SEGREDO_META = 'segredo-da-app-meta-de-teste';
const CHAVE_SVIX = Buffer.from('chave-svix-de-teste-0123456789');
const SEGREDO_SVIX = `whsec_${CHAVE_SVIX.toString('base64')}`;

const metaSig = (corpo, segredo = SEGREDO_META) =>
  `sha256=${createHmac('sha256', segredo).update(corpo).digest('hex')}`;

function svixHeaders({ id = 'msg_1', ts = Math.floor(Date.now() / 1000), corpo = CORPO, chave = CHAVE_SVIX } = {}) {
  const sinal = createHmac('sha256', chave).update(`${id}.${ts}.${corpo}`).digest('base64');
  return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': `v1,${sinal}` };
}

const enviar = (caminho, { env, headers = {}, corpo = CORPO }) => responder(createMemRepo(), {
  caminho, metodo: 'POST', corpo: JSON.parse(corpo), corpoBruto: corpo, env, headers,
});

test('webhooks: WhatsApp com assinatura válida passa a verificação (501 explícito, nada rebenta)', async () => {
  const r = await enviar('/webhooks/whatsapp', {
    env: { WHATSAPP_APP_SECRET: SEGREDO_META },
    headers: { 'x-hub-signature-256': metaSig(CORPO) },
  });
  assert.equal(r.status, 501, JSON.stringify(r.corpo));
  assert.match(r.corpo.error, /nada foi guardado/);
});

test('webhooks: WhatsApp com assinatura errada é recusado (401)', async () => {
  const r = await enviar('/webhooks/whatsapp', {
    env: { WHATSAPP_APP_SECRET: SEGREDO_META },
    headers: { 'x-hub-signature-256': metaSig(CORPO, 'outro-segredo') },
  });
  assert.equal(r.status, 401);
});

test('webhooks: WhatsApp sem cabeçalho de assinatura é recusado (401)', async () => {
  const r = await enviar('/webhooks/whatsapp', { env: { WHATSAPP_APP_SECRET: SEGREDO_META } });
  assert.equal(r.status, 401);
});

test('webhooks: WhatsApp sem o segredo na instalação não aceita nada (503)', async () => {
  const r = await enviar('/webhooks/whatsapp', { env: {}, headers: { 'x-hub-signature-256': metaSig(CORPO) } });
  assert.equal(r.status, 503);
});

test('webhooks: Resend com assinatura Svix válida passa a verificação (501)', async () => {
  const r = await enviar('/webhooks/resend', {
    env: { RESEND_WEBHOOK_SECRET: SEGREDO_SVIX }, headers: svixHeaders(),
  });
  assert.equal(r.status, 501, JSON.stringify(r.corpo));
});

test('webhooks: Resend com timestamp antigo é recusado (repetir um pedido não passa)', async () => {
  const antigo = Math.floor(Date.now() / 1000) - 3600;
  const r = await enviar('/webhooks/resend', {
    env: { RESEND_WEBHOOK_SECRET: SEGREDO_SVIX }, headers: svixHeaders({ ts: antigo }),
  });
  assert.equal(r.status, 401);
});

test('webhooks: Resend com corpo alterado é recusado (401)', async () => {
  const r = await enviar('/webhooks/resend', {
    env: { RESEND_WEBHOOK_SECRET: SEGREDO_SVIX },
    headers: svixHeaders(),
    corpo: JSON.stringify({ type: 'email.delivered', alterado: true }),
  });
  assert.equal(r.status, 401);
});

test('webhooks: Resend sem o segredo na instalação não aceita nada (503)', async () => {
  const r = await enviar('/webhooks/resend', { env: {}, headers: svixHeaders() });
  assert.equal(r.status, 503);
});

test('assinaturaSvix: com várias assinaturas na lista, basta uma válida', () => {
  const h = svixHeaders();
  const lista = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${h['svix-signature']}`;
  assert.equal(assinaturaSvix({ segredo: SEGREDO_SVIX, id: h['svix-id'], timestamp: h['svix-timestamp'], assinatura: lista, corpoBase: CORPO }), true);
  assert.equal(assinaturaSvix({ segredo: SEGREDO_SVIX, id: h['svix-id'], timestamp: h['svix-timestamp'], assinatura: 'v2,xyz', corpoBase: CORPO }), false, 'só v1 conta');
});

test('assinaturaMeta: o formato é sha256=<hex> e a comparação é exacta', () => {
  assert.equal(assinaturaMeta({ segredo: SEGREDO_META, corpoBase: CORPO, assinatura: metaSig(CORPO) }), true);
  assert.equal(assinaturaMeta({ segredo: SEGREDO_META, corpoBase: CORPO, assinatura: metaSig(CORPO).slice(0, -1) }), false);
  assert.equal(assinaturaMeta({ segredo: '', corpoBase: CORPO, assinatura: metaSig(CORPO) }), false, 'sem segredo nunca confirma');
});
