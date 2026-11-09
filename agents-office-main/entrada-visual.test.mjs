/* ===========================================================================
   1.71.0 · A ENTRADA A DOIS TEMPOS (6 nov 2026)

   O desenho pedido — anéis, portas a girar, cascata, halo no campo — existe
   agora em `src/entrada-visual.js`, que é **puro**: devolve HTML e não conhece
   DOM, rede nem estado. É isso que estes testes provam:

     · o palco tem as duas metades e o formulário continua a ser o de sempre;
     · as portas a girar são as quatro portas REAIS de entrada — não ícones
       decorativos de uma prateleira;
     · cada órbita leva o seu raio, duração e sentido (e o ícone contra-gira,
       senão anda de pernas para o ar);
     · a cascata é feita por atrasos, não por JavaScript a mexer no DOM;
     · nada disto injeta HTML: os dois textos que o módulo escreve são escapados.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORBITAS, ANEIS, aneisHTML, orbitasHTML, palcoHTML, revelar, escapar,
  RECUSAS, explicarRecusa, textoDaRecusa, avisoDaRecusa,
} from './src/entrada-visual.js';

test('1.71.0 · o palco tem a arte à esquerda e o formulário à direita', () => {
  const html = palcoHTML({ titulo: 'Órbita', sub: 'entra', corpo: '<form id="x"></form>' });
  assert.match(html, /<aside class="palco-arte"/, 'a arte é a metade esquerda');
  assert.match(html, /<main class="palco-lado">\s*<div class="palco-cartao"><form id="x"><\/form>/,
    'o formulário vai inteiro para a metade direita — o módulo não lhe toca');
  assert.match(html, /palco-marca[\s\S]*Órbita/, 'a marca fica no centro das órbitas');
});

test('1.71.0 · os anéis são nove por omissão, com atrasos distintos', () => {
  const html = aneisHTML();
  const aneis = html.match(/class="anel"/g) || [];
  assert.equal(aneis.length, ANEIS);
  const atrasos = [...html.matchAll(/animation-delay:([\d.]+)s/g)].map((m) => m[1]);
  assert.equal(new Set(atrasos).size, ANEIS, 'nenhum anel pulsa ao mesmo tempo que outro');
  assert.match(html, /--px:120px/, 'o mais pequeno é o do centro');
});

test('1.71.0 · as portas a girar são as portas reais de entrada', () => {
  const html = orbitasHTML({ github: '<svg id="gh"></svg>', google: '<svg id="gg"></svg>', email: '<svg id="em"></svg>', codigo: '<svg id="cd"></svg>' });
  for (const id of ['github', 'google', 'email', 'codigo']) {
    assert.match(html, new RegExp(`porta-${id}`), `a porta ${id} está lá`);
  }
  const orbitas = html.match(/class="orbita[ "]/g) || [];
  assert.equal(orbitas.length, ORBITAS.length, 'uma órbita por porta');
  assert.match(html, /--raio:96;--dur:26/, 'raio e duração vêm da configuração, não do acaso');
  assert.match(html, /orbita reversa/, 'há órbitas em sentido contrário (senão parecem uma só)');
});

test('1.71.0 · cada porta leva o raio dela e o ícone que lhe foi dado', () => {
  const html = orbitasHTML({ github: '<svg id="gh"></svg>' });
  assert.match(html, /<svg id="gh"><\/svg>/, 'o ícone passa tal e qual');
  assert.match(html, /porta-orbita/, 'e as portas sem ícone ficam com o lugar marcado, não com um erro');
});

test('1.71.0 · a cascata é feita com atrasos (sem JavaScript a mexer no DOM)', () => {
  const html = revelar('<h1>Entrar</h1>', 0.35);
  assert.match(html, /class="rev"/);
  assert.match(html, /animation-delay:0\.35s/);
  assert.equal(revelar('<b>a</b>').includes('animation-delay:0.00s'), true, 'sem atraso, é 0');
});

test('1.71.0 · o módulo escapa o que escreve (nada de HTML por engano)', () => {
  assert.equal(escapar('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  const html = palcoHTML({ titulo: 'a<b>', sub: '"citações" & mais' });
  assert.doesNotMatch(html.match(/palco-marca[\s\S]*?<\/b>/)[0], /a<b>/);
  assert.match(html, /a&lt;b&gt;/);
  assert.match(html, /&quot;citações&quot; &amp; mais/);
});

test('1.71.0 · um número de anéis inválido não parte o ecrã', () => {
  assert.equal((aneisHTML(0).match(/class="anel"/g) || []).length, ANEIS, 'zero não é uma escolha: cai no valor por omissão');
  assert.equal((aneisHTML('abc').match(/class="anel"/g) || []).length, ANEIS, 'texto cai no valor por omissão');
  assert.equal((aneisHTML(3).match(/class="anel"/g) || []).length, 3, 'um número a sério é respeitado');
});

/* ===========================================================================
   1.72.1 · quando o fornecedor recusa, o ecrã diz o que fazer
   =========================================================================== */

