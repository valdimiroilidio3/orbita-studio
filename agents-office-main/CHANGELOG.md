## 1.1.0 — 26 out 2026 · Operação a sério

- **Os dados ficam guardados.** Nova camada `src/ops/` sobre **SQLite** (`node:sqlite`, sem dependências): `leads`, `messages`, `events`, `jobs`, `consents`, `usage`, `meta` em `data/orbita.db`. Um reinício deixa de perder trabalho. O esquema é versionado (`SCHEMA_VERSION`), para o caminho para Postgres/Supabase ser escrito e não adivinhado.
- **Pontuação explicada.** Cada lead tem `score` (0–100) **e** `score_reasons` («sem site (+25) · telefone público (+15) · avaliação 3,8 (+10)»). A nota recalcula-se sobre o lead completo — um segundo contacto sem telefone não apaga o que já se sabia.
- **Sem duplicados, a sério.** Chave por domínio → 9 dígitos finais do telefone → email → nome+cidade. Uma segunda entrada atualiza os dados factuais e **preserva** o que é do dono: estado, notas, consentimento, seguimento.
- **Funil com regras.** `novo → contactado → respondeu → reuniao → cliente`, com `perdido` em qualquer ponto; saltar de «novo» para «cliente» é recusado com a frase do funil.
- **Mensagens com aprovação.** `rascunho → aprovada → enviada`; só o dono aprova, e só uma aprovada pode sair. Email exige `RESEND_API_KEY` **e** consentimento registado; o WhatsApp é um link `wa.me` revisto e enviado à mão, com **JÁ ENVIEI** a confirmar — o Órbita não finge que enviou.
- **Opt-out que manda.** `POST /api/ops/consent/opt-out` bloqueia o email/telefone em definitivo; a partir daí as mensagens ficam `bloqueada` e o lead em `perdido` se ainda não era cliente.
- **Aquecimento do número.** Poucos envios no primeiro dia, a subir por dia até um teto, mais limite por minuto (6) — e a recusa explica o limite em vez de falhar em seco.
- **Fila com tentativas.** Trabalho persistente em `jobs`: falha → volta com espera crescente (15 s → 1 h) → desiste ao fim de `max_attempts`, com o erro escrito. O servidor drena a fila a cada 2 s.
- **Auditoria e custos.** Cada ação escreve em `events` (quem, o quê, quando, sobre o quê). `usage` soma o consumo por fornecedor; `/api/ops/summary` mostra funil, conversão e margem — com `null` e a razão quando não há dados suficientes.
- **A gaveta ◉ OPERAÇÃO.** Na barra: leads com nota e razões, mudança de estado no funil, mensagens à espera de OK (aprovar / rejeitar / abrir WhatsApp / já enviei), fila e rasto.
- **A pesquisa passa a gravar na base de dados.** `/api/google/search` continua a guardar na gaveta e passa a gravar também em `orbita.db`, pontuado e sem duplicados (`baseDeDados: { created, updated, refused }`). O que já estava só em `data/leads.json` entra com `POST /api/ops/leads/importar-gravados`.
- **Provas.** `ops.test.mjs` (12 testes, SQLite em memória, nenhum serviço externo) e cinco passos novos no `check.mjs` com um servidor isolado que exercita as rotas sem tocar nos dados do dono: **55 verificações** (a do navegador continua a falhar sem Chrome). Guia em **OPS.md**.

## 1.2.0 — 26 out 2026 · Hoje, e a base que não se vê

- **O ecrã «Hoje».** Um só ecrã com três perguntas: o que precisa da tua decisão, o que aconteceu enquanto dormias, o que vai acontecer. Abre com `HOJE` na barra (ou `H`), e na primeira visita de cada seis horas abre sozinho quando há algo à tua espera.
- **A decisão é um gesto.** Deslizar para a direita aprova, para a esquerda rejeita, toque longo abre o porquê. Cada gesto tem botão e tecla equivalentes (`←` rejeitar, `→` aprovar) — teclado e leitor de ecrã não ficam de fora. Decisões otimistas: o cartão sai já e volta com a razão se o servidor recusar.
- **Porquê em cada cartão**, feito só com dados guardados (as razões da nota do lead, o canal, o estado, os dias sem resposta). Sem dados que cheguem, o cartão não aparece.
- **Eventos encadeados.** Cada linha de `events` leva o hash da anterior; `GET /api/ops/events/verify` fecha a cadeia ou diz em que linha partiu. O feed do «aconteceu» traduz os eventos em frases.
- **Outbox com idempotência.** O envio é escrito antes de sair, com chave única (mensagem + conteúdo) e aluguer com prazo. Pedir duas vezes é pedir uma; um processo que morre não deixa trabalho preso; um email resgatado depois de um crash vai para `revisao` em vez de se repetir às cegas.
- **Interruptor de emergência.** `POST /api/ops/stop` pára todos os envios de todos os caminhos, com a razão dita na recusa; o ecrã Hoje mostra-o ligado.
- **Tokens de design e acessibilidade.** Espaçamento em múltiplos de 4, escala tipográfica, cores semânticas (`--ok`, `--warn`, `--risk`), modo escuro de raiz, `aria-modal`/`aria-live`, foco visível e `prefers-reduced-motion`.
- **Estados vazios que ensinam** o próximo passo em vez de «sem resultados». **Provas:** 17 testes em memória e **59 verificações** (a do navegador falha sem Chrome).

## 1.3.0 — 26 out 2026 · Personalização por lead

