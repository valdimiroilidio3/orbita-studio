// Órbita — o motor de geração.
//
// Um projeto não é uma pasta com um prompt lá dentro: é um conjunto de ficheiros que abrem num
// browser e funcionam. Aqui há quatro pontos de partida — página de conversão, site
// institucional, loja com catálogo e sistema interno — e todos partilham as mesmas regras:
//
//   · nada de recursos externos (sem CDN, sem fontes remotas): o que é gerado abre offline;
//   · formulários com rótulo, validação e uma saída honesta (WhatsApp/telefone), não um envio
//     fingido para um servidor que não existe;
//   · dados do cliente em ficheiros JSON — vazios quando não foram dados, com estado vazio que
//     ensina, em vez de produtos inventados;
//   · acessibilidade mínima: lang, viewport, skip-link, foco visível, contraste, alvos de toque.
//
// O que este motor NÃO faz: publicar. Gerar código não é entregar um site — é o princípio.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { audit, now, uid } from './db.mjs';

export const KINDS = {
  landing: {
    label: 'Página de conversão',
    pages: ['index.html'],
    features: ['Cabeçalho com proposta de valor', 'Três blocos de benefício', 'Oferta com preço e prazo', 'Formulário de contacto com validação', 'Botão de WhatsApp'],
    acceptance: [
      'A página abre sem rede e sem erros de consola',
      'O formulário recusa nome vazio e telefone inválido',
      'O preço e o prazo aparecem tal como foram definidos',
      'Em ecrã de 375 px não há deslocamento horizontal',
    ],
  },
  institucional: {
    label: 'Site institucional',
    pages: ['index.html', 'sobre.html', 'servicos.html', 'contacto.html'],
    features: ['Quatro páginas com navegação comum', 'Sobre com história e equipa', 'Serviços com descrição e preço', 'Contacto com morada, telefone e formulário', 'Rodapé com dados legais'],
    acceptance: [
      'Todas as páginas abrem e a navegação funciona entre elas',
      'Cada página tem um só h1',
      'O formulário de contacto valida antes de preparar a mensagem',
      'Os links internos apontam para ficheiros que existem',
    ],
  },
  loja: {
    label: 'Loja online',
    pages: ['index.html'],
    features: ['Catálogo lido de data/products.json', 'Carrinho em localStorage', 'Totais e IVA calculados', 'Encomenda preparada por WhatsApp', 'Estado vazio quando não há produtos'],
    acceptance: [
      'Sem produtos, a loja mostra um estado vazio que ensina a preencher',
      'Adicionar e remover altera o total',
      'O carrinho sobrevive a um recarregamento',
      'O checkout monta a mensagem com os artigos e o total',
    ],
  },
  dashboard: {
    label: 'Sistema interno',
    pages: ['index.html'],
    features: ['Indicadores calculados a partir de data/dataset.json', 'Pesquisa e ordenação', 'Tabela com paginação simples', 'Exportação CSV', 'Estado vazio sem dados'],
    acceptance: [
      'Sem dados, os indicadores mostram zero e explicam porquê',
      'Pesquisar filtra a tabela sem recarregar',
      'Exportar produz um CSV com as linhas visíveis',
      'Não há números inventados: tudo vem do ficheiro de dados',
    ],
  },
};

export const STACKS = ['html'];
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slugify = s => String(s || 'projeto').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'projeto';

const ACCENT = { landing: '#2B3BF2', institucional: '#1F6F5C', loja: '#B4531E', dashboard: '#1F5FA8' };
const LABEL = { landing: 'Página de conversão', institucional: 'Site institucional', loja: 'Loja online', dashboard: 'Sistema interno' };

