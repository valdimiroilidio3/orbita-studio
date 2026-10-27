/* ===========================================================================
   1.18.0 · AS ROTAS DO CONTROL CENTER (30 out 2026)

   Tudo o que é IA passa aqui. Nenhuma destas respostas contém uma chave: o
   máximo que sai é o NOME da variável de ambiente e uma máscara.

   Rotas:
     GET    /ia/estado                  — fornecedores, estado real, agentes, limites
     GET    /ia/agentes                 — identidade, ferramentas e critérios
     GET    /ia/modelos?fornecedor=     — catálogo (e o que já foi descoberto)
     POST   /ia/modelos/descobrir       — lista real do fornecedor (gasta um pedido)
     POST   /ia/testar                  — pedido real; só isto marca «funcional»
     POST   /ia/chat                    — conversa com um agente (com ferramentas)
     GET    /ia/runs                    — execuções recentes
     POST   /ia/runs                    — abre uma execução
     POST   /ia/runs/:id/correr         — corre-a (pode demorar; a mesa faz polling)
     GET    /ia/runs/:id                — execução + passos
     POST   /ia/runs/:id/cancelar       — pede paragem (verificada entre passos)
     GET    /ia/uso                     — pedidos, latência, erros, tokens
     PATCH  /ia/config                  — desligar fornecedores, modelo por agente
   =========================================================================== */
import { AGENTES, LISTA, promptDe } from './agentes.mjs';
import { FORNECEDORES, MODELOS, modelosDe } from './catalogo.mjs';
import { FERRAMENTAS, INDISPONIVEIS, executar as executarFerramenta, paraModelo } from './ferramentas.mjs';
import { criarMotor } from './motor.mjs';
import { correr } from './orquestrador.mjs';
import { TIPOS } from './router.mjs';

const corpoDe = (c) => (c && typeof c === 'object' ? c : {});
const idDe = (seg) => seg[seg.length - 2];

export function ehRotaIA(caminho) {
  return String(caminho || '').split('?')[0].startsWith('/ia');
}

