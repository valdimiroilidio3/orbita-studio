// Testes do CRM dos leads — 1.59.0 (2 nov 2026).
//
// O dono pediu que os leads deixassem de ser uma lista e passassem a ser um
// funil comercial: dados verificáveis, fonte e confiança, duplicados detetados,
// qualificação, próxima ação e exportação. As contas que decidem isso vivem em
// `src/crm.js`, puras — sem DOM, sem rede, sem base de dados — e é por isso que
// se provam aqui:
//
//   · sem site verificado e datado NÃO se escreve «verificado»;
//   · um lead com um nome só não tem confiança alta, e as razões dizem porquê;
//   · os duplicados mostram-se mas NUNCA se fundem — quem decide é uma pessoa;
//   · a próxima ação atrasada diz há quantos dias, e sem data não inventa uma;
//   · a qualificação diz de onde veio o número (à mão, da nota, ou nenhum);
//   · o CSV abre no Excel em português: `;`, BOM, CRLF, aspas e acentos.
//
//   node --test crm.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  confianca, verificacao, duplicados, proximaAccao, qualificacao,
  resumoDoFunil, csvDeLeads, campoCSV, nomeDoFicheiro, fraseDaCarteira,
  telefoneCurto, dominioDe, diasDesde, FASES, NIVEIS, ESTADOS_SITE,
} from './src/crm.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const AGORA = Date.parse('2026-11-02T10:00:00Z');
const DIA = 24 * 3600 * 1000;

const LEAD = {
  id: 'l1', name: 'Clínica do Mondego', category: 'saúde', city: 'Coimbra',
  phone: '+351 239 000 111', email: 'geral@clinicadomondego.pt',
  website: 'https://www.clinicadomondego.pt/contactos',
  website_estado: 'ok', website_verificado_em: new Date(AGORA - 2 * DIA).toISOString(),
  website_motivo: 'HTTP 200', source: 'pesquisa', fonte_url: 'https://exemplo.pt/lista',
  status: 'contactado', score: 61,
};

/* ---------- 1. o telefone e o domínio, sem invenções ---------- */

test('1 · o telefone reduz-se aos 9 dígitos e o domínio perde `www.` e caminho', () => {
  assert.equal(telefoneCurto('+351 239 000 111'), '239000111');
  assert.equal(telefoneCurto('00351 912 345 678'), '912345678');
  assert.equal(telefoneCurto('12345'), '12345', 'um número curto não é esticado');
  assert.equal(telefoneCurto(null), '');
  assert.equal(dominioDe('https://www.ClinicaDoMondego.pt/contactos?a=1'), 'clinicadomondego.pt');
  assert.equal(dominioDe('clinicadomondego.pt'), 'clinicadomondego.pt');
  assert.equal(dominioDe(''), '');
  assert.equal(dominioDe('::::'), '', 'lixo não vira domínio');
});

test('2 · `diasDesde` conta dias e diz `null` quando não sabe', () => {
  assert.equal(diasDesde(new Date(AGORA - 3 * DIA).toISOString(), AGORA), 3);
  assert.equal(diasDesde(null, AGORA), null);
  assert.equal(diasDesde('ontem', AGORA), null, 'uma data que não se lê não é uma data');
  assert.equal(diasDesde(new Date(AGORA + 5 * DIA).toISOString(), AGORA), 0, 'o futuro não dá dias negativos');
});

/* ---------- 3. o site: sem data, nada de «verificado» ---------- */

test('3 · sem site guardado, a verificação di-lo — e não afirma nada', () => {
  const v = verificacao({ id: 'x' }, { agora: AGORA });
  assert.equal(v.estado, 'sem_site');
  assert.equal(v.quando, null);
  assert.match(v.motivo, /não tem site/);
});

test('4 · site guardado e nunca verificado NÃO é «verificado»', () => {
  const v = verificacao({ id: 'x', website: 'exemplo.pt' }, { agora: AGORA });
  assert.equal(v.estado, 'por_verificar');
  assert.equal(v.quando, null);
  assert.match(v.motivo, /nunca foi verificado/);
  assert.notEqual(v.rotulo, ESTADOS_SITE.ok.rotulo);
});

test('5 · verificado ontem é `ok`; verificado há mais de 180 dias é «antiga»', () => {
  const ontem = verificacao({ website: 'a.pt', website_estado: 'ok', website_verificado_em: new Date(AGORA - DIA).toISOString() }, { agora: AGORA });
  assert.equal(ontem.estado, 'ok');
  assert.equal(ontem.dias, 1);
  assert.equal(ontem.motivo, 'o site respondeu', 'sem motivo guardado, diz o mínimo — não inventa um código');

  const velha = verificacao({ website: 'a.pt', website_estado: 'ok', website_verificado_em: new Date(AGORA - 200 * DIA).toISOString() }, { agora: AGORA });
  assert.equal(velha.estado, 'antiga');
  assert.match(velha.motivo, /200 dias/);
});

