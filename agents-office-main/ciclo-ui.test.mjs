/* ===========================================================================
   1.67.0 · A FILA NO ECRÃ (5 nov 2026)

   `ciclo.test.mjs` prova que o servidor corre a fila. Este prova o que a pessoa
   vê e faz, contra `dist/mesa.html` (o ficheiro publicado):

     · a página das Tarefas diz quantas estão à espera — e diz que a fila corre
       sozinha uma vez por dia, porque é o máximo do plano, não uma escolha;
     · «Correr a fila agora» chama `POST /ops/ciclo` e mostra a frase que o
       servidor devolveu (não uma versão bonita dela);
     · uma falha do servidor aparece como falha, com o motivo;
     · sem fila, não há botão nenhum para carregar (não se inventa trabalho).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');
const iso = (min) => new Date(Date.now() - min * 60000).toISOString();

const TAREFAS = [
  { id: 't1', kind: 'investigar', state: 'queued', created_at: iso(5), entity_id: 'l1', entidade: 'lead' },
  { id: 't2', kind: 'mensagem', state: 'queued', created_at: iso(3), entity_id: 'l1', entidade: 'lead' },
  { id: 't3', kind: 'qa', state: 'succeeded', created_at: iso(60), resultado: 'tudo bem', modelo: 'x/y' },
];

async function abrir({ tarefas = TAREFAS, ciclo = null, cicloFalha = false, rota = '#/tarefas' } = {}) {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${rota}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u; let corpo = null;
        if (u.includes('/api/rpc')) {
          const b = JSON.parse(opt.body || '{}');
          caminho = b.caminho; corpo = b.corpo;
          pedidos.push({ caminho, metodo: b.metodo, corpo });
        } else caminho = new URL(u, 'https://mesa.test').pathname;
        const rotaLimpa = caminho.replace(/^\/api/, '').split('?')[0];
        const ok = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        if (rotaLimpa === '/ops/ciclo') {
          /* o corpo é o que o servidor manda mesmo quando a rota atira: sem
             envelope, com `error` no topo (`api/rpc.mjs`, ramo do catch) */
          if (cicloFalha) return { ok: false, status: 500, json: async () => ({ error: 'a base não respondeu' }) };
          return ok(ciclo || { ok: true, frase: 'corri 1 concluída · 1 à tua espera.', concluidas: 1, propostas: 1, restantes: 0 });
        }
        const fixo = {
          '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: { admin: true, read: true, write: true, approve: true } },
          '/ops/summary': { leads: { total: 1 }, projetos: { total: 0 }, custos: {} },
          '/ops/today': { decidir: [] }, '/ops/leads': { leads: [] },
          '/ops/messages': { messages: [] }, '/ops/projetos': { projetos: [], tipos: [] },
          '/ops/clientes': { clientes: [], activo: null },
          '/ops/saldo': { janela: { dias: 90 }, receitaCentimos: 0, custoCentimos: 0, margemCentimos: 0, contaAVista: { chamadas: 0, linhas: [], desconhecidas: 0 } },
          '/ops/tarefas': { tarefas, tipos: { investigar: { label: 'Investigar o lead' }, mensagem: { label: 'Escrever uma mensagem' }, qa: { label: 'Auditoria de qualidade' } }, departamentos: [{ id: 'prospeccao', nome: 'Prospecção' }, { id: 'vendas', nome: 'Vendas' }] },
          '/ia/runs': { runs: [] },
        };
        return ok(fixo[rotaLimpa] ?? {});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 700));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, w: dom.window, pedidos, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 400) => new Promise((r) => setTimeout(r, ms));

test('1.67.0 · a fila diz quantas estão à espera e que o relógio é diário (o do plano)', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /A fila/);
  assert.match(t, /2 à espera/);
  assert.match(t, /uma vez por dia/, 'o agendador da Vercel só permite diário neste plano — diz-se');
  assert.match(t, /pede-me sempre.*não gasta chamadas/, 'e que sem autorização não se gasta nada');
  assert.ok(doc.querySelector('[data-act="ciclo-correr"]'), 'há um botão para correr agora');
});

test('1.67.0 · «correr a fila agora» chama /ops/ciclo e mostra a frase do servidor', async () => {
  const { doc, w, pedidos, texto } = await abrir();
  doc.querySelector('[data-act="ciclo-correr"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(700);
  const pedido = pedidos.find((p) => p.caminho === '/ops/ciclo');
  assert.ok(pedido, 'chamou o servidor');
  assert.equal(pedido.metodo, 'POST');
  assert.equal(pedido.corpo.limite, 2, 'o limite que o cartão promete');
  assert.match(texto(), /corri 1 concluída · 1 à tua espera\./, 'a frase é a que o servidor devolveu');
});

test('1.67.0 · se o ciclo falhar, o cartão diz que falhou e porquê', async () => {
  const { doc, w, texto } = await abrir({ cicloFalha: true });
  doc.querySelector('[data-act="ciclo-correr"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(700);
  const t = texto();
  assert.match(t, /não correu/);
  assert.match(t, /base não respondeu/);
  assert.doesNotMatch(t, /corri /, 'não inventa um resultado quando não houve');
});

test('1.67.0 · fila vazia: sem botão para carregar (não se inventa trabalho)', async () => {
  const { doc, texto } = await abrir({ tarefas: [TAREFAS[2]] });
  assert.match(texto(), /A fila/);
  assert.match(texto(), /vazia/);
  assert.equal(doc.querySelector('[data-act="ciclo-correr"]'), null);
});
