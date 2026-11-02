/* ===========================================================================
   1.60.0 · MOTORES, AUTONOMIA E SALDO — as contas que os tornam legíveis
   (2 nov 2026)

   O dono pediu três coisas que estavam espalhadas por três ecrãs e não se
   respondiam entre si:

     · que motor está escolhido, o que ele SABE fazer (texto? mãos? ficheiros?)
       e com que permissões;
     · o estado das integrações e quando foi a última verificação;
     · o consumo real, os limites e o custo — com «desconhecido» onde não há
       preço, nunca um zero que se confunde com grátis;
     · o nível de autonomia de cada agente e o que exige aprovação humana.

   Tudo aqui é puro: sem DOM, sem rede, sem base. A mesa desenha o que estas
   funções dizem, e os testes provam que dizem a verdade — inclusive quando a
   verdade é «não sei».
   =========================================================================== */

/** As duas famílias de motor, e a diferença que interessa a quem trabalha. */
export const CLASSES = {
  cli: {
    id: 'cli', rotulo: 'Motor com mãos (CLI)', curto: 'CLI',
    porque: 'corre nesta máquina: abre ficheiros, corre comandos e usa ferramentas',
  },
  api: {
    id: 'api', rotulo: 'API de texto', curto: 'API',
    porque: 'responde com texto; só usa ferramentas quando o modelo as souber pedir e o servidor as executar',
  },
};

/** O que um motor pode fazer. `true`, `false` ou `null` (não se sabe). */
export const CAPACIDADES = [
  { id: 'texto', rotulo: 'Texto' },
  { id: 'ferramentas', rotulo: 'Ferramentas' },
  { id: 'ficheiros', rotulo: 'Ficheiros' },
  { id: 'visao', rotulo: 'Imagens' },
];

/** Os níveis de autonomia — os mesmos de `src/ops/autonomy.mjs` (uma só verdade). */
export const NIVEIS_AUTONOMIA = {
  pedir_sempre: { id: 'pedir_sempre', rotulo: 'Pede-me sempre', cor: '#8A8A8A', ordem: 0, porque: 'nada sai sem a tua autorização' },
  proposto: { id: 'proposto', rotulo: 'Propõe e espera', cor: '#B4830B', ordem: 1, porque: 'prepara o trabalho e pede o OK antes de agir' },
  autonomo: { id: 'autonomo', rotulo: 'Autónomo', cor: '#1E9070', ordem: 2, porque: 'age sozinho neste tipo — os travões gerais continuam a mandar' },
};

