/* ===========================================================================
   1.48.0 · O CINE — a cara do estúdio (28 out 2026)

   Pedido do dono: ao abrir uma lead, nasce um Master Prompt dela, e dele uma
   peça visual — com um design de nível superior, não um formulário com um botão.

   O que este ecrã faz:
     · ABRE a lead e mostra o que o sistema leu dela (o que se sabe, o que falta);
     · pede o Master Prompt ao servidor — a IA escreve-o; se a IA não responder,
       o plano vem montado por regras e o ecrã DIZ que foi por regras e porquê;
     · gera imagens a sério, com estado de carregamento, tecto de quantidade e os
       erros do fornecedor à vista (nenhum marcador de posição a fazer de imagem);
     · deixa editar o prompt à mão, mudar estilo/formato/modelo, regenerar com a
       mesma semente, aprovar e apagar — e guarda tudo no projecto da lead;
     · diz, sem rodeios, que vídeo ainda não há e o que falta para haver.

   Regras de honestidade que aqui se aplicam:
     · uma imagem a carregar é um esqueleto animado, nunca uma imagem de exemplo;
     · «aprovada» só aparece depois de um clique e de o servidor confirmar;
     · quando o servidor recusa, mostra-se o código e a frase dele.
   =========================================================================== */

const escPadrao = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** O estado inicial de uma visita ao Cine (nunca partilhado entre leads). */
function estadoNovo() {
  return {
    leadId: null, chave: null,
    aCarregar: true, aPreparar: false, aGerar: false,
    estado: null, projeto: null, analise: null,
    brief: { objetivo: '', estilo: null, formato: '16:9', plataforma: '', tom: '', quantidade: 1, publico: '' },
    erro: null, aviso: null, textoAberto: false, promptEditado: null,
    lista: null, semProjeto: false,
  };
}

const modeloPorId = (estado, id) => (estado?.imagem?.modelos || []).find((m) => m.id === id) || (estado?.imagem?.modelos || [])[0] || null;
const formatoPorId = (estado, id) => (estado?.formatos || []).find((f) => f.id === id) || (estado?.formatos || [])[2] || null;
const estiloPorId = (estado, id) => (estado?.estilos || []).find((e) => e.id === id) || null;

/** Lê o estado e o projecto de uma lead. Não lança por 404: um projecto vazio é normal. */
export async function carregarCine(api, leadId = null) {
  if (!api.S.cine || api.S.cine.leadId !== leadId) api.S.cine = estadoNovo();
  const S = api.S.cine;
  S.leadId = leadId;
  S.aCarregar = true;
  S.erro = null;
  try {
    if (!S.estado) S.estado = await api.call('/cine/estado');
  } catch (e) {
    S.erro = `não consegui ler o estado do estúdio: ${e.message}`;
  }
  if (leadId) {
    try {
      S.projeto = (await api.call(`/cine/projeto?leadId=${encodeURIComponent(leadId)}`)).projeto;
      S.analise = S.analise || null;
      if (S.projeto?.brief) S.brief = { ...S.brief, ...S.projeto.brief };
      if (S.projeto?.master?.formato) S.brief.formato = S.projeto.master.formato;
      if (S.projeto?.master?.estilo) S.brief.estilo = S.projeto.master.estilo;
      S.semProjeto = false;
    } catch (e) {
      /* 404 = ainda não há trabalho. É o caso normal de uma lead nova. */
      S.projeto = null;
      S.semProjeto = /404|não tem trabalho/i.test(String(e.message || ''));
      if (!S.semProjeto) S.erro = `não consegui abrir o projecto: ${e.message}`;
    }
    if (!S.projeto) {
      try {
        const r = await api.call('/cine/abrir', 'POST', { leadId });
        S.analise = r.analise || null;
        S.chave = r.chave || null;
        S.projeto = r.projeto || null;
        if (r.estilos && !S.estado?.estilos) S.estado = { ...(S.estado || {}), estilos: r.estilos, formatos: r.formatos, imagem: { ...(S.estado?.imagem || {}), modelos: r.modelos } };
      } catch (e) {
        S.erro = `não consegui abrir o Cine desta lead: ${e.message}`;
      }
    }
  } else {
    try {
      S.lista = (await api.call('/cine/projetos')).projetos || [];
    } catch (e) {
      S.lista = [];
      S.erro = `não consegui ler os projectos: ${e.message}`;
    }
  }
  S.aCarregar = false;
  return S;
}

