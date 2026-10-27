// Testes dos artefactos e da digitalização (1.31.0, 27 out 2026).
//
// O que se prova aqui, sem rede e sem chaves a sério:
//   · um site nasce rascunho e só fica aprovado com OK explícito e assinado;
//   · o HTML escapa o que vem do brief e não inventa contactos que ninguém deu;
//   · o mesmo brief dá o mesmo site (guardar o brief chega — não há duas verdades);
//   · rascunhos persistem em `orbita_ai_memoria` (base) ou em `data/artefactos`;
//   · a digitalização lê por um OCR configurado, extrai com regras e diz o que faltou;
//   · NIF só passa com dígito de controlo; IBAN sai mascarado; sem OCR diz o que falta;
//   · as quatro ferramentas novas chegam aos agentes pelo MCP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  PALETAS, construirSite, criarSite, listar, obter, publicar, preview, reiniciar, urlSegura, validarBrief,
} from './api/_artefactos.mjs';
import { digitalizar, estado, extrairCampos, nifValido, paraLead } from './api/_digitalizar.mjs';
import { responder } from './api/_rotas.mjs';
import { createMemRepo } from './api/_repo.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

const BRIEF = {
  nome: 'Clínica do Mondego',
  atividade: 'clínica dentária',
  cidade: 'Coimbra',
  telefone: '+351 239 000 000',
  email: 'ola@mondego.pt',
  website: 'mondego.pt',
  morada: 'Rua Larga 3, 3000-123 Coimbra',
  servicos: ['Consultas de rotina', 'Ortodontia'],
  sobre: 'Abrimos em 2014 e atendemos por marcação.',
};

const limpar = () => { reiniciar(); delete process.env.ORBITA_DATA_DIR; };

/* ---------- 1 · validar o brief ---------- */

test('brief: sem nome não há site; contactos malformados são recusados', () => {
  assert.match(validarBrief({}).erro, /nome/);
  assert.match(validarBrief({ nome: 'A' }).erro, /nome/);
  assert.match(validarBrief({ nome: 'Casa', telefone: 'abc' }).erro, /telefone/);
  assert.match(validarBrief({ nome: 'Casa', email: 'nao-e-email' }).erro, /email/);
  assert.match(validarBrief({ nome: 'Casa', website: 'javascript:alert(1)' }).erro, /http/);
  assert.match(validarBrief({ nome: 'Casa', servicos: Array(7).fill('x') }).erro, /serviços/);
  const ok = validarBrief(BRIEF);
  assert.ok(ok.valor);
  assert.equal(ok.valor.telefone, '+351239000000', 'o telefone é normalizado, não inventado');
  assert.equal(ok.valor.website, 'https://mondego.pt/', 'sem esquema, assume https');
  assert.equal(ok.valor.paleta, 'grafite');
});

test('urlSegura: só http(s) com um domínio', () => {
  assert.equal(urlSegura('javascript:alert(1)'), null);
  assert.equal(urlSegura('data:text/html,x'), null);
  assert.equal(urlSegura('sem-ponto'), null);
  assert.equal(urlSegura('exemplo.pt'), 'https://exemplo.pt/');
  assert.equal(urlSegura('http://exemplo.pt/a?b=1'), 'http://exemplo.pt/a?b=1');
});

/* ---------- 2 · o site ---------- */

test('site: gera HTML e CSS válidos a partir do brief', () => {
  const bruto = validarBrief(BRIEF).valor;
  const s = construirSite(bruto);
  const html = s.ficheiros['index.html'];
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="pt-PT">/);
  assert.match(html, /<title>Clínica do Mondego — clínica dentária · Coimbra<\/title>/);
  assert.match(html, /href="tel:\+351239000000"/);
  assert.match(html, /mailto:ola@mondego\.pt/);
  assert.match(html, /Ortodontia/);
  assert.match(html, /<link rel="stylesheet" href="estilo\.css">/);
  assert.equal(/<script/i.test(html), false, 'o site não leva scripts');
  assert.equal(/https?:\/\/(cdn|fonts|unpkg)/i.test(html + s.ficheiros['estilo.css']), false, 'sem dependências externas');
  assert.ok(s.ficheiros['estilo.css'].includes(PALETAS.grafite.acento));
  assert.ok(s.ficheiros['LEIA-ME.md'].includes('Clínica do Mondego'));
  assert.equal(s.inferido.length, 2, 'título e chamada são escrita da casa; o «sobre» veio do brief');
  assert.ok(s.real.includes('telefone'));
});

