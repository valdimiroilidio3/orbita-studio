/* ===========================================================================
   1.18.0 · AS ROTAS DO CONTROL CENTER (30 out 2026)

   Tudo o que é IA passa aqui. Nenhuma destas respostas contém uma chave: o
   máximo que sai é o NOME da variável de ambiente e uma máscara.

   Rotas:
     GET    /ia/estado                  — fornecedores, estado real, agentes, limites
     GET    /ia/agentes                 — identidade, ferramentas e critérios
     GET    /ia/modelos?fornecedor=     — catálogo (e o que já foi descoberto)
     POST   /ia/modelos/descobrir       — lista real do fornecedor (gasta um pedido)
     POST   /ia/provar-modelos          — prova modelo a modelo (descobertos incluídos)
     POST   /ia/testar                  — pedido real; só isto marca «funcional»
     POST   /ia/chat                    — conversa com um agente (com ferramentas)
     GET    /ia/runs                    — execuções recentes
     POST   /ia/runs                    — abre uma execução
     POST   /ia/runs/:id/correr         — corre-a (pode demorar; a mesa faz polling)
     GET    /ia/runs/:id                — execução + passos
     POST   /ia/runs/:id/cancelar       — pede paragem (verificada entre passos)
     GET    /ia/uso                     — pedidos, latência, erros, tokens
     PATCH  /ia/config                  — desligar fornecedores, modelo por agente
     1.19.0
     GET    /ia/memoria                 — estado da memória (plugins do Graft)
     POST   /ia/memoria                 — guardar uma nota
     POST   /ia/memoria/procurar        — procurar (lexical; o modo vai na resposta)
     POST   /ia/memoria/aprender        — ingestão em lote (plano → confirmar)
     GET    /ia/memoria/auditar         — duplicados, notas curtas, paradas
     DELETE /ia/memoria/:id             — apagar uma nota
     GET    /media/estado               — estúdio: worker vivo? pipelines?
     GET    /media/trabalhos            — fila e resultados
     POST   /media/trabalhos            — pedir um vídeo/imagem/áudio/animação/3D
     POST   /media/assumir              — (worker) pega o próximo
     POST   /media/:id/concluir|falhar  — (worker) devolve o resultado real
     POST   /media/sinal                — (worker) heartbeat com o que está instalado
   =========================================================================== */
