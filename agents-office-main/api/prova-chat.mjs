/* ===========================================================================
   1.51.0 · PROVA DA CONVERSA — 28 out 2026

   `GET /api/prova-chat?token=<PROVA_TOKEN>&fornecedor=&modelo=&esforco=&pergunta=`
   `GET /api/prova-chat?lista=1`  — o menu do painel de tarefas, calculado de fora

   Uma conversa a sério, em produção, pela mesma função que o `/api/rpc` usa
   (`rotasIA` → `POST /ia/chat`): o mesmo catálogo, a mesma validação do par
   fornecedor+modelo, o mesmo esforço a virar tecto de tokens, o mesmo motor.

   Existe porque a escolha de IA não pode ser dada como feita por um botão que
   aparece na interface: tem de haver um sítio, de fora, que mostre **quem
   respondeu e em quanto tempo** — ou a razão exacta de não ter respondido.

   Duas leituras, de propósito:

   · **sem token** — o ENSAIO (`ensaio: true`): lê o catálogo a sério, valida o
     par pedido, mostra o esforço a que corresponde e quantos fornecedores podem
     responder agora. Não gasta um único pedido de IA nem precisa de segredo —
     é o que se pode provar de fora sem abrir a porta a quem queira gastar a
     conta do dono.
   · **com token** — a CONVERSA a sério, pela função do `/api/rpc`. Não grava
     nada: as ferramentas que precisem de escrever ficam por aprovar.

   O que fica provado sem token: que a função está publicada, que o catálogo é
   o real, que a escolha é validada e que o esforço tem consequência. O que fica
   provado com token: quem respondeu, em quanto tempo e o que disse.
   =========================================================================== */
export const config = { maxDuration: 60 };

import { createSupabaseRepo, envBase } from './_repo.mjs';
import { envDoPedido } from './_env.mjs';
import { rotasIA, ehRotaIA, escolhaDeModelo, tokensDoEsforco, ESFORCOS } from './_ia/rotas.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = new URL(String(req.url || '/'), 'http://x').searchParams;
  const comToken = !!process.env.PROVA_TOKEN && q.get('token') === process.env.PROVA_TOKEN;

  const base = envBase();
  if (!base.pronto) { res.status(503).json({ error: 'base não configurada' }); return; }

  const corpo = {
    agente: q.get('agente') || 'research',
    mensagem: String(q.get('pergunta') || 'Em duas frases, o que é uma mesa de agentes?').slice(0, 500),
    fornecedor: q.get('fornecedor') || undefined,
    modelo: q.get('modelo') || undefined,
    esforco: q.get('esforco') || undefined,
  };
  const env = envDoPedido(req);
  const repo = createSupabaseRepo(base);
  const saida = { versao: '1.51.0', rota: '/ia/chat', pedido: { fornecedor: corpo.fornecedor || null, modelo: corpo.modelo || null, esforco: corpo.esforco || null } };

  /* ---- a LISTA do painel, calculada aqui (`?lista=1`) ------------------
     1.52.1 · o painel de tarefas constrói o menu do modelo no browser. Esta
     leitura mostra, de fora, exactamente o que ele vai mostrar: os grupos, os
     modelos que podem responder, os que ficam de fora e a nota. É o mesmo
     código (`src/lista-modelos.js`), não uma segunda opinião. */
  if (q.get('lista') === '1') {
    const cat = await rotasIA(repo, { caminho: '/ia/modelos', metodo: 'GET', env, fetchImpl: fetch });
    const est = await rotasIA(repo, { caminho: '/ia/estado', metodo: 'GET', env, fetchImpl: fetch }).catch(() => null);
    /* a mesma evidência do painel: o registo de uso (quem respondeu de verdade) */
    const uso = await rotasIA(repo, { caminho: '/ia/uso?limite=400', metodo: 'GET', env, fetchImpl: fetch }).catch(() => null);
    try {
      const { provaDaLista } = await import('./_ia/lista.mjs');
      res.status(200).json(provaDaLista({ catalogo: cat.corpo, estado: est?.corpo || null, uso: uso?.corpo || null }));
    } catch (e) {
      res.status(200).json({ erro: `a regra da lista não carregou neste deploy: ${e.message}`, catalogo: { fornecedores: cat.corpo?.fornecedores?.length ?? null } });
    }
    return;
  }

  /* ---- o ENSAIO: o catálogo real, a escolha validada, o esforço aplicado ---- */
  if (!comToken) {
    const cat = await rotasIA(repo, { caminho: '/ia/modelos', metodo: 'GET', env, fetchImpl: fetch });
    const fornecedores = (cat.corpo?.fornecedores) || [];
    const comChave = fornecedores.filter((f) => f.comChave && !f.desligado);
    const escolha = escolhaDeModelo(corpo.modelo, corpo.fornecedor);
    const esforco = tokensDoEsforco(corpo.esforco);
    saida.ensaio = true;
    saida.rotaConhecida = ehRotaIA('/ia/chat');
    saida.catalogo = {
      fornecedores: fornecedores.length,
      podemResponder: comChave.map((f) => f.id),
      modelosComChave: comChave.reduce((n, f) => n + (f.catalogo || []).length, 0),
      totalModelos: cat.corpo?.totalModelosCatalogo ?? null,
      esforcos: cat.corpo?.esforcos || Object.keys(ESFORCOS),
    };
    saida.escolha = escolha.erro ? { valida: false, erro: escolha.erro } : { valida: true, pedido: escolha.pedido };
    saida.esforco = esforco.erro ? { valida: false, erro: esforco.erro } : { valido: true, pedido: esforco.pedido, maxTokens: esforco.maxTokens || 1200 };
    saida.conversaReal = 'com ?token=<PROVA_TOKEN> esta rota faz a conversa a sério (gasta um pedido de IA)';
    res.status(200).json(saida);
    return;
  }

  try {
    const r = await rotasIA(repo, { caminho: '/ia/chat', metodo: 'POST', corpo, env, fetchImpl: fetch });
    saida.status = r.status;
    if (r.status >= 400) {
      saida.ok = false;
      saida.erro = r.corpo?.error || `HTTP ${r.status}`;
      if (r.corpo?.fornecedores) saida.fornecedores = r.corpo.fornecedores;
      if (r.corpo?.esforcos) saida.esforcos = r.corpo.esforcos;
    } else {
      saida.ok = !!r.corpo?.resposta;
      saida.quemRespondeu = { fornecedor: r.corpo?.fornecedor || null, modelo: r.corpo?.modelo || null };
      saida.ms = r.corpo?.ms ?? null;
      saida.esforco = r.corpo?.esforco ?? null;
      saida.uso = r.corpo?.uso ?? null;
      saida.ferramentas = Array.isArray(r.corpo?.ferramentas) ? r.corpo.ferramentas.map((f) => f.nome) : [];
      saida.resposta = String(r.corpo?.resposta || '').slice(0, 400);
    }
  } catch (e) {
    saida.ok = false;
    saida.erro = e && e.message ? e.message : 'erro desconhecido';
  }
  /* a marca da rota, para não confundir com código antigo servido de cache */
  saida.rotaConhecida = ehRotaIA('/ia/chat');
  res.status(200).json(saida);
}
