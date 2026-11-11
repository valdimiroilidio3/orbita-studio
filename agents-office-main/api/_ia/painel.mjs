/* ===========================================================================
   1.83.0 · O PAINEL DA IA NUM SÓ PEDIDO (9 nov 2026)

   O que o dono viu, com o ecrã à frente:

     «A carregar o Control Center… / a pedir o estado ao servidor / Pedir outra vez»

   E disse: «isto deve já estar 100% funcional, sem dar essa lentidão e erro de
   não carregar».

   A causa não era uma rota lenta: eram **seis rotas**. A vista pedia, em fila,
   `/ia/estado`, `/ia/modelos`, `/ia/uso`, `/ia/runs`, `/media/trabalhos` e
   `/ia/gratuitos`. Na Vercel cada uma dessas é uma invocação de função — e numa
   função fria cada invocação arranca o processo outra vez. Seis arranques, seis
   vezes o mesmo catálogo importado, e o prazo de 12 s da vista a contar desde o
   primeiro. Quando uma delas não respondia, o cartão de carregamento ficava.

   Este ficheiro resolve isso na raiz, e não com um «à espera» mais curto:

     · **UM pedido** devolve tudo o que a página precisa para a primeira pintura
       (`/ia/painel`). Onde havia seis arranques há um;
     · as leituras correm **em paralelo** (`Promise.all`), por isso o tempo total
       é o da mais lenta e não a soma de todas;
     · cada parte tem o **seu prazo**. Uma parte que não responde não segura as
       outras: entra em `parcial` com a razão escrita, e a página sabe dizer
       exactamente o que ficou por ler;
     · a memória e o estúdio deixam de estar no caminho crítico. São peças de
       rodapé, e vêm com prazo curto (2 s) — antes somavam até 6 s em série;
     · nada é inventado: o que não chegou vem `null` e `parcial` diz porquê.

   `montarEstado` é a MESMA composição que o `/ia/estado` devolve (uma verdade,
   dois caminhos): o painel e a rota antiga não podem divergir em silêncio.
   =========================================================================== */
import { FORNECEDORES, MODELOS, modelosDe } from './catalogo.mjs';
import { LISTA } from './agentes.mjs';
import { FERRAMENTAS } from './ferramentas.mjs';
import { TIPOS } from './router.mjs';
import * as memoria from './memoria.mjs';
import * as media from './media.mjs';
import { estadoDoRun, resumoDoRun, podeCancelar, podeRepetir, podeAprovar } from '../../src/execucao.js';

/** O tecto de tokens por nível de esforço. Uma definição para o motor, a rota
 *  e a vista — antes só a rota o tinha e o painel repetia os números. */
export const ESFORCOS = { low: 400, medium: 1200, high: 2400, xhigh: 4000, max: 6000 };

/** Uma promessa com prazo: devolve o controlo quando o servidor não o dá. */
export function comPrazo(promessa, ms, oQue) {
  let t = null;
  const prazo = new Promise((_, rejeitar) => {
    t = setTimeout(() => {
      rejeitar(Object.assign(new Error(`${oQue} não respondeu em ${Math.round(ms / 1000)} s`), { prazo: true }));
    }, ms);
    /* sem `unref`: o prazo TEM de disparar mesmo que seja a única coisa viva
       (num teste sem rede, um `unref` deixava a promessa pendente e o processo
       a sair antes de o prazo contar — foi o que se viu na primeira versão) */
  });
  return Promise.race([promessa, prazo]).finally(() => { if (t) clearTimeout(t); });
}

/* Os prazos, por parte. O do estado é o maior porque é o único sem o qual a
   página não tem o que mostrar; os outros são peças que se juntam depois. */
export const PRAZOS = {
  estado: 9000,
  modelos: 5000,
  uso: 6000,
  runs: 6000,
  trabalhos: 6000,
  gratuitos: 6000,
  memoria: 2000,
  estudio: 2000,
};

/**
 * O resumo de uso — extraído para o `/ia/uso` e o painel não darem contas
 * diferentes. `linhas` vem de `repo.ia.uso.recentes`.
 */
