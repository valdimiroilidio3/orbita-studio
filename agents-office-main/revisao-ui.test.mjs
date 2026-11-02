/* ===========================================================================
   1.54.4 · A MESA A SÉRIO, NUM DOM, COM UM SERVIDOR FALSO

   O teste manual abriu `#/projeto/p_fantasma` e leu «Modo local · 0 leads» com a
   base viva. O defeito vivia na interface, não no servidor — por isso a prova
   tem de ser na interface: `dist/mesa.html` a correr num DOM, com o `/api/rpc`
   a responder como a produção responde.

   O que aqui se prova (F3), e o que NÃO se prova (F5, declarado):
     · um projeto inexistente tem um ecrã próprio, com saída, e não anuncia uma
       base em baixo;
     · um 404 de ROTA (instalação antiga) continua a cair no armazém local,
       sem «HTTP 404» no ecrã;
     · a CSS do telemóvel traz os toques de 44 px e a caixa 16:9 — está escrito,
       não medido: sem Chrome não há pixéis (ver relatório).
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

const mapaFixo = {
  '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', email: 'dono@orbita.pt', role: 'owner' }, modo: 'base', perms: {} },
  '/ops/summary': { ok: true, leads: { total: 0 }, projetos: { total: 0 } },
  '/ops/today': { ok: true, decidir: [] },
  '/ops/leads': { leads: [] },
  '/ops/projetos': { projetos: [], resumo: null, tipos: [] },
  '/ops/messages': { messages: [] },
  '/ops/clientes': { clientes: [], activo: null },
  '/ops/saldo': { receitaCentimos: 0, custoCentimos: 0 },
  '/ops/utilizadores': { utilizadores: [], papeis: [] },
  '/ops/sessoes': { sessoes: [] },
};

/** Abre a mesa a sério, em `#/projeto/p_fantasma`, com uma resposta para o projeto. */
async function abrir({ projeto }) {
  let respostaProjeto = projeto;
  const pedidos = [];
  const dom = new JSDOM(HTML, {
    url: 'https://mesa.test/#/projeto/p_fantasma',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        let caminho = u;
        if (u.includes('/api/rpc')) {
          const b = JSON.parse(opt.body || '{}');
          caminho = b.caminho;
        } else {
          caminho = new URL(u, 'https://mesa.test').pathname;
        }
        pedidos.push(caminho);
        const responder = (corpo, http = 200) => ({
          ok: http >= 200 && http < 300, status: http, json: async () => corpo,
        });
        const rota = caminho.split('?')[0];
        if (rota === '/ops/projetos/p_fantasma') {
          respostaProjeto = typeof respostaProjeto === 'function' ? respostaProjeto() : respostaProjeto;
          return respostaProjeto.http
            ? responder(respostaProjeto.corpo, respostaProjeto.http)
            : responder(respostaProjeto);
        }
        return responder({ status: 200, corpo: mapaFixo[rota] ?? {} });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 400));
  /* o texto que o dono LÊ: fora <script> e <style>, que não se vêem */
  const doc = dom.window.document;
  doc.querySelectorAll('script, style, template').forEach((n) => n.remove());
  const texto = doc.body.textContent.replace(/\s+/g, ' ');
  return { texto, pedidos, html: doc.body.innerHTML };
}

test('F3 (DOM): um projeto inexistente mostra «Projeto não encontrado» — não «a base não está a responder»', async () => {
  /* o que produção devolve hoje: HTTP 200 + envelope com 404 de RECURSO */
  const { texto, pedidos } = await abrir({ projeto: { status: 404, corpo: { error: 'projeto não encontrado', rota: false } } });

  assert.ok(pedidos.includes('/ops/projetos/p_fantasma'), 'a mesa pediu mesmo o projeto');
  assert.match(texto, /Projeto não encontrado/);
  assert.match(texto, /Este projeto não existe nesta instalação \(ou foi apagado\)/);
  assert.match(texto, /Ver todos os projetos/, 'há saída, não só um erro');
  assert.doesNotMatch(texto, /HTTP 404/, 'a mensagem não é o código');
  assert.doesNotMatch(texto, /a base de dados não está a responder/i, 'a base estava viva');
  assert.doesNotMatch(texto, /Modo local/, 'um projeto apagado não é um modo local');
});

test('F3 (DOM): uma instalação antiga (sem a rota) cai no armazém do browser — sem «HTTP 404»', async () => {
  /* /api/rpc de uma instalação antiga: HTTP 404 com a frase da rota */
  const { texto } = await abrir({ projeto: { http: 404, corpo: { error: 'a base ainda não serve «/ops/projetos/p_fantasma»' } } });

  assert.ok(texto.length > 200, 'a mesa abriu');
  assert.doesNotMatch(texto, /HTTP 404/);
  /* no armazém local o projeto também não existe: a frase honesta serve os dois casos */
  assert.match(texto, /Projeto não encontrado|Modo local/);
});

test('F5 (estático): a CSS do telemóvel tem toques de 44 px e a caixa acompanha o ficheiro', () => {
  /* Isto lê o que está escrito. Pixéis medidos exigem um browser — o relatório
     diz que a medição não foi feita aqui. */
  assert.match(HTML, /\.md-fig-caixa[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  assert.match(HTML, /object-fit:\s*contain/);
  assert.match(HTML, /\.md-item-acts \.btn[^{]*\{[^}]*min-height:\s*44px/s);
  assert.match(HTML, /\.md-sel[^{]*\{[^}]*font-size:\s*16px/s, '16 px evita o zoom automático do iOS');
});
