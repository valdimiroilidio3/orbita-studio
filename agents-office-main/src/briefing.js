/* ===========================================================================
   1.54.2 · O BRIEFING NA MESA (2 nov 2026)

   O ecrã onde nasce o trabalho de um projeto: o briefing editável, o Prompt
   Master e os prompts de imagem — três abas dentro do projeto, ligadas à lead
   e ao projeto.

   Regras que este ficheiro não quebra:

     · O QUE VEM DA LEAD ESTÁ MARCADO. Cada campo diz a sua origem: «da lead»,
       «sugerido pela IA» ou «escrito por ti». Um campo vazio diz «não
       informado» — não se enche para parecer completo.

     · GERAR USA O QUE ESTÁ GUARDADO. Se houver alterações por gravar, o botão
       de gerar pede primeiro para gravar. Assim o Prompt Master e os prompts
       de imagem nunca são feitos a partir de um texto que ninguém confirmou.

     · REGENERAR NÃO APAGA. A versão anterior fica no histórico, diz-se quantas
       existem e pode repor-se. Antes de regenerar, o ecrã diz isso.

     · DESACTUALIZADO É UMA FRASE, NÃO UM SEGREDO. Se o briefing mudou depois
       de o Prompt Master (ou os prompts de imagem) terem sido escritos, a aba
       mostra o aviso e o botão para gerar outra vez.

     · NENHUMA IMAGEM É GERADA AQUI. Os prompts de imagem são prompts, e os
       que descrevem pessoas ou instalações reais estão marcados como conceito
       visual com a instrução de os substituir por material da lead.
   =========================================================================== */

const E = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ABAS = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'master', label: 'Prompt Master' },
  { id: 'imagens', label: 'Imagens' },
];

const BADGE = {
  lead: { txt: 'da lead', cls: 'lead' },
  ia: { txt: 'sugerido pela IA', cls: 'ia' },
  manual: { txt: 'escrito por ti', cls: 'manual' },
};

export function estadoNovo(projetoId = null) {
  return {
    projetoId,
    aba: 'briefing',
    aCarregar: false,
    erro: null,
    semBase: false,
    dados: null,
    campos: [],
    valores: {},
    origens: {},
    base: null,
    sujo: false,
    aGerar: null,          // 'rascunho' | 'master' | 'imagens'
    aGravar: false,        // uma gravação de cada vez (dois toques não são duas)
    aviso: null,           // { texto, mau }
    versoes: null,         // { master: [], imagens: [] }
    aCarregarVersoes: false,
    semRegisto: false,
  };
}

/* ---------------------------------------------------------------------------
   1 · LER
   ------------------------------------------------------------------------ */
export async function carregarBriefing(api, projetoId, { forcar = false } = {}) {
  const S = api.S;
  if (!projetoId) return null;
  if (!S.briefing || S.briefing.projetoId !== projetoId) S.briefing = estadoNovo(projetoId);
  const B = S.briefing;
  if (!forcar && B.dados && B.projetoId === projetoId) return B;
  B.aCarregar = true;
  B.erro = null;
  try {
    const r = await api.call(`/ops/projetos/${encodeURIComponent(projetoId)}/briefing`);
    B.dados = r;
    B.campos = r.campos || [];
    B.valores = { ...(r.briefing?.valores || {}) };
    B.origens = { ...(r.briefing?.origens || {}) };
    B.base = r.briefing?.hash || null;
    B.sujo = false;
    B.semRegisto = !!r.semRegisto;
    B.semBase = false;
  } catch (e) {
    B.dados = null;
    B.erro = e?.message || 'não consegui ler o briefing';
    /* 501 = modo local (o browser não é uma base de dados). É uma limitação,
       não uma avaria — e diz-se com essas palavras. */
    B.semBase = !!(e && (e.local || /ainda não faz|modo local|base de dados/i.test(B.erro)));
  } finally {
    B.aCarregar = false;
  }
  return B;
}

/* ---------------------------------------------------------------------------
   2 · CONTAS DE ORIGEM (puras, para se poderem testar)
   ------------------------------------------------------------------------ */
