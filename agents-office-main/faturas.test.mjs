/* ===========================================================================
   1.56.0 · A FATURA — o que este ficheiro prova

   O que havia: um campo «entrou X €» e nenhum documento. O que agora existe: uma
   fatura com número que não salta, IVA configurável, NIF validado, PDF gerado no
   servidor e nota de crédito quando se anula.

   As provas, uma a uma:
     · a numeração é 1, 2, 3 — e depois de anular a 2, a 3 continua a ser 3 (o
       número 2 não reaparece);
     · dois pedidos ao mesmo tempo: o segundo perde o número e leva o seguinte;
     · o IVA é arredondado UMA vez, no IVA da fatura, e os totais fecham;
     · NIF com dígito de controlo errado é recusado; sem NIF só como consumidor
       final, e o PDF di-lo;
     · o PDF é um PDF: cabeçalho, xref com deslocamentos certos, e o texto do
       documento lá dentro (o euro incluído);
     · a nota de crédito tem os valores negativos e aponta a fatura que anula;
     · enviar sem RESEND_API_KEY não marca a fatura como enviada.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  nifValido, calcularTotais, codigoDe, criarFatura, anularFatura, eurosPT,
  resumoFaturas, documentoDaFatura, avisoEmitente, emitenteDoAmbiente, TAXAS_IVA,
} from './api/_faturas.mjs';
import { createMemRepo } from './api/_repo.mjs';
import { responder } from './api/_rotas.mjs';

const chamar = (repo, caminho, metodo = 'GET', corpo = null, env = {}, fetchImpl = null) => responder(repo, {
  caminho, metodo, corpo, env,
  fetchImpl: fetchImpl || (() => { throw new Error('sem rede neste teste'); }),
});

/** Um NIF válido, calculado aqui para o teste não depender de um número real. */
function nifDe(base8) {
  let soma = 0;
  for (let i = 0; i < 8; i += 1) soma += Number(base8[i]) * (9 - i);
  const resto = soma % 11;
  const check = resto < 2 ? 0 : 11 - resto;
  return `${base8}${check}`;
}
const NIF = nifDe('50944201');

/* O PDF escreve o euro em WinAnsi (0x80). Ao ler em latin1 aparece um
   caractere de controlo; esta função devolve-o como o leitor mostra. */
const comoTexto = (pdf) => pdf.toString('latin1')
  .replace(/\x80/g, '€')
  .replace(/\\([()\\])/g, '$1');

const LINHAS = [{ descricao: 'Site institucional — 4 páginas', quantidade: 1, precoCentimos: 90000 }];

const emitenteBom = {
  ORBITA_EMITENTE_NOME: 'Órbita Studio, Lda.',
  ORBITA_EMITENTE_NIF: nifDe('51500000'),
  ORBITA_EMITENTE_MORADA: 'Rua da Sofia 12, 3000-390 Coimbra',
};

const pedido = (extra = {}) => ({
  cliente: { nome: 'Clínica do Mondego', nif: NIF, email: 'geral@clinicadomondego.pt' },
  linhas: LINHAS,
  ivaTaxa: 23,
  ...extra,
});

/* ------------------------------------------------------------- o NIF e a conta */

test('NIF: o dígito de controlo é verificado, não é decorativo', () => {
  assert.equal(nifValido(NIF), true, `${NIF} devia ser válido`);
  const errado = `${NIF.slice(0, 8)}${(Number(NIF[8]) + 1) % 10}`;
  assert.equal(nifValido(errado), false, `${errado} tem o dígito errado`);
  assert.equal(nifValido('111111111'), false, 'um número inventado não passa');
  assert.equal(nifValido(''), false);
});