- **Ver o negócio antes de lhe escrever.** `POST /api/ops/leads/:id/pesquisar` lê o site do lead uma vez — respeitando `robots.txt`, recusando endereços privados (SSRF), com 12 s e 400 KB — e guarda factos com a frase de onde saíram: sem versão móvel, rodapé de 2019, sem `https`, sem formulário, sem marcação, plataforma, Instagram, a descrição escrita pela própria casa. O texto inteiro não é guardado, só o que se pode citar. Falhas ficam com o motivo em português (DNS inexistente, 403, tempo esgotado…), nunca com um dossiê inventado.
- **Oportunidade separada da nota.** A soma dos factos dá uma nota de 0–100 que diz quanto trabalho há ali — distinta do valor do lead.
- **Mensagem presa aos factos.** Com motor de IA, o prompt só pode citar a lista de factos; `guardDraft` recusa a mensagem inteira se aparecer uma citação inventada ou uma promessa («o melhor do mercado»). Sem motor, um modelo local escreve na mesma. O rascunho diz sempre de onde veio (`generated_by`) e porquê (`why`).
- **Objeções previstas com resposta pronta** — regras do negócio, não do modelo: Instagram, preço, falta de tempo, «já tenho quem faça», mais as específicas do que se viu no site.
- **A oferta é do dono** (`GET/POST /api/ops/oferta`: nome, preço, prazo, garantia) e entra nas mensagens e nas respostas.
- **Ciclo que fecha.** `POST /api/ops/messages/:id/sinal` com respondeu/interessado/reuniao/cliente/ignorou/recusou/pediu_parar. Cada sinal guarda os atributos do lead, e daí saem pesos com amortecimento e **amostra mínima de 3**; a nota passa a ter `score_base` + `score_learned` (±12), com a razão escrita. Os sinais também movem o funil.
- **Na interface:** o cartão de Hoje mostra os factos e as objeções em «Ver porquê»; a gaveta OPERAÇÃO ganhou `PESQUISAR`, o dossiê e `ESCREVER COM OS FACTOS`, e botões de sinal nas mensagens enviadas, com o que se aprendeu na aba da fila.
- **Provas:** 27 testes em memória (robots, SSRF, falhas, citação inventada, pesos, amostra) e **63 verificações** — a do navegador continua a falhar sem Chrome.

## 1.4.0 — 26 out 2026 · Autonomia graduada, agência e saldo

- **A autonomia não se dá: ganha-se.** Cada tipo de mensagem (canal + gancho, ex.: `whatsapp:sem-site`) começa em **pede-me sempre**. O Órbita só propõe enviar sozinho quando há **50 casos decididos** com **95% de aprovações** (limiares configuráveis em `POST /api/ops/autonomia/limiar`). Antes disso diz o que falta, por palavras: «faltam 47 casos decididos (3/50)». Um `409` é a resposta a quem tente subir sem amostra — a não ser com `force` explícito, que fica registado com a razão.
- **A autonomia nunca passa por cima dos travões.** A aprovação automática continua a respeitar opt-out, o interruptor de emergência, o aquecimento do canal e o **modo ensaio**. Descer é sempre possível, com um toque, e nunca falha.
- **Modo ensaio.** Uma semana a escrever tudo e a não enviar nada: as mensagens nascem em `ensaio`, o **Hoje** avisa, e o relatório diz o que teria saído, por tipo, com uma amostra. Uma mensagem em ensaio pode ser promovida a rascunho (`…/promover`) ou rejeitada — e as duas coisas contam como decisão.
- **Avaliações com versão de prompt.** `src/ops/evals.mjs` traz um conjunto fixo de casos (negócio sem site, site de 2019, clínica moderna sem marcação, motor que inventa, motor honesto) e três guardas. `node evals.mjs` → **8/8** com o prompt `rascunho-v1`; o resultado fica guardado em `evals` com a versão, e uma corrida pior do que a anterior aparece como **regressão**, com o aviso escrito.
- **Modo agência — um ficheiro por cliente.** `src/ops/tenants.mjs`: cada cliente tem a sua pasta (`data/clientes/<slug>-<id4>/orbita.db`), o seu esquema e a sua oferta. O registo vive em `data/clientes.db`; o espaço activo fica nas definições e troca-se no select **Espaço** da gaveta. Um erro de consulta não pode misturar leads de dois negócios — é isolamento, não uma coluna `cliente_id`.
- **Onboarding em três passos**, ditos com o que falta: procurar leads (e a chave que isso exige), escrever, decidir. Criar um cliente leva segundos e acaba em algo concreto.
- **Saldo real.** `src/ops/money.mjs`: entradas registadas à mão (`POST /api/ops/receita`), custos de API somados da tabela `usage`, **margem**, receita por campanha, custos por fornecedor e custos unitários (por lead, por contactado, por cliente). Sem entradas, a margem é **negativa** e o ecrã diz porquê — não é zero.
- **Na gaveta:** select de cliente com `+ CLIENTE`, abas **AUTONOMIA** (nível por tipo, dar/revogar, ensaio, avaliações) e **SALDO** (entrou, gastou, margem, registar entrada, tabelas). O cartão de Hoje ganhou o tipo **autonomia**: a proposta de enviar sozinho aparece onde se decide, com `→` a dar e `←` a recusar.
- **Provas:** `ops.test.mjs` passa a **36 testes** (autonomia com e sem amostra, opt-out a mandar sobre a autonomia, ensaio, regressão nos evals, saldo negativo, isolamento entre clientes) e o `check.mjs` a **67 verificações**, com quatro provas novas contra um servidor isolado: `409` sem amostra, ensaio que não deixa sair, avaliações guardadas, e um cliente novo que vê **0 leads** do anterior. A do navegador continua a falhar sem Chrome.

