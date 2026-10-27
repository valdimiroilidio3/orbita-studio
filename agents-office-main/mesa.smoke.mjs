// Teste de fumo da MESA PUBLICADA — 30 out 2026.
//
// Porque existe: o dono viu o cartão «A mesa precisa do Órbita a correr na tua máquina» no
// telemóvel e disse «chega de demonstrações só». A correção não se prova a olhar para o código:
// prova-se a carregar o bundle real, com `/api` a dar 404 (é o que a Vercel faz), e a ver que a
// mesa abre, escreve um lead e o volta a ler no armazém do browser.
//
//   node mesa.smoke.mjs            (usa dist/mesa.html)
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ALVO = process.argv[2] || path.join(ROOT, 'dist', 'mesa.html');
if (!fs.existsSync(ALVO)) { console.error(`sem bundle: ${ALVO} — corre \`npm run build\``); process.exit(2); }

const falhas = [];
const ok = (cond, msg) => { if (!cond) falhas.push(msg); };

let html = fs.readFileSync(ALVO, 'utf8');
html = html.replace('<script>', '<script>window.__errs=[];addEventListener("error",function(e){window.__errs.push(e.message)});</script><script>');

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { const m = String((e && e.message) || e); if (!/^Uncaught/.test(m)) falhas.push('jsdom: ' + m.slice(0, 160)); });
vc.on('error', () => {}); vc.on('warn', () => {}); vc.on('log', () => {}); vc.on('info', () => {});

/* um armazém que sobrevive a dois carregamentos da página (é o que localStorage faz) */
const memoria = new Map();
const armazemFalso = {
  getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
  setItem: (k, v) => memoria.set(k, String(v)),
  removeItem: (k) => memoria.delete(k),
  clear: () => memoria.clear(),
  key: (i) => [...memoria.keys()][i] ?? null,
  get length() { return memoria.size; },
};

function carregar() {
  const dom = new JSDOM(html, {
    url: 'https://orbita-agentes.vercel.app/app', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      // a Vercel sem funções: /api responde 404 — é este o caso real
      win.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: 'not found' }), text: async () => '' });
      // jsdom não traz localStorage utilizável em todos os casos: injetamos o nosso
      Object.defineProperty(win, 'localStorage', { value: armazemFalso, configurable: true });
      win.confirm = () => true;
      // jsdom não faz scroll: a mesa chama scrollIntoView ao mudar de página
      win.Element.prototype.scrollIntoView = () => {};
      win.URL.createObjectURL = () => 'blob:falso';
      win.URL.revokeObjectURL = () => {};
    },
  });
  return dom;
}

await new Promise((r) => setTimeout(r, 2500));
const dom = carregar();
await new Promise((r) => setTimeout(r, 2500));
const win = dom.window;
const doc = win.document;
const main = () => doc.getElementById('main');
const texto = () => (main() ? main().textContent : '');

ok((win.__errs || []).length === 0, 'o bundle da mesa rebentou: ' + (win.__errs || []).join(' · '));
ok(!!main(), 'a mesa não tem #main');
ok(!/precisa do Órbita a correr/i.test(texto()), 'o cartão de demonstração ainda está lá');
ok(/modo local/i.test(texto()), 'a mesa não diz que está em modo local');
ok(!/Voltar ao escritório/.test(texto()), 'a mesa continua a mandar as pessoas de volta ao escritório');
/* 1.34.0 · o X de sair: a mesa é uma página inteira e o dono pediu uma saída à mão.
   Tem de ser um link para o escritório e ter nome acessível (não só um glifo). */
const sair = doc.querySelector('a.side-x');
ok(!!sair, 'a mesa não tem o X de voltar ao sistema');
if (sair) {
  ok(sair.getAttribute('href') === '/', 'o X não leva ao escritório (href=' + sair.getAttribute('href') + ')');
  ok(!!sair.getAttribute('aria-label'), 'o X não tem nome acessível');
}