test('site: escapa o brief e não inventa contactos que ninguém deu', () => {
  const bruto = validarBrief({ nome: '<script>alert(1)</script>', servicos: ['A & B'] }).valor;
  const s = construirSite(bruto);
  const html = s.ficheiros['index.html'];
  assert.equal(/<script>alert/.test(html), false, 'o nome não entra como HTML');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.equal(/tel:/.test(html), false, 'sem telefone não há botão de telefonar');
  assert.match(html, /Os contactos ainda não estão confirmados/);
});

test('site: o mesmo brief dá exactamente o mesmo site', () => {
  const bruto = validarBrief(BRIEF).valor;
  const a = construirSite(bruto, { ano: 2026 });
  const b = construirSite(bruto, { ano: 2026 });
  assert.deepEqual(a.ficheiros, b.ficheiros);
});

/* ---------- 3 · criar, ver, aprovar ---------- */

test('criar: nasce rascunho e guarda o brief (não o HTML)', async () => {
  limpar();
  const repo = createMemRepo();
  const r = await criarSite(BRIEF, { repo });
  assert.equal(r.ok, true);
  assert.equal(r.artefacto.estado, 'rascunho');
  assert.equal(r.artefacto.id, 'clinica-do-mondego-jd7n', 'id estável: o mesmo nome dá o mesmo id');
  assert.equal(r.guardado, 'base');
  assert.match(r.nota, /não está publicado/);
  assert.ok(r.ficheiros['index.html'].length > 500);
  assert.equal(repo._dados.iaMemoria.length, 1);
  const nota = repo._dados.iaMemoria[0];
  assert.equal(nota.projeto, 'artefactos');
  assert.equal(nota.titulo, `site:${r.artefacto.id}`);
  assert.equal(nota.texto.includes('<html'), false, 'guarda-se o brief, não o HTML');
  assert.equal(repo._dados.atividade.some((a) => /criado em rascunho/.test(a.texto)), true);
});

