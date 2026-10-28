// O envio a sério — 1.38.0 (27 out 2026).
//
// Pedido do dono: «mandar mensagens aos clientes tem de ser real e muito
// funcional». Isto não se prova a olhar para o código: prova-se com um `fetch`
// que se comporta como o Resend e como a Graph API do WhatsApp, e a ver o que
// ficou escrito na mensagem. As regras: nada sai sem aprovação; o email passou a
// SAIR (antes respondia «abre na app»); o WhatsApp, com as chaves, também; sem
// chave, o erro diz qual falta e a mensagem não fica «enviada».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const agora = () => new Date().toISOString();
const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = {}, fetchImpl = fetch) =>
  responder(repo, { caminho, metodo, corpo, env, fetchImpl });

const leadCom = (x = {}) => ({
  id: 'l1', dedupe_key: 'padaria|coimbra', name: 'Padaria Ana', city: 'Coimbra',
  email: 'ana@padaria.pt', phone: '+351 912 345 678', status: 'contactado',
  created_at: agora(), updated_at: agora(), ...x,
});

const msgCom = (x = {}) => ({
  id: 'm1', lead_id: 'l1', channel: 'email', subject: 'O vosso site',
  body: 'Bom dia. Falo do site da padaria.', status: 'aprovada', created_at: agora(), ...x,
});

const respostaJson = (obj, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => obj, text: async () => JSON.stringify(obj),
});

test('1 · email: sai pelo Resend, fica «enviada» com o id do fornecedor e o rasto certo', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom()] });
  const pedidos = [];
  const fetchImpl = async (url, opt) => {
    pedidos.push({ url: String(url), opt, corpo: JSON.parse(opt.body) });
    return respostaJson({ id: 're_abc123' });
  };
  const r = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 're_key', ORBITA_FROM_EMAIL: 'eu@orbita.pt' }, fetchImpl);

  assert.equal(r.status, 200);
  assert.equal(r.corpo.ok, true);
  assert.equal(r.corpo.enviada, true);
  assert.equal(r.corpo.canal, 'email');
  assert.equal(r.corpo.para, 'ana@padaria.pt');
  assert.equal(r.corpo.providerId, 're_abc123');

  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].url, 'https://api.resend.com/emails');
  assert.equal(pedidos[0].opt.method, 'POST');
  assert.match(pedidos[0].opt.headers.authorization, /^Bearer re_key/);
  assert.equal(pedidos[0].corpo.from, 'eu@orbita.pt', 'o remetente configurado tem de ser usado');
  assert.deepEqual(pedidos[0].corpo.to, ['ana@padaria.pt']);
  assert.equal(pedidos[0].corpo.subject, 'O vosso site');
  assert.match(pedidos[0].corpo.text, /site da padaria/);

  const m = (await chamar(repo, '/ops/messages')).corpo.messages.find((x) => x.id === 'm1');
  assert.equal(m.status, 'enviada');
  assert.equal(m.provider, 'resend');
  assert.equal(m.provider_id, 're_abc123');
  assert.equal(m.canal_confirmado, 'email');
  assert.ok(m.enviada_at, 'a data de envio fica registada');
  assert.equal(m.erro, null);
});

test('2 · email: o mesmo envio duas vezes é 409 e não vai um segundo email', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom()] });
  let vezes = 0;
  const fetchImpl = async () => { vezes++; return respostaJson({ id: 're_1' }); };
  await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, fetchImpl);
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, fetchImpl),
    (e) => e.status === 409 && /já foi enviada/i.test(e.message),
  );
  assert.equal(vezes, 1, 'o cliente não pode receber o mesmo email duas vezes');
});

test('3 · email sem RESEND_API_KEY: 503 com a razão, e a mensagem continua aprovada (não «falhou»)', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom()] });
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, {}),
    (e) => e.status === 503 && /RESEND_API_KEY/.test(e.message),
  );
  const m = (await chamar(repo, '/ops/messages')).corpo.messages[0];
  assert.equal(m.status, 'aprovada', 'sem chave não se marca como falhada — não se tentou nada');
});