export async function rotasIA(repo, { caminho, metodo = 'GET', corpo = null, env = process.env, fetchImpl = fetch } = {}) {
  const limpo = '/' + String(caminho || '').replace(/^\/+/, '').split('?')[0];
  const seg = limpo.split('/').filter(Boolean);
  const qs = new URLSearchParams(String(caminho).split('?')[1] || '');
  const m = String(metodo || 'GET').toUpperCase();
  const motor = criarMotor({ repo, env, fetchImpl });

  /* ---------------- estado / catálogo ---------------- */
  if (limpo === '/ia/estado' && m === 'GET') {
    const estado = await motor.estado();
    const cfg = await motor.config();
    return { status: 200, corpo: {
      ...estado,
      agentes: LISTA.map((a) => ({ id: a.id, numero: a.numero, nome: a.nome, papel: a.papel, ferramentas: a.ferramentas, tipos: a.tipos, criterios: a.criterios, modelo: cfg.agentes?.[a.id]?.modelo || null })),
      ferramentas: Object.entries(FERRAMENTAS).map(([id, f]) => ({ id, descricao: f.descricao, destrutiva: !!f.destrutivo })),
      tipos: TIPOS,
      desligados: cfg.desligados || [],
      pronto: estado.diagnostico.pronto,
      instalacao: estado.diagnostico.pronto
        ? 'ha pelo menos um fornecedor com chave e catalogo'
        : 'nenhum fornecedor com chave — as chaves vivem no ambiente da Vercel (nunca no browser)',
    } };
  }

  if (limpo === '/ia/agentes' && m === 'GET') {
    return { status: 200, corpo: { agentes: LISTA } };
  }

  if (limpo === '/ia/modelos' && m === 'GET') {
    const alvo = qs.get('fornecedor');
    const cfg = await motor.config();
    const descobertos = cfg.descobertos || {};
    const fornecedores = Object.entries(FORNECEDORES)
      .filter(([id]) => !alvo || id === alvo)
      .map(([id, p]) => ({
        id, nome: p.nome, estilo: p.estilo, gratuito: !!p.gratuito, limites: p.limites,
        comChave: motor.temChave(id), desligado: (cfg.desligados || []).includes(id),
        catalogo: modelosDe(id).map((x) => ({ modelo: x.modelo, etiquetas: x.etiquetas, janela: x.janela, preco: x.preco, gratuito: !!x.gratuito })),
        descobertos: descobertos[id]?.modelos || [],
        descobertosEm: descobertos[id]?.quando || null,
      }));
    return { status: 200, corpo: { fornecedores, totalModelosCatalogo: MODELOS.length } };
  }

  if (limpo === '/ia/modelos/descobrir' && m === 'POST') {
    const fornecedor = String(corpoDe(corpo).fornecedor || '');
    if (!FORNECEDORES[fornecedor]) return { status: 400, corpo: { error: 'fornecedor desconhecido' } };
    const chaveNome = motor.chaves[fornecedor];
    if (!chaveNome) return { status: 400, corpo: { error: `falta ${FORNECEDORES[fornecedor].chave.join(' ou ')} no ambiente` } };
    const { listarModelos } = await import('./cliente.mjs');
    const modelos = await listarModelos({ fornec: fornecedor, prov: FORNECEDORES[fornecedor], chave: String(env[chaveNome]), fetchImpl });
    const cfg = await motor.config();
    const descobertos = { ...(cfg.descobertos || {}), [fornecedor]: { modelos, quando: new Date().toISOString() } };
    await repo.ia.config.gravar('descobertos', descobertos);
    return { status: 200, corpo: { ok: true, fornecedor, modelos, quantos: modelos.length } };
  }

  /* ---------------- teste real ---------------- */
  if (limpo === '/ia/testar' && m === 'POST') {
    const fornecedor = String(corpoDe(corpo).fornecedor || '');
    if (!FORNECEDORES[fornecedor]) return { status: 400, corpo: { error: 'fornecedor desconhecido' } };
    try {
      const r = await motor.testar(fornecedor);
      return { status: 200, corpo: { ...r, fornecedor, prova: 'pedido real a este fornecedor, agora' } };
    } catch (e) {
      return { status: 200, corpo: { ok: false, fornecedor, erro: e.message, codigo: e.codigo || 'erro' } };
    }
  }

  /* ---------------- conversa com um agente ---------------- */
  if (limpo === '/ia/chat' && m === 'POST') {
    const c = corpoDe(corpo);
    const agente = AGENTES[c.agente] ? String(c.agente) : 'research';
    const texto = String(c.mensagem || c.texto || '').trim();
    if (!texto) return { status: 400, corpo: { error: 'falta a mensagem' } };
    if (texto.length > 8000) return { status: 413, corpo: { error: 'mensagem demasiado longa (máx. 8000 caracteres)' } };
    const permitidas = AGENTES[agente].ferramentas.filter((f) => FERRAMENTAS[f]);
    const conversa = [
      { role: 'system', content: promptDe(agente) },
      ...(Array.isArray(c.historico) ? c.historico.slice(-8).map((x) => ({ role: x.role === 'assistant' ? 'assistant' : 'user', content: String(x.content || '').slice(0, 4000) })) : []),
      { role: 'user', content: texto },
    ];
    const chamadas = [];
    let r = await motor.pedir((AGENTES[agente].tipos || ['texto'])[0], conversa, { ferramentas: paraModelo(permitidas), agente, maxTokens: 1200 });
    for (let volta = 0; volta < 2 && r.chamadas?.length; volta += 1) {
      conversa.push({ role: 'assistant', content: r.texto || '', tool_calls: r.chamadas.map((x) => ({ id: x.id, type: 'function', function: { name: x.nome, arguments: JSON.stringify(x.argumentos || {}) } })) });
      for (const ch of r.chamadas) {
        const res = await executarFerramenta(ch.nome, ch.argumentos, { repo, permitidas, agente, aprovado: !!c.aprovado });
        chamadas.push({ nome: ch.nome, ok: !!res.ok, resumo: res.resumo || res.erro || '', precisaAprovacao: !!res.precisaAprovacao });
        conversa.push({ role: 'tool', tool_call_id: ch.id, name: ch.nome, content: JSON.stringify(res.dados ?? { ok: res.ok, resumo: res.resumo, erro: res.erro }) });
      }
      r = await motor.pedir((AGENTES[agente].tipos || ['texto'])[0], conversa, { ferramentas: paraModelo(permitidas), agente, maxTokens: 1200 });
    }
    return { status: 200, corpo: {
      agente, resposta: r.texto, modelo: r.modelo, fornecedor: r.fornec,
      tentativas: r.tentativas, ms: r.ms, uso: r.uso, ferramentas: chamadas,
    } };
  }

  /* ---------------- execuções ---------------- */
  if (limpo === '/ia/runs' && m === 'GET') {
    return { status: 200, corpo: { runs: await repo.ia.runs.listar(Number(qs.get('limite')) || 20) } };
  }

  if (limpo === '/ia/runs' && m === 'POST') {
    const objetivo = String(corpoDe(corpo).objetivo || '').trim();
    if (objetivo.length < 6) return { status: 400, corpo: { error: 'descreve o trabalho com mais de 5 caracteres' } };
    if (objetivo.length > 2000) return { status: 413, corpo: { error: 'objectivo demasiado longo (máx. 2000)' } };
    const run = await repo.ia.runs.criar({ objetivo, estado: 'novo', agente: 'orchestrator' });
    return { status: 201, corpo: { run } };
  }

  if (seg[1] === 'runs' && seg[3] === 'correr' && m === 'POST') {
    const id = idDe(seg);
    const run = await repo.ia.runs.porId(id);
    if (!run) return { status: 404, corpo: { error: 'execução não encontrada' } };
    if (['a_planear', 'a_executar'].includes(run.estado)) return { status: 409, corpo: { error: 'esta execução já está a correr' } };
    const aprovado = !!corpoDe(corpo).aprovado;
    const final = await correr({ repo, motor, objetivo: run.objetivo, runId: id, aprovado, env });
    return { status: 200, corpo: { run: final, passos: await repo.ia.steps.porRun(id) } };
  }

  if (seg[1] === 'runs' && seg.length === 3 && m === 'GET') {
    const id = seg[2];
    const run = await repo.ia.runs.porId(id);
    if (!run) return { status: 404, corpo: { error: 'execução não encontrada' } };
    return { status: 200, corpo: { run, passos: await repo.ia.steps.porRun(id) } };
  }

  if (seg[1] === 'runs' && seg[3] === 'cancelar' && m === 'POST') {
    const id = idDe(seg);
    const run = await repo.ia.runs.porId(id);
    if (!run) return { status: 404, corpo: { error: 'execução não encontrada' } };
    const r = await repo.ia.runs.actualizar(id, { estado: 'cancelado', fim: new Date().toISOString() });
    return { status: 200, corpo: { ok: true, run: r, nota: 'a paragem é verificada entre passos — o passo a decorrer termina primeiro' } };
  }

  /* ---------------- uso ---------------- */
  if (limpo === '/ia/uso' && m === 'GET') {
    const linhas = await repo.ia.uso.recentes(Number(qs.get('limite')) || 200);
    const porFornecedor = new Map();
    for (const l of linhas) {
      const k = l.fornecedor || '—';
      const a = porFornecedor.get(k) || { fornecedor: k, pedidos: 0, ok: 0, erros: 0, msTotal: 0, tokens: 0 };
      a.pedidos += 1;
      if (l.ok) a.ok += 1; else a.erros += 1;
      a.msTotal += l.ms || 0;
      a.tokens += (l.tokens_in || 0) + (l.tokens_out || 0);
      porFornecedor.set(k, a);
    }
    const resumo = [...porFornecedor.values()].map((a) => ({
      ...a, latenciaMediaMs: a.pedidos ? Math.round(a.msTotal / a.pedidos) : null, msTotal: undefined,
    }));
    return { status: 200, corpo: {
      resumo, ultimos: linhas.slice(0, 25),
      errosRecentes: linhas.filter((l) => !l.ok).slice(0, 10).map((l) => ({ fornecedor: l.fornecedor, modelo: l.modelo, quando: l.criado, erro: l.erro })),
    } };
  }

  /* ---------------- configuração ---------------- */
  if (limpo === '/ia/config' && m === 'GET') {
    const cfg = await motor.config();
    return { status: 200, corpo: { desligados: cfg.desligados || [], agentes: cfg.agentes || {}, testes: cfg.testes || {} } };
  }
  if (limpo === '/ia/config' && (m === 'PATCH' || m === 'POST')) {
    const c = corpoDe(corpo);
    const cfg = await motor.config();
    if (Array.isArray(c.desligados)) {
      const soIds = c.desligados.map(String).filter((x) => FORNECEDORES[x]);
      await repo.ia.config.gravar('desligados', soIds);
    }
    if (c.agentes && typeof c.agentes === 'object') {
      const mapa = { ...(cfg.agentes || {}) };
      for (const [agente, def] of Object.entries(c.agentes)) {
        if (!AGENTES[agente]) continue;
        if (def === null) { delete mapa[agente]; continue; }
        const fornec = String(def?.fornecedor || '');
        const modelo = String(def?.modelo || '');
        if (!FORNECEDORES[fornec] || !modelo) continue;
        mapa[agente] = { modelo: { fornecedor: fornec, modelo } };
      }
      await repo.ia.config.gravar('agentes', mapa);
    }
    motor.limparCaches();
    const novo = await motor.config();
    return { status: 200, corpo: { ok: true, desligados: novo.desligados || [], agentes: novo.agentes || {} } };
  }

  return { status: 404, corpo: { error: `a IA ainda não serve «${limpo}»` } };
}