function meta(project, { title, description }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="description" content="${esc(description)}">
<title>${esc(title)}</title>
<link rel="stylesheet" href="styles.css">`;
}

function baseCss(project) {
  const accent = ACCENT[project.kind] || ACCENT.landing;
  return `/* ${project.name} — folha de estilo única, sem dependências externas.
   ${project.client || project.name}${project.city ? ' · ' + project.city : ''} */
:root {
  --ink: #14140F;
  --paper: #FBFAF6;
  --surface: #FFFFFF;
  --muted: #5C5C55;
  --hair: rgba(20,20,15,.12);
  --accent: ${accent};
  --accent-ink: #FFFFFF;
  --ok: #1E7F5C;
  --risk: #A93A22;
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px; --s8: 72px;
  --ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
  --serif: Georgia, "Times New Roman", serif;
  --r: 14px;
  --shadow: 0 1px 2px rgba(20,20,15,.05), 0 12px 34px rgba(20,20,15,.07);
}
* { margin: 0; padding: 0; box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { background: var(--paper); color: var(--ink); font-family: var(--ui); font-size: 16px; line-height: 1.55; -webkit-font-smoothing: antialiased; }
img, svg { max-width: 100%; }
a { color: inherit; }
:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: 6px; }
.skip { position: absolute; left: -9999px; top: 0; background: var(--ink); color: #fff; padding: 10px 16px; z-index: 50; }
.skip:focus { left: 12px; top: 12px; }
.wrap { width: min(1080px, 92vw); margin: 0 auto; }
header.site { border-bottom: 1px solid var(--hair); background: color-mix(in srgb, var(--paper) 92%, transparent); position: sticky; top: 0; z-index: 20; backdrop-filter: blur(8px); }
header.site .bar { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); padding: var(--s4) 0; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.01em; font-size: 18px; text-decoration: none; }
.brand .dot { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); flex: none; }
nav.main { display: flex; gap: var(--s5); }
nav.main a { text-decoration: none; color: var(--muted); font-size: 15px; }
nav.main a:hover, nav.main a[aria-current="page"] { color: var(--ink); }
.burger { display: none; border: 1px solid var(--hair); background: var(--surface); border-radius: 10px; padding: 8px 12px; font-size: 14px; }
h1 { font-family: var(--serif); font-size: clamp(34px, 5vw, 56px); line-height: 1.06; letter-spacing: -.02em; font-weight: 400; }
h2 { font-family: var(--serif); font-size: clamp(24px, 3vw, 34px); line-height: 1.15; font-weight: 400; }
h3 { font-size: 18px; letter-spacing: -.01em; }
.lead { font-size: clamp(17px, 1.6vw, 20px); color: var(--muted); max-width: 60ch; }
section { padding: var(--s8) 0; }
.grid { display: grid; gap: var(--s4); }
.grid.three { grid-template-columns: repeat(3, 1fr); }
.card { background: var(--surface); border: 1px solid var(--hair); border-radius: var(--r); padding: var(--s5); box-shadow: var(--shadow); }
.eyebrow { text-transform: uppercase; letter-spacing: .14em; font-size: 11px; font-weight: 700; color: var(--accent); }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--accent); color: var(--accent-ink); padding: 14px 22px; border-radius: 999px; text-decoration: none; font-weight: 600; border: 1px solid transparent; min-height: 46px; }
.btn.ghost { background: transparent; color: var(--ink); border-color: var(--hair); }
.btn:hover { filter: brightness(1.05); }
form .field { display: flex; flex-direction: column; gap: 6px; margin-bottom: var(--s4); }
label { font-weight: 600; font-size: 14px; }
input, textarea, select { font: inherit; padding: 12px 14px; border: 1px solid var(--hair); border-radius: 10px; background: var(--surface); color: var(--ink); min-height: 46px; }
input:invalid, textarea:invalid { border-color: var(--risk); }
.hint { font-size: 13px; color: var(--muted); }
.error { color: var(--risk); font-size: 13px; min-height: 18px; }
.success { color: var(--ok); font-weight: 600; }
footer.site { border-top: 1px solid var(--hair); padding: var(--s6) 0; color: var(--muted); font-size: 14px; }
footer.site .wrap { display: flex; flex-wrap: wrap; gap: var(--s4); justify-content: space-between; }
.hero { display: grid; grid-template-columns: 1.15fr .85fr; gap: var(--s7); align-items: center; padding: var(--s8) 0; }
.hero .price { font-family: var(--serif); font-size: 40px; }
.pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--hair); border-radius: 999px; padding: 6px 12px; font-size: 13px; color: var(--muted); background: var(--surface); }
ul.checks { list-style: none; display: grid; gap: var(--s3); }
ul.checks li { display: flex; gap: 10px; align-items: flex-start; }
ul.checks li::before { content: '✓'; color: var(--accent); font-weight: 700; }
@media (max-width: 860px) {
  .hero { grid-template-columns: 1fr; gap: var(--s5); padding: var(--s7) 0; }
  .grid.three { grid-template-columns: 1fr; }
  nav.main { display: none; }
  nav.main.open { display: flex; flex-direction: column; position: absolute; left: 0; right: 0; top: 60px; background: var(--surface); border-bottom: 1px solid var(--hair); padding: var(--s4); gap: var(--s4); }
  .burger { display: inline-block; }
  section { padding: var(--s7) 0; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; animation: none !important; } }
`;
}

const BASE_JS_HEAD = `// Comportamento comum: menu no telemóvel, ano no rodapé e validação de formulários.
'use strict';
document.documentElement.classList.add('js');

var burger = document.querySelector('.burger');
var nav = document.querySelector('nav.main');
if (burger && nav) {
  burger.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
}

var year = document.querySelector('[data-year]');
if (year) year.textContent = String(new Date().getFullYear());

/** Valida um formulário e devolve os erros por campo. Sem bibliotecas, sem envio fingido. */
function validate(form) {
  var errors = {};
  var name = form.querySelector('[name="nome"]');
  var phone = form.querySelector('[name="telefone"]');
  var email = form.querySelector('[name="email"]');
  var message = form.querySelector('[name="mensagem"]');
  if (name && name.value.trim().length < 2) errors.nome = 'Escreve o teu nome.';
  if (phone && phone.value.replace(/\\D/g, '').length < 9) errors.telefone = 'Indica um telefone com 9 dígitos.';
  if (email && email.value && !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email.value)) errors.email = 'Esse email não parece válido.';
  if (message && message.value.trim().length < 5) errors.mensagem = 'Diz em duas palavras o que precisas.';
  return errors;
}