test('criar: sem base, o rascunho fica em data/artefactos e sobrevive', async () => {
  limpar();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-art-'));
  process.env.ORBITA_DATA_DIR = dir;
  try {
    const r = await criarSite(BRIEF, { repo: null });
    assert.equal(r.guardado, 'ficheiro');
    const f = path.join(dir, 'artefactos', `${r.artefacto.id}.json`);
    assert.equal(fs.existsSync(f), true);
    reiniciar();                       // processo novo: memória vazia
    const deNovo = await obter(r.artefacto.id, { repo: null });
    assert.ok(deNovo, 'o rascunho tem de ser encontrado em disco');
    assert.equal(deNovo.brief.nome, BRIEF.nome);
    const lista = await listar({ repo: null });
    assert.equal(lista.length, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('preview: devolve as páginas a partir do brief guardado', async () => {
  limpar();
  const repo = createMemRepo();
  const r = await criarSite(BRIEF, { repo });
  const p = await preview(r.artefacto.id, { repo });
  assert.ok(p);
  assert.equal(p.estado, 'rascunho');
  assert.match(p['index.html'], /Clínica do Mondego/);
  assert.ok(p['estilo.css'].length > 100);
  assert.equal(await preview('nao-existe', { repo }), null);
});

test('publicar: exige OK explícito, assinado, e pelo menos um contacto', async () => {
  limpar();
  const repo = createMemRepo();
  const semContactos = await criarSite({ nome: 'Casa Sem Nada' }, { repo });

  const a = await publicar(semContactos.artefacto.id, { repo });
  assert.equal(a.codigo, 'aprovacao', 'sem `aprovado: true` não passa');

  const b = await publicar(semContactos.artefacto.id, { repo, aprovado: true });
  assert.equal(b.codigo, 'aprovacao', 'aprovação anónima não passa');

  const c = await publicar(semContactos.artefacto.id, { repo, aprovado: true, por: 'Dono' });
  assert.equal(c.codigo, 'sem-contactos');

  const bom = await criarSite(BRIEF, { repo });
  const d = await publicar(bom.artefacto.id, { repo, aprovado: true, por: 'Dono' });
  assert.equal(d.ok, true);
  assert.equal(d.artefacto.estado, 'aprovado');
  assert.equal(d.artefacto.aprovadoPor, 'Dono');
  assert.ok(d.artefacto.publicadoEm);
  assert.equal(repo._dados.atividade.some((x) => /aprovado por Dono/.test(x.texto)), true);

  const e = await publicar('nao-existe', { repo, aprovado: true, por: 'Dono' });
  assert.equal(e.codigo, 'nao-existe');
});

/* ---------- 4 · as rotas ---------- */

const chamar = (repo, caminho, metodo = 'GET', corpo = null, extra = {}) =>
  responder(repo, { caminho, metodo, corpo, env: {}, ...extra });

test('rotas: criar, listar, ver, aprovar — com os códigos certos', async () => {
  limpar();
  const repo = createMemRepo();
  const criado = await chamar(repo, '/artefactos/site', 'POST', BRIEF);
  assert.equal(criado.status, 201);
  const id = criado.corpo.artefacto.id;

  const lista = await chamar(repo, '/artefactos');
  assert.equal(lista.status, 200);
  assert.equal(lista.corpo.total, 1);

  const ver = await chamar(repo, `/artefactos/${id}`);
  assert.equal(ver.status, 200);
  assert.equal(ver.corpo.artefacto.brief.nome, BRIEF.nome);

  const p = await chamar(repo, `/artefactos/${id}/preview`);
  assert.equal(p.status, 200);
  assert.match(p.corpo['index.html'], /Mondego/);

  const semOk = await chamar(repo, `/artefactos/${id}/publicar`, 'POST', {});
  assert.equal(semOk.status, 409);

  const ok = await chamar(repo, `/artefactos/${id}/publicar`, 'POST', { aprovado: true, por: 'Dono' });
  assert.equal(ok.status, 200);
  assert.equal(ok.corpo.artefacto.estado, 'aprovado');

  assert.equal((await chamar(repo, '/artefactos/nao-existe')).status, 404);
  assert.equal((await chamar(repo, '/artefactos/site', 'POST', {})).status, 400);
});

/* ---------- 5 · digitalizar ---------- */

test('digitalizar: sem OCR configurado diz o que falta (nunca inventa texto)', async () => {
  const r = await digitalizar({ imagem: 'iVBORw0KGgo=' }, { env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'semchave');
  assert.match(r.erro, /ORBITA_OCR_URL/);
  assert.deepEqual(r.campos, []);
  const e = estado({});
  assert.equal(e.ocr.disponivel, false);
  assert.equal(e.regras.precisaDe.includes('nada'), true);
});

test('digitalizar: valida tamanho, formato e base64 antes de gastar um pedido', async () => {
  let pediu = 0;
  const fetchImpl = async () => { pediu += 1; return { ok: true, status: 200, json: async () => ({ texto: 'x' }) }; };
  const env = { ORBITA_OCR_URL: 'http://ocr.local' };
  assert.equal((await digitalizar({}, { env })).codigo, 'parametros');
  assert.equal((await digitalizar({ imagem: 'não é base64!!' }, { env })).codigo, 'parametros');
  assert.equal((await digitalizar({ imagem: 'iVBORw0KGgo=', mime: 'text/plain' }, { env })).codigo, 'parametros');
  assert.equal((await digitalizar({ imagem: 'iVBORw0KGgo=', mime: 'image/gif' }, { env })).codigo, 'parametros');
  const grande = 'A'.repeat(9 * 1024 * 1024);
  assert.match((await digitalizar({ imagem: grande, mime: 'image/jpeg' }, { env })).erro, /6 MB/);
  assert.equal((await digitalizar({ url: 'ftp://x/y.png' }, { env })).codigo, 'parametros');
  assert.equal(pediu, 0, 'nenhum destes chegou a bater no OCR');
});

test('digitalizar: lê por HTTP, extrai campos reais e diz o que faltou', async () => {
  const texto = [
    'Clínica do Mondego Lda',
    'NIF 123456789',
    'Telefone 239 000 000',
    'Email geral@mondego.pt',
    'Rua Larga 3, 3000-123 Coimbra',
    'Total 145,50 €',
    'IBAN PT50 0002 0123 1234 5678 9015 4',
  ].join('\n');
  const pedidos = [];
  const srv = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      pedidos.push(JSON.parse(corpo));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ texto, confianca: 0.93 }));
    });
  });
  const porta = await new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)));
  try {
    const env = { ORBITA_OCR_URL: `http://127.0.0.1:${porta}/ocr` };
    const r = await digitalizar({ imagem: 'iVBORw0KGgoAAAANSUhEUg==', mime: 'image/jpeg' }, { env });
    assert.equal(r.ok, true);
    assert.equal(r.real, true);
    assert.equal(pagamentos(pedidos), 1);
    assert.equal(pedidos[0].imagem.mime, 'image/jpeg');
    const campo = (n) => r.campos.find((c) => c.campo === n)?.valor || null;
    assert.equal(campo('nif'), '123456789');
    assert.equal(campo('telefone'), '+351239000000');
    assert.equal(campo('email'), 'geral@mondego.pt');
    assert.equal(campo('codigo_postal'), '3000-123');
    assert.equal(campo('valor'), '145.50');
    assert.match(campo('iban'), /^PT50 0002 •••• 0154$/);
    assert.equal(r.revisao, 'pendente');
    assert.equal(r.faltam.includes('nome'), false);
  } finally { srv.close(); }
});

