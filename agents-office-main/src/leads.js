// Órbita — PESQUISAR (27 out 2026 · versão 1.28.0).
//
// O dono pediu duas coisas, por estas palavras: «faz as pesquisas já estarem realmente
// a funcionar — leads e qualquer outra coisa» e «remove isso, esse tipo de informações
// não devem aparecer no site».
//
// O que mudou, dito sem marketing:
//
//   1 · ANTES esta gaveta falava com `/api/google` e `/api/google/search`. Esses
//       caminhos só existem em `serve.mjs`, ou seja na máquina de quem corre o
//       escritório. Na aplicação publicada (o que o dono usa) davam 404: a pesquisa
//       simplesmente não acontecia. Agora fala com as rotas que estão mesmo
//       publicadas — `/api/rpc?caminho=/pesquisa/*` — as mesmas que já provaram
//       Geoapify e Tavily em produção.
//
//   2 · A gaveta mostrava ao visitante um manual de configuração: «para procurar
//       preciso de uma chave da Google, cria uma chave em console.cloud.google.com,
//       põe GOOGLE_MAPS_API_KEY no ambiente». Isso é assunto de administração, não
//       é interface. Saiu daqui por inteiro. Quando uma fonte não responde, diz-se
//       em linguagem de gente («a pesquisa de empresas está indisponível agora») e
//       o nome da variável fica onde tem de ficar: no Centro de Controlo, que é do
//       dono, e nos registos do servidor.
//
//   3 · Leads são empresas reais do OpenStreetMap via Geoapify, com nota de
//       oportunidade explicada. Contexto é Tavily — a PESQUISA PRINCIPAL: resposta
//       curta, excertos, links, modo notícias com recorte temporal e leitura de uma
//       página inteira (`/pesquisa/pagina`). Nada disto é inventado e nada disto
//       contacta ninguém — procurar não é falar.
//
//   4 · O Google saiu (1.29.0): exigia chave com cartão e duas APIs. Não há uma
//       linha de Google nesta gaveta nem no servidor da pesquisa.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A ponte com o servidor. A Vercel só alcança a função no caminho exacto do
   ficheiro (`/api/rpc`); o caminho da rota vai dentro do pedido. É o mesmo
   contrato que o Centro de Controlo usa desde 1.20.0. */
async function pedir(caminho, { metodo = 'GET', corpo = null } = {}) {
  const url = `/api/rpc?caminho=${encodeURIComponent(caminho)}`;
  const r = metodo === 'GET'
    ? await fetch(url, { headers: { accept: 'application/json' } })
    : await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ caminho, metodo, corpo: corpo || {} }),
    });
  const j = await r.json().catch(() => ({}));
  const dados = j?.corpo ?? j;
  return { ok: r.ok && (j?.status ?? r.status) < 400, status: j?.status ?? r.status, dados };
}

/* Mensagens de gente. O servidor fala em variáveis de ambiente porque é o
   servidor; a interface não tem de repetir esse vocabulário. */
function legivel(msg) {
  const t = String(msg || '');
  if (!t) return 'não aconteceu nada — tenta outra vez';
  if (/GEOAPIFY|TAVILY|GOOGLE_|falta .*_API_KEY|falta .*_KEY/i.test(t)) return 'esta fonte de pesquisa não está disponível agora';
  if (/HTTP 429|limitar os pedidos/i.test(t)) return 'a fonte está a limitar os pedidos — espera um minuto';
  if (/não respondeu em|não consegui chegar/i.test(t)) return 'a fonte não respondeu a tempo — tenta outra vez';
  if (/não sei que categoria/i.test(t)) return 'não conheço essa atividade — experimenta uma das sugestões abaixo';
  if (/não encontrei/i.test(t)) return 'não encontrei esse sítio — tenta «cidade, país»';
  return t.length > 180 ? t.slice(0, 177) + '…' : t;
}