function wireForm(form, phoneTo) {
  form.setAttribute('novalidate', 'novalidate');
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    Object.keys(form.elements).forEach(function (k) { });
    var errors = validate(form);
    Array.prototype.forEach.call(form.querySelectorAll('.error'), function (el) { el.textContent = ''; });
    var keys = Object.keys(errors);
    if (keys.length) {
      keys.forEach(function (k) {
        var slot = form.querySelector('[data-error="' + k + '"]');
        if (slot) slot.textContent = errors[k];
      });
      var first = form.querySelector('[name="' + keys[0] + '"]');
      if (first) first.focus();
      return;
    }
    var nome = (form.querySelector('[name="nome"]') || {}).value || '';
    var telefone = (form.querySelector('[name="telefone"]') || {}).value || '';
    var mensagem = (form.querySelector('[name="mensagem"]') || {}).value || '';
    var texto = 'Olá! Sou ' + nome + '. ' + mensagem + (telefone ? ' O meu telefone é ' + telefone + '.' : '');
    var alvo = form.getAttribute('data-whatsapp') || phoneTo || '';
    var digits = String(alvo).replace(/\\D/g, '');
    var out = form.querySelector('[data-result]');
    if (out) {
      out.textContent = digits
        ? 'Mensagem preparada. Se o WhatsApp não abrir, liga ou envia para ' + alvo + '.'
        : 'Mensagem preparada. Copia-a e envia-nos por email ou telefone.';
      out.className = 'success';
    }
    if (digits) window.open('https://wa.me/' + digits + '?text=' + encodeURIComponent(texto), '_blank', 'noopener');
  });
}
Array.prototype.forEach.call(document.querySelectorAll('form[data-contacto]'), function (form) { wireForm(form); });
`;

function indexLanding(project, offer) {
  const name = project.client || project.name;
  const niche = project.niche || 'o teu negócio';
  const city = project.city || 'Portugal';
  const goals = project.goals.length ? project.goals : ['Mais contactos qualificados', 'Menos tempo perdido ao telefone', 'Uma presença que inspira confiança'];
  return `<!DOCTYPE html>
<html lang="pt">
<head>
${meta(project, { title: `${name} — ${project.name}`, description: project.brief.slice(0, 150) || `${name}, ${niche} em ${city}.` })}
</head>
<body>
<a class="skip" href="#conteudo">Saltar para o conteúdo</a>
<header class="site"><div class="wrap bar">
  <a class="brand" href="index.html"><span class="dot" aria-hidden="true"></span>${esc(name)}</a>
  <button class="burger" aria-expanded="false" aria-label="Abrir menu">Menu</button>
  <nav class="main" aria-label="Principal">
    <a href="#vantagens">Vantagens</a><a href="#oferta">Oferta</a><a href="#contacto">Contacto</a>
  </nav>
</div></header>
<main id="conteudo">
  <div class="wrap hero">
    <div>
      <span class="pill">${esc(niche)} · ${esc(city)}</span>
      <h1>${esc(project.brief.split('.')[0] || `${name}, feito para quem procura.`)}</h1>
      <p class="lead">${esc(project.brief || `${name} — ${niche} em ${city}. Uma página que explica o que fazes, mostra o preço e deixa a pessoa falar contigo num toque.`)}</p>
      <p style="margin-top: var(--s5); display:flex; gap: var(--s3); flex-wrap: wrap;">
        <a class="btn" href="#contacto">Falar contigo hoje</a>
        <a class="btn ghost" href="#oferta">Ver a oferta</a>
      </p>
    </div>
    <div class="card">
      <p class="eyebrow">Oferta</p>
      <p class="price">${offer.preco_eur ? esc(offer.preco_eur) + ' €' : 'a combinar'}</p>
      <p class="hint">${offer.prazo_dias ? `Entrega em ${esc(offer.prazo_dias)} dias` : 'Prazo definido contigo'}${offer.garantia ? ' · ' + esc(offer.garantia) : ''}</p>
      <ul class="checks" style="margin-top: var(--s4)">
        ${(offer.inclui || goals).slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}
      </ul>
    </div>
  </div>
  <section id="vantagens"><div class="wrap">
    <p class="eyebrow">Porquê nós</p>
    <h2>O que muda para ti</h2>
    <div class="grid three" style="margin-top: var(--s5)">
      ${goals.slice(0, 3).map((g, i) => `<div class="card"><h3>${esc(g)}</h3><p class="hint">${esc(['Falas com quem decide, sem intermediários.', 'Resposta no mesmo dia útil.', 'Sem letras pequenas: o preço é o preço.'][i] || 'Combinado por escrito antes de começar.')}</p></div>`).join('')}
    </div>
  </div></section>
  <section id="oferta" style="background: var(--surface); border-top: 1px solid var(--hair); border-bottom: 1px solid var(--hair);"><div class="wrap">
    <p class="eyebrow">A oferta</p>
    <h2>${offer.nome ? esc(offer.nome) : 'O que está incluído'}</h2>
    <ul class="checks" style="margin-top: var(--s5); max-width: 62ch">
      ${(offer.inclui || [...project.features, ...goals]).slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}
    </ul>
  </div></section>
  <section id="contacto"><div class="wrap" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6);align-items:start">
    <div>
      <p class="eyebrow">Contacto</p>
      <h2>Diz-nos o que precisas</h2>
      <p class="hint" style="margin-top: var(--s3)">Preenche e a mensagem fica pronta para enviares por WhatsApp. Nada é enviado sem tu veres o texto.</p>
      <p class="hint" style="margin-top: var(--s4)">${project.city ? esc(project.city) : ''}${offer.telefone ? ' · ' + esc(offer.telefone) : ''}</p>
    </div>
    <form class="card" data-contacto data-whatsapp="${esc(offer.telefone || '')}" aria-label="Formulário de contacto">
      <div class="field"><label for="nome">Nome</label><input id="nome" name="nome" autocomplete="name" required><span class="error" data-error="nome"></span></div>
      <div class="field"><label for="telefone">Telefone</label><input id="telefone" name="telefone" inputmode="tel" autocomplete="tel" required><span class="error" data-error="telefone"></span></div>
      <div class="field"><label for="mensagem">O que precisas</label><textarea id="mensagem" name="mensagem" rows="4" required></textarea><span class="error" data-error="mensagem"></span></div>
      <button class="btn" type="submit">Preparar mensagem</button>
      <p class="hint" data-result role="status" aria-live="polite"></p>
    </form>
  </div></section>
