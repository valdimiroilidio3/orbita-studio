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
  const [estado, uso, runs, fila] = await Promise.all([
    api.call('/ia/estado'),
    api.call('/ia/uso').catch(() => ({ resumo: [], errosRecentes: [] })),
    api.call('/ia/runs').catch(() => ({ runs: [] })),
    api.call('/media/trabalhos').catch(() => ({ trabalhos: [] })),
  ]);
  api.S.ia = estado;
  api.S.iaUso = uso;
  api.S.iaRuns = runs.runs || [];
  api.S.iaFila = fila.trabalhos || [];
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
  if (!ia) return `<div class="wrap"><div class="card empty"><h3>A carregar o Control Center…</h3></div></div>`;

  const prontos = ia.fornecedores.filter((f) => f.estado === 'funcional');
  const comChave = ia.fornecedores.filter((f) => f.configurado);
  /* 1.19.0 · os fornecedores do freellmapi vêm em dois grupos: os que este
     cliente sabe falar e os que não (dialeto próprio, sem base). Não se
     esconde nenhum: os que não servem dizem porquê, numa linha. */
  const nucleo = ia.fornecedores.filter((f) => (f.familia || 'nucleo') !== 'freellmapi');
  const extra = ia.fornecedores.filter((f) => f.familia === 'freellmapi');
  const extraOk = extra.filter((f) => f.estado !== 'inutilizavel');
  const extraNao = extra.filter((f) => f.estado === 'inutilizavel');
  const semChave = comChave.filter((f) => f.semChave).length;
  const uso = S.iaUso || { resumo: [] };

  const aviso = ia.modo === 'local'
    ? `<div class="ia-faixa bad"><b>Modo local.</b> ${esc(ia.motivo || 'a IA corre no servidor')}.
        O resto da mesa funciona aqui; o Control Center só ganha vida quando a página estiver a falar com o \`/api\` (que é o caso do site publicado).</div>`
    : ia.pronto
    ? `<div class="ia-faixa ok"><b>Motor operacional.</b> ${comChave.length} fornecedor(es) prontos${semChave ? ` (${semChave} sem chave, por desenho)` : ''}; ${prontos.length} com teste real bem-sucedido.
        ${prontos.length ? '' : ' Ainda nenhum foi testado — usa «Testar» na linha do fornecedor: só isso conta como prova.'}</div>`
    : `<div class="ia-faixa bad"><b>Sem motor.</b> Nenhum fornecedor tem chave no ambiente da Vercel.
        Os agentes não correm e as tarefas dizem isso mesmo. Para ligar, mete <em>uma</em> destas variáveis
        (Production e Preview) em Vercel → Settings → Environment Variables e volta a publicar:
        <code>${esc((ia.fornecedores[0]?.variavel || 'OPENROUTER_API_KEY'))}</code>
        — ou <code>GROQ_API_KEY</code>, <code>GOOGLE_AI_API_KEY</code>, <code>CEREBRAS_API_KEY</code>, <code>MISTRAL_API_KEY</code>.
        Também podes abrir o separador «Fornecedores» para ver os limites de cada um.</div>`;

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
    ${aviso}

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