## 1.5.0 — 26 out 2026 · A mesa de trabalho: leads e aprovação

- **Uma superfície para decidir, ao lado do escritório.** `/app` (botão **▤ MESA** na barra) abre uma página sóbria, de produto: barra lateral com **Hoje**, **Leads**, **Conversas** e **Saldo**, cartões brancos, um azul só para o que é acção. O escritório 3D continua onde está — é lá que os agentes trabalham; a mesa é onde tu decides. Construída como um ficheiro só (`dist/mesa.html`, 46 KB, sem pedidos externos), com entrada própria no `build.mjs` para não arrastar o three.js.
- **A página de leads.** Procura por nome, cidade, nicho, telefone, email ou site; filtros **Todos / Por contactar / Sem site / Responderam**; cada linha traz o nicho e a cidade, a nota com cor, o estado do funil e o contacto. Sem leads, o estado vazio diz de onde eles vêm.
- **A página de aprovação (cada lead).** O texto pronto numa bolha, o canal e o estado por palavras («por aprovar», «aprovada — falta enviar», «em ensaio — não sai»), **Porquê este lead** com os sinais que existem mesmo (as razões da nota e os factos lidos no site), e **Rejeitar** / **Aprovar e enviar**. Aprovar abre o link do WhatsApp com o texto; depois **Já enviei** confirma. Email tenta o envio e mostra a recusa por palavras se faltar token ou consentimento. Sem mensagem, a página mostra os sinais e dois botões: **Ler o site** e **Escrever mensagem**.
- **O que sabemos e o histórico**, na mesma página: telefone, email, site, avaliação, origem, estado, o resultado da última leitura do site (com o motivo quando falha) e todas as mensagens daquele lead com o estado de cada uma.
- **Hoje, na mesa.** Quatro números reais (leads novos, com contacto, respostas desde ontem, custo de APIs a 30 dias), a lista **Precisa de ti** e, ao lado, a mensagem com o porquê e a decisão. As propostas de autonomia aparecem aqui como cartões próprios, com dar/recusar.
- **Saldo, na mesa.** Entrou, gastou, margem; registar uma entrada; receita por campanha, custos por fornecedor, custos unitários e as entradas com a data.
- **O interruptor de emergência é o mesmo** — o estado real (`PARAR TUDO`) está no canto de todas as páginas e liga/desliga pelo servidor, com a frase dita.
- **Telemóvel**: barra inferior com as quatro secções, uma coluna, acções pegadas ao fundo, alvos de toque de 44 px, `aria-current`, foco visível e `prefers-reduced-motion`.
- **Servidor:** nova rota `GET /api/ops/leads/:id` (lead + dossiê + mensagens numa só resposta), filtro `?leadId=` em `/api/ops/messages`, e `/app`·`/mesa` a servir a página. `dist/mesa.js` para desenvolvimento.
- **Provas:** **69/70** verificações — duas novas, contra o servidor isolado: `/app` serve a página construída, e o lead vem com dossiê e mensagens. A do navegador continua a falhar sem Chrome. `ops.test.mjs` 36/36 e `node evals.mjs` 8/8 sem alterações.

## 1.6.0 — 26 out 2026 · Do lead ao código, com provas

- **Projetos a sério.** Nova tabela `projects` (esquema **v5**) com briefing, objetivos, páginas, funcionalidades, critérios de aceitação, stack, estado e pasta própria em `data/projetos/<slug>/`. Um negócio, um projeto: índice único em `lead_id`, e a recusa diz qual é o projeto que já existe.
- **Motor de geração real** (`src/ops/generate.mjs`): quatro pontos de partida — **página de conversão**, **site institucional** (4 páginas), **loja** com catálogo e carrinho, **sistema interno** com indicadores e exportação CSV. Escreve ficheiros que abrem no browser: HTML semântico, CSS responsivo, JavaScript validado. Sem CDN, sem fontes remotas, sem dependências: abre offline.
- **Nada inventado nos dados.** A loja lê `data/products.json` e o sistema lê `data/dataset.json`; ambos nascem vazios, com estados vazios que ensinam a preencher. Não há produtos nem números de demonstração a passar por verdade.
- **QA com critérios objetivos** (`src/ops/qa.mjs`): ficheiros obrigatórios, doctype/lang/viewport/título, um só `h1`, links internos que existem, recursos externos (bloqueados), rótulos em formulários, `alt` em imagens, JavaScript que compila (`vm.Script`), CSS com chaves fechadas e `@media`, JSON válido, e um pente de honestidade (lorem ipsum, TODO, placeholders). Três níveis: crítico, importante, menor. Guarda o **manifesto sha256** de cada corrida em `qa_runs`.
- **Entrega só com provas.** Aprovar exige QA aprovado **e** ficheiros iguais aos auditados; entregar exige aprovação. Se algo mudar depois da auditoria, a entrega é **bloqueada** com a lista dos ficheiros. O **preview é real**: `/preview/<id>/` serve os ficheiros gerados pelo próprio Órbita (com proteção contra `..`), e `GET …/zip` devolve o projeto em ZIP (escrito à mão, PKZIP válido, nomes UTF-8).
- **Vercel e GitHub não fingem.** Sem `VERCEL_DEPLOY_HOOK`, a recusa nomeia a variável que falta; com o hook, o pedido é registado como **pedido** — «pedir não é estar publicado». O envio de ficheiros para o GitHub não está implementado e diz isso.
- **Funil comercial completo**: `novo → qualificado → contactado → em negociação → proposta → ganho`, com `perdido` em qualquer ponto e o caminho curto antigo preservado. Saltos recusados com a frase do funil.
- **Guarda da porta** (`src/ops/guard.mjs`): limitador de 300 pedidos/minuto por IP (429 com o tempo de espera) e, se `ORBITA_ADMIN_TOKEN` (16+) existir, `/api/ops` passa a exigi-lo (cabeçalho `x-orbita-admin`, `Bearer` ou cookie). Sem a variável, o arranque diz em voz alta que está em **modo local, sem palavra-passe**. O escritório e a mesa pedem o token uma vez e guardam-no no browser.
- **Registo de execução**: cada geração e cada QA deixam linha em `jobs` (estado, início, fim, resultado) — evidência do que correu, não só do que se disse.
- **Na mesa**: secção **Projetos**, com pipeline visual (briefing → código → qualidade → aprovação → entrega), relatório de QA legível, lista de ficheiros com marca de «alterado», entregas e histórico; no lead, «Criar projeto» quando ainda não existe.
- **Provas:** `ops.test.mjs` **43 testes** (novos: geração dos quatro tipos, QA a apanhar links partidos/rótulos/lorem, entrega bloqueada por alteração, ZIP válido, funil comercial, guarda e ritmo) e `check.mjs` **74/75** — cinco passos novos de ponta a ponta contra um servidor isolado: lead → qualificar → projeto → gerar (4 ficheiros, 14 KB) → QA → aprovar → entregar → preview HTTP 200 com HTML e CSS reais → mexer invalida a aprovação → Vercel/GitHub recusam com o nome do que falta. A verificação do navegador continua a falhar sem Chrome.

