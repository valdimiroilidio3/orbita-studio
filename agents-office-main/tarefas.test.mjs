/* Testes do motor das tarefas (1.53.2).
   O que isto protege, por palavras do dono: «nas tarefas nada funciona».
   Uma tarefa criada na mesa tem de CORRER, e o resultado tem de ser o texto que
   um modelo devolveu — não uma linha já gravada como falhada. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemRepo } from './api/_repo.mjs';
import { ROTINAS, contextoLead, contextoProjeto, chavesEmFalta, motivoSemMotor, executarTarefa, registarDesfecho, criarECorrer, correrDeNovo } from './api/_tarefas.mjs';
import { responder } from './api/_rotas.mjs';

const LEAD = { id: 'l_1', name: 'Padaria Central', category: 'padaria', city: 'Coimbra', phone: '239000000', website: null, notes: 'fala com a filha', status: 'novo' };
const PROJ = { id: 'p_1', name: 'Site da Padaria', client: 'Padaria Central', niche: 'padaria', city: 'Coimbra', kind: 'site', status: 'rascunho' };

function repoComDados() {
  const repo = createMemRepo();
  repo._dados.leads.push({ ...LEAD, created_at: new Date().toISOString(), dedupe_key: 'padaria|coimbra' });
  repo._dados.projetos.push({ ...PROJ, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  return repo;
}

/** Um motor falso com a mesma forma do verdadeiro: `pedir(tipo, mensagens, opções)`. */
const motorQueResponde = (texto = 'resultado do modelo', extra = {}) => ({
  chamadas: [],
  async pedir(tipo, mensagens, opcoes) {
    this.chamadas.push({ tipo, mensagens, opcoes });
    return { texto, fornec: 'groq', modelo: 'llama-3.3-70b-versatile', tentativas: 1, ms: 42, ...extra };
  },
});

const motorQueFalha = (mensagem = 'nenhum modelo disponível') => ({
  async pedir() { const e = new Error(mensagem); e.codigo = 'semmotor'; throw e; },
});

test('cada tipo de tarefa tem uma rotina escrita, com o alvo certo', () => {
  assert.deepEqual(Object.keys(ROTINAS).sort(), ['briefing', 'codigo', 'investigar', 'mensagem', 'qa']);
  for (const [id, r] of Object.entries(ROTINAS)) {
    assert.ok(['lead', 'projeto'].includes(r.alvo), `${id}: alvo tem de ser lead ou projeto`);
    assert.ok(r.titulo.length > 3, `${id}: falta título`);
    assert.ok(r.pedido('CONTEXTO').includes('CONTEXTO'), `${id}: o pedido tem de levar o contexto real`);
  }
});

test('o contexto do lead leva só o que existe — e diz quando não há site', () => {
  const t = contextoLead(LEAD);
  assert.match(t, /Padaria Central/);
  assert.match(t, /Coimbra/);
  assert.match(t, /Website: não tem/, 'um lead sem site é uma informação, não uma linha em branco');
  assert.doesNotMatch(contextoLead({ name: 'X' }), /Telefone/);
  assert.match(contextoProjeto(PROJ), /Cliente: Padaria Central/);
});

test('executarTarefa devolve o texto do modelo, com o modelo e o tempo', async () => {
  const repo = repoComDados();
  const motor = motorQueResponde('O negócio faz pão. Tem rede social, não tem site.');
  const r = await executarTarefa({ repo, tarefa: { kind: 'investigar', entity_id: 'l_1', entidade: 'lead' }, motor });
  assert.equal(r.ok, true);
  assert.equal(r.estado, 'succeeded');
  assert.match(r.resultado, /faz pão/);
  assert.equal(r.modelo, 'groq/llama-3.3-70b-versatile');
  assert.ok(r.ms >= 0);
  // o pedido levou o contexto real do lead, não um formulário vazio
  assert.match(motor.chamadas[0].mensagens[1].content, /Padaria Central/);
  assert.equal(motor.chamadas[0].mensagens[0].role, 'system');
});

