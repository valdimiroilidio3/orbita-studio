/* ===========================================================================
   1.18.0 · AI CONTROL CENTER (30 out 2026)

   A cara da camada de IA. Três regras que esta vista não quebra:
     1. só diz «funcional» o que teve um teste real com sucesso;
     2. nunca mostra uma chave — mostra o NOME da variável e uma máscara;
     3. distingue «a decorrer» de «feito»: os passos vêm da base, não de uma
        animação. Enquanto o trabalho corre, esta vista pergunta ao servidor.

   A vista recebe tudo o que precisa (`api`) do mesa.js — não fala com a rede
   por sua conta, para o modo local e o modo base continuarem a passar pelo
   mesmo caminho (`call()`).
   =========================================================================== */

let relogio = null;

export function pararSeguimento() {
  if (relogio) { clearInterval(relogio); relogio = null; }
}

export async function carregarIA(api) {
  /* 1.34.0 · esta vista nunca fica presa em «A carregar o Control Center…».
     Se o servidor não tiver a rota (foi o que a 1.29 publicada fazia), o erro
     fica escrito com a razão e a página oferece voltar a tentar; se já havia um
     estado lido, continua à vista com um aviso em cima, em vez de desaparecer. */
  let estado = null;
  try {
    const lido = await api.call('/ia/estado');
    if (!lido || !Array.isArray(lido.fornecedores)) throw new Error('o servidor respondeu sem a lista de fornecedores');
    estado = lido;
    api.S.iaErro = null;
  } catch (e) {
    api.S.iaErro = e?.message || 'o servidor não respondeu';
    estado = api.S.ia && Array.isArray(api.S.ia.fornecedores) ? api.S.ia : null;
  }
  const [uso, runs, fila, gratuitos] = await Promise.all([
    api.call('/ia/uso').catch(() => ({ resumo: [], errosRecentes: [] })),
    api.call('/ia/runs').catch(() => ({ runs: [] })),
    api.call('/media/trabalhos').catch(() => ({ trabalhos: [] })),
    /* 1.32.0: o que é gratuito e já respondeu — se a rota não existir, a faixa
       fica como estava; não se inventa estado nenhum. */
    api.call('/ia/gratuitos').catch(() => null),
  ]);
  api.S.ia = estado || api.S.ia || null;
  api.S.iaUso = uso;
  api.S.iaRuns = runs.runs || [];
  api.S.iaFila = fila.trabalhos || [];
  api.S.iaGratuitos = gratuitos;
  if (!api.S.iaRun && api.S.iaRuns.length) {
    const mais = api.S.iaRuns[0];
    try { api.S.iaRun = await api.call(`/ia/runs/${mais.id}`); } catch { api.S.iaRun = null; }
  }
}

export async function abrirRun(api, id) {
  api.S.iaRun = await api.call(`/ia/runs/${id}`);
  seguir(api, id);
  return api.S.iaRun;
}

/** Pergunta ao servidor pelo estado do trabalho até ele fechar. */
export function seguir(api, runId) {
  pararSeguimento();
  relogio = setInterval(async () => {
    try {
      const r = await api.call(`/ia/runs/${runId}`);
      api.S.iaRun = r;
      api.paint();
      const estado = r?.run?.estado;
      if (['concluido', 'parcial', 'falhou', 'cancelado'].includes(estado)) {
        pararSeguimento();
        api.S.iaRuns = (await api.call('/ia/runs').catch(() => ({ runs: [] }))).runs || [];
        api.paint();
      }
    } catch {
      pararSeguimento();
    }
  }, 2500);
}

/* ---------------- peças visuais ---------------- */
const etiqueta = (texto, tipo = '') => `<span class="ia-tag ${tipo}">${texto}</span>`;

const ESTADO_FORNECEDOR = {
  funcional: { texto: 'funcional', tipo: 'ok', porque: 'teste real com sucesso' },
  erro: { texto: 'com erro', tipo: 'bad', porque: 'o último teste falhou' },
  por_testar: { texto: 'por testar', tipo: 'warn', porque: 'tem chave, mas ainda não provou nada' },
  sem_chave: { texto: 'sem chave', tipo: '', porque: 'falta a variável de ambiente' },
  desligado: { texto: 'desligado', tipo: '', porque: 'desligado à mão' },
};

const ESTADO_RUN = {
  novo: ['à espera', 'warn'], a_planear: ['a planear', 'warn'], a_executar: ['a trabalhar', 'warn'],
  aguarda_aprovacao: ['espera aprovação', 'warn'], concluido: ['concluído', 'ok'],
  parcial: ['parcial', 'warn'], falhou: ['falhou', 'bad'], cancelado: ['cancelado', ''],
};