function pagamentos(pedidos) { return pedidos.length; }

test('digitalizar: OCR vazio e falha do serviço têm respostas distintas', async () => {
  const vazio = await digitalizar({ imagem: 'iVBORw0KGgo=' }, {
    env: { ORBITA_OCR_URL: 'http://ocr.local' },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ texto: '   ' }) }),
  });
  assert.equal(vazio.codigo, 'vazio');

  const avaria = await digitalizar({ imagem: 'iVBORw0KGgo=' }, {
    env: { ORBITA_OCR_URL: 'http://ocr.local' },
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
  });
  assert.equal(avaria.codigo, 'falha');
  assert.match(avaria.erro, /503/);
});

test('regras: NIF com dígito de controlo, IBAN mascarado, nada inventado', () => {
  assert.equal(nifValido('123456789'), true);
  assert.equal(nifValido('123456788'), false);
  assert.equal(nifValido('000000000'), false);
  const campos = extrairCampos('Sem dados nenhuns aqui.');
  assert.deepEqual(campos, [], 'texto sem dados não produz campos');
  const c = extrairCampos('NIF 123456788\nTelefone 912 345 678');
  assert.equal(c.some((x) => x.campo === 'nif'), false, 'NIF inválido não entra');
  assert.equal(c.find((x) => x.campo === 'telefone').valor, '+351912345678');
});

test('paraLead: propõe, não grava; sem nome diz o que falta', () => {
  const ok = paraLead([
    { campo: 'nome', valor: 'Clínica do Mondego' },
    { campo: 'telefone', valor: '+351239000000' },
    { campo: 'nif', valor: '123456789' },
  ]);
  assert.equal(ok.pronto, true);
  assert.equal(ok.lead.name, 'Clínica do Mondego');
  assert.match(ok.lead.notes, /NIF 123456789/);
  assert.equal(ok.lead.website, undefined, 'não se inventa site');

  const semNome = paraLead([{ campo: 'telefone', valor: '+351239000000' }]);
  assert.equal(semNome.pronto, false);
  assert.match(semNome.aviso, /nome/);
});