export function resumoOrigens(valores = {}, origens = {}) {
  const conta = { lead: 0, ia: 0, manual: 0, vazios: 0 };
  for (const [id, v] of Object.entries(valores || {})) {
    if (!String(v ?? '').trim()) { conta.vazios += 1; continue; }
    const o = origens?.[id];
    conta[o === 'lead' || o === 'ia' ? o : 'manual'] += 1;
  }
  return conta;
}

export function rotuloOrigem(id, valores = {}, origens = {}) {
  if (!String(valores?.[id] ?? '').trim()) return { txt: 'não informado', cls: 'vazio' };
  return BADGE[origens?.[id]] || BADGE.manual;
}

/** Há matéria suficiente para o Prompt Master? (nome + uma coisa concreta) */
export function podeGerar(valores = {}) {
  const v = (id) => String(valores?.[id] ?? '').trim();
  return !!v('empresa') && ['objetivo', 'descricao', 'produtos', 'publico', 'valor'].some((id) => v(id));
}

/** Sair da página com alterações por gravar pede confirmação. */
export function podeSair(api, destino = null) {
  const B = api?.S?.briefing;
  if (!B || !B.sujo) return true;
  if (destino && destino.name === 'projeto' && destino.id === B.projetoId) return true;
  const perguntar = globalThis.confirm;
  const ok = typeof perguntar === 'function'
    ? perguntar('Tens alterações no briefing por gravar. Sair sem gravar?')
    : true;
  if (ok) { B.sujo = false; B.valores = { ...(B.dados?.briefing?.valores || {}) }; B.origens = { ...(B.dados?.briefing?.origens || {}) }; }
  return ok;
}