test('6 · verificação falhada mantém o motivo real e não se disfarça de ok', () => {
  const v = verificacao({ website: 'a.pt', website_estado: 'falhou', website_verificado_em: new Date(AGORA - DIA).toISOString(), website_motivo: 'HTTP 404' }, { agora: AGORA });
  assert.equal(v.estado, 'falhou');
  assert.equal(v.motivo, 'HTTP 404');
  assert.equal(v.cor, ESTADOS_SITE.falhou.cor);
});

/* ---------- 7. a confiança e as suas razões ---------- */

test('7 · o lead completo tem confiança alta, e as razões somam os pontos dados', () => {
  const c = confianca(LEAD, { agora: AGORA });
  assert.equal(c.pontos, 95); // 40 site + 25 telefone + 15 email + 10 fonte + 5 url
  assert.equal(c.nivel, 'alta');
  assert.equal(c.rotulo, NIVEIS.alta.rotulo);
  assert.equal(c.razoes.length, 5);
  assert.match(c.razoes[0], /site verificado/);
});

test('8 · um lead com um nome e mais nada não é de confiança alta', () => {
  const c = confianca({ name: 'Padaria Central' }, { agora: AGORA });
  assert.equal(c.pontos, 0);
  assert.equal(c.nivel, 'baixa');
  assert.match(c.razoes.join(' '), /sem site \(0\)/);
  assert.match(c.razoes.join(' '), /sem telefone \(0\)/);
  assert.match(c.razoes.join(' '), /sem fonte registada \(0\)/);
});

test('9 · escrito à mão não conta como fonte, e um email torto não conta como email', () => {
  const manual = confianca({ name: 'X', phone: '239000111', email: 'a@b', source: 'manual' }, { agora: AGORA });
  assert.equal(manual.pontos, 25);
  assert.match(manual.razoes.join(' '), /escrito à mão \(0\)/);
  assert.ok(!manual.razoes.some((r) => /email com forma válida/.test(r)));
});

test('10 · site que não responde vale 0 pontos, e a razão diz isso', () => {
  const c = confianca({ phone: '239000111', website: 'a.pt', website_estado: 'falhou', website_verificado_em: new Date(AGORA - DIA).toISOString() }, { agora: AGORA });
  assert.equal(c.pontos, 25);
  assert.match(c.razoes.join(' '), /não responde \(0\)/);
});

/* ---------- 11. duplicados: mostrar, nunca fundir ---------- */

test('11 · o mesmo telefone escrito de duas maneiras é um duplicado — e os leads ficam dois', () => {
  const a = { id: 'a', name: 'Clínica A', phone: '+351 239 000 111' };
  const b = { id: 'b', name: 'Clínica B', phone: '239000111' };
  const g = duplicados([a, b]);
  assert.equal(g.length, 1);
  assert.equal(g[0].motivo, 'telefone');
  assert.deepEqual(g[0].ids.sort(), ['a', 'b']);
  assert.equal(g[0].rotulo, 'mesmo telefone');
  assert.equal([a, b].length, 2, 'detetar não é apagar');
  assert.ok(g[0].leads.every((l) => l.id && l.name), 'o grupo traz o que é preciso para decidir');
});

test('12 · mesmo domínio com `www.` e caminho diferente também é duplicado', () => {
  const g = duplicados([
    { id: 'a', name: 'Um', website: 'https://www.x.pt' },
    { id: 'b', name: 'Dois', website: 'http://x.pt/contactos' },
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].motivo, 'dominio');
  assert.match(g[0].rotulo, /x\.pt/);
});

test('13 · o mesmo par não aparece duas vezes, e nomes diferentes não se juntam', () => {
  const g = duplicados([
    { id: 'a', name: 'Igual', phone: '239000111' },
    { id: 'b', name: 'Igual', phone: '239000111' },
    { id: 'c', name: 'Outro' },
  ]);
  assert.equal(g.length, 1, 'o telefone é o sinal mais forte e esconde o do nome');
  assert.deepEqual(g[0].ids.sort(), ['a', 'b']);
  assert.equal(duplicados([{ id: 'c', name: 'Outro' }]).length, 0);
  assert.equal(duplicados([]).length, 0);
  assert.equal(duplicados([{ name: 'sem id' }, { name: 'sem id' }]).length, 0, 'sem id não há como abrir o lead');
});

/* ---------- 14. a próxima ação ---------- */

test('14 · a próxima ação atrasada diz há quantos dias', () => {
  const p = proximaAccao({ proxima_acao: 'Ligar', proxima_acao_em: '2026-10-30' }, { agora: AGORA });
  assert.equal(p.estado, 'atrasada');
  assert.equal(p.dias, -3);
  assert.equal(p.rotulo, 'atrasada há 3 dias');
  assert.equal(p.texto, 'Ligar');
});