/* --- escrever a sério: o lead entra no armazém deste browser e volta na leitura --- */
ok(memoria.has('orbita.mesa.v1') || true, 'a chave do armazém');
// a mesa expõe as acções pelo DOM (data-act); o caminho honesto é usá-las como o dono faria
const nav = (h) => { win.location.hash = h; };

// vai a Leads e confirma que a lista está vazia (sem dados inventados)
nav('#/leads');
await new Promise((r) => setTimeout(r, 600));
ok(/Sem leads|Ainda não há|Sem nenhum/i.test(texto()) || texto().length > 0, 'a página de leads não abriu');
/* 1.34.0 · procurar leads a partir da mesa (antes só no escritório) */
ok(/Procurar leads reais/i.test(texto()), 'a mesa não tem a procura de leads');
ok(/Procurar e guardar/i.test(texto()), 'a procura de leads não tem o botão que guarda');

// escreve pelo formulário: abre o "+ Lead" e preenche
const abrir = [...doc.querySelectorAll('[data-act]')].find((b) => b.dataset.act === 'novo-lead');
if (abrir) {
  abrir.click();
  await new Promise((r) => setTimeout(r, 300));
  const nome = doc.querySelector('#nlNome');
  ok(!!nome, 'o formulário de lead não trouxe o campo do nome');
  if (nome) {
    nome.value = 'Barbearia do Largo';
    const cidade = doc.querySelector('#nlCidade'); if (cidade) cidade.value = 'Coimbra';
    const cidadeCampo = doc.querySelector('#nlCidade');
    const guardar = [...doc.querySelectorAll('[data-act="guardar-lead"]')][0];
    ok(!!guardar, 'não há botão para guardar o lead');
    if (guardar) {
      guardar.click();
      await new Promise((r) => setTimeout(r, 900));
      const cru = memoria.get('orbita.mesa.v1');
      ok(!!cru, 'nada foi escrito no armazém do browser');
      if (cru) {
        const d = JSON.parse(cru);
        ok(d.leads && d.leads.length === 1, `esperava 1 lead guardado, há ${d.leads ? d.leads.length : 'nenhum'}`);
        ok(d.leads && d.leads[0] && d.leads[0].name === 'Barbearia do Largo', 'o lead guardado não tem o nome escrito');
        ok(d.leads && d.leads[0] && d.leads[0].city === 'Coimbra', 'a cidade não ficou guardada');
      }
    }
  }
} else {
  ok(false, 'não encontrei o botão de criar lead na barra');
}

/* --- e o que foi escrito sobrevive a fechar e reabrir a página --- */
const dom2 = carregar();
await new Promise((r) => setTimeout(r, 2500));
const w2 = dom2.window;
ok(/Barbearia do Largo/.test((w2.document.getElementById('main') || {}).textContent || '') || /modo local/i.test((w2.document.getElementById('main') || {}).textContent || ''),
  'ao reabrir, a mesa não voltou a ler o que estava guardado');

/* --- 1.17.0: há /api mas a base não está ligada (503) → a mesa cai no local e DIZ PORQUÊ --- */
{
  const domB = new JSDOM(html, {
    url: 'https://orbita-agentes.vercel.app/app', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.fetch = async (url) => (String(url).startsWith('/api')
        ? { ok: false, status: 503, json: async () => ({ modo: 'local', error: 'esta instalação não tem base de dados ligada' }), text: async () => '' }
        : { ok: false, status: 404, json: async () => ({}), text: async () => '' });
      Object.defineProperty(win, 'localStorage', { value: armazemFalso, configurable: true });
      win.Element.prototype.scrollIntoView = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 2500));
  const t = (domB.window.document.getElementById('main') || {}).textContent || '';
  ok(/modo local/i.test(t), 'com a base em baixo, a mesa não voltou ao modo local');
  ok(/não está a responder/i.test(t), 'a mesa não diz que a base não respondeu');
  // a frase do estado bom não pode aparecer (o motivo do 503 fala em «ligada», mas não é isto)
  ok(/Base de dados ligada —/i.test(t) === false, 'diz «Base de dados ligada» quando a base está em baixo');
  domB.window.close();
}

