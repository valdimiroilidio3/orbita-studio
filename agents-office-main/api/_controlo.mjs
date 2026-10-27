/* ===========================================================================
   1.20.0 · O CENTRO DE CONTROLO (27 out 2026)

   Pedido do dono: «faz com que a aba de Configurações seja um Centro de Controlo
   Inteligente… controlar as seis salas, mudar o tamanho das salas, acrescentar
   agentes onde aumentar o tamanho da sala automaticamente… modelos de IA, APIs,
   execução de tarefas, segurança e mudança de tema». E, acima de tudo: «a aba
   deve distinguir claramente três estados: Configurado, Ligado e A funcionar».

   É essa a regra deste ficheiro. Cada linha que a mesa mostra tem três marcas
   independentes, e nenhuma delas é inventada:

     configurado  existe chave/URL no ambiente ou agente definido
     ligado       o último teste REAL passou (HTTP respondido, não «deve dar»)
     a_funcionar  há execução registada nas últimas 24 h (runs/uso na base)

   Se um estado não pode ser provado, fica `null` — e a interface diz «por provar»
   em vez de pintar um verde que não existe.

   As salas não são copiadas de `src/data.js` para aqui (isso criava duas
   verdades). O cliente manda os `id` das salas; o servidor guarda só os
   AJUSTES (cores e agentes acrescentados) e devolve-os. Quem sabe o nome, a cor
   de origem e a planta é a cena — como sempre foi.
   =========================================================================== */

export const MAX_POR_SALA = 12;
export const MAX_AGENTES_EXTRA = 60;

export const CRESCER_MAX = 20;
export const FUNDO_MAX = 60;

const corValida = (c) => typeof c === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
const texto = (v, max = 60) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** Normaliza o que o cliente guardou. Nunca lança: configuração estragada é ignorada. */
export function limparAjustes(bruto) {
  const base = { cores: {}, agentes: [], tamanhos: {} };
  if (!bruto || typeof bruto !== 'object') return base;

  for (const [dept, cor] of Object.entries(bruto.cores || {})) {
    if (/^[a-z0-9-]{1,20}$/i.test(dept) && corValida(cor)) base.cores[dept] = cor.trim();
  }

  for (const [dept, t] of Object.entries(bruto.tamanhos || {})) {
    if (!/^[a-z0-9-]{1,20}$/i.test(dept) || !t || typeof t !== 'object') continue;
    const limpo = {};
    const w = Number(t.w), d = Number(t.d);
    if (Number.isFinite(w) && w > 0) limpo.w = Math.round(Math.min(Math.max(w, 8), 60) * 10) / 10;
    if (Number.isFinite(d) && d > 0) limpo.d = Math.round(Math.min(Math.max(d, 8), FUNDO_MAX) * 10) / 10;
    if (Object.keys(limpo).length) base.tamanhos[dept] = limpo;
  }

  const vistos = new Set();
  for (const a of Array.isArray(bruto.agentes) ? bruto.agentes : []) {
    if (!a || typeof a !== 'object') continue;
    const id = texto(a.id, 40).toLowerCase().replace(/[^a-z0-9-]/g, '');
    const nome = texto(a.nome, 28);
    const dept = texto(a.dept, 20);
    if (!id || !nome || !dept || vistos.has(id)) continue;
    vistos.add(id);
    base.agentes.push({ id, nome, dept, funcao: texto(a.funcao, 120) || 'Agente acrescentado pelo dono' });
    if (base.agentes.length >= MAX_AGENTES_EXTRA) break;
  }
  return base;
}

/** Acrescenta ou actualiza a cor de uma sala, respeitando os limites. */
export function comCor(ajustes, dept, cor) {
  if (!/^[a-z0-9-]{1,20}$/i.test(String(dept || ''))) return { erro: 'sala inválida' };
  if (!corValida(cor)) return { erro: 'a cor tem de ser hexadecimal (#rrggbb)' };
  return { ajustes: { ...ajustes, cores: { ...ajustes.cores, [dept]: cor.trim() } } };
}