## 1.7.0 — 26 out 2026 · Tarefas com estado real, funil medido e a guarda fechada

- **Tarefas dos seis departamentos** (`src/ops/tasks.mjs`, esquema **v6**): máquina de estados `queued → running → succeeded | failed | awaiting_approval`, com departamento, tentativas limitadas, prazo por tarefa, resultado, evidência e duração. **Uma tarefa aberta por chave** (índice parcial único) — dois pedidos simultâneos do mesmo trabalho devolvem a mesma tarefa. Um processo que morre a meio é recuperado no arranque: o que passou do prazo volta à fila ou falha com o motivo.
- **Aprovação humana** para acções de risco: a tarefa corre, fica em `awaiting_approval` e só passa a `succeeded` com `aprovar` — quem aprovou e quando fica escrito. Repetir uma tarefa falhada é possível até ao limite de tentativas; a anterior fica no registo.
- **Nada inventado sem motor**: as tarefas que precisam de IA (`mensagem.redigir`, `conteudo.rascunho`, `projeto.corrigir`) falham com o motivo escrito quando não há chave — não devolvem um resultado de faz-de-conta. As determinísticas (qualificar, pesquisar, proposta, briefing, gerar, QA, entregar preview, revisão de prioridades) correm sempre.
- **Qualificar avança o funil**: um lead novo com nota ≥ 60 passa a `qualificado`, com o motivo em `events`.
- **Painel de agentes com estado lido da base** (`#/agentes`): cada departamento mostra o que fez, o que falhou e o que está na fila; «a trabalhar» só quando há uma tarefa em `running`. Sem tarefa, sem movimento.
- **Funil medido** (`metrics.pipeline`): quantos leads chegaram a cada fase (estado atual + histórico em `events`), conversão entre fases, taxa por origem com data de recolha, e **oportunidades paradas** há mais de 14 dias.
- **Pesquisa global** (`src/ops/search.mjs`): leads, projetos e tarefas numa só resposta, sem depender de acentos; uma letra não pesquisa.
- **Painel de atividade**: tarefas, jobs de fila e eventos recentes, com a última falha à vista.
- **Guarda fechada**: além do ritmo (300/min por IP) e do token opcional, um pedido mutável autenticado por **cookie** vindo de outra origem é recusado (**403, CSRF**). O cabeçalho `x-orbita-admin` não sofre disto.
- **QA honesto sobre o navegador**: o relatório passa a dizer se os testes de navegador correram; neste ambiente saem como **não executados, com o motivo** — nunca como aprovados.
- **Na mesa**: secções **Tarefas** (filtros por departamento e estado, correr/repetir/aprovar/rejeitar, resultado e evidência) e **Agentes**; cartão do **Funil** nos leads; pesquisa global em leads e projetos; barra de navegação com seis secções no telemóvel.
- **Provas:** `ops.test.mjs` **54 testes** (11 novos: duplicados, falha sem motor, prazo, tentativas, aprovação, recuperação, painel, funil, paradas, pesquisa, CSRF); `check.mjs` **85/86** com dez passos novos de ponta a ponta — incluindo **quatro pedidos em paralelo a criar uma só tarefa** e **reinício do servidor com dados intactos** (3 leads, 6 tarefas, 1 projeto). Só a verificação de navegador falha, por não haver Chrome.

## 1.8.0 — 26 out 2026 · Contas, sessões e papéis

- **Autenticação ≠ autorização, finalmente separadas.** Havia uma palavra-passe para a instalação toda: quem a tinha podia tudo. Agora há **contas** (esquema **v7**: `users`, `sessions`, `auth_attempts`), **sessões** com prazo e revogação, e **quatro papéis** com permissões declaradas:
  - **dono** — tudo: contas, aprovações, entregas, dinheiro e oferta;
  - **gestor** — aprova, entrega e pára envios; não mexe em contas;
  - **operador** — cria e edita leads, projetos, mensagens e tarefas; não aprova nem entrega;
  - **leitor** — vê tudo, não altera nada.