test('IVA: arredonda-se uma vez, no IVA — e base + IVA = total, sempre', () => {
  assert.deepEqual(calcularTotais(90000, 23), { baseCentimos: 90000, ivaTaxa: 23, ivaCentimos: 20700, totalCentimos: 110700 });
  assert.deepEqual(calcularTotais(100, 23).ivaCentimos, 23);
  assert.deepEqual(calcularTotais(1, 6), { baseCentimos: 1, ivaTaxa: 6, ivaCentimos: 0, totalCentimos: 1 }, '1 cêntimo a 6 % arredonda a 0, e o total acompanha');
  assert.deepEqual(calcularTotais(12345, 13), { baseCentimos: 12345, ivaTaxa: 13, ivaCentimos: 1605, totalCentimos: 13950 });
  assert.deepEqual(calcularTotais(5000, 0).totalCentimos, 5000, 'isento: o total é a base');
  assert.deepEqual(TAXAS_IVA, [23, 13, 6, 0]);
  /* o euro como se escreve num documento, com milhares e sinal */
  assert.equal(eurosPT(110700), '1.107,00 €');
  assert.equal(eurosPT(90000), '900,00 €');
  assert.equal(eurosPT(-110700), '-1.107,00 €');
  assert.equal(eurosPT(0), '0,00 €');
  assert.equal(eurosPT(5), '0,05 €');
  assert.equal(codigoDe(2026, 7), '2026/0007');
});

/* --------------------------------------------------------------- a numeração */

test('os números seguem 1, 2, 3 e a anulada não devolve o número ao bolo', async () => {
  const repo = createMemRepo();
  const a = await criarFatura(repo, pedido());
  const b = await criarFatura(repo, pedido({ cliente: { nome: 'Padaria Central', nif: NIF } }));
  const c = await criarFatura(repo, pedido({ cliente: { nome: 'Oficina Silva', nif: NIF } }));
  assert.deepEqual([a.fatura.codigo, b.fatura.codigo, c.fatura.codigo], ['2026/0001', '2026/0002', '2026/0003']);

  const anulada = await anularFatura(repo, b.fatura.id, 'valor errado na linha');
  assert.equal(anulada.fatura.estado, 'anulada');
  assert.equal(anulada.notaCredito.codigo, '2026/0002-NC');
  assert.equal(anulada.notaCredito.total_centimos, -110700, 'a nota de crédito leva o valor negativo');
  assert.equal(anulada.notaCredito.fatura_origem, b.fatura.id);

  const d = await criarFatura(repo, pedido({ cliente: { nome: 'Café do Rio', nif: NIF } }));
  assert.equal(d.fatura.codigo, '2026/0004', 'a 2 foi anulada, mas o número 2 não volta a ser usado');
  const numeros = (await repo.faturas.listar()).filter((f) => f.tipo === 'fatura').map((f) => f.numero);
  assert.deepEqual([...numeros].sort((x, y) => x - y), [1, 2, 3, 4], 'sem buracos: 1,2,3,4 — a anulada continua lá');
});

test('dois pedidos ao mesmo tempo: um perde o número e leva o seguinte, sem repetir', async () => {
  const repo = createMemRepo();
  await criarFatura(repo, pedido());
  /* simula a corrida: a primeira tentativa de inserção choca com o número */
  const inserirOriginal = repo.faturas.inserir;
  let choques = 0;
  repo.faturas.inserir = async (f) => {
    if (choques === 0) {
      choques += 1;
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { status: 409 });
    }
    return inserirOriginal(f);
  };
  const r = await criarFatura(repo, pedido({ cliente: { nome: 'Outro Cliente', nif: NIF } }));
  assert.equal(choques, 1, 'houve mesmo o conflito');
  assert.equal(r.fatura.numero, 2, 'depois do conflito, o número seguinte');
  const todos = await repo.faturas.listar();
  assert.deepEqual(todos.map((f) => f.numero).sort((x, y) => x - y), [1, 2]);
});

/* ------------------------------------------------------------- o que se recusa */

