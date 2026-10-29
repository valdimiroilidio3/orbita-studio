/* ===========================================================================
   1.53.2 · AS TAREFAS CORREM A SÉRIO.

   O que havia até aqui (e o dono viu, e disse «nas tarefas nada funciona»):
   `POST /ops/tarefas` gravava uma linha já com `state: 'failed'` e a frase
   «sem motor de IA ligado a esta base». Era verdade sobre o código, mas não é
   uma tarefa: é uma lápide.

   Agora cada tipo de tarefa tem uma rotina escrita à mão, com o contexto real
   do lead ou do projeto tirado da base, e a resposta vem do motor que já
   responde em `/ia/chat` (a mesma cadeia com fallback, o mesmo registo de uso
   em `/ia/uso`). Sem resposta de nenhum modelo, a tarefa falha e a frase diz
   **o que** faltou — a chave que não está no ambiente, ou o erro real do último
   fornecedor. Nunca se inventa um resultado.

   Regras que este ficheiro cumpre:
     · o resultado é o texto que o modelo devolveu, guardado em `resultado`;
     · se a base ainda não tiver a coluna `resultado` (migração por aplicar),
       o texto vai para a Atividade e a tarefa diz isso — não se perde;
     · `aprovacao: true` corre o trabalho e deixa-o em `awaiting_approval`:
       aprovar fecha como `succeeded`, rejeitar como `cancelled`.
   =========================================================================== */
import { criarMotor } from './_ia/motor.mjs';
import { FORNECEDORES } from './_ia/catalogo.mjs';

/** O que cada tipo de tarefa pede ao modelo. `alvo` diz que contexto é preciso. */
export const ROTINAS = {
  investigar: {
    alvo: 'lead',
    titulo: 'Investigar o lead',
    pedido: (c) => `Investiga este lead, com o que está escrito e nada inventado:

${c}

Responde em português de Portugal, em cinco pontos curtos:
1. O que este negócio faz e para quem.
2. Se tem site e o que isso diz sobre a maturidade digital.
3. O que ainda falta saber antes de falar com ele (lacunas concretas).
4. O problema mais provável que o nosso serviço resolve.
5. A melhor abordagem no primeiro contacto, em duas frases.`,
  },

  mensagem: {
    alvo: 'lead',
    titulo: 'Escrever uma mensagem',
    pedido: (c) => `Escreve a primeira mensagem de WhatsApp para este lead:

${c}

Regras: máximo 90 palavras, português de Portugal, sem promessas de resultados,
sem emojis, uma pergunta concreta no fim. Devolve só a mensagem, pronta a enviar.`,
  },

  briefing: {
    alvo: 'projeto',
    titulo: 'Escrever o briefing',
    pedido: (c) => `Escreve o briefing de arranque deste projeto:

${c}

Estrutura: objetivo (2 frases), público, o que a página tem de fazer, secções
por ordem, provas que faltam pedir ao cliente, e o critério de «está pronto».
Português de Portugal, direto, sem encher.`,
  },

  codigo: {
    alvo: 'projeto',
    titulo: 'Gerar o código',
    pedido: (c) => `Escreve a primeira versão da página deste projeto:

${c}

Devolve um único ficheiro HTML completo, com CSS dentro de <style>, sem
dependências externas, texto em português de Portugal e um formulário de
contacto. Nada de lorem ipsum: usa o que sabes do projeto e marca com
«[a confirmar]» o que não sabes.`,
  },

  qa: {
    alvo: 'projeto',
    titulo: 'Auditoria de qualidade',
    pedido: (c) => `Audita este projeto como se fosses o cliente exigente:

${c}

Devolve uma lista de verificações com ✅ ou ❌ e uma frase cada: promessa clara,
prova social, chamada à ação, telemóvel, velocidade, acessibilidade básica,
contacto visível, e o que falta para poder ser entregue. Termina com
«entregável hoje: sim/não» e o motivo.`,
  },
};

const corta = (s, n) => String(s ?? '').slice(0, n);
const agoraIso = () => new Date().toISOString();

/** O contexto que vai no pedido: só campos que existem na base, sem adornos. */
export function contextoLead(l = {}) {
  return [
    `Nome: ${l.name || '(sem nome)'}`,
    l.category && `Categoria: ${l.category}`,
    l.city && `Cidade: ${l.city}`,
    l.phone && `Telefone: ${l.phone}`,
    l.email && `Email: ${l.email}`,
    l.website ? `Website: ${l.website}` : 'Website: não tem (ou não é conhecido)',
    l.notes && `Notas: ${l.notes}`,
    l.status && `Estado na mesa: ${l.status}`,
  ].filter(Boolean).join('\n');
}