/** Pede o Master Prompt (IA primeiro, regras depois) e guarda-o no projecto. */
export async function prepararCine(api) {
  const S = api.S.cine;
  if (!S?.leadId) return;
  S.aPreparar = true;
  S.erro = null;
  api.paint();
  try {
    const r = await api.call('/cine/preparar', 'POST', { leadId: S.leadId, brief: S.brief });
    if (!r.ok) throw new Error(r.erro || 'o servidor não conseguiu preparar o plano');
    S.projeto = r.projeto;
    S.analise = r.analise || S.analise;
    S.chave = r.chave;
    S.promptEditado = null;
    S.semProjeto = false;
    const via = r.versao?.via === 'ia'
      ? `Master Prompt escrito por ${r.ia?.fornec || 'IA'}/${r.ia?.modelo || '—'}`
      : `Master Prompt montado por regras — ${r.ia?.motivo || 'a IA não respondeu'}`;
    api.toast(`${via}${r.aviso ? ` · ${r.aviso}` : ''}`);
    if (r.aviso) S.aviso = r.aviso;
  } catch (e) {
    S.erro = `o plano não ficou pronto: ${e.message}`;
  }
  S.aPreparar = false;
  api.paint();
}

/** Gera as imagens pedidas. O tecto e a conta são do servidor. */
export async function gerarCineUI(api) {
  const S = api.S.cine;
  if (!S?.leadId || S.aGerar) return;
  if (!S.projeto?.master) { api.toast('primeiro o Master Prompt', true); return; }
  S.aGerar = true;
  S.erro = null;
  api.paint();
  try {
    const r = await api.call('/cine/gerar', 'POST', {
      leadId: S.leadId, quantidade: Number(S.brief.quantidade) || 1,
      modelo: S.brief.modelo || null, seed: S.brief.seed ?? null,
      prompt: S.promptEditado || null,
    });
    if (r.projeto) S.projeto = r.projeto;
    if (!r.ok) {
      const detalhe = (r.tentativas || []).map((x) => `${x.via}: ${x.erro}`).join(' · ');
      S.erro = `${r.erro || 'a imagem não veio'}${detalhe ? ` (${detalhe})` : ''}`;
      api.toast('a geração falhou — a razão está no painel', true);
    } else {
      const faltaram = r.falhadas ? ` · ${r.falhadas} não vieram` : '';
      api.toast(`${r.geradas} imagem(ns) prontas${faltaram}${r.aviso ? ` · ${r.aviso}` : ''}`);
    }
  } catch (e) {
    S.erro = `a geração não correu: ${e.message}`;
  }
  S.aGerar = false;
  api.paint();
}

export async function aprovarCine(api, imagemId) {
  const S = api.S.cine;
  try {
    const r = await api.call('/cine/aprovar', 'POST', { leadId: S.leadId, imagemId });
    if (!r.ok) throw new Error(r.erro || 'não consegui aprovar');
    S.projeto = r.projeto;
    api.toast('aprovada — fica no projecto desta lead');
  } catch (e) {
    api.toast(`nada aprovado: ${e.message}`, true);
  }
  api.paint();
}

export async function apagarImagemCine(api, imagemId) {
  const S = api.S.cine;
  try {
    const r = await api.call('/cine/apagar', 'POST', { leadId: S.leadId, imagemId });
    if (!r.ok) throw new Error(r.erro || 'não consegui apagar');
    S.projeto = r.projeto;
    api.toast('apagada');
  } catch (e) {
    api.toast(`não apaguei nada: ${e.message}`, true);
  }
  api.paint();
}