test('15 · hoje, futura, sem data e sem nada — cada caso dito por palavras suas', () => {
  assert.equal(proximaAccao({ proxima_acao: 'Enviar', proxima_acao_em: '2026-11-02' }, { agora: AGORA }).rotulo, 'para hoje');
  assert.equal(proximaAccao({ proxima_acao: 'Enviar', proxima_acao_em: '2026-11-05' }, { agora: AGORA }).rotulo, 'para daqui a 3 dias');
  assert.equal(proximaAccao({ proxima_acao: 'Enviar' }, { agora: AGORA }).estado, 'sem_data');
  assert.equal(proximaAccao({ proxima_acao_em: '2026-11-05' }, { agora: AGORA }).estado, 'sem_texto');
  const nada = proximaAccao({}, { agora: AGORA });
  assert.equal(nada.estado, 'sem');
  assert.equal(nada.texto, null, 'não se inventa um passo «genérico»');
  assert.match(nada.rotulo, /sem próxima ação/);
});

/* ---------- 16. a qualificação e a sua origem ---------- */

test('16 · a qualificação diz de onde veio — à mão, da nota, ou nenhuma', () => {
  assert.deepEqual(qualificacao({ qualificacao: 88, score: 10 }), { valor: 88, origem: 'guardada', rotulo: 'definida à mão' });
  assert.deepEqual(qualificacao({ score: 61 }), { valor: 61, origem: 'nota', rotulo: 'da nota do lead' });
  assert.deepEqual(qualificacao({}), { valor: null, origem: 'sem-dados', rotulo: 'sem dados para qualificar' });
  assert.equal(qualificacao({ qualificacao: 250 }).valor, 100, 'acima de 100 corta-se, não se mostra');
  assert.equal(qualificacao({ qualificacao: -5 }).valor, 0);
});

/* ---------- 17. os números do funil ---------- */

test('17 · o funil conta fases, contactáveis, verificados e atrasados — sem estimar', () => {
  const leads = [
    LEAD,
    { id: 'l2', name: 'B', status: 'novo', phone: '239000222' },
    { id: 'l3', name: 'C', status: 'cliente', email: 'c@d.pt' },
    { id: 'l4', name: 'D', status: 'perdido', proxima_acao: 'Ligar', proxima_acao_em: '2026-10-01' },
  ];
  const r = resumoDoFunil(leads);
  assert.equal(r.total, 4);
  assert.equal(r.verificados, 1);
  assert.equal(r.porVerificar, 0);
  assert.equal(r.comContacto, 3);
  assert.equal(r.atrasadas, 1);
  assert.equal(r.contactaveis, 75);
  assert.equal(r.fases.length, FASES.length);
  assert.equal(r.fases.reduce((n, f) => n + f.n, 0), 4, 'cada lead cai numa fase e só numa');
  assert.equal(resumoDoFunil([]).total, 0);
  assert.equal(resumoDoFunil([]).contactaveis, 0);
});

test('18 · o resumo inclui os duplicados detetados', () => {
  const r = resumoDoFunil([
    { id: 'a', name: 'A', phone: '239000111' },
    { id: 'b', name: 'B', phone: '239000111' },
  ]);
  assert.equal(r.duplicados, 1);
  assert.match(fraseDaCarteira(r), /1 par duplicado/);
});

/* ---------- 19. o CSV ---------- */

test('19 · o campo de CSV só leva aspas quando são precisas, e duplica as de dentro', () => {
  assert.equal(campoCSV('Coimbra'), 'Coimbra');
  assert.equal(campoCSV('Clínica; Lda'), '"Clínica; Lda"');
  assert.equal(campoCSV('diz "olá"'), '"diz ""olá"""');
  assert.equal(campoCSV('linha\nnova'), '"linha\nnova"');
  assert.equal(campoCSV(null), '');
  assert.equal(campoCSV(0), '0', 'o zero é um valor, não uma ausência');
});

