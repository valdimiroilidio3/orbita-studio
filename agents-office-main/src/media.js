/* ===========================================================================
   1.54.3 · A MÍDIA NA MESA (2 nov 2026)

   A área onde o briefing deixa de ser texto e passa a haver imagem e vídeo —
   dentro do projeto, ligada à lead, com o custo à vista antes de gastar.

   Regras que este ficheiro não quebra:

     · ANTES DE GASTAR, DIZ-SE. A estimativa aparece primeiro; o botão de gerar
       só abre depois de a estimativa existir, e a geração tem de ser confirmada.
       Um custo desconhecido diz «desconhecido» — não se inventa um número.

     · O TRABALHO NÃO PRENDE A PÁGINA. Criar devolve logo; o estado vive na base
       e é consultado em ciclo. Mudar de página, recarregar ou fechar o browser
       não perde nada: ao voltar, o estado está lá.

     · O VÍDEO É COMPOSTO AQUI, E DIZ-SE QUE É. Não há vídeo generativo
       gratuito no servidor: compõe-se no browser com as imagens do projeto e o
       progresso mostrado é o dos fotogramas — um número real, não um enfeite.

     · É CONTEÚDO DE IA, E ISSO VIAJA COM A PEÇA. Tudo nasce «conceito»; só o
       dono o passa a «aprovado para uso». A etiqueta está no cartão e no
       detalhe, não escondida num rodapé.
   =========================================================================== */

import { planoDoVideo, renderizarVideo, resumoDoVideo } from './estudio-video.js';
/* 3 nov 2026 · gerar com custo desconhecido pergunta-se no diálogo da casa, não no `confirm` */
import { confirmar } from './confirmar.js';

const E = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function estadoNovo(projetoId = null) {
  return {
    projetoId,
    dados: null,
    aCarregar: false,
    erro: null,
    tipo: 'imagem',
    prompt: '',
    formato: null,
    resolucao: '1024',
    duracao: 6,
    movimento: 'kenburns',
    estimativa: null,
    aEstimar: false,
    aGerar: false,
    aviso: null,
    compor: null,        // { id, progresso, total, nota }
    poll: null,
    detalhe: null,
  };
}

const activas = (lista = []) => lista.filter((g) => g.estado === 'aguardando' || g.estado === 'em_processamento');

/* ---------------------------------------------------------------------------
   1 · LER
   ------------------------------------------------------------------------ */
export async function carregarMedia(api, projetoId, { forcar = false } = {}) {
  const S = api.S;
  if (!projetoId) return null;
  if (!S.media || S.media.projetoId !== projetoId) S.media = estadoNovo(projetoId);
  const M = S.media;
  if (!forcar && M.dados && M.projetoId === projetoId) return M;
  M.aCarregar = !M.dados;
  M.erro = null;
  try {
    M.dados = await api.call(`/ops/projetos/${encodeURIComponent(projetoId)}/media`);
    M.semBase = false;
  } catch (e) {
    M.dados = null;
    M.erro = e?.message || 'não consegui abrir a área de mídia';
    M.semBase = !!(e && (e.local || /modo local|base de dados|ainda não faz/i.test(M.erro)));
  } finally {
    M.aCarregar = false;
  }
  return M;
}

/** Só o estado dos trabalhos — é isto que o ciclo pede de 2,5 em 2,5 segundos. */
export async function actualizarMedia(api) {
  const M = api.S?.media;
  if (!M?.projetoId) return null;
  try {
    M.dados = await api.call(`/ops/projetos/${encodeURIComponent(M.projetoId)}/media`);
    M.erro = null;
  } catch (e) {
    M.erro = e?.message || 'perdi a ligação à área de mídia';
  }
  return M;
}

/* ---------------------------------------------------------------------------
   2 · O QUE O ECRÃ MOSTRA (puro, para se poder testar)
   ------------------------------------------------------------------------ */
