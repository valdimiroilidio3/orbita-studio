// A gaveta EMPRESA: as funções de desenho (puras) e a lógica de abrir, criar e acompanhar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as painel from './src/empresa-painel.js';

const estado = {
  divisoes: { produto: 'Produto', design: 'Design', programacao: 'Programação' },
  agentes: [
    { id: 'gestor-produto', divisao: 'produto', nome: 'Gestor de Produto', papel: 'Fixa o âmbito.' },
    { id: 'arquiteto-ux', divisao: 'design', nome: 'Arquiteto de UX', papel: 'Desenha os caminhos.' },
    { id: 'dev-frontend', divisao: 'programacao', nome: 'Desenvolvedor Frontend', papel: 'Escreve a interface.' },
  ],
  motor: { motor: 'sem-motor', motivo: 'Nenhum motor disponível.' },
  projetos: [],
};

test('htmlMotor: diz o motor, ou porque não há nenhum', () => {
  assert.match(painel.htmlMotor({ motor: 'claude-cli' }), /Claude Code/);
  assert.match(painel.htmlMotor({ motor: 'gratis' }), /gratuito/);
  assert.match(painel.htmlMotor({ motor: 'api', modelo: 'm' }), /API · m/);
  assert.match(painel.htmlMotor({ motor: 'sem-motor', motivo: 'sem chave' }), /sem motor — sem chave/);
});

test('htmlEquipa: uma secção por divisão, com o nome e o papel de cada agente', () => {
  const h = painel.htmlEquipa(estado);
  assert.equal((h.match(/class="em-div"/g) || []).length, 3);
  assert.match(h, /Gestor de Produto/);
  assert.match(h, /Fixa o âmbito\./);
  assert.match(h, /data-divisao="programacao"/);
});

test('htmlProjetos: lista vazia tem texto próprio; o selecionado vem marcado', () => {
  assert.match(painel.htmlProjetos([]), /Ainda não há projetos/);
  const h = painel.htmlProjetos([
    { id: 'a', nome: 'A', etapasFeitas: 2, etapasTotal: 10, estado: 'falhou' },
    { id: 'b', nome: 'B', etapasFeitas: 10, etapasTotal: 10, estado: 'concluido' },
  ], 'b');
  assert.match(h, /data-projeto="b" class="on"/);
  assert.match(h, /falhou/);
  assert.match(h, /2\/10/);
});

test('htmlProjeto: cada etapa mostra o agente com nome, o estado e o erro, se houver', () => {
  const h = painel.htmlProjeto({
    nome: 'Lista', correndo: false, passagens: ['1-a.md', '2-b.md'],
    etapas: [
      { agente: 'gestor-produto', fase: 'produto', estado: 'concluido', ficheiros: ['PROJETO.md'] },
      { agente: 'dev-frontend', fase: 'programacao', estado: 'falhou', ficheiros: [], erro: 'entregas em falta' },
    ],
  }, estado);
  assert.match(h, /Gestor de Produto/);
  assert.match(h, /concluído/);
  assert.match(h, /PROJETO\.md/);
  assert.match(h, /entregas em falta/);
  assert.match(h, /2 passagens/);
});

test('escapa texto vindo de fora: nome do projeto e erro não viram HTML', () => {
  const h = painel.htmlProjeto({
    nome: '<img src=x onerror=alert(1)>', correndo: false, passagens: [],
    etapas: [{ agente: 'gestor-produto', fase: 'produto', estado: 'falhou', ficheiros: [], erro: '<script>x</script>' }],
  }, estado);
  assert.ok(!h.includes('<img'), 'o nome não pode abrir uma tag');
  assert.ok(!h.includes('<script>'), 'o erro não pode abrir uma tag');
  assert.match(h, /&lt;img/);
});