const fromUnix = (iso) => {
  const d = new Date(iso || 0);
  if (Number.isNaN(d.getTime()) || !iso) return '';
  return d.toLocaleString('pt-PT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/* ---------------------------------------------------------------------------
   3 · A VISTA
   ------------------------------------------------------------------------ */
function abaBtn(B, id, label) {
  const on = B.aba === id;
  return `<button type="button" class="bf-aba${on ? ' on' : ''}" role="tab" aria-selected="${on}" id="bfAba-${id}" aria-controls="bfPainel" data-act="bf-aba" data-aba="${id}">${E(label)}</button>`;
}

function estadoVia(via, motivo) {
  if (via === 'ia') return '<span class="tag cliente">escrito pela IA</span>';
  if (via === 'nenhuma') return '<span class="tag">sem alterações</span>';
  return `<span class="tag contactado" title="${E(motivo || '')}">montado por regras</span>`;
}

function avisoDesactualizado(B, tipo) {
  const d = B.dados?.desactualizado || {};
  if (!d[tipo]) return '';
  return `<div class="bf-aviso" role="status">
    <b>O briefing mudou depois de isto ter sido escrito.</b>
    <span>${tipo === 'master' ? 'O Prompt Master' : 'Os prompts de imagem'} podem estar desactualizados. Gera outra vez para ficarem iguais ao briefing guardado — a versão anterior fica no histórico.</span>
  </div>`;
}

function camposHTML(B) {
  if (!B.campos.length) return '<div class="hint">os campos do briefing não chegaram do servidor</div>';
  return `<div class="bf-campos">${B.campos.map((c) => {
    const valor = B.valores[c.id] ?? '';
    const r = rotuloOrigem(c.id, B.valores, B.origens);
    const vazio = !String(valor).trim();
    const linhas = c.tipo === 'longo' ? 3 : 1;
    const campo = c.tipo === 'longo'
      ? `<textarea class="in bf-in${vazio ? ' vazio' : ''}" rows="${linhas}" data-campo="${E(c.id)}" id="bf-${E(c.id)}" maxlength="4000" placeholder="não informado — escreve aqui ou pede à IA um rascunho" aria-label="${E(c.label)}">${E(valor)}</textarea>`
      : `<input class="in bf-in${vazio ? ' vazio' : ''}" type="text" data-campo="${E(c.id)}" id="bf-${E(c.id)}" maxlength="4000" placeholder="não informado" aria-label="${E(c.label)}" value="${E(valor)}">`;
    return `<div class="bf-campo" data-origem="${E(r.cls)}">
      <div class="bf-campo-h"><label for="bf-${E(c.id)}">${E(c.label)}</label><span class="tag bf-badge ${E(r.cls)}">${E(r.txt)}</span></div>
      ${campo}
      <div class="bf-ajuda">${E(c.ajuda || '')}</div>
    </div>`;
  }).join('')}</div>`;
}

function painelBriefing(B, S) {
  const conta = resumoOrigens(B.valores, B.origens);
  const gravado = B.dados?.briefing?.gravadoEm ? fromUnix(B.dados.briefing.gravadoEm) : null;
  const pode = podeGerar(B.valores);
  return `<div id="bfPainel" role="tabpanel" aria-labelledby="bfAba-briefing">
    <div class="bf-barra">
      <div class="bf-contas">
        <span><b>${conta.lead}</b> da lead</span>
        <span><b>${conta.ia}</b> da IA</span>
        <span><b>${conta.manual}</b> escritos por ti</span>
        <span><b>${conta.vazios}</b> não informados</span>
      </div>
      <div class="bf-estado">${B.sujo
        ? '<span class="tag contactado">alterações por gravar</span>'
        : (gravado ? `<span class="tag">gravado ${E(gravado)}</span>` : '<span class="tag">por gravar</span>')}</div>
    </div>
    ${B.semRegisto ? '<div class="hint">Este projeto ainda não tinha briefing guardado: o que vês vem da ficha da lead. Grava para começar.</div>' : ''}
    ${camposHTML(B)}
    <div class="acts bf-acts">
      <button class="btn ghost" data-act="bf-descartar"${B.sujo ? '' : ' disabled'}>Descartar</button>
      <button class="btn ghost" data-act="bf-rascunho"${B.aGerar ? ' disabled' : ''}>${B.aGerar === 'rascunho' ? 'A IA está a escrever…' : 'Rascunho da IA'}</button>
      <button class="btn ghost" data-act="bf-guardar"${B.sujo && !B.aGravar ? '' : ' disabled'}>${B.aGravar ? 'A gravar…' : (B.sujo ? 'Salvar' : 'Salvo')}</button>
      <button class="btn primary" data-act="bf-master"${B.aGerar ? ' disabled' : ''} title="escreve o Prompt Master a partir do briefing guardado">
        <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z"/><path d="M18 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z"/></svg>
        ${B.aGerar === 'master' ? 'A gerar…' : 'Gerar Prompt Master'}
      </button>
      ${B.dados?.master || B.dados?.imagens ? `<button class="btn quiet small" data-act="bf-rascunho-tudo"${B.aGerar ? ' disabled' : ''} title="a IA reescreve os campos que ela própria sugeriu; o que escreveste fica">Reescrever sugestões</button>` : ''}
    </div>
    <div class="hint">O rascunho da IA só preenche campos vazios e só com o que a ficha da lead sustenta. Podes escrever tudo à mão — o projeto não depende da IA.${pode ? '' : ' Para o Prompt Master precisas do nome da empresa e de pelo menos o objetivo, a descrição, os produtos, o público ou a proposta de valor.'}</div>
  </div>`;
}

function painelMaster(B) {
  const m = B.dados?.master || null;
  const n = B.dados?.versoes?.master || 0;
  if (!m) {
    return `<div id="bfPainel" role="tabpanel" aria-labelledby="bfAba-master">
      <div class="bf-vazio">
        <h3>Ainda não há Prompt Master</h3>
        <p>Ele é escrito a partir do <b>briefing guardado</b> — não de uma conversa. Se a IA não responder, é montado por regras com os mesmos factos, e o ecrã diz qual dos dois foi.</p>
        <button class="btn primary" data-act="bf-master"${B.aGerar ? ' disabled' : ''}>${B.aGerar === 'master' ? 'A escrever…' : 'Escrever o Prompt Master'}</button>
      </div>
    </div>`;
  }
  return `<div id="bfPainel" role="tabpanel" aria-labelledby="bfAba-master">
    ${avisoDesactualizado(B, 'master')}
    <div class="bf-barra">
      <div class="bf-contas">
        <span>versão <b>${m.versao || 1}</b></span>
        <span>${E(fromUnix(m.criado))}</span>
        <span>${m.modelo ? E(m.modelo) : ''}</span>
      </div>
      <div class="bf-estado">${estadoVia(m.via, m.motivo)}</div>
    </div>
    ${m.via !== 'ia' && m.motivo ? `<div class="hint">Porque não foi a IA: ${E(m.motivo)}</div>` : ''}
    ${(m.avisos || []).length ? `<div class="bf-aviso mau" role="alert"><b>Por confirmar antes de usar.</b><span>Esta versão foi escrita pela IA e menciona ${m.avisos.length === 1 ? 'uma coisa que não consta' : `${m.avisos.length} coisas que não constam`} do briefing: ${E(m.avisos.join(' · '))}. Confirma com o cliente ou retira.</span></div>` : ''}
    <pre class="bf-pre" id="bfMasterTexto">${E(m.texto)}</pre>
    <div class="acts bf-acts">
      <button class="btn primary" data-act="bf-copiar-master">Copiar</button>
      <button class="btn ghost" data-act="bf-master"${B.aGerar ? ' disabled' : ''}>${B.aGerar === 'master' ? 'A escrever…' : 'Gerar outra vez'}</button>
      ${n ? `<button class="btn quiet small" data-act="bf-versoes" data-tipo="master">${B.versoes ? 'Esconder versões' : `Versões anteriores (${n})`}</button>` : ''}
    </div>
    ${B.versoes ? versoesHTML(B, 'master') : ''}
    <div class="hint">Gerar outra vez guarda a versão actual no histórico${n ? ` (${n} guardada${n === 1 ? '' : 's'})` : ''}; nada é apagado.</div>
  </div>`;
}

function promptHTML(p, i) {
  return `<article class="bf-prompt">
    <header><h4>${E(p.finalidade || `Prompt ${i + 1}`)}</h4><span class="tag">${E(p.formato || '')}</span></header>
    <dl class="bf-dl">
      <div><dt>Onde</dt><dd>${E(p.local || 'não indicado')}</dd></div>
      <div><dt>Assunto</dt><dd>${E(p.assunto || '')}</dd></div>
      <div><dt>Composição</dt><dd>${E(p.composicao || '')}</dd></div>
      <div><dt>Direção de arte</dt><dd>${E(p.direcaoArte || '')}</dd></div>
      <div><dt>Restrições</dt><dd>${E(p.restricoes || '')}</dd></div>
    </dl>
    <pre class="bf-pre bf-pre-pequeno" id="bfPrompt-${E(p.id || i)}">${E(p.prompt || '')}</pre>
    <div class="acts bf-acts">
      <button class="btn ghost small" data-act="bf-copiar-prompt" data-id="${E(p.id || i)}">Copiar prompt</button>
    </div>
    ${p.nota ? `<p class="bf-nota">${E(p.nota)}</p>` : ''}
  </article>`;
}

function painelImagens(B) {
  const im = B.dados?.imagens || null;
  const n = B.dados?.versoes?.imagens || 0;
  if (!im) {
    return `<div id="bfPainel" role="tabpanel" aria-labelledby="bfAba-imagens">
      <div class="bf-vazio">
        <h3>Ainda não há prompts de imagem</h3>
        <p>Um conjunto coerente com o briefing e com o Prompt Master: imagem principal, produto ou serviço, institucional e uma de apoio. <b>Nenhuma imagem é gerada aqui</b> — o que sai são prompts para levares ao modelo que escolheres.</p>
        <button class="btn primary" data-act="bf-imagens"${B.aGerar ? ' disabled' : ''}>${B.aGerar === 'imagens' ? 'A escrever…' : 'Escrever os prompts'}</button>
      </div>
    </div>`;
  }
  const prompts = im.prompts || [];
  return `<div id="bfPainel" role="tabpanel" aria-labelledby="bfAba-imagens">
    ${avisoDesactualizado(B, 'imagens')}
    <div class="bf-barra">
      <div class="bf-contas">
        <span><b>${prompts.length}</b> prompts</span>
        <span>${E(fromUnix(im.criado))}</span>
        <span>${im.modelo ? E(im.modelo) : ''}</span>
      </div>
      <div class="bf-estado">${estadoVia(im.via, im.motivo)}</div>
    </div>
    ${im.via !== 'ia' && im.motivo ? `<div class="hint">Porque não foi a IA: ${E(im.motivo)}</div>` : ''}
    <div class="hint">${E(im.nota || 'estes são prompts; nenhuma imagem é gerada nesta etapa')}</div>
    <div class="bf-prompts">${prompts.map(promptHTML).join('')}</div>
    <div class="acts bf-acts">
      <button class="btn primary" data-act="bf-copiar-imagens">Copiar o conjunto</button>
      <button class="btn ghost" data-act="bf-imagens"${B.aGerar ? ' disabled' : ''}>${B.aGerar === 'imagens' ? 'A escrever…' : 'Gerar outra vez'}</button>
      ${n ? `<button class="btn quiet small" data-act="bf-versoes" data-tipo="imagens">${B.versoes ? 'Esconder versões' : `Versões anteriores (${n})`}</button>` : ''}
    </div>
    ${B.versoes ? versoesHTML(B, 'imagens') : ''}
    <div class="hint">Imagens com pessoas ou instalações marcadas como «conceito» não são registo real da empresa: substituem-se por material fornecido pela lead.</div>
  </div>`;
}

function versoesHTML(B, tipo) {
  if (B.aCarregarVersoes) return '<div class="skeleton">a ler as versões anteriores…</div>';
  const lista = (B.versoes && B.versoes[tipo]) || [];
  if (!lista.length) return '<div class="hint">ainda não há versões anteriores</div>';
  return `<div class="bf-versoes"><h4>Versões anteriores de ${tipo === 'master' ? 'Prompt Master' : 'prompts de imagem'}</h4>
    ${lista.map((v) => `<details class="bf-versao">
      <summary>${E(fromUnix(v.criado))}${v.substituidoEm ? ` · substituída ${E(fromUnix(v.substituidoEm))}` : ''} · ${E(v.via === 'ia' ? 'IA' : 'regras')}</summary>
      ${v.texto ? `<pre class="bf-pre bf-pre-pequeno">${E(String(v.texto).slice(0, 4000))}${String(v.texto).length > 4000 ? '\n…' : ''}</pre>` : ''}
      ${v.prompts ? `<div class="hint">${v.prompts.length} prompt(s): ${E(v.prompts.map((p) => p.finalidade).join(' · '))}</div>` : ''}
      <button class="btn ghost small" data-act="bf-restaurar" data-tipo="${tipo}" data-id="${E(v.id)}">Repor esta versão</button>
    </details>`).join('')}
  </div>`;
}

export function vistaBriefing(S, { projeto = null, painel = null, semAbas = false } = {}) {
  const B = S?.briefing;
  if (!B) return '';
  if (B.aCarregar && !B.dados) return '<div class="card bf-card"><div class="skeleton">a abrir o briefing…</div></div>';

  /* Na página do projeto (sem abas internas) o nome já está no cabeçalho da
     página: aqui fica o título da secção e a frase que explica para que serve,
     como na referência. Fora dela, mantém-se a cabeça antiga — é o que os
     testes e as outras chamadas conhecem. */
  const cabeca = semAbas
    ? `<div class="bf-cabeca bf-cabeca-sec">
        <div>
          <h3>Briefing do projeto</h3>
          <p class="bf-min">Defina as informações principais da empresa para orientar a criação com IA.</p>
        </div>
        <div class="bf-cabeca-lado">
          ${B.dados?.leadId ? `<a class="btn quiet small" href="#/lead/${encodeURIComponent(B.dados.leadId)}">Ver a lead</a>` : ''}
        </div>
      </div>`
    : `<div class="bf-cabeca">
    <div>
      <div class="bf-sobre">Briefing do projeto</div>
      <h3>${E(projeto?.name || B.dados?.leadNome || 'Projeto')}</h3>
      <div class="bf-min">${E([projeto?.kind, B.dados?.leadNome].filter(Boolean).join(' · ') || 'ligado à lead')}</div>
    </div>
    ${B.dados?.leadId ? `<a class="btn quiet small" href="#/lead/${encodeURIComponent(B.dados.leadId)}">Ver a lead</a>` : ''}
  </div>`;

  if (B.erro) {
    return `<div class="card bf-card" id="bf">${cabeca}
      <div class="bf-aviso mau" role="alert"><b>Não consegui abrir o briefing.</b><span>${E(B.erro)}</span></div>
      <div class="hint">${B.semBase
        ? 'Este ecrã trabalha sobre a base de dados do Órbita. Nesta instalação os dados ficam no browser (modo local), que ainda não guarda briefings nem chama a IA. O projeto e a lead continuam acessíveis.'
        : 'O projeto continua acessível: podes voltar ao projeto, tentar outra vez, ou preencher o briefing quando a base responder.'}</div>
      <div class="acts bf-acts">
        <button class="btn primary" data-act="bf-recarregar">Tentar outra vez</button>
        ${projeto?.id ? `<a class="btn ghost" href="#/projeto/${encodeURIComponent(projeto.id)}">Voltar ao projeto</a>` : ''}
      </div>
    </div>`;
  }

  const aviso = B.aviso ? `<div class="bf-aviso${B.aviso.mau ? ' mau' : ''}" role="status">${E(B.aviso.texto)}</div>` : '';
  /* 1.57.0 · a página do projeto passou a ter as suas abas (Briefing, Prompt
     Master, Imagens, Vídeo). Quando ela diz qual é o painel, é esse que se
     desenha e a barra interna desaparece — duas barras de abas iguais na mesma
     página eram ruído. Sem essa indicação, tudo fica como antes. */
  const qual = painel || B.aba;
  const corpo = qual === 'master' ? painelMaster(B) : qual === 'imagens' ? painelImagens(B) : painelBriefing(B, S);

  return `<div class="card bf-card" id="bf">
    ${cabeca}
    ${semAbas ? '' : `<div class="bf-abas" role="tablist" aria-label="briefing do projeto">
      ${ABAS.map((a) => abaBtn(B, a.id, a.label)).join('')}
    </div>`}
    ${aviso}
    ${corpo}
  </div>`;
}

/* ---------------------------------------------------------------------------
   4 · AS ACÇÕES
   ------------------------------------------------------------------------ */
async function copiarTexto(texto, api, msg = 'copiado') {
  const t = String(texto || '');
  if (!t.trim()) { api.toast('não há texto para copiar', true); return false; }
  try {
    if (globalThis.navigator?.clipboard?.writeText) {
      await globalThis.navigator.clipboard.writeText(t);
      api.toast(msg);
      return true;
    }
  } catch { /* cai no plano B */ }
  try {
    const d = globalThis.document;
    if (!d) return false;
    const ta = d.createElement('textarea');
    ta.value = t;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    d.body.appendChild(ta);
    ta.select();
    const ok = d.execCommand && d.execCommand('copy');
    d.body.removeChild(ta);
    api.toast(ok ? msg : 'não consegui copiar — selecciona o texto e copia à mão', !ok);
    return !!ok;
  } catch {
    api.toast('não consegui copiar — selecciona o texto e copia à mão', true);
    return false;
  }
}

const comAviso = (B, texto, mau = false) => { B.aviso = texto ? { texto, mau } : null; };

/** As acções que o projeto chama. Devolve `true` quando tratou do clique. */
export async function accaoBriefing(name, el, api) {
  const S = api.S;
  const B = S.briefing;
  if (!B) return false;
  const id = B.projetoId;

  if (name === 'bf-aba') {
    B.aba = el?.dataset?.aba || 'briefing';
    B.versoes = null;
    api.paint();
    return true;
  }

  if (name === 'bf-recarregar') {
    await carregarBriefing(api, id, { forcar: true });
    api.paint();
    return true;
  }

  if (name === 'bf-guardar') {
    /* 1.57.0 · dois toques seguidos no «Salvar» não podem ser duas gravações: a
       primeira ainda está à espera do servidor quando a segunda chega. */
    if (B.aGravar) { api.toast('a gravar… espera um instante'); return true; }
    if (!B.sujo) { api.toast('não há nada por gravar'); return true; }
    B.aGravar = true;
    try {
      const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/briefing`, 'PUT', {
        valores: B.valores,
        origens: B.origens,
        base: B.base,
      });
      B.dados = r;
      B.campos = r.campos || B.campos;
      B.valores = { ...(r.briefing?.valores || B.valores) };
      B.origens = { ...(r.briefing?.origens || {}) };
      B.base = r.briefing?.hash || null;
      B.sujo = false;
      B.semRegisto = false;
      comAviso(B, 'Briefing gravado. O Prompt Master e os prompts de imagem ficam marcados como desactualizados até serem gerados outra vez.', false);
      api.toast('briefing gravado');
    } catch (e) {
      if (e?.status === 409) {
        comAviso(B, 'Outra pessoa gravou o briefing entretanto. Recarreguei a versão guardada — compara e volta a escrever o que faltar.', true);
        B.sujo = false;
        await carregarBriefing(api, id, { forcar: true });
      } else {
        api.toast(e?.message || 'não consegui gravar o briefing', true);
        return true;
      }
    } finally {
      B.aGravar = false;
    }
    api.paint();
    return true;
  }

  if (name === 'bf-descartar') {
    const ok = globalThis.confirm ? globalThis.confirm('Descartar o que ainda não está gravado?') : true;
    if (!ok) return true;
    B.valores = { ...(B.dados?.briefing?.valores || {}) };
    B.origens = { ...(B.dados?.briefing?.origens || {}) };
    B.sujo = false;
    comAviso(B, null);
    api.paint();
    return true;
  }

  /* gerar usa o briefing GUARDADO: com alterações por gravar, pede-se a gravação
     primeiro — é a diferença entre gerar do que está confirmado e do que não está */
  const precisaGravar = () => {
    if (!B.sujo) return false;
    api.toast('tens alterações no briefing por gravar — grava primeiro e gero a partir da versão guardada', true);
    const btn = globalThis.document?.querySelector('[data-act="bf-guardar"]');
    if (btn && !btn.disabled) btn.focus();
    return true;
  };

  if (name === 'bf-rascunho' || name === 'bf-rascunho-tudo') {
    B.aGerar = 'rascunho';
    comAviso(B, null);
    api.paint();
    try {
      const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/briefing/rascunho`, 'POST', { substituir: name === 'bf-rascunho-tudo' });
      B.dados = r;
      B.campos = r.campos || B.campos;
      B.valores = { ...(r.briefing?.valores || {}) };
      B.origens = { ...(r.briefing?.origens || {}) };
      B.base = r.briefing?.hash || null;
      B.sujo = false;
      B.semRegisto = false;
      comAviso(B, r.motivo ? r.motivo : 'Rascunho escrito pela IA. Revê campo a campo: as sugestões estão marcadas como «sugerido pela IA».', !r.motivo);
      api.toast(r.motivo ? 'a IA não acrescentou nada' : 'rascunho escrito pela IA');
    } catch (e) {
      comAviso(B, `A IA não respondeu: ${e?.message || 'sem resposta'}. O briefing continua aqui e podes escrevê-lo à mão, ou tentar outra vez.`, true);
    } finally {
      B.aGerar = null;
      api.paint();
    }
    return true;
  }

  if (name === 'bf-master' || name === 'bf-imagens') {
    if (precisaGravar()) return true;
    const tipo = name === 'bf-master' ? 'master' : 'imagens';
    B.aGerar = tipo;
    comAviso(B, null);
    api.paint();
    try {
      const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/${tipo}`, 'POST', {});
      B.dados = r;
      B.campos = r.campos || B.campos;
      B.base = r.briefing?.hash || B.base;
      B.sujo = false;
      comAviso(B, r.via === 'ia'
        ? (tipo === 'master' ? 'Prompt Master escrito pela IA a partir do briefing guardado.' : 'Prompts de imagem escritos pela IA a partir do briefing guardado.')
        : `Sem resposta da IA (${r.motivo || 'motivo não indicado'}). Ficou a versão por regras, com os factos do briefing guardado.`, r.via !== 'ia');
      api.toast(tipo === 'master' ? `Prompt Master ${r.via === 'ia' ? 'escrito pela IA' : 'montado por regras'}` : `prompts de imagem ${r.via === 'ia' ? 'escritos pela IA' : 'montados por regras'}`);
    } catch (e) {
      comAviso(B, e?.status === 409
        ? `Ainda não dá para gerar: ${e.message}`
        : `Não consegui gerar (${e?.message || 'sem resposta'}). O briefing está guardado; podes tentar outra vez.`, true);
      api.toast(e?.message || 'não consegui gerar', true);
    } finally {
      B.aGerar = null;
      api.paint();
    }
    return true;
  }

  if (name === 'bf-copiar-master') {
    await copiarTexto(B.dados?.master?.texto, api, 'Prompt Master copiado');
    return true;
  }

  if (name === 'bf-copiar-prompt') {
    const p = (B.dados?.imagens?.prompts || []).find((x) => String(x.id) === String(el?.dataset?.id));
    await copiarTexto(p?.prompt, api, 'prompt copiado');
    return true;
  }

  if (name === 'bf-copiar-imagens') {
    const lista = B.dados?.imagens?.prompts || [];
    const texto = lista.map((p, i) => `${i + 1}. ${p.finalidade}\nOnde: ${p.local}\nAssunto: ${p.assunto}\nComposição: ${p.composicao}\nDireção de arte: ${p.direcaoArte}\nFormato: ${p.formato}\nRestrições: ${p.restricoes}\nPrompt: ${p.prompt}\nNota: ${p.nota || ''}`).join('\n\n');
    await copiarTexto(texto, api, `${lista.length} prompts copiados`);
    return true;
  }

  if (name === 'bf-versoes') {
    const tipo = el?.dataset?.tipo === 'imagens' ? 'imagens' : 'master';
    if (B.versoes) { B.versoes = null; api.paint(); return true; }
    B.aCarregarVersoes = true;
    api.paint();
    try {
      const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/briefing/versoes`);
      B.versoes = { master: r.master || [], imagens: r.imagens || [], tipo };
    } catch (e) {
      api.toast(e?.message || 'não consegui ler as versões', true);
    } finally {
      B.aCarregarVersoes = false;
      api.paint();
    }
    return true;
  }

  if (name === 'bf-restaurar') {
    const tipo = el?.dataset?.tipo === 'imagens' ? 'imagens' : 'master';
    const ok = globalThis.confirm ? globalThis.confirm('Repor esta versão? A actual fica no histórico — nada é apagado.') : true;
    if (!ok) return true;
    try {
      const r = await api.call(`/ops/projetos/${encodeURIComponent(id)}/briefing/restaurar`, 'POST', { tipo, id: el?.dataset?.id });
      B.dados = r;
      B.versoes = null;
      comAviso(B, 'Versão anterior reposta. A que estava no lugar ficou guardada no histórico.', false);
      api.toast('versão reposta');
    } catch (e) {
      api.toast(e?.message || 'não consegui repor a versão', true);
    }
    api.paint();
    return true;
  }

  return false;
}