</main>
<footer class="site"><div class="wrap">
  <p>© <span data-year>2026</span> ${esc(name)}${project.city ? ' · ' + esc(project.city) : ''}</p>
  <p class="hint">Feito com o Órbita.</p>
</div></footer>
<script src="app.js"></script>
</body>
</html>`;
}

function pageShell(project, { current, title, body }) {
  const name = project.client || project.name;
  const nav = [['index.html', 'Início'], ['sobre.html', 'Sobre'], ['servicos.html', 'Serviços'], ['contacto.html', 'Contacto']];
  return `<!DOCTYPE html>
<html lang="pt">
<head>
${meta(project, { title: `${title} — ${name}`, description: `${name}${project.city ? ', ' + project.city : ''}. ${project.brief.slice(0, 120)}` })}
</head>
<body>
<a class="skip" href="#conteudo">Saltar para o conteúdo</a>
<header class="site"><div class="wrap bar">
  <a class="brand" href="index.html"><span class="dot" aria-hidden="true"></span>${esc(name)}</a>
  <button class="burger" aria-expanded="false" aria-label="Abrir menu">Menu</button>
  <nav class="main" aria-label="Principal">
    ${nav.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
  </nav>
</div></header>
<main id="conteudo">${body}</main>
<footer class="site"><div class="wrap">
  <p>© <span data-year>2026</span> ${esc(name)}${project.city ? ' · ' + esc(project.city) : ''}</p>
  <p class="hint">${esc(project.niche ? project.niche : '')}${project.niche ? ' · ' : ''}Feito com o Órbita.</p>
</div></footer>
<script src="app.js"></script>
</body>
</html>`;
}

function institucionalPages(project) {
  const name = project.client || project.name;
  const niche = project.niche || 'o nosso trabalho';
  const goals = project.goals.length ? project.goals : ['Atender bem', 'Fazer bem', 'Dizer a verdade'];
  const servicos = project.features.length ? project.features : ['Consultoria inicial', 'Acompanhamento mensal', 'Resposta a pedidos'];
  const index = pageShell(project, {
    current: 'index.html', title: 'Início', body: `
  <div class="wrap hero">
    <div>
      <span class="pill">${esc(niche)} · ${esc(project.city || 'Portugal')}</span>
      <h1>${esc(name)}</h1>
      <p class="lead">${esc(project.brief || `${name} — ${niche}. Falamos contigo, explicamos o que fazemos e dizemos o preço antes de começar.`)}</p>
      <p style="margin-top: var(--s5)"><a class="btn" href="contacto.html">Falar connosco</a></p>
    </div>
    <div class="card"><p class="eyebrow">Em três linhas</p>
      <ul class="checks" style="margin-top: var(--s3)">${goals.slice(0, 3).map(g => `<li>${esc(g)}</li>`).join('')}</ul>
    </div>
  </div>
  <section style="background:var(--surface);border-top:1px solid var(--hair)"><div class="wrap">
    <p class="eyebrow">O que fazemos</p><h2>Serviços</h2>
    <div class="grid three" style="margin-top:var(--s5)">${servicos.slice(0, 3).map(s => `<div class="card"><h3>${esc(s)}</h3><p class="hint">Explicado sem rodeios em <a href="servicos.html">Serviços</a>.</p></div>`).join('')}</div>
  </div></section>`,
  });
  const sobre = pageShell(project, {
    current: 'sobre.html', title: 'Sobre', body: `
  <section><div class="wrap">
    <p class="eyebrow">Quem somos</p><h1>Sobre ${esc(name)}</h1>
    <p class="lead" style="margin-top:var(--s4)">${esc(project.brief || `${name} trabalha em ${project.city || 'Portugal'} com ${niche}.`)}</p>
    <div class="grid three" style="margin-top:var(--s6)">
      <div class="card"><h3>Como trabalhamos</h3><p class="hint">Conversa inicial, proposta escrita, execução combinada. Sem surpresas.</p></div>
      <div class="card"><h3>Onde estamos</h3><p class="hint">${esc(project.city || 'Portugal')}</p></div>
      <div class="card"><h3>Como falar</h3><p class="hint">Pelo formulário de <a href="contacto.html">contacto</a> ou por telefone.</p></div>
    </div>
  </div></section>`,
  });
  const servicosPage = pageShell(project, {
    current: 'servicos.html', title: 'Serviços', body: `
  <section><div class="wrap">
    <p class="eyebrow">Serviços</p><h1>O que fazemos</h1>
    <div class="grid" style="margin-top:var(--s6)">
      ${servicos.map((s, i) => `<div class="card"><h3>${esc(s)}</h3><p class="hint">${esc(['Inclui conversa inicial e proposta por escrito.', 'Prazo combinado antes de começar.', 'Preço fechado, sem custos escondidos.'][i % 3])}</p></div>`).join('')}
    </div>
    <p class="hint" style="margin-top:var(--s5)">Os preços são combinados caso a caso — este site não mostra valores que não foram confirmados.</p>
  </div></section>`,
  });
  const contacto = pageShell(project, {
    current: 'contacto.html', title: 'Contacto', body: `
  <section><div class="wrap" style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s6);align-items:start">
    <div><p class="eyebrow">Contacto</p><h1>Falar connosco</h1>
      <p class="lead" style="margin-top:var(--s4)">${esc(project.city || 'Portugal')}. Respondemos no mesmo dia útil.</p>
      <p class="hint" style="margin-top:var(--s4)">Preenche o formulário: a mensagem fica pronta para enviares por WhatsApp. Nada sai sem tu veres.</p>
    </div>
    <form class="card" data-contacto data-whatsapp="" aria-label="Formulário de contacto">
      <div class="field"><label for="nome">Nome</label><input id="nome" name="nome" autocomplete="name" required><span class="error" data-error="nome"></span></div>
      <div class="field"><label for="telefone">Telefone</label><input id="telefone" name="telefone" inputmode="tel" autocomplete="tel" required><span class="error" data-error="telefone"></span></div>
      <div class="field"><label for="email">Email (opcional)</label><input id="email" name="email" type="email" autocomplete="email"><span class="error" data-error="email"></span></div>
      <div class="field"><label for="mensagem">Mensagem</label><textarea id="mensagem" name="mensagem" rows="4" required></textarea><span class="error" data-error="mensagem"></span></div>
      <button class="btn" type="submit">Preparar mensagem</button>
      <p class="hint" data-result role="status" aria-live="polite"></p>
    </form>
  </div></section>`,
  });
  return { 'index.html': index, 'sobre.html': sobre, 'servicos.html': servicosPage, 'contacto.html': contacto };
}

const LOJA_JS = `
// Loja: catálogo lido de data/products.json. Sem produtos, mostra um estado vazio que ensina.
'use strict';
var CART_KEY = 'carrinho-v1';
var state = { products: [], cart: [] };

