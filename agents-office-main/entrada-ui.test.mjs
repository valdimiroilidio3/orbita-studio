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

async function abrir({ entrada = ENTRADA, entraComCodigo = false, semCodigo = false, primeiraConta = true, url = 'https://mesa.test/app' } = {}) {
  const pedidos = [];
  let sessao = false;
  const dom = new JSDOM(HTML, {
    url,
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
  /* 1.73.0 · a frase que a página mostra é curta; a precisão (nome da variável,
     sítio, endereço de retorno) vive no «Estado da instalação», que o clique abre */
  assert.match(t, /ainda não está ligada a esta instalação/);
  assert.ok(doc.querySelector('.enta-det[open]'), 'o clique abre o diagnóstico em vez de o despejar na página');
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
  assert.match(t, /correio ainda não está ligado/, 'a página diz o essencial numa frase');
  assert.match(t, /palavra-passe/, 'e diz que a palavra-passe ainda serve');
  assert.ok(doc.querySelector('.enta-det[open]'), 'e abre o diagnóstico');
  assert.match(t, /RESEND_API_KEY/, 'nomeia a chave, no diagnóstico');
  assert.match(t, /resend\.com/, 'e o sítio');
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

/* ===========================================================================
   1.71.0 · o ecrã a dois tempos
   =========================================================================== */

test('1.71.0 · a entrada tem o palco: arte à esquerda, formulário à direita', async () => {
  const { doc } = await abrir();
  const palco = doc.querySelector('.palco');
  assert.ok(palco, 'o palco existe');
  const arte = palco.querySelector('.palco-arte');
  const lado = palco.querySelector('.palco-lado');
  assert.ok(arte && lado, 'as duas metades');
  assert.ok(arte.querySelectorAll('.anel').length >= 9, 'os anéis do fundo');
  assert.ok(lado.querySelector('#lgEmail'), 'o formulário é o de sempre, na metade direita');
});

test('1.71.0 · as portas a girar são GitHub, Google, email e código — e o ícone contra-gira', async () => {
  const { doc } = await abrir();
  const portas = [...doc.querySelectorAll('.palco-arte .porta')].map((p) => p.className);
  for (const id of ['github', 'google', 'email', 'codigo']) {
    assert.ok(portas.some((c) => c.includes(`porta-${id}`)), `a porta ${id} gira na arte`);
  }
  const orbitas = [...doc.querySelectorAll('.palco-arte .orbita')];
  assert.equal(orbitas.length, 5, 'cinco órbitas, cinco portas');
  assert.ok(orbitas.some((o) => o.classList.contains('reversa')), 'há um sentido contrário');
  /* o ícone tem de contra-girar: sem isto fica de pernas para o ar a meio da volta */
  const svg = doc.querySelector('.palco-arte .porta svg');
  assert.ok(svg, 'a porta tem o ícone da marca');
});

test('1.71.0 · a cascata e o halo existem no ficheiro publicado (não são decoração de teste)', async () => {
  const css = HTML;
  assert.match(css, /@keyframes orbitaGiro/);
  assert.match(css, /@keyframes anelPulso/);
  assert.match(css, /@keyframes revEntra/);
  assert.match(css, /\.enta-in \{[\s\S]{0,700}--mx/, 'o halo usa as coordenadas do rato');
  assert.match(css, /prefers-reduced-motion[\s\S]{0,120}animation: none/, 'e pára para quem pediu menos movimento');
  assert.match(css, /@media \(max-width: 900px\)[\s\S]{0,160}\.palco-arte \{ display: none;? \}/,
    'no telemóvel a arte sai da frente do formulário');
});


/* ===========================================================================
   1.72.1 · a recusa do fornecedor, explicada no ecrã
   =========================================================================== */

test('1.72.1 · org_internal aparece em português, com o sítio onde se resolve', async () => {
  const { texto } = await abrir({ url: 'https://mesa.test/app?erroEntrada=google%3Aorg_internal' });
  const t = texto();
  assert.match(t, /só aceita contas da organização/, 'o ecrã diz o que aconteceu');
  assert.match(t, /Externo/, 'e o que mudar');
  assert.match(t, /Google Auth Platform|OAuth consent screen/, 'e onde');
  assert.doesNotMatch(t, /Apenas usuarios da organizacao/, 'não despeja o texto inglês da Google');
});

test('1.74.0 · a recusa do Google traz o botão que abre a consola onde se resolve', async () => {
  const { doc } = await abrir({ url: 'https://mesa.test/app?erroEntrada=google%3Aorg_internal' });
  const atalho = doc.querySelector('.enta-aviso .enta-consola');
  assert.ok(atalho, 'há um atalho dentro do aviso');
  assert.match(atalho.getAttribute('href'), /console\.cloud\.google\.com/);
  assert.equal(atalho.getAttribute('target'), '_blank');
  assert.match(atalho.getAttribute('rel'), /noopener/);
});

test('1.72.1 · uma recusa que não conhecemos aparece com o código à vista (não se inventa uma explicação)', async () => {
  const { texto } = await abrir({ url: 'https://mesa.test/app?erroEntrada=google%3Aalgum_codigo_novo' });
  const t = texto();
  assert.match(t, /algum_codigo_novo/);
  assert.match(t, /tenta outra vez/i);
});

/* 1.73.0 · o dono olhou para esta página e chamou-lhe «ridícula»: meia dúzia de
   parágrafos técnicos por baixo de dois campos. Este teste agarra o que ele
   pediu — a página mostra título, uma linha, os caminhos, os campos e um botão;
   o diagnóstico existe, mas fechado. */
test('1.73.0 · a entrada não é um diagnóstico: o texto técnico só vive dentro do «Estado da instalação»', async () => {
  const { doc, texto } = await abrir();
  const det = doc.querySelector('.enta-det');
  assert.ok(det, 'o diagnóstico existe — não se apagou funcionalidade');
  assert.equal(det.hasAttribute('open'), false, 'mas fechado: a página não começa por ele');
  assert.equal(doc.querySelector('.enta-det > summary').textContent.trim(), 'Estado da instalação');

  /* o que se lê com os olhos, sem abrir nada: o cartão sem o painel */
  const copia = doc.documentElement.cloneNode(true);
  copia.querySelectorAll('.enta-det, script, style').forEach((n) => n.remove());
  const visivel = copia.textContent.replace(/\s+/g, ' ');
  for (const proibido of [/RESEND_API_KEY/, /SETUP_TOKEN/, /modo actual/i, /Continuar sem contas/i, /O que falta nesta instalação/i, /state inválido/i]) {
    assert.doesNotMatch(visivel, proibido, `${proibido} não aparece na face da página`);
  }
  assert.match(visivel, /Entrar como dono/);
  assert.match(visivel, /GitHub/);
  assert.ok(doc.querySelector('#lgEmail') && doc.querySelector('#lgPass'), 'os dois campos');
  assert.ok(doc.querySelector('.enta-btn[data-act="criar-primeira-conta"]'), 'e um botão');
  assert.equal(doc.querySelectorAll('.enta-campo').length >= 2, true, 'cada campo tem rótulo em cima');
  assert.ok(doc.querySelector('.enta-lb[for="lgEmail"]'), 'o rótulo aponta para o campo');
});

test('1.73.0 · a palavra-passe pode ser vista e escondida outra vez (sem a copiar para lado nenhum)', async () => {
  const { doc, w } = await abrir();
  const campo = doc.querySelector('#lgPass');
  assert.equal(campo.type, 'password');
  const olho = doc.querySelector('#lgPass').parentElement.querySelector('[data-act="ver-passe"]');
  assert.ok(olho, 'há um botão para ver');
  olho.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(campo.type, 'text');
  assert.equal(olho.getAttribute('aria-pressed'), 'true');
  olho.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  assert.equal(campo.type, 'password');
  assert.equal(olho.getAttribute('aria-pressed'), 'false');
});