import { AGENTES, LISTA, promptDe } from './agentes.mjs';
import { FORNECEDORES, MODELOS, modelosDe, comChave, CHAVE_PUBLICA, SEM_CHAVE } from './catalogo.mjs';
import { falar } from './cliente.mjs';
import { VERSAO } from '../_versao.mjs';
import { FERRAMENTAS, INDISPONIVEIS, executar as executarFerramenta, paraModelo } from './ferramentas.mjs';
import { criarMotor } from './motor.mjs';
import { correr } from './orquestrador.mjs';
import * as memoria from './memoria.mjs';
import * as media from './media.mjs';
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
    /* 1.19.0 · a memória e o estúdio fazem parte do estado: se a base não os
       tiver (SQL por correr), diz-se em vez de rebentar a página toda. */
    let resumoMemoria = null;
    try {
      const e = await memoria.estado(repo);
      resumoMemoria = { total: e.total, usos: e.usos, etiquetas: e.etiquetas.slice(0, 8), recentes: e.recentes.slice(0, 5) };
    } catch (e) { resumoMemoria = { erro: `a memória ainda não tem tabela: ${String(e.message).slice(0, 120)}` }; }
    let estudio = null;
    try { estudio = await media.estado(repo, env); } catch (e) { estudio = { configurado: false, porque: `o estúdio ainda não tem tabela: ${String(e.message).slice(0, 120)}` }; }

    return { status: 200, corpo: {
      ...estado,
      memoria: resumoMemoria,
      estudio,
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

  /* 1.32.0 · «há IA gratuita a funcionar?» — uma resposta curta e verdadeira.
     Mostra o que foi medido em produção e a cadeia real por tipo de trabalho. */
  if (limpo === '/ia/gratuitos' && m === 'GET') {
    const motor = criarMotor({ repo, env, fetchImpl });
    const r = await motor.gratuitos();
    const tipos = {};
    for (const t of ['plano', 'codigo', 'texto', 'investigar', 'revisao', 'rapido', 'visao']) {
      tipos[t] = await motor.cadeiaPara(t).catch(() => []);
    }
    return { status: 200, corpo: { ...r, cadeia: tipos } };
  }

  /* 1.42.0 · DIAGNÓSTICO DOS MOTORES — um pedido real, sem escrever nada.
     Porque existe: saber se o Pollinations com chave responde exigia carregar num
     botão na interface. Agora um GET faz a prova e devolve tudo o que se quer
     saber — quem tem chave, que modelo se usou, quanto demorou, o que respondeu —
     sem gravar nada na configuração (para isso é `/ia/testar`). É o que se lê
     depois de um deploy para dizer «as gratuitas funcionam» com factos.

       GET /ia/diagnostico            todos os fornecedores activos
       GET /ia/diagnostico?fornec=pollinations   só um                    */
  if (limpo === '/ia/diagnostico' && m === 'GET') {
    const so = (qs.get('fornec') || '').split(',').map((x) => x.trim()).filter(Boolean);
    const chavesMapa = Object.fromEntries(comChave(env).map((c) => [c.id, c.variavel]));
    const alvos = Object.entries(FORNECEDORES)
      .filter(([id, p]) => p && p.usavel !== false && chavesMapa[id])
      .filter(([id]) => !so.length || so.includes(id))
      .map(([id]) => id);

    const resultados = [];
    for (const id of alvos) {
      const prov = FORNECEDORES[id];
      const marca = chavesMapa[id];
      /* 1.42.0 · a marca pode ser uma variável de ambiente, `SEM_CHAVE`
         (keyless por desenho) ou `CHAVE_PUBLICA` (o serviço publica a chave).
         As duas últimas NÃO são variáveis — lê-las de `env[marca]` dava
         `undefined` e o diagnóstico acusava «falta a chave» num fornecedor que
         responde sem conta. */
      const publica = marca === CHAVE_PUBLICA;
      const daChave = marca && marca !== SEM_CHAVE;
      const chave = publica ? (prov.chavePublica || null) : (daChave ? (env[marca] || null) : null);
      const comChavePropria = !!chave || !!prov.keyless;
      const doCatalogo = modelosDe(id)
        .filter((x) => x.gratuito !== false)
        /* `soComChave` só se prova quando a chave existe: sem ela o modelo nem
           existe no tier anónimo. */
        .filter((x) => !x.soComChave || !!chave)
        .map((x) => x.modelo);
      /* o primeiro modelo do catálogo; no Pollinations com chave, o `openai` */
      const modelos = (id === 'pollinations' && chave ? ['openai', ...doCatalogo] : doCatalogo).slice(0, 2);
      const reg = { fornec: id, nome: prov.nome, comChave: !!chave, publica, semChave: !chave, ok: false, modelo: null, ms: null, resposta: null, erro: null };
      if (!modelos.length) { reg.erro = 'sem modelo no catálogo para este fornecedor'; resultados.push(reg); continue; }
      for (const modelo of modelos) {
        const t0 = Date.now();
        try {
          const r = await falar({
            fornec: id, prov, chave, modelo,
            mensagens: [{ role: 'user', content: 'Responde só com a palavra: órbita' }],
            maxTokens: 30, temperatura: 0, timeoutMs: Math.min(40000, Number(prov.timeoutMs) || 40000), fetchImpl,
          });
          const texto = String(r.texto || '').trim();
          if (!texto) { reg.erro = `${modelo}: resposta vazia`; continue; }
          reg.ok = true; reg.modelo = r.modelo || modelo; reg.ms = r.ms ?? (Date.now() - t0);
          reg.resposta = texto.slice(0, 80); reg.erro = null;
          break;
        } catch (e) {
          reg.erro = `${modelo}: ${String(e.message || e).slice(0, 200)}`;
        }
      }
      resultados.push(reg);
    }
    const ok = resultados.filter((r) => r.ok);
    return {
      status: 200,
      corpo: {
        ok: true,
        versao: VERSAO,
        quando: new Date().toISOString(),
        testados: resultados.length,
        aResponder: ok.length,
        motores: resultados,
        resumo: ok.length
          ? `${ok.length} de ${resultados.length} fornecedor(es) responderam agora: ${ok.map((r) => `${r.fornec}/${r.modelo}`).join(', ')}`
          : resultados.length ? 'nenhum fornecedor respondeu — ver o erro de cada um' : 'nenhum fornecedor activo (sem chave e sem keyless)',
      },
    };
  }

  /* 1.39.0 · «implementa todas as gratuitas»: uma acção que prova, de uma vez, os
     modelos que NÃO exigem chave nova — as keyless (LLM7, OVH, Pollinations) e as
     que publicam a chave (OpenCode Zen). Um a um, com tecto, e sem inventar: cada
     resultado é um pedido real; o que falhar fica escrito com o motivo e não entra
     na cadeia como se tivesse respondido. A prova é a mesma de `/ia/testar`, por
     isso o que passar a funcionar aparece em `/ia/gratuitos` e no Control Center. */
  if (limpo === '/ia/provar-gratuitas' && m === 'POST') {
    const pedido = corpoDe(corpo);
    const tecto = Math.max(1, Math.min(12, Number(pedido.limite) || 6));
    /* só entram os que se podem provar sem uma chave nova: keyless (anónimos) ou
       com chave pública publicada pelo próprio serviço */
    const elegiveis = Object.entries(FORNECEDORES)
      .filter(([, p]) => p && p.usavel !== false && (p.keyless || p.chavePublica))
      .map(([id, p]) => ({ id, chavePublica: !!p.chavePublica, keyless: !!p.keyless }));
    const escolhidos = (Array.isArray(pedido.fornec) && pedido.fornec.length
      ? elegiveis.filter((x) => pedido.fornec.includes(x.id))
      : elegiveis).slice(0, tecto);

    const resultados = [];
    for (const alvo of escolhidos) {
      const modelos = modelosDe(alvo.id).filter((x) => x.gratuito !== false).map((x) => x.modelo);
      const tentativas = modelos.slice(0, 3);
      let provado = null;
      let erros = [];
      for (const modelo of tentativas) {
        try {
          const r = await motor.testar(alvo.id, { modelo });
          if (r && r.ok !== false) { provado = { modelo, ms: r.ms ?? null, resposta: r.texto ? String(r.texto).slice(0, 80) : null }; break; }
          erros.push(`${modelo}: ${r?.erro || 'sem resposta'}`);
        } catch (e) {
          erros.push(`${modelo}: ${String(e.message || e).slice(0, 160)}`);
        }
      }
      resultados.push({
        fornec: alvo.id,
        ok: !!provado,
        modelo: provado?.modelo || tentativas[0] || null,
        ms: provado?.ms ?? null,
        tentados: tentativas,
        erros: provado ? [] : erros,
      });
    }
    const provados = resultados.filter((x) => x.ok).length;
    return {
      status: 200,
      corpo: {
        ok: provados > 0,
        testados: resultados.length,
        provados,
        falhados: resultados.length - provados,
        resultados,
        nota: provados
          ? `${provados} fornecedor(es) sem chave responderam agora; os que já estavam provados continuam em /ia/gratuitos.`
          : 'Nenhum respondeu agora. Os motivos estão em cada linha — não se marca nada como funcional sem uma resposta real.',
      },
    };
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
    const pedido = corpoDe(corpo);
    /* 1.43.0 · `fornecedor: 'todos'` pergunta a todos os que se podem listar
       (chave, chave pública ou keyless). É o botão «Descobrir modelos»: sem
       ele, o catálogo ficava nos 158 declarados à mão e o tier do Pollinations
       — que já está pago — nunca era usado. */
    const alvo = String(pedido.fornecedor || '');
    const todos = alvo === 'todos' || alvo === '*' || alvo === '';
    if (!todos && !FORNECEDORES[alvo]) return { status: 400, corpo: { error: 'fornecedor desconhecido' } };
    if (!todos) {
      const prov = FORNECEDORES[alvo];
      const chaveNome = motor.chaves[alvo];
      if (!chaveNome && !prov.keyless && !prov.chavePublica) {
        return { status: 400, corpo: { error: `falta ${(prov.chave || []).join(' ou ')} no ambiente` } };
      }
    }
    /* a força é explícita: `remoto` só se pedires (a cache de 6 h serve o resto) */
    const feitos = await motor.descobrirSePreciso({ forcar: pedido.forcar === true, fornec: todos ? null : alvo });
    const cfg = await motor.config();
    const descobertos = cfg.descobertos || {};
    const quantos = Object.values(descobertos).reduce((n, x) => n + (Array.isArray(x?.modelos) ? x.modelos.length : 0), 0);
    return {
      status: 200,
      corpo: {
        ok: true,
        fornecedor: todos ? 'todos' : alvo,
        /* o que mudou AGORA (a cache pode ter servido o resto) */
        actualizados: feitos,
        quantos,                                   // total guardado, somando fornecedores
        guardados: Object.fromEntries(Object.entries(descobertos).map(([id, x]) => [id, {
          quantos: Array.isArray(x?.modelos) ? x.modelos.length : 0,
          quando: x?.quando || null,
        }])),
        /* compatibilidade: quem já lia `modelos` deste POST continua a ler */
        modelos: descobertos[todos ? Object.keys(descobertos)[0] : alvo]?.modelos || [],
      },
    };
  }

  /* 1.44.0 · «faz com que uma boa parte dos outros também funcionem».
     Descobrir não é funcionar: um modelo descoberto só conta para a cadeia depois
     de responder a um pedido. Aqui prova-se em lote, model a model, com tecto de
     tempo. Aceita GET porque é idempotente na prática (só grava provas reais) e
     assim pode ser chamado de um browser ou de uma verificação rápida. */
  if (limpo === '/ia/provar-modelos' && (m === 'POST' || m === 'GET')) {
    const pedido = m === 'GET' ? Object.fromEntries(qs.entries()) : corpoDe(corpo);
    const fornec = String(pedido.fornecedor || '').trim();
    if (fornec && !FORNECEDORES[fornec]) return { status: 400, corpo: { error: 'fornecedor desconhecido' } };
    const r = await motor.provarModelos({
      fornec: fornec || null,
      limite: Number(pedido.limite) || 9,
      concorrencia: Number(pedido.concorrencia) || 4,
      forcar: pedido.forcar === true || pedido.forcar === '1',
    });
    return {
      status: 200,
      corpo: {
        ...r,
        fornecedor: fornec || 'todos',
        nota: r.provados
          ? `${r.provados} modelo(s) responderam agora e entram na cadeia; os restantes continuam «por provar» com o motivo de cada um.`
          : 'Nenhum respondeu agora. Os motivos estão em cada linha — não se promove nada sem uma resposta real.',
      },
    };
  }

  /* ---------------- teste real ---------------- */
  if (limpo === '/ia/testar' && m === 'POST') {
    const pedido = corpoDe(corpo);
    const fornecedor = String(pedido.fornecedor || '');
    if (!FORNECEDORES[fornecedor]) return { status: 400, corpo: { error: 'fornecedor desconhecido' } };
    /* `modelo` é opcional: sem ele prova-se o fornecedor (como antes); com ele
       prova-se exactamente aquele modelo, que é o que o botão «Provar» pede. */
    const modelo = pedido.modelo ? String(pedido.modelo) : null;
    try {
      const r = await motor.testar(fornecedor, { modelo });
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
    const c = corpoDe(corpo);
    const aprovado = !!c.aprovado;
    const retomar = !!c.retomar;
    if (retomar && !run.plano) return { status: 409, corpo: { error: 'esta execução não tem plano gravado — retomar só serve para continuar trabalho já planeado' } };
    const final = await correr({ repo, motor, objetivo: run.objetivo, runId: id, aprovado, retomar, env });
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

  /* ---------------- 1.19.0 · memória (Graft) ---------------- */
  if (limpo === '/ia/memoria' && m === 'GET') {
    return { status: 200, corpo: await memoria.estado(repo) };
  }

  if (limpo === '/ia/memoria' && m === 'POST') {
    const r = await memoria.guardar(repo, corpoDe(corpo));
    return { status: r.ok ? 201 : 400, corpo: r.ok ? r : { error: r.erro } };
  }

  if (limpo === '/ia/memoria/procurar' && m === 'POST') {
    const c = corpoDe(corpo);
    return { status: 200, corpo: await memoria.procurar(repo, { consulta: c.consulta, projeto: c.projeto || null, limite: Number(c.limite) || 8 }) };
  }

  if (limpo === '/ia/memoria/aprender' && m === 'POST') {
    const c = corpoDe(corpo);
    const r = await memoria.aprender(repo, { ...c, confirmar: !!c.confirmar });
    return { status: r.ok ? 200 : 400, corpo: r.ok ? r : { error: r.erro } };
  }

  if (limpo === '/ia/memoria/auditar' && m === 'GET') {
    return { status: 200, corpo: await memoria.auditar(repo, { projeto: qs.get('projeto') || null }) };
  }

  if (seg[1] === 'memoria' && seg.length === 3 && m === 'DELETE') {
    await repo.ia.memoria.apagar(seg[2]);
    return { status: 200, corpo: { ok: true, apagada: seg[2] } };
  }

  /* ---------------- 1.19.0 · estúdio de media (OpenMontage) ---------------- */
  if (limpo === '/media/estado' && m === 'GET') {
    return { status: 200, corpo: await media.estado(repo, env) };
  }

  if (limpo === '/media/trabalhos' && m === 'GET') {
    return media.listar(repo, Number(qs.get('limite')) || 30);
  }

  if (limpo === '/media/trabalhos' && m === 'POST') {
    const c = corpoDe(corpo);
    return media.criar(repo, { pedido: c.pedido, tipo: c.tipo, pipeline: c.pipeline }, env);
  }

  /* a partir daqui é o worker: token próprio, comparado em tempo constante possível */
  if (limpo.startsWith('/media/') && m === 'POST') {
    const recebido = corpoDe(corpo).token || qs.get('token');
    if (!media.tokenOk(env, recebido)) return { status: 401, corpo: { error: 'token do worker inválido ou ausente' } };
    const c = corpoDe(corpo);

    if (limpo === '/media/assumir') return media.assumir(repo, env);
    if (limpo === '/media/sinal') return media.sinal(repo, c);

    const acao = seg[seg.length - 1];
    if (seg[1] === 'media' && seg.length === 4 && acao === 'concluir') return media.concluir(repo, seg[2], c);
    if (seg[1] === 'media' && seg.length === 4 && acao === 'falhar') return media.falhar(repo, seg[2], c.motivo);
    return { status: 404, corpo: { error: `rota de media desconhecida: ${limpo}` } };
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
