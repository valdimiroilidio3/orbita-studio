/* ===========================================================================
   1.16.0 · A MESA SEM SERVIDOR (30 out 2026)

   Pedido do dono: «todas estas páginas já deram aceitar e estar muito bem
   funcionais, chega de demonstrações só».

   O que estava mal: publicada na Vercel, a mesa não tem `/api` atrás (a Vercel
   só serve ficheiros estáticos) e mostrava um cartão a dizer «precisa do Órbita
   a correr na tua máquina». Para quem abre o site, isso é uma demonstração.

   O que este módulo faz: implementa **os mesmos endpoints** que a mesa já
   chamava (`/auth/*`, `/ops/*`), mas contra um armazém no próprio browser
   (`localStorage`). A mesa não sabe a diferença — continua a chamar `call()`,
   continua a ler as mesmas formas — mas o que ela escreve FICA.

   Regras deste armazém, iguais às do servidor:
   · nada de dados de demonstração: começa vazio e só tem o que for escrito;
   · o que não sabe fazer, diz que não sabe (uma tarefa sem motor termina
     «falhou — sem motor», não «concluída»);
   · o que ainda não existe (pesquisa Google, agentes a correr, contas com
     palavra-passe) responde com o vazio honesto, nunca inventado.

   Limite declarado: um browser não é uma base de dados. Os dados vivem neste
   aparelho e neste browser; limpar os dados do site apaga-os. Por isso há
   exportar/importar (`guardar cópia`), e a porta aberta para a base a sério:
   quando existir `/api` (Vercel + base de dados), a mesa usa-a e este módulo
   fica só como recurso.
   =========================================================================== */

export const CHAVE = 'orbita.mesa.v1';

/* Os motores gratuitos que não precisam de chave do dono — espelho do catálogo do
   servidor (`api/_ia/catalogo-extra.json`). Vivem aqui porque o browser não pode
   importar o backend; o teste `localapi.test.mjs` compara os ids com o catálogo
   para que os dois não divirjam em silêncio. */
/* 1.45.0 · esta lista é uma CÓPIA, não a verdade. No servidor há dezenas de
   modelos provados (`/ia/gratuitos`); aqui, sem ligação ao servidor, não há como saber
   quais responderam hoje. Fica com os que responderam de forma estável, e a
   interface diz que é uma cópia local — antes mostrava 4 como se fossem todos. */
export const GRATUITOS_LOCAIS = [
  { fornec: 'llm7', nome: 'LLM7', modelo: 'codestral-latest', limites: 'anónimo · resposta em ~1,5 s', etiquetas: ['codigo', 'texto', 'rapido'] },
  { fornec: 'ovh', nome: 'OVH AI Endpoints', modelo: 'Qwen3.5-397B-A17B', limites: 'anónimo · 13–45 s', etiquetas: ['raciocinio', 'texto'] },
  { fornec: 'opencode', nome: 'OpenCode Zen', modelo: 'big-pickle', limites: 'chave publicada pelo serviço (public)', etiquetas: ['codigo', 'ferramentas'] },
  { fornec: 'pollinations', nome: 'Pollinations', modelo: 'openai', limites: 'anónimo · 1 pedido a cada 15 s', etiquetas: ['texto', 'rapido', 'ferramentas'] },
  { fornec: 'pollinations', nome: 'Pollinations', modelo: 'openai-large', limites: 'anónimo · raciocínio', etiquetas: ['texto', 'raciocinio'] },
  { fornec: 'ovh', nome: 'OVH AI Endpoints', modelo: 'Qwen3.8-27B', limites: 'anónimo · <1 s quando responde', etiquetas: ['texto', 'codigo', 'raciocinio'] },
  { fornec: 'ovh', nome: 'OVH AI Endpoints', modelo: 'Mistral-Nemo-Instruct-2407', limites: 'anónimo · <1 s', etiquetas: ['texto', 'rapido'] },
];

const TIPOS_PROJETO = [
  { id: 'landing', label: 'Página de conversão' },
  { id: 'site', label: 'Site de empresa' },
  { id: 'loja', label: 'Loja online' },
  { id: 'app', label: 'Aplicação web' },
];

const TIPOS_TAREFA = {
  investigar: { label: 'Investigar o lead' },
  mensagem: { label: 'Escrever uma mensagem' },
  briefing: { label: 'Escrever o briefing' },
  codigo: { label: 'Gerar o código' },
  qa: { label: 'Auditoria de qualidade' },
};

/* 1.57.2 · a mesma tabela do servidor e de `src/painel.js` (um teste confirma
   que as três não divergem) */
const DEPARTAMENTOS_POR_TIPO = {
  investigar: 'prospeccao', mensagem: 'vendas', briefing: 'comando', codigo: 'engenharia', qa: 'engenharia',
};

const DEPARTAMENTOS = [
  { id: 'comando', nome: 'Comando' },
  { id: 'prospeccao', nome: 'Prospecção' },
  { id: 'vendas', nome: 'Vendas' },
  { id: 'media', nome: 'Media' },
  { id: 'design', nome: 'Design' },
  { id: 'engenharia', nome: 'Engenharia' },
];

const vazio = () => ({
  v: 1,
  criado: new Date().toISOString(),
  leads: [],
  leadEventos: [],
  projetos: [],
  tarefas: [],
  receitas: [],
  faturas: [],
  mensagens: [],
  atividade: [],
});

const semAcentos = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const limpo = (s) => String(s || '').trim();
const novoId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* o erro que a mesa já sabe mostrar: `status` e `message` */
function falha(status, message, extra = {}) {
  return Object.assign(new Error(message), { status, body: { error: message, ...extra } });
}

/* 1.59.0 · o CRM no modo local. As contas são as MESMAS do servidor e da mesa
   (`src/crm.js`): sem isso, o CSV exportado aqui e o exportado na Vercel podiam
   dizer coisas diferentes sobre o mesmo lead. */
import { csvDeLeads, duplicados as duplicadosDeLeads, resumoDoFunil, confianca as confiancaDoLead,
  verificacao as verificacaoDoLead, proximaAccao, qualificacao as qualificacaoDoLead, nomeDoFicheiro } from './crm.js';
import { NIVEIS_AUTONOMIA } from './motores.js';
/* 1.84.0 · o elenco é dado puro (`src/elenco.js`): o mesmo no servidor e aqui,
   para o Control Center não dizer 47 lugares num modo e nada no outro. */
import { elencoBase, agentesDaSala, SALA_DO_DEPARTAMENTO_PT } from './elenco.js';