test('recusa o que não serve como documento, e diz porquê', async () => {
  const repo = createMemRepo();
  const casos = [
    [{ ...pedido(), cliente: { nome: '' } }, /nome do cliente/],
    [{ ...pedido(), cliente: { nome: 'X', nif: '111111111' } }, /dígito de controlo/],
    [{ ...pedido(), cliente: { nome: 'X' } }, /falta o NIF do cliente/],
    [{ ...pedido(), linhas: [] }, /pelo menos uma linha/],
    [{ ...pedido(), linhas: [{ descricao: '', precoCentimos: 100 }] }, /descrição/],
    [{ ...pedido(), linhas: [{ descricao: 'x', quantidade: 0, precoCentimos: 100 }] }, /quantidade/],
    [{ ...pedido(), ivaTaxa: 17 }, /IVA tem de ser/],
    [{ ...pedido(), ivaTaxa: 0 }, /isenta tem de dizer o motivo/],
    [{ ...pedido(), serie: '26' }, /quatro dígitos/],
  ];
  for (const [dados, esperado] of casos) {
    await assert.rejects(() => criarFatura(repo, dados), (e) => {
      assert.equal(e.status, 400);
      assert.match(e.message, esperado);
      return true;
    });
  }
  assert.equal((await repo.faturas.listar()).length, 0, 'nada inválido ficou gravado');
});

test('consumidor final: emite sem NIF e o documento di-lo; isento escreve o motivo', async () => {
  const repo = createMemRepo();
  const cf = await criarFatura(repo, { cliente: { nome: 'Cliente de balcão' }, linhas: LINHAS, consumidorFinal: true });
  assert.equal(cf.fatura.consumidor_final, true);
  assert.equal(cf.fatura.cliente_nif, null);
  const pdf = documentoDaFatura(cf.fatura, { emitente: emitenteDoAmbiente(emitenteBom) });
  assert.match(comoTexto(pdf), /Consumidor final \(sem NIF\)/);

  const isenta = await criarFatura(repo, pedido({ ivaTaxa: 0, motivoIsencao: 'Isento — artigo 9.º do CIVA' }));
  assert.equal(isenta.fatura.iva_centimos, 0);
  assert.equal(isenta.fatura.total_centimos, 90000);
  assert.match(comoTexto(documentoDaFatura(isenta.fatura, { emitente: emitenteDoAmbiente(emitenteBom) })), /Isento . artigo 9/);
});

/* ------------------------------------------------------------------ o PDF */

test('o PDF é um PDF a sério: cabeçalho, xref com os deslocamentos certos e o texto lá dentro', async () => {
  const repo = createMemRepo();
  const { fatura } = await criarFatura(repo, pedido({ nota: 'Pagamento a 30 dias por transferência.' }));
  const pdf = documentoDaFatura(fatura, { emitente: emitenteDoAmbiente(emitenteBom) });
  const texto = comoTexto(pdf);        // para ler o conteúdo
  const cru = pdf.toString('latin1');  // para medir deslocamentos (bytes tal e qual)

  assert.equal(texto.slice(0, 8), '%PDF-1.4');
  assert.match(texto, /%%EOF\n$/);
  assert.match(texto, /\/BaseFont \/Helvetica\b/);
  assert.match(texto, /\/BaseFont \/Helvetica-Bold\b/);

  /* a xref tem de apontar para o início de cada objecto — um PDF com a tabela
     errada abre em branco em alguns leitores. */
  const m = cru.match(/startxref\n(\d+)\n%%EOF/);
  assert.ok(m, 'tem startxref');
  const inicio = Number(m[1]);
  assert.equal(cru.slice(inicio, inicio + 4), 'xref');
  const linhas = cru.slice(inicio).split('\n').slice(2);
  let verificados = 0;
  for (let n = 1; n < linhas.length; n += 1) {
    const l = linhas[n];
    if (!/^\d{10} 00000 n/.test(l)) continue;
    const off = Number(l.slice(0, 10));
    assert.equal(cru.slice(off, off + `${n} 0 obj`.length), `${n} 0 obj`, `objecto ${n} no deslocamento certo`);
    verificados += 1;
  }
  assert.ok(verificados >= 6, `contei ${verificados} objectos`);

  /* o que o cliente lê no papel */
  assert.match(texto, /FATURA/);
  assert.match(texto, /2026\/0001/);
  assert.match(texto, /Clínica do Mondego/);
  assert.match(texto, new RegExp(NIF));
  assert.match(texto, /Site institucional/);
  assert.match(texto, /900,00 €/, 'a base em euros com vírgula');
  assert.match(texto, /207,00 €/, 'o IVA a 23 %');
  assert.match(texto, /1\.107,00 €/, 'o total');
  assert.match(texto, /IVA \(23 %\)/);
  assert.match(texto, /Pagamento a 30 dias/);
  assert.match(texto, /Órbita Studio, Lda\./);
});