function money(cents) {
  return (cents / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' });
}
function readCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch (e) { return []; }
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) { }
}
function render() {
  var grid = document.querySelector('[data-products]');
  var empty = document.querySelector('[data-empty]');
  if (!grid) return;
  if (!state.products.length) {
    if (empty) empty.hidden = false;
    grid.innerHTML = '';
  } else {
    if (empty) empty.hidden = true;
    grid.innerHTML = state.products.map(function (p) {
      return '<article class="card product">' +
        '<h3>' + p.name + '</h3>' +
        '<p class="hint">' + (p.description || '') + '</p>' +
        '<p class="price">' + money(p.price_cents) + '</p>' +
        '<button class="btn" data-add="' + p.id + '"' + (p.stock === 0 ? ' disabled' : '') + '>' +
        (p.stock === 0 ? 'Esgotado' : 'Adicionar ao carrinho') + '</button>' +
        '</article>';
    }).join('');
  }
  var count = state.cart.reduce(function (a, i) { return a + i.qty; }, 0);
  var badge = document.querySelector('[data-count]');
  if (badge) badge.textContent = String(count);
  var list = document.querySelector('[data-cart]');
  if (list) {
    list.innerHTML = state.cart.map(function (i) {
      return '<li><span>' + i.name + ' × ' + i.qty + '</span><span>' + money(i.price_cents * i.qty) + '</span>' +
        '<button class="btn ghost" data-remove="' + i.id + '" aria-label="Remover ' + i.name + '">Remover</button></li>';
    }).join('');
  }
  var total = state.cart.reduce(function (a, i) { return a + i.price_cents * i.qty; }, 0);
  var totalEl = document.querySelector('[data-total]');
  if (totalEl) totalEl.textContent = money(total);
  var checkout = document.querySelector('[data-checkout]');
  if (checkout) checkout.disabled = state.cart.length === 0;
}
function add(id) {
  var p = state.products.filter(function (x) { return x.id === id; })[0];
  if (!p) return;
  var line = state.cart.filter(function (x) { return x.id === id; })[0];
  if (line) line.qty += 1; else state.cart.push({ id: p.id, name: p.name, price_cents: p.price_cents, qty: 1 });
  saveCart(); render();
}
function remove(id) {
  state.cart = state.cart.filter(function (x) { return x.id !== id; });
  saveCart(); render();
}
document.addEventListener('click', function (e) {
  var addBtn = e.target.closest ? e.target.closest('[data-add]') : null;
  if (addBtn) { add(addBtn.getAttribute('data-add')); }
  var rm = e.target.closest ? e.target.closest('[data-remove]') : null;
  if (rm) { remove(rm.getAttribute('data-remove')); }
  var open = e.target.closest ? e.target.closest('[data-open-cart]') : null;
  if (open) { var d = document.querySelector('[data-cart-panel]'); if (d) d.hidden = !d.hidden; }
});
var checkoutBtn = document.querySelector('[data-checkout]');
if (checkoutBtn) {
  checkoutBtn.addEventListener('click', function () {
    var total = state.cart.reduce(function (a, i) { return a + i.price_cents * i.qty; }, 0);
    var lines = state.cart.map(function (i) { return i.name + ' × ' + i.qty + ' — ' + money(i.price_cents * i.qty); });
    var out = document.querySelector('[data-order]');
    if (out) {
      out.textContent = 'Encomenda preparada: ' + lines.join(' · ') + ' · Total ' + money(total) + '. Envia-a por WhatsApp ou email.';
      out.className = 'success';
    }
  });
}
state.cart = readCart();
fetch('data/products.json').then(function (r) { return r.json(); }).then(function (data) {
  state.products = Array.isArray(data) ? data : [];
  render();
}).catch(function () {
  var empty = document.querySelector('[data-empty]');
  if (empty) {
    empty.hidden = false;
    empty.textContent = 'Não consegui ler data/products.json. Abre a loja a partir de um servidor (o ficheiro não é servido por file://).';
  }
});
render();
`;

function lojaPage(project) {
  const name = project.client || project.name;
  return `<!DOCTYPE html>