export function contextoProjeto(p = {}) {
  return [
    `Projeto: ${p.name || '(sem nome)'}`,
    p.client && `Cliente: ${p.client}`,
    p.niche && `Nicho: ${p.niche}`,
    p.city && `Cidade: ${p.city}`,
    p.kind && `Tipo: ${p.kind}`,
    p.status && `Estado: ${p.status}`,
  ].filter(Boolean).join('\n');
}

/**
 * Que chaves faltam no ambiente — nomes de variáveis, nunca valores.
 * Serve para a frase de erro dizer o que se pode fazer, em vez de «falhou».
 */
export function chavesEmFalta(env = {}) {
  const faltam = [];
  for (const [id, f] of Object.entries(FORNECEDORES)) {
    if (f.usavel === false || f.keyless || f.chavePublica) continue;
    const tem = (f.chave || []).some((k) => env[k] && String(env[k]).trim().length >= 8);
    if (!tem) faltam.push({ fornecedor: id, variavel: (f.chave || [])[0] || null });
  }
  return faltam;
}

/** Os fornecedores que este ambiente consegue usar (chave, sem chave, ou pública). */
export function fornecedoresProntos(env = {}) {
  const prontos = [];
  for (const [id, f] of Object.entries(FORNECEDORES)) {
    if (f.usavel === false) continue;
    const temChave = (f.chave || []).some((k) => env[k] && String(env[k]).trim().length >= 8);
    if (temChave) prontos.push({ fornecedor: id, via: 'chave' });
    else if (f.keyless || f.chavePublica) prontos.push({ fornecedor: id, via: 'sem chave' });
  }
  return prontos;
}

/**
 * A frase honesta quando nenhum modelo respondeu — e a diferença que interessa:
 * se NENHUM fornecedor está configurado, diz qual variável pôr no ambiente; se
 * há fornecedores prontos, não se inventa uma chave em falta, mostra-se o erro
 * real do último que tentou.
 */
export function motivoSemMotor(erro = null, env = {}) {
  const prontos = fornecedoresProntos(env);
  const comChave = prontos.filter((p) => p.via === 'chave').map((p) => p.fornecedor);
  const semChave = prontos.filter((p) => p.via !== 'chave').map((p) => p.fornecedor);
  const cauda = erro?.message ? ` Última tentativa: ${corta(erro.message, 240)}.` : '';
  if (!comChave.length) {
    const nomes = chavesEmFalta(env).slice(0, 3).map((f) => f.variavel).join(', ');
    const tentou = semChave.length ? ` e os fornecedores sem chave (${semChave.slice(0, 3).join(', ')}) também não responderam` : '';
    return `nenhuma chave de IA está configurada neste ambiente — põe uma (${nomes})${tentou}.${cauda}`;
  }
  return `nenhum dos fornecedores com chave (${comChave.slice(0, 3).join(', ')}) respondeu apesar de haver chaves configuradas.${cauda}`;
}

/** Lê o alvo da tarefa na base. Devolve `{ ok, texto }` ou `{ ok:false, erro }`. */
async function lerAlvo(repo, tarefa) {
  const id = String(tarefa?.entity_id || tarefa?.entityId || '').trim();
  const entidade = String(tarefa?.entidade || '').trim();
  if (!id) return { ok: true, texto: '(sem alvo ligado — a tarefa trabalha só com o que foi escrito)' };
  if (entidade === 'lead' || id.startsWith('l_') || /^[0-9a-f-]{36}$/i.test(id)) {
    const lead = await repo.leads.byId(id).catch(() => null);
    if (lead) return { ok: true, texto: contextoLead(lead) };
    if (entidade === 'lead' || id.startsWith('l_')) return { ok: false, erro: `não encontrei o lead ${id} nesta base` };
  }
  const projeto = await repo.projetos.byId(id).catch(() => null);
  if (projeto) return { ok: true, texto: contextoProjeto(projeto) };
  return { ok: false, erro: `não encontrei o registo ${id} (nem lead, nem projeto) nesta base` };
}

/**
 * Corre uma tarefa e devolve `{ ok, estado, resultado, modelo, ms, erro }`.
 * Não grava na base: quem chama decide o que fazer com o resultado (é o que
 * permite testar isto sem rede e sem Supabase).
 */