test('sem emitente configurado o PDF diz isso na cara, em vez de parecer um documento válido', () => {
  const fatura = {
    id: 'f_x', codigo: '2026/0009', tipo: 'fatura', estado: 'emitida', emitida_em: '2026-11-02T10:00:00Z',
    cliente_nome: 'Cliente', cliente_nif: NIF, linhas: LINHAS, iva_taxa: 23,
    base_centimos: 90000, iva_centimos: 20700, total_centimos: 110700, moeda: 'EUR',
  };
  const texto = comoTexto(documentoDaFatura(fatura, { emitente: {} }));
  assert.match(texto, /Emitente por configurar/);
  assert.match(texto, /falta ORBITA_EMITENTE_NIF/);
  assert.match(avisoEmitente({}), /ORBITA_EMITENTE_NOME/);
  assert.equal(avisoEmitente(emitenteDoAmbiente(emitenteBom)), null, 'com nome e NIF não há aviso');

  /* e a nota de crédito mostra os valores negativos e a razão */
  const nc = { ...fatura, tipo: 'nota_credito', codigo: '2026/0009-NC', estado: 'emitida', motivo_anulacao: 'valor errado',
    base_centimos: -90000, iva_centimos: -20700, total_centimos: -110700 };
  const txtNc = comoTexto(documentoDaFatura(nc, { emitente: emitenteDoAmbiente(emitenteBom) }));
  assert.match(txtNc, /NOTA DE CRÉDITO/);
  assert.match(txtNc, /-900,00 €/);
  assert.match(txtNc, /Anula a fatura 2026\/0009\. Motivo: valor errado/);
});

/* -------------------------------------------------------------- o resumo */

test('o resumo não conta as anuladas como receita e deixa as notas de crédito abater', async () => {
  const repo = createMemRepo();
  const a = await criarFatura(repo, pedido());
  const b = await criarFatura(repo, pedido({ cliente: { nome: 'Outra', nif: NIF } }));
  await anularFatura(repo, b.fatura.id, 'duplicado');
  const r = resumoFaturas(await repo.faturas.listar());

  assert.equal(r.emitidas, 1);
  assert.equal(r.anuladas, 1);
  assert.equal(r.notasCredito, 1);
  assert.equal(r.totalCentimos, 0, 'uma fatura de 1 107 € e a sua nota de crédito dão zero');
  assert.equal(r.baseCentimos, 0);
  assert.equal(a.fatura.total_centimos, 110700);
  assert.equal(r.porMes[0].documentos, 2, 'no mês ficam os dois documentos, não um');
  assert.equal(resumoFaturas([]).semDados.includes('Ainda não há faturas'), true);
});

/* ------------------------------------------------------------------- as rotas */

