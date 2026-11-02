/* ===========================================================================
   1.57.1 · OS BOTÕES — provas

   Pedido do dono: «melhore visualmente os botões no sistema deste (ampliar até
   terminal)». Este ficheiro prova o que se pode provar sem browser:

     · a escala dos botões da mesa — 46 px de altura (48 no telemóvel), 38 nos
       pequenos, raio, ícone, foco visível, estados desactivados;
     · as variantes que existem (primária, fantasma, discreta, perigo);
     · os botões que não são `.btn` (pastilha de envios, chips de filtro) também
       têm alvo de dedo;
     · os botões do terminal da oficina — «executar», filtros por sala e fechar —
       cresceram e têm anel de foco.

   O que NÃO se prova: pixéis medidos num ecrã a sério (não há browser aqui) nem
   a aparência final no telemóvel do dono.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { JSDOM } from 'jsdom';

const MESA = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');
const SHELL = fs.readFileSync(new URL('./src/shell.html', import.meta.url), 'utf8');

/** A regra CSS de um selector, sem comentários, para se poder medir o que diz. */
function regra(css, selector) {
  const re = new RegExp(`(^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const m = css.match(re);
  return m ? m[2].replace(/\s+/g, ' ').trim() : null;
}

const px = (corpo, prop) => {
  const m = corpo && corpo.match(new RegExp(`${prop}\\s*:\\s*(-?[\\d.]+)px`));
  return m ? Number(m[1]) : null;
};

test('mesa: o botão base tem 46 px de altura, respiro lateral e ícone de 18 px', () => {
  const btn = regra(MESA, '.btn');
  assert.ok(btn, 'a regra .btn tem de existir');
  /* a altura é um token (`--btn-h`), para o telemóvel a poder subir num sítio só */
  assert.match(btn, /min-height:\s*var\(--btn-h\)/, 'altura pelo token');
  assert.match(MESA, /\.btn \{\s*--btn-h:\s*46px/, '46 px de altura no desktop');
  assert.match(btn, /padding:\s*0\s+20px/, '20 px de cada lado');
  assert.match(btn, /border-radius:\s*11px/);
  assert.match(btn, /font-size:\s*14\.5px/);
  assert.match(btn, /cursor:\s*pointer/);
  assert.match(regra(MESA, '.btn .ic') || '', /width:\s*18px/, 'o ícone alinha com a letra');
});

test('mesa: há foco visível, hover e estado desactivado — não só repouso', () => {
  assert.match(regra(MESA, '.btn:focus-visible') || '', /outline:\s*2px solid var\(--blue\)/);
  assert.match(regra(MESA, '.btn:active') || '', /transform/);
  const desactivado = regra(MESA, '.btn:disabled, .btn[aria-disabled="true"]') || regra(MESA, '.btn:disabled');
  assert.match(desactivado || '', /cursor:\s*not-allowed/);
  assert.match(MESA, /\.btn:hover\s*\{[^}]*box-shadow/s);
});

test('mesa: primária, fantasma, discreta e perigo — cada uma com o seu contraste', () => {
  assert.match(regra(MESA, '.btn.primary') || '', /background:\s*var\(--blue\)/);
  assert.match(regra(MESA, '.btn.primary:hover') || '', /background:\s*#004EEB/);
  assert.match(regra(MESA, '.btn.ghost') || '', /border-color:\s*var\(--hair-strong\)/);
  assert.match(regra(MESA, '.btn.quiet') || '', /background:\s*transparent/);
  assert.match(regra(MESA, '.btn.danger') || '', /color:\s*var\(--risk\)/);
  const pequeno = regra(MESA, '.btn.small');
  assert.match(pequeno, /--btn-h:\s*38px/, 'os botões de tabela são mais baixos, não minúsculos');
  assert.match(pequeno, /font-size:\s*13px/);
});

test('mesa: no telemóvel os botões crescem para 48 px', () => {
  assert.ok(MESA.includes('@media (max-width: 820px)'), 'há um bloco para ecrãs estreitos');
  assert.match(MESA, /\.btn \{ --btn-h: 48px; font-size: 15px; padding: 0 18px; \}/);
  assert.match(MESA, /\.btn\.small \{ --btn-h: 42px; font-size: 13\.5px; \}/);
});

test('mesa: pastilha e chips também são alvo de dedo, com foco visível', () => {
  assert.equal(px(regra(MESA, '.pill'), 'min-height'), 42);
  assert.match(regra(MESA, '.pill:focus-visible') || '', /outline:\s*2px/);
  assert.equal(px(regra(MESA, '.chip'), 'min-height'), 38);
  assert.match(regra(MESA, '.chip:focus-visible') || '', /outline:\s*2px/);
  /* os botões de copiar e o menu do projeto */
  assert.equal(px(regra(MESA, '.pj-copy'), 'width'), 36);
  assert.equal(px(regra(MESA, '.pj-menu-b'), 'width'), 44);
});

test('terminal: «executar» tem 36 px, filtros 30 e fechar 32×32, todos com foco', () => {
  const executar = regra(SHELL, '.tm-prompt button');
  assert.ok(executar, 'a regra do botão «executar» tem de existir');
  assert.equal(px(executar, 'min-height'), 36);
  assert.match(executar, /padding:\s*0 16px/);
  assert.match(regra(SHELL, '.tm-prompt button:focus-visible') || '', /outline:\s*2px solid #6EF3A8/);

  const filtro = regra(SHELL, '.tm-tab');
  assert.equal(px(filtro, 'min-height'), 30);
  assert.match(filtro, /padding:\s*6px 12px/);
  assert.match(regra(SHELL, '.tm-tab:focus-visible') || '', /outline:\s*2px/);

  const fechar = regra(SHELL, '.tm-x');
  assert.equal(px(fechar, 'width'), 32);
  assert.equal(px(fechar, 'height'), 32, 'o X do terminal deixa de ser um alvo de 15 px');
  assert.match(regra(SHELL, '.tm-x:focus-visible') || '', /outline:\s*2px/);
});

test('terminal: no telemóvel o «executar» cresce e o cabeçalho mantém os filtros', () => {
  assert.match(SHELL, /\.tm-prompt button \{ min-height: 42px; padding: 0 14px; font-size: 12px; \}/);
});

test('oficina: os botões de painel e os chips também subiram de escala', () => {
  assert.match(regra(SHELL, '.mc-tour-b .btn, .mc-sheet .btn') || '', /min-height:\s*34px/);
  assert.match(regra(SHELL, '#mChips button') || '', /min-height:\s*34px/);
  assert.equal(px(regra(SHELL, '#zoomCtl button'), 'width'), 46);
  assert.match(regra(SHELL, '.lv-foot button') || '', /min-height:\s*34px/);
});

/* ---------- a mesma coisa, num DOM: os botões do ecrã têm todos classe ---------- */

const PROJETO = {
  project: {
    id: 'p1', name: 'Clínica Aurora', niche: 'dentária', client: 'Aurora Lda', city: 'Coimbra',
    kind: 'landing', status: 'aprovado', lead_id: null, brief: 'x', goals: [], acceptance: [],
  },
  qa: { passed: true, at: '2026-10-20T10:00:00Z', report: [] },
  files: [], changes: [], deliveries: [], events: [],
};
const MAPA = {
  '/auth/eu': { user: { id: 'u1', name: 'Valdimiro', role: 'owner' }, modo: 'base', perms: {} },
  '/ops/summary': { ok: true, custos: { apiCentimos: 0 } },
  '/ops/today': { ok: true, decidir: [] },
  '/ops/leads': { leads: [] },
  '/ops/projetos': { projetos: [], resumo: null, tipos: [] },
  '/ops/projetos/p1': PROJETO,
  '/ops/projetos/p1/briefing': { campos: [], briefing: { valores: {}, origens: {} }, master: null, emFalta: [] },
  '/ops/projetos/p1/media': { geracoes: [], opcoes: {}, uso: {}, limites: {} },
  '/ops/clientes': { clientes: [], activo: null },
  '/ops/saldo': {}, '/ops/messages': { messages: [] },
};

test('DOM: na página do projeto nenhum botão fica sem estilo, e a acção principal é primária', async () => {
  const dom = new JSDOM(MESA, {
    url: 'https://mesa.test/#/projeto/p1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.fetch = async (url, opt = {}) => {
        const u = String(url);
        const caminho = u.includes('/api/rpc') ? JSON.parse(opt.body || '{}').caminho : new URL(u, 'https://mesa.test').pathname;
        const rota = caminho.split('?')[0];
        return { ok: true, status: 200, json: async () => ({ status: 200, corpo: MAPA[rota] ?? {} }) };
      };
    },
  });
  await new Promise((r) => setTimeout(r, 400));
  const doc = dom.window.document;

  const semClasse = [...doc.querySelectorAll('#main button')].filter((b) => !b.getAttribute('class'));
  assert.deepEqual(semClasse.map((b) => b.textContent.trim()), [], 'todo o botão da vista tem classe');

  const primarios = [...doc.querySelectorAll('#main .btn.primary')];
  assert.ok(primarios.length >= 1, 'há uma acção principal visível');
  assert.ok([...doc.querySelectorAll('#main .btn')].every((b) => b.tagName === 'BUTTON' || b.tagName === 'A'));
});