/** A promessa do vídeo: ou há worker, ou diz-se o que falta. Nunca um player falso. */
export async function tentarVideoCine(api) {
  const S = api.S.cine;
  try {
    const r = await api.call('/cine/video', 'POST', { leadId: S.leadId });
    if (!r.ok) {
      S.aviso = r.motivo || 'o vídeo ainda não está disponível';
      api.toast('vídeo: ainda não há como — a razão está no painel', true);
    } else {
      S.aviso = `trabalho enviado ao worker (${r.estado}). O ficheiro aparece quando renderizar.`;
      api.toast('vídeo enviado ao worker');
    }
  } catch (e) {
    S.aviso = `o vídeo não arrancou: ${e.message}`;
    api.toast(S.aviso, true);
  }
  api.paint();
}

/* ---------------------------- a vista ---------------------------------- */

function chips(itens, classe = '') {
  return itens.map((i) => `<span class="cine-chip ${classe}">${escPadrao(i)}</span>`).join('');
}

function passos(S) {
  const temLeitura = !!S.analise;
  const temMaster = !!S.projeto?.master;
  const temImagem = (S.projeto?.imagens || []).some((i) => !i.falhou);
  const temAprovada = !!S.projeto?.aprovada;
  const actual = !temLeitura ? 0 : !temMaster ? 1 : !temImagem ? 2 : !temAprovada ? 3 : 4;
  const nomes = ['Leitura', 'Master Prompt', 'Geração', 'Aprovação'];
  const feitos = [temLeitura, temMaster, temImagem, temAprovada];
  return `<ol class="cine-passos" aria-label="fases do projecto">
    ${nomes.map((n, i) => `<li class="${feitos[i] ? 'feito' : i === actual ? 'agora' : ''}">
      <span class="cine-ponto" aria-hidden="true">${feitos[i] ? '✓' : i + 1}</span><span>${escPadrao(n)}</span></li>`).join('')}
  </ol>`;
}

function cabecalho(S) {
  const l = S.projeto?.lead || {};
  const a = S.analise || S.projeto?.master?.analise || {};
  const master = S.projeto?.master;
  const via = master?.via === 'ia'
    ? `<span class="cine-selo ia">Master Prompt · ${escPadrao(master.fornec || 'IA')}/${escPadrao(master.modelo || '—')}${master.ms ? ` · ${Math.round(master.ms / 100) / 10} s` : ''}</span>`
    : master
      ? `<span class="cine-selo regra" title="${escPadrao(master.motivo || '')}">Master Prompt · por regras</span>`
      : '<span class="cine-selo">à espera do primeiro plano</span>';
  return `<header class="cine-hero">
    <div class="cine-hero-luz" aria-hidden="true"></div>
    <div class="cine-hero-topo">
      <a class="cine-voltar" href="#/leads">‹ Leads</a>
      ${via}
    </div>
    <h1>${escPadrao(l.name || 'nova peça')}</h1>
    <p class="cine-sub">${escPadrao([l.category, l.city].filter(Boolean).join(' · ') || 'sem nicho nem cidade')}${l.rating ? ` · ${Number(l.rating).toFixed(1)} ★` : ''}${a.universo ? ` — ${escPadrao(a.universo.split(',')[0])}` : ''}</p>
    ${passos(S)}
  </header>`;
}

function cartaoLeitura(S) {
  const a = S.analise || S.projeto?.master?.analise;
  if (!a) return '';
  const faltam = (a.faltam || []).filter((f) => f !== 'contacto' || true);
  return `<section class="cine-card" aria-labelledby="cine-l1">
    <div class="cine-card-h"><h2 id="cine-l1">O que o sistema leu</h2><span class="cine-min">sem rede, antes de gastar um pedido</span></div>
    <p class="cine-leitura">${escPadrao(a.universo || '')} <span class="cine-min">${escPadrao(a.gestos || '')}</span></p>
    <div class="cine-chips">${chips(a.fortes || [], 'bom')}</div>
    ${faltam.length ? `<div class="cine-chips">${chips(faltam, 'falta')}</div>
      <p class="cine-min">Falta: ${escPadrao(faltam.join(', '))}. Não inventamos nenhum destes — o plano fica sem eles.</p>` : ''}
    ${a.impeditivo ? `<p class="cine-alerta">${escPadrao(a.impeditivo)}</p>` : ''}
  </section>`;
}

