/* ===========================================================================
   1.18.0 · O MOTOR (30 out 2026)

   Liga as peças: catálogo + cliente + router + ferramentas + base.
   É a única peça que sabe onde estão as chaves (ambiente) e que regista o uso.

   O que NUNCA acontece aqui:
     · devolver uma chave ao chamador (`/ia/estado` só devolve o NOME da
       variável e uma máscara);
     · dizer que um fornecedor funciona sem um teste real bem-sucedido;
     · esconder um erro atrás de texto bonito.
   =========================================================================== */
import { CHAVE_PUBLICA, FORNECEDORES, MODELOS, SEM_CHAVE, comChave, mascarar, modelosDe } from './catalogo.mjs';
import { ErroIA, falar, listarModelos, listarModelosDetalhados } from './cliente.mjs';
import { cadeia, diagnostico, exportarFora, falarComFallback, importarFora, marcarFora, orcamento } from './router.mjs';
import { PROVADOS, catalogoDaCadeia, descobertosSalvos, estadoCurto, eModeloDeConversa, preferidoDoAmbiente, provadosActivos, resumo as resumoGratuitos } from './gratuitos.mjs';

export function chavesDoAmbiente(env = process.env) {
  const mapa = {};
  for (const { id, variavel } of comChave(env)) mapa[id] = variavel;   // id → NOME da variável
  return mapa;
}

/* 1.44.4 · bloqueios vistos por este processo. A base é a fonte principal, mas
   um deploy frio (ou uma leitura falhada) não pode fazer o lote insistir num
   fornecedor que acabou de dizer «limite atingido». */
const BLOQUEIOS = {};

/**
 * Um bloqueio é válido?
 * Não, quando o motivo é falta/recusa de chave e o fornecedor é keyless: nesse
 * caso a chave não existe por desenho, e o erro é do modelo (tier pago) ou de um
 * `chavePublica` que mudou. Respeitar isso tirava um fornecedor inteiro da cadeia
 * sem motivo — aconteceu ao LLM7 a 28 out 2026.
 */
export function bloqueioValido(fornec, teste = {}) {
  if (!teste?.bloqueadoAte) return true;
  const prov = FORNECEDORES[fornec];
  const semChavePorDesenho = !!prov && (prov.keyless || prov.chavePublica);
  const motivo = String(teste.bloqueadoPor || '');
  const eChave = /chave|api key|unauthor|forbidden|401|403/i.test(motivo);
  return !(semChavePorDesenho && eChave);
}

/** Só para testes: esquecer os bloqueios deste processo. */
export function esquecerBloqueios() { for (const k of Object.keys(BLOQUEIOS)) delete BLOQUEIOS[k]; }