<html lang="pt">
<head>
${meta(project, { title: `${name} — loja`, description: `Loja de ${name}.` })}
</head>
<body>
<a class="skip" href="#conteudo">Saltar para o conteúdo</a>
<header class="site"><div class="wrap bar">
  <a class="brand" href="index.html"><span class="dot" aria-hidden="true"></span>${esc(name)}</a>
  <button class="btn ghost" data-open-cart>Carrinho (<span data-count>0</span>)</button>
</div></header>
<main id="conteudo">
  <section><div class="wrap">
    <p class="eyebrow">Loja</p>
    <h1>${esc(name)}</h1>
    <p class="lead" style="margin-top:var(--s3)">${esc(project.brief || 'Compra em poucos passos. A encomenda é preparada e enviada por WhatsApp — sem pagamentos ligados.')}</p>
    <div class="card" data-empty hidden style="margin-top:var(--s5)">
      <h3>Ainda não há produtos</h3>
      <p class="hint">Os artigos vivem em <code>data/products.json</code>. Sem esse ficheiro preenchido, a loja não inventa produtos — mostra este aviso. Cada artigo tem id, nome, descrição, preço em cêntimos e stock.</p>
    </div>
    <div class="grid three" style="margin-top:var(--s5)" data-products></div>
  </div></section>
  <section data-cart-panel hidden style="background:var(--surface);border-top:1px solid var(--hair)"><div class="wrap">
    <p class="eyebrow">Carrinho</p>
    <ul class="cart" data-cart style="list-style:none;display:grid;gap:var(--s2);margin-top:var(--s4)"></ul>
    <p style="margin-top:var(--s4)"><strong>Total: <span data-total>0,00 €</span></strong></p>
    <p><button class="btn" data-checkout disabled>Preparar encomenda</button></p>
    <p class="hint" data-order role="status" aria-live="polite"></p>
  </div></section>
</main>
<footer class="site"><div class="wrap">
  <p>© <span data-year>2026</span> ${esc(name)}</p>
  <p class="hint">Preços em euros, com IVA incluído. Pagamento combinado no envio da encomenda.</p>