export function vistaIA(S, { esc, hhmm, when }) {
  const ia = S.ia;
  if (!ia) {
    if (S.iaErro) {
      return `<div class="wrap"><div class="card">
        <h3 style="margin-top:0">Não consegui ler o estado da IA</h3>
        <div class="ia-faixa bad">${esc(S.iaErro)}</div>
        <p class="ia-sub" style="margin-top:0">O resto da mesa continua a funcionar — só esta página precisa do servidor.
          Uma versão publicada anterior à 1.33 não tem a rota <code>/ia/estado</code>; nesse caso o que está aqui é o que o browser sabe, e provar modelos exige o servidor.</p>
        <div class="ia-acts"><button class="btn primary small" data-act="ia-recarregar">Tentar outra vez</button></div>
      </div></div>`;
    }
    return `<div class="wrap"><div class="card empty"><h3>A carregar o Control Center…</h3>
      <p class="ia-sub">a pedir o estado ao servidor</p></div></div>`;
  }

  const listaFornecedores = Array.isArray(ia.fornecedores) ? ia.fornecedores : [];
  const prontos = listaFornecedores.filter((f) => f.estado === 'funcional');
  const comChave = listaFornecedores.filter((f) => f.configurado);
  /* 1.19.0 · os fornecedores do freellmapi vêm em dois grupos: os que este
     cliente sabe falar e os que não (dialeto próprio, sem base). Não se
     esconde nenhum: os que não servem dizem porquê, numa linha. */
  const nucleo = listaFornecedores.filter((f) => (f.familia || 'nucleo') !== 'freellmapi');
  const extra = listaFornecedores.filter((f) => f.familia === 'freellmapi');
  const extraOk = extra.filter((f) => f.estado !== 'inutilizavel');
  const extraNao = extra.filter((f) => f.estado === 'inutilizavel');
  const semChave = comChave.filter((f) => f.semChave).length;
  const uso = S.iaUso || { resumo: [] };

  const falhaAoLer = S.iaErro
    ? `<div class="ia-faixa warn"><b>Não consegui actualizar agora.</b> ${esc(S.iaErro)} — o que está abaixo é a última leitura que deu certo.
        <button class="btn quiet small" data-act="ia-recarregar" style="margin-left:8px">Tentar outra vez</button></div>`
    : '';

  const aviso = ia.modo === 'local'
    ? `<div class="ia-faixa bad"><b>Modo local.</b> ${esc(ia.motivo || 'a IA corre no servidor')}.
        O resto da mesa funciona aqui; o Control Center só ganha vida quando a página estiver a falar com o \`/api\` (que é o caso do site publicado).</div>`
    : ia.pronto
    ? `<div class="ia-faixa ok"><b>Motor operacional.</b> ${comChave.length} fornecedor(es) prontos${semChave ? ` (${semChave} sem chave, por desenho)` : ''}; ${prontos.length} com teste real bem-sucedido.
        ${prontos.length ? '' : ' Ainda nenhum foi testado — usa «Testar» na linha do fornecedor: só isso conta como prova.'}
        ${S.iaGratuitos?.estado?.frase ? `<div class="ia-sub">${esc(S.iaGratuitos.estado.frase)}${S.iaGratuitos.medidoEm ? ` · medido em ${esc(S.iaGratuitos.medidoEm)}` : ''}</div>` : ''}</div>`
    : `<div class="ia-faixa bad"><b>Sem motor.</b> Nenhum fornecedor está ligado nesta instalação.
        Os agentes não correm e as tarefas dizem isso mesmo. As chaves vivem no servidor: quem as põe
        é o dono, em Configurações → Centro de Controlo, onde cada serviço diz o que falta — aqui não
        se mostra configuração, mostra-se trabalho. O separador «Fornecedores» lista os limites de cada um.</div>`;

  /* 1.33.0 · «IA gratuita» — a pergunta é sempre a mesma: «o que é que funciona
     mesmo?». A resposta separa o que tem resposta registada do que só existe e
     está pronto. Os «por provar» aparecem, mas não como funcionais: sem verde,
     sem botão de usar, com a razão à vista. */
  const gr = S.iaGratuitos || null;
  const grProvados = gr?.modelos || [];
  const grPorProvar = gr?.porProvar || [];
  const grCadeia = gr?.cadeia || {};
  const trabalhos = [
    ['plano', 'planear'], ['codigo', 'código'], ['texto', 'texto'],
    ['investigar', 'investigar'], ['revisao', 'revisão'], ['visao', 'visão'],
  ].filter(([id]) => (grCadeia[id] || []).length);
  const cartaoGratuitos = !gr ? '' : `<div class="card">
      <h3 style="margin-top:0">IA gratuita <span class="ia-sub">· ${gr.total} provados · ${gr.totalPorProvar} por provar</span>
        ${gr.modo === 'local' ? '' : '<span style="float:right"><button class="btn quiet small" data-act="ia-descobrir-todos">Descobrir modelos</button> <button class="btn quiet small" data-act="ia-provar-todas">Provar todas as sem chave</button></span>'}</h3>
      <p class="ia-sub" style="margin-top:0">${esc(gr.estado?.frase || 'sem medição')}${gr.medidoEm ? ` · medido em ${esc(gr.medidoEm)}` : ''}</p>
      ${grProvados.length ? `<table class="ia-tab">
        <thead><tr><th>Modelo</th><th>Fornecedor</th><th>Medido</th><th>Serve para</th></tr></thead>
        <tbody>${grProvados.map((m) => `<tr class="ia-ok">
          <td><b>${esc(m.modelo)}</b> ${etiqueta('provado', 'ok')}</td>
          <td>${esc(m.fornecedor || m.fornec)}${m.keyless || m.semChave ? ` <span class="ia-sub">sem chave</span>` : ''}</td>
          <td>${esc(m.medidoMs != null ? `${m.medidoMs} ms` : '—')}${m.nota ? `<div class="ia-sub">${esc(m.nota)}</div>` : ''}</td>
          <td>${(m.etiquetas || []).map((e) => etiqueta(esc(e), '')).join(' ')}</td>
        </tr>`).join('')}</tbody>
      </table>` : '<div class="ia-faixa warn">Nenhum gratuito com resposta registada. O que está ligado aparece abaixo como <b>por provar</b> — não conta como funcional.</div>'}
      ${grPorProvar.length ? `<details style="margin-top:10px"><summary class="ia-sub">${grPorProvar.length} por provar — existem e estão prontos, mas ainda não responderam</summary>
        <table class="ia-tab" style="margin-top:8px">
          <thead><tr><th>Modelo</th><th>Fornecedor</th><th>Estado</th><th></th></tr></thead>
          <tbody>${grPorProvar.map((m) => `<tr>
            <td class="ia-mono">${esc(m.modelo)}</td>
            <td>${esc(m.fornecedor || m.fornec)}${m.semChave ? ` <span class="ia-sub">sem chave</span>` : ''}${m.descoberto ? ` ${etiqueta('descoberto', '')}` : ''}</td>
            <td>${etiqueta('por provar', 'warn')}<div class="ia-sub">${esc(m.nota || (m.semChave ? 'não precisa de chave; falta a primeira resposta' : 'pronto, falta a primeira resposta'))}</div></td>
            <td class="ia-acts">${gr.modo === 'local' ? '<span class="ia-sub">precisa do servidor</span>' : `<button class="btn quiet small" data-act="ia-provar" data-fornec="${esc(m.fornec)}" data-modelo="${esc(m.modelo)}">Provar</button>`}</td>
          </tr>`).join('')}</tbody>
        </table>
        <div class="ia-sub">Provar faz <b>um</b> pedido curto a este modelo e guarda o resultado em <code>/ia/uso</code>. Só depois de responder é que passa a provado.</div>
      </details>` : ''}
      ${trabalhos.length ? `<div class="ia-sub" style="margin-top:10px"><b>Por tipo de trabalho</b> (a ordem em que seriam tentados):</div>
        ${trabalhos.map(([id, nome]) => `<div class="ia-sub" style="margin-top:2px"><b>${nome}</b> · ${(grCadeia[id] || []).map((x) => esc(`${x.fornec}/${x.modelo}`)).join(' → ')}</div>`).join('')}` : ''}
      ${gr.nota ? `<div class="ia-sub" style="margin-top:8px">${esc(gr.nota)}</div>` : ''}
    </div>`;

  /* 1.43.0 · «todos os modelos» — o pedido foi explícito: a mesa mostrava um
     contador e não a lista. Aqui está a lista real do que o motor pode usar
     AGORA (declarado + descoberto nos fornecedores), com o estado honesto de
     cada um: provado, descoberto, ou só declarado. Nada aparece como
     «funcional» sem uma resposta registada. */
  const catalogo = gr?.catalogo || [];
  const porFornecedor = new Map();
  for (const m of catalogo) {
    if (!porFornecedor.has(m.fornec)) porFornecedor.set(m.fornec, []);
    porFornecedor.get(m.fornec).push(m);
  }
  const grupos = [...porFornecedor.entries()]
    .map(([fornec, lista]) => ({ fornec, nome: lista[0]?.fornecedor || fornec, lista }))
    .sort((a, b) => b.lista.length - a.lista.length);
  const provadosSet = new Set([...(grProvados || []).map((m) => `${m.fornec || m.fornecedor}\u0000${m.modelo}`),
    ...(gr?.medido || []).map((m) => `${m.fornec}\u0000${m.modelo}`)]);
  const cartaoModelos = !catalogo.length ? '' : `<div class="card">
      <h3 style="margin-top:0">Modelos no motor <span class="ia-sub">· ${catalogo.length} em ${grupos.length} fornecedor(es) · ${catalogo.filter((m) => provadosSet.has(`${m.fornec}\u0000${m.modelo}`)).length} provados</span>
        ${gr?.modo === 'local' ? '' : `<span style="float:right"><button class="btn quiet small" data-act="ia-provar-lote">Provar os por provar</button> <button class="btn quiet small" data-act="ia-descobrir-todos">Descobrir modelos</button></span>`}</h3>
      <p class="ia-sub" style="margin-top:0">Tudo o que a cadeia pode escolher neste momento. «Provado» = há uma resposta registada; «descoberto» = o fornecedor disse que o tem (ainda sem resposta nossa); «com chave» = só existe no tier com chave.</p>
      ${grupos.map((g) => `<details ${g.lista.length > 6 ? '' : 'open'} style="margin-top:8px">
        <summary><b>${esc(g.nome)}</b> <span class="ia-sub">· ${g.lista.length} modelo(s)${g.lista.some((m) => m.descoberto) ? ' · inclui descobertos' : ''}</span></summary>
        <table class="ia-tab" style="margin-top:6px">
          <thead><tr><th>Modelo</th><th>Serve para</th><th>Estado</th><th></th></tr></thead>
          <tbody>${g.lista.map((m) => {
            const provado = provadosSet.has(`${m.fornec}\u0000${m.modelo}`);
            const estado = provado ? etiqueta('provado', 'ok')
              : m.soComChave ? etiqueta('com chave', 'warn')
              : m.descoberto ? etiqueta('descoberto', '')
              : etiqueta('declarado', '');
            return `<tr class="${provado ? 'ia-ok' : ''}">
              <td class="ia-mono">${esc(m.modelo)}${m.janela ? `<div class="ia-sub">${Math.round(m.janela / 1000)}k de contexto</div>` : ''}</td>
              <td>${(m.etiquetas || []).map((e) => etiqueta(esc(e), '')).join(' ')}</td>
              <td>${estado}${m.semChave ? ' <span class="ia-sub">sem chave</span>' : ''}</td>
              <td class="ia-acts">${provado || gr?.modo === 'local' ? '' : `<button class="btn quiet small" data-act="ia-provar" data-fornec="${esc(m.fornec)}" data-modelo="${esc(m.modelo)}">Provar</button>`}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </details>`).join('')}
    </div>`;

  const linhaFornecedor = (f) => {
    const st = ESTADO_FORNECEDOR[f.estado] || ESTADO_FORNECEDOR.sem_chave;
    const teste = f.ultimoTeste
      ? `${f.ultimoTeste.ok ? 'ok' : 'falhou'} · ${f.ultimoTeste.ms != null ? `${f.ultimoTeste.ms} ms` : '—'} · ${when(f.ultimoTeste.quando)}`
      : 'nunca';
    return `<tr class="${f.estado === 'funcional' ? 'ia-ok' : ''}">
      <td><b>${esc(f.nome)}</b> ${f.semChave ? etiqueta('sem chave', 'ok') : ''}<div class="ia-sub">${esc(f.limites || '')}</div></td>
      <td class="ia-mono">${f.semChave ? '<span class="ia-sub">não precisa</span>' : f.configurado ? `${esc(f.variavel)}<div class="ia-sub">${esc(f.chaveMascarada)}</div>` : `<span class="ia-sub">${esc(f.variavel || '')}</span>`}</td>
      <td>${etiqueta(st.texto, st.tipo)}<div class="ia-sub">${esc(st.porque)}</div></td>
      <td>${esc(teste)}</td>
      <td class="ia-acts">
        <button class="btn quiet small" data-act="ia-testar" data-id="${f.id}" ${!f.configurado ? 'disabled title="sem chave"' : ''}>Testar</button>
        <button class="btn quiet small" data-act="ia-descobrir" data-id="${f.id}" ${!f.configurado ? 'disabled' : ''}>Modelos</button>
        <button class="btn quiet small" data-act="ia-desligar" data-id="${f.id}" data-ligado="${f.desligado ? '0' : '1'}" ${!f.configurado ? 'disabled' : ''}>${f.desligado ? 'Ligar' : 'Desligar'}</button>
      </td>
    </tr>`;
  };

  const agentes = (ia.agentes || []).map((a) => {
    const opcoes = [];
    for (const f of ia.fornecedores.filter((x) => x.configurado && !x.desligado)) {
      for (const m of (f.modelosDescobertos || f.descobertos || [])) opcoes.push(`${f.id}::${m}`);
    }
    const escolhido = a.modelo ? `${a.modelo.fornecedor}::${a.modelo.modelo}` : '';
    if (escolhido && !opcoes.includes(escolhido)) opcoes.unshift(escolhido);
    return `<tr>
      <td><b>${esc(a.numero)} ${esc(a.nome)}</b><div class="ia-sub">${esc(a.papel)}</div></td>
      <td class="ia-sub">${esc(a.ferramentas.join(', ') || 'nenhuma')}</td>
      <td>
        <select data-act="ia-preferido" data-id="${a.id}" class="ia-select">
          <option value="">automático (router)</option>
          ${opcoes.map((o) => `<option value="${esc(o)}" ${o === escolhido ? 'selected' : ''}>${esc(o.replace('::', ' · '))}</option>`).join('')}
        </select>
        ${opcoes.length ? '' : '<div class="ia-sub">sem modelos descobertos — testa um fornecedor para ver a lista real</div>'}
      </td>
    </tr>`;
  }).join('');

  const run = S.iaRun?.run;
  const passos = S.iaRun?.passos || [];
  const [rotuloRun, tipoRun] = ESTADO_RUN[run?.estado] || ['—', ''];
  const aCorrer = ['a_planear', 'a_executar'].includes(run?.estado);
  /* retomar só faz sentido quando há plano gravado e a execução parou a meio */
  const podeRetomar = !aCorrer && !!run?.plano?.passos?.length && ['falhou', 'parcial', 'cancelado', 'aguarda_aprovacao'].includes(run?.estado);

  const painelRun = run ? `
    <div class="card ia-run">
      <div class="ia-run-head">
        <div><h3 style="margin:0">${esc(run.objetivo)}</h3>
          <div class="ia-sub">${etiqueta(rotuloRun, tipoRun)} ${run.modelo ? `· ${esc(run.fornecedor)} / ${esc(run.modelo)}` : ''} ${run.criado ? `· ${when(run.criado)}` : ''}</div>
        </div>
        <div class="ia-acts">
          ${aCorrer ? `<button class="btn quiet small" data-act="ia-cancelar" data-id="${run.id}">Cancelar</button>` : ''}
          ${podeRetomar ? `<button class="btn primary small" data-act="ia-retomar" data-id="${run.id}">Retomar do passo em falta</button>` : ''}
          <button class="btn quiet small" data-act="ia-recarregar">Actualizar</button>
        </div>
      </div>
      ${run.plano?.passos?.length ? `<ol class="ia-plano">${run.plano.passos.map((p) => `<li><b>${esc(p.agente)}</b> — ${esc(p.titulo)}<div class="ia-sub">${esc(p.instrucao)}</div></li>`).join('')}</ol>` : `<div class="ia-sub">${aCorrer ? 'o Orchestrator está a preparar o plano…' : 'sem plano gravado'}</div>`}
      ${passos.length ? `<table class="ia-tab"><thead><tr><th>#</th><th>Agente</th><th>Passo</th><th>Modelo</th><th>Ferramentas</th><th>Duração</th><th>Estado</th></tr></thead><tbody>
        ${passos.map((p) => `<tr>
          <td>${p.ordem}</td><td>${esc(p.agente || '')}</td>
          <td>${esc(p.titulo || '')}<div class="ia-sub">${esc(String(p.saida || p.erro || '').slice(0, 220))}</div></td>
          <td class="ia-mono">${esc(p.fornecedor || '')}${p.modelo ? ` / ${esc(p.modelo)}` : ''}</td>
          <td>${(p.ferramentas || []).length ? p.ferramentas.map((f) => etiqueta(`${esc(f.nome)} ${f.ok ? '✓' : '✗'}`, f.ok ? 'ok' : 'bad')).join(' ') : '<span class="ia-sub">—</span>'}</td>
          <td>${p.duracao_ms ? `${p.duracao_ms} ms` : '—'}</td>
          <td>${etiqueta(p.estado || '', p.estado === 'concluido' ? 'ok' : p.estado === 'falhou' ? 'bad' : 'warn')}</td>
        </tr>`).join('')}
      </tbody></table>` : ''}
      ${run.revisao ? `<div class="ia-revisao"><b>Revisão:</b> ${etiqueta(run.revisao.decisao || '', run.revisao.decisao === 'aprovado' ? 'ok' : run.revisao.decisao === 'rejeitado' ? 'bad' : 'warn')}
        <div class="ia-sub">${esc(run.revisao.justificacao || '')}</div></div>` : ''}
      ${run.resultado ? `<details class="ia-resultado"><summary>Resultado</summary><pre>${esc(run.resultado)}</pre></details>` : ''}
      ${run.erro ? `<div class="ia-erro">${esc(run.erro)}</div>` : ''}
      ${run.artefactos?.limites?.length ? `<div class="ia-sub" style="margin-top:8px"><b>Limites declarados:</b> ${run.artefactos.limites.map(esc).join(' · ')}</div>` : ''}
    </div>` : '';

  const runsRecentes = (S.iaRuns || []).slice(0, 8).map((r) => `<tr class="ia-linha-run" data-act="ia-abrir" data-id="${r.id}">
      <td>${esc(String(r.objetivo).slice(0, 70))}</td>
      <td>${etiqueta(...(ESTADO_RUN[r.estado] || ['—', '']))}</td>
      <td class="ia-sub">${esc(r.fornecedor || '')}${r.modelo ? ` / ${esc(r.modelo)}` : ''}</td>
      <td class="ia-sub">${r.criado ? when(r.criado) : ''}</td>
    </tr>`).join('');

  const usoLinhas = (uso.resumo || []).map((u) => `<tr>
      <td>${esc(u.fornecedor)}</td><td>${u.pedidos}</td><td>${u.ok}</td><td>${u.erros}</td>
      <td>${u.latenciaMediaMs != null ? `${u.latenciaMediaMs} ms` : '—'}</td><td>${u.tokens}</td>
    </tr>`).join('');

  return `<div class="wrap">
    ${falhaAoLer}
    ${aviso}

    ${cartaoGratuitos}
    ${cartaoModelos}

    <div class="card">
      <h3 style="margin-top:0">Um trabalho, de ponta a ponta</h3>
      <p class="ia-sub" style="margin-top:0">Descreve o que precisas. O Orchestrator divide em passos, cada agente usa as suas ferramentas (a base é real), e o Reviewer decide no fim. O que não existe nesta instalação fica escrito nos limites — não é inventado.</p>
      <textarea id="iaObjetivo" class="ia-input" rows="3" maxlength="2000"
        placeholder="Ex.: organizar os leads de Coimbra, escrever a primeira mensagem para os três mais promissores e registar o projeto do Café Central"
        ${ia.pronto ? '' : 'disabled'}>${esc(S.iaObjetivo || '')}</textarea>
      <div class="ia-acts" style="margin-top:8px;justify-content:flex-end">
        <button class="btn primary small" data-act="ia-correr" ${ia.pronto ? '' : 'disabled title="sem motor configurado"'}>Enviar ao Orchestrator</button>
      </div>
    </div>

    ${painelRun}

    <div class="card">
      <h3 style="margin-top:0">Execuções</h3>
      ${runsRecentes ? `<table class="ia-tab"><thead><tr><th>Objectivo</th><th>Estado</th><th>Modelo</th><th>Quando</th></tr></thead><tbody>${runsRecentes}</tbody></table>` : '<div class="ia-sub">Ainda não houve nenhuma execução.</div>'}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Fornecedores do núcleo <span class="ia-sub">· ${comChave.length} prontos, ${prontos.length} provados</span></h3>
      <table class="ia-tab">
        <thead><tr><th>Fornecedor</th><th>Variável</th><th>Estado</th><th>Último teste</th><th></th></tr></thead>
        <tbody>${nucleo.map(linhaFornecedor).join('')}</tbody>
      </table>
      <div class="ia-sub" style="margin-top:8px">«Por testar» quer dizer exactamente isso: está pronto, mas ninguém provou que responde. O teste faz dois pedidos reais (lista de modelos + uma resposta curta) e fica registado.</div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Fornecedores do freellmapi <span class="ia-sub">· ${extraOk.length} utilizáveis de ${extra.length}</span></h3>
      <p class="ia-sub" style="margin-top:0">Extraídos do <code>freellmapi</code> (MIT) por <code>scripts/extrair-freellmapi.mjs</code>: ${extra.length} adaptadores e os modelos com os limites que ele declara. Os <b>sem chave</b> (Kilo, OVH) funcionam sem configurares nada — mas só o teste real o confirma.</p>
      <table class="ia-tab">
        <thead><tr><th>Fornecedor</th><th>Credencial</th><th>Estado</th><th>Último teste</th><th></th></tr></thead>
        <tbody>${extraOk.map(linhaFornecedor).join('')}</tbody>
      </table>
      ${extraNao.length ? `<details style="margin-top:10px"><summary class="ia-sub">${extraNao.length} que este cliente não sabe falar</summary>
        <ul class="ia-erros">${extraNao.map((f) => `<li><b>${esc(f.nome)}</b> — ${esc(f.nota || 'fora do nosso cliente')}</li>`).join('')}</ul></details>` : ''}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Agentes e modelos</h3>
      <table class="ia-tab"><thead><tr><th>Agente</th><th>Ferramentas</th><th>Modelo</th></tr></thead><tbody>${agentes}</tbody></table>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Uso e erros</h3>
      ${usoLinhas ? `<table class="ia-tab"><thead><tr><th>Fornecedor</th><th>Pedidos</th><th>Ok</th><th>Erros</th><th>Latência média</th><th>Tokens</th></tr></thead><tbody>${usoLinhas}</tbody></table>` : '<div class="ia-sub">Sem pedidos registados.</div>'}
      ${(uso.errosRecentes || []).length ? `<h4>Erros recentes</h4><ul class="ia-erros">${uso.errosRecentes.map((e) => `<li><b>${esc(e.fornecedor || '')}</b> · ${esc(when(e.quando))} — ${esc(e.erro || '')}</li>`).join('')}</ul>` : ''}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Memória <span class="ia-sub">· plugins do Graft (Apache-2.0)</span></h3>
      ${ia.memoria?.erro
        ? `<div class="ia-faixa bad">${esc(ia.memoria.erro)}</div>`
        : `<p class="ia-sub" style="margin-top:0">${ia.memoria?.total || 0} notas · ${ia.memoria?.usos || 0} consultas registadas.
             A procura é por palavras (lexical), não por embeddings — o resultado di-lo. O Orchestrator consulta a memória antes de planear e escreve uma nota no fim de cada execução concluída.</p>
           ${(ia.memoria?.etiquetas || []).length ? `<div style="margin-bottom:8px">${ia.memoria.etiquetas.map((e) => etiqueta(`${esc(e.etiqueta)} · ${e.notas}`, '')).join(' ')}</div>` : ''}
           <div class="ia-acts" style="gap:6px;flex-wrap:wrap">
             <input id="iaMemBusca" class="ia-input" style="flex:1;min-width:180px" placeholder="procurar na memória…" />
             <button class="btn quiet small" data-act="ia-memoria-procurar">Procurar</button>
             <button class="btn quiet small" data-act="ia-memoria-auditar">Auditar</button>
           </div>
           <div id="iaMemResultado" class="ia-sub" style="margin-top:8px"></div>
           <details style="margin-top:10px"><summary class="ia-sub">Guardar uma nota</summary>
             <input id="iaMemTitulo" class="ia-input" placeholder="título (o que ficou decidido)" style="margin-top:6px" maxlength="160" />
             <textarea id="iaMemTexto" class="ia-input" rows="3" placeholder="a nota: contexto, decisão e porquê" maxlength="8000" style="margin-top:6px"></textarea>
             <div class="ia-acts" style="justify-content:flex-end;margin-top:6px"><button class="btn primary small" data-act="ia-memoria-guardar">Guardar nota</button></div>
           </details>`}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Estúdio de media <span class="ia-sub">· OpenMontage (AGPL-3.0, por fora)</span></h3>
      ${(() => {
        const est = ia.estudio || {};
        const w = est.worker || {};
        return `${est.porque ? `<div class="ia-faixa ${est.configurado ? 'warn' : 'bad'}">${esc(est.porque)}</div>` : `<div class="ia-faixa ok"><b>Worker vivo.</b> OpenMontage ${esc(w.versao || '?')}${w.commit ? ` @ ${esc(String(w.commit).slice(0, 7))}` : ''} · visto há ${w.vistoHaMinutos ?? '?'} min${w.ferramentas ? ` · ffmpeg ${w.ferramentas.ffmpeg ? 'sim' : 'não'}, python ${w.ferramentas.python ? 'sim' : 'não'}` : ''}</div>`}
          <textarea id="iaMediaPedido" class="ia-input" rows="2" maxlength="2000" placeholder="Ex.: explicador de 30 s sobre o Café Central, legendas em português, 1080p"></textarea>
          <div class="ia-acts" style="gap:6px;flex-wrap:wrap;margin-top:6px">
            <select id="iaMediaTipo" class="ia-select">
              ${(est.tipos || ['video']).map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')}
            </select>
            <select id="iaMediaPipeline" class="ia-select">
              <option value="">pipeline: escolher sozinho</option>
              ${(est.pipelines || []).map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} · ${esc(p.tipo)}</option>`).join('')}
            </select>
            <button class="btn primary small" data-act="ia-media-pedir">Pedir produção</button>
          </div>
          ${(S.iaFila || []).length ? `<table class="ia-tab" style="margin-top:10px"><thead><tr><th>Pedido</th><th>Tipo</th><th>Estado</th><th>Resultado</th><th>Quando</th></tr></thead><tbody>
            ${(S.iaFila || []).slice(0, 8).map((j) => `<tr><td>${esc(String(j.pedido).slice(0, 60))}</td><td>${esc(j.tipo)}</td><td>${etiqueta(j.estado, j.estado === 'concluido' ? 'ok' : j.estado === 'falhou' || j.estado === 'indisponivel' ? 'bad' : 'warn')}${j.erro ? `<div class="ia-sub">${esc(String(j.erro).slice(0, 140))}</div>` : ''}</td><td>${j.url_resultado ? `<a href="${esc(j.url_resultado)}" target="_blank" rel="noopener">abrir</a>` : '<span class="ia-sub">—</span>'}</td><td class="ia-sub">${when(j.criado)}</td></tr>`).join('')}
          </tbody></table>` : '<div class="ia-sub" style="margin-top:8px">Nenhum trabalho de media pedido.</div>'}
          <div class="ia-sub" style="margin-top:8px">O OpenMontage não corre na Vercel: precisa de Python, FFmpeg e Node. A mesa só enfileira e mostra o que o worker devolve — <code>scripts/estudio-worker.mjs</code>, instruções em <code>docs/OPENMONTAGE.md</code>.</div>`;
      })()}
    </div>

    <div class="card">
      <h3 style="margin-top:0">Ferramentas reais</h3>
      <div class="ia-grade">
        ${(ia.ferramentas || []).map((f) => `<div class="ia-ferramenta"><b>${esc(f.id)}</b>${f.destrutiva ? etiqueta('pede aprovação', 'warn') : ''}<div class="ia-sub">${esc(f.descricao)}</div></div>`).join('')}
      </div>
      <h4>O que esta instalação não faz</h4>
      <ul class="ia-erros">${(ia.indisponiveis || []).map((i) => `<li><b>${esc(i.id)}</b> — ${esc(i.porque)}</li>`).join('')}</ul>
    </div>
  </div>`;
}

/* ---------------- acções ---------------- */
export async function accaoIA(nome, el, api) {
  const { call, S, paint, toast } = api;
  const id = el?.dataset?.id;

  if (nome === 'ia-recarregar') {
    try {
      await carregarIA(api);
      paint();
      toast(S.iaErro ? `Ainda não: ${S.iaErro}` : 'Estado da IA lido agora.', !!S.iaErro);
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-provar-todas') {
    /* 1.39.0 · uma acção, não uma lista: percorre os fornecedores que não pedem
       chave nova, faz um pedido real a cada um e só o que responde passa a
       funcional. Os que falham ficam com o motivo à vista. */
    try {
      toast('A provar os motores sem chave… (pode levar meio minuto)');
      const r = await call('/ia/provar-gratuitas', 'POST', { limite: 6 });
      if (r.provados) toast(`${r.provados} de ${r.testados} responderam agora. Os que já estavam provados continuam válidos.`);
      else toast(`Nenhum respondeu agora: ${(r.resultados?.[0]?.erros?.[0] || 'sem detalhe').slice(0, 160)}`, true);
      await carregarIA(api);
      paint();
    } catch (e) { toast(`A prova não correu: ${e.message}`, true); }
    return true;
  }

  if (nome === 'ia-provar') {
    /* 1.33.0 · provar UM modelo «por provar»: um pedido curto, e só se ele
       responder é que sai da lista. O que responder por outro caminho (o
       fornecedor a escolher outro modelo) não conta como prova deste. */
    const fornec = el?.dataset?.fornec;
    const modelo = el?.dataset?.modelo;
    try {
      toast(`A provar ${fornec}/${modelo}…`);
      const r = await call('/ia/testar', 'POST', { fornecedor: fornec, modelo });
      if (r.ok && r.modelo === modelo) toast(`${fornec}/${modelo}: respondeu em ${r.ms} ms. Passa a provado.`);
      else if (r.ok) toast(`${fornec}: respondeu com ${r.modelo}, não com o ${modelo} — este continua por provar.`, true);
      else toast(`${fornec}/${modelo}: ${r.erro || 'não respondeu'}`, true);
      await carregarIA(api);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-testar') {
    try {
      toast('A testar de verdade…');
      const r = await call('/ia/testar', 'POST', { fornecedor: id });
      if (r.ok) toast(`${id}: respondeu em ${r.ms} ms (${r.modelos} modelos). Agora sim, é funcional.`);
      else toast(`${id}: ${r.erro}`, true);
      await carregarIA(api);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-descobrir') {
    try {
      const r = await call('/ia/modelos/descobrir', 'POST', { fornecedor: id });
      toast(`${id}: ${r.quantos} modelos descobertos.`);
      await carregarIA(api);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-descobrir-todos') {
    try {
      toast('A perguntar aos fornecedores que modelos têm…');
      const r = await call('/ia/modelos/descobrir', 'POST', { fornecedor: 'todos' });
      const lista = (r.actualizados || []).map((x) => `${x.fornec} (${x.quantos})`).join(', ');
      toast(`Descobertos ${r.quantos} modelos no total${lista ? ` · agora: ${lista}` : ' · já estavam em cache (6 h)'}.`);
      await carregarIA(api);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-provar-lote') {
    /* 1.44.0 · provar em lote o que está «descoberto»/«declarado»: cada modelo
       leva um pedido curto a sério; só os que respondem passam a «provado» e
       entram na cadeia. O tecto é da função serverless (60 s), por isso pedimos
       12 de cada vez e dizemos quantos ficam para a próxima. */
    try {
      toast('A provar modelos, um a um… (pode levar meio minuto)');
      const r = await call('/ia/provar-modelos', 'POST', { limite: 12, concorrencia: 4 });
      const bons = (r.resultados || []).filter((x) => x.ok).map((x) => `${x.fornec}/${x.modelo}`);
      if (r.provados) {
        toast(`${r.provados} de ${r.testados} responderam agora${bons.length ? `: ${bons.slice(0, 4).join(', ')}${bons.length > 4 ? '…' : ''}` : ''}${r.porProvarRestantes ? ` · faltam ${r.porProvarRestantes}` : ''}`);
      } else {
        const motivo = (r.resultados || []).find((x) => !x.ok)?.erro || 'sem detalhe';
        toast(`Nenhum respondeu agora: ${String(motivo).slice(0, 160)}`, true);
      }
      await carregarIA(api);
      paint();
    } catch (e) { toast(`A prova não correu: ${e.message}`, true); }
    return true;
  }

  if (nome === 'ia-desligar') {
    const ligado = el.dataset.ligado === '1';
    const actual = (S.ia?.desligados || []).filter((x) => x !== id);
    const novo = ligado ? [...actual, id] : actual;
    try {
      await call('/ia/config', 'PATCH', { desligados: novo });
      toast(ligado ? `${id} desligado — não entra na cadeia.` : `${id} ligado outra vez.`);
      await carregarIA(api);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-preferido') {
    const valor = el.value;
    try {
      const agente = el.dataset.id;
      const pedido = valor ? { [agente]: { fornecedor: valor.split('::')[0], modelo: valor.split('::').slice(1).join('::') } } : { [agente]: null };
      await call('/ia/config', 'PATCH', { agentes: pedido });
      toast(valor ? `${agente}: ${valor.replace('::', ' / ')}` : `${agente}: volta ao router`);
      await carregarIA(api);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  /* dispara uma execução e acompanha-a pelo servidor; não se espera pelo fim */
  const lancar = (runId, extra) => {
    seguir(api, runId);
    paint();
    call(`/ia/runs/${runId}/correr`, 'POST', extra || {}).then(async () => {
      pararSeguimento();
      try { S.iaRun = await call(`/ia/runs/${runId}`); } catch { /* fica o último */ }
      S.iaRuns = (await call('/ia/runs').catch(() => ({ runs: [] }))).runs || [];
      paint();
    }).catch((e) => { pararSeguimento(); toast(e.message, true); paint(); });
  };

  if (nome === 'ia-correr') {
    const obj = String(S.iaObjetivo || (document.getElementById('iaObjetivo')?.value) || '').trim();
    if (obj.length < 6) { toast('descreve o trabalho com mais de 5 caracteres', true); return true; }
    try {
      const criada = await call('/ia/runs', 'POST', { objetivo: obj });
      S.iaObjetivo = '';
      S.iaRun = { run: criada.run, passos: [] };
      lancar(criada.run.id);
      toast('Execução criada — o plano aparece quando o Orchestrator responder.');
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-retomar') {
    try { lancar(id, { retomar: true }); toast('A retomar do passo em falta — os passos já feitos não se repetem.'); }
    catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-memoria-procurar') {
    const consulta = String(document.getElementById('iaMemBusca')?.value || '').trim();
    const alvo = document.getElementById('iaMemResultado');
    if (!consulta) { toast('escreve o que procuras', true); return true; }
    try {
      const r = await call('/ia/memoria/procurar', 'POST', { consulta, limite: 8 });
      if (!alvo) return true;
      alvo.innerHTML = r.achados.length
        ? `<b>${r.achados.length} nota(s)</b> · procura ${esc(r.modo)}<ul style="margin:6px 0 0 16px">${r.achados.map((n) => `<li><b>${esc(n.titulo)}</b> ${n.pontos ? etiqueta(`pontos ${n.pontos}`, '') : ''}<div class="ia-sub">${esc(String(n.texto).slice(0, 240))}</div></li>`).join('')}</ul>`
        : `Nada parecido com «${esc(consulta)}» — a memória tem um buraco, não uma resposta.`;
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-memoria-guardar') {
    const titulo = String(document.getElementById('iaMemTitulo')?.value || '').trim();
    const texto = String(document.getElementById('iaMemTexto')?.value || '').trim();
    if (titulo.length < 3 || texto.length < 10) { toast('título (3+) e texto (10+) são obrigatórios', true); return true; }
    try {
      const r = await call('/ia/memoria', 'POST', { titulo, texto });
      toast(r.resumo || 'nota guardada');
      const t = document.getElementById('iaMemTitulo'); if (t) t.value = '';
      const x = document.getElementById('iaMemTexto'); if (x) x.value = '';
      await carregarIA(api); paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-memoria-auditar') {
    const alvo = document.getElementById('iaMemResultado');
    try {
      const r = await call('/ia/memoria/auditar');
      if (alvo) {
        alvo.innerHTML = `<b>${r.total} notas</b> · ${esc(r.recomendacao)}
          ${r.duplicados.length ? `<div class="ia-sub">duplicados: ${r.duplicados.map((d) => esc(d.titulo)).join(' · ')}</div>` : ''}
          ${r.curtas.length ? `<div class="ia-sub">notas curtas (menos de 40 caracteres): ${r.curtas.length}</div>` : ''}
          <div class="ia-sub">não funde nem apaga nada — lista para decidires.</div>`;
      }
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-media-pedir') {
    const pedido = String(document.getElementById('iaMediaPedido')?.value || '').trim();
    const tipo = String(document.getElementById('iaMediaTipo')?.value || 'video');
    const pipeline = String(document.getElementById('iaMediaPipeline')?.value || '') || null;
    if (pedido.length < 10) { toast('descreve o que queres produzir (10+ caracteres)', true); return true; }
    try {
      const r = await call('/media/trabalhos', 'POST', { pedido, tipo, pipeline });
      toast(r.trabalho?.estado === 'indisponivel' ? 'Ficou na fila como indisponível — vê a razão no cartão.' : 'Pedido entregue à fila do estúdio.');
      const t = document.getElementById('iaMediaPedido'); if (t) t.value = '';
      await carregarIA(api); paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-abrir') {
    try { await abrirRun(api, id); paint(); } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-recarregar') {
    try {
      if (S.iaRun?.run?.id) { await abrirRun(api, S.iaRun.run.id); paint(); }
    } catch (e) { toast(e.message, true); }
    return true;
  }

  if (nome === 'ia-cancelar') {
    try {
      await call(`/ia/runs/${id}/cancelar`, 'POST', {});
      toast('Pedido de paragem enviado — o passo a decorrer termina primeiro.');
      await abrirRun(api, id);
      paint();
    } catch (e) { toast(e.message, true); }
    return true;
  }

  return false;
}