- **A regra vive no servidor.** `permFor(método, rota)` mapeia cada rota para `read`, `write`, `approve` ou `admin`; a mesa esconde o que o papel não permite (cortesia), mas quem recusa é o servidor com **403** e o motivo em palavras.
- **Palavras-passe com scrypt** (N=16384, sal próprio) — nunca em claro, nunca em log, nunca devolvidas por uma API. Política mínima de 12 caracteres que recusa as óbvias, o próprio email e o próprio nome.
- **Sessões** com token de 32 bytes aleatórios; na base fica só o **sha256**. Cookie **HttpOnly + SameSite=Strict + Path=/** (e `Secure` quando é https). Prazo de 12 h configurável, revogação individual na mesa, e trocar a palavra-passe fecha todas as sessões.
- **Primeira conta** criada em `/app` e só enquanto não existir nenhuma — depois disso, só um dono cria contas. O arranque passa a dizer em palavras o modo: contas, token de máquina ou **modo local sem palavra-passe**.
- **Força bruta**: 20 tentativas de entrada por minuto e por IP, e **5 falhas numa conta bloqueiam-na 15 minutos**; o email vai em **hash** para o registo de tentativas, para não deixar dados pessoais em claro. A resposta é a mesma para conta inexistente e palavra-passe errada.
- **O escritório 3D** passa a estar sob a mesma guarda (`/api/tasks`, `/api/chat`, `/api/email`, `/api/deploy`, …): em modo local continua aberto; com contas, quem não entrou é levado a `/app`.
- **Na mesa**: ecrã de entrada (e de criação da primeira conta), nome e papel no rodapé, «Sair», e a secção **Contas** (só para dono) com lista de contas, mudança de papel, criação, desactivação e sessões activas com botão para fechar.
- **Configuração**: `ORBITA_SESSION_HOURS`, `ORBITA_SECURE_COOKIE` e `ORBITA_AUTH=sessao` (desliga a credencial de máquina — o modo certo para expor na internet). O SQL de Postgres ganha `orbita_users`, `orbita_sessions` e `orbita_auth_attempts`, com RLS e sem qualquer política para `anon`.
- **Provas:** `ops.test.mjs` **63 testes** (9 novos: hashing e política, hierarquia de papéis, contas e primeira conta única, expiração/revogação de sessões, troca de palavra-passe que fecha tudo, bloqueio após 5 falhas sem email em claro, guarda com sessão/máquina/local, flags do cookie, estado de autenticação); `check.mjs` **92/93** com sete passos novos por HTTP — primeira conta e cookie `HttpOnly`, 401 com motivo, sessão a abrir `/api/ops`, matriz de papéis (`leitor lê=200 escreve=403 · operador escreve=201 aprova=403 · gestor aprova=200 contas=403 · dono contas=200`), bloqueio de 5 falhas, sair/revogar a fechar na hora e CSRF com cookie de sessão. Só a verificação de navegador falha, por não haver Chrome.

# Changelog

## 1.0.0 — 25 out 2026 · Órbita

- **Google Antigravity como motor.** O `agy` — o CLI da Google, sucessor do Gemini CLI — entra na lista de motores ao lado do Claude Code e do Codex: `agy --print-timeout 15m -p "<system + pedido>"`, com o envelope JSON desembrulhado e o binário procurado também em `~/.local/bin`. O Gemini CLI fica marcado como substituído.
- **Leads reais da Google.** O botão **◈ LEADS** procura empresas verdadeiras na **Places API (New)** — nome, morada, telefone, site, avaliação, mapa — e guarda tudo em `data/leads.json` sem duplicados (domínio → telefone → nome+morada), com uma nota de oportunidade explicada (sem site +40). A Prospeção e as Vendas leem os oito melhores leads por contactar em cada tarefa e escrevem com nomes reais, sem inventar contactos. **Programmable Search** (`GOOGLE_API_KEY` + `GOOGLE_CSE_ID`) traz informação da web. Sem chave, o escritório diz exatamente o que falta. Rotas: `GET /api/google`, `POST /api/google/search`, `GET /api/leads`, `POST /api/leads/status`. Guia em **PESQUISA.md**.
- **Horas de 24 horas, em todo o lado.** `00:00`–`23:59`, nunca AM/PM: um só módulo (`src/time.js`) formata todas as horas e datas, com `hour12: false` explícito e nomes portugueses escritos à mão; os campos de hora passam a mostrar as 24 horas do dia (`#hours24`) em vez do seletor AM/PM do sistema. Um teste do `check.mjs` falha se voltar a aparecer formatação de 12 horas no bundle.
- **Um caminho real para ligar outra IA.** O escritório deixou de estar preso ao Claude Code: `providers.mjs` traz **Claude Code**, **Codex** (`codex exec`), **Gemini** (`gemini -p`), uma **CLI genérica** — e as APIs **Claude, OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Gemini, Ollama, LM Studio** e **qualquer endpoint compatível com OpenAI**. A escolha é `AO_AI` → `data/ai.json` → `office.config.json` → `ai.fallback` → presets, com failover quando um não existe. O botão **IA** no painel abre a gaveta dos motores: o que está ligado, o que falta e porquê (em português), **TESTAR** (um turno curto a sério, com o texto e os milissegundos) e **USAR** (troca a quente, sem reiniciar). Rotas novas: `GET /api/ai`, `POST /api/ai/test`, `POST /api/ai/switch`; `/api/health` passa a dizer o motor ativo (`backend` + `ai`). Nada é instalado por nós e só o CLI do Claude dá ferramentas ao agente — os outros devolvem texto, e a UI diz «SÓ TEXTO». Sem motor nenhum, o escritório abre na mesma e o selo diz `SEM MOTOR DE IA`. Guia completo em **AI.md**.
- **Seis salas, um fluxo de trabalho real.** O escritório passa a ser a Órbita a operar de ponta a ponta: **ORBITA COMMAND** (o Director coordena as seis salas, distribui trabalho, deteta atrasos e agentes parados e mantém o painel central), **ORBITA PROSPECT** (o Lead Hunter encontra empresas sem site, diagnostica a presença digital, pontua e deduplica), **ORBITA SALES** (o Sales Closer aborda, responde a objeções, propõe, segue e agenda), **ORBITA DESIGN LAB** (o Creative Architect lê o briefing e entrega estrutura, identidade e design system), **ORBITA ENGINEERING** (o Systems Engineer constrói, integra, testa e publica) e **ORBITA MEDIA** (o Growth Publisher publica, mede e alimenta a prospeção com conteúdo).
- **O Cérebro, em 3D.** O grafo é agora um orbe: cada pasta é um aglomerado na superfície da esfera — o hub no centro do aglomerado, as notas à volta — e as arestas são arcos que abraçam a superfície em vez de mergulharem no centro. Cada hub leva um anel 3D na cor da pasta, inclinado à sua maneira. A lente é uma casca de vidro com orla de Fresnel (só as bordas apanham luz, como uma esfera de vidro a sério), um núcleo luminoso por dentro e um equador ténue — é isso que dá o volume. Há esbatimento por profundidade: o que está atrás perde cor e opacidade, e o orbe roda devagar (uma volta a cada ~62 s), que é o que faz ler a terceira dimensão. Assenta em dois anéis de luz na relva do plinto. Modo escuro com a sua própria paleta.
- **Paredes em cada sala.** Cada sala passou a ser uma sala a sério: um L de parede nos dois lados afastados da câmara — base sólida até à altura da secretária, vidro até acima do monitor, rodapé na cor da sala, remate e montantes na cor de tinta, e o nome da sala gravado na parede. O canto que dá para o Cérebro fica aberto: é a porta, e é por onde chega a passadeira. As paredes são clicáveis (focam a sala) e acompanham o modo escuro.
- **Cada agente tem função, tarefas, ferramentas e resultado.** Os 35 lugares ganharam nome, descrição de funções e ferramentas próprias (`office.agents.json`), uma fila de tarefas com estado (`src/tasks.js`), eventos de atividade e um ficheiro de resultado por agente (`FILE_GEN`). A animação mostra o estado; não substitui a execução.
- **Aprovação humana obrigatória.** Tudo o que sai da máquina — contactos, propostas, publicações, pagamentos, alterações — fica à espera do OK do proprietário, com o pedido escrito agente a agente.
- **Nada se perde na tradução.** Chaves internas mantidas (`emails`, `sales`, `ops`, `fin`, `delivery`, `marketing`); rótulos em português; rotinas aceites em Comando, Prospeção e Vendas; entrevista de configuração e competências seguem o mesmo plantel.

## 3.2.1-beta.2 — 19 Sep 2026

- **Licence.** LICENSE now opens with the Required Notices (Copyright 2026 Sahni.ai; Agents Office is a Sahni.ai product) and Sahni.ai's additional terms: the name and mark stay, no renaming or rebranding, no wiring it into or bundling it with another product, agent system or workforce, and anything else needs written permission. The PolyForm Noncommercial 1.0.0 text below them is unchanged. README says the same in plain English. No change to the office itself.

## 3.2.1-beta.1 — 16 Sep 2026

- **The calendar (P).** Month and week. Finished tasks on the day they finished, today's work on today, tasks scheduled for a date, and every routine projected forward on the days it will fire, one dashed card per run. A rail lists the routines themselves (cadence, agent, next run, paused, waits for your OK); click one to see only its days. Department filters, routines and done toggles, search. Click a card: a finished task opens the agent's chat; a routine run offers RUN NOW / PAUSE / DELETE; a scheduled task can be cancelled.
- **Schedule from a day.** Click any day: what should happen, department, time, model, ADD. Claude names the agent now; the server runs it at that minute, page open or not, LATE (once) if the office was off; it waits for your OK if it would send anything. REPEAT makes it a routine that starts on that date (`when.start`, e.g. `every weekday · 08:00 · from 5 Oct`) — on the grid from that day, never before.
- A **CALENDAR** button in the top bar, beside the approval counter, opens it too.
- **Sahni.ai branding.** The `sahni.ai_` wordmark (Kode Mono, embedded) as a small tile at the bottom-left of the office (out of the top bar; with a department in focus it sits at the top-left of the scene), linking to sahni.ai, and a licence line at the bottom of every view: © 2026 Sahni.ai · PolyForm Noncommercial 1.0.0 · free for personal and internal use · not for resale. Hidden in the website hero embed.
- Scheduled tasks show under the SCHEDULED chip and in the SCHEDULED column with CANCEL. `POST /api/tasks` takes `at`; `routines.json` takes `when.start`. Five more checks, one live (a task scheduled 75 s ahead fires and lands; a routine from a date waits for it).


## 3.2.0-beta.3 — 16 Sep 2026

- beta.2 shipped without `teams.mjs` (the release whitelist had not been told about it) and would not start; beta.3 is the same release with the file in, and the release script now refuses to assemble a build whose `serve.mjs` imports a file it is not shipping.

## 3.2.0-beta.2 — 16 Sep 2026

*Numbering: AJ's call, 16 Sep. This is a new release (Agent Teams + Claude in Chrome), not a patch of the 7 Sep 3.2.0-beta.1 (skills); the tag had to be free, and the 3.3–3.6.1 tags stay where they are.*

- **Agent Teams.** Press TEAM in the bar, or say "as a team" / "spawn three teammates to …", and the department lead takes the task, splits it into two to four independent pieces on the desks whose jobs or skills fit, the pieces run at the same time (one Claude process per desk, own context, brief, skills, lessons and connectors), teammates leave notes for each other and the lead (`@lead: …`, shown as 💬 over the desks), and the lead writes the finished deliverable from the pieces, ending with who did what. Piece cards (↳) sit on the teammates' desks, all IN PROGRESS together; each finished piece lands in that teammate's chat and walks back to the lead. The note in the brain carries the final, every piece, and the notes. `revise: …` reworks the final from the same pieces; APPROVE runs the lead's outbound step alone. `"team": true` on a routine. `teams.max` (default 4) and `teams.enabled` in the config. Built by the office from separate headless Claude sessions, because Claude Code's own agent teams only spawn in an interactive terminal.
- **Claude in Chrome.** Every run starts with `--chrome`; with the extension paired (`claude --chrome` once) the agents get the owner's own browser as a tool — open tabs, read pages, search, fill forms on any site the owner is signed in to. A Chrome tile in the bar, wired to every pod, lit when an agent is in the browser; grey with the fix on hover when the extension is not paired. Same rule as every connector: read freely, act on a site only when the task asks for that exact action; a login or CAPTCHA stops the agent. `tools.browser: false` (or `deny: ["Chrome"]`) keeps them out.
- Seven more checks (team intent, plan checking, notes, team routines, the browser flags and prompt, config defaults, the Chrome tile in `/api/mcp`), and two live ones: a real team task with two or more desks, and an agent reading a page in Chrome.


## 3.6.1-beta.1 — 9 Sep 2026

- **A bigger task box.** The bar is two rows now: the department and the text on top, the model menu, REPEAT and ADD underneath, so the text runs the width of the panel. The box grows as you type, up to six lines, then scrolls. Enter adds; Shift+Enter is a new line.
- **Effort, by name.** An EFFORT menu beside the model: AUTO, Low, Medium, High, Extra high, Max, the levels Claude Code uses. AUTO is the model's own (Opus runs at high). Set it on the task, the routine, the agent (`effort` in the roster) or the office (`effort` in the config), same precedence as the model; every card shows it beside the model name and the note records `effort:`.
- **The big editor.** The ⤢ button inside the box (or ⌘⇧E) opens the same task in a large window with room for a whole brief. It shows the department and the same hint line, ⌘↵ adds, Esc closes, and whatever you type there is in the bar when you close it.

## 3.6.0-beta.1 — 9 Sep 2026

- **Three models, by name.** Sonnet, Opus, Fable. Sonnet is the default for everything, including the routing call. A menu beside REPEAT sets the model for the task you are typing or the routine you are setting; agents take a `model` in the roster; the office default is `model` in the config. The task beats the routine beats the agent beats the office, and every card says which ran and where it was set. Opus runs at effort high; nobody sees an effort setting. Until now every run inherited the login's default model.
- **The usage gauge.** The top bar shows your Claude plan the way Claude Code's usage screen does: session and week, bar and percentage, reset times on hover, amber past 75 and red past 90. Read with the login token Claude Code keeps on this machine, sent only to Anthropic's usage endpoint, never stored. When that endpoint does not answer, the office's own count for the current five-hour window shows instead. No dollars anywhere. A live office shows Claude alone in RUNS HEADLESS ON.
- Three checks: the model table and precedence, the gauge parser and window count, and (live) a task set to Opus running on Opus.

## 3.5.0-beta.1 — 9 Sep 2026

- **Routines: the office runs on its own clock.** A task the office does by itself on a timetable — every weekday at 08:00, every Monday, every hour. Emails, Accounting and Sales in this release; the other departments say "later release" if you try.
- **Three ways to set one.** Type it in the bar with the time in the sentence ("every weekday at 8am, triage the inbox…") and the hint reads the schedule back before you press Add, or press REPEAT and pick a cadence and a time; tell a department lead in chat ("routines", "pause …", "run … now", "delete …" work too); or ask Claude Code, which writes `<brain>/Agents Office/routines.json` (`CLAUDE.md` says how).
- **Where they show.** A SCHEDULED chip in the Task Status panel with a countdown and RUN NOW / PAUSE / DELETE on every routine, a next-up line under the chips, a SCHEDULED column on the company board, a clock chip on the agent's name pill and a routines strip at the top of their chat.
- **The clock lives in the server.** `npm start` fires routines and runs them whether or not the page is open; the page polls and shows the card move. A run missed while the machine slept is caught up once when it comes back, marked LATE.
- **"Needs my OK" is real.** A routine that would send, pay or change anything prepares everything and waits in WAITING ON APPROVAL — the draft in the chat, the agent standing and waving. APPROVE and the agent does the outbound step with its tools; REJECT, say what should change, and it comes back reworked (and the correction is remembered). Read-only routines go straight to DONE. Per-routine switch.
- A live office no longer invents approvals: the theatre asks that used to make a random agent stand and wave are demo-only now, so WAITING ON APPROVAL means a real draft. Real work never waits behind theatre either: a task or routine of yours starts the moment it lands, and the demo job that desk was on is finished.
- Quieter at rest. A live office shows only real reads and writes on the Brain (no theatre glints, no six-second pulse), and the connector loom in the overview runs at about half the ink and half the crawl. Inside a department nothing changed.
- Seven more connector logos: Slack, Google Calendar, Google Drive, Webflow, Playwright, Higgsfield, TerriTool. Anything else still gets an initials tile.
- Routine notes carry `routine:` (and `approved:`) in their front matter. `npm run check` gains six checks: the schedule parser, refusals, the clock and catch-up, the demo bar flow, the API, and (live) a two-minute routine firing end to end.

## 3.4.0-beta.1 — 7 Sep 2026

- Every department now has a lead. Marketing Lead and Operations Lead join at the head of their pods (35 agents). Each runs their team, owns the department's set-up interview, and is where a task lands when Claude cannot pick a specialist.

## 3.3.0-beta.2 — 7 Sep 2026

- The built office page moved from the repo root to `dist/command-centre-v2.html`. Same file, same double-click demo, cleaner repo page. `build.mjs`, `npm start` and the checks all point there.

## 3.3.0-beta.1 — 7 Sep 2026

- **The lead interviews you.** Say "set up" to a department lead. Five questions, one at a time; then it writes a brief for each agent on its team and a skill for the job you described, into your brain, and tells you what it wrote and one task to try. "skip", "done", "cancel". A lead whose department has nothing of yours yet offers this in its greeting.
- **They learn from your corrections.** Every `revise: …` is recorded in `<brain>/Agents Office/feedback/<agent>.md`; Claude sorts it into a one-off or a standing rule, and standing rules go into that agent's prompt from then on. Plain Markdown, yours to edit. `/api/lessons` shows them.
- Roster, skills and lessons are re-read before every task and chat, so a brief no longer needs a restart.
- `/api/health` carries which departments are set up; the boot line says so too.

## 3.2.0-beta.1 — 7 Sep 2026

- **Skills: teach an agent how a kind of work is done.** A folder in your brain, `<brain>/Agents Office/skills/<name>/`, with a `SKILL.md` (when it applies, the steps, the shape, the rules) and the template or example beside it, bound to agents or departments in its front matter. Read in full before every task and chat turn for those agents; the deliverable names the skill it followed and the saved note records it. Re-read from disk on every task, so no restart. Three examples ship in `skills/`. Guide: `SKILLS.md`.
- **Briefs.** A `brief` field on any agent in the roster: standing instructions, up to 2,000 characters, read before every task and chat turn.
- **The roster can live in the brain.** `<brain>/Agents Office/agents.json` is read between the shipped roster and the local file.
- The router sees each agent's skills, so a task that names a kind of work lands on the agent who owns that skill.
- `CLAUDE.md` tells Claude Code how to turn an SOP, a template or a good example into a skill and where to write it. `npm run check` validates skills; `/api/skills` lists what is loaded.
- The shipped roster no longer names anyone: "the owner" throughout.

## 3.1.0-beta.3 — 7 Sep 2026

- One HTML file. The separate dark build is gone; `D` and http://localhost:4520/dark open the same file in dark mode.

## 3.1.0-beta.2 — 7 Sep 2026

- The Brain graph header names your business (it was hard-coded to one company).

## 3.1.0-beta.1 — 7 Sep 2026

- **Connectors are real.** The top bar shows the MCP servers your Claude Code is connected to (`claude mcp list`), not a demo list. Servers that need authentication show grey with the reason on hover and are not wired to any pod. Unknown servers get an initials tile. Nothing connected? The bar says so.
- **Agents use tools.** While they work, agents can call those same connected servers, plus web search (`tools.web`). Bash, file tools and sub-agents stay off. Standing rule: read freely; send, post, pay, delete or change data outside the machine only when the task explicitly asks for that exact action. A deliverable says which tools it used, the note records them, and the logos pulse with the real call.
- **The roster is yours.** `office.agents.json` holds the 33 agents: name, role, what they do, their tools. Override in `office.agents.local.json` (ignored by git). Departments, leads and seats stay fixed. A `CLAUDE.md` in the repo means you can open Claude Code in the folder and say what you want changed.
- `office.config.json` grew `mcp.allow` / `mcp.deny` / `mcp.departments` and `tools.web`; `timeout` (seconds) for long tool runs.
- Live chat now opens with the agent's real job description instead of the demo greeting and sample file.
- `npm run check` validates the roster and the connector endpoint.

## 3.0.0-beta.4 — 6 Sep 2026

- Dark mode: press D, add `#dark=1`, open `command-centre-v2-dark.html`, or visit http://localhost:4520/dark. The scene relights, pods and walkways re-tint, the Brain and wires swap ink.

## 3.0.0-beta.3 — 6 Sep 2026

- No more "demo" label: the panel shows LIVE · CLAUDE when the server is connected and nothing otherwise.

## 3.0.0-beta.2 — 6 Sep 2026

- The Brain strip is gone from the task panel. Open the Brain with G, by clicking the pod, or by its tag.

## 3.0.0-beta.1 — 6 Sep 2026

Agents Office v3 (Beta): the V3 office as a real, installable app.

- Six departments, 33 agents, each with a role, a voice and a task pool.
- Task Status panel with a command bar: type a task, pick the department, the office routes it to the right agent through Claude and the agent produces the deliverable, saved as a note in your brain folder.
- The Brain is your own folder of Markdown notes with `[[wiki links]]`, drawn as a graph over the centre pod, rebuilt live as agents write. `G` opens the full graph with search and a note preview.
- Chat with any agent: real conversation in that agent's persona, grounded in your notes. `revise: …` reworks the last deliverable.
- Runs on your existing Claude Code login, or on an API key if you set one. Nothing leaves your machine except the calls to Claude.
- `npm run check` — the build loop: build, offline smoke, server smoke; `npm run check:live` adds one real task and one chat turn.


## 0.1.0 — 7 Aug 2026

First public release: daemon-based office with inboxes, approvals and an outbox.