</div></footer>
<script src="app.js"></script>
</body>
</html>`;
}

const DASH_JS = `
// Sistema interno: os números vêm de data/dataset.json. Sem dados, mostra zero e explica.
'use strict';
var state = { rows: [], q: '', sort: 'date', page: 1, perPage: 10 };
function money(cents) { return (Number(cents || 0) / 100).toLocaleString('pt-PT', { style: 'currency', currency: 'EUR' }); }
function filtered() {
  var q = state.q.trim().toLowerCase();
  var rows = state.rows.filter(function (r) {
    return !q || Object.keys(r).some(function (k) { return String(r[k]).toLowerCase().indexOf(q) !== -1; });
  });
  rows.sort(function (a, b) { return String(b[state.sort] || '').localeCompare(String(a[state.sort] || '')); });
  return rows;
}
function kpis(rows) {
  var total = rows.length;
  var amount = rows.reduce(function (a, r) { return a + Number(r.amount_cents || 0); }, 0);
  var open = rows.filter(function (r) { return r.status === 'aberto'; }).length;
  return { total: total, amount: amount, open: open, avg: total ? Math.round(amount / total) : 0 };
}
function render() {
  var rows = filtered();
  var k = kpis(state.rows);
  var set = function (sel, value) { var el = document.querySelector(sel); if (el) el.textContent = value; };
  set('[data-kpi-total]', String(k.total));
  set('[data-kpi-amount]', money(k.amount));
  set('[data-kpi-open]', String(k.open));
  set('[data-kpi-avg]', money(k.avg));
  var empty = document.querySelector('[data-empty]');
  if (empty) empty.hidden = k.total !== 0;
  var body = document.querySelector('[data-rows]');
  if (body) {
    var start = (state.page - 1) * state.perPage;
    body.innerHTML = rows.slice(start, start + state.perPage).map(function (r) {
      return '<tr><td>' + (r.date || '') + '</td><td>' + (r.name || '') + '</td><td>' + (r.status || '') + '</td><td class="num">' + money(r.amount_cents) + '</td></tr>';
    }).join('');
  }
  var count = document.querySelector('[data-count]');
  if (count) count.textContent = String(rows.length);
}
var search = document.querySelector('[data-search]');
if (search) search.addEventListener('input', function () { state.q = search.value; state.page = 1; render(); });
var sort = document.querySelector('[data-sort]');
if (sort) sort.addEventListener('change', function () { state.sort = sort.value; render(); });
var csv = document.querySelector('[data-csv]');
if (csv) csv.addEventListener('click', function () {
  var rows = filtered();
  var head = ['date', 'name', 'status', 'amount_cents'];
  var text = [head.join(',')].concat(rows.map(function (r) { return head.map(function (h) { return '"' + String(r[h] == null ? '' : r[h]).replace(/"/g, '""') + '"'; }).join(','); })).join('\\n');
  var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'export.csv'; a.click();
  URL.revokeObjectURL(a.href);
});
fetch('data/dataset.json').then(function (r) { return r.json(); }).then(function (data) {
  state.rows = Array.isArray(data) ? data : [];
  render();
}).catch(function () { render(); });
render();
`;

function dashboardPage(project) {
  const name = project.client || project.name;
  return `<!DOCTYPE html>
<html lang="pt">
<head>
${meta(project, { title: `${name} — sistema interno`, description: `Sistema interno de ${name}.` })}
</head>
<body>
<a class="skip" href="#conteudo">Saltar para o conteúdo</a>
<header class="site"><div class="wrap bar">
  <a class="brand" href="index.html"><span class="dot" aria-hidden="true"></span>${esc(name)}</a>
  <span class="pill">Sistema interno</span>
</div></header>
<main id="conteudo">
  <section><div class="wrap">
    <p class="eyebrow">Visão geral</p>
    <h1>${esc(project.name)}</h1>
    <p class="lead" style="margin-top:var(--s3)">${esc(project.brief || 'Indicadores calculados a partir do ficheiro de dados. Nada é inventado: se o ficheiro está vazio, os números são zero.')}</p>
    <div class="grid" style="grid-template-columns:repeat(4,1fr);margin-top:var(--s6)">
      <div class="card"><p class="eyebrow">Registos</p><p class="price" data-kpi-total>0</p></div>
      <div class="card"><p class="eyebrow">Valor total</p><p class="price" data-kpi-amount>0,00 €</p></div>
      <div class="card"><p class="eyebrow">Em aberto</p><p class="price" data-kpi-open>0</p></div>
      <div class="card"><p class="eyebrow">Média</p><p class="price" data-kpi-avg>0,00 €</p></div>
    </div>
    <div class="card" data-empty style="margin-top:var(--s5)">
      <h3>Ainda não há dados</h3>
      <p class="hint">Preenche <code>data/dataset.json</code> com uma lista de registos (date, name, status, amount_cents). A tabela e os indicadores passam a mostrar o que lá estiver — nem mais um número.</p>
    </div>
    <div style="display:flex;gap:var(--s3);flex-wrap:wrap;margin:var(--s5) 0" role="search">
      <input data-search placeholder="Pesquisar…" aria-label="Pesquisar registos">
      <select data-sort aria-label="Ordenar">
        <option value="date">Data (mais recente)</option>
        <option value="name">Nome</option>
        <option value="status">Estado</option>
      </select>
      <button class="btn ghost" data-csv>Exportar CSV</button>
      <span class="pill"><span data-count>0</span> registos</span>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table style="width:100%;border-collapse:collapse">
        <caption class="hint" style="text-align:left;padding:var(--s3)">Registos — <span data-count>0</span> encontrados</caption>
        <thead><tr><th style="text-align:left;padding:var(--s3)">Data</th><th style="text-align:left;padding:var(--s3)">Nome</th><th style="text-align:left;padding:var(--s3)">Estado</th><th style="text-align:right;padding:var(--s3)">Valor</th></tr></thead>
        <tbody data-rows></tbody>
      </table>
    </div>
  </div></section>
</main>
<footer class="site"><div class="wrap"><p>© <span data-year>2026</span> ${esc(name)}</p><p class="hint">Sistema interno — acesso restrito.</p></div></footer>
<script src="app.js"></script>
</body>
</html>`;
}

function readme(project, offer, notes) {
  return `# ${project.name}

${project.brief || 'Projeto gerado pelo Órbita.'}

- **Cliente:** ${project.client || '—'}
- **Tipo:** ${LABEL[project.kind] || project.kind}
- **Stack:** ${project.stack} (HTML, CSS e JavaScript, sem dependências)
- **Cidade:** ${project.city || '—'}
- **Nicho:** ${project.niche || '—'}

## Como abrir

\`\`\`bash
python3 -m http.server 8080
# abre http://localhost:8080
\`\`\`

Abrir o \`index.html\` directamente (file://) funciona para as páginas estáticas; as páginas que
lêem ficheiros (\`data/products.json\`, \`data/dataset.json\`) precisam de um servidor local — é uma
limitação do browser, não do projeto.

## O que está feito

${(project.features.length ? project.features : KINDS[project.kind].features).map(f => `- ${f}`).join('\n')}

## Critérios de aceitação

${(project.acceptance.length ? project.acceptance : KINDS[project.kind].acceptance).map((a, i) => `${i + 1}. ${a}`).join('\n')}

## O que ainda não está — dito por palavras

${notes.map(n => `- ${n}`).join('\n')}

${offer?.preco_eur ? `\n## Oferta\n\n- Preço: ${offer.preco_eur} €\n- Prazo: ${offer.prazo_dias || '—'} dias\n${offer.garantia ? `- Garantia: ${offer.garantia}\n` : ''}` : ''}
## Verificação

\`\`\`bash
node --check app.js      # sintaxe do JavaScript
\`\`\`

_Gerado pelo Órbita em ${now().slice(0, 10)}. Este ficheiro é do cliente._
`;
}

/** Planeia os ficheiros do projeto, sem tocar no disco. Puro: dá para testar. */
export function plan(project, offer = {}) {
  const files = {};
  files['styles.css'] = baseCss(project);
  files['README.md'] = '';
  if (project.kind === 'institucional') {
    Object.assign(files, institucionalPages(project));
    files['app.js'] = BASE_JS_HEAD;
  } else if (project.kind === 'loja') {
    files['index.html'] = lojaPage(project);
    files['app.js'] = BASE_JS_HEAD + LOJA_JS;
    files['data/products.json'] = JSON.stringify([], null, 2);
  } else if (project.kind === 'dashboard') {
    files['index.html'] = dashboardPage(project);
    files['app.js'] = BASE_JS_HEAD + DASH_JS;
    files['data/dataset.json'] = JSON.stringify([], null, 2);
  } else {
    files['index.html'] = indexLanding(project, offer);
    files['app.js'] = BASE_JS_HEAD;
  }
  const notes = {
    landing: [
      'O formulário não envia para nenhum servidor: valida e prepara a mensagem para WhatsApp/telefone.',
      'Sem domínio próprio nem certificado — isso é configuração de alojamento, não código.',
    ],
    institucional: [
      'As páginas abrem e navegam entre si; não há CMS, os textos vivem no HTML.',
      'O formulário prepara a mensagem em vez de a enviar.',
    ],
    loja: [
      'Não há pagamentos: a encomenda é preparada e combinada por WhatsApp.',
      'O catálogo lê data/products.json — vazio até o cliente fornecer os artigos.',
      'Sem gestão de stock no servidor: o stock vem do ficheiro.',
    ],
    dashboard: [
      'Os dados vêm de data/dataset.json; não há base de dados nem login.',
      'O sistema é de leitura: não escreve no ficheiro.',
    ],
  }[project.kind] || [];
  files['README.md'] = readme(project, offer, notes);
  return { files, notes };
}

/** Escreve os ficheiros no disco e devolve o manifesto (hash por ficheiro). */
export function writeFiles(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {};
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    manifest[rel] = createHash('sha256').update(content, 'utf8').digest('hex');
  }
  return manifest;
}

/** Lê o manifesto actual do disco — é assim que se detecta uma alteração posterior ao QA. */
export function currentManifest(dir) {
  const out = {};
  const walk = (base, rel = '') => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(base, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(base, r);
      else if (e.isFile()) {
        try { out[r] = createHash('sha256').update(fs.readFileSync(path.join(base, r))).digest('hex'); } catch { /* ficheiro ilegível */ }
      }
    }
  };
  walk(dir);
  return out;
}

export function slugFor(project) { return slugify(project.name); }
export { uid as _uid };