test('rotas: emitir, listar, descarregar, enviar (sem chave) e anular — com as respostas certas', async () => {
  const repo = createMemRepo();
  const criada = await chamar(repo, '/ops/faturas', 'POST', pedido(), emitenteBom);
  assert.equal(criada.status, 201);
  const id = criada.corpo.fatura.id;

  const lista = await chamar(repo, '/ops/faturas', 'GET', null, emitenteBom);
  assert.equal(lista.status, 200);
  assert.equal(lista.corpo.faturas.length, 1);
  assert.equal(lista.corpo.resumo.totalCentimos, 110700);
  assert.equal(lista.corpo.correio.configurado, false);
  assert.equal(lista.corpo.emitente.nif, emitenteBom.ORBITA_EMITENTE_NIF);
  assert.match(lista.corpo.nota, /não é receita/);

  const uma = await chamar(repo, `/ops/faturas/${id}`, 'GET', null, emitenteBom);
  assert.equal(uma.corpo.pdf, `/api/fatura-pdf?id=${id}`);

  /* sem RESEND_API_KEY: não sai, não se marca como enviada, e diz o que falta */
  const envio = await chamar(repo, `/ops/faturas/${id}/enviar`, 'POST', {}, emitenteBom);
  assert.equal(envio.corpo.enviado, false);
  assert.match(envio.corpo.motivo, /RESEND_API_KEY/);
  assert.equal((await repo.faturas.porId(id)).enviada_em, null, 'não ficou marcada como enviada');

  /* com chave (e um Resend falso): o PDF vai em anexo, em base64 */
  let corpoResend = null;
  const resend = async (url, opt) => {
    corpoResend = JSON.parse(opt.body);
    return { ok: true, status: 200, text: async () => '{"id":"email_1"}', json: async () => ({ id: 'email_1' }) };
  };
  const comChave = { ...emitenteBom, RESEND_API_KEY: 're_teste' };
  const envio2 = await chamar(repo, `/ops/faturas/${id}/enviar`, 'POST', {}, comChave, resend);
  assert.equal(envio2.corpo.enviado, true);
  assert.deepEqual(corpoResend.to, ['geral@clinicadomondego.pt']);
  assert.match(corpoResend.subject, /Fatura 2026\/0001/);
  assert.equal(corpoResend.attachments.length, 1);
  assert.equal(corpoResend.attachments[0].filename, '2026-0001.pdf');
  assert.equal(Buffer.from(corpoResend.attachments[0].content, 'base64').slice(0, 8).toString(), '%PDF-1.4');
  assert.ok((await repo.faturas.porId(id)).enviada_em, 'agora sim, marcada como enviada');

  const anulada = await chamar(repo, `/ops/faturas/${id}/anular`, 'POST', { motivo: 'endereço errado' }, emitenteBom);
  assert.equal(anulada.status, 200);
  assert.equal(anulada.corpo.notaCredito.codigo, '2026/0001-NC');
  await assert.rejects(() => chamar(repo, `/ops/faturas/${id}/anular`, 'POST', { motivo: 'outra vez' }, emitenteBom), (e) => e.status === 409);
  await assert.rejects(() => chamar(repo, `/ops/faturas/f_nao_existe`, 'GET'), (e) => e.status === 404);
  await assert.rejects(() => chamar(repo, '/ops/faturas', 'POST', { cliente: { nome: 'X' }, linhas: LINHAS }), (e) => e.status === 400);
});

test('o saldo mostra o faturado ao lado do recebido — e não os soma', async () => {
  const repo = createMemRepo();
  await chamar(repo, '/ops/faturas', 'POST', pedido(), emitenteBom);
  await chamar(repo, '/ops/receita', 'POST', { euros: 250 }, emitenteBom);
  const saldo = await chamar(repo, '/ops/saldo', 'GET', null, emitenteBom);
  assert.equal(saldo.corpo.receitaCentimos, 25000, 'a receita é o que entrou, à mão');
  assert.equal(saldo.corpo.faturacao.totalCentimos, 110700, 'o faturado é outra coisa, e é mostrado à parte');
  assert.equal(saldo.corpo.faturacao.emitidas, 1);
});