function cartaoMaster(S) {
  const m = S.projeto?.master;
  if (!m) {
    return `<section class="cine-card cine-vazio">
      <h2>Master Prompt</h2>
      <p>Ainda não há plano para esta lead. É um pedido: o sistema lê a ficha, escolhe a direcção de arte e escreve o conceito, a narrativa e o prompt de imagem.</p>
      <button class="cine-btn primario" data-act="cine-preparar" ${S.aPreparar ? 'disabled' : ''}>
        ${S.aPreparar ? 'a escrever o plano…' : 'Escrever o Master Prompt'}
      </button>
      ${S.aPreparar ? '<div class="cine-skeleton alto" aria-live="polite"></div>' : ''}
    </section>`;
  }
  const s = m.seccoes || {};
  const f = s.fotografia || {};
  const linhas = [
    ['Conceito', s.conceito],
    ['Direcção de arte', s.direcaoArte],
    ['Fotografia', [f.estilo, f.lente, f.luz, f.profundidade].filter(Boolean).join(' · ')],
    ['Composição', s.composicao],
    ['Narrativa', s.narrativa],
    ['Tom emocional', s.emocao],
  ];
  const texto = m.prompts?.imagem || '';
  return `<section class="cine-card" aria-labelledby="cine-m1">
    <div class="cine-card-h">
      <h2 id="cine-m1">Master Prompt</h2>
      <div class="cine-acts-min">
        <button class="cine-link" data-act="cine-toggle-texto">${S.textoAberto ? 'fechar texto' : 'ver em texto'}</button>
        <button class="cine-link" data-act="cine-repreparar">${S.aPreparar ? 'a reescrever…' : 'reescrever'}</button>
      </div>
    </div>
    ${m.via === 'regra' && m.motivo ? `<p class="cine-alerta suave">Escrito por regras: ${escPadrao(m.motivo)}</p>` : ''}
    <dl class="cine-seccoes">${linhas.filter(([, v]) => v).map(([k, v]) => `<div><dt>${escPadrao(k)}</dt><dd>${escPadrao(v)}</dd></div>`).join('')}</dl>
    <div class="cine-restricoes">
      <h3>Restrições</h3>
      <ul>${(s.restricoes || []).map((r) => `<li>${escPadrao(r)}</li>`).join('')}</ul>
      ${(s.evitar || []).length ? `<h3>Evitar</h3><div class="cine-chips">${chips(s.evitar, 'falta')}</div>` : ''}
    </div>
    ${S.textoAberto ? `<pre class="cine-pre">${escPadrao(texto)}</pre>` : ''}
  </section>`;
}