export async function resumoDeUso(linhas = [], env = process.env) {
  const dinheiro = await import('../_dinheiro.mjs');
  const cambio = dinheiro.cambioDe(env);
  const conta = dinheiro.agregarUso(linhas, env);
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
  const resumo = [...porFornecedor.values()].map((a) => {
    const linhasFornec = conta.linhas.filter((l) => l.fornecedor === a.fornecedor);
    const micro = linhasFornec.reduce((n, l) => n + (l.microUsd || 0), 0);
    return {
      ...a, latenciaMediaMs: a.pedidos ? Math.round(a.msTotal / a.pedidos) : null, msTotal: undefined,
      custoMicroUsd: micro,
      custoCentimos: dinheiro.centimosDeMicro(micro, cambio.taxa),
      desconhecidas: linhasFornec.reduce((n, l) => n + (l.desconhecidas || 0), 0),
      modelos: linhasFornec.map((l) => ({
        modelo: l.modelo, chamadas: l.chamadas, tokensIn: l.tokensIn, tokensOut: l.tokensOut,
        preco: l.preco, fonte: l.fonte, microUsd: l.microUsd,
        centimos: dinheiro.centimosDeMicro(l.microUsd, cambio.taxa), desconhecidas: l.desconhecidas,
      })),
    };
  });
  return {
    resumo, ultimos: linhas.slice(0, 25),
    errosRecentes: linhas.filter((l) => !l.ok).slice(0, 10).map((l) => ({ fornecedor: l.fornecedor, modelo: l.modelo, quando: l.criado, erro: l.erro })),
    /* 1.55.0 · quanto custou o que aqui está, com a conta à vista */
    custos: {
      microUsd: conta.microUsd,
      centimos: dinheiro.centimosDeMicro(conta.microUsd, cambio.taxa),
      desconhecidas: conta.desconhecidas,
      chamadas: conta.chamadas,
      cambio,
      conta: conta.linhas.map((l) => ({ ...l, centimos: dinheiro.centimosDeMicro(l.microUsd, cambio.taxa) })),
      nota: 'preços do catálogo (USD por milhão de tokens) ou de ORBITA_PRECOS_IA; é uma conta, não uma fatura',
    },
  };
}

/** O catálogo para o selector — a mesma lista que o `/ia/modelos` devolve. */
export async function modelosDoCatalogo(motor, { fornecedor = null } = {}) {
  const cfg = await motor.config();
  const descobertos = cfg.descobertos || {};
  const fornecedores = Object.entries(FORNECEDORES)
    .filter(([id]) => !fornecedor || id === fornecedor)
    .map(([id, p]) => ({
      id, nome: p.nome, estilo: p.estilo, gratuito: !!p.gratuito, limites: p.limites,
      comChave: motor.temChave(id), desligado: (cfg.desligados || []).includes(id),
      catalogo: modelosDe(id).map((x) => ({ modelo: x.modelo, etiquetas: x.etiquetas, janela: x.janela, preco: x.preco, gratuito: !!x.gratuito })),
      descobertos: descobertos[id]?.modelos || [],
      descobertosEm: descobertos[id]?.quando || null,
    }));
  return {
    fornecedores,
    totalModelosCatalogo: MODELOS.length,
    /* a lista de nomes é o que o compositor lê (`composer.js`); os tectos vão
       ao lado, para quem precisa do número e não do nome */
    esforcos: Object.keys(ESFORCOS),
    esforcoTokens: ESFORCOS,
    esforcoNota: 'o esforço é o tecto de tokens da resposta: baixo 400 · médio 1200 · alto 2400 · muito alto 4000 · máximo 6000',
  };
}

/**
 * A composição do estado (o que o `/ia/estado` devolve). Está aqui para haver
 * UMA definição: o painel e a rota antiga chamam esta função.
 *
 * `resumos: false` corta a memória e o estúdio — é o caminho rápido, para quem
 * só quer saber se há motor.
 */
export async function montarEstado(motor, { repo, env = process.env, fetchImpl = fetch, resumos = true } = {}) {
  const estado = await motor.estado();
  const cfg = await motor.config();

  let resumoMemoria = null;
  let estudio = null;
  if (resumos) {
    [resumoMemoria, estudio] = await Promise.all([
      comPrazo(memoria.estado(repo, { env, fetchImpl }), PRAZOS.memoria, 'a memória')
        .then((e) => ({ total: e.total, usos: e.usos, modo: e.modo, etiquetas: e.etiquetas.slice(0, 8), recentes: e.recentes.slice(0, 5), mem0: e.mem0 }))
        .catch((e) => ({ erro: `a memória ainda não tem tabela: ${String(e.message).slice(0, 120)}` })),
      comPrazo(media.estado(repo, env), PRAZOS.estudio, 'o estúdio')
        .catch((e) => ({ configurado: false, porque: `o estúdio ainda não tem tabela: ${String(e.message).slice(0, 120)}` })),
    ]);
  }

  return {
    ...estado,
    memoria: resumoMemoria,
    estudio,
    agentes: LISTA.map((a) => {
      const esc = cfg.agentes?.[a.id]?.modelo || null;
      const par = esc && typeof esc === 'object' ? esc : (esc ? { modelo: String(esc) } : null);
      return {
        id: a.id, numero: a.numero, nome: a.nome, papel: a.papel,
        ferramentas: a.ferramentas, tipos: a.tipos, criterios: a.criterios,
        modelo: par?.modelo || null,
        fornecedor: par?.fornecedor || null,
        escolha: par ? { fornecedor: par.fornecedor || null, modelo: par.modelo || null } : null,
      };
    }),
    ferramentas: Object.entries(FERRAMENTAS).map(([id, f]) => ({ id, descricao: f.descricao, destrutiva: !!f.destrutivo })),
    tipos: TIPOS,
    desligados: cfg.desligados || [],
    pronto: estado.diagnostico.pronto,
    instalacao: estado.diagnostico.pronto
      ? 'ha pelo menos um fornecedor com chave e catalogo'
      : 'nenhum fornecedor com chave — as chaves vivem no ambiente da Vercel (nunca no browser)',
  };
}

