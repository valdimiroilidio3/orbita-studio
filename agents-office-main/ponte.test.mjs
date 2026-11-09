/* ===========================================================================
   1.79.0 · A PONTE PARA O SERVIDOR DA PUBLICAÇÃO (9 nov 2026)

   O dono: «coloca servidor no projeto já» — com a produção a responder e o
   ecrã a dizer «Este escritório está aberto sem servidor».

   Três coisas estavam erradas, e este ficheiro prova as três:

     1 · `respostaNossa` — o `/api/health` de produção devolve `ok:false` porque
         falta UMA tabela opcional (`orbita_faturas`). Isso não é «sem servidor»;
     2 · `chamarRpc` — o envelope `{status, corpo}` do `/api/rpc`, aberto, com a
         frase do servidor quando ele recusa;
     3 · `lerTarefasDoServidor` — tenta a máquina e, se não houver, a publicação.
         Nunca inventa uma lista vazia: se as duas falharem, lança.
   =========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RPC, respostaNossa, urlDoRpc, chamarRpc, tarefasDoServidor,
  corpoDeTarefaDoEscritorio, lerTarefasDoServidor, SALA_PARA_TIPO,
} from './src/ponte.js';

/* o corpo exacto que o `/api/health` de produção devolveu a 9 nov 2026 */
const HEALTH_PRODUCAO = {
  ok: false, base: 'dpfqageawguekdjbdwyt', faltam: ['orbita_faturas'], mensagensProntas: true,
  modo: 'base', versao: '1.78.0',
  porta: { ok: true }, ia: { fornecedoresComChave: ['groq'], modelosNoCatalogo: 159 },
};

test('1.79.0 · um servidor que responde e diz o que lhe falta é um servidor', () => {
  assert.equal(respostaNossa(HEALTH_PRODUCAO), true, 'a produção diz ok:false por causa de UMA tabela');
  assert.equal(respostaNossa({ ok: true }), true);
  assert.equal(respostaNossa({ name: 'Órbita' }), true, 'o serve.mjs local não tem `versao`');
  assert.equal(respostaNossa(null), false);
  assert.equal(respostaNossa({}), false, 'uma resposta vazia não é um servidor');
  /* a página estática responde HTML: sem JSON, não há servidor */
  assert.equal(respostaNossa('<html>não há api</html>'), false);
});

test('1.79.0 · o endereço do /api/rpc leva o caminho e, no GET, a query', () => {
  assert.equal(urlDoRpc('/ops/tarefas'), `${RPC}?caminho=%2Fops%2Ftarefas`);
  assert.equal(urlDoRpc('/ops/tarefas', { metodo: 'GET', query: 'limit=120' }),
    `${RPC}?caminho=%2Fops%2Ftarefas&query=limit%3D120`);
  assert.equal(urlDoRpc('/ops/tarefas', { metodo: 'POST', query: 'limit=120' }),
    `${RPC}?caminho=%2Fops%2Ftarefas`, 'no POST a query não vai no endereço');
});

test('1.79.0 · o envelope abre-se e a recusa do servidor chega com a frase dele', async () => {
  const ok = await chamarRpc('/ops/tarefas', {
    fetchImpl: async (url, init) => {
      assert.equal(url, `${RPC}?caminho=%2Fops%2Ftarefas`);
      assert.equal(init.method, 'GET');
      return { ok: true, status: 200, json: async () => ({ status: 200, corpo: { tarefas: [{ id: 't1' }] } }) };
    },
  });
  assert.deepEqual(ok.tarefas, [{ id: 't1' }]);

  await assert.rejects(
    () => chamarRpc('/ops/tarefas', {
      metodo: 'POST', corpo: { kind: 'escritorio' },
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 401, corpo: { error: 'entra', mode: 'sessao' } }) }),
    }),
    (e) => e.status === 401 && e.message === 'entra',
  );

  /* uma página em HTML (a vista estática) não é JSON: diz-se isso, com o estado */
  await assert.rejects(
    () => chamarRpc('/ops/tarefas', { fetchImpl: async () => ({ ok: false, status: 404, json: async () => { throw new Error('não é json'); } }) }),
    (e) => e.status === 404 && /não tem o caminho/.test(e.message),
  );
});

test('1.79.0 · uma tarefa do escritório leva o pedido, a sala e o agente', () => {
  const c = corpoDeTarefaDoEscritorio({ dept: 'delivery', texto: '  Corrige o formulário  ', agente: 'qa' });
  assert.equal(c.kind, 'escritorio');
  assert.equal(c.texto, 'Corrige o formulário');
  assert.equal(c.dept, 'engineering');
  assert.equal(c.agente, 'qa');
  assert.equal(c.titulo, 'Corrige o formulário');
  assert.equal(SALA_PARA_TIPO.emails, 'command');
  assert.equal(SALA_PARA_TIPO.fin, 'design');
  assert.equal(corpoDeTarefaDoEscritorio({ dept: 'inexistente' }).dept, 'command', 'uma sala desconhecida não inventa um departamento');
});

test('1.79.0 · a leitura tenta a máquina e, se não houver, a publicação', async () => {
  const pedidos = [];
  const j = await lerTarefasDoServidor({
    fetchImpl: async (url, init) => {
      pedidos.push(String(url));
      if (String(url).startsWith('/api/ops/tarefas')) return { ok: false, status: 404, json: async () => ({}) };
      assert.equal(String(url), `${RPC}?caminho=%2Fops%2Ftarefas&query=limit%3D120`);
      assert.equal(init.method, 'GET');
      return { ok: true, status: 200, json: async () => ({ status: 200, corpo: { tarefas: [{ id: 'x', state: 'succeeded' }] } }) };
    },
  });
  assert.equal(j.via, 'rpc');
  assert.equal(j.tarefas.length, 1);
  assert.equal(pedidos.length, 2, 'duas tentativas: a máquina primeiro, a publicação depois');
});

test('1.79.0 · com a máquina a responder, não se incomoda a publicação', async () => {
  const j = await lerTarefasDoServidor({
    fetchImpl: async (url) => {
      assert.ok(String(url).startsWith('/api/ops/tarefas'), 'só o caminho local');
      return { ok: true, status: 200, json: async () => ({ tarefas: [{ id: 'local' }] }) };
    },
  });
  assert.equal(j.via, 'local');
});

test('1.79.0 · quando NENHUM servidor responde, a leitura lança — não devolve uma lista vazia', async () => {
  await assert.rejects(
    () => lerTarefasDoServidor({
      fetchImpl: async () => { throw Object.assign(new Error('rede'), { status: 0 }); },
    }),
    /não tem o caminho|rede/,
  );
});

test('1.79.0 · o formato da lista é reconhecido nos dois sítios', () => {
  assert.deepEqual(tarefasDoServidor({ tarefas: [{ id: 1 }] }), [{ id: 1 }]);
  assert.deepEqual(tarefasDoServidor([{ id: 2 }]), [{ id: 2 }]);
  assert.equal(tarefasDoServidor({ nada: true }), null);
  assert.equal(tarefasDoServidor(null), null);
});