export function createLocalApi({ storage, agora = () => Date.now() } = {}) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  if (!store) throw new Error('modo local sem armazém: este ambiente não tem localStorage');

  function ler() {
    try {
      const cru = store.getItem(CHAVE);
      if (!cru) return vazio();
      const d = JSON.parse(cru);
      return { ...vazio(), ...d };
    } catch { return vazio(); }
  }
  function gravar(d) { store.setItem(CHAVE, JSON.stringify(d)); return d; }
  function escrever(d, tipo, texto) {
    d.atividade.unshift({ id: novoId('a'), tipo, texto, at: new Date(agora()).toISOString() });
    d.atividade = d.atividade.slice(0, 200);
  }

  /* ---------- leituras derivadas (as mesmas contas do servidor) ---------- */
  const cents = (eur) => Math.round((Number(eur) || 0) * 100);
  const dinheiro = (c) => (Number(c) || 0) / 100;

  /* 1.56.0 · as faturas no modo local. O documento existe (número, linhas, IVA,
     totais) e o número não salta — mas o PDF é gerado no servidor, e aqui não há
     servidor: é isso que se diz, em vez de um botão que não faz nada. Esta conta
     é a mesma de `api/_faturas.mjs` (`calcularTotais`), e o teste compara as duas. */
  function faturasResumo(d) {
    const lista = d.faturas || [];
    const emitidas = lista.filter((f) => f.tipo !== 'nota_credito' && f.estado !== 'anulada');
    const notas = lista.filter((f) => f.tipo === 'nota_credito');
    const soma = (xs, k) => xs.reduce((n, x) => n + (Number(x[k]) || 0), 0);
    const porMes = Object.entries((emitidas.concat(notas)).reduce((m, f) => {
      const k = String(f.emitida_em || '').slice(0, 7) || 'sem data';
      m[k] = (m[k] || 0) + (Number(f.total_centimos) || 0);
      return m;
    }, {})).map(([mes, totalCentimos]) => ({ mes, totalCentimos }));
    return {
      documentos: lista.length,
      emitidas: emitidas.length,
      anuladas: lista.filter((f) => f.tipo !== 'nota_credito' && f.estado === 'anulada').length,
      notasCredito: notas.length,
      baseCentimos: soma(emitidas, 'base_centimos') + soma(notas, 'base_centimos'),
      ivaCentimos: soma(emitidas, 'iva_centimos') + soma(notas, 'iva_centimos'),
      totalCentimos: soma(emitidas, 'total_centimos') + soma(notas, 'total_centimos'),
      porMes: porMes.sort((a, b) => b.mes.localeCompare(a.mes)),
      porCliente: [],
      semDados: lista.length ? null : 'Ainda não há faturas emitidas. Uma fatura nasce de linhas escritas por ti — nada é inferido das entradas do saldo.',
    };
  }

  const SEM_PDF_LOCAL = 'No modo local a fatura fica registada neste browser, mas o PDF é gerado no servidor — e este modo não tem servidor. Liga a base de dados (SUPABASE_URL + chave) para o documento sair em PDF.';

  function saldo(d) {
    const janela = 90, desde = agora() - janela * 86400000;
    const dentro = d.receitas.filter((r) => new Date(r.at).getTime() >= desde);
    const receitaCentimos = dentro.reduce((n, r) => n + (r.amount_cents || 0), 0);
    const porCampanha = Object.entries(dentro.reduce((m, r) => {
      const k = r.campaign || 'sem campanha';
      m[k] = (m[k] || 0) + (r.amount_cents || 0);
      return m;
    }, {})).map(([campanha, c]) => ({ campanha, cents: c })).sort((a, b) => b.cents - a.cents);
    return {
      janela: { dias: janela },
      receitaCentimos, custoCentimos: 0, margemCentimos: receitaCentimos,
      porCampanha, custosPorFornecedor: [], unitarios: {},
      /* 1.55.0 · no modo local não há chamadas de IA (o motor vive no servidor),
         logo o custo é 0 porque não houve consumo — e diz-se assim, em vez de
         deixar o ecrã a sugerir que se mediu alguma coisa */
      contaAVista: {
        linhas: [], microUsd: 0, centimos: 0, desconhecidas: 0, chamadas: 0,
        cambio: null,
        nota: 'no modo local não há chamadas de IA: as chaves e o motor vivem no servidor. Este custo é 0 por ausência de consumo, não por medição',
      },
      custosPorProjeto: [], custosPorLead: [],
      faturacao: { ...faturasResumo(d), avisoEmitente: null },
      tarefas: { total: (d.tarefas || []).length, custoCentimos: 0, semCusto: (d.tarefas || []).length },
      entradas: dentro.slice(0, 40),
      semDados: {
        custo: 'Sem custos de API: no modo local nenhuma chamada de IA sai daqui.',
        receita: dentro.length ? null : 'Ainda não há entradas registadas. Uma fatura emitida fora do Órbita só entra se a escreveres aqui.',
        cambio: null,
      },
    };
  }

  function pipeline(d) {
    const fases = [
      { id: 'novo', label: 'Novos', teste: (l) => !l.status || l.status === 'novo' },
      { id: 'contactado', label: 'Contactados', teste: (l) => l.status === 'contactado' },
      { id: 'respondeu', label: 'Responderam', teste: (l) => l.status === 'respondeu' },
      { id: 'ganho', label: 'Ganhos', teste: (l) => l.status === 'ganho' },
    ];
    const total = d.leads.length;
    const contagem = fases.map((f) => ({ id: f.id, label: f.label, leads: d.leads.filter(f.teste).length }));
    const ganhos = d.leads.filter((l) => l.status === 'ganho').length;
    return {
      totalLeads: total,
      conversaoTotal: total ? Math.round((ganhos / total) * 100) : null,
      fases: contagem.map((f) => ({ ...f, conversao: total ? Math.round((f.leads / total) * 100) : null })),
      porOrigem: Object.entries(d.leads.reduce((m, l) => {
        const k = l.source || 'manual';
        m[k] = m[k] || { total: 0, ganhos: 0 };
        m[k].total++; if (l.status === 'ganho') m[k].ganhos++;
        return m;
      }, {})).map(([origem, o]) => ({ origem, total: o.total, ganhos: o.ganhos, taxa: o.total ? Math.round((o.ganhos / o.total) * 100) : null })),
      paradas: { dias: 14, lista: [] },
      perdidos: d.leads.filter((l) => l.status === 'perdido').length,
    };
  }

  function resumoProjetos(d) {
    const por = (s) => d.projetos.filter((p) => p.status === s).length;
    return { total: d.projetos.length, emQa: por('em_qa'), aprovados: por('aprovado'), entregues: por('entregue') };
  }

  /* ---------- endpoints ---------- */

  /* 1.53.2 · a ponte do modo local para o servidor da Órbita. Devolve sempre
     `{ ok }` — nunca rebenta a interface por o servidor não estar lá. */
  async function correrNoServidor(corpo) {
    try {
      const r = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ caminho: '/ops/tarefas', metodo: 'POST', corpo }),
      });
      if (!r.ok) return { ok: false, erro: `o servidor respondeu ${r.status}` };
      const dados = await r.json();
      if (!dados?.tarefa) return { ok: false, erro: dados?.error || 'o servidor não devolveu tarefa' };
      return { ok: true, tarefa: dados.tarefa, execucao: dados.execucao || null };
    } catch (e) {
      return { ok: false, erro: e?.message || 'sem resposta' };
    }
  }

  async function rota(caminho, metodo, corpo) {
    const d = ler();
    const [, ...resto] = caminho.replace(/^\/+/, '').split('/');
    const seg = resto.map((x) => decodeURIComponent(x)); // os pedaços já descodificados
    const parte = seg.join('/');
    const qs = new URLSearchParams(caminho.split('?')[1] || '');
    const caminhoLimpo = '/' + caminho.replace(/^\/+/, '').split('?')[0];

    /* --- quem és tu: no modo local és o dono deste browser, e não há senha --- */
    /* 1.37.0 · a pesquisa real (Geoapify/Tavily) não corre no browser: as chaves
       vivem no servidor. Dizer isto é melhor do que devolver zero empresas e
       deixar a pessoa a achar que o nicho não existe. */
    if (caminhoLimpo === '/pesquisa/leads' || caminhoLimpo === '/pesquisa/web') {
      throw falha(503, 'a pesquisa precisa do servidor: a chave do fornecedor (Geoapify/Tavily) vive lá, nunca neste browser');
    }
    if (caminhoLimpo === '/auth/eu') {
      return { user: { id: 'local', name: 'Dono deste browser', email: '', role: 'owner', roleLabel: 'modo local' },
        modo: 'local', local: true, perms: { ver: true, escrever: true, aprovar: true, admin: true, write: true, approve: true } };
    }
    if (caminhoLimpo === '/auth/entrar' || caminhoLimpo === '/auth/primeiro-dono') return { ok: true, modo: 'local' };
    if (caminhoLimpo === '/auth/sair') return { ok: true };

    /* --- 1.18.0 · a IA no modo local: não há motor, e isso é dito com clareza ---
       As chaves vivem no servidor; neste browser não há como falar com fornecedores
       sem as expor. Por isso a vista mostra o Control Center vazio e a razão, em vez
       de fingir um motor ou rebentar com 404. */
    /* 1.83.0 · o painel também aqui: a vista pede UM caminho, e no modo local
       ele é composto das mesmas respostas que as seis rotas davam. O servidor
       faz isto em `api/_ia/painel.mjs`; aqui são leituras instantâneas do
       armazém do browser, e o resultado tem a mesma forma. */
    if (caminhoLimpo === '/ia/painel') {
      const t0 = agora();
      const [estado, modelos, uso, runs, trabalhos, gratuitos] = await Promise.all([
        rota('/ia/estado', 'GET'),
        rota('/ia/modelos', 'GET'),
        rota('/ia/uso', 'GET'),
        rota('/ia/runs', 'GET'),
        rota('/media/trabalhos', 'GET'),
        rota('/ia/gratuitos', 'GET'),
      ]);
      return {
        ok: true, modo: 'local',
        estado, modelos, uso, runs,
        trabalhos: trabalhos.trabalhos || [],
        gratuitos,
        parcial: [], completo: true,
        ms: agora() - t0,
        lidoEm: new Date(agora()).toISOString(),
        nota: 'modo local: tudo o que o browser sabe, num pedido. As chaves e as provas vivem no servidor.',
      };
    }

    if (caminhoLimpo === '/ia/estado') {
      /* 1.34.0 · os motores que não precisam de chave nenhuma aparecem aqui, com o
         nome e o modelo reais, em vez de uma lista vazia. Não é demo: é uma cópia
         pequena do que o servidor usa (a lista verdadeira, com as provas, vive na
         base). O que não podem é ser provados sem ligação ao servidor, e o estado diz isso. */
      const gratuitos = GRATUITOS_LOCAIS.map((g) => ({
        id: g.fornec, nome: g.nome, familia: 'nucleo',
        configurado: true, semChave: true, variavel: 'não precisa', chaveMascarada: '',
        estado: 'por_testar', limites: g.limites, desligado: false, ultimoTeste: null,
      }));
      /* 1.84.0 · o elenco não depende do servidor: são 47 identidades escritas
         em `src/data.js`. O que depende do servidor são os 8 motores, e isso
         diz-se na nota — em vez de deixar o cartão vazio no modo local. */
      const el = elencoBase();
      return {
        elenco: { ...el, motores: [], motoresNota: 'os motores do Orchestrator vivem no servidor (as chaves nunca chegam a este browser); os lugares do escritório são os mesmos nos dois modos' },
        pronto: false, modo: 'local',
        motivo: 'a IA corre no servidor: as chaves dos fornecedores vivem no ambiente da Vercel e nunca neste browser',
        fornecedores: gratuitos, agentes: [], ferramentas: [], indisponiveis: [
          { id: 'provar', porque: 'provar um modelo faz um pedido real com o servidor à frente; neste browser não há chaves nem rede para os fornecedores' },
        ],
        memoria: { total: 0, usos: 0, etiquetas: [], recentes: [] },
        estudio: { configurado: false, porque: 'o estúdio (OpenMontage) precisa do servidor e de um worker' },
        diagnostico: { fornecedoresActivos: [], pronto: false },
        versaoCatalogo: { fornecedores: 0, modelos: 0 },
        instalacao: 'modo local — sem motor de IA',
      };
    }
    if (caminhoLimpo === '/ia/uso') return { resumo: [], ultimos: [], errosRecentes: [], modo: 'local' };
    /* As gratuitas, listadas com o estado honesto: existem, estão prontas, e
       nenhuma tem prova registada *neste browser* — porque provar exige o
       servidor. `pronto: false` é a verdade, não um erro. */
    if (caminhoLimpo === '/ia/gratuitos') {
      return {
        ok: true, modo: 'local', pronto: false, total: 0, semChaveNecessaria: 0,
        modelos: [],
        porProvar: GRATUITOS_LOCAIS.map((g) => ({
          fornec: g.fornec, fornecedor: g.nome, modelo: g.modelo,
          etiquetas: g.etiquetas, semChave: true, descoberto: false,
          nota: 'não precisa de chave; a prova faz-se no servidor',
        })),
        totalPorProvar: GRATUITOS_LOCAIS.length,
        nota: 'modo local: isto é uma cópia pequena dos motores gratuitos. A lista verdadeira — dezenas de modelos com resposta registada e latência — lê-se no servidor (/ia/gratuitos); sem essa ligação não há provas.',
        estado: { pronto: false, frase: 'nenhuma gratuita provada neste browser — a prova faz-se no servidor' },
        medidoEm: null, cadeia: {},
      };
    }
    /* 1.50.0 · o catálogo para o selector da conversa, também aqui: são os
       modelos sem chave que este browser conhece, agrupados como o servidor os
       agrupa. Diz-se que é cópia local — não se inventa uma lista maior. */
    if (caminhoLimpo === '/ia/modelos') {
      const porFornec = new Map();
      for (const g of GRATUITOS_LOCAIS) {
        if (!porFornec.has(g.fornec)) porFornec.set(g.fornec, { id: g.fornec, nome: g.nome, comChave: false, desligado: false, gratuito: true, catalogo: [], descobertos: [], modo: 'local' });
        porFornec.get(g.fornec).catalogo.push({ modelo: g.modelo, etiquetas: g.etiquetas, gratuito: true, limites: g.limites });
      }
      return { fornecedores: [...porFornec.values()], totalModelosCatalogo: GRATUITOS_LOCAIS.length, modo: 'local',
        nota: 'cópia local: a lista completa, com os modelos que já responderam, lê-se com o servidor a correr' };
    }
    /* 1.61.0 · as execuções vivem no servidor: é lá que correm os agentes e é
       lá que ficam os passos, as autorizações e o pedido de paragem. Aqui a
       lista é vazia e DIZ-SE porquê — em vez de um ecrã que parece avariado. */
    if (caminhoLimpo === '/ia/runs') {
      return {
        runs: [], modo: 'local',
        nota: 'no modo local não corre nenhum agente: o motor e as chaves vivem no servidor. Uma execução só existe (e só fica registada) quando a mesa fala com o /api.',
      };
    }
    if (caminhoLimpo.startsWith('/ia/runs/')) {
      throw falha(503, 'esta execução vive no servidor: no modo local não há motor, nem passos, nem autorizações para mostrar');
    }
    if (caminhoLimpo.startsWith('/ia')) throw falha(404, 'a IA precisa do servidor (modo local não tem motor)');

    /* --- 1.47.0 · digitalizar papel: neste browser não há olhos ---
       O ecrã existe em qualquer sítio (a mesa publicada é estática), mas ler a
       imagem precisa do motor de visão, que vive no servidor. Em vez de um 404
       seco, o estado diz porque não dá — e a vista escreve isso por palavras. */
    if (caminhoLimpo === '/digitalizar/estado') {
      return {
        ok: true, modo: 'local',
        ocr: {
          disponivel: false, via: null, env: 'ORBITA_OCR_URL', motivo: null,
          oQue: 'no servidor, o motor de visão transcreve a fotografia; aqui não há motor',
          limites: { bytesPorDocumento: 6 * 1024 * 1024, formatos: ['image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/pdf'] },
        },
        visao: { disponivel: false, motivo: 'a leitura faz-se no servidor — este browser não tem chaves nem motor', cadeia: [] },
        regras: { oQue: 'extrai NIF, telefone, email, código postal, IBAN, valores e datas — mas só de texto que já exista', precisaDe: 'um leitor' },
        privacidade: 'nada é enviado para fora a partir deste browser',
      };
    }
    if (caminhoLimpo === '/digitalizar') throw falha(503, 'ler papel precisa do servidor: aqui não há motor de visão');
    if (caminhoLimpo === '/digitalizar/lead') throw falha(503, 'sem leitura não há campos para propor um lead');

    /* --- 1.48.0 · Cine: o ecrã existe aqui, o estúdio não ----------------
       O estúdio precisa de dois lados que não vivem no browser: o motor de IA
       (para escrever o plano) e a chave do fornecedor de imagem (para gerar).
       Em vez de um 404 seco, o estado diz isso — e a lista de projectos vem
       vazia com a razão escrita, para a vista não parecer avariada. */
    if (caminhoLimpo === '/cine/projetos') return { ok: true, modo: 'local', projetos: [] };
    if (caminhoLimpo === '/cine/estado') {
      return {
        ok: true, modo: 'local',
        imagem: {
          via: null, comChave: false, provado: null, modelos: [], limiteBytes: 8 * 1024 * 1024,
          motivoSemChave: 'no modo local não há chave nenhuma: gerar imagens faz-se no servidor',
        },
        video: { disponivel: false, modelos: [], motivo: 'o vídeo vive no servidor (fila de media + worker)', worker: { vivo: false } },
        formatos: [], estilos: [],
        arquivo: { projetos: 0, imagens: 0, aprovadas: 0, comMaster: 0 },
        aviso: 'no modo local não há estúdio: o Master Prompt precisa do motor de IA e a geração precisa do fornecedor de imagem, e nenhum dos dois está neste browser',
      };
    }
    if (caminhoLimpo.startsWith('/cine')) throw falha(503, 'o Cine precisa do servidor: o plano é escrito pelo motor de IA e as imagens vêm do fornecedor, nenhum deles vive neste browser');

    /* --- 1.19.0 · memória e estúdio no modo local: dizem que precisam do servidor --- */
    if (caminhoLimpo === '/media/trabalhos') return { trabalhos: [], modo: 'local' };
    if (caminhoLimpo === '/media/estado') {
      return { configurado: false, modo: 'local', pipelines: [], tipos: ['video', 'imagem', 'audio', 'animacao', '3d'],
        porque: 'o estúdio vive no servidor: a fila fica na base e o worker corre numa máquina com OpenMontage' };
    }
    if (caminhoLimpo.startsWith('/media')) throw falha(404, 'o estúdio precisa do servidor (modo local não tem fila)');

    /* --- Hoje --- */
    if (caminhoLimpo === '/ops/summary') {
      return {
        leads: { total: d.leads.length, comContacto: d.leads.filter((l) => l.phone || l.email).length },
        projetos: { total: d.projetos.length },
        tarefas: { total: d.tarefas.length },
        custos: { apiCentimos: 0 },
        modo: 'local',
      };
    }
    if (caminhoLimpo === '/ops/today') {
      const decidir = d.mensagens.filter((m) => m.status === 'rascunho')
        .map((m) => ({ id: m.id, kind: 'mensagem', channel: m.channel, lead: d.leads.find((l) => l.id === m.lead_id) || null, body: m.body }));
      return { decidir, presenca: { parado: false }, modo: 'local' };
    }

    /* --- leads --- */
    /* 1.34.0 · a pesquisa real (Geoapify/Tavily) não corre no browser: as chaves
       vivem no servidor. Dizer isto é melhor do que devolver zero empresas e
       deixar a pessoa a achar que o nicho não existe. */
    if (caminhoLimpo === '/pesquisa/leads' || caminhoLimpo === '/pesquisa/web') {
      throw falha(503, 'a pesquisa precisa do servidor: a chave do fornecedor vive lá, nunca neste browser');
    }

    if (caminhoLimpo === '/ops/leads' && metodo === 'GET') {
      const lim = Math.min(500, Number(qs.get('limit')) || 200);
      return { leads: [...d.leads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, lim) };
    }
    if (caminhoLimpo === '/ops/leads' && metodo === 'POST') {
      const lista = Array.isArray(corpo?.leads) ? corpo.leads : [corpo].filter(Boolean);
      let created = 0, updated = 0;
      for (const entrada of lista) {
        const nome = limpo(entrada?.name);
        if (!nome) continue;
        const chave = `${semAcentos(nome)}|${semAcentos(entrada.city)}`;
        const existente = d.leads.find((l) => `${semAcentos(l.name)}|${semAcentos(l.city)}` === chave);
        if (existente) {
          for (const k of ['phone', 'email', 'website', 'category', 'city', 'score']) if (entrada[k] != null && entrada[k] !== '') existente[k] = entrada[k];
          existente.updated_at = new Date(agora()).toISOString();
          updated++;
        } else {
          d.leads.push({
            id: novoId('l'), name: nome, category: limpo(entrada.category), city: limpo(entrada.city),
            phone: limpo(entrada.phone), email: limpo(entrada.email), website: limpo(entrada.website),
            source: limpo(entrada.source) || 'manual', status: 'novo', score: Number(entrada.score) || null,
            notes: limpo(entrada.notes), created_at: new Date(agora()).toISOString(), updated_at: new Date(agora()).toISOString(),
          });
          created++;
        }
      }
      if (!created && !updated) throw falha(400, 'o lead precisa de um nome');
      escrever(d, 'lead', `${created} lead(s) novo(s), ${updated} atualizado(s)`);
      gravar(d);
      return { created, updated, leads: d.leads };
    }
    /* ---- 1.59.0 · o CRM no modo local ----
       Exportar, ver duplicados e resumir o funil: as mesmas contas de
       `src/crm.js` que o servidor usa. O que este modo NÃO faz é verificar o
       site — o browser não pode pedir outro domínio (CORS) — e di-lo em vez de
       inventar uma data de verificação. */
    if (caminhoLimpo === '/ops/leads.csv' && metodo === 'GET') {
      const agoraMs = agora();
      escrever(d, 'lead', `exportação de ${d.leads.length} lead(s) em CSV`);
      gravar(d);
      return { ok: true, csv: csvDeLeads(d.leads, { agora: agoraMs }), linhas: d.leads.length, ficheiro: nomeDoFicheiro(agoraMs) };
    }
    if (caminhoLimpo === '/ops/leads/duplicados' && metodo === 'GET') {
      const grupos = duplicadosDeLeads(d.leads);
      return { ok: true, grupos, total: grupos.length, leads: d.leads.length };
    }
    if (caminhoLimpo === '/ops/leads/resumo' && metodo === 'GET') {
      return { ok: true, ...resumoDoFunil(d.leads) };
    }
    if (/^\/ops\/leads\/[^/]+\/verificar$/.test(caminhoLimpo) && metodo === 'POST') {
      const lead = d.leads.find((l) => l.id === seg[1]);
      if (!lead) throw falha(404, 'lead não encontrado');
      if (!limpo(lead.website)) throw falha(400, `${lead.name} não tem site guardado — acrescenta o endereço antes de verificar`);
      throw falha(503, 'verificar o site precisa do servidor: o browser não pode pedir outro domínio (CORS) e esta verificação tem de vir de quem a pode fazer. Liga a base de dados para a data da verificação ser real.');
    }

    /* 1.36.0 · editar um lead a partir da mesa. É o mesmo contrato da API
       (PATCH /ops/leads/:id), por isso o formulário não precisa de saber se está
       a falar com a base ou com este browser. Só os campos que vêm são tocados;
       o `updated_at` muda sempre, para se ver que foi editado. */
    if (/^\/ops\/leads\/[^/]+$/.test(caminhoLimpo) && metodo === 'PATCH') {
      const lead = d.leads.find((l) => l.id === seg[1]);
      if (!lead) throw falha(404, 'lead não encontrado');
      const aceites = ['status', 'notes', 'phone', 'email', 'website', 'category', 'city', 'score',
        'qualificacao', 'proxima_acao', 'proxima_acao_em', 'fonte_url'];
      const antes = { status: lead.status, proxima_acao: lead.proxima_acao, qualificacao: lead.qualificacao };
      let tocados = 0;
      for (const k of aceites) {
        if (corpo?.[k] === undefined) continue;
        if (k === 'score' || k === 'qualificacao') {
          lead[k] = corpo[k] === '' || corpo[k] == null ? null : Math.max(0, Math.min(100, Math.round(Number(corpo[k]))));
        } else if (k === 'proxima_acao_em') {
          const cru = limpo(corpo[k]);
          if (cru && !/^\d{4}-\d{2}-\d{2}/.test(cru)) throw falha(400, 'a data da próxima ação tem de ser uma data (AAAA-MM-DD)');
          lead[k] = cru ? cru.slice(0, 10) : null;
        } else if (k === 'proxima_acao' || k === 'fonte_url') lead[k] = limpo(corpo[k]) || null;
        else lead[k] = limpo(corpo[k]);
        tocados++;
      }
      if (!tocados) throw falha(400, 'nada para alterar');
      /* mexer no contacto invalida a verificação do site: o que se verificou
         foi outro endereço, e dizer «verificado» sobre um site novo seria falso */
      if (corpo?.website !== undefined) { lead.website_estado = null; lead.website_verificado_em = null; lead.website_motivo = null; }
      lead.confianca = confiancaDoLead(lead).nivel;
      lead.updated_at = new Date(agora()).toISOString();
      let tipo = 'edicao', texto = 'ficha editada';
      if (lead.status !== antes.status) { tipo = 'estado'; texto = `estado: ${antes.status || '—'} → ${lead.status}`; }
      else if (corpo?.proxima_acao !== undefined || corpo?.proxima_acao_em !== undefined) {
        tipo = 'proxima_acao'; texto = `próxima ação: ${lead.proxima_acao || '(sem texto)'}${lead.proxima_acao_em ? ` · ${lead.proxima_acao_em}` : ''}`;
      } else if (corpo?.qualificacao !== undefined) { tipo = 'qualificacao'; texto = `qualificação: ${lead.qualificacao ?? 'sem valor'}`; }
      d.leadEventos = d.leadEventos || [];
      d.leadEventos.unshift({ id: novoId('le'), lead_id: lead.id, tipo, texto, autor: 'dono (modo local)', criado: new Date(agora()).toISOString() });
      escrever(d, 'lead', `lead «${lead.name}» editado`);
      gravar(d);
      return { ok: true, lead, confianca: confiancaDoLead(lead), proxima: proximaAccao(lead) };
    }
    if (/^\/ops\/leads\/[^/]+$/.test(caminhoLimpo) && metodo === 'GET') {
      const lead = d.leads.find((l) => l.id === seg[1]);
      if (!lead) throw falha(404, 'lead não encontrado');
      const eventos = (d.leadEventos || []).filter((e) => e.lead_id === lead.id)
        .sort((a, b) => String(b.criado).localeCompare(String(a.criado))).slice(0, 40);
      return {
        lead, dossier: null, eventos,
        messages: d.mensagens.filter((m) => m.lead_id === lead.id),
        confianca: confiancaDoLead(lead), verificacao: verificacaoDoLead(lead),
        proxima: proximaAccao(lead), qualificacao: qualificacaoDoLead(lead),
      };
    }
    if (/^\/ops\/leads\/[^/]+\/projeto$/.test(caminhoLimpo) && metodo === 'POST') {
      const id = seg[seg.length - 2];
      const lead = d.leads.find((l) => l.id === id);
      if (!lead) throw falha(404, 'lead não encontrado');
      const projeto = { id: novoId('p'), name: lead.name, client: lead.name, niche: lead.category, city: lead.city,
        kind: corpo?.kind || 'landing', status: 'rascunho', lead_id: lead.id, files: [],
        created_at: new Date(agora()).toISOString(), updated_at: new Date(agora()).toISOString() };
      d.projetos.push(projeto); escrever(d, 'projeto', `projeto «${projeto.name}» a partir do lead`); gravar(d);
      return { projeto };
    }

    /* --- mensagens (o que espera o teu OK) --- */
    if (caminhoLimpo === '/ops/messages' && metodo === 'GET') return { messages: d.mensagens.slice(0, Number(qs.get('limit')) || 100) };
    /* 1.34.0 · os mesmos nomes da API (português e inglês): a mesa chama
       `approve/reject/send/confirm/sinal`, e sem isto o modo local respondia 404
       a tudo o que ela pedia. Aprovar e confirmar funcionam aqui; enviar não —
       e diz porquê, em vez de fingir. */
    if (/^\/ops\/messages\/[^/]+\/(aprovar|approve|rejeitar|reject|enviar|send|confirmar|confirm|promover|promote|sinal|signal)$/.test(caminhoLimpo) && metodo === 'POST') {
      const bruto = seg[seg.length - 1], id = seg[seg.length - 2];
      const acao = { aprovar: 'aprovar', approve: 'aprovar', rejeitar: 'rejeitar', reject: 'rejeitar',
        enviar: 'enviar', send: 'enviar', confirmar: 'confirmar', confirm: 'confirmar',
        promover: 'promover', promote: 'promover', sinal: 'sinal', signal: 'sinal' }[bruto];
      const m = d.mensagens.find((x) => x.id === id);
      if (!m) throw falha(404, 'mensagem não encontrada');
      if (acao === 'aprovar') {
        if (m.status === 'enviada') throw falha(409, 'esta mensagem já foi enviada');
        m.status = 'aprovada'; m.aprovada_at = new Date(agora()).toISOString();
      } else if (acao === 'rejeitar') {
        m.status = 'rejeitada'; m.motivo = limpo(corpo?.reason || corpo?.motivo) || null;
      } else if (acao === 'promover') {
        if (m.status !== 'ensaio') throw falha(409, 'só uma mensagem em ensaio pode ser promovida');
        m.status = 'rascunho';
      } else if (acao === 'confirmar') {
        if (m.status === 'enviada') throw falha(409, 'já estava enviada');
        m.status = 'enviada'; m.enviada_at = new Date(agora()).toISOString(); m.confirmada = 'humano';
      } else if (acao === 'sinal') {
        const kind = String(corpo?.kind || '').toLowerCase();
        if (!['respondeu', 'recusou'].includes(kind)) throw falha(400, 'sinal tem de ser «respondeu» ou «recusou»');
        const lead = d.leads.find((l) => l.id === m.lead_id);
        if (lead) { lead.status = kind === 'respondeu' ? 'respondeu' : 'perdido'; lead.updated_at = new Date(agora()).toISOString(); }
      } else {
        throw falha(503, 'o envio real precisa do servidor: a chave do correio vive lá, nunca neste browser');
      }
      escrever(d, 'mensagem', `${acao} uma mensagem`); gravar(d);
      return { ok: true, message: m };
    }

    /* --- projetos --- */
    if (caminhoLimpo === '/ops/projetos' && metodo === 'GET') {
      return { projetos: [...d.projetos].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)),
        resumo: resumoProjetos(d), tipos: TIPOS_PROJETO };
    }
    if (caminhoLimpo === '/ops/projetos' && metodo === 'POST') {
      const nome = limpo(corpo?.name);
      if (!nome) throw falha(400, 'o projeto precisa de um nome');
      const projeto = { id: novoId('p'), name: nome, client: limpo(corpo.client), niche: limpo(corpo.niche),
        city: limpo(corpo.city), kind: limpo(corpo.kind) || 'landing', status: 'rascunho', lead_id: null, files: [],
        created_at: new Date(agora()).toISOString(), updated_at: new Date(agora()).toISOString() };
      d.projetos.push(projeto); escrever(d, 'projeto', `projeto «${nome}» criado`); gravar(d);
      return { projeto };
    }
    if (/^\/ops\/projetos\/[^/]+$/.test(caminhoLimpo) && metodo === 'GET') {
      const project = d.projetos.find((p) => p.id === seg[1]);
      if (!project) throw falha(404, 'projeto não encontrado');
      return { project, qa: null, files: [], historico: [] };
    }

    /* --- tarefas: 1.53.2 · ou correm no servidor, ou dizem porque não ---
       O modo local não tem motor de IA dentro do browser. O que pode fazer (e
       faz) é entregar a tarefa ao servidor da Órbita — `/api/rpc` — e devolver
       o resultado real que ele trouxer. Só quando essa ponte não existe é que a
       tarefa falha, e então a frase diz exactamente isso. */
    if (caminhoLimpo === '/ops/tarefas' && metodo === 'GET') {
      return { tarefas: [...d.tarefas].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 100),
        tipos: TIPOS_TAREFA, departamentos: DEPARTAMENTOS };
    }
    if (caminhoLimpo === '/ops/tarefas' && metodo === 'POST') {
      const tipo = limpo(corpo?.kind);
      if (!TIPOS_TAREFA[tipo]) throw falha(400, 'tipo de tarefa desconhecido');
      const criada = { id: novoId('t'), kind: tipo, entityId: limpo(corpo.entityId), entidade: limpo(corpo.entidade),
        state: 'running', error: null,
        created_at: new Date(agora()).toISOString(), finished_at: null };
      d.tarefas.push(criada); gravar(d);
      const remoto = await correrNoServidor(corpo);
      if (!remoto.ok) {
        Object.assign(criada, { state: 'failed', finished_at: new Date(agora()).toISOString(),
          error: `o modo local não tem motor de IA dentro do browser e não alcançou o servidor da Órbita (${remoto.erro}). Publica a mesa ou abre-a em orbita-agentes.vercel.app para as tarefas correrem.` });
        escrever(d, 'tarefa', `${TIPOS_TAREFA[tipo].label}: sem motor local`); gravar(d);
        return { tarefa: criada };
      }
      Object.assign(criada, remoto.tarefa || {}, { id: criada.id, created_at: criada.created_at });
      escrever(d, 'tarefa', `${TIPOS_TAREFA[tipo].label}: ${criada.state === 'succeeded' ? 'concluída' : 'não passou'}`); gravar(d);
      return { tarefa: criada, execucao: remoto.execucao || null };
    }
    if (/^\/ops\/tarefas\/[^/]+\/correr$/.test(caminhoLimpo) && metodo === 'POST') {
      const id = seg[seg.length - 2];
      const t = d.tarefas.find((x) => x.id === id);
      if (!t) throw falha(404, 'tarefa não encontrada');
      const remoto = await correrNoServidor({ kind: t.kind, entityId: t.entityId, entidade: t.entidade, aprovacao: false });
      if (!remoto.ok) {
        Object.assign(t, { state: 'failed', error: `não alcançou o servidor da Órbita (${remoto.erro})` });
        gravar(d);
        return { ok: false, error: t.error, tarefa: t };
      }
      Object.assign(t, remoto.tarefa || {}, { id: t.id });
      gravar(d);
      return { ok: !!remoto.tarefa && remoto.tarefa.state === 'succeeded', tarefa: t, execucao: remoto.execucao || null };
    }
    if (/^\/ops\/tarefas\/[^/]+\/(aprovar|rejeitar)$/.test(caminhoLimpo) && metodo === 'POST') {
      const id = seg[seg.length - 2];
      const t = d.tarefas.find((x) => x.id === id);
      if (!t) throw falha(404, 'tarefa não encontrada');
      t.state = seg[seg.length - 1] === 'aprovar' ? 'succeeded' : 'cancelled';
      t.finished_at = new Date(agora()).toISOString();
      gravar(d);
      return { ok: true, tarefa: t };
    }

    /* --- 1.56.0 · as faturas (o documento existe; o PDF precisa de servidor) --- */
    if (caminhoLimpo === '/ops/faturas' && metodo === 'GET') {
      return {
        ok: true,
        faturas: [...(d.faturas || [])].sort((a, b) => String(b.emitida_em).localeCompare(String(a.emitida_em))),
        resumo: faturasResumo(d),
        taxasIva: [23, 13, 6, 0],
        motivosIsencao: ['Isento — artigo 9.º do CIVA', 'Isento — artigo 14.º do CIVA'],
        emitente: { aviso: 'No modo local não há emitente configurado: o nome e o NIF da tua empresa só existem no servidor (ORBITA_EMITENTE_NOME, ORBITA_EMITENTE_NIF).' },
        correio: { configurado: false, aviso: 'Sem ligação ao servidor não há envio por email — o PDF também precisa dele.' },
        nota: 'O total faturado não é receita. A receita do saldo é o dinheiro que entrou; a fatura é o que foi cobrado.',
        aviso: SEM_PDF_LOCAL,
      };
    }
    if (caminhoLimpo === '/ops/faturas' && metodo === 'POST') {
      const nome = limpo(corpo?.cliente?.nome);
      if (!nome) throw falha(400, 'a fatura precisa do nome do cliente');
      const nif = String(corpo?.cliente?.nif || '').replace(/\s+/g, '');
      if (nif && !/^\d{9}$/.test(nif)) throw falha(400, `o NIF «${nif}» tem de ter 9 dígitos`);
      if (!nif && !corpo?.consumidorFinal) throw falha(400, 'falta o NIF do cliente — ou marca «consumidor final» para emitir sem NIF');
      const taxa = Number(corpo?.ivaTaxa ?? 23);
      if (![23, 13, 6, 0].includes(taxa)) throw falha(400, 'o IVA tem de ser 23, 13, 6 ou 0 %');
      if (taxa === 0 && !limpo(corpo?.motivoIsencao)) throw falha(400, 'uma fatura isenta tem de dizer o motivo');
      const linhas = (Array.isArray(corpo?.linhas) ? corpo.linhas : []).map((l) => {
        const descricao = limpo(l?.descricao);
        if (!descricao) throw falha(400, 'cada linha precisa de uma descrição');
        const quantidade = Number(l?.quantidade) || 0;
        if (quantidade <= 0) throw falha(400, 'a quantidade tem de ser maior do que zero');
        const precoCentimos = Math.round(Number(l?.precoEuros ?? 0) * 100);
        if (precoCentimos < 0) throw falha(400, 'o preço não pode ser negativo');
        return { descricao, quantidade, precoCentimos, totalCentimos: Math.round(quantidade * precoCentimos) };
      });
      if (!linhas.length) throw falha(400, 'a fatura precisa de pelo menos uma linha');
      const base = linhas.reduce((n, l) => n + l.totalCentimos, 0);
      if (base <= 0) throw falha(400, 'o total da fatura tem de ser maior do que zero');
      const iva = Math.round((base * taxa) / 100);
      const serie = String(new Date(agora()).getUTCFullYear());
      const numero = (d.faturas || []).filter((f) => f.serie === serie).reduce((n, f) => Math.max(n, f.numero), 0) + 1;
      const fatura = {
        id: novoId('f'), serie, numero, codigo: `${serie}/${String(numero).padStart(4, '0')}`,
        tipo: 'fatura', estado: 'emitida',
        cliente_nome: nome, cliente_nif: nif || null,
        cliente_email: limpo(corpo?.cliente?.email) || null,
        cliente_morada: limpo(corpo?.cliente?.morada) || null,
        consumidor_final: !nif, linhas,
        iva_taxa: taxa, motivo_isencao: taxa === 0 ? limpo(corpo.motivoIsencao) : null,
        base_centimos: base, iva_centimos: iva, total_centimos: base + iva, moeda: 'EUR',
        nota: limpo(corpo?.nota) || null,
        emitida_em: new Date(agora()).toISOString(),
        enviada_em: null, enviada_para: null, fatura_origem: null,
        semPdf: SEM_PDF_LOCAL,
      };
      d.faturas = [...(d.faturas || []), fatura];
      escrever(d, 'fatura', `fatura ${fatura.codigo} para «${nome}» (${dinheiro(fatura.total_centimos).toFixed(2)} €)`);
      gravar(d);
      return { ok: true, fatura, aviso: SEM_PDF_LOCAL };
    }
    if (/^\/ops\/faturas\/[^/]+\/anular$/.test(caminhoLimpo) && metodo === 'POST') {
      const f = (d.faturas || []).find((x) => x.id === seg[1]);
      if (!f) throw falha(404, 'fatura não encontrada');
      if (f.estado === 'anulada') throw falha(409, 'esta fatura já foi anulada');
      const motivo = limpo(corpo?.motivo);
      if (motivo.length < 3) throw falha(400, 'diz o motivo da anulação');
      f.estado = 'anulada'; f.motivo_anulacao = motivo; f.anulada_em = new Date(agora()).toISOString();
      const nc = {
        ...f, id: novoId('f'), tipo: 'nota_credito', estado: 'emitida', codigo: `${f.codigo}-NC`,
        base_centimos: -Math.abs(f.base_centimos), iva_centimos: -Math.abs(f.iva_centimos),
        total_centimos: -Math.abs(f.total_centimos), fatura_origem: f.id,
        emitida_em: new Date(agora()).toISOString(), enviada_em: null, enviada_para: null,
      };
      d.faturas.push(nc);
      escrever(d, 'fatura', `fatura ${f.codigo} anulada — nota de crédito ${nc.codigo}`);
      gravar(d);
      return { ok: true, fatura: f, notaCredito: nc };
    }
    if (/^\/ops\/faturas\/[^/]+\/enviar$/.test(caminhoLimpo) && metodo === 'POST') {
      const f = (d.faturas || []).find((x) => x.id === seg[1]);
      if (!f) throw falha(404, 'fatura não encontrada');
      return { ok: false, enviado: false, motivo: 'no modo local não há servidor de correio (RESEND_API_KEY vive no servidor), e sem PDF não havia o que anexar' };
    }
    if (/^\/ops\/faturas\/[^/]+$/.test(caminhoLimpo) && metodo === 'GET') {
      const f = (d.faturas || []).find((x) => x.id === seg[1]);
      if (!f) throw falha(404, 'fatura não encontrada');
      return { ok: true, fatura: f, aviso: SEM_PDF_LOCAL };
    }

    /* --- dinheiro --- */
    /* 1.60.0 · a autonomia no modo local: as mesmas regras do servidor, guardadas
       neste browser. Sem casos não se sobe — e a resposta diz quantos faltam. */
    if (caminhoLimpo === '/ops/autonomia' && metodo === 'GET') {
      const MIN_CASOS = 50, MIN_TAXA = 0.95;
      const estat = new Map();
      for (const msg of d.mensagens) {
        const escopo = limpo(msg.scope) || `${limpo(msg.channel) || 'email'}:geral`;
        const e = estat.get(escopo) || { escopo, aprovadas: 0, rejeitadas: 0 };
        if (['aprovada', 'enviada'].includes(msg.status)) e.aprovadas += 1;
        else if (['rejeitada', 'bloqueada'].includes(msg.status)) e.rejeitadas += 1;
        estat.set(escopo, e);
      }
      const escopos = new Set([...estat.keys(), ...(d.autonomia || []).map((r) => r.escopo)]);
      const lista = [...escopos].map((escopo) => {
        const e = estat.get(escopo) || { escopo, aprovadas: 0, rejeitadas: 0 };
        const decididas = e.aprovadas + e.rejeitadas;
        const taxa = decididas ? e.aprovadas / decididas : null;
        const r = (d.autonomia || []).find((x) => x.escopo === escopo) || null;
        const nivel = r && NIVEIS_AUTONOMIA[r.nivel] ? r.nivel : 'pedir_sempre';
        const faltamCasos = Math.max(0, MIN_CASOS - decididas);
        const podeSubir = nivel !== 'autonomo' && !faltamCasos && !(taxa != null && taxa < MIN_TAXA);
        return {
          escopo, nivel, rotulo: NIVEIS_AUTONOMIA[nivel].rotulo,
          casos: decididas, aprovadas: e.aprovadas, rejeitadas: e.rejeitadas,
          taxa, autor: r?.decidido_por || null, quando: r?.decidido_em || null, motivo: r?.motivo || null,
          podeSubir,
          porque: podeSubir ? `há ${decididas} casos com ${Math.round((taxa || 0) * 100)}% aprovados`
            : faltamCasos ? `faltam ${faltamCasos} caso(s) decididos à mão para poder subir (mínimo ${MIN_CASOS})` : 'já está no nível máximo',
          minimos: { casos: MIN_CASOS, taxa: MIN_TAXA },
        };
      });
      return { ok: true, lista, resumo: {
        total: lista.length,
        autonomos: lista.filter((x) => x.nivel === 'autonomo').length,
        propostos: lista.filter((x) => x.nivel === 'proposto').length,
        pedemSempre: lista.filter((x) => x.nivel === 'pedir_sempre').length,
        nota: 'Uma acção sensível exige sempre aprovação humana, mesmo em «autónomo».',
      } };
    }
    if (/^\/ops\/autonomia\/[^/]+\/(subir|descer)$/.test(caminhoLimpo) && metodo === 'POST') {
      const escopo = decodeURIComponent(seg[1]);
      const descer = seg[2] === 'descer';
      const doEscopo = d.mensagens.filter((x) => (limpo(x.scope) || `${limpo(x.channel) || 'email'}:geral`) === escopo);
      const aprovadas = doEscopo.filter((x) => ['aprovada', 'enviada'].includes(x.status)).length;
      const rejeitadas = doEscopo.filter((x) => ['rejeitada', 'bloqueada'].includes(x.status)).length;
      const decididas = aprovadas + rejeitadas;
      const taxa = decididas ? aprovadas / decididas : null;
      const atual = (d.autonomia || []).find((x) => x.escopo === escopo) || null;
      const atualNivel = atual && NIVEIS_AUTONOMIA[atual.nivel] ? atual.nivel : 'pedir_sempre';
      const forcar = corpo?.force === true;
      if (!descer && !forcar && (decididas < 50 || taxa == null || taxa < 0.95)) {
        throw falha(409, decididas < 50
          ? `ainda só há ${decididas} caso(s) deste tipo — o mínimo para subir é 50`
          : `a taxa aprovada é ${Math.round((taxa || 0) * 100)}% — o mínimo para subir é 95%`);
      }
      const nivel = descer ? 'pedir_sempre' : atualNivel === 'pedir_sempre' ? 'proposto' : 'autonomo';
      const registo = {
        escopo, nivel, casos: decididas, taxa,
        motivo: limpo(corpo?.motivo || corpo?.reason) || (descer ? 'descida para «pede-me sempre»' : 'subida pedida na mesa'),
        decidido_por: 'dono (modo local)', decidido_em: new Date(agora()).toISOString(),
      };
      d.autonomia = (d.autonomia || []).filter((x) => x.escopo !== escopo).concat([registo]);
      escrever(d, 'autonomia', `${escopo}: ${NIVEIS_AUTONOMIA[atualNivel].rotulo} → ${NIVEIS_AUTONOMIA[nivel].rotulo}`);
      gravar(d);
      return { ok: true, autonomia: registo, nivel, rotulo: NIVEIS_AUTONOMIA[nivel].rotulo, casos: decididas, taxa };
    }
    if (caminhoLimpo === '/ops/saldo') return { ...saldo(d), presenca: { parado: false } };
    if (caminhoLimpo === '/ops/receita' && metodo === 'POST') {
      const centimos = cents(corpo?.euros);
      if (!centimos) throw falha(400, 'diz o valor que entrou');
      d.receitas.push({ id: novoId('r'), amount_cents: centimos, campaign: limpo(corpo.campaign),
        at: new Date(agora()).toISOString(), origem: 'escrita na mesa' });
      escrever(d, 'receita', `entrada de ${dinheiro(centimos).toFixed(2)} €`); gravar(d);
      return { ok: true, euro: dinheiro(centimos) };
    }
    if (/^\/ops\/receita\/[^/]+$/.test(caminhoLimpo) && metodo === 'DELETE') {
      const antes = d.receitas.length;
      d.receitas = d.receitas.filter((r) => r.id !== seg[1]);
      if (d.receitas.length === antes) throw falha(404, 'entrada não encontrada');
      gravar(d);
      return { ok: true };
    }

    /* --- o resto: o vazio honesto (nunca dados inventados) --- */
    if (caminhoLimpo === '/ops/clientes') return { clientes: [{ id: 'local', nome: 'Este browser', ativo: true }], activo: { id: 'local', nome: 'Este browser' } };
    if (caminhoLimpo === '/ops/pipeline') return pipeline(d);
    if (caminhoLimpo === '/ops/atividade') return { eventos: d.atividade.slice(0, Number(qs.get('limit')) || 20) };
    /* 1.57.2 · as mesmas contagens reais do servidor (ver `api/_rotas.mjs`) */
    /* 1.87.0 · o painel «Falhas» no modo local: lê só o que este browser tem.
       As outras origens (modelos, imagens, execuções, envios) vivem na base, e
       diz-se porquê não se leem — nunca «0» por omissão. */
    if (caminhoLimpo === '/ops/falhas') {
      const SEM_BASE = 'modo local: sem base de dados, esta origem não se lê daqui';
      const agora = Date.now();
      const desde = agora - 7 * 24 * 3600 * 1000;
      const quando = (t) => (t.finished_at || t.created_at || null);
      const falhadas = (d.tarefas || []).filter((t) => t && t.state === 'failed').map((t) => ({
        origem: 'tarefa', quando: quando(t), quem: String(t.kind || 'tarefa'),
        titulo: String(t.title || t.kind || 'tarefa').slice(0, 120), erro: String(t.error || 'sem motivo guardado').slice(0, 300),
      }));
      const naJanela = falhadas.filter((f) => f.quando && Date.parse(f.quando) >= desde);
      const ordenadas = [...naJanela].sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
      const porOrigem = [
        { id: 'tarefa', rotulo: 'Tarefa dos agentes', onde: 'Escritório · Fila de tarefas', total: naJanela.length, ultimas24h: naJanela.filter((f) => Date.parse(f.quando) >= agora - 86400000).length, ultimo: ordenadas[0] ? { quando: ordenadas[0].quando, quem: ordenadas[0].quem, erro: ordenadas[0].erro } : null, indisponivel: null },
        { id: 'modelo', rotulo: 'Pedido a um modelo', onde: 'Control Center · Uso e erros', total: null, ultimas24h: null, ultimo: null, indisponivel: SEM_BASE },
        { id: 'imagem', rotulo: 'Imagem gerada', onde: 'Projetos · aba Mídia', total: null, ultimas24h: null, ultimo: null, indisponivel: SEM_BASE },
        { id: 'execucao', rotulo: 'Execução dos agentes', onde: 'Control Center · Execuções', total: null, ultimas24h: null, ultimo: null, indisponivel: SEM_BASE },
        { id: 'envio', rotulo: 'Envio de mensagem', onde: 'Mesa · Mensagens', total: null, ultimas24h: null, ultimo: null, indisponivel: SEM_BASE },
      ];
      const lidas = porOrigem.filter((o) => !o.indisponivel);
      const total = lidas.reduce((n, o) => n + o.total, 0);
      return {
        ok: true, janelaDias: 7, desde: new Date(desde).toISOString(), quando: new Date(agora).toISOString(),
        total, ultimas24h: lidas.reduce((n, o) => n + o.ultimas24h, 0), origensSemLeitura: porOrigem.length - lidas.length,
        porOrigem, recentes: ordenadas.slice(0, 25), modo: 'local',
        frase: `${total} falha(s) nas tarefas deste browser · ${porOrigem.length - lidas.length} origens sem leitura no modo local`,
      };
    }
    if (caminhoLimpo === '/ops/agentes') {
      const quando = (t) => (t ? (t.finished_at || t.created_at || null) : null);
      const porSala = new Map(DEPARTAMENTOS.map((x) => [x.id, []]));
      for (const t of d.tarefas.filter(Boolean)) {
        const id = DEPARTAMENTOS_POR_TIPO[t.kind] || 'comando';
        if (porSala.has(id)) porSala.get(id).push(t);
      }
      /* 1.84.0 · `agentes: []` também aqui: o elenco é dado puro e é o mesmo
         nos dois modos. A diferença entre local e servidor é o TRABALHO, não
         quem existe no escritório. */
      const todos = elencoBase();
      const departamentos = DEPARTAMENTOS.map((x) => {
        const lista = porSala.get(x.id) || [];
        const n = (estado) => lista.filter((t) => t.state === estado).length;
        const ordenadas = lista.slice().sort((a, b) => String(quando(b) || '').localeCompare(String(quando(a) || '')));
        const falha = ordenadas.find((t) => t.state === 'failed') || null;
        const daSala = agentesDaSala(SALA_DO_DEPARTAMENTO_PT[x.id] || x.id, todos);
        return {
          ...x, name: x.nome, role: TIPOS_TAREFA[ordenadas[0]?.kind]?.label || '',
          agentes: daSala.map((a) => ({ id: a.id, nome: a.nome, papel: a.papel, temRotina: a.temRotina, rotinas: a.rotinas, consultivo: a.consultivo })),
          elenco: { total: daSala.length, comRotina: daSala.filter((a) => a.temRotina).length, consultivos: daSala.filter((a) => a.consultivo).length },
          running: n('running'), awaiting: n('awaiting_approval'), queued: n('queued'),
          succeeded: n('succeeded'), failed: n('failed'),
          tarefas: { aCorrer: n('running'), naFila: n('queued'), porAprovar: n('awaiting_approval'), concluidas: n('succeeded'), falhadas: n('failed'), total: lista.length },
          ultima: quando(ordenadas[0]) || null,
          last: ordenadas[0] ? `${TIPOS_TAREFA[ordenadas[0].kind]?.label || ordenadas[0].kind}` : '',
          ultimaFalha: falha ? { error: falha.error || '', quando: quando(falha) } : null,
        };
      });
      const conta = (estado) => d.tarefas.filter((t) => t.state === estado).length;
      return {
        departamentos,
        resumo: { total: d.tarefas.length, running: conta('running'), awaiting: conta('awaiting_approval'), queued: conta('queued'), succeeded: conta('succeeded'), failed: conta('failed') },
        elenco: { total: todos.total, comRotina: todos.comRotina, consultivos: todos.consultivos, motores: 0, resumo: todos.resumo },
        modo: 'local',
      };
    }
    if (caminhoLimpo === '/ops/utilizadores') return { utilizadores: [], papeis: [] };
    if (caminhoLimpo === '/ops/sessoes') return { sessoes: [] };
    if (caminhoLimpo === '/ops/stop') return { ok: true, parado: !!corpo?.stop };
    if (caminhoLimpo === '/ops/pesquisa') return { query: qs.get('q') || '', grupos: [] };

    throw falha(501, `o modo local ainda não faz «${caminhoLimpo}»`);
  }

  return {
    modo: 'local',
    async call(caminho, metodo = 'GET', corpo) {
      // igual ao servidor: a resposta é JSON e o erro traz o estado HTTP
      try { return await rota(caminho, metodo, corpo); }
      catch (e) { throw Object.assign(e, { local: true }); }
    },
    /* cópia de segurança: um browser não é uma base de dados */
    exportar: () => JSON.stringify(ler(), null, 2),
    importar(texto) {
      const d = JSON.parse(texto);
      if (!d || typeof d !== 'object' || !Array.isArray(d.leads)) throw new Error('isto não é uma cópia da mesa');
      gravar({ ...vazio(), ...d });
      return { leads: d.leads.length, projetos: (d.projetos || []).length };
    },
    apagarTudo() { gravar(vazio()); },
    estado: () => {
      const d = ler();
      return { leads: d.leads.length, projetos: d.projetos.length, tarefas: d.tarefas.length, receitas: d.receitas.length, criado: d.criado };
    },
  };
}