function cartaoControles(S) {
  const e = S.estado || {};
  const formatos = e.formatos || [];
  const estilos = e.estilos || [];
  const modelos = e.imagem?.modelos || [];
  const modelo = modeloPorId(e, S.brief.modelo);
  return `<section class="cine-card" aria-labelledby="cine-g1">
    <div class="cine-card-h"><h2 id="cine-g1">Gerar</h2>
      <span class="cine-min">${modelos.length} modelo(s) sem custo · a chave do dono, quando existe, vai à frente</span></div>
    <label class="cine-fld"><span>Objectivo desta peça</span>
      <textarea class="cine-in" id="cineObjetivo" rows="2" placeholder="ex.: encher a agenda de Setembro com limpezas dentárias">${escPadrao(S.brief.objetivo || '')}</textarea></label>
    <div class="cine-grupo">
      <span class="cine-rotulo">Direcção de arte</span>
      <div class="cine-pills" role="radiogroup" aria-label="direcção de arte">
        ${estilos.map((x) => `<button role="radio" aria-checked="${S.brief.estilo === x.id}" class="cine-pill ${S.brief.estilo === x.id ? 'on' : ''}" data-act="cine-estilo" data-id="${escPadrao(x.id)}" title="${escPadrao(x.nota)}">${escPadrao(x.nome)}</button>`).join('')}
      </div>
    </div>
    <div class="cine-duo">
      <label class="cine-fld"><span>Formato</span>
        <select class="cine-in" id="cineFormato">
          ${formatos.map((f) => `<option value="${escPadrao(f.id)}"${S.brief.formato === f.id ? ' selected' : ''}>${escPadrao(f.rotulo)} · ${f.largura}×${f.altura} — ${escPadrao(f.uso)}</option>`).join('')}
        </select></label>
      <label class="cine-fld"><span>Modelo</span>
        <select class="cine-in" id="cineModelo">
          ${modelos.map((m) => `<option value="${escPadrao(m.id)}"${modelo?.id === m.id ? ' selected' : ''}>${escPadrao(m.rotulo)} — ${escPadrao(m.nota)}</option>`).join('')}
        </select></label>
    </div>
    <div class="cine-duo">
      <label class="cine-fld"><span>Quantas</span>
        <select class="cine-in" id="cineQuantidade">
          ${[1, 2, 3, 4].map((n) => `<option value="${n}"${Number(S.brief.quantidade) === n ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>
      <label class="cine-fld"><span>Plataforma</span>
        <input class="cine-in" id="cinePlataforma" value="${escPadrao(S.brief.plataforma || '')}" placeholder="Instagram, site, imprensa…"></label>
    </div>
    <div class="cine-acts">
      <button class="cine-btn primario" data-act="cine-gerar" ${S.aGerar || !S.projeto?.master ? 'disabled' : ''}>
        ${S.aGerar ? 'a gerar…' : 'Gerar imagem'}
      </button>
      <button class="cine-btn" data-act="cine-guardar-prompt">Usar o meu prompt</button>
    </div>
    <label class="cine-fld"><span>Prompt de imagem (podes editá-lo)</span>
      <textarea class="cine-in mono" id="cinePrompt" rows="3" placeholder="vazio = usa o prompt do Master Prompt">${escPadrao(S.promptEditado ?? '')}</textarea></label>
    ${S.aGerar ? `<div class="cine-galeria">${'<div class="cine-skeleton"></div>'.repeat(Number(S.brief.quantidade) || 1)}</div>` : ''}
    ${S.erro ? `<p class="cine-alerta">${escPadrao(S.erro)}</p>` : ''}
    <p class="cine-min">${modelo ? escPadrao(`${modelo.rotulo}: ${modelo.nota}`) : ''}</p>
  </section>`;
}

function cartaoGaleria(S) {
  const imgs = (S.projeto?.imagens || []).filter((i) => !i.falhou);
  if (!imgs.length) return '';
  return `<section class="cine-card" aria-labelledby="cine-gal">
    <div class="cine-card-h"><h2 id="cine-gal">Peças</h2><span class="cine-min">${imgs.length} · ${imgs.filter((i) => i.aprovada).length} aprovada(s)</span></div>
    <div class="cine-galeria">
      ${imgs.map((i) => `<figure class="cine-fig ${i.aprovada ? 'aprovada' : ''}">
        ${i.dataUrl
          ? `<img src="${i.dataUrl}" alt="peça gerada para ${escPadrao(S.projeto?.lead?.name || 'esta lead')}" loading="lazy" decoding="async">`
          : `<div class="cine-sem-bytes"><b>sem bytes guardados</b><span>a mesma semente volta a gerá-la: ${escPadrao(i.seed ?? '—')}</span></div>`}
        <figcaption>
          <span class="cine-min">${escPadrao((i.modelo || '').split('/').pop() || 'modelo')} · ${i.ms ? `${Math.round(i.ms / 100) / 10} s` : ''} · semente ${escPadrao(i.seed ?? '—')}</span>
          <span class="cine-acts-min">
            ${i.aprovada ? '<span class="cine-selo ok">aprovada</span>' : `<button class="cine-link" data-act="cine-aprovar" data-id="${escPadrao(i.id)}">aprovar</button>`}
            ${i.dataUrl ? `<a class="cine-link" href="/api/cine-imagem?leadId=${encodeURIComponent(S.projeto?.lead?.id || S.leadId || '')}&imagemId=${encodeURIComponent(i.id)}&descarregar=1" download>guardar</a>` : ''}
            <button class="cine-link perigo" data-act="cine-apagar" data-id="${escPadrao(i.id)}">apagar</button>
          </span>
        </figcaption>
      </figure>`).join('')}
    </div>
  </section>`;
}

function cartaoVideo(S) {
  const v = S.estado?.video;
  if (!v) return '';
  return `<section class="cine-card cine-video" aria-labelledby="cine-v1">
    <div class="cine-card-h"><h2 id="cine-v1">Vídeo cinematográfico</h2>
      <span class="cine-selo ${v.worker?.vivo ? 'ok' : 'regra'}">${v.worker?.vivo ? 'worker vivo' : 'ainda não há como'}</span></div>
    <p class="cine-leitura">${escPadrao(v.motivo || 'o worker está vivo: o trabalho entra na fila do estúdio')}</p>
    <div class="cine-tabela">
      ${(v.modelos || []).map((m) => `<div class="cine-linha"><b>${escPadrao(m.rotulo)}</b><span>${escPadrao(m.nota)}</span><span class="cine-min">pago · créditos Pollen</span></div>`).join('')}
    </div>
    <div class="cine-acts">
      <button class="cine-btn" data-act="cine-video" ${v.worker?.vivo ? '' : 'disabled'}>${v.worker?.vivo ? 'Enviar ao estúdio' : 'Enviar ao estúdio (indisponível)'}</button>
    </div>
    <p class="cine-min">O botão só faz alguma coisa quando há um caminho real: o worker do OpenMontage a correr numa máquina com Python e FFmpeg. Enquanto não houver, o prompt de vídeo do Master Prompt fica guardado e pronto a usar.</p>
  </section>`;
}

function cartaoHistorico(S) {
  const h = S.projeto?.historico || [];
  if (!h.length) return '';
  return `<section class="cine-card" aria-labelledby="cine-h1">
    <div class="cine-card-h"><h2 id="cine-h1">Histórico</h2><span class="cine-min">${h.length} entrada(s)</span></div>
    <ol class="cine-tempo">${h.slice(0, 12).map((x) => `<li class="cine-tipo-${escPadrao(x.tipo)}"><span class="cine-min">${escPadrao(String(x.quando || '').slice(11, 16))}</span> ${escPadrao(x.resumo || x.tipo)}</li>`).join('')}</ol>
  </section>`;
}

function vistaLista(S) {
  const lista = S.lista || [];
  const total = (S.estado?.arquivo?.imagens || 0);
  return `<div class="wrap cine">
    <header class="cine-hero pequeno">
      <div class="cine-hero-luz" aria-hidden="true"></div>
      <h1>Cine</h1>
      <p class="cine-sub">Um lead, um projecto criativo: Master Prompt próprio, direcção de arte e peças geradas. ${S.estado?.arquivo?.projetos || 0} lead(s) com trabalho · ${total} imagem(ns).</p>
    </header>
    ${S.erro ? `<p class="cine-alerta">${escPadrao(S.erro)}</p>` : ''}
    ${lista.length ? `<div class="cine-grelha">${lista.map((p) => `<a class="cine-mini" href="#/cine/${escPadrao(p.chave)}">
      ${(p.capa || p.aprovada)?.dataUrl
        ? `<img src="${(p.capa || p.aprovada).dataUrl}" alt="" loading="lazy" decoding="async">`
        : '<div class="cine-mini-vazio">ainda sem peça</div>'}
      <div class="cine-mini-txt"><b>${escPadrao(p.lead?.name || p.chave)}</b>
        <span class="cine-min">${escPadrao([p.lead?.category, p.lead?.city].filter(Boolean).join(' · ') || 'sem nicho')} · ${p.imagens} peça(s)${p.aprovada ? ' · uma aprovada' : ''}${p.temMaster ? ` · ${p.via === 'ia' ? 'plano por IA' : 'plano por regras'}` : ''}</span>
        ${p.conceito ? `<span class="cine-conceito">${escPadrao(String(p.conceito).slice(0, 110))}…</span>` : ''}
      </div></a>`).join('')}</div>`
      : `<div class="cine-card cine-vazio"><h2>Ainda sem projectos</h2>
        <p>O Cine começa num lead: abre um e o sistema lê-o, escolhe a direcção de arte e escreve o Master Prompt. Só depois se gera.</p>
        <div class="cine-acts"><a class="cine-btn primario" href="#/leads">Ver os leads</a></div></div>`}
  </div>`;
}

/** A vista inteira. `S` é o estado da mesa; `opcoes.leadId` diz de que lead. */
export function vistaCine(S, { esc = escPadrao, leadId = null } = {}) {
  const C = S.cine || estadoNovo();
  if (!leadId && !C.leadId) {
    return vistaLista({ ...C, estado: C.estado || null }, esc);
  }
  if (C.aCarregar && !C.projeto) {
    return `<div class="wrap cine"><div class="cine-hero pequeno"><div class="cine-skeleton alto"></div></div></div>`;
  }
  return `<div class="wrap cine">
    ${cabecalho(C)}
    ${C.erro ? `<p class="cine-alerta">${escPadrao(C.erro)}</p>` : ''}
    ${C.aviso ? `<p class="cine-alerta suave">${escPadrao(C.aviso)}</p>` : ''}
    ${cartaoLeitura(C)}
    ${cartaoMaster(C)}
    ${C.projeto?.master ? cartaoControles(C) : ''}
    ${cartaoGaleria(C)}
    ${cartaoVideo(C)}
    ${cartaoHistorico(C)}
  </div>`;
}

/* --------------------------- as acções -------------------------------- */

function lerControles(api) {
  const S = api.S.cine;
  if (!S) return;
  const obj = globalThis.document?.getElementById?.('cineObjetivo');
  const fmt = globalThis.document?.getElementById?.('cineFormato');
  const mod = globalThis.document?.getElementById?.('cineModelo');
  const qtd = globalThis.document?.getElementById?.('cineQuantidade');
  const plat = globalThis.document?.getElementById?.('cinePlataforma');
  const prm = globalThis.document?.getElementById?.('cinePrompt');
  if (obj) S.brief.objetivo = obj.value;
  if (fmt) S.brief.formato = fmt.value;
  if (mod) S.brief.modelo = mod.value;
  if (qtd) S.brief.quantidade = Number(qtd.value) || 1;
  if (plat) S.brief.plataforma = plat.value;
  if (prm) S.promptEditado = String(prm.value || '').trim() || null;
}

/**
 * Trata uma acção do Cine. Devolve `true` quando a acção era dela — o mesmo
 * contrato do `accaoPapel`, para o mesa.js não precisar de saber pormenores.
 */
export async function accaoCine(nome, el, api) {
  const n = String(nome || '');
  if (!n.startsWith('cine-')) return false;
  const S = api.S.cine;
  if (!S) return false;
  switch (n) {
    case 'cine-preparar':
    case 'cine-repreparar':
      lerControles(api);
      await prepararCine(api);
      return true;
    case 'cine-estilo':
      S.brief.estilo = el?.dataset?.id || null;
      api.paint();
      return true;
    case 'cine-guardar-prompt': {
      lerControles(api);
      api.toast(S.promptEditado ? 'a geração vai usar o teu prompt' : 'a geração volta a usar o Master Prompt');
      api.paint();
      return true;
    }
    case 'cine-gerar':
      lerControles(api);
      await gerarCineUI(api);
      return true;
    case 'cine-aprovar':
      await aprovarCine(api, el?.dataset?.id);
      return true;
    case 'cine-apagar':
      await apagarImagemCine(api, el?.dataset?.id);
      return true;
    case 'cine-toggle-texto':
      S.textoAberto = !S.textoAberto;
      api.paint();
      return true;
    case 'cine-video':
      await tentarVideoCine(api);
      return true;
    default:
      return false;
  }
}

/** Liga os campos que não são botões: guardam-se ao sair, sem repintar. */
export function ligarCine(api, { rota = null } = {}) {
  const doc = globalThis.document;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  doc.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.id || !String(t.id).startsWith('cine')) return;
    if (!api.S.cine || (rota && rota() !== 'cine')) return;
    lerControles(api);
  });
}