export function resumoDoTrabalho(g = {}) {
  const c = g.custo || {};
  const valor = c.estimado === null || c.estimado === undefined
    ? (c.confiavel === false ? 'custo desconhecido' : '—')
    : (c.estimado === 0 ? 'gratuito' : `≈ ${Number(c.estimado).toFixed(2)} ${c.moeda || 'USD'}`);
  return {
    custoTxt: valor,
    quando: g.criado ? new Date(g.criado) : null,
    tipoTxt: g.tipo === 'video' ? 'vídeo' : 'imagem',
  };
}

export function podeConfirmar(M) {
  return !!M?.estimativa && !M.aGerar && String(M.prompt || '').trim().length >= 12;
}

export function textoDaEstimativa(custo = {}) {
  if (!custo || custo.valor === undefined) return 'sem estimativa';
  if (custo.confiavel === false || custo.valor === null) {
    return 'custo desconhecido — este fornecedor não tem preço configurado; confirmar é aceitar um valor que não se pode estimar';
  }
  if (custo.valor === 0) return 'gratuito (0,00) — o fornecedor não cobra por esta geração';
  return `≈ ${Number(custo.valor).toFixed(2)} ${custo.moeda || 'USD'} — estimativa, não é um valor garantido`;
}

function opcoesDoTipo(M) {
  const op = M?.dados?.opcoes || {};
  return M?.tipo === 'video' ? (op.video || {}) : (op.imagem || {});
}

/* ---------------------------------------------------------------------------
   3 · A VISTA
   ------------------------------------------------------------------------ */