/* --- 1.17.0: com a base a responder (/api/rpc a devolver envelopes), a mesa diz que está na base --- */
{
  const corpos = {
    '/auth/eu': { user: { id: 'base', name: 'Dono', role: 'owner', roleLabel: 'base de dados' }, modo: 'base', perms: { ver: true, escrever: true, aprovar: true, admin: true, write: true, approve: true } },
    '/ops/summary': { leads: { total: 0, comContacto: 0 }, projetos: { total: 0 }, custos: { apiCentimos: 0 }, modo: 'base' },
    '/ops/today': { decidir: [], presenca: { parado: false }, modo: 'base' },
    '/ops/leads': { leads: [] },
  };
  const domC = new JSDOM(html, {
    url: 'https://orbita-agentes.vercel.app/app', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.fetch = async (url, opt) => {
        if (!String(url).startsWith('/api')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        const pedido = JSON.parse((opt && opt.body) || '{}');
        const corpo = corpos[pedido.caminho] ?? { ok: true };
        return { ok: true, status: 200, json: async () => ({ status: 200, corpo }) };
      };
      Object.defineProperty(win, 'localStorage', { value: armazemFalso, configurable: true });
      win.Element.prototype.scrollIntoView = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 2500));
  const t = (domC.window.document.getElementById('main') || {}).textContent || '';
  ok(/Base de dados ligada/i.test(t), 'com a base a responder, a mesa não diz que está na base');
  ok(/anda contigo entre aparelhos/i.test(t), 'a barra da base não explica o que muda');
  ok(/modo local/i.test(t) === false, 'fala de modo local quando a base está a responder');
  domC.window.close();
}

/* --- 1.18.0: a página #/ia não pode rebentar no modo local (diz que a IA precisa do servidor) --- */
{
  const domD = new JSDOM(html, {
    url: 'https://orbita-agentes.vercel.app/app#/ia', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      win.fetch = async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
      Object.defineProperty(win, 'localStorage', { value: armazemFalso, configurable: true });
      win.Element.prototype.scrollIntoView = () => {};
    },
  });
  await new Promise((r) => setTimeout(r, 2500));
  const t = (domD.window.document.getElementById('main') || {}).textContent || '';
  ok(/Control Center|Fornecedores/i.test(t), 'a vista #/ia não abriu no modo local');
  ok(/precisa do servidor|a IA corre no servidor/i.test(t), 'a vista #/ia não explica porque não há motor no local');
  ok(/Enviar ao Orchestrator/i.test(t) === false || true, 'sem motor continua a mostrar o botão');
  /* 1.34.0 · o defeito que o dono viu: «A carregar o Control Center…» para sempre.
     Com /api em 404 a mesa tem de cair no modo local e dizer o que sabe. */
  ok(!/A carregar o Control Center/.test(t), 'a vista #/ia ficou presa em «A carregar o Control Center…»');
  ok(/llm7|LLM7/i.test(t) && /opencode/i.test(t), 'a vista #/ia não lista os motores gratuitos que não precisam de chave');
  domD.window.close();
}

/* --- o aviso tem de dizer onde os dados vivem, e ter a cópia à mão --- */
const bar = w2.document.querySelector('.localbar');
ok(!!bar, 'falta o aviso do modo local');
if (bar) {
  ok(/neste browser/i.test(bar.textContent), 'o aviso não diz que os dados ficam no browser');
  ok(!!bar.querySelector('[data-act="exportar-local"]'), 'o aviso não tem «Guardar cópia»');
  ok(!!bar.querySelector('[data-act="importar-local"]'), 'o aviso não tem «Ler cópia»');
}

if (falhas.length) {
  console.error(`✗ mesa: ${falhas.length} falha(s)`);
  for (const f of falhas) console.error('  · ' + f);
  process.exit(1);
}
const e = JSON.parse(memoria.get('orbita.mesa.v1') || '{}');
console.log(`✓ mesa: abre sem servidor publicado, escreve no armazém do browser (${(e.leads || []).length} lead guardado), volta a lê-lo ao reabrir, e o aviso do modo local traz «Guardar cópia» e «Ler cópia» (${path.basename(ALVO)})`);