const DIA = 24 * 3600 * 1000;
const texto = (v) => (v == null ? '' : String(v).trim());
const data = (v) => {
  if (v == null || v === '') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** Há quanto tempo, por palavras — `nunca` quando não há registo. */
export function desde(quando, agora = Date.now()) {
  const t = data(quando);
  if (t == null) return { texto: 'nunca', dias: null, horas: null, quando: null };
  const ms = Math.max(0, agora - t);
  const horas = Math.floor(ms / 3600000);
  const dias = Math.floor(ms / DIA);
  const frase = ms < 60000 ? 'agora mesmo'
    : horas < 1 ? `há ${Math.max(1, Math.floor(ms / 60000))} min`
      : horas < 24 ? `há ${horas} h`
        : `há ${dias} dia${dias === 1 ? '' : 's'}`;
  return { texto: frase, dias, horas, quando: new Date(t).toISOString() };
}

/**
 * A classe de um motor. Só é `cli` quando o servidor o declara — um motor sem
 * declaração é uma API, e é dito assim em vez de se adivinhar que tem mãos.
 */
export function classeDe(fornecedor) {
  const cru = texto(fornecedor && (fornecedor.classe || fornecedor.kind)).toLowerCase();
  return CLASSES[cru] ? cru : 'api';
}

/**
 * As capacidades de um motor, cada uma com a razão. `null` = não declarado, e
 * isso mostra-se como «por declarar» — não como «não tem».
 */
export function capacidadesDe(fornecedor) {
  const f = fornecedor || {};
  const classe = classeDe(f);
  const declarado = f.capacidades && typeof f.capacidades === 'object' ? f.capacidades : null;
  /* `null` quer dizer «não declarado» e é diferente de `false` («declarou que
     não tem»). Confundir os dois fazia o painel dizer que um motor não tem
     mãos quando ninguém o tinha dito. */
  const ferramentasDeclaradas = declarado && declarado.ferramentas !== undefined
    ? !!declarado.ferramentas
    : (f.ferramentas === undefined || f.ferramentas === null
      ? (classe === 'cli' ? !!f.tools : null)
      : !!f.ferramentas);
  const ficheiros = declarado && declarado.ficheiros !== undefined
    ? !!declarado.ficheiros
    : (classe === 'cli' ? !!f.tools : false);
  const visao = declarado && declarado.visao !== undefined ? !!declarado.visao : false;
  const lista = [
    { id: 'texto', tem: true, porque: 'responde sempre com texto' },
    {
      id: 'ferramentas', tem: ferramentasDeclaradas,
      porque: ferramentasDeclaradas === null ? 'o fornecedor não declarou se aceita ferramentas'
        : ferramentasDeclaradas ? 'usa ferramentas (e as destrutivas pedem aprovação)'
          : 'responde com texto: não recebe ferramentas',
    },
    {
      id: 'ficheiros', tem: ficheiros,
      porque: ficheiros ? 'pode escrever ficheiros nesta máquina' : 'não escreve no disco — o servidor é quem guarda',
    },
    {
      id: 'visao', tem: visao,
      porque: visao ? 'aceita imagens' : 'não aceita imagens',
    },
  ];
  return lista.map((c) => ({ ...c, rotulo: (CAPACIDADES.find((x) => x.id === c.id) || {}).rotulo || c.id }));
}

/**
 * As permissões reais de um motor, por palavras. O que não está declarado não
 * se promete: aparece como «por declarar».
 */
export function permissoesDe(fornecedor) {
  const f = fornecedor || {};
  const classe = classeDe(f);
  const caps = capacidadesDe(f);
  const tem = (id) => (caps.find((c) => c.id === id) || {}).tem === true;
  const out = [
    { id: 'responder', rotulo: 'Responder com texto', tem: true },
    { id: 'ler', rotulo: 'Ler o que já está guardado', tem: true },
  ];
  out.push({
    id: 'ferramentas',
    rotulo: 'Usar ferramentas',
    tem: tem('ferramentas'),
    porque: tem('ferramentas') ? 'as ferramentas correm no servidor, com registo' : 'este motor não recebe ferramentas',
  });
  out.push({
    id: 'destrutivas',
    rotulo: 'Acções destrutivas',
    /* nenhum motor tem este direito por si: a ferramenta destrutiva exige
       aprovação humana no contexto da execução, sempre */
    tem: false,
    porque: 'exigem sempre aprovação humana explícita — nenhum motor as corre sozinho',
  });
  if (classe === 'cli') {
    out.push({ id: 'maquina', rotulo: 'Correr comandos nesta máquina', tem: true, porque: 'é um CLI local' });
  }
  return out;
}

/** O estado do motor em duas palavras, com a cor e o motivo. */
export function estadoDoMotor(fornecedor) {
  const f = fornecedor || {};
  if (f.estado === 'inutilizavel') return { id: 'inutilizavel', rotulo: 'Não serve este cliente', cor: '#8A8A8A', porque: 'o dialecto deste fornecedor não é falado aqui' };
  if (f.desligado) return { id: 'desligado', rotulo: 'Desligado por ti', cor: '#8A8A8A', porque: 'está configurado, mas não é usado' };
  /* não configurado vence qualquer estado antigo: um teste de ontem não torna
     utilizável um motor que hoje não tem chave */
  if (f.configurado === false && f.semChave !== true) {
    return { id: 'sem_chave', rotulo: 'Sem chave', cor: '#8A8A8A', porque: 'falta a variável no servidor' };
  }
  if (f.estado === 'funcional') return { id: 'funcional', rotulo: 'Verificado', cor: '#1E9070', porque: (f.ultimoTeste && f.ultimoTeste.ok ? 'o último teste respondeu' : 'há uma resposta registada') };
  if (f.estado === 'erro') return { id: 'erro', rotulo: 'Falhou no teste', cor: '#B4391E', porque: (f.ultimoTeste && f.ultimoTeste.erro) || 'o último teste não respondeu' };
  if (f.estado === 'por_testar') return { id: 'por_testar', rotulo: 'Por testar', cor: '#B4830B', porque: 'tem chave, mas ainda não deu uma resposta registada' };
  if (f.estado === 'sem_chave') return { id: 'sem_chave', rotulo: 'Sem chave', cor: '#8A8A8A', porque: 'falta a variável no servidor' };
  return { id: 'desconhecido', rotulo: 'Sem estado', cor: '#8A8A8A', porque: 'o servidor não disse em que estado está' };
}

/** O retrato de um fornecedor: estado, capacidades, permissões e último teste. */
export function perfilDoMotor(fornecedor, { agora = Date.now() } = {}) {
  const f = fornecedor || {};
  const estado = estadoDoMotor(f);
  const caps = capacidadesDe(f);
  const t = f.ultimoTeste || null;
  const verificado = desde(t && (t.quando || t.at), agora);
  return {
    id: texto(f.id) || texto(f.nome).toLowerCase(),
    nome: texto(f.nome) || texto(f.id) || 'motor sem nome',
    classe: classeDe(f),
    classeRotulo: CLASSES[classeDe(f)].rotulo,
    classePorque: CLASSES[classeDe(f)].porque,
    estado,
    capacidades: caps,
    temFerramentas: (caps.find((c) => c.id === 'ferramentas') || {}).tem,
    permissoes: permissoesDe(f),
    limites: texto(f.limites) || 'limites não declarados',
    configurado: !!f.configurado,
    desligado: !!f.desligado,
    modelo: texto(f.modelo) || null,
    variavel: texto(f.variavel) || null,
    /* nunca o valor da chave — só o nome da variável e a máscara que o servidor já deu */
    chaveMascarada: texto(f.chaveMascarada) || '',
    teste: t ? { ok: !!t.ok, ms: t.ms ?? null, erro: texto(t.erro) || null, quando: t.quando || t.at || null } : null,
    verificacao: {
      ...verificado,
      rotulo: t ? (t.ok ? `verificado ${verificado.texto}` : `falhou ${verificado.texto}`) : 'nunca verificado',
    },
    catalogo: Number(f.modelosNoCatalogo) || 0,
  };
}

/** Todos os motores, e o resumo que o topo do ecrã mostra. */
export function perfis(fornecedores = [], { agora = Date.now() } = {}) {
  const lista = (Array.isArray(fornecedores) ? fornecedores : []).filter(Boolean).map((f) => perfilDoMotor(f, { agora }));
  const conta = (fn) => lista.filter(fn).length;
  const resumo = {
    total: lista.length,
    prontos: conta((f) => f.configurado && !f.desligado),
    verificados: conta((f) => f.estado.id === 'funcional'),
    porTestar: conta((f) => f.estado.id === 'por_testar'),
    semChave: conta((f) => f.estado.id === 'sem_chave'),
    comFerramentas: conta((f) => f.temFerramentas === true),
    semFerramentas: conta((f) => f.temFerramentas !== true),
    porDeclarar: conta((f) => f.temFerramentas === null),
  };
  resumo.frase = !resumo.total ? 'Nenhum motor ligado — as chaves vivem no servidor.'
    : `${resumo.prontos} pronto(s) · ${resumo.verificados} verificado(s) · ${resumo.porTestar} por testar`
      + `${resumo.semChave ? ` · ${resumo.semChave} sem chave` : ''}`;
  return { lista, resumo };
}

/**
 * O motor escolhido para um agente, com o aviso quando o trabalho pede mãos e o
 * motor só dá texto. Um agente com ferramentas e um motor sem elas é uma
 * promessa que não se cumpre — e tem de estar à vista ANTES de correr.
 */
export function escolhaDoAgente(agente, lista = []) {
  const a = agente || {};
  const motores = Array.isArray(lista) ? lista : [];
  const escolha = a.escolha && typeof a.escolha === 'object' ? a.escolha : (a.modelo ? { modelo: a.modelo, fornecedor: a.fornecedor } : null);
  const doAgente = escolha?.fornecedor ? motores.find((m) => m.id === escolha.fornecedor) || null : null;
  const ferramentasPedidas = Array.isArray(a.ferramentas) ? a.ferramentas : [];
  const temFerramentas = doAgente ? doAgente.temFerramentas : null;
  const precisa = ferramentasPedidas.length > 0;
  let aviso = null;
  if (!escolha?.modelo) aviso = 'sem motor escolhido: o router decide em cada pedido';
  else if (!doAgente) aviso = `o motor «${escolha.fornecedor || '?'}» não está nesta instalação`;
  else if (precisa && temFerramentas === false) aviso = `${doAgente.nome} responde com texto e este agente pede ferramentas (${ferramentasPedidas.join(', ')}) — a tarefa corre, mas sem mãos`;
  else if (precisa && temFerramentas === null) aviso = `${doAgente.nome} não declarou se aceita ferramentas — não se promete o que não está provado`;
  return {
    id: a.id || null,
    numero: a.numero ?? null,
    nome: texto(a.nome) || texto(a.id) || 'agente',
    papel: texto(a.papel) || '',
    motor: escolha?.fornecedor ? doAgente?.nome || escolha.fornecedor : null,
    motorId: escolha?.fornecedor || null,
    modelo: texto(escolha?.modelo) || null,
    classe: doAgente ? doAgente.classe : null,
    ferramentasPedidas,
    ferramentasDisponiveis: temFerramentas,
    aviso,
  };
}

/** O nível de autonomia de um tipo de trabalho, dito por palavras. */
export function nivelDeAutonomia(registo, { agora = Date.now() } = {}) {
  const r = registo || {};
  const id = NIVEIS_AUTONOMIA[r.nivel] ? r.nivel : NIVEIS_AUTONOMIA[r.status] ? r.status : 'pedir_sempre';
  const n = NIVEIS_AUTONOMIA[id];
  const decidido = desde(r.decidido_em || r.decididoEm || r.decided_at || r.quando, agora);
  return {
    nivel: id, rotulo: n.rotulo, cor: n.cor, ordem: n.ordem, porque: n.porque,
    escopo: texto(r.escopo || r.scope) || null,
    autor: texto(r.decidido_por || r.autor || r.decided_by) || null,
    quando: decidido.quando,
    quandoTexto: decidido.texto,
    motivo: texto(r.motivo || r.reason) || null,
    casos: Number.isFinite(Number(r.casos)) ? Number(r.casos) : null,
    taxa: Number.isFinite(Number(r.taxa)) ? Number(r.taxa) : null,
  };
}

/** Se este nível deixa agir sem pedir. Uma acção sensível nunca deixa. */
export function podeAgirSozinho(registo, { sensivel = false } = {}) {
  const n = nivelDeAutonomia(registo);
  if (sensivel) return { sim: false, porque: 'é uma acção sensível: exige aprovação humana, seja qual for o nível' };
  if (n.nivel === 'autonomo') return { sim: true, porque: 'este tipo está autónomo e a acção não é sensível' };
  return { sim: false, porque: n.porque };
}

/**
 * A regra da aprovação obrigatória, num sítio só. É a que o servidor aplica
 * (`api/_ia/ferramentas.mjs`: `destrutivo` sem `aprovado` não corre) e a que a
 * mesa mostra — a mesma verdade, não uma segunda opinião.
 */
export function requerAprovacao({ ferramenta, nivel, classe } = {}) {
  const f = ferramenta || {};
  if (f.destrutivo || f.destrutiva) {
    return { exige: true, porque: `«${f.nome || f.id || 'esta ferramenta'}» apaga ou envia: exige aprovação humana explícita` };
  }
  const n = nivelDeAutonomia(nivel);
  if (n.nivel === 'autonomo') return { exige: false, porque: 'o tipo está autónomo e a ferramenta não é destrutiva' };
  if (n.nivel === 'proposto') return { exige: true, porque: 'o tipo está em «propõe e espera»' };
  return { exige: true, porque: 'o tipo está em «pede-me sempre»' };
}

/** As acções que nunca correm sozinhas, com a razão de cada uma. */
export function acoesSensiveis(ferramentas = []) {
  const lista = Array.isArray(ferramentas) ? ferramentas : [];
  return lista
    .filter((f) => f && (f.destrutiva || f.destrutivo))
    .map((f) => ({
      id: texto(f.id) || texto(f.nome).toLowerCase(),
      nome: texto(f.nome) || texto(f.id),
      descricao: texto(f.descricao) || 'sem descrição',
      exige: true,
      porque: 'apaga ou envia: só corre com aprovação humana na própria execução',
    }));
}

/** O consumo real por fornecedor, com o custo e o que ficou sem preço. */
export function consumoPorMotor(uso = {}, fornecedores = []) {
  const resumo = Array.isArray(uso?.resumo) ? uso.resumo : [];
  return resumo.map((u) => {
    const f = (Array.isArray(fornecedores) ? fornecedores : []).find((x) => x && (x.id === u.fornecedor || x.nome === u.fornecedor));
    return {
      id: texto(u.fornecedor) || 'desconhecido',
      nome: (f && f.nome) || texto(u.fornecedor) || 'desconhecido',
      pedidos: Number(u.pedidos) || 0,
      ok: Number(u.ok) || 0,
      erros: Number(u.erros) || 0,
      latenciaMs: Number.isFinite(Number(u.latenciaMediaMs)) ? Number(u.latenciaMediaMs) : null,
      tokens: Number(u.tokens) || 0,
      limites: (f && f.limites) || 'limites não declarados',
      custo: u.custoCentimos != null ? Number(u.custoCentimos) : null,
      semPreco: Number(u.semPreco) || 0,
    };
  }).sort((a, b) => b.pedidos - a.pedidos);
}

/**
 * O resumo do consumo: chamadas, tokens e custo. O que não tem preço NÃO entra
 * como zero — entra contado à parte, para o total não mentir.
 */
export function resumoDoConsumo({ uso = null, saldo = null } = {}) {
  const linhas = consumoPorMotor(uso || {}, []);
  const chamadas = linhas.reduce((n, l) => n + l.pedidos, 0);
  const tokens = linhas.reduce((n, l) => n + l.tokens, 0);
  const conta = saldo?.contaAVista || {};
  const linhasConta = Array.isArray(conta.linhas) ? conta.linhas : [];
  const semPreco = Number(conta.desconhecidas) || linhas.reduce((n, l) => n + l.semPreco, 0);
  const custoConhecido = saldo?.custoCentimos != null ? Number(saldo.custoCentimos) : null;
  return {
    chamadas, tokens,
    custoCentimos: custoConhecido,
    custoTexto: custoConhecido == null ? 'desconhecido' : null,
    semPreco,
    nota: semPreco
      ? `${semPreco} chamada(s) sem preço conhecido ficam fora da soma — o custo real é maior do que o número.`
      : (custoConhecido == null ? 'o saldo ainda não foi lido: o custo é desconhecido, não zero.' : 'preços do catálogo — é uma conta, não uma fatura.'),
    limites: linhas.map((l) => ({ id: l.id, nome: l.nome, limites: l.limites })),
    linhasConta,
  };
}

/**
 * A fila rápida: as decisões que uma pessoa tem de tomar, com UMA acção
 * principal por item — no telemóvel, com um dedo e o polegar. É a mesma
 * matéria da `filaDeAprovacao` do painel, mas arrumada para agir, não para ler.
 */
export function filaRapida({ mensagens = [], tarefas = [], pedidos = [] } = {}) {
  const out = [];
  for (const m of Array.isArray(mensagens) ? mensagens : []) {
    if (!m || !m.id) continue;
    if (!['rascunho', 'ensaio', 'aprovada'].includes(m.status)) continue;
    out.push({
      tipo: 'mensagem', id: m.id,
      titulo: texto(m.subject) || `Mensagem para ${texto(m.lead?.name) || 'um lead'}`,
      detalhe: m.status === 'aprovada' ? 'aprovada — falta enviar' : m.status === 'ensaio' ? 'em ensaio — não sai' : 'rascunho por aprovar',
      canal: texto(m.channel) || 'email',
      accao: m.status === 'aprovada' ? 'enviar' : 'aprovar',
      rotuloAccao: m.status === 'aprovada' ? 'Enviar' : 'Aprovar',
      sensivel: true,
      quando: m.created_at || m.quando || null,
    });
  }
  for (const t of Array.isArray(tarefas) ? tarefas : []) {
    if (!t || !t.id || t.state !== 'awaiting_approval') continue;
    out.push({
      tipo: 'tarefa', id: t.id,
      titulo: texto(t.title) || texto(t.tipo) || 'tarefa à espera',
      detalhe: 'correu e espera o teu OK',
      canal: null, accao: 'aprovar-tarefa', rotuloAccao: 'Aprovar', sensivel: true,
      quando: t.created_at || t.quando || null,
    });
  }
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    if (!p || !p.id) continue;
    out.push({
      tipo: 'pedido', id: p.id, titulo: texto(p.titulo) || texto(p.subject) || 'decisão à espera',
      detalhe: texto(p.detalhe) || 'pedido do sistema', canal: null,
      accao: 'abrir', rotuloAccao: 'Abrir', sensivel: true, quando: p.quando || null,
    });
  }
  return out.sort((a, b) => String(b.quando || '').localeCompare(String(a.quando || '')));
}