/** As gratuitas + a cadeia por tipo de trabalho. A rota antiga pedia os sete
 *  tipos UM A UM (`for ... await`); aqui vão todos ao mesmo tempo, porque são
 *  leituras independentes e a soma era o que se sentia no ecrã. */
export const TIPOS_DE_TRABALHO = ['plano', 'codigo', 'texto', 'investigar', 'revisao', 'rapido', 'visao'];

export async function gratuitosComCadeia(motor) {
  const [r, ...cadeias] = await Promise.all([
    motor.gratuitos(),
    ...TIPOS_DE_TRABALHO.map((t) => motor.cadeiaPara(t).catch(() => [])),
  ]);
  const cadeia = {};
  TIPOS_DE_TRABALHO.forEach((t, i) => { cadeia[t] = cadeias[i]; });
  return { ...r, cadeia };
}

/** As execuções, como o `/ia/runs` as devolve. */
export async function runsDaIA(repo, { limite = 20 } = {}) {
  const runs = await repo.ia.runs.listar(Number(limite) || 20);
  return runs.map((r) => ({
    ...r,
    visivel: estadoDoRun(r),
    resumo: resumoDoRun(r, []),
    accoes: { cancelar: podeCancelar(r), repetir: podeRepetir(r, runs), aprovar: podeAprovar(r) },
  }));
}

/**
 * O painel completo. Cada parte com o seu prazo, todas em paralelo: o tempo é o
 * da mais lenta. O que não chegou entra em `parcial` com a razão — nunca se
 * inventa um valor para o lugar do que falhou.
 */
export async function montarPainel(repo, {
  env = process.env, fetchImpl = fetch, motor = null, agora = () => Date.now(), prazos = {},
} = {}) {
  const t0 = agora();
  /* os prazos podem ser afinados por quem chama (um teste mede com 300 ms o que
     em produção espera 9 s; uma operação lenta pode subi-los sem tocar no código) */
  const limites = { ...PRAZOS, ...prazos };
  let m = motor;
  const parcelas = [];
  const parte = async (nome, ms, fn, vazio = null) => {
    const ts = agora();
    try {
      const valor = await comPrazo(Promise.resolve().then(fn), ms, nome);
      return valor === undefined ? vazio : valor;
    } catch (e) {
      parcelas.push({ parte: nome, erro: String(e?.message || e).slice(0, 180), ms: agora() - ts });
      return vazio;
    }
  };

  /* o motor é criado uma vez (o catálogo já está importado) e partilhado — era
     isto que faltava: cada rota antiga criava o seu */
  m = m || (await import('./motor.mjs')).criarMotor({ repo, env, fetchImpl });

  const [estado, modelos, uso, runs, trabalhos, gratuitos] = await Promise.all([
    parte('estado', limites.estado, () => montarEstado(m, { repo, env, fetchImpl }), null),
    parte('modelos', limites.modelos, () => modelosDoCatalogo(m), null),
    parte('uso', limites.uso, async () => resumoDeUso(await repo.ia.uso.recentes(200), env), null),
    parte('runs', limites.runs, () => runsDaIA(repo), []),
    parte('trabalhos', limites.trabalhos, async () => (await media.listar(repo, 30))?.corpo?.trabalhos || [], []),
    /* a mais cara (pode descobrir modelos no fornecedor, com cache de 6 h): é a
       última a poder falhar, e falhar aqui não estraga nada */
    parte('gratuitos', limites.gratuitos, () => gratuitosComCadeia(m), null),
  ]);

  return {
    ok: true,
    estado, modelos, uso, runs, trabalhos, gratuitos,
    parcial: parcelas,
    completo: parcelas.length === 0,
    ms: agora() - t0,
    lidoEm: new Date().toISOString(),
    nota: parcelas.length
      ? `faltou ler: ${parcelas.map((p) => p.parte).join(', ')} — o resto está completo`
      : 'tudo o que a página pede veio nesta resposta',
  };
}
