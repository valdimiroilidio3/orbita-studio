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

const FILA_GET = {
  ok: true, naFila: 2, agendador: true,
  proximo: new Date(Date.now() + 3 * 3600000).toISOString(),
  tarefas: [
    { id: 't1', kind: 'investigar', nivel: 'autonomo', correSozinha: true, rotulo: 'corre no próximo ciclo' },
    { id: 't2', kind: 'mensagem', nivel: 'pedir_sempre', correSozinha: false, rotulo: 'espera pela tua autorização' },
  ],
};

async function abrir({ tarefas = TAREFAS, ciclo = null, cicloFalha = false, rota = '#/tarefas', filaGet = FILA_GET, autoCiclo = false } = {}) {
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: `https://mesa.test/${rota}`, runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      /* 1.70.0 · por omissão finge-se que a fila já correu há um minuto nesta
         máquina, para os testes do botão não apanharem o ciclo automático.
         Com `autoCiclo: true` o registo não existe e a abertura corre a fila. */
      try {
        if (autoCiclo) w.localStorage.removeItem('orbita.ciclo.ultimo');
        else w.localStorage.setItem('orbita.ciclo.ultimo', String(Date.now()));
      } catch { /* sem storage */ }
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u; let corpo = null; let metodo = 'GET';
        if (u.includes('/api/rpc')) {
          const b = JSON.parse(opt.body || '{}');
          caminho = b.caminho; corpo = b.corpo; metodo = b.metodo || 'GET';
          pedidos.push({ caminho, metodo: b.metodo, corpo });
        } else caminho = new URL(u, 'https://mesa.test').pathname;
        const rotaLimpa = caminho.replace(/^\/api/, '').split('?')[0];
        const ok = (c) => ({ ok: true, status: 200, json: async () => ({ status: 200, corpo: c }) });
        if (rotaLimpa === '/ops/ciclo') {
          /* o corpo é o que o servidor manda mesmo quando a rota atira: sem
             envelope, com `error` no topo (`api/rpc.mjs`, ramo do catch) */
          if (cicloFalha) return { ok: false, status: 500, json: async () => ({ error: 'a base não respondeu' }) };
          /* 1.68.0 · a leitura (GET) traz o nível de cada tipo e o próximo
             ciclo; o POST traz a frase do que correu */
          if (metodo === 'GET') return ok(filaGet);
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
  /* 1.68.0: em vez de «uma vez por dia», o cartão passou a dizer a HORA do
     próximo ciclo (e a idade de cada tarefa). A frase continua a vir de
     `src/fila.js`, que é onde está a regra — o teste segue a frase nova. */
  assert.match(t, /próximo ciclo: /, 'o agendador da Vercel só permite diário neste plano — diz-se, com a hora');
  assert.match(t, /não gasta uma chamada de IA sem a tua autorização/, 'e que sem autorização não se gasta nada');
  assert.ok(doc.querySelector('[data-act="ciclo-correr"]'), 'há um botão para correr agora');
});

test('1.67.0 · «correr a fila agora» chama /ops/ciclo e mostra a frase do servidor', async () => {
  const { doc, w, pedidos, texto } = await abrir();
  doc.querySelector('[data-act="ciclo-correr"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(700);
  /* a página também LÊ `/ops/ciclo` (GET) ao abrir: o clique é o POST */
  const pedido = pedidos.filter((p) => p.caminho === '/ops/ciclo').find((p) => p.metodo === 'POST');
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

test('1.68.0 · cada tarefa na fila diz quando corre e há quanto espera', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /2 tarefas na fila/, 'a frase do cartão conta as duas');
  assert.match(t, /corre no próximo ciclo/, 'a que está em «autónomo» diz quando corre');
  assert.match(t, /espera pela tua autorização/, 'a que pede decisão diz que espera por ti');
  assert.match(t, /próximo ciclo: /, 'e o cartão mostra a hora do próximo ciclo');
  assert.ok(doc.querySelector('#cicloCard ul.arr-lista'), 'as tarefas aparecem em lista, uma por linha');
  assert.match(t, /Investigar o lead/, 'o nome é o rótulo do tipo, não o `kind` cru');
});

test('1.68.0 · uma tarefa há mais de um dia à espera é assinalada como não apanhada', async () => {
  const velha = { id: 't9', kind: 'qa', state: 'queued', created_at: iso(30 * 60) };
  const { texto } = await abrir({ tarefas: [velha] });
  const t = texto();
  assert.match(t, /há mais de um dia/, 'o cartão avisa');
  assert.match(t, /corre a fila à mão ou verifica o CRON_SECRET/, 'e diz o que fazer');
});

test('1.68.0 · sem agendador configurado, o cartão não promete um ciclo', async () => {
  const { texto } = await abrir({
    filaGet: { ok: true, naFila: 1, agendador: false, proximo: null, tarefas: [{ id: 't1', kind: 'investigar', nivel: 'autonomo', correSozinha: true, rotulo: 'corre quando correres o ciclo' }] },
  });
  const t = texto();
  assert.match(t, /sem agendador configurado|só anda quando carregares/, 'diz a verdade sobre o relógio');
  assert.doesNotMatch(t, /próximo ciclo: /, 'não inventa uma hora que não vai acontecer');
});

/* ===========================================================================
   1.70.0 · a fila anda quando abres a Órbita
   =========================================================================== */

test('1.70.0 · abrir as Tarefas com fila e sem ciclo recente põe a fila a andar — uma vez', async () => {
  const { w, pedidos, texto } = await abrir({ autoCiclo: true });
  const posts = pedidos.filter((p) => p.caminho === '/ops/ciclo' && p.metodo === 'POST');
  assert.equal(posts.length, 1, 'um só ciclo por abertura — não um por navegação');
  assert.equal(posts[0].corpo.limite, 2, 'o mesmo limite que o botão');
  await esperar(400);
  assert.match(texto(), /ao abrir a Órbita — corri 1 concluída/, 'o cartão diz que foi a abertura, não um clique teu');
});

test('1.70.0 · com um ciclo recente, abrir a página não gasta nada', async () => {
  const { pedidos } = await abrir();
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/ciclo' && p.metodo === 'POST').length, 0);
});

test('1.70.0 · a fila vazia não dispara um ciclo ao abrir (não se inventa trabalho)', async () => {
  const { pedidos } = await abrir({ autoCiclo: true, tarefas: [TAREFAS[2]], filaGet: { ok: true, naFila: 0, agendador: true, proximo: null, tarefas: [] } });
  assert.equal(pedidos.filter((p) => p.caminho === '/ops/ciclo' && p.metodo === 'POST').length, 0);
});