export async function executarTarefa({ repo, tarefa, env = {}, fetchImpl = fetch, motor = null, maxTokens = 900 } = {}) {
  const rotina = ROTINAS[tarefa?.kind];
  if (!rotina) return { ok: false, estado: 'failed', erro: `tipo de tarefa desconhecido: ${tarefa?.kind || '(vazio)'}` };
  const alvo = await lerAlvo(repo, tarefa);
  if (!alvo.ok) return { ok: false, estado: 'failed', erro: alvo.erro };

  const mensagens = [
    { role: 'system', content: 'És um agente da Órbita. Trabalhas com dados reais que te são dados; o que não souberes, dizes que não sabes. Escreves em português de Portugal.' },
    { role: 'user', content: rotina.pedido(alvo.texto) },
  ];

  const t0 = Date.now();
  try {
    const m = motor || criarMotor({ repo, env, fetchImpl });
    const r = await m.pedir('texto', mensagens, { agente: 'orchestrator', maxTokens, temperatura: 0.4 });
    const texto = String(r?.texto || '').trim();
    if (!texto) {
      return { ok: false, estado: 'failed', ms: Date.now() - t0, erro: `${r?.fornec || 'o modelo'}/${r?.modelo || '?'} respondeu sem texto — a tarefa não conta como feita` };
    }
    return {
      ok: true,
      estado: 'succeeded',
      resultado: corta(texto, 12000),
      modelo: `${r.fornec}/${r.modelo}`,
      ms: Date.now() - t0,
      tentativas: r.tentativas || 1,
    };
  } catch (e) {
    return { ok: false, estado: 'failed', ms: Date.now() - t0, erro: motivoSemMotor(e, env) };
  }
}

/**
 * Grava o desfecho na linha da tarefa. Se a coluna `resultado` ainda não
 * existir (migração `supabase/orbita_1_53_2.sql` por aplicar), guarda o texto
 * na Atividade e diz na própria tarefa onde ele está — em vez de o perder em
 * silêncio. Devolve a tarefa tal como ficou.
 */
export async function registarDesfecho(repo, tarefa, r, { aprovacao = false } = {}) {
  const campos = {
    state: r.ok ? (aprovacao ? 'awaiting_approval' : 'succeeded') : 'failed',
    error: r.ok ? null : corta(r.erro || 'sem motivo', 500),
    finished_at: agoraIso(),
  };
  const extras = r.ok ? { resultado: r.resultado, modelo: r.modelo || null } : {};
  try {
    return await repo.tarefas.patch(tarefa.id, { ...campos, ...extras });
  } catch (e) {
    /* a coluna não existe nesta base: guarda o resultado onde ele não se perde */
    if (!r.ok) throw e;
    const nota = `resultado de «${tarefa.kind}» (${r.modelo || 'modelo não identificado'}):\n${corta(r.resultado, 900)}`;
    await repo.atividade.add('tarefa', corta(nota, 1000)).catch(() => null);
    return await repo.tarefas.patch(tarefa.id, {
      ...campos,
      error: 'resultado guardado na Atividade — falta aplicar supabase/orbita_1_53_2.sql para a coluna `resultado`',
    });
  }
}

/** Cria + corre, que é o que o botão «Criar tarefa» faz na mesa. */
export async function criarECorrer({ repo, corpo = {}, env = {}, fetchImpl = fetch, TIPOS = {}, motor = null } = {}) {
  const tipo = String(corpo?.kind || '').trim();
  if (!TIPOS[tipo]) return { status: 400, corpo: { error: 'tipo de tarefa desconhecido' } };
  const entityId = String(corpo?.entityId || '').trim() || null;
  const entidade = String(corpo?.entidade || '').trim() || null;
  const aprovacao = !!corpo?.aprovacao;

  const tarefa = await repo.tarefas.insert({
    kind: tipo, entity_id: entityId, entidade,
    state: 'running', error: null, finished_at: null,
  });
  const r = await executarTarefa({ repo, tarefa, env, fetchImpl, motor });
  const final = await registarDesfecho(repo, tarefa, r, { aprovacao: aprovacao && r.ok });
  await repo.atividade.add('tarefa', r.ok
    ? `${TIPOS[tipo].label}: concluída com ${r.modelo}${aprovacao ? ' (à espera da tua aprovação)' : ''}`
    : `${TIPOS[tipo].label}: não passou — ${corta(r.erro, 200)}`).catch(() => null);
  return { status: 201, corpo: { tarefa: final, execucao: { ok: r.ok, modelo: r.modelo || null, ms: r.ms || 0 } } };
}

/** `POST /ops/tarefas/:id/correr` — repetir uma tarefa que já existe. */
export async function correrDeNovo({ repo, tarefa, env = {}, fetchImpl = fetch, motor = null } = {}) {
  const emCurso = await repo.tarefas.patch(tarefa.id, { state: 'running', error: null, finished_at: null }).catch(() => null);
  const r = await executarTarefa({ repo, tarefa: emCurso || tarefa, env, fetchImpl, motor });
  const final = await registarDesfecho(repo, tarefa, r, { aprovacao: false });
  await repo.atividade.add('tarefa', r.ok
    ? `${tarefa.kind}: repetida e concluída com ${r.modelo}`
    : `${tarefa.kind}: repetida e não passou — ${corta(r.erro, 200)}`).catch(() => null);
  return { status: 200, corpo: { ok: r.ok, tarefa: final, execucao: { ok: r.ok, modelo: r.modelo || null, ms: r.ms || 0 } } };
}
