/* ===========================================================================
   1.69.0 · O ECRÃ DE ENTRADA (6 nov 2026)

   `entrada.test.mjs` prova o servidor. Este prova o que a pessoa vê, contra
   `dist/mesa.html` (o ficheiro publicado):

     · três caminhos na mesma coluna: GitHub, Google, email com código;
     · a instalação diz em voz alta que é de um dono só, com o email mascarado;
     · um caminho sem chaves NÃO fica com um botão cinzento: o clique diz o nome
       da variável e o sítio onde se cria;
     · quando o correio está ligado, pedir o código leva ao campo de 6 dígitos;
     · quando o servidor responde «precisaCodigo», o ecrã vai para o código em
       vez de fingir que entrou.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = fs.readFileSync(new URL('./dist/mesa.html', import.meta.url), 'utf8');

const ENTRADA = {
  soDono: true,
  donos: ['che******@gmail.com'],
  variavelDoDono: 'ORBITA_DONO_EMAIL',
  fornecedores: [
    { id: 'github', nome: 'GitHub', pronto: false, falta: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'], retorno: 'https://orbita.exemplo.pt/api/oauth?fornecedor=github', como: { onde: 'GitHub → Settings → Developer settings → OAuth Apps', nota: '', texto: '' } },
    { id: 'google', nome: 'Google', pronto: false, falta: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], retorno: 'https://orbita.exemplo.pt/api/oauth?fornecedor=google', como: { onde: 'Google Cloud Console → Credentials', nota: '', texto: '' } },
  ],
  codigo: { pronto: false, falta: ['RESEND_API_KEY'], minutos: 10, como: { onde: 'resend.com → API Keys', texto: 'RESEND_API_KEY na Vercel', nota: '' } },
  palavraPasse: { pronto: true, comCodigo: false },
};

const EU = { user: { id: 'u1', name: 'Chelton', role: 'dono' }, perms: { admin: true, read: true, write: true, approve: true }, horasSessao: 12, modo: 'base' };

async function abrir({ entrada = ENTRADA, entraComCodigo = false, semCodigo = false, primeiraConta = true } = {}) {
  const pedidos = [];
  let sessao = false;
  const dom = new JSDOM(HTML, {
    url: 'https://mesa.test/app',
    runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.HTMLElement.prototype.scrollIntoView = () => {};
      w.matchMedia = (q) => ({ matches: /max-width: 820px/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
      w.fetch = async (url, opt = {}) => {
        const b = JSON.parse(opt.body || '{}');
        const caminho = String(b.caminho || '');
        const corpo = b.corpo || {};
        pedidos.push({ caminho, metodo: b.metodo, corpo });
        const ok = (c, status = 200) => ({ ok: true, status: 200, json: async () => ({ status, corpo: c }) });
        if (caminho === '/auth/eu') {
          if (!sessao) {
            return ok({
              error: 'entra', mode: 'sessao', hint: 'esta instalação ainda não tem contas',
              primeiraContaPossivel: primeiraConta, estado: { modo: 'sessao', entrada },
            }, 401);
          }
          return ok(EU);
        }
        if (caminho === '/auth/codigo' && b.metodo === 'POST') {
          if (!entrada.codigo.pronto) {
            return ok({ error: 'não há correio configurado: o código não pode sair daqui', falta: ['RESEND_API_KEY'], como: 'resend.com → API Keys; depois RESEND_API_KEY na Vercel', alternativa: 'entra com o email e a palavra-passe — sem correio, é o caminho que existe' }, 503);
          }
          return ok({ ok: true, enviado: true, para: 'che******@gmail.com', minutos: 10, mensagem: 'o código foi para che******@gmail.com — vale 10 minutos' });
        }
        if (caminho === '/auth/codigo/verificar') { sessao = true; return ok({ ...EU, entrouPorCodigo: true }); }
        if (caminho === '/auth/entrar' && b.metodo === 'POST') {
          if (entraComCodigo) return ok({ ok: true, precisaCodigo: true, para: 'che******@gmail.com', minutos: 10, mensagem: 'falta o código: foi para che******@gmail.com' });
          sessao = true; return ok({ ...EU, semCodigo: semCodigo ? true : undefined, nota: semCodigo ? 'entrou com a palavra-passe: não há RESEND_API_KEY' : undefined });
        }
        return ok({});
      };
    },
  });
  await new Promise((r) => setTimeout(r, 700));
  const doc = dom.window.document;
  doc.querySelectorAll('script, style').forEach((n) => n.remove());
  return { dom, doc, w: dom.window, pedidos, texto: () => doc.body.textContent.replace(/\s+/g, ' ') };
}

const esperar = (ms = 500) => new Promise((r) => setTimeout(r, ms));

test('1.69.0 · o ecrã de entrada oferece GitHub, Google e email — e diz que é de um dono só', async () => {
  const { doc, texto } = await abrir();
  const t = texto();
  assert.match(t, /Entrar como dono/);
  assert.ok(doc.querySelector('[data-act="oauth"][data-fornecedor="github"]'), 'há o botão do GitHub');
  assert.ok(doc.querySelector('[data-act="oauth"][data-fornecedor="google"]'), 'há o botão do Google');
  assert.ok(doc.querySelector('#lgEmail'), 'há o campo do email');
  assert.ok(doc.querySelector('[data-act="pedir-codigo"]'), 'e o caminho do código por email');
  assert.match(t, /um dono só/, 'a instalação diz quem entra');
  assert.match(t, /che\*+@gmail\.com/, 'com o email mascarado, não inteiro');
  assert.doesNotMatch(t, /Criar conta/, 'não há registo aberto num produto de uma pessoa');
});

test('1.69.0 · um fornecedor sem chaves não é um botão morto: o clique diz o que falta', async () => {
  const { doc, w, texto } = await abrir();
  const btn = doc.querySelector('[data-act="oauth"][data-fornecedor="github"]');
  assert.equal(btn.hasAttribute('disabled'), false, 'nunca `disabled` — o botão explica-se');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(200);
  const t = texto();
  assert.match(t, /GITHUB_CLIENT_ID/, 'o nome da variável, à letra');
  assert.match(t, /OAuth Apps/, 'e o sítio onde se cria a aplicação');
  assert.match(t, /\/api\/oauth\?fornecedor=github/, 'com o endereço de retorno para colar');
});

test('1.69.0 · sem correio, pedir o código diz o que falta e qual é o caminho que existe', async () => {
  const { doc, w, texto } = await abrir();
  doc.querySelector('#lgEmail').value = 'cheltonmahoze7@gmail.com';
  doc.querySelector('[data-act="pedir-codigo"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(500);
  const t = texto();
  assert.match(t, /RESEND_API_KEY/, 'nomeia a chave');
  assert.match(t, /resend\.com/, 'e o sítio');
  assert.match(t, /palavra-passe/, 'e diz que a palavra-passe ainda serve');
  assert.doesNotMatch(t, /Falta o código/, 'não avança para um ecrã onde nada pode chegar');
});

test('1.69.0 · com correio ligado, pedir o código leva ao campo de 6 dígitos', async () => {
  const entrada = { ...ENTRADA, codigo: { ...ENTRADA.codigo, pronto: true, falta: [] } };
  const { doc, w, pedidos, texto } = await abrir({ entrada });
  doc.querySelector('#lgEmail').value = 'cheltonmahoze7@gmail.com';
  doc.querySelector('[data-act="pedir-codigo"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(600);
  const t = texto();
  assert.match(t, /Falta o código/);
  assert.ok(doc.querySelector('#lgCodigo'), 'há um campo para os 6 dígitos');
  assert.ok(doc.querySelector('[data-act="verificar-codigo"]'));
  assert.ok(pedidos.some((p) => p.caminho === '/auth/codigo' && p.metodo === 'POST'), 'pediu o código ao servidor');
});

test('1.69.0 · o código de 6 dígitos entra: chama o servidor e abre a mesa', async () => {
  const entrada = { ...ENTRADA, codigo: { ...ENTRADA.codigo, pronto: true, falta: [] } };
  const { doc, w, pedidos, texto } = await abrir({ entrada });
  doc.querySelector('#lgEmail').value = 'cheltonmahoze7@gmail.com';
  doc.querySelector('[data-act="pedir-codigo"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(600);
  const campo = doc.querySelector('#lgCodigo');
  campo.value = '123456';
  doc.querySelector('[data-act="verificar-codigo"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(700);
  const pedido = pedidos.find((p) => p.caminho === '/auth/codigo/verificar');
  assert.ok(pedido, 'falou com o servidor');
  assert.equal(pedido.corpo.codigo, '123456');
  assert.equal(pedido.corpo.email, 'cheltonmahoze7@gmail.com', 'o email é o que foi escrito — a máscara é só o que se mostra');
  assert.doesNotMatch(texto(), /Falta o código/, 'o ecrã do código fechou-se');
});

test('1.69.0 · «precisaCodigo» leva ao ecrã do código em vez de fingir que entrou', async () => {
  const { doc, w, texto } = await abrir({ entraComCodigo: true, primeiraConta: false });
  doc.querySelector('#lgEmail').value = 'cheltonmahoze7@gmail.com';
  doc.querySelector('#lgPass').value = 'uma-frase-bem-comprida-2026';
  doc.querySelector('[data-act="entrar"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await esperar(700);
  const t = texto();
  assert.match(t, /Falta o código/, 'a palavra-passe certa não é a entrada completa');
  assert.ok(doc.querySelector('#lgCodigo'));
});