/* ---------------------------------------------------------------------------
   5 · OUVIR O TECLADO
   As alterações vivem no estado enquanto se escreve — assim um repintar do
   ecrã (que acontece a cada acção) não deita fora o que foi escrito.
   ------------------------------------------------------------------------ */
export function ligarBriefing(api) {
  const doc = globalThis.document;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  const aoEscrever = (e) => {
    const t = e.target;
    if (!t || !t.dataset || t.dataset.campo === undefined) return;
    const B = api.S.briefing;
    if (!B) return;
    B.valores = { ...(B.valores || {}), [t.dataset.campo]: t.value };
    const comparado = B.dados?.briefing?.valores?.[t.dataset.campo] ?? '';
    const mudou = Object.keys(B.valores).some((k) => (B.valores[k] ?? '') !== (B.dados?.briefing?.valores?.[k] ?? ''));
    B.sujo = mudou || t.value !== comparado;
    t.classList.toggle('vazio', !String(t.value || '').trim());
    const btn = doc.querySelector('[data-act="bf-guardar"]');
    if (btn) btn.disabled = !B.sujo;
    const estado = doc.querySelector('.bf-estado');
    if (estado && B.sujo) estado.innerHTML = '<span class="tag contactado">alterações por gravar</span>';
  };
  doc.addEventListener('input', aoEscrever);
  doc.addEventListener('change', aoEscrever);
}