// DOM falso mínimo: só o que a gaveta usa.
function criarDoc() {
  const el = (tag = 'div') => ({
    tag, hidden: false, innerHTML: '', textContent: '', value: '', disabled: false, title: '',
    listeners: {}, classList: { on: false, add() { this.on = true; }, remove() { this.on = false; } },
    addEventListener(t, f) { this.listeners[t] = f; },
    querySelector() { return el(); },
    closest() { return null; },
    getAttribute() { return null; },
  });
  const nodes = {};
  const botao = el('button'); const painelEl = el('section'); painelEl.hidden = true;
  const campos = { '.em-motor': el(), '.em-equipa': el(), '.em-projetos': el(), '.em-detalhe': el(), '.em-erro': el(), '.em-close': el(), '.em-sum': el() };
  const form = el('form');
  const nome = el('input'); const pedido = el('textarea'); const enviar = el('button');
  const mapa = { '.em-form': form, '.em-form [name="nome"]': nome, '.em-form [name="pedido"]': pedido, '.em-form button[type="submit"]': enviar };
  painelEl.querySelector = (s) => campos[s] || mapa[s] || el();
  const doc = { getElementById: (id) => (id === 'topEmpresa' ? botao : id === 'empresaPanel' ? painelEl : null), addEventListener() {} };
  return { doc, botao, painelEl, campos, form, nome, pedido, enviar };
}

test('initEmpresaPainel: sem a gaveta no HTML não faz nada', () => {
  assert.equal(painel.initEmpresaPainel({ doc: { getElementById: () => null, addEventListener() {} } }), null);
});

test('initEmpresaPainel: abrir lê /api/empresa e pinta a equipa e o motor', async () => {
  const d = criarDoc();
  const pedidos = [];
  const fetchImpl = async (u) => { pedidos.push(u); return { ok: true, json: async () => estado }; };
  const ctl = painel.initEmpresaPainel({ doc: d.doc, api: '/api', fetchImpl });
  d.botao.listeners.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(pedidos, ['/api/empresa']);
  assert.equal(d.painelEl.hidden, false);
  assert.match(d.campos['.em-equipa'].innerHTML, /Gestor de Produto/);
  assert.match(d.campos['.em-motor'].innerHTML, /sem motor/);
  assert.equal(d.enviar.disabled, true, 'sem motor, o botão de criar fica desativado');
  ctl.close();
});

test('initEmpresaPainel: se o servidor não responde, diz isso (não mostra zeros)', async () => {
  const d = criarDoc();
  const fetchImpl = async () => { throw new Error('rede em baixo'); };
  const ctl = painel.initEmpresaPainel({ doc: d.doc, api: '/api', fetchImpl });
  await ctl.carregar();
  assert.match(d.campos['.em-erro'].textContent, /não consegui ler a empresa/);
});

test('initEmpresaPainel: criar com motor envia o pedido e mostra o motivo se o servidor recusar', async () => {
  const d = criarDoc();
  const corpos = [];
  const fetchImpl = async (u, o) => {
    if (o && o.method === 'POST') { corpos.push(JSON.parse(o.body)); return { ok: false, status: 422, json: async () => ({ erro: 'sem motor', motivo: 'Nenhum motor disponível.' }) }; }
    return { ok: true, json: async () => ({ ...estado, motor: { motor: 'api', modelo: 'm' } }) };
  };
  const ctl = painel.initEmpresaPainel({ doc: d.doc, api: '/api', fetchImpl });
  await ctl.carregar();
  d.nome.value = 'Lista'; d.pedido.value = 'Lista simples';
  await d.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(corpos, [{ nome: 'Lista', pedido: 'Lista simples' }]);
  assert.match(d.campos['.em-erro'].textContent, /não criei o projeto: Nenhum motor disponível\./);
});

test('initEmpresaPainel: campos vazios não chegam ao servidor', async () => {
  const d = criarDoc();
  let chamadas = 0;
  const fetchImpl = async () => { chamadas++; return { ok: true, json: async () => estado }; };
  const ctl = painel.initEmpresaPainel({ doc: d.doc, api: '/api', fetchImpl });
  await ctl.carregar();
  const antes = chamadas;
  d.nome.value = ''; d.pedido.value = 'x';
  await d.form.listeners.submit({ preventDefault() {} });
  assert.equal(chamadas, antes, 'nenhum pedido sem nome');
  assert.match(d.campos['.em-erro'].textContent, /falta o nome/);
});