export function vistaMedia(S, { projeto = null, tipoFixo = null, semCabeca = false } = {}) {
  const M = S?.media;
  if (!M) return '';
  const d = M.dados;
  /* 1.57.0 · a página do projeto tem as abas «Imagens» e «Vídeo»: quando ela
     manda o tipo, a vista obedece — sem interruptor próprio (dois pares de abas
     iguais na mesma página era ruído) e com a galeria só desse tipo. */
  const tipo = tipoFixo === 'video' ? 'video' : tipoFixo === 'imagem' ? 'imagem' : M.tipo;

  if (M.aCarregar && !d) {
    return `<section class="card md-card" id="md"><div class="skeleton">a abrir a mídia do projeto…</div></section>`;
  }

  if (M.erro && !d) {
    return `<section class="card md-card" id="md">
      <div class="md-cabeca"><div><div class="md-sobre">Mídia do projeto</div><h3>${E(projeto?.name || 'Projeto')}</h3></div></div>
      <div class="md-aviso mau" role="alert"><b>Não consegui abrir a mídia.</b><span>${E(M.erro)}</span></div>
      <div class="hint">${M.semBase
        ? 'Sem base de dados ligada, a mesa guarda no browser — e o browser não gera ficheiros nem guarda bytes. Liga a base (SUPABASE_URL + SUPABASE_SECRET_KEY) para gerar aqui.'
        : 'O resto do projeto continua acessível. Tenta outra vez.'}</div>
      <div class="acts"><button class="btn primary" data-act="md-recarregar">Tentar outra vez</button></div>
    </section>`;
  }

  const todas = d?.geracoes || [];
  const lista = tipoFixo ? todas.filter((g) => g.tipo === tipoFixo) : todas;
  if (tipoFixo) M.tipo = tipo;
  const emCurso = activas(lista);
  const op = opcoesDoTipo(M);
  const formatos = op.formatos || [];
  const formato = M.formato || formatos[0]?.id || null;
  const uso = d?.uso || {};
  const limites = d?.limites || {};

  const cabeca = semCabeca ? '' : `<div class="md-cabeca">
    <div>
      <div class="md-sobre">Mídia do projeto</div>
      <h3>${E(projeto?.name || d?.projeto?.nome || 'Projeto')}</h3>
      <div class="md-min">${d?.projeto?.leadId ? `<a href="#/lead/${encodeURIComponent(d.projeto.leadId)}">ver a lead</a> · ` : ''}${lista.length} peça(s) · ${uso.hoje ?? 0}/${limites.porDia ?? '—'} hoje</div>
    </div>
    <button class="btn quiet small" data-act="md-recarregar">Actualizar</button>
  </div>`;

  const avisos = [
    M.aviso ? `<div class="md-aviso ${M.aviso.mau ? 'mau' : ''}" role="${M.aviso.mau ? 'alert' : 'status'}"><b>${E(M.aviso.titulo || 'Nota')}</b><span>${E(M.aviso.texto)}</span></div>` : '',
    d?.avisoIA ? `<div class="md-ia"><span class="tag md-tag-ia">conteúdo de IA</span> ${E(d.avisoIA)}</div>` : '',
    d?.armazem && d.armazem.tipo === 'memoria' ? `<div class="md-aviso"><b>Os ficheiros não estão num armazém.</b><span>${E(d.armazem.porque || 'sem SUPABASE_URL: ficam neste processo e perdem-se num arranque')}</span></div>` : '',
    uso.motivo ? `<div class="md-aviso mau"><b>Limite.</b><span>${E(uso.motivo)}</span></div>` : '',
  ].join('');

  const formulario = `<div class="md-form">
    ${tipoFixo ? '' : `<div class="md-tipos" role="tablist" aria-label="tipo de mídia">
      <button class="md-tipo ${M.tipo === 'imagem' ? 'on' : ''}" data-act="md-tipo" data-tipo="imagem" role="tab" aria-selected="${M.tipo === 'imagem'}">Imagem</button>
      <button class="md-tipo ${M.tipo === 'video' ? 'on' : ''}" data-act="md-tipo" data-tipo="video" role="tab" aria-selected="${M.tipo === 'video'}">Vídeo</button>
    </div>`}

    ${(d?.prompts || []).length ? `<label class="md-lab" for="md-prompt">Partir de um prompt do briefing</label>
      <select class="md-sel" data-act="md-prompt-fonte" id="md-prompt">
        <option value="">— escrever de raiz —</option>
        ${d.prompts.map((p) => `<option value="${E(p.id)}" ${M.promptFonte === p.id ? 'selected' : ''}>${E(p.finalidade)}</option>`).join('')}
      </select>` : ''}

    <label class="md-lab" for="md-texto">Prompt ${tipo === 'video' ? '(o que move a câmara)' : '(o que se vê)'}</label>
    <textarea class="md-area" id="md-texto" data-md="prompt" rows="4" placeholder="${tipo === 'video'
      ? 'movimento lento sobre o interior da clínica, luz de manhã, sem texto no ecrã'
      : 'interior de clínica dentária, luz de janela, madeira clara, sem texto na imagem'}">${E(M.prompt)}</textarea>

    <div class="md-opcoes">
      <div>
        <label class="md-lab" for="md-formato">Proporção</label>
        <select class="md-sel" data-act="md-opcao" data-campo="formato" id="md-formato">
          ${formatos.map((f) => `<option value="${E(f.id)}" ${formato === f.id ? 'selected' : ''}>${E(f.rotulo)} · ${E(f.id)}</option>`).join('')}
        </select>
      </div>
      ${tipo === 'imagem' ? `<div>
        <label class="md-lab" for="md-resolucao">Resolução</label>
        <select class="md-sel" data-act="md-opcao" data-campo="resolucao" id="md-resolucao">
          ${(op.resolucoes || []).map((r) => `<option value="${E(r.id)}" ${M.resolucao === r.id ? 'selected' : ''}>${E(r.rotulo)}</option>`).join('')}
        </select>
      </div>` : `<div>
        <label class="md-lab" for="md-duracao">Duração</label>
        <select class="md-sel" data-act="md-opcao" data-campo="duracao" id="md-duracao">
          ${(op.duracoes || []).map((x) => `<option value="${x.id}" ${Number(M.duracao) === x.id ? 'selected' : ''}>${E(x.rotulo)} · ${E(x.nota)}</option>`).join('')}
        </select>
      </div>
      <div>
        <label class="md-lab" for="md-movimento">Câmara</label>
        <select class="md-sel" data-act="md-opcao" data-campo="movimento" id="md-movimento">
          ${(op.movimentos || []).map((x) => `<option value="${E(x.id)}" ${M.movimento === x.id ? 'selected' : ''}>${E(x.rotulo)}</option>`).join('')}
        </select>
      </div>`}
    </div>

    <div class="md-custo ${M.estimativa ? (M.estimativa.confiavel === false ? 'incerto' : '') : ''}" id="md-custo" role="status">
      <div class="md-custo-t">${M.aEstimar ? 'a calcular…' : (M.estimativa ? E(M.estimativa.rotulo || textoDaEstimativa(M.estimativa)) : 'Ainda sem estimativa')}</div>
      <div class="md-custo-n">${M.estimativa ? E(M.estimativa.nota || '') : 'A estimativa aparece antes de gerar; o valor final é do fornecedor, não nosso.'}</div>
      ${M.estimativa?.factores?.length ? `<div class="md-custo-f">${M.estimativa.factores.map((f) => `<span>${E(f)}</span>`).join('')}</div>` : ''}
    </div>

    <div class="acts md-acts">
      <button class="btn ghost" data-act="md-estimar" ${M.aEstimar ? 'disabled aria-busy="true"' : ''}>${M.estimativa ? 'Recalcular estimativa' : 'Ver estimativa'}</button>
      <button class="btn primary" data-act="md-gerar" ${podeConfirmar(M) ? '' : 'disabled'}>${M.aGerar
        ? 'a criar…'
        : (tipo === 'video' ? 'Confirmar e compor o vídeo' : 'Confirmar e gerar a imagem')}</button>
      ${M.estimativa ? `<button class="btn quiet" data-act="md-limpar">Limpar</button>` : ''}
    </div>
    <div class="hint">${tipo === 'video'
      ? 'O vídeo é composto NESTE browser com as imagens já geradas do projeto (Ken Burns). Não é vídeo generativo de um fornecedor de IA — e por isso não custa nada. Se fechares a página, a peça fica «à espera» e podes retomá-la.'
      : 'A imagem é gerada no servidor (Pollinations) e guardada no armazém do Órbita: fica ligada a este projeto, à lead e a ti.'}</div>
  </div>`;

  const curso = emCurso.length ? `<div class="md-curso">
    ${emCurso.map((g) => {
      const comp = M.compor && M.compor.id === g.id ? M.compor : null;
      const pct = comp?.progresso !== null && comp?.progresso !== undefined ? Math.round(comp.progresso * 100) : null;
      return `<div class="md-curso-linha"><span class="tag md-tag-${E(g.estadoCls)}">${E(g.estadoTxt)}</span>
        <span class="md-curso-t">${E(g.tipo === 'video' ? 'vídeo' : 'imagem')} · ${E(String(g.prompt).slice(0, 70))}</span>
        ${comp ? `<span class="md-pct">${pct === null ? 'a compor…' : `${pct}%`}</span>` : ''}
        <button class="btn quiet small" data-act="md-cancelar" data-id="${E(g.id)}" ${g.podeCancelar ? '' : 'disabled'}>Cancelar</button></div>`;
    }).join('')}
  </div>` : '';

  const galeria = lista.length ? `<div class="md-galeria">
    ${lista.map((g) => cartao(g, M)).join('')}
  </div>` : `<div class="md-vazio">
    <b>Ainda não há peças neste projeto.</b>
    <span>Escolhe um prompt do briefing (ou escreve um), vê a estimativa e confirma. A primeira imagem fica ligada à lead e ao projeto.</span>
  </div>`;

  return `<section class="card md-card" id="md">
    ${cabeca}
    ${avisos}
    ${formulario}
    ${curso}
    ${galeria}
  </section>`;
}