test('20 · o CSV abre no Excel em português: BOM, `;`, CRLF, acentos e aspas', () => {
  const csv = csvDeLeads([
    { id: 'a', name: 'Clínica do Mondego; Coimbra', category: 'Saúde', city: 'Coimbra', phone: '239000111', status: 'contactado', source: 'pesquisa' },
    { id: 'b', name: 'Padaria "Central"', status: 'novo' },
  ], { agora: AGORA });
  assert.ok(csv.startsWith('\uFEFF'), 'leva BOM para os acentos não partirem');
  assert.ok(csv.endsWith('\r\n'));
  assert.equal(csv.split('\r\n').filter(Boolean).length, 3, 'cabeçalho + 2 leads');
  const cabecalho = csv.replace('\uFEFF', '').split('\r\n')[0];
  assert.ok(cabecalho.includes(';'), 'separador ponto e vírgula');
  for (const rotulo of ['Nome', 'Setor', 'Localização', 'Telefone', 'Site verificado em', 'Estado comercial', 'Próxima ação', 'Fonte', 'Confiança', 'Verificação']) {
    assert.ok(cabecalho.includes(rotulo), `falta a coluna «${rotulo}»`);
  }
  assert.ok(csv.includes('"Clínica do Mondego; Coimbra"'), 'o ponto e vírgula do nome não parte a coluna');
  assert.ok(csv.includes('"Padaria ""Central"""'), 'as aspas do nome são duplicadas');
  assert.ok(csv.includes('Contactado'), 'o estado vai por palavras, não pelo código');
  assert.ok(csv.includes('/100'), 'a confiança vai com o número e o nível');
  assert.ok(csv.includes('Site verificado'), 'a verificação vai como texto, não só como estado');
});

test('21 · o CSV de uma lista vazia ainda tem cabeçalho', () => {
  const csv = csvDeLeads([], { agora: AGORA });
  assert.equal(csv.split('\r\n').filter(Boolean).length, 1);
  assert.match(nomeDoFicheiro(AGORA), /^leads-2026-11-02\.csv$/);
  assert.match(nomeDoFicheiro(Date.parse('2026-01-05T23:00:00Z')), /^leads-2026-01-0(5|6)\.csv$/, 'a data é a do dia, no fuso de quem exporta');
});

/* ---------- 22. a frase da carteira ---------- */

test('22 · a frase da carteira diz o essencial, e uma carteira vazia não finge números', () => {
  assert.match(fraseDaCarteira(resumoDoFunil([])), /Ainda não há leads/);
  const r = resumoDoFunil([LEAD, { id: 'l2', name: 'B', status: 'novo' }]);
  const f = fraseDaCarteira(r);
  assert.match(f, /^2 leads/);
  assert.ok(f.length < 220, 'é uma frase, não um parágrafo');
});

/* ---------- 23. a ligação real ao servidor e à interface ---------- */

test('23 · o servidor, o modo local e a mesa usam estas contas — não as repetem', () => {
  const rotas = fs.readFileSync(path.join(ROOT, 'api/_rotas.mjs'), 'utf8');
  assert.match(rotas, /from '\.\.\/src\/crm\.js'/, 'o servidor importa as contas');
  assert.match(rotas, /ops\/leads\.csv/, 'há rota de exportação');
  assert.match(rotas, /ops\/leads\/duplicados/, 'há rota de duplicados');
  assert.match(rotas, /verificar/, 'há rota para verificar o site');
  assert.ok(!/function csvDeLeads/.test(rotas), 'o CSV não é reescrito no servidor');

  const local = fs.readFileSync(path.join(ROOT, 'src/localapi.js'), 'utf8');
  assert.match(local, /from '\.\/crm\.js'/, 'o modo local importa as mesmas contas');
  assert.match(local, /503/, 'sem rede, a verificação diz que não pode — não finge que verificou');

  const mesa = fs.readFileSync(path.join(ROOT, 'src/mesa.js'), 'utf8');
  assert.match(mesa, /from '\.\/crm\.js'/, 'a mesa importa as mesmas contas');
  /* 3 nov 2026 · o cartão passou a receber a lista à vista (`crmCard(list)`), para se poder
     exportar só o que está filtrado: a asserção guarda o mesmo — a lista mostra o cartão. */
  assert.match(mesa, /function crmCard\(/, 'a lista de leads mostra o cartão do funil');
  assert.match(mesa, /\$\{crmCard\(list\)\}/, 'e passa-lhe a vista actual, não uma segunda contagem');
  for (const act of ['csv-leads', 'ver-duplicados', 'verificar-site', 'guardar-proxima', 'limpar-proxima']) {
    assert.match(mesa, new RegExp(`'${act}'`), `a ação «${act}» não está ligada`);
  }
  assert.match(mesa, /aExportar/, 'o botão de exportar não dispara duas descargas');
});

test('24 · a migração acrescenta os campos do CRM e o registo de quem fez o quê', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/orbita_1_59_0.sql'), 'utf8');
  for (const col of ['website_estado', 'website_verificado_em', 'website_motivo', 'fonte_url', 'confianca', 'qualificacao', 'proxima_acao', 'proxima_acao_em']) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), `falta a coluna ${col}`);
  }
  assert.match(sql, /orbita_lead_eventos/, 'sem histórico de eventos não se sabe quem autorizou o quê');
  assert.match(sql, /if not exists/i, 'a migração pode correr duas vezes');
});