/** O que a barra de fundo do telemóvel mostra: uma frase e uma acção. */
export function barraDeAprovacao(fila = []) {
  const lista = Array.isArray(fila) ? fila : [];
  if (!lista.length) return { total: 0, principal: null, frase: 'Nada à tua espera — podes fechar a mesa.' };
  const primeiro = lista[0];
  return {
    total: lista.length,
    principal: primeiro,
    frase: lista.length === 1
      ? `1 decisão à tua espera: ${primeiro.titulo}`
      : `${lista.length} decisões à tua espera — a primeira é «${primeiro.titulo}»`,
  };
}

/**
 * Os cartões do painel móvel. Cada um responde a uma pergunta com um número que
 * existe (nunca estimado): o que corre, o que espera, o que falhou, o que custa.
 */
export function cartoesDoPainel({ tarefas = [], mensagens = [], motores = null, consumo = null, autonomia = null } = {}) {
  const ts = Array.isArray(tarefas) ? tarefas : [];
  const conta = (estado) => ts.filter((t) => t && t.state === estado).length;
  const espera = filaRapida({ mensagens, tarefas: ts }).length;
  const cartoes = [
    { id: 'a-correr', rotulo: 'A correr', valor: conta('running'), nota: 'tarefas em execução agora', ir: '#/tarefas' },
    { id: 'espera', rotulo: 'À espera de ti', valor: espera, nota: espera ? 'decisões que travam trabalho' : 'nada travado', ir: '#/hoje', destaque: espera > 0 },
    { id: 'falhou', rotulo: 'Falhou', valor: conta('failed'), nota: conta('failed') ? 'com motivo escrito e acção de recuperação' : 'nenhuma falha', ir: '#/tarefas' },
    { id: 'motores', rotulo: 'Motores prontos', valor: motores ? motores.resumo.prontos : null, nota: motores ? motores.resumo.frase : 'estado ainda por ler', ir: '#/motores' },
    { id: 'autonomia', rotulo: 'Sem pedir OK', valor: autonomia ? autonomia.autonomos : null, nota: autonomia ? `${autonomia.total} tipo(s) avaliados` : 'autonomia por ler', ir: '#/motores' },
    {
      id: 'custo', rotulo: 'Gasto em APIs',
      valor: consumo && consumo.custoCentimos != null ? consumo.custoCentimos : null,
      tipo: 'centimos',
      nota: consumo ? consumo.nota : 'saldo por ler',
      ir: '#/saldo',
    },
  ];
  return cartoes;
}

/** O resumo da autonomia (quantos tipos em cada nível) a partir dos registos. */
export function resumoDaAutonomia(registos = []) {
  const lista = (Array.isArray(registos) ? registos : []).map((r) => nivelDeAutonomia(r));
  const por = (n) => lista.filter((x) => x.nivel === n).length;
  return {
    total: lista.length,
    pedemSempre: por('pedir_sempre'),
    propostos: por('proposto'),
    autonomos: por('autonomo'),
    lista,
    frase: !lista.length ? 'Nenhum tipo avaliado — tudo pede autorização.'
      : `${por('autonomo')} autónomo(s) · ${por('proposto')} a propor · ${por('pedir_sempre')} pedem sempre`,
  };
}

/** Movimento reduzido: respeitado a sério, não só no CSS. */
export function movimentoReduzido(matchMedia) {
  try {
    return typeof matchMedia === 'function' && !!matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}