function cartao(g, M) {
  const r = resumoDoTrabalho(g);
  const aberto = M.detalhe === g.id;
  const media = g.ficheiro
    ? (g.tipo === 'video'
      ? `<video class="md-fig" src="${E(g.ficheiro.ver)}" controls playsinline preload="metadata" aria-label="vídeo gerado para este projeto"></video>`
      : `<img class="md-fig" src="${E(g.ficheiro.ver)}" alt="conceito visual gerado por IA para este projeto" loading="lazy">`)
    : `<div class="md-fig md-fig-vazio"><span>${g.estado === 'falhou' ? 'falhou' : g.estado === 'cancelada' ? 'cancelada' : 'à espera'}</span></div>`;

  const forma = g.ficheiro?.largura && g.ficheiro?.altura
    ? (g.ficheiro.altura > g.ficheiro.largura ? 'retrato' : (Math.abs(g.ficheiro.largura - g.ficheiro.altura) < 40 ? 'quadrado' : ''))
    : '';
  return `<article class="md-item ${g.estado === 'falhou' ? 'mau' : ''}">
    <div class="md-fig-caixa ${forma}">${media}</div>
    <div class="md-item-corpo">
      <div class="md-item-topo">
        <span class="tag md-tag-${E(g.estadoCls)}">${E(g.estadoTxt)}</span>
        <span class="tag md-class-${E(g.classificacaoCls)}">${E(g.classificacaoTxt)}</span>
        <span class="md-item-tipo">${E(r.tipoTxt)}</span>
      </div>
      <p class="md-item-p">${E(String(g.prompt).slice(0, 160))}${String(g.prompt).length > 160 ? '…' : ''}</p>
      <div class="md-item-sub">${E(r.custoTxt)} · ${E(g.fornecedor)}${g.ficheiro ? ` · ${(g.ficheiro.bytes / 1024).toFixed(0)} KB` : ''}${g.ficheiro?.largura ? ` · ${g.ficheiro.largura}×${g.ficheiro.altura}` : ''}</div>
      ${g.erro ? `<div class="md-erro">${E(g.erro)}</div>` : ''}
      ${g.precisaBrowser ? `<div class="hint">à espera do compositor deste browser — carrega em «retomar»</div>` : ''}
      <div class="acts md-item-acts">
        ${g.ficheiro ? `<a class="btn ghost small" href="${E(g.ficheiro.descarregar)}" download>Descarregar</a>` : ''}
        ${g.precisaBrowser ? `<button class="btn primary small" data-act="md-compor" data-id="${E(g.id)}">Retomar o vídeo</button>` : ''}
        ${g.podeRepetir ? `<button class="btn ghost small" data-act="md-repetir" data-id="${E(g.id)}">Gerar outra vez</button>` : ''}
        ${g.ficheiro ? `<button class="btn quiet small" data-act="md-classificar" data-id="${E(g.id)}" data-para="${g.classificacao === 'aprovado' ? 'conceito' : 'aprovado'}">${g.classificacao === 'aprovado' ? 'Marcar como conceito' : 'Aprovar para uso'}</button>` : ''}
        <button class="btn quiet small" data-act="md-detalhe" data-id="${E(g.id)}">${aberto ? 'Fechar' : 'Detalhes'}</button>
      </div>
      ${aberto ? `<dl class="md-det">
        <div><dt>Prompt enviado</dt><dd>${E(g.prompt)}</dd></div>
        <div><dt>Configuração</dt><dd>${E(Object.entries(g.opcoes || {}).map(([k, v]) => `${k} ${v}`).join(' · '))}</dd></div>
        <div><dt>Fornecedor</dt><dd>${E(g.fornecedor)}${g.modelo ? ` · ${E(g.modelo)}` : ''}</dd></div>
        <div><dt>Ligada a</dt><dd>projeto ${E(g.projetoId)}${g.leadId ? ` · lead ${E(g.leadId)}` : ''} · por ${E(g.por || 'mesa')}</dd></div>
        <div><dt>Custo</dt><dd>${E(r.custoTxt)}${g.custo?.nota ? ` — ${E(g.custo.nota)}` : ''}</dd></div>
        <div><dt>Quando</dt><dd>${g.criado ? E(new Date(g.criado).toLocaleString('pt-PT')) : '—'}${g.tentativas ? ` · ${g.tentativas} tentativa(s)` : ''}</dd></div>
      </dl>` : ''}
    </div>
  </article>`;
}

