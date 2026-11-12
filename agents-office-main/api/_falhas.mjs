/* ===========================================================================
   1.87.0 · O PAINEL «FALHAS» (A5 do alvo 1.0) — 11 nov 2026

   O que havia: cada parte do produto sabia das suas falhas (uma tarefa com
   `state: failed`, um pedido ao modelo com `ok: false`, uma imagem com
   `estado: falhou`, uma execução com `estado: falhou`, um envio com
   `status: falhou`) — mas nenhum ecrã as juntava. Quem queria saber «o que
   falhou esta semana?» tinha de abrir cinco sítios.

   Este ficheiro junta-as, por origem, com:
     · quantas falharam na janela (7 dias) e quantas nas últimas 24 h;
     · a última falha real, com a hora e o erro que a origem guardou;
     · a lista das mais recentes, da mais nova para a mais antiga.

   Regras que não quebra:
     · uma origem que não se consegue ler diz PORQUÊ (`indisponivel`); nunca
       aparece como «0 falhas» por omissão — zero sem leitura seria mentira;
     · o erro é mostrado, mas sem segredos: quem o escreve pode ter posto uma
       chave num URL ou num cabeçalho. `limparSegredos` tira-os antes de sair;
     · nada aqui repete, apaga, nem tenta de novo. É só leitura.
   =========================================================================== */

export const ORIGENS = [
  { id: 'tarefa', rotulo: 'Tarefa dos agentes', onde: 'Escritório · Fila de tarefas' },
  { id: 'modelo', rotulo: 'Pedido a um modelo', onde: 'Control Center · Uso e erros' },
  { id: 'imagem', rotulo: 'Imagem gerada', onde: 'Projetos · aba Mídia' },
  { id: 'execucao', rotulo: 'Execução dos agentes', onde: 'Control Center · Execuções' },
  { id: 'envio', rotulo: 'Envio de mensagem', onde: 'Mesa · Mensagens' },
];

const DIA = 24 * 60 * 60 * 1000;
const LIMITE_ERRO = 300;