test('4 · o fornecedor recusa (422): 502, a mensagem fica «falhou» com o motivo, e dá para repetir', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom()] });
  const recusa = async () => respostaJson({ message: 'domain is not verified' }, 422);
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, recusa),
    (e) => e.status === 502 && /domain is not verified/.test(e.message),
  );
  let m = (await chamar(repo, '/ops/messages')).corpo.messages[0];
  assert.equal(m.status, 'falhou');
  assert.match(m.erro, /not verified/);

  const bom = async () => respostaJson({ id: 're_2' });
  const r = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, bom);
  assert.equal(r.corpo.enviada, true);
  m = (await chamar(repo, '/ops/messages')).corpo.messages[0];
  assert.equal(m.status, 'enviada');
  assert.equal(m.erro, null, 'ao repetir com sucesso, o erro antigo sai');
});

test('5 · uma falha de rede não deixa a mensagem presa em «aprovada» nem inventa envio', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom()] });
  const cai = async () => { throw new Error('ECONNRESET'); };
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, cai),
    (e) => e.status === 502 && /ECONNRESET/.test(e.message),
  );
  const m = (await chamar(repo, '/ops/messages')).corpo.messages[0];
  assert.equal(m.status, 'falhou');
  assert.match(m.erro, /rede: ECONNRESET/);
  assert.equal(m.provider_id ?? null, null);
});

test('6 · WhatsApp com chaves: sai pela Graph API e devolve o id da mensagem', async () => {
  const repo = createMemRepo({
    leads: [leadCom()],
    mensagens: [msgCom({ channel: 'whatsapp', subject: null, body: 'Bom dia, falo do site.' })],
  });
  const pedidos = [];
  const fetchImpl = async (url, opt) => {
    pedidos.push({ url: String(url), corpo: JSON.parse(opt.body) });
    return respostaJson({ messages: [{ id: 'wamid.XYZ' }] });
  };
  const r = await chamar(repo, '/ops/messages/m1/enviar', 'POST', {},
    { WHATSAPP_TOKEN: 'tok', WHATSAPP_PHONE_ID: '123456' }, fetchImpl);

  assert.equal(r.corpo.canal, 'whatsapp');
  assert.equal(r.corpo.providerId, 'wamid.XYZ');
  assert.match(pedidos[0].url, /graph\.facebook\.com\/v20\.0\/123456\/messages/);
  assert.equal(pedidos[0].corpo.messaging_product, 'whatsapp');
  assert.equal(pedidos[0].corpo.to, '351912345678', 'o número vai só com dígitos');
  assert.match(pedidos[0].corpo.text.body, /falo do site/);
  const m = (await chamar(repo, '/ops/messages')).corpo.messages[0];
  assert.equal(m.status, 'enviada');
  assert.equal(m.provider, 'whatsapp-cloud');
});

test('7 · sem WHATSAPP_TOKEN ou sem PHONE_ID, o WhatsApp diz qual falta e não finge', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom({ channel: 'whatsapp' })] });
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { WHATSAPP_TOKEN: 'tok' }),
    (e) => e.status === 501 && /WHATSAPP_PHONE_ID/.test(e.message),
  );
  const m = (await chamar(repo, '/ops/messages')).corpo.messages[0];
  assert.equal(m.status, 'aprovada');
});

test('8 · o funil: aprovar e enviar por email deixa o lead «contactado»; um «respondeu» move-o', async () => {
  const repo = createMemRepo({ leads: [leadCom({ status: 'novo' })], mensagens: [msgCom()] });
  const fetchImpl = async () => respostaJson({ id: 're_9' });
  await chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, fetchImpl);
  let l = (await chamar(repo, '/ops/leads/l1')).corpo.lead;
  assert.equal(l.status, 'contactado', 'enviar não é responder: fica contactado');

  const s = await chamar(repo, '/ops/messages/m1/signal', 'POST', { kind: 'respondeu' });
  assert.equal(s.corpo.lead.status, 'respondeu');
  l = (await chamar(repo, '/ops/leads/l1')).corpo.lead;
  assert.equal(l.status, 'respondeu');
});

test('9 · sem aprovação não sai nada, e a recusa diz o que fazer', async () => {
  const repo = createMemRepo({ leads: [leadCom()], mensagens: [msgCom({ status: 'rascunho' })] });
  let vezes = 0;
  const fetchImpl = async () => { vezes++; return respostaJson({ id: 'x' }); };
  await assert.rejects(
    () => chamar(repo, '/ops/messages/m1/enviar', 'POST', {}, { RESEND_API_KEY: 'k' }, fetchImpl),
    (e) => e.status === 409 && /aprova/i.test(e.message),
  );
  assert.equal(vezes, 0);
});
