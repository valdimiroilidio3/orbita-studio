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
import { FORNECEDORES, MODELOS, SEM_CHAVE, comChave, mascarar, modelosDe } from './catalogo.mjs';
import { ErroIA, falar, listarModelos } from './cliente.mjs';
import { cadeia, diagnostico, falarComFallback, orcamento } from './router.mjs';

export function chavesDoAmbiente(env = process.env) {
  const mapa = {};
  for (const { id, variavel } of comChave(env)) mapa[id] = variavel;   // id → NOME da variável
  return mapa;
}

export function criarMotor({ repo, env = process.env, fetchImpl = fetch, agora = () => new Date().toISOString() } = {}) {
  const chaves = chavesDoAmbiente(env);
  const valorDaChave = (id) => {
    const nome = chaves[id];
    if (!nome || nome === SEM_CHAVE) return '';        // keyless: não há chave para ler
    return String(env[nome] || '');
  };

  let cacheConfig = null;
  let cacheLat = null;

  async function config() {
    if (cacheConfig) return cacheConfig;
    try { cacheConfig = (await repo.ia.config.ler()) || {}; } catch { cacheConfig = {}; }
    return cacheConfig;
  }

  async function latencias() {
    if (cacheLat) return cacheLat;
    try { cacheLat = (await repo.ia.uso.latencias()) || {}; } catch { cacheLat = {}; }
    return cacheLat;
  }

  /** Chamada crua a um fornecedor/modelo concreto (usada pelo router e pelos testes). */
  async function chamar(entrada, mensagens, { ferramentas = [], maxTokens = 1200, temperatura = 0.3, timeoutMs = 45000 } = {}) {
    const prov = FORNECEDORES[entrada.fornec];
    if (!prov) throw new ErroIA(`fornecedor desconhecido: ${entrada.fornec}`, { fornec: entrada.fornec });
    const chave = valorDaChave(entrada.fornec);
    const r = await falar({ fornec: entrada.fornec, prov, chave, modelo: entrada.modelo, mensagens, ferramentas, maxTokens, temperatura, timeoutMs, fetchImpl });
    return { ...r, ferramentasPedidas: r.chamadas };
  }

  return {
    chaves,
    /* «pronto» = tem chave, ou não precisa dela (keyless). Nunca confundir
       «pronto» com «funcional»: isso é o teste real. */
    temChave: (id) => !!chaves[id] || (!!FORNECEDORES[id]?.keyless && FORNECEDORES[id]?.usavel !== false),
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
        const variavel = chaves[id] === SEM_CHAVE ? null : (chaves[id] || null);
        const t = testes[id] || null;
        const pronto = !!variavel || (!!p.keyless && p.usavel !== false);
        return {
          id, nome: p.nome, site: p.site, docs: p.docs, estilo: p.estilo,
          gratuito: !!p.gratuito, limites: p.limites, nota: p.nota || '',
          variavel,                                    // NOME da variável, não valor (null = sem chave por desenho)
          variaveis: p.chave,                          // o que aceita (para a interface dizer)
          semChave: !!p.keyless,
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
      orc = orcamento(), preferido = null, limite = 4, timeoutMs = 45000,
    } = {}) {
      const cfg = await config();
      const desligados = cfg.desligados || [];
      const pref = preferido || cfg.agentes?.[agente]?.modelo || null;
      /* quem já passou num teste REAL deste fornecedor vai à frente na cadeia */
      const cfgAgora = await config();
      const usados = {};
      for (const [fornec, t] of Object.entries(cfgAgora.testes || {})) {
        if (t?.ok && t?.usado) usados[`${fornec}/${t.usado}`] = true;
      }
      const resultado = await falarComFallback(tipo, {
        chaves, desligados, preferido: pref, latencias: await latencias(), orc, limite, usados,
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
      return resultado;
    },

    /** Cadeia que este motor usaria agora — para a interface poder explicar. */
    async cadeiaPara(tipo, { agente = null } = {}) {
      const cfg = await config();
      return cadeia(tipo, {
        chaves, desligados: cfg.desligados || [], preferido: cfg.agentes?.[agente]?.modelo || null,
        latencias: await latencias(),
      });
    },

    /** Teste REAL: lista modelos e faz um pedido pequeno. Só isto marca «funcional». */
    async testar(fornecedor) {
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
        const ordem = [...new Set([...doCatalogo.filter((m) => modelos.includes(m)), ...modelos])].slice(0, 3);
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
        testes[fornecedor] = { ok: true, ms, quando: agora(), modelos: modelos.length || null, usado: alvo, resposta: String(r.texto || '').slice(0, 60), avisoLista };
        await repo.ia.config.gravar('testes', testes);
        await repo.ia.uso.registar({ fornecedor, modelo: alvo, agente: 'teste', tipo: 'teste', ok: true, ms, tokens_in: r.uso?.entrada || 0, tokens_out: r.uso?.saida || 0, erro: null });
        return { ok: true, ms, modelos: modelos.length || null, modelo: alvo, resposta: String(r.texto || '').slice(0, 60), avisoLista };
      } catch (e) {
        const ms = Date.now() - inicio;
        testes[fornecedor] = { ok: false, ms, quando: agora(), erro: String(e.message || e).slice(0, 300) };
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