/** Tira segredos de um texto antes de ele sair do servidor. Puro. */
export function limparSegredos(texto, env = {}) {
  let t = String(texto ?? '');
  /* os valores reais das variáveis secretas do ambiente, se aparecerem no erro */
  for (const [nome, valor] of Object.entries(env || {})) {
    if (!/KEY|TOKEN|SECRET|PASSWORD|PASS/i.test(nome)) continue;
    const v = String(valor || '');
    if (v.length >= 8) t = t.split(v).join('••••');
  }
  return t
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer ••••')
    .replace(/((?:api[_-]?key|apikey|key|token|secret|authorization)=)[^&\s"']+/gi, '$1••••')
    .replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{12,}/g, '••••');
}

const cortar = (t, n = LIMITE_ERRO) => {
  const s = String(t ?? '').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

const quandoDe = (...valores) => {
  for (const v of valores) {
    if (!v) continue;
    const ms = Date.parse(v);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
};

/* ---------- cada origem, do seu jeito, para a mesma forma ---------- */

const porTarefa = (t) => ({
  origem: 'tarefa',
  quando: quandoDe(t.finished_at, t.created_at),
  quem: String(t.kind || 'tarefa'),
  titulo: String(t.title || t.kind || 'tarefa').slice(0, 120),
  erro: t.error || 'sem motivo guardado',
});

const porModelo = (l) => ({
  origem: 'modelo',
  quando: quandoDe(l.criado),
  quem: [l.fornecedor, l.modelo].filter(Boolean).join(' · ') || 'modelo',
  titulo: l.tipo ? String(l.tipo) : (l.agente ? `agente ${l.agente}` : 'pedido'),
  erro: l.erro || 'sem motivo guardado',
});

const porImagem = (g) => ({
  origem: 'imagem',
  quando: quandoDe(g.actualizado, g.criado),
  quem: String(g.fornecedor || 'imagem'),
  titulo: String(g.prompt || 'imagem').slice(0, 120),
  erro: g.erro || 'sem motivo guardado',
});

const porExecucao = (r) => ({
  origem: 'execucao',
  quando: quandoDe(r.fim, r.criado),
  quem: 'Orchestrator',
  titulo: String(r.objetivo || 'execução').slice(0, 120),
  erro: r.erro || 'sem motivo guardado',
});

const porEnvio = (m) => ({
  origem: 'envio',
  quando: quandoDe(m.enviada_em, m.updated_at, m.created_at),
  quem: String(m.channel || m.canal || 'mensagem'),
  titulo: String(m.subject || m.assunto || m.body || 'mensagem').slice(0, 120),
  erro: m.erro || m.error || 'sem motivo guardado',
});

/**
 * O painel. `repo` é o mesmo de sempre; `agora` e `env` existem para os testes.
 * Nunca lança: cada origem que falha vira `indisponivel` com a razão.
 */
export async function painelDeFalhas(repo, { agora = Date.now(), janelaDias = 7, limite = 25, env = {} } = {}) {
  const desdeMs = agora - janelaDias * DIA;
  const desde24 = agora - DIA;
  const desde = new Date(desdeMs).toISOString();

  const fontes = {
    tarefa: async () => (await repo.tarefas.list(300)).filter(Boolean).filter((t) => t.state === 'failed').map(porTarefa),
    modelo: async () => (await repo.ia.uso.recentes(500)).filter(Boolean).filter((l) => l.ok === false).map(porModelo),
    imagem: async () => (await repo.geracoes.porPeriodo(desde, 500)).filter(Boolean).filter((g) => g.estado === 'falhou').map(porImagem),
    execucao: async () => (await repo.ia.runs.listar(100)).filter(Boolean).filter((r) => r.estado === 'falhou').map(porExecucao),
    envio: async () => (await repo.mensagens.list(300)).filter(Boolean).filter((m) => m.status === 'falhou').map(porEnvio),
  };

  const porOrigem = [];
  const todas = [];
  for (const o of ORIGENS) {
    try {
      const lista = (await fontes[o.id]())
        .map((f) => ({ ...f, erro: cortar(limparSegredos(f.erro, env)), titulo: limparSegredos(f.titulo, env) }));
      const naJanela = lista.filter((f) => f.quando && Date.parse(f.quando) >= desdeMs);
      const nasUltimas24h = naJanela.filter((f) => Date.parse(f.quando) >= desde24);
      const ordenadas = [...naJanela].sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
      porOrigem.push({
        id: o.id, rotulo: o.rotulo, onde: o.onde,
        total: naJanela.length,
        ultimas24h: nasUltimas24h.length,
        ultimo: ordenadas[0] ? { quando: ordenadas[0].quando, quem: ordenadas[0].quem, erro: ordenadas[0].erro } : null,
        indisponivel: null,
      });
      todas.push(...naJanela);
    } catch (e) {
      porOrigem.push({
        id: o.id, rotulo: o.rotulo, onde: o.onde,
        total: null, ultimas24h: null, ultimo: null,
        indisponivel: cortar(limparSegredos(e?.message || 'a origem não respondeu', env), 200),
      });
    }
  }

  const recentes = todas
    .sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando))
    .slice(0, Math.max(1, Math.min(100, Number(limite) || 25)));
  const lidas = porOrigem.filter((o) => !o.indisponivel);
  const total = lidas.reduce((n, o) => n + o.total, 0);

  return {
    ok: true,
    janelaDias,
    desde,
    quando: new Date(agora).toISOString(),
    total,
    ultimas24h: lidas.reduce((n, o) => n + o.ultimas24h, 0),
    origensSemLeitura: porOrigem.filter((o) => o.indisponivel).length,
    porOrigem,
    recentes,
    frase: total === 0 && lidas.length === porOrigem.length
      ? `nenhuma falha nos últimos ${janelaDias} dias nas ${porOrigem.length} origens lidas`
      : `${total} falha(s) nos últimos ${janelaDias} dias${porOrigem.some((o) => o.indisponivel) ? ` · ${porOrigem.filter((o) => o.indisponivel).length} origem(ns) sem leitura — diz-se abaixo porquê` : ''}`,
  };
}