test('rotas: /digitalizar/lead devolve a proposta e não escreve no funil', async () => {
  const repo = createMemRepo();
  const r = await chamar(repo, '/digitalizar/lead', 'POST', {
    campos: [{ campo: 'nome', valor: 'Clínica do Mondego' }, { campo: 'email', valor: 'ola@mondego.pt' }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.pronto, true);
  assert.match(r.corpo.nota, /POST \/ops\/leads/);
  assert.equal(repo._dados.leads.length, 0);
  assert.equal((await chamar(repo, '/digitalizar/lead', 'POST', {})).status, 400);
  const semChave = await chamar(repo, '/digitalizar', 'POST', { imagem: 'iVBORw0KGgo=' });
  assert.equal(semChave.status, 503);
  assert.equal((await chamar(repo, '/digitalizar/estado')).status, 200);
});

/* ---------- 6 · as salas vêem as ferramentas (MCP) ---------- */

function mcp(env, pedidos) {
  return new Promise((ok, falha) => {
    const p = spawn(process.execPath, [path.join(AQUI, 'mcp-servers/orbita-integrations/index.mjs')], {
      cwd: AQUI, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let saida = '';
    let erros = '';
    const t = setTimeout(() => { p.kill(); falha(new Error('o MCP não respondeu: ' + erros)); }, 15000);
    p.stdout.on('data', (d) => {
      saida += d;
      const linhas = saida.split('\n').filter(Boolean);
      if (linhas.length >= pedidos.length) {
        clearTimeout(t); p.kill();
        ok(linhas.slice(0, pedidos.length).map((l) => JSON.parse(l)));
      }
    });
    p.stderr.on('data', (d) => { erros += d; });
    p.on('error', falha);
    for (const msg of pedidos) p.stdin.write(JSON.stringify(msg) + '\n');
  });
}

test('agentes: o MCP expõe criar site, listar, publicar e digitalizar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-mcp-art-'));
  try {
    const [lista, criado, publicado] = await mcp({ ORBITA_DATA_DIR: dir }, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'orbita_site_create', arguments: { nome: 'Estúdio Aurora', atividade: 'fotografia', cidade: 'Coimbra', email: 'ola@aurora.pt' } } },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'orbita_site_publicar', arguments: { id: 'estudio-aurora-0xyz', approved: true, aprovadoPor: 'Dono' } } },
    ]);
    const nomes = lista.result.tools.map((t) => t.name);
    for (const n of ['orbita_site_create', 'orbita_site_list', 'orbita_site_publicar', 'orbita_digitalizar']) {
      assert.ok(nomes.includes(n), `falta ${n}`);
    }
    assert.equal(nomes.length, 22);

    const c = JSON.parse(criado.result.content[0].text);
    assert.equal(c.ok, true);
    assert.equal(c.artefacto.estado, 'rascunho');
    assert.match(c.ficheiros['index.html'], /Estúdio Aurora/);
    assert.equal(c.guardado, 'ficheiro');

    const p = JSON.parse(publicado.result.content[0].text);
    assert.equal(p.ok, false);
    assert.equal(p.codigo, 'nao-existe', 'um id que não existe não é aprovado por engano');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('agentes: sem OCR, digitalizar responde com a razão', async () => {
  const [, r] = await mcp({ ORBITA_OCR_URL: '' }, [
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'orbita_digitalizar', arguments: { imagem: 'iVBORw0KGgo=' } } },
  ]);
  const corpo = JSON.parse(r.result.content[0].text);
  assert.equal(corpo.ok, false);
  assert.equal(corpo.codigo, 'semchave');
  assert.match(corpo.erro, /ORBITA_OCR_URL/);
});