export function criarMotor({ repo, env = process.env, fetchImpl = fetch, agora = () => new Date().toISOString() } = {}) {
  const chaves = chavesDoAmbiente(env);
  const valorDaChave = (id) => {
    const nome = chaves[id];
    const prov = FORNECEDORES[id];
    if (!nome || nome === SEM_CHAVE || nome === CHAVE_PUBLICA) {
      /* 1.33.0 · keyless não tem chave; quem publica a sua (OpenCode Zen)
         usa exactamente a que o serviço indica — não é segredo nem invenção. */
      return prov?.chavePublica || '';
    }
    return String(env[nome] || '');
  };

  let cacheConfig = null;
  let cacheLat = null;
  let foraRestaurado = false;
  let foraGravado = '';

  async function config() {
    if (cacheConfig) return cacheConfig;
    try { cacheConfig = (await repo.ia.config.ler()) || {}; } catch { cacheConfig = {}; }
    return cacheConfig;
  }

  /* 1.32.0 · os modelos que o fornecedor disse não ter sobrevivem ao arranque a
     frio. Sem isto, cada invocação voltava a tentar `gpt-oss-20b` no LLM7 e a
     pagar o mesmo erro — foi o que se viu em produção a 27 out 2026. */
  async function restaurarFora() {
    if (foraRestaurado) return;
    foraRestaurado = true;
    try {
      const cfg = await config();
      const n = importarFora(cfg.fora || {});
      if (n) foraGravado = JSON.stringify(cfg.fora || {});
    } catch { /* sem base, a memória do processo serve */ }
  }

  async function guardarFora() {
    const agora = exportarFora();
    const json = JSON.stringify(agora);
    if (json === foraGravado) return;
    try {
      await repo.ia.config.gravar('fora', agora);
      foraGravado = json;
      cacheConfig = { ...(cacheConfig || {}), fora: agora };
    } catch { /* guardar é útil, não é bloqueante */ }
  }

  async function latencias() {
    if (cacheLat) return cacheLat;
    try { cacheLat = (await repo.ia.uso.latencias()) || {}; } catch { cacheLat = {}; }
    return cacheLat;
  }

  /** Chamada crua a um fornecedor/modelo concreto (usada pelo router e pelos testes). */
  async function chamar(entrada, mensagens, { ferramentas = [], maxTokens = 1200, temperatura = 0.3, timeoutMs = null } = {}) {
    const prov = FORNECEDORES[entrada.fornec];
    if (!prov) throw new ErroIA(`fornecedor desconhecido: ${entrada.fornec}`, { fornec: entrada.fornec });
    const chave = valorDaChave(entrada.fornec);
    /* 1.32.0 · o OVH responde em 13–45 s: com o tecto global de 45 s, metade dos
       pedidos morria à espera de uma resposta que estava a chegar. O tecto do
       fornecedor vale quando o chamador não impõe um. */
    const espera = Number(timeoutMs) || Number(prov.timeoutMs) || 45000;
    const r = await falar({ fornec: entrada.fornec, prov, chave, modelo: entrada.modelo, mensagens, ferramentas, maxTokens, temperatura, timeoutMs: espera, fetchImpl });
    return { ...r, ferramentasPedidas: r.chamadas };
  }

/**
 * 1.43.0 · DESCOBRIR OS MODELOS QUE O FORNECEDOR TEM, E USÁ-LOS.
 *
 * O problema que isto resolve: o catálogo escrito à mão tem 158 modelos e
 * só 3 do Pollinations. O tier com chave publica dezenas, o LLM7 e o OVH
 * também têm os seus. Sem os perguntar, a cadeia trabalha com uma fracção
 * do que já está pago/aberto.
 *
 * Regras, para não voltar a ser um problema:
 *   · só se pergunta a fornecedores que se podem listar (chave, chave
 *     pública ou keyless) — nunca a quem não tem chave;
 *   · uma pergunta a cada 6 h por fornecedor (o resultado fica na base);
 *     não há chamadas repetidas;
 *   · uma falha é silenciosa: descoberta é extra, não é caminho crítico.
 */
const descobrirSePreciso = async ({ forcar = false, fornec: so = null } = {}) => {
  const TTL = 6 * 60 * 60 * 1000;
  const cfg = await config();
  const salvos = { ...(cfg.descobertos || {}) };
  const feitos = [];
  const t0 = Date.now();
  for (const id of Object.keys(FORNECEDORES)) {
    if (so && id !== so) continue;
    const prov = FORNECEDORES[id];
    if (!prov || prov.usavel === false) continue;
    const chave = valorDaChave(id);
    if (!chave && !prov.keyless) continue;
    const quando = Date.parse(salvos[id]?.quando || '') || 0;
    if (!forcar && quando && t0 - quando < TTL) continue;
    try {
      const modelos = await listarModelosDetalhados({ fornec: id, prov, chave, fetchImpl });
      if (!modelos.length) continue;
      salvos[id] = { modelos, quando: agora() };
      feitos.push({ fornec: id, quantos: modelos.length });
    } catch { /* silencioso de propósito: ver o comentário acima */ }
  }
  if (feitos.length) {
    await repo.ia.config.gravar('descobertos', salvos);
    cacheConfig = null;
  }
  return feitos;
};

/**
 * 1.44.0 · PROVAR MODELOS A SÉRIO, UM A UM — é o que transforma «o fornecedor
 * diz que tem» em «respondeu».
 *
 * O 1.43.0 descobriu dezenas de modelos reais (o Pollinations com chave publica
 * `openai/gpt-5.4-nano`, `x-ai/grok-4.6`, `moonshotai/kimi-k3`…). Mas descobrir
 * não é funcionar: até haver uma resposta registada, o modelo fica «descoberto»
 * e a cadeia não ganha nada com ele. Aqui cada modelo leva um pedido curto
 * verdadeiro; só os que respondem com texto entram em
 * `cfg.testes[fornec].provados` — e é essa lista que põe o modelo na cadeia.
 *
 * Regras:
 *   · nada de modelos de conversa: embeddings/TTS/imagem são excluídos na origem;
 *   · tecto de tempo (12 s por modelo) e paralelismo 4, para caber nos 60 s da
 *     função serverless; o resto fica para a próxima chamada;
 *   · um modelo que falha NÃO é apagado de lado nenhum — só não é promovido;
 *   · `forcar: true` volta a provar os já provados (para medir de novo).
 */
const provarModelos = async ({ fornec: so = null, limite = 9, concorrencia = 4, forcar = false, timeoutMs = 12000 } = {}) => {
  const cfg = await config();
  const testes = JSON.parse(JSON.stringify(cfg.testes || {}));
  const desligados = cfg.desligados || [];
  const quantos = Math.max(1, Math.min(16, Number(limite) || 9));
  const paralelo = Math.max(1, Math.min(6, Number(concorrencia) || 4));
  const descobertos = descobertosSalvos(cfg);

  /* 1.44.5 · os curados da lista (PROVADOS) também já responderam: sem isto,
     a prova voltava a tentar `codestral-latest` e `gpt-oss-120b` em cada lote —
     viu-se em produção a 28 out 2026, 3 das 9 tentativas foram repetições. */
  const curados = new Set(PROVADOS.map((p) => `${p.fornec}\u0000${p.modelo}`));
  const jaProvado = (id, modelo) => curados.has(`${id}\u0000${modelo}`)
    || !!(testes[id]?.provados?.[modelo] && testes[id].provados[modelo].ok !== false);
  /* 1.44.2 · um fornecedor que acabou de dizer «limite atingido» não é tentado
     outra vez na chamada seguinte: em produção, três chamadas seguidas foram
     quatro tentativas cada ao OpenCode, todas com o mesmo 429. O bloqueio fica
     gravado (30 min para limite; 6 h para chave/crédito) e expira sozinho. */
  const agoraMs = Date.parse(agora()) || Date.now();
  const bloqueados = [];
  const ignorados = [];
  const candidatos = [];
  for (const id of Object.keys(FORNECEDORES)) {
    if (so && id !== so) continue;
    const prov = FORNECEDORES[id];
    if (!prov || prov.usavel === false || desligados.includes(id)) continue;
    const chave = valorDaChave(id);
    if (!chave && !prov.keyless) continue;                 // sem acesso, não se tenta
    const guardado = testes[id];
    /* 1.45.0 · um bloqueio inválido não se respeita. Em produção, o LLM7 ficou
       6 h de fora por um «Missing API key» de um modelo do tier pago — antes da
       1.44.5, que corrigiu a origem. O bloqueio velho continuava a ser lido; a
       regra certa é não confiar nele: um fornecedor keyless não pode estar
       bloqueado por falta de chave. */
    const valido = bloqueioValido(id, guardado);
    const ate = valido
      ? Math.max(Date.parse(guardado?.bloqueadoAte || '') || 0, BLOQUEIOS[id] || 0)
      : 0;
    if (!valido && guardado?.bloqueadoAte) {
      ignorados.push({ fornec: id, motivo: guardado.bloqueadoPor || null, porque: 'bloqueio inválido: fornecedor keyless não fica sem chave' });
      delete testes[id].bloqueadoAte; delete testes[id].bloqueadoPor;
    }
    if (ate > agoraMs) {
      bloqueados.push({
        fornec: id,
        motivo: testes[id]?.bloqueadoPor || 'bloqueado por falha recente',
        ate: testes[id]?.bloqueadoAte || new Date(ate).toISOString(),
      });
      continue;
    }
    const declarados = modelosDe(id)
      .filter((m) => m.gratuito !== false)
      .map((m) => m.modelo)
      .filter((m) => eModeloDeConversa(m));
    const achados = descobertos.filter((m) => m.fornecedor === id).map((m) => m.modelo);
    for (const modelo of [...new Set([...declarados, ...achados])]) {
      if (!forcar && jaProvado(id, modelo)) continue;
      candidatos.push({ fornec: id, modelo });
    }
  }
  /* Prioridade: chave própria no ambiente primeiro (é onde há mais fruta e
     quota real), depois os keyless, e por fim quem publica a chave — foi o
     OpenCode que, a 28 out 2026, gastou 9 de 12 tentativas num «free usage
     limit reached» que nenhuma delas ia passar. */
  const pesoDoFornec = (id) => {
    const prov = FORNECEDORES[id];
    const nome = chaves[id];
    if (nome && !String(nome).startsWith('\u0000') && String(env[nome] || '').trim()) return 0;  // chave própria
    if (prov?.keyless) return 1;
    return 2;                                                                                    // chave pública
  };
  candidatos.sort((a, b) => pesoDoFornec(a.fornec) - pesoDoFornec(b.fornec));
  /* 1.44.4 · rodízio entre fornecedores, e não «os 12 primeiros da lista»: em
     produção o lote foi todo para o OpenCode só porque ele vinha primeiro na
     ordem do catálogo, e um fornecedor sem quota consumiu a chamada inteira.
     Com rodízio, cada fornecedor leva no máximo um modelo antes de o segundo
     de qualquer um entrar — e um fornecedor que falhe perde no máximo 1-2. */
  const porFornec = new Map();
  for (const c of candidatos) {
    if (!porFornec.has(c.fornec)) porFornec.set(c.fornec, []);
    porFornec.get(c.fornec).push(c);
  }
  const filas = [...porFornec.entries()].sort((a, b) => pesoDoFornec(a[0]) - pesoDoFornec(b[0])).map(([, f]) => f);
  const alvos = [];
  while (alvos.length < quantos && filas.some((f) => f.length)) {
    for (const fila of filas) {
      if (alvos.length >= quantos) break;
      const proximo = fila.shift();
      if (proximo) alvos.push(proximo);
    }
  }

  const resultados = [];
  const saltados = [];
  /* um erro que é do FORNECEDOR (limite, crédito, chave) não se resolve a tentar
     outro modelo dele: param-se os restantes para não queimar o lote */
  const falhaDoFornecedor = (codigo) => ['limite', 'credito', 'chave', 'semchave'].includes(String(codigo || ''));
  for (let i = 0; i < alvos.length; i += paralelo) {
    const grupo = alvos.slice(i, i + paralelo);
    const feitos = await Promise.all(grupo.map(async ({ fornec, modelo }) => {
      const prov = FORNECEDORES[fornec];
      const chave = valorDaChave(fornec);
      const t0 = Date.now();
      try {
        /* 1.44.7 · dois orçamentos, não um. Um modelo de raciocínio gasta os
           primeiros tokens a pensar e devolve texto vazio: em produção, 4 de 10
           tentativas ao OVH falharam só porque o pedido tinha 32 tokens de saída.
           O primeiro pedido é curto (barato); se voltar vazio, repete-se com
           espaço para ele pensar, dentro do mesmo tecto de tempo. */
        let texto = '';
        let ultimo = null;
        let tentativas = 0;
        for (const orcamento of [64, 900]) {
          const gasto = Date.now() - t0;
          const restante = timeoutMs - gasto;
          if (restante < 1500) break;                 // não vale a pena começar outro
          tentativas += 1;
          ultimo = await falar({
            fornec, prov, chave, modelo,
            mensagens: [{ role: 'user', content: 'Responde apenas: ok' }],
            maxTokens: orcamento, temperatura: 0,
            timeoutMs: Math.min(timeoutMs, restante), fetchImpl,
          });
          texto = String(ultimo?.texto || '').trim();
          if (texto) break;
        }
        const ms = Date.now() - t0;
        if (!texto) {
          return {
            fornec, modelo, ok: false, ms, tentativas,
            erro: `respondeu vazio com ${tentativas === 1 ? '64' : '64 e 900'} tokens de saída (modelo de raciocínio que não devolve texto)`,
          };
        }
        return { fornec, modelo, ok: true, ms, tentativas, resposta: texto.slice(0, 40) };
      } catch (e) {
        let codigo = e?.codigo || null;
        /* 1.44.8 · o fornecedor diz, com todas as letras, que o modelo não serve
           para o endpoint de texto («is a audio model», «is a realtime model»,
           «could not parse … TypeSafe request»). Isso não é uma falha de rede nem
           um modelo «por provar»: é um modelo que não conversa. Sai da cadeia 6 h
           e não volta a gastar tentativas. */
        const motivo = String(e?.message || e);
        const naoConversa = /is an? (audio|realtime|image|video) model|cannot be used on the text endpoint|could not parse the user message content as JSON|TypeSafe request/i.test(motivo);
        if (naoConversa) codigo = 'naoConversa';
        /* 1.44.5 · num fornecedor keyless, «missing API key» é daquele modelo
           (o tier pago dele), não do fornecedor: bloquear o LLM7 inteiro por
           causa de um modelo tirava o `codestral-latest` da cadeia 6 h. */
        const doFornecedor = falhaDoFornecedor(codigo) && !(codigo === 'chave' && prov.keyless);
        /* um modelo que dá 502/404 repetidamente sai da cadeia 6 h (mecanismo que
           já existia para os modelos indisponíveis): não vale a pena tentá-lo */
        if (codigo === 'avaria' || codigo === 'modelo' || codigo === 'naoConversa') marcarFora(fornec, modelo, Date.now());
        return {
          fornec, modelo, ok: false, ms: Date.now() - t0,
          codigo, doFornecedor,
          erro: String(e?.message || e).slice(0, 200),
        };
      }
    }));
    resultados.push(...feitos);
    for (const r of feitos) {
      if (!r.doFornecedor) continue;
      const ttl = r.codigo === 'limite' ? 30 * 60 * 1000 : 6 * 60 * 60 * 1000;
      testes[r.fornec] = testes[r.fornec] || {};
      testes[r.fornec].bloqueadoAte = new Date(agoraMs + ttl).toISOString();
      BLOQUEIOS[r.fornec] = agoraMs + ttl;   // rede de segurança: sobrevive ao mesmo processo
      testes[r.fornec].bloqueadoPor = String(r.erro || '').slice(0, 200);
      saltados.push({ fornec: r.fornec, motivo: r.erro, restantes: alvos.filter((a) => a.fornec === r.fornec && !resultados.some((x) => x.modelo === a.modelo)).length });
      for (let k = alvos.length - 1; k > i + paralelo - 1; k -= 1) {
        if (alvos[k].fornec === r.fornec) alvos.splice(k, 1);
      }
    }
  }

  const bons = resultados.filter((r) => r.ok);
  for (const r of bons) {
    testes[r.fornec] = testes[r.fornec] || {};
    testes[r.fornec].provados = { ...(testes[r.fornec].provados || {}), [r.modelo]: { ok: true, ms: r.ms, quando: agora() } };
  }
  await guardarFora().catch(() => {});
  if (bons.length || saltados.length) {
    try { await repo.ia.config.gravar('testes', testes); } catch { /* sem base, a prova existe mas não persiste */ }
    cacheConfig = null;
  }
  for (const r of bons) {
    try {
      await repo.ia.uso.registar({ fornecedor: r.fornec, modelo: r.modelo, agente: 'teste', tipo: 'teste-modelo', ok: true, ms: r.ms, tokens_in: 0, tokens_out: 0, erro: null });
    } catch { /* registar é útil, não é bloqueante */ }
  }
  return {
    ok: bons.length > 0,
    testados: resultados.length,
    provados: bons.length,
    falhados: resultados.length - bons.length,
    porProvarRestantes: Math.max(0, candidatos.length - resultados.length),
    /* 1.44.4 · transparência: o que esta chamada decidiu tentar, e por que motivo
       ficou de fora. Sem isto, «testados: 4» sem saber quais é adivinhação. */
    alvos,
    /* fornecedores que pararam o lote por um motivo que não é do modelo */
    /* bloqueios que existiam mas não valiam (ver `bloqueioValido`) */
    ignorados,
    saltados: [
      ...bloqueados,
      ...saltados.filter((x, i, arr) => arr.findIndex((y) => y.fornec === x.fornec) === i),
    ],
    resultados,
  };
};

  /**
   * 1.45.0 · tirar bloqueios, com o motivo à vista. Serve para o caso real de
   * hoje: um bloqueio escrito por um bug antigo (ou por uma avaria passageira)
   * continuava a manter um fornecedor fora da cadeia até expirar sozinho.
   * Com `so`, limpa um; sem, limpa todos os que existirem.
   */
  async function limparBloqueios({ so = null } = {}) {
    const cfg = await config();
    const testes = JSON.parse(JSON.stringify(cfg.testes || {}));
    const limpos = [];
    for (const [fornec, t] of Object.entries(testes)) {
      if (so && fornec !== so) continue;
      if (!t?.bloqueadoAte) continue;
      limpos.push({ fornec, ate: t.bloqueadoAte, motivo: t.bloqueadoPor || null });
      delete t.bloqueadoAte; delete t.bloqueadoPor;
      delete BLOQUEIOS[fornec];
    }
    if (limpos.length) {
      try { await repo.ia.config.gravar('testes', testes); } catch { /* sem base: a memória já foi limpa */ }
      cacheConfig = null;
    }
    return limpos;
  }

  return {
    descobrirSePreciso,
    provarModelos,
    limparBloqueios,
    chaves,
    /* «pronto» = tem chave, ou não precisa dela (keyless). Nunca confundir
       «pronto» com «funcional»: isso é o teste real. */
    temChave: (id) => !!chaves[id]
      || (!!FORNECEDORES[id]?.keyless && FORNECEDORES[id]?.usavel !== false)
      || (!!FORNECEDORES[id]?.chavePublica && FORNECEDORES[id]?.usavel !== false),
    config,
    latencias,
    limparCaches() { cacheConfig = null; cacheLat = null; },

    /** Estado para a interface: nunca devolve segredos, só o nome da variável. */
    async estado() {
      const cfg = await config();
      const desligados = cfg.desligados || [];
      const testes = cfg.testes || {};
      const lat = await latencias();
      const fornecedores = Object.entries(FORNECEDORES).map(([id, p]) => {
        /* 1.33.0 · uma chave publicada pelo serviço não é uma variável do dono:
           na interface aparece como «não precisa», nunca com uma marca interna. */
        const marca = chaves[id];
        const publica = marca === CHAVE_PUBLICA;
        const variavel = (!marca || marca === SEM_CHAVE || publica) ? null : marca;
        const t = testes[id] || null;
        const pronto = !!variavel || publica || (!!p.keyless && p.usavel !== false);
        return {
          id, nome: p.nome, site: p.site, docs: p.docs, estilo: p.estilo,
          gratuito: !!p.gratuito, limites: p.limites, nota: p.nota || '',
          variavel,                                    // NOME da variável, não valor (null = sem chave por desenho)
          variaveis: p.chave,                          // o que aceita (para a interface dizer)
          /* 1.42.0 · `semChave` = «também trabalha sem chave» (o Pollinations é
             keyless e tem tier). `comChaveAgora` diz se a chave existe mesmo
             neste ambiente — sem isto, o painel não distinguia o Pollinations
             anónimo do Pollinations com chave, que são motores diferentes. */
          semChave: !!p.keyless || publica,
          comChaveAgora: !!variavel || publica,
          publica,
          familia: p.familia || 'nucleo',
          tipo: p.tipo || 'chat',
          chaveMascarada: variavel ? mascarar(env[variavel]) : '',
          configurado: pronto,
          desligado: desligados.includes(id),
          testado: !!t, ultimoTeste: t ? { quando: t.quando, ok: !!t.ok, ms: t.ms ?? null, erro: t.erro || null, modelos: t.modelos ?? null } : null,
          estado: p.usavel === false ? 'inutilizavel'
            : !pronto ? 'sem_chave'
            : desligados.includes(id) ? 'desligado'
            : (t ? (t.ok ? 'funcional' : 'erro') : 'por_testar'),
          modelosNoCatalogo: modelosDe(id).length,
          latenciaMediaMs: Object.entries(lat).filter(([k]) => k.startsWith(`${id}\u0000`)).map(([, v]) => v)[0] ?? null,
        };
      });
      const diag = diagnostico({ chaves, desligados });
      return {
        fornecedores, diagnostico: diag,
        motoresConfigurados: Object.keys(chaves),
        versaoCatalogo: { fornecedores: Object.keys(FORNECEDORES).length, modelos: MODELOS.length },
        indisponiveis: (await import('./ferramentas.mjs')).INDISPONIVEIS,
      };
    },

    /** Um pedido com fallback + registo de uso. */
    async pedir(tipo, mensagens, {
      ferramentas = [], agente = null, maxTokens = 1200, temperatura = 0.3,
      orc = orcamento(), preferido = null, limite = 4, timeoutMs = null,
    } = {}) {
      const cfg = await config();
      const desligados = cfg.desligados || [];
      /* 1.42.0 · sem modelo escolhido à mão, o padrão é uma gratuita — e, se o
         dono deu a chave do Pollinations, é esse (ver preferidoDoAmbiente). */
      const pref = preferido || cfg.agentes?.[agente]?.modelo || preferidoDoAmbiente(chaves);
      /* quem já passou num teste REAL deste fornecedor vai à frente na cadeia */
      const cfgAgora = await config();
      const usados = {};
      for (const [fornec, t] of Object.entries(cfgAgora.testes || {})) {
        if (t?.ok && t?.usado) usados[`${fornec}/${t.usado}`] = true;
      }
      await restaurarFora();
      const resultado = await falarComFallback(tipo, {
        chaves, desligados, preferido: pref, latencias: await latencias(), orc, limite, usados,
        /* 1.32.0 · os gratuitos medidos entram à frente do catálogo
           1.33.0 · e o catálogo passa a incluir o que a descoberta encontrou
           nos fornecedores sem custo (OpenCode Zen, Pollinations) */
        /* 1.44.9 · TODOS os provados, não só os três curados à mão. Em produção,
           a cadeia começava por modelos `community/…` que nunca responderam,
           enquanto 43 modelos com resposta registada ficavam de fora da
           ordenação. Provar não servia de nada — o mesmo erro do «listar não é
           funcionar», agora na pontuação. */
        provados: provadosActivos({ chaves, desligados, cfg: cfgAgora }),
        catalogo: catalogoDaCadeia(cfgAgora),
        executar: (entrada) => chamar(entrada, mensagens, { ferramentas, maxTokens, temperatura, timeoutMs }),
        registar: async (evento) => {
          try {
            await repo.ia.uso.registar({
              fornecedor: evento.fornec, modelo: evento.modelo, agente,
              tipo, ok: !!evento.ok, ms: evento.ms || 0,
              tokens_in: evento.uso?.entrada || 0, tokens_out: evento.uso?.saida || 0,
              erro: evento.ok ? null : String(evento.erro || '').slice(0, 300),
            });
          } catch { /* registar é útil, não é bloqueante */ }
        },
      });
      await guardarFora();
      return resultado;
    },

    /** 1.32.0 · o que é gratuito, o que já respondeu e quanto demora. */
    async gratuitos() {
      /* antes de responder ao que há, pergunta aos fornecedores o que têm —
         com a cache de 6 h, isto é uma chamada por fornecedor a cada 6 h */
      const descobriu = await descobrirSePreciso().catch(() => []);
      const cfg = await config();
      const r = resumoGratuitos({ chaves, desligados: cfg.desligados || [], latencias: await latencias(), cfg });
      return {
        ...r,
        estado: estadoCurto({ chaves, desligados: cfg.desligados || [], cfg }),
        medido: PROVADOS.map((p) => ({ fornec: p.fornec, modelo: p.modelo, ms: p.ms, ok: p.ok, erros: p.erros, medido: p.medido, fonte: p.fonte })),
        /* 1.43.0 · o catálogo utilizável AGORA (declarado + descoberto), para a
           mesa poder mostrar todos os modelos em vez de um contador */
        catalogo: catalogoDaCadeia(cfg).map((m) => ({
          fornec: m.fornecedor,
          fornecedor: FORNECEDORES[m.fornecedor]?.nome || m.fornecedor,
          modelo: m.modelo,
          etiquetas: m.etiquetas || ['texto'],
          janela: m.janela || 0,
          semChave: !chaves[m.fornecedor] || String(chaves[m.fornecedor]).startsWith('\u0000'),
          descoberto: !!m.descoberto,
          soComChave: !!m.soComChave,
        })),
        descobertoAgora: descobriu,
        descobertoEm: Object.fromEntries(Object.entries(cfg.descobertos || {}).map(([k, v]) => [k, v?.quando || null])),
        /* 1.44.3 · quem está de fora por falha recente do próprio fornecedor.
           Sem isto, «por provar» e «não vale a pena agora» pareciam a mesma coisa. */
        bloqueios: Object.entries(cfg.testes || {})
          .filter(([, t]) => t?.bloqueadoAte && Date.parse(t.bloqueadoAte) > Date.now())
          .map(([fornec, t]) => ({ fornec, ate: t.bloqueadoAte, motivo: t.bloqueadoPor || null })),
      };
    },

    /** Cadeia que este motor usaria agora — para a interface poder explicar. */
    async cadeiaPara(tipo, { agente = null } = {}) {
      const cfg = await config();
      return cadeia(tipo, {
        chaves, desligados: cfg.desligados || [], preferido: cfg.agentes?.[agente]?.modelo || null,
        latencias: await latencias(),
        provados: provadosActivos({ chaves, desligados: cfg.desligados || [], cfg }),
        catalogo: catalogoDaCadeia(cfg),
      });
    },

    /** Teste REAL: lista modelos e faz um pedido pequeno. Só isto marca «funcional». */
    async testar(fornecedor, { modelo: exigido = null } = {}) {
      const prov = FORNECEDORES[fornecedor];
      if (!prov) throw new ErroIA(`fornecedor desconhecido: ${fornecedor}`, { fornec: fornecedor });
      const chave = valorDaChave(fornecedor);
      /* sem chave por desenho (anónimo) não é erro: é o caso do Kilo/OVH. Só
         falta chave quando o fornecedor exige uma e ela não está no ambiente. */
      if (!chave && !prov.keyless) throw new ErroIA(`falta ${prov.chave.join(' ou ')} no ambiente`, { fornec: fornecedor, codigo: 'semchave' });
      const inicio = Date.now();
      const cfg = await config();
      const testes = { ...(cfg.testes || {}) };
      try {
        /* a lista do fornecedor é a verdade; se ele não a servir (405, formato
           diferente, keyless sem /models), usamos a primeira entrada do catálogo */
        let modelos = [];
        let avisoLista = null;
        try {
          modelos = await listarModelos({ fornec: fornecedor, prov, chave, fetchImpl });
        } catch (e) {
          avisoLista = e.message;
          modelos = modelosDe(fornecedor).map((m) => m.modelo);
        }
        /* Ordem: o preferido do catálogo, depois os primeiros da lista do
           fornecedor. Tentamos até três: um modelo de raciocínio pode gastar
           todo o orçamento de saída a «pensar» e devolver texto vazio — isso
           não é um teste bem-sucedido (visto no OVH a 27 out 2026). */
        const doCatalogo = modelosDe(fornecedor).map((m) => m.modelo);
        /* 1.33.0 · «Provar» aponta a um modelo concreto: esse vai à frente de
           todos os outros, senão o botão provava um qualquer e o dito continuava
           por provar. */
        const pedido = exigido ? String(exigido) : null;
        const ordem = [...new Set([
          ...(pedido ? [pedido] : []),
          ...doCatalogo.filter((m) => modelos.includes(m)),
          ...modelos,
        ])].slice(0, pedido ? 4 : 3);
        if (!ordem.length) throw new ErroIA(`${fornecedor} não devolveu modelos (${avisoLista || 'lista vazia'})`, { fornec: fornecedor, codigo: 'vazio' });
        let alvo = null;
        let r = null;
        let ultimoErro = null;
        for (const candidato of ordem) {
          try {
            r = await falar({
              fornec: fornecedor, prov, chave, modelo: candidato,
              mensagens: [{ role: 'user', content: 'Responde apenas: ok' }],
              maxTokens: 64, temperatura: 0, timeoutMs: 30000, fetchImpl,
            });
            if (String(r.texto || '').trim()) { alvo = candidato; break; }
            ultimoErro = new ErroIA(`${fornecedor}/${candidato} respondeu vazio (modelo de raciocínio com pouco espaço de saída?)`, { fornec: fornecedor, modelo: candidato, codigo: 'vazio' });
          } catch (e) { ultimoErro = e; }
        }
        if (!alvo) throw ultimoErro || new ErroIA(`${fornecedor} não respondeu`, { fornec: fornecedor, codigo: 'vazio' });
        const ms = Date.now() - inicio;
        const anteriores = testes[fornecedor] || {};
        testes[fornecedor] = {
          ok: true, ms, quando: agora(), modelos: modelos.length || null,
          usado: alvo, resposta: String(r.texto || '').slice(0, 60), avisoLista,
          /* 1.33.0 · a lista real fica guardada: os nomes dos modelos gratuitos
             mudam (o OpenCode mudou 4 de 4 em dois meses) e escrevê-los à mão
             no catálogo era garantir que ficavam velhos. */
          lista: modelos.slice(0, 60),
          /* …e a prova fica registada por modelo: é o que tira um «por provar»
             da lista dos que nunca responderam (gratuitos.provasDe). */
          provados: {
            ...(anteriores.provados || {}),
            [alvo]: { ok: true, ms, quando: new Date().toISOString() },
          },
        };
        await repo.ia.config.gravar('testes', testes);
        await repo.ia.uso.registar({ fornecedor, modelo: alvo, agente: 'teste', tipo: 'teste', ok: true, ms, tokens_in: r.uso?.entrada || 0, tokens_out: r.uso?.saida || 0, erro: null });
        return { ok: true, ms, modelos: modelos.length || null, modelo: alvo, resposta: String(r.texto || '').slice(0, 60), avisoLista };
      } catch (e) {
        const ms = Date.now() - inicio;
        testes[fornecedor] = {
          ...(testes[fornecedor] || {}),
          ok: false, ms, quando: agora(), erro: String(e.message || e).slice(0, 300),
        };
        try { await repo.ia.config.gravar('testes', testes); } catch { /* sem base */ }
        try { await repo.ia.uso.registar({ fornecedor, modelo: '(teste)', agente: 'teste', tipo: 'teste', ok: false, ms, tokens_in: 0, tokens_out: 0, erro: String(e.message || e).slice(0, 300) }); } catch { /* sem base */ }
        throw e;
      } finally {
        cacheConfig = null;
      }
    },

    orcamento,
  };
}
