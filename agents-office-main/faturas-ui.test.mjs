/* ===========================================================================
   1.56.0 · AS FATURAS NO ECRÃ

   `faturas.test.mjs` prova a numeração, o IVA e o PDF. Este prova o que o dono
   vê: a lista com número e estado, a fatura anulada ainda visível com a nota de
   crédito, o aviso do emitente por configurar, e o formulário que recusa um
   documento incompleto antes de o enviar.

   Corre contra `dist/mesa.html` (o ficheiro que vai para produção), com
   `/api/rpc` a responder como em produção.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

const FATURA = {
  id: 'f_1', serie: '2026', numero: 1, codigo: '2026/0001', tipo: 'fatura', estado: 'emitida',
  cliente_nome: 'Clínica do Mondego', cliente_nif: '509442013', cliente_email: 'geral@clinicadomondego.pt',
  linhas: [{ descricao: 'Site institucional', quantidade: 1, precoCentimos: 90000, totalCentimos: 90000 }],
  iva_taxa: 23, base_centimos: 90000, iva_centimos: 20700, total_centimos: 110700, moeda: 'EUR',
  emitida_em: '2026-11-02T10:00:00.000Z', enviada_em: null,
};

const NC = { ...FATURA, id: 'f_2', numero: 2, codigo: '2026/0002-NC', tipo: 'nota_credito',
  cliente_nome: 'Padaria Central', total_centimos: -36900, base_centimos: -30000, iva_centimos: -6900 };

async function abrirFaturas(corpo, { rota = '#/faturas' } = {}) {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${rota}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) { const b = JSON.parse(opt.body || '{}'); caminho = b.caminho; pedidos.push({ caminho, metodo: b.metodo, corpo: b.corpo }); }
        else caminho = new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.split('?')[0];
        const responder = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        if (rota === '/ops/faturas' && (!pedidos.at(-1) || pedidos.at(-1).metodo !== 'POST')) return responder(corpo);
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: {} },
          '/ops/summary': { leads: { total: 0 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] }, '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/messages': { messages: [] }, '/ops/clientes': { clientes: [], activo: null },
          '/ops/saldo': { janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, contaAVista: {}, semDados: {} },
        };
        return responder(fixo[rota] ?? {});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 450));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { texto: doc.body.textContent.replace(/\s+/g, ' '), doc, pedidos, dom };
}

const LISTA = {
  ok: true,
  faturas: [FATURA, { ...FATURA, id: 'f_3', numero: 3, codigo: '2026/0003', estado: 'anulada', cliente_nome: 'Oficina Silva', motivo_anulacao: 'valor errado' }, NC],
  resumo: { documentos: 3, emitidas: 1, anuladas: 1, notasCredito: 1, baseCentimos: 60000, ivaCentimos: 13800, totalCentimos: 73800,
    porMes: [{ mes: '2026-11', totalCentimos: 73800, documentos: 3 }], porCliente: [{ cliente: 'Clínica do Mondego', totalCentimos: 110700, documentos: 1 }], semDados: null },
  taxasIva: [23, 13, 6, 0], motivosIsencao: ['Isento — artigo 9.º do CIVA'],
  emitente: { nome: '', nif: '', aviso: 'O emitente da fatura está incompleto: falta ORBITA_EMITENTE_NIF no ambiente.' },
  correio: { configurado: false, aviso: 'Sem RESEND_API_KEY a fatura não segue por email — o PDF descarrega-se na mesma.' },
  nota: 'O total faturado não é receita. A receita do saldo é o dinheiro que entrou; a fatura é o que foi cobrado.',
};

test('faturas no ecrã: número, estado, nota de crédito e o aviso do emitente', async () => {
  const { texto, doc } = await abrirFaturas(LISTA);
  assert.match(texto, /2026\/0001/);
  assert.match(texto, /2026\/0003/);
  assert.match(texto, /anulada/, 'a fatura anulada continua visível');
  assert.match(texto, /2026\/0002-NC/, 'a nota de crédito tem o seu código');
  assert.match(texto, /nota de crédito/);
  assert.match(texto, /Clínica do Mondego/);
  assert.match(texto, /1[\s\u00a0]?107,00 €/, 'o total em euros escritos à portuguesa');
  assert.match(texto, /ORBITA_EMITENTE_NIF/, 'o que falta, pelo nome da variável');
  assert.match(texto, /RESEND_API_KEY/);
  assert.match(texto, /não é receita/);
  assert.match(texto, /Por mês/);

  /* o botão do PDF aponta para o ficheiro servido com sessão */
  const pdf = doc.querySelector('a[href^="/api/fatura-pdf?id=f_1"]');
  assert.ok(pdf, 'há link para o PDF da fatura');
});

test('faturas no ecrã: o formulário recusa um documento incompleto antes de o enviar', async () => {
  const { doc, pedidos } = await abrirFaturas({ ...LISTA, faturas: [], resumo: { ...LISTA.resumo, documentos: 0, emitidas: 0, anuladas: 0, notasCredito: 0, totalCentimos: 0, semDados: 'Ainda não há faturas emitidas.' } });

  const abrir = doc.querySelector('[data-act="fatura-nova"]');
  assert.ok(abrir, 'há um botão para emitir');
  abrir.click();
  await new Promise((r) => setTimeout(r, 60));

  const botao = doc.querySelector('[data-act="fatura-criar"]');
  assert.ok(botao, 'o formulário abriu');
  botao.click();
  await new Promise((r) => setTimeout(r, 80));
  const aviso = doc.querySelector('#toast')?.textContent || '';
  assert.match(aviso, /nome do cliente/i, 'sem cliente, diz o que falta');
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/faturas' && p.metodo === 'POST').length, 0, 'nada foi enviado ao servidor');

  /* agora com cliente e linha: as isenções continuam a exigir motivo */
  doc.querySelector('#fNome').value = 'Clínica do Mondego';
  doc.querySelector('#fNif').value = '509442013';
  doc.querySelector('[data-campo="descricao"]').value = 'Site institucional';
  doc.querySelector('[data-campo="preco"]').value = '900,00';
  const iva = doc.querySelector('#fIva');
  iva.value = '0';
  iva.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  doc.querySelector('[data-act="fatura-criar"]').click();
  await new Promise((r) => setTimeout(r, 80));
  const aviso2 = doc.querySelector('#toast')?.textContent || '';
  assert.match(aviso2, /motivo|isenta/i, 'uma isenta sem motivo não é emitida');
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/faturas' && p.metodo === 'POST').length, 0);
});