export function initLeads({ api = '/api', onTask = null } = {}) {
  const btn = document.getElementById('topLeads');
  const panel = document.getElementById('leadsPanel');
  if (!btn || !panel) return null;

  const P = {
    what: panel.querySelector('.ld-what'),
    where: panel.querySelector('.ld-where'),
    go: panel.querySelector('.go'),
    list: panel.querySelector('.ld-list'),
    hint: panel.querySelector('.ld-row2 .hint'),
    cnt: panel.querySelector('.ld-h .cnt'),
    close: panel.querySelector('.ld-close'),
    refresh: panel.querySelector('.ld-refresh'),
    task: panel.querySelector('.ld-task'),
    chips: panel.querySelector('[data-chips]'),
    fonte: panel.querySelector('[data-fonte]'),
    segs: [...panel.querySelectorAll('.ld-seg .ld-m')],
    opcoes: panel.querySelector('[data-opcoes]'),          // notícias · período (só na Web)
    topicos: [...panel.querySelectorAll('[data-topico]')],
    periodo: panel.querySelector('[data-periodo]'),
  };

  const S = {
    estado: null,        // /pesquisa/estado — o que está ligado, sem nomes de variáveis
    uso: null,           // /pesquisa/uso — quanto já se gastou hoje (1.30.0)
    categorias: [],      // /pesquisa/categorias — as sugestões
    resultados: [],      // o que veio desta pesquisa
    guardados: [],       // /ops/leads — o funil
    modo: 'places',
    ocupado: false,
    ms: null,
    topico: 'general',   // general | news
    dias: 0,             // 0 = sem recorte
    lidos: {},           // url → { texto, titulo } já extraídos pela Tavily
    aviso: '',        // a notícia do último pedido ('' = nenhuma)
    avisoMau: false,
  };

  const prontoEmpresas = () => !!S.estado?.fontes?.geoapify?.disponivel;
  const prontoWeb = () => !!S.estado?.fontes?.tavily?.disponivel;   // a pesquisa principal
  const pronto = () => (S.modo === 'web' ? prontoWeb() : prontoEmpresas());

  const open = () => { panel.hidden = false; btn.classList.add('on'); setModo(S.modo); carregar(true); P.what.focus(); };
  const close = () => { panel.hidden = true; btn.classList.remove('on'); };
  const toggle = () => (panel.hidden ? open() : close());

  const selo = (l) => (l.website ? '' : '<span class="ld-tag hot">sem site</span>')
    + (l.telefone ? '<span class="ld-tag ok">telefone</span>' : '')
    + (l.distancia != null ? `<span class="ld-tag">${(l.distancia / 1000).toFixed(1)} km</span>` : '');

  function leadHTML(l) {
    const site = l.website
      ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">${esc(String(l.website).replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>`
      : '<span class="ld-nosite">sem site</span>';
    const tel = l.telefone ? `<a href="tel:${esc(String(l.telefone).replace(/\s/g, ''))}">${esc(l.telefone)}</a>` : '';
    const mapa = Number.isFinite(l.lat) && Number.isFinite(l.lon)
      ? ` · <a href="https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lon}#map=18/${l.lat}/${l.lon}" target="_blank" rel="noopener">mapa</a>`
      : '';
    return `<div class="ld-lead">
      <div class="ld-main">
        <div class="ld-n">${esc(l.nome)}</div>
        <div class="ld-m">${esc(l.morada || l.cidade || '')}${tel ? ' · ' + tel : ''} · ${site}${mapa}</div>
        <div class="ld-tags">${selo(l)}${l.porque ? `<span class="ld-tag" title="${esc(l.porque)}">${esc(l.porque)}</span>` : ''}</div>
      </div>
      <div class="ld-score">${l.nota ?? '—'}<small>NOTA</small></div>
    </div>`;
  }

  function webHTML(r) {
    const host = String(r.url || '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0];
    const data = r.publicado ? new Date(r.publicado) : null;
    const quando = data && !Number.isNaN(data.getTime()) ? data.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short' }) : '';
    const lido = S.lidos[r.url];
    return `<div class="ld-web">
      <div class="ld-n"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.titulo || host)}</a></div>
      <div class="ld-m">${esc(host)}${quando ? ' · ' + esc(quando) : ''}${r.relevancia != null ? ' · relevância ' + r.relevancia : ''}
        <button type="button" class="ld-ler" data-ler="${esc(r.url)}" aria-expanded="${lido ? 'true' : 'false'}">${lido ? 'fechar' : 'ler a página'}</button></div>
      ${r.excerto ? `<div class="ld-m ld-x">${esc(r.excerto)}</div>` : ''}
      ${lido ? `<div class="ld-txt">${esc(lido.texto || 'a página não devolveu texto legível')}</div>` : ''}
    </div>`;
  }

  /* O rodapé de estado tem duas vozes: a notícia do último pedido (`S.aviso`) e,
     quando não há notícia, o retrato do que está ligado. Separá-las evita o bug
     clássico de a resposta da pesquisa ser apagada pelo repintar do estado. */
  function pintarAviso() {
    if (S.aviso) { P.hint.innerHTML = S.aviso; P.hint.classList.toggle('bad', !!S.avisoMau); return; }
    if (!S.estado) { P.hint.textContent = 'a ler as fontes…'; P.hint.classList.remove('bad'); return; }
    P.hint.classList.remove('bad');
    if (!pronto()) {
      P.hint.classList.add('bad');
      P.hint.textContent = S.modo === 'web' ? 'a pesquisa web está indisponível agora' : 'a pesquisa de empresas está indisponível agora';
      return;
    }
    if (S.modo === 'places') {
      const total = S.guardados.length;
      const semSite = S.guardados.filter((l) => !l.website).length;
      P.hint.textContent = `${total} ${total === 1 ? 'lead guardado' : 'leads guardados'} · ${semSite} sem site`;
    } else {
      P.hint.textContent = 'informação e contexto — nada disto é guardado como lead';
    }
  }

  const aviso = (html, mau = false) => { S.aviso = html; S.avisoMau = mau; pintarAviso(); };

  function pintarEstado() {
    if (P.fonte) {
      P.fonte.textContent = S.modo === 'web'
        ? (prontoWeb() ? (S.topico === 'news' ? 'Tavily · notícias' : 'Tavily · pesquisa principal') : 'pesquisa indisponível')
        : (S.estado?.fontes?.geoapify?.disponivel ? 'Geoapify · OpenStreetMap' : 'empresas indisponível');
    }
    /* o consumo não ocupa espaço: vive no título do selo da fonte */
    if (P.fonte && S.uso?.fornecedores) {
      const id = S.modo === 'web' ? 'tavily' : 'geoapify';
      const f = S.uso.fornecedores.find((x) => x.fornecedor === id);
      if (f) {
        const c = f.creditos || {};
        const teto = c.tetoDia == null ? 'sem tecto diário' : `${c.hoje || 0} de ${c.tetoDia} hoje`;
        P.fonte.title = `${f.nome || id} · ${teto}${c.tetoMes ? ` · ${c.mes || 0} de ${c.tetoMes} no mês` : ''} · ${f.cacheHits || 0} resposta(s) da cache · ${f.janela?.usadoNoMinuto || 0} de ${f.janela?.porMinuto || 0} no último minuto`;
      }
    }
    P.go.disabled = S.ocupado || !pronto();
    pintarAviso();
  }

  function pintarChips() {
    if (!P.chips) return;
    const lista = S.categorias.slice(0, 10);
    P.chips.hidden = !lista.length;
    P.chips.innerHTML = lista.length
      ? `<span class="ld-chips-lab">sugestões</span>${lista.map((c) => `<button type="button" class="ld-chip" data-cat="${esc(c.id)}" data-nome="${esc(c.id)}">${esc(c.id)}</button>`).join('')}`
      : '';
  }

  function pintarLista() {
    P.cnt.textContent = S.guardados.length ? `${S.guardados.length} GUARDADOS` : '—';
    const linhas = S.resultados.length ? S.resultados : (S.modo === 'places' ? S.guardados.map(deLinha) : []);
    if (!linhas.length) {
      P.list.innerHTML = `<div class="ld-empty">${!pronto()
        ? 'Esta fonte está indisponível agora. O resto do escritório continua a funcionar.'
        : S.modo === 'web'
          ? 'Escreve o que queres saber e prime <b>PROCURAR</b> — devolvo fontes reais com excertos.'
          : 'Ainda não há leads. Escreve uma atividade e um sítio — por exemplo <b>dentistas</b> em <b>Coimbra</b> — e prime <b>PROCURAR</b>.'}</div>`;
      return;
    }
    P.list.innerHTML = linhas.map(S.modo === 'web' ? webHTML : leadHTML).join('');
  }

  /* uma linha da base (`/ops/leads`) tem os nomes em inglês; a gaveta fala português */
  const deLinha = (l) => ({
    nome: l.name, cidade: l.city, morada: l.address || l.city, telefone: l.phone,
    website: l.website, email: l.email, nota: l.score, porque: l.notes || '', lat: l.lat, lon: l.lon,
  });

  async function carregar(tambemGuardados = false) {
    try {
      const [e, l, u] = await Promise.all([
        pedir('/pesquisa/estado'),
        tambemGuardados ? pedir('/ops/leads?limit=30') : Promise.resolve(null),
        /* 1.30.0: o consumo do dia, para se ver o travão antes de bater nele */
        pedir('/pesquisa/uso').catch(() => null),
      ]);
      S.estado = e.dados?.fontes ? e.dados : S.estado;
      if (u?.dados?.fornecedores) S.uso = u.dados;
      if (l?.dados?.leads) S.guardados = l.dados.leads;
      if (!S.categorias.length) {
        const c = await pedir('/pesquisa/categorias').catch(() => null);
        S.categorias = c?.dados?.categorias || [];
        pintarChips();
      }
      pintarEstado(); pintarLista();
    } catch {
      aviso('não consegui falar com o servidor', true);
    }
  }

  async function procurar() {
    const oQue = P.what.value.trim();
    const onde = P.where.value.trim();
    if (!oQue) {
      aviso(S.modo === 'web' ? 'escreve o que queres saber.' : 'diz o que procurar — por exemplo «dentistas».', true);
      P.what.focus();
      return;
    }
    if (S.modo === 'places' && !onde) {
      aviso('diz também a zona — por exemplo «Coimbra».', true);
      P.where.focus();
      return;
    }
    S.ocupado = true; P.go.disabled = true;
    const antes = P.go.textContent;
    P.go.textContent = 'A PROCURAR…';
    aviso(S.modo === 'web' ? `a procurar «${esc([oQue, onde].filter(Boolean).join(' '))}» na web…` : `a procurar «${esc(oQue)}» em ${esc(onde)}…`);
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    try {
      const r = S.modo === 'web'
        ? await pedir('/pesquisa/web', {
          metodo: 'POST',
          corpo: {
            consulta: [oQue, onde].filter(Boolean).join(' '),
            limite: 10,
            topico: S.topico,
            ...(S.dias ? { dias: S.dias } : {}),
          },
        })
        : await pedir('/pesquisa/leads', { metodo: 'POST', corpo: { oQue, onde, limite: 20 } });
      S.ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
      if (!r.ok || r.dados?.ok === false) throw new Error(r.dados?.erro || r.dados?.error || 'a pesquisa falhou');
      const d = r.dados || {};
      if (S.modo === 'web') {
        S.resultados = d.resultados || [];
        const resposta = d.respostaCurta ? `<b>${esc(d.respostaCurta)}</b><br>` : '';
        aviso(`${resposta}${d.encontrados ?? S.resultados.length} fontes em ${(S.ms / 1000).toFixed(1)} s · nada disto é guardado como lead`);
      } else {
        S.resultados = d.leads || [];
        const g = d.guardados;
        const noticia = `${d.encontrados ?? S.resultados.length} empresas em ${(S.ms / 1000).toFixed(1)} s`
          + (g ? ` · <b>+${g.novos} novos</b> guardados (${S.guardados.length + g.novos} na lista) · ${g.repetidos} já existiam` : '');
        await carregar(true);   // o carregar repinta o estado; a notícia entra depois, para não ser apagada
        aviso(noticia);
      }
      pintarLista();
      if (!S.resultados.length) {
        P.list.innerHTML = `<div class="ld-empty">${S.modo === 'web'
          ? 'Nada para esse pedido. Tenta outras palavras.'
          : 'Nenhuma empresa para esse pedido. Tenta uma atividade e um sítio mais concretos.'}</div>`;
      }
    } catch (e) {
      aviso(esc(legivel(e.message)), true);
    } finally {
      S.ocupado = false; P.go.textContent = antes || 'Procurar';
      pintarEstado();
    }
  }

  /* A Tavily lê a página inteira quando o excerto não chega (`/extract`).
     Guarda-se por URL: ler duas vezes a mesma página é gastar créditos à toa. */
  async function lerPagina(url, botao) {
    if (S.lidos[url]) { delete S.lidos[url]; pintarLista(); return; }
    if (botao) { botao.disabled = true; botao.textContent = 'a ler…'; }
    try {
      const r = await pedir('/pesquisa/pagina', { metodo: 'POST', corpo: { url } });
      const d = r.dados || {};
      if (!r.ok || d.ok === false) throw new Error(d.erro || 'não consegui ler a página');
      S.lidos[url] = { titulo: d.titulo || '', texto: (d.texto || '').slice(0, 1400) };
      pintarLista();
    } catch (e) {
      aviso(esc(legivel(e.message)), true);
      if (botao) { botao.disabled = false; botao.textContent = 'ler a página'; }
    }
  }

  const pintarOpcoes = () => {
    if (!P.opcoes) return;
    P.opcoes.hidden = S.modo !== 'web';
    if (P.periodo) P.periodo.hidden = S.topico !== 'news';
    for (const b of P.topicos) {
      const on = b.getAttribute('data-topico') === S.topico;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  function setModo(k) {
    S.modo = k === 'web' ? 'web' : 'places';
    S.resultados = [];
    S.aviso = ''; S.avisoMau = false;
    for (const b of P.segs) {
      const on = b.dataset.k === S.modo;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    P.what.placeholder = S.modo === 'web' ? 'quem lidera o mercado de clínicas em Lisboa' : 'dentistas';
    P.where.placeholder = S.modo === 'web' ? 'zona (opcional)' : 'Coimbra';
    P.where.hidden = false;
    if (P.task) P.task.hidden = S.modo === 'web';
    S.lidos = {};
    pintarOpcoes();
    pintarEstado(); pintarLista();
  }

  for (const b of P.segs) b.addEventListener('click', () => setModo(b.dataset.k));

  btn.addEventListener('click', toggle);
  P.close.addEventListener('click', close);
  P.refresh.addEventListener('click', () => { S.resultados = []; carregar(true); });
  P.go.addEventListener('click', procurar);
  P.what.addEventListener('keydown', (e) => { if (e.key === 'Enter') procurar(); });
  P.where.addEventListener('keydown', (e) => { if (e.key === 'Enter') procurar(); });
  for (const b of P.topicos) {
    b.addEventListener('click', () => {
      S.topico = b.getAttribute('data-topico') === 'news' ? 'news' : 'general';
      if (S.topico === 'general') S.dias = 0;
      if (P.periodo) P.periodo.value = String(S.dias);
      pintarOpcoes(); pintarEstado();
    });
  }
  if (P.periodo) {
    P.periodo.addEventListener('change', () => { S.dias = Number(P.periodo.value) || 0; });
  }
  if (P.list) {
    P.list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ler]');
      if (!b) return;
      e.preventDefault();
      lerPagina(b.getAttribute('data-ler'), b);
    });
  }
  if (P.chips) {
    P.chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nome]');
      if (!b) return;
      P.what.value = b.getAttribute('data-nome');
      P.what.focus();
    });
  }
  if (P.task) P.task.addEventListener('click', () => {
    const top = (S.resultados.length ? S.resultados : S.guardados.map(deLinha)).slice(0, 6);
    if (!top.length) { aviso('procura primeiro — depois disto escrevo a tarefa.', true); return; }
    const texto = `Abordar estes ${top.length} negócios reais, um a um, com uma mensagem própria (sem site = proposta de site, com site = melhoria): `
      + top.map((l) => `${l.nome}${l.cidade ? ' (' + l.cidade + ')' : ''}`).join('; ')
      + '. Escreve o email de cada um, o assunto e a razão de os escolher.';
    if (onTask) onTask(texto);
    else {
      const caixa = document.querySelector('.tp-in');
      if (caixa) { caixa.value = texto; caixa.focus(); caixa.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    close();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
    if ((e.key === 'l' || e.key === 'L') && !e.metaKey && !e.ctrlKey && !/input|textarea|select/i.test(e.target.tagName)) toggle();
  });

  /* o botão da barra fica apagado quando nenhuma fonte responde — discreto, sem manuais */
  pintarOpcoes();
  carregar(true).then(() => btn.classList.toggle('off', !(prontoEmpresas() || prontoWeb()))).catch(() => {});
  return { open, close, toggle };
}
