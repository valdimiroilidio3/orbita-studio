// SSRF: o servidor não lê a rede interna por intermédio de um endereço escrito
// por uma pessoa. Estes testes não tocam na rede: o DNS é injetado.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { destinoSeguro, buscarSeguro, ipPrivado } from './api/_rede-segura.mjs';

const publico = async () => ['93.184.216.34'];

test('rede: endereços privados, reservados e de loopback são recusados (IPv4)', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.9', '203.0.113.7']) {
    assert.equal(ipPrivado(ip), true, `${ip} devia ser recusado`);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1']) {
    assert.equal(ipPrivado(ip), false, `${ip} é público e devia passar`);
  }
});

test('rede: IPv6 privado e IPv4 embebido em IPv6 são recusados', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.1.2.3', '64:ff9b::8.8.8.8', '2001:db8::1']) {
    assert.equal(ipPrivado(ip), true, `${ip} devia ser recusado`);
  }
  assert.equal(ipPrivado('2001:4860:4860::8888'), false);
  assert.equal(ipPrivado('::ffff:8.8.8.8'), false);
});

test('rede: um URL para o próprio servidor ou para a rede interna não se lê', async () => {
  const maus = [
    'http://localhost:4520/api/empresa',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/admin',
    'http://[::1]/',
    'http://[fd00::5]/',
    'http://intranet.local/',
    'http://servidor/',
    'file:///etc/passwd',
    'ftp://exemplo.pt/',
    'https://utilizador:senha@exemplo.pt/',
  ];
  for (const u of maus) {
    const r = await destinoSeguro(u, { resolver: publico });
    assert.equal(r.ok, false, `${u} devia ser recusado`);
  }
});

test('rede: um domínio público que aponta para a rede privada é recusado', async () => {
  const r = await destinoSeguro('https://clinica.exemplo.pt', { resolver: async () => ['93.184.216.34', '10.0.0.7'] });
  assert.equal(r.ok, false, 'basta um endereço privado na resposta do DNS');
  assert.match(r.motivo, /privado/);
});

test('rede: um domínio público normal passa, e o nome sem esquema assume https', async () => {
  const r = await destinoSeguro('clinica.exemplo.pt/contactos', { resolver: publico });
  assert.equal(r.ok, true);
  assert.equal(r.url.protocol, 'https:');
  assert.equal(r.url.hostname, 'clinica.exemplo.pt');
});

test('rede: um domínio que não resolve diz porquê, sem lançar', async () => {
  const r = await destinoSeguro('https://nao-existe.exemplo.pt', { resolver: async () => { throw new Error('ENOTFOUND'); } });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /não resolve/);
});

test('rede: um redireccionamento para a rede interna é seguido à mão e bloqueado', async () => {
  const pedidos = [];
  const fetchImpl = async (url) => {
    pedidos.push(url);
    if (url.startsWith('https://site.exemplo.pt')) {
      return { status: 302, ok: false, headers: new Map([['location', 'http://169.254.169.254/latest/']]) };
    }
    return { status: 200, ok: true, headers: new Map() };
  };
  await assert.rejects(
    () => buscarSeguro('https://site.exemplo.pt/', { fetchImpl, resolver: publico }),
    (e) => e.bloqueado === true && /privado|privada/.test(e.motivo),
  );
  assert.deepEqual(pedidos, ['https://site.exemplo.pt/'], 'o salto para a rede interna nem chega a ser pedido');
});

test('rede: um redireccionamento entre sítios públicos continua até à página', async () => {
  const fetchImpl = async (url) => (url === 'https://a.exemplo.pt/'
    ? { status: 301, ok: false, headers: new Map([['location', '/nova']]) }
    : { status: 200, ok: true, headers: new Map() });
  const r = await buscarSeguro('https://a.exemplo.pt/', { fetchImpl, resolver: publico });
  assert.equal(r.status, 200);
});

test('rede: um ciclo de redireccionamentos para numa paragem de segurança', async () => {
  const fetchImpl = async () => ({ status: 302, ok: false, headers: new Map([['location', 'https://a.exemplo.pt/x']]) });
  await assert.rejects(
    () => buscarSeguro('https://a.exemplo.pt/', { fetchImpl, resolver: publico }),
    (e) => e.bloqueado === true && /redireccionamentos/.test(e.motivo),
  );
});

test('rede: a verificação de um lead não pede a rede interna (e diz porquê)', async () => {
  const { responder } = await import('./api/_rotas.mjs');
  const { createMemRepo } = await import('./api/_repo.mjs');
  const repo = createMemRepo();
  const [lead] = await repo.leads.inserir([{
    dedupe_key: 'x|coimbra', name: 'Clínica X', city: 'Coimbra', status: 'novo',
    source: 'manual', notes: null, website: 'http://169.254.169.254/latest/meta-data/',
  }]);
  let pedidos = 0;
  const fetchImpl = async () => { pedidos += 1; return { ok: true, status: 200, url: 'x', text: async () => '<html>' }; };
  const r = await responder(repo, {
    caminho: `/ops/leads/${lead.id}/verificar`, metodo: 'POST', corpo: null, env: {},
    fetchImpl, resolverDestino: publico,
  });
  assert.equal(pedidos, 0, 'o servidor não pode pedir o endereço de metadados');
  assert.equal(r.corpo.lead.website_estado, 'falhou');
  assert.match(r.corpo.lead.website_motivo, /não lido/);
});

test('rede: ler um documento por URL recusa a rede interna antes de pedir', async () => {
  const { digitalizar } = await import('./api/_digitalizar.mjs');
  let pedidos = 0;
  const fetchImpl = async () => { pedidos += 1; return { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(4) }; };
  const r = await digitalizar({ url: 'http://10.0.0.5/fatura.pdf' }, { env: {}, fetchImpl, resolverDestino: publico });
  assert.equal(pedidos, 0, 'nenhum pedido pode sair para a rede interna');
  assert.equal(r.ok, false);
  assert.match(String(r.erro || ''), /privado|privada/);
});

test('artefactos: um id com barras ou «..» nunca chega ao disco', async () => {
  const { obter } = await import('./api/_artefactos.mjs');
  for (const id of ['../../package', '..%2Fpackage', 'a/b', '..', '']) {
    const r = await obter(id, { repo: null });
    assert.equal(r ?? null, null, `o id «${id}» não devia abrir nada`);
  }
});

test('cabeçalhos: o site responde com HSTS e enquadramento só da própria origem', async () => {
  const fs = await import('node:fs');
  const v = JSON.parse(fs.readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  const bloco = v.headers.find((h) => h.source === '/(.*)');
  const por = Object.fromEntries(bloco.headers.map((h) => [h.key, h.value]));
  assert.match(por['Strict-Transport-Security'] || '', /max-age=\d{7,}/, 'HSTS com max-age de pelo menos ~4 meses');
  assert.equal(por['X-Frame-Options'], 'SAMEORIGIN');
});