test('1.72.1 · org_internal: diz que a app está fechada à organização e onde se abre', () => {
  const r = explicarRecusa('google:org_internal');
  assert.equal(r.conhecido, true);
  assert.equal(r.codigo, 'org_internal');
  assert.equal(r.fornecedor, 'google');
  assert.match(r.titulo, /fechada à organização/);
  assert.match(r.texto, /Externo/, 'a acção é mudar o tipo de utilizador para Externo');
  assert.match(r.texto, /Google Auth Platform|OAuth consent screen/, 'e diz onde');
  assert.match(r.texto, /cheltonmahoze7@gmail\.com/, 'e qual conta acrescentar como utilizador de teste');
});

test('1.72.1 · aceita o código puro e o formato com fornecedor; um desconhecido não é inventado', () => {
  assert.equal(explicarRecusa('org_internal').codigo, 'org_internal');
  assert.equal(explicarRecusa('github:access_denied').fornecedor, 'github');
  const x = explicarRecusa('qualquer_coisa_nova');
  assert.equal(x.conhecido, false);
  assert.match(x.texto, /qualquer_coisa_nova/, 'o código aparece — não se esconde o que a Google disse');
  assert.doesNotMatch(x.texto, /Como resolver: undefined/);
});

test('1.72.1 · uma frase já escrita passa intacta — não é traduzida', () => {
  const nossa = 'a volta expirou — tenta entrar outra vez';
  assert.equal(textoDaRecusa(nossa), nossa);
  assert.equal(textoDaRecusa(''), '');
  assert.equal(textoDaRecusa('google:redirect_uri_mismatch').includes('endereço de retorno'), true);
});

/* 1.73.0 · a página de entrada mostra UMA frase, não o relatório inteiro. A
   precisão não se perde: fica no «Estado da instalação», que é outro sítio. */
test('1.73.0 · «avisoDaRecusa» devolve uma frase para a página — e uma só', () => {
  assert.equal(avisoDaRecusa(''), '', 'sem recusa não há aviso nenhum');
  const org = avisoDaRecusa('google:org_internal');
  assert.match(org, /só aceita contas da organização/);
  assert.match(org, /Externo/, 'diz o que mudar');
  assert.ok(org.split('. ').length <= 3, 'é uma frase, não um manual');
  assert.doesNotMatch(org, /Como resolver:/, 'o relatório completo não vem para a face da página');

  /* uma frase escrita por nós passa intacta */
  const nossa = 'a volta expirou — tenta entrar outra vez';
  assert.equal(avisoDaRecusa(nossa), nossa);

  /* um código que não conheço não desaparece: aparece entre parênteses */
  const novo = avisoDaRecusa('github:coisa_nova');
  assert.match(novo, /coisa_nova/);
  assert.match(novo, /tenta outra vez/i);
});