/* ---------------------------------------------------------------------------
   4 · AS ACÇÕES
   ------------------------------------------------------------------------ */
const novaChave = () => `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export async function accaoMedia(name, el, api) {
  const S = api.S;
  const M = S.media;
  if (!M) return false;
  const id = M.projetoId;

  if (name === 'md-recarregar') {
    await carregarMedia(api, id, { forcar: true });
    api.paint();
    return true;
  }
  if (name === 'md-tipo') {
    M.tipo = el?.dataset?.tipo === 'video' ? 'video' : 'imagem';
    M.formato = null;
    M.estimativa = null;
    M.chave = null;
    M.aviso = null;
    api.paint();
    return true;
  }
  if (name === 'md-opcao') {
    const campo = el?.dataset?.campo;
    M[campo] = campo === 'duracao' ? Number(el.value) : el.value;
    M.estimativa = null;
    M.chave = null;
    api.paint();
    return true;
  }
  if (name === 'md-prompt-fonte') {
    const escolhido = el?.value;
    const p = (M.dados?.prompts || []).find((x) => x.id === escolhido);
    M.promptFonte = escolhido || null;
    if (p) M.prompt = p.prompt;
    M.estimativa = null;
    M.chave = null;
    api.paint();
    return true;
  }
  if (name === 'md-limpar') {
    M.estimativa = null;
    M.aviso = null;
    api.paint();
    return true;
  }

  if (name === 'md-estimar' || name === 'md-gerar') {
    if (String(M.prompt || '').trim().length < 12) {
      api.toast('o prompt é curto demais: descreve a cena com pelo menos 12 caracteres', true);
      return true;
    }
    const corpo = {
      tipo: M.tipo, prompt: M.prompt,
      formato: M.formato || (M.dados?.opcoes?.[M.tipo]?.formatos?.[0]?.id),
      resolucao: M.resolucao, duracao: M.duracao, movimento: M.movimento,
    };
    if (name === 'md-estimar') {
      M.aEstimar = true; api.paint();
      try {
        const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/media/estimativa`, 'POST', corpo);
        M.estimativa = r.custo;
        M.uso = r.uso || null;
        M.opcoesEstimadas = r.opcoes;
      } catch (e) {
        M.estimativa = null;
        M.aviso = { titulo: 'Não consegui estimar', texto: e?.message || 'tenta outra vez', mau: true };
      } finally { M.aEstimar = false; api.paint(); }
      return true;
    }

    /* gerar: exige estimativa feita para ESTA configuração e um custo conhecido
       ou confirmado com os olhos abertos */
    if (!M.estimativa) {
      api.toast('vê primeiro a estimativa: nada se gera sem saber quanto é', true);
      return true;
    }
    if (M.estimativa.confiavel === false) {
      const aceita = await confirmar({
        titulo: 'O custo desta geração é desconhecido',
        texto: 'O fornecedor não tem preço configurado para este modelo, por isso não há estimativa. Podes avançar ou escolher outro modelo.',
        confirmar: 'Avançar sem saber o custo', cancelar: 'Voltar',
        perigo: true,
      });
      if (!aceita) return true;
    }
    M.aGerar = true; M.aviso = null; api.paint();
    /* a chave é do PEDIDO, não do clique: dois cliques seguidos (ou uma rede que
       repete) mandam a mesma chave e o servidor devolve o mesmo trabalho — em vez
       de gerar (e cobrar) duas vezes */
    M.chave = M.chave || novaChave();
    try {
      const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/media`, 'POST',
        { ...corpo, confirmado: true, chave: M.chave });
      M.chave = null;
      M.aviso = { titulo: r.repetido ? 'Já existia' : 'Pedido criado', texto: r.aviso || (M.tipo === 'video'
        ? 'o vídeo é composto neste browser assim que estiveres nesta página'
        : 'a imagem está a ser gerada no servidor: o estado actualiza sozinho') };
      await carregarMedia(api, id, { forcar: true });
      const novo = (M.dados?.geracoes || []).find((g) => g.id === r.geracao?.id) || null;
      if (novo?.precisaBrowser) {
        M.aGerar = false; api.paint();
        await comporVideo(api, novo);
        return true;
      }
      iniciarCiclo(api);
    } catch (e) {
      M.aviso = { titulo: 'Não arrancou', texto: e?.message || 'o pedido não passou', mau: true };
    } finally { M.aGerar = false; api.paint(); }
    return true;
  }

  if (name === 'md-cancelar') {
    try {
      await api.call(`/ops/media/${encodeURIComponent(el?.dataset?.id)}/cancelar`, 'POST', {});
      api.toast('cancelada');
      await carregarMedia(api, id, { forcar: true });
    } catch (e) { api.toast(e?.message || 'não consegui cancelar', true); }
    api.paint();
    return true;
  }

  if (name === 'md-repetir') {
    try {
      const r = await api.call(`/ops/media/${encodeURIComponent(el?.dataset?.id)}/repetir`, 'POST', {});
      api.toast(r.aviso || 'nova tentativa criada');
      await carregarMedia(api, id, { forcar: true });
      const novo = (M.dados?.geracoes || []).find((g) => g.id === r.geracao?.id);
      if (novo?.precisaBrowser) { api.paint(); await comporVideo(api, novo); return true; }
      iniciarCiclo(api);
    } catch (e) { api.toast(e?.message || 'não consegui repetir', true); }
    api.paint();
    return true;
  }

  if (name === 'md-classificar') {
    const para = el?.dataset?.para;
    try {
      await api.call(`/ops/media/${encodeURIComponent(el?.dataset?.id)}/classificar`, 'POST', { classificacao: para });
      api.toast(para === 'aprovado' ? 'marcada como aprovada para uso' : 'marcada como conceito de IA');
      await carregarMedia(api, id, { forcar: true });
    } catch (e) { api.toast(e?.message || 'não consegui classificar', true); }
    api.paint();
    return true;
  }

  if (name === 'md-detalhe') {
    const alvo = el?.dataset?.id;
    M.detalhe = M.detalhe === alvo ? null : alvo;
    api.paint();
    return true;
  }

  if (name === 'md-compor') {
    const g = (M.dados?.geracoes || []).find((x) => x.id === el?.dataset?.id);
    if (g) await comporVideo(api, g);
    return true;
  }

  return false;
}

/* ---------------------------------------------------------------------------
   5 · O VÍDEO: compor neste browser e enviar
   ------------------------------------------------------------------------ */
const paraDataUrl = (blob) => new Promise((resolve, reject) => {
  const FR = globalThis.FileReader;
  if (!FR) { reject(new Error('este browser não sabe ler o ficheiro gerado')); return; }
  const r = new FR();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(new Error('o ficheiro gerado não abriu'));
  r.readAsDataURL(blob);
});

export async function comporVideo(api, geracao) {
  const M = api.S?.media;
  if (!M || !geracao) return false;
  const total = geracao.opcoes?.planos || (geracao.fontes || []).length || 2;
  M.compor = { id: geracao.id, progresso: 0, total };
  api.paint();
  try {
    const imagens = [];
    for (const f of geracao.fontes || []) {
      const resp = await fetch(`/api/ficheiro?id=${encodeURIComponent(f.id)}`, { credentials: 'same-origin' });
      if (!resp.ok) continue;
      const blob = await resp.blob();
      imagens.push({ id: f.id, dataUrl: await paraDataUrl(blob), aprovada: f.classificacao === 'aprovado' });
    }
    if (!imagens.length) throw new Error('as imagens deste plano não abriram: gera outra imagem antes de compor');

    const segundos = Number(geracao.opcoes?.duracao || 6);
    const plano = planoDoVideo({
      imagens,
      conceito: String(geracao.prompt || '').slice(0, 200),
      titulo: api.S?.projeto?.name || '',
      maxPlanos: total,
      segundosPorPlano: Math.max(1.4, segundos / Math.max(1, Math.min(total, imagens.length))),
    });
    if (!plano.ok) throw new Error(plano.motivo || 'não há plano para gravar');

    const r = await renderizarVideo({
      plano,
      bitsPorSegundo: 1_200_000,   // ~1,5 MB em 10 s: cabe no pedido e na função
      aoProgresso: (p) => {
        M.compor = { id: geracao.id, progresso: p, total };
        const alvo = globalThis.document && globalThis.document.querySelector('.md-pct');
        if (alvo) alvo.textContent = `${Math.round(p * 100)}%`;
      },
    });
    if (!r.ok) throw new Error(r.motivo || 'o browser não gravou o vídeo');

    const dataUrl = await paraDataUrl(r.blob);
    const envio = await api.call(`/ops/media/${encodeURIComponent(geracao.id)}/ficheiro`, 'POST', {
      ficheiro: { dataUrl, mime: r.mime }, duracao: r.duracao || segundos,
      largura: plano.largura, altura: plano.altura,
    });
    M.aviso = { titulo: 'Vídeo pronto', texto: `${resumoDoVideo({ mime: r.mime, bytes: r.bytes, duracao: r.duracao, ms: r.ms, planos: plano.planos.length })}${envio?.nota ? ` · ${envio.nota}` : ''}` };
    await carregarMedia(api, M.projetoId, { forcar: true });
  } catch (e) {
    M.aviso = { titulo: 'O vídeo não saiu', texto: e?.message || 'a composição falhou neste browser', mau: true };
  } finally {
    M.compor = null;
    api.paint();
  }
  return true;
}

/* ---------------------------------------------------------------------------
   6 · O CICLO (o estado vive na base; o ecrã só pergunta)
   ------------------------------------------------------------------------ */
export function pararCiclo(api) {
  const M = api.S?.media;
  if (M?.poll) { clearInterval(M.poll); M.poll = null; }
}

export function iniciarCiclo(api) {
  const M = api.S?.media;
  if (!M?.projetoId) return;
  pararCiclo(api);
  M.poll = setInterval(async () => {
    const S = api.S;
    if (!S.media || S.media.projetoId !== M.projetoId) { pararCiclo(api); return; }
    await actualizarMedia(api);
    const lista = S.media.dados?.geracoes || [];
    if (S.route?.name === 'projeto' && S.route?.id === S.media.projetoId) api.paint();
    if (!activas(lista).length) {
      pararCiclo(api);
      if (S.media.aviso?.titulo === 'Pedido criado') S.media.aviso = null;
      api.paint();
    }
  }, 2500);
}

/* ---------------------------------------------------------------------------
   7 · ESCREVER NO PROMPT (o texto vive no estado: um repintar não o perde)
   ------------------------------------------------------------------------ */
export function ligarMedia(api) {
  const doc = globalThis.document;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  doc.addEventListener('input', (e) => {
    const t = e.target;
    if (!t?.dataset || t.dataset.md !== 'prompt') return;
    const M = api.S.media;
    if (!M) return;
    M.prompt = t.value;
    /* mudar o prompt invalida a estimativa: não se confirma com o custo de outro texto */
    if (M.estimativa) { M.estimativa = null; }
    M.chave = null;
    const btn = doc.querySelector('[data-act="md-gerar"]');
    if (btn) btn.disabled = !podeConfirmar(M);
  });
}