test('sem resposta de nenhum modelo, a tarefa falha e a frase diz QUAL chave falta', async () => {
  const repo = repoComDados();
  const r = await executarTarefa({ repo, tarefa: { kind: 'mensagem', entity_id: 'l_1', entidade: 'lead' }, motor: motorQueFalha('429 no fornecedor'), env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.estado, 'failed');
  assert.match(r.erro, /nenhuma chave de IA está configurada/);
  assert.match(r.erro, /GROQ_API_KEY|OPENROUTER_API_KEY|GEMINI_API_KEY/, 'tem de nomear uma variável concreta');
  assert.match(r.erro, /sem chave \(/i, 'e dizer que os fornecedores sem chave também foram tentados');
  assert.match(r.erro, /429 no fornecedor/, 'e o último erro real, para não ser uma frase vazia');
  assert.equal(r.resultado, undefined, 'sem resposta não há resultado');
});

test('com chave configurada, a frase muda: não se inventa uma chave em falta', () => {
  const env = { GROQ_API_KEY: 'gsk_abcdefghijklmnop' };
  const faltam = chavesEmFalta(env);
  assert.ok(!faltam.some((f) => f.variavel === 'GROQ_API_KEY'), 'uma chave presente não pode aparecer como falta');
  const frase = motivoSemMotor(new Error('todos os modelos falharam'), env);
  assert.match(frase, /apesar de haver chaves configuradas/);
  assert.doesNotMatch(frase, /nenhuma chave de IA está configurada/, 'não se inventa uma falta que não existe');
});

test('um alvo que não existe falha com o nome do alvo — não inventa um lead', async () => {
  const repo = repoComDados();
  const r = await executarTarefa({ repo, tarefa: { kind: 'investigar', entity_id: 'l_nao_existe', entidade: 'lead' }, motor: motorQueResponde() });
  assert.equal(r.ok, false);
  assert.match(r.erro, /não encontrei o lead l_nao_existe/);
});

test('um tipo desconhecido é recusado, não corre às cegas', async () => {
  const repo = repoComDados();
  const r = await executarTarefa({ repo, tarefa: { kind: 'inventado' }, motor: motorQueResponde() });
  assert.equal(r.ok, false);
  assert.match(r.erro, /desconhecido/);
});

test('criarECorrer grava a tarefa CONCLUÍDA com o resultado na linha', async () => {
  const repo = repoComDados();
  const antes = (await repo.atividade.list()).length;
  const r = await criarECorrer({
    repo, corpo: { kind: 'briefing', entityId: 'p_1', entidade: 'projeto' },
    env: { GROQ_API_KEY: 'gsk_abcdefghijklmnop' }, motor: motorQueResponde('Briefing: objetivo claro.'),
    TIPOS: { briefing: { label: 'Escrever o briefing' } },
  });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.tarefa.state, 'succeeded');
  assert.match(r.corpo.tarefa.resultado, /objetivo claro/);
  assert.equal(r.corpo.tarefa.error, null);
  assert.ok(r.corpo.tarefa.finished_at, 'uma tarefa concluída tem hora de fim');
  assert.equal(r.corpo.execucao.modelo, 'groq/llama-3.3-70b-versatile');
  const eventos = await repo.atividade.list();
  assert.equal(eventos.length, antes + 1);
  assert.match(eventos[0].texto, /concluída com groq/);
});

test('com «aprovacao» a tarefa corre e fica à espera do dono — não se fecha sozinha', async () => {
  const repo = repoComDados();
  const r = await criarECorrer({
    repo, corpo: { kind: 'mensagem', entityId: 'l_1', entidade: 'lead', aprovacao: true },
    motor: motorQueResponde('Olá, falo com a Padaria Central?'),
    TIPOS: { mensagem: { label: 'Escrever uma mensagem' } },
  });
  assert.equal(r.corpo.tarefa.state, 'awaiting_approval');
  assert.match(r.corpo.tarefa.resultado, /Padaria Central/);

  // aprovar fecha como concluída, sem voltar a chamar o modelo
  const aprovar = await responder(repo, { caminho: `/ops/tarefas/${r.corpo.tarefa.id}/aprovar`, metodo: 'POST', corpo: {}, env: {}, fetchImpl: async () => { throw new Error('não devia chamar a rede'); } });
  assert.equal(aprovar.status, 200);
  assert.equal(aprovar.corpo.tarefa.state, 'succeeded');

  // rejeitar fecha como cancelada
  const r2 = await criarECorrer({ repo, corpo: { kind: 'mensagem', entityId: 'l_1', entidade: 'lead', aprovacao: true }, motor: motorQueResponde('x'), TIPOS: { mensagem: { label: 'Escrever uma mensagem' } } });
  const rejeitar = await responder(repo, { caminho: `/ops/tarefas/${r2.corpo.tarefa.id}/rejeitar`, metodo: 'POST', corpo: {}, env: {} });
  assert.equal(rejeitar.corpo.tarefa.state, 'cancelled');
});

test('uma tarefa falhada pode ser repetida e passar — com o mesmo id', async () => {
  const repo = repoComDados();
  const criada = await criarECorrer({ repo, corpo: { kind: 'qa', entityId: 'p_1', entidade: 'projeto' }, motor: motorQueFalha('rede em baixo'), env: {}, TIPOS: { qa: { label: 'Auditoria de qualidade' } } });
  assert.equal(criada.corpo.tarefa.state, 'failed');
  const tarefa = await repo.tarefas.byId(criada.corpo.tarefa.id);
  const repetida = await correrDeNovo({ repo, tarefa, motor: motorQueResponde('✅ promessa clara') });
  assert.equal(repetida.corpo.ok, true);
  assert.equal(repetida.corpo.tarefa.id, criada.corpo.tarefa.id);
  assert.equal(repetida.corpo.tarefa.state, 'succeeded');
  assert.match(repetida.corpo.tarefa.resultado, /promessa clara/);
  assert.equal(repetida.corpo.tarefa.error, null, 'o erro antigo não fica colado a uma tarefa que passou');
});

test('base sem a coluna `resultado`: o texto vai para a Atividade e a tarefa diz isso', async () => {
  const repo = repoComDados();
  const original = repo.tarefas.patch;
  repo.tarefas.patch = async (id, campos) => {
    if ('resultado' in campos || 'modelo' in campos) {
      throw new Error('PGRST204: Could not find the \'resultado\' column of \'orbita_tasks\' in the schema cache');
    }
    return original.call(repo.tarefas, id, campos);
  };
  const r = await criarECorrer({ repo, corpo: { kind: 'briefing', entityId: 'p_1', entidade: 'projeto' }, motor: motorQueResponde('texto importante'), TIPOS: { briefing: { label: 'Escrever o briefing' } } });
  assert.equal(r.corpo.tarefa.state, 'succeeded');
  assert.match(r.corpo.tarefa.error, /orbita_1_53_2\.sql/, 'a tarefa aponta a migração que falta');
  const eventos = await repo.atividade.list();
  assert.ok(eventos.some((e) => /texto importante/.test(e.texto)), 'o resultado não pode desaparecer');
});

test('a rota antiga («sem motor de IA ligado a esta base») não pode voltar', () => {
  const src = readFileSync(new URL('./api/_rotas.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /sem motor de IA ligado a esta base/);
  assert.match(src, /criarECorrer/, 'POST /ops/tarefas tem de chamar o motor das tarefas');
  assert.match(src, /correrDeNovo/, 'POST /:id/correr tem de correr de verdade');
  const migracao = readFileSync(new URL('./supabase/orbita_1_53_2.sql', import.meta.url), 'utf8');
  assert.match(migracao, /add column if not exists resultado/);
});

test('de ponta a ponta pela rota: criar → 201, e a lista mostra o estado real', async () => {
  const repo = repoComDados();
  /* sem chaves e com uma rede que recusa, a tarefa falha depressa e com motivo
     escrito; o importante é que a rota não devolve uma lápide pré-fabricada */
  const r = await responder(repo, {
    caminho: '/ops/tarefas', metodo: 'POST',
    corpo: { kind: 'investigar', entityId: 'l_1', entidade: 'lead' },
    env: {}, fetchImpl: async () => { throw new Error('rede desligada'); },
  });
  assert.equal(r.status, 201);
  assert.ok(['succeeded', 'failed'].includes(r.corpo.tarefa.state));
  if (r.corpo.tarefa.state === 'failed') assert.match(r.corpo.tarefa.error, /chave|modelo/);
  const lista = await responder(repo, { caminho: '/ops/tarefas', metodo: 'GET', env: {} });
  assert.equal(lista.corpo.tarefas.length, 1);
  assert.ok(lista.corpo.tipos.investigar);
});

test('o filtro de estado da mesa funciona do lado do servidor', async () => {
  const repo = repoComDados();
  await criarECorrer({ repo, corpo: { kind: 'qa', entityId: 'p_1', entidade: 'projeto' }, motor: motorQueResponde('ok'), TIPOS: { qa: { label: 'Auditoria' } } });
  const soFalhadas = await responder(repo, { caminho: '/ops/tarefas?estado=failed', metodo: 'GET', env: {} });
  assert.equal(soFalhadas.corpo.tarefas.length, 0);
  const soFeitas = await responder(repo, { caminho: '/ops/tarefas?estado=succeeded', metodo: 'GET', env: {} });
  assert.equal(soFeitas.corpo.tarefas.length, 1);
  const daEngenharia = await responder(repo, { caminho: '/ops/tarefas?departamento=engenharia', metodo: 'GET', env: {} });
  assert.equal(daEngenharia.corpo.tarefas.length, 1);
});

test('a mesa sabe ler o cartão da tarefa que a base devolve (kind/state/resultado)', () => {
  const mesa = readFileSync(new URL('./src/mesa.js', import.meta.url), 'utf8');
  assert.match(mesa, /function normalizarTarefa/);
  assert.match(mesa, /t\.entity_id/, 'o id do alvo chega em snake_case');
  assert.match(mesa, /tipo\.label/, 'o título vem do tipo de tarefa, não de um campo que a base não tem');
  assert.match(mesa, /t\.textoResultado/, 'o resultado em texto tem de aparecer no cartão');
});