function idDe(nome, existentes) {
  const base = texto(nome, 60).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 18) || 'agente';
  if (!existentes.has(base)) return base;
  for (let i = 2; i < 500; i += 1) if (!existentes.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

/** Junta um agente novo à sala. `porSala` = quantos já lá estão (base + extras). */
export function comAgente(ajustes, { nome, dept, funcao } = {}, porSala = 0) {
  const n = texto(nome, 28);
  const d = texto(dept, 20);
  if (n.length < 2) return { erro: 'o agente precisa de um nome (2 caracteres ou mais)' };
  if (!/^[a-z0-9-]{1,20}$/i.test(d)) return { erro: 'escolhe a sala do agente' };
  const existentes = new Set(ajustes.agentes.map((a) => a.id));
  if (porSala + 1 > MAX_POR_SALA) {
    return { erro: `esta sala está no limite de ${MAX_POR_SALA} agentes — tira um antes de acrescentar outro` };
  }
  const agente = { id: idDe(n, existentes), nome: n, dept: d, funcao: texto(funcao, 120) || 'Agente acrescentado pelo dono' };
  return { ajustes: { ...ajustes, agentes: [...ajustes.agentes, agente] }, agente };
}

/** Tamanho pedido à mão. Nunca abaixo do que a lotação exige (`minimo`). */
export function comTamanho(ajustes, dept, { w, d } = {}, { minimo = 8, base = 8 } = {}) {
  if (!/^[a-z0-9-]{1,20}$/i.test(String(dept || ''))) return { erro: 'sala inválida' };
  const min = Math.max(Number(minimo) || 0, Number(base) || 0, 8);
  const max = Math.min(min + CRESCER_MAX, Math.max(FUNDO_MAX, min));
  const saida = { ...ajustes, tamanhos: { ...ajustes.tamanhos } };
  const actual = { ...(saida.tamanhos[dept] || {}) };
  const nW = Number(w), nD = Number(d);
  if (Number.isFinite(nW) && nW > 0) actual.w = Math.round(Math.min(Math.max(nW, 8), 60) * 10) / 10;
  if (Number.isFinite(nD) && nD > 0) actual.d = Math.round(Math.min(Math.max(nD, min), max) * 10) / 10;
  if (!Object.keys(actual).length) return { erro: 'indica a largura ou a profundidade' };
  saida.tamanhos[dept] = actual;
  return { ajustes: saida, tamanho: actual };
}

export function semAgente(ajustes, id) {
  const alvo = String(id || '');
  const ficam = ajustes.agentes.filter((a) => a.id !== alvo);
  if (ficam.length === ajustes.agentes.length) return { erro: 'agente não encontrado' };
  return { ajustes: { ...ajustes, agentes: ficam } };
}

/** Os três estados de um fornecedor de IA, a partir do que o motor sabe. */
export function estadosDoFornecedor(f) {
  const configurado = !!f.configurado;
  const ligado = configurado && f.ultimoTeste ? !!f.ultimoTeste.ok : null;
  return { configurado, ligado, a_funcionar: null };   // `a_funcionar` só com uso real, abaixo
}

/**
 * Monta o retrato do Centro de Controlo.
 * `motor` pode ser null (sem chaves não há motor) — nesse caso a IA diz que não sabe.
 */
export async function retrato({ repo, motor = null, env = process.env, agora = Date.now() }) {
  const cfg = await repo.ia.config.ler().catch(() => ({}));
  const ajustes = limparAjustes(cfg.salas);

  const uso = await repo.ia.uso.recentes(200).catch(() => []);
  const runs = await repo.ia.runs.listar(30).catch(() => []);
  const desde = agora - 24 * 60 * 60 * 1000;
  const recentes = uso.filter((u) => u.criado && new Date(u.criado).getTime() >= desde);
  const ultima = uso[0]?.criado || null;

  let ia = { pronto: false, conhecido: false, fornecedores: [], funcionais: [], comChave: 0, porTestar: 0 };
  if (motor) {
    const est = await motor.estado();
    const lista = est.fornecedores.map((f) => {
      const e = estadosDoFornecedor(f);
      const usou = recentes.some((u) => u.fornecedor === f.id && u.ok);
      return {
        id: f.id, nome: f.nome, familia: f.familia,
        configurado: e.configurado, ligado: e.ligado, a_funcionar: usou,
        ultimoTeste: f.ultimoTeste ? { ok: !!f.ultimoTeste.ok, quando: f.ultimoTeste.quando, erro: f.ultimoTeste.erro || null, ms: f.ultimoTeste.ms ?? null } : null,
        variavel: f.variavel || null, semChave: !!f.semChave,
      };
    });
    ia = {
      pronto: !!est.diagnostico?.pronto,
      conhecido: true,
      fornecedores: lista,
      comChave: lista.filter((f) => f.configurado).length,
      funcionais: lista.filter((f) => f.ligado).map((f) => f.id),
      porTestar: lista.filter((f) => f.configurado && f.ligado === null).length,
    };
  }

  const runs24 = runs.filter((r) => r.criado && new Date(r.criado).getTime() >= desde);
  const execucao = {
    runs: runs.length,
    runs24h: runs24.length,
    concluidos24h: runs24.filter((r) => r.estado === 'concluido').length,
    falhados24h: runs24.filter((r) => r.estado === 'falhou' || r.estado === 'parcial').length,
    chamadas24h: recentes.length,
    ultimaChamada: ultima,
    ultimoModelo: uso[0]?.modelo || null,
    /* «A funcionar» = houve mesmo trabalho nas últimas 24 h. Sem isso, falso. */
    a_funcionar: runs24.length > 0 || recentes.length > 0,
  };

  const seguranca = {
    /* A base responde sem login: isto é um facto desta instalação, não uma opção. */
    autenticacao: false,
    multiusuario: false,
    aprovacaoHumana: true,      // as ferramentas destrutivas exigem `aprovado`
    chavesNoServidor: true,     // as chaves vivem em env vars, nunca no browser
    nota: 'A base responde sem login: quem souber o endereço entra. Chaves ficam no servidor; acções destrutivas exigem aprovação.',
  };

  /* O REGISTO: quem mudou o quê e quando. Não há utilizadores nesta instalação,
     por isso quem assina é `dono` — é o que a base sabe, e não se inventa outro. */
  const registo = (await repo.atividade.list(60).catch(() => []))
    .filter((a) => a.tipo === 'config')
    .slice(0, 20)
    .map((a) => ({ quando: a.at, quem: 'dono', o_que: a.texto }));

  return { versao: '1.21.0', ajustes, ia, execucao, seguranca, registo, quando: new Date(agora).toISOString(), env: { temChaves: Object.keys(env || {}).length > 3 } };
}
