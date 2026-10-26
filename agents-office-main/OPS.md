# Operação: a base de dados, a fila e o funil

Este documento descreve a camada que transforma o escritório de uma demonstração numa
operação: **os dados ficam guardados**, o trabalho que falha **volta a tentar**, nada sai
**sem o OK do dono**, e tudo deixa **rasto**.

Antes disto, o escritório vivia de ficheiros JSON (`data/leads.json`, `data/tasks.json`) e de
memória. Um reinício perdia trabalho a meio, uma mensagem podia sair sem ninguém a ter lido,
e não havia forma de responder a «quanto gastei este mês?» a não ser a olho.

## O que existe agora

| Peça | Onde | O que faz |
|---|---|---|
| Base de dados | `data/orbita.db` (SQLite, `src/ops/db.mjs`) | Tabelas `leads`, `messages`, `events`, `jobs`, `consents`, `usage`, `meta` |
| Leads | `src/ops/leads.mjs` | Entrada sem duplicados, pontuação com razões, funil, seguimentos, opt-out |
| Mensagens | `src/ops/messages.mjs` | `rascunho → aprovada → enviada`, aquecimento do canal, consumo |
| Fila | `src/ops/queue.mjs` | Trabalho persistente, tentativas com espera crescente, concorrência limitada |
| Métricas | `src/ops/metrics.mjs` | Funil, conversão, custos — com `null` e a razão quando não há dados |
| Gaveta | `src/ops.js` + `◉ OPERAÇÃO` na barra | Ver, aprovar, mudar de estado, ler o rasto |
| **Hoje** | `src/ops/today.mjs` + `src/today.js` + `HOJE` na barra | Um ecrã: decidir, o que aconteceu, o que vem |
| **Outbox** | `src/ops/outbox.mjs` | Envio escrito antes de sair, com chave de idempotência e aluguer |
| **Registo** | `src/ops/events.mjs` | Eventos encadeados por hash; `verify` denuncia a linha mexida |
| **Pesquisa do negócio** | `src/ops/research.mjs` | Vai ver o site, com robots.txt e sem tocar em redes privadas |
| **Personalização** | `src/ops/personalize.mjs` | Dossiê → mensagem → objeções previstas → aprendizagem |
| **Autonomia** | `src/ops/autonomy.mjs` | Nível por tipo de mensagem: pede-me sempre → proposto → envia sozinho |
| **Avaliações** | `src/ops/evals.mjs` + `evals.mjs` | Casos fixos com expectativas; resultado guardado por versão de prompt |
| **Agência** | `src/ops/tenants.mjs` | Um ficheiro SQLite por cliente, registo em `data/clientes.db` |
| **Saldo** | `src/ops/money.mjs` | Receita escrita, custos medidos, margem e custos unitários |
| Provas | `ops.test.mjs` (`npm run test:ops`) | 69 testes, tudo em memória, sem tocar em serviços |
| **Mesa** | `src/mesa.html` + `src/mesa.js` → `/app` | A página de trabalho: Hoje, leads, aprovação, conversas, saldo |
| **Projetos** | `src/ops/projects.mjs` | Do lead ao projeto, com máquina de estados e um projeto por negócio |
| **Geração** | `src/ops/generate.mjs` | Quatro pontos de partida, ficheiros reais, sem dependências |
| **QA** | `src/ops/qa.mjs` | Estrutura, sintaxe, acessibilidade e honestidade — com manifesto sha256 |
| **Guarda** | `src/ops/guard.mjs` + `src/ops/zip.mjs` | Ritmo por IP, token opcional, e o ZIP da entrega |
| **Contas** | `src/ops/auth.mjs` | Papéis, palavras-passe com scrypt, sessões, bloqueio por falhas |
| **Tarefas** | `src/ops/tasks.mjs` | Os seis departamentos como máquina de estados com prazo, tentativas e aprovação |
| **Pesquisa e atividade** | `src/ops/search.mjs` | Pesquisa global sem acentos e painel do que correu ou falhou |

Não há dependências novas: usa-se o `node:sqlite` que vem com o Node 22.4+ (aparece um
`ExperimentalWarning` no arranque — é do Node, não do Órbita; silencia-se com
`NODE_OPTIONS=--no-warnings`).

## As regras que a camada faz cumprir

1. **Sem duplicados.** A chave é o domínio do site, senão os 9 dígitos finais do telefone,
   senão o email, senão nome+cidade. Um segundo contacto com os mesmos dados **atualiza**
   em vez de criar. O que o dono decidiu (estado, notas, consentimento, seguimento) nunca é
   apagado por uma atualização de dados.
2. **A nota explica-se.** `score` (0–100) vem sempre com `score_reasons`: «sem site (+25) ·
   telefone público (+15) · avaliação 3,8 (+10)». Se não conseguires ler a razão, é
   publicidade — por isso ela fica guardada.
3. **O funil não salta passos.** `novo → contactado → respondeu → reuniao → cliente`, com
   `perdido` em qualquer ponto e regresso a `novo`. De «novo» para «cliente» é recusado.
4. **Nada sai sem aprovação.** Uma mensagem nasce `rascunho`. `POST …/approve` é uma decisão
   do dono. Só uma mensagem `aprovada` pode ser enviada.
5. **O opt-out manda.** Quem pede para parar fica em `consents`; a partir daí qualquer
   mensagem para esse email/telefone fica `bloqueada` — e o lead passa a `perdido` se ainda
   não era cliente.
6. **Aquecimento do número.** O primeiro dia permite poucos envios (`warmup.<canal>.start`),
   a subir por dia (`step`) até um teto (`max`), com limite por minuto
   (`envio.por_minuto`, 6). O limite explica-se na recusa, não é um erro seco.
7. **A fila não perde trabalho.** Cada tarefa é uma linha em `jobs`. Falhou? Volta com espera
   crescente (15 s, 30 s, 1 min… até 1 h) e desiste ao fim de `max_attempts`, deixando o erro
   escrito. O servidor drena a fila sozinho a cada 2 segundos.
8. **Tudo deixa rasto.** Criar, atualizar, aprovar, bloquear, enviar, falhar, retentar — cada
   uma dessas ações escreve em `events` com quem, o quê, quando e sobre o quê. O registo é
   encadeado por hash: uma edição silenciosa denuncia-se.
9. **Um envio nunca acontece duas vezes.** Passa pelo outbox, com chave de idempotência e
   aluguer. Email resgatado depois de um crash não se repete sozinho — vai para revisão.
10. **Há um travão.** O interruptor de emergência pára todos os envios a partir de qualquer
   caminho, e a recusa diz o motivo.

## Eventos, outbox e idempotência (a base que não se vê)

**Eventos em vez de estado.** Cada coisa que acontece é uma linha em `events` — lead encontrado,
mensagem aprovada, resposta recebida, envio recusado. O estado atual (o lead, a mensagem) é o
resumo; o registo é a história, e é ela que dá auditoria e permite refazer análises.

O registo é uma **cadeia**: cada linha leva `prev_hash` e `hash`, calculados sobre os campos e
sobre a linha anterior. Editar uma linha à socapa parte a cadeia, e `GET /api/ops/events/verify`
diz exatamente em que `id` partiu. Não protege de quem reescreva o ficheiro todo — protege de
edições silenciosas, que é o problema real.

**Outbox: o envio é escrito antes de sair.** Uma linha em `outbox` com uma **chave de
idempotência** (id da mensagem + hash do conteúdo). Pedir o mesmo envio duas vezes é pedir uma:
a segunda chamada encontra a chave e não cria nada.

Quem pega num item faz um **aluguer** com prazo (`lease_until`). Se o processo morrer, o aluguer
expira e o item volta a ser pego — trabalho não fica preso para sempre. E há uma regra dura: se
o item for um **email** e tiver sido resgatado depois de um crash, **não é reenviado às cegas** —
vai para `revisao` e espera por uma pessoa. Um envio a menos é melhor do que um cliente a receber
duas vezes. (O link do WhatsApp não tem esse risco: não sai nada da máquina.)

**Interruptor de emergência.** `POST /api/ops/stop` com `{ "stop": true }` e não sai mais nada:
o envio imediato recusa com a frase certa, o outbox drena zero, a gaveta e o `Hoje` mostram o
estado. `{ "stop": false }` retoma. Não apaga nada — só pára.

## Hoje: um ecrã, três perguntas

`GET /api/ops/today` compõe três listas e um estado de presença:

| Bloco | De onde vem | O que responde |
|---|---|---|
| `decidir` | mensagens em `rascunho`/`aprovada`/`revisao` + tarefas prontas sem OK | «o que precisa de ti» |
| `aconteceu` | `events` desde a última visita (24 h na primeira) | «o que aconteceu enquanto dormias» |
| `a seguir` | seguimentos marcados + rotinas do escritório | «o que vai acontecer» |
| `presenca` | tarefas a correr, fila, outbox, interruptor | «quem está a trabalhar» |

Cada cartão traz uma linha **porquê** feita só com dados guardados (as razões da nota do lead, o
canal, o estado). Se não houver dados que cheguem para justificar, o cartão não aparece.

No ecrã (`src/today.js`): deslizar aprova/rejeita, toque longo abre o porquê, `←`/`→` fazem o
mesmo pelo teclado, `Esc` fecha e `H` abre. As decisões são **otimistas** — o cartão sai no
instante e a lista confirma a seguir; se o servidor recusar, o cartão volta com a razão escrita.
Estados vazios ensinam o próximo passo (procurar leads, voltar a ver) em vez de dizer «sem
resultados». Os tokens de design (espaçamento em múltiplos de 4, escala tipográfica, cores
semânticas `--ok/--warn/--risk`, modo escuro e `prefers-reduced-motion`) estão no `:root` do
`src/shell.html`.

## Sem chave nenhuma, já dá para trabalhar

A gaveta **◉ OPERAÇÃO** tem `+ NOVO LEAD` (nome, cidade, telefone, email, site) e, em cada lead,
`ESCREVER` — que abre um compositor com o canal, o assunto e um texto de partida escrito a partir
do que se sabe do negócio (tem site? que cidade?). O rascunho aparece de imediato em **Hoje**, à
espera do teu OK. É o ciclo inteiro sem depender da Google nem de nenhum motor de IA.

## Personalização por lead (passo 3)

«Vi que não tem site» é o que todos mandam. A vantagem está em abrir com algo que **só se sabe
porque se foi ver** — e que se pode provar.

### 1. Ler o negócio, uma vez, com regras

`POST /api/ops/leads/:id/pesquisar` lê o site do lead e guarda:

| Guarda | Porquê |
|---|---|
| `robots.txt` | se o site não permite, não se lê — e o motivo fica escrito |
| Sem endereços privados | 127.x, 10.x, 192.168.x, 169.254.x, `localhost`… um servidor público não pode ser usado para entrar na rede de casa (SSRF) |
| 12 s e 400 KB | uma página que não responde não vale uma mensagem |
| Um pedido por lead | não se anda a martelar o site de ninguém |
| Nome que diz quem somos | `OrbitaBot/1.0 (+pesquisa de contacto comercial; respeita robots.txt)` |

Do HTML saem **factos com a frase de onde vieram**: falta de `viewport` (não abre bem no
telemóvel), rodapé de 2019, sem `https`, sem formulário, sem marcação, plataforma (Wix,
WordPress…), Instagram, o título e a descrição que a própria casa escreveu. Cada facto tem um
peso, e a soma é a **oportunidade** (0–100) — separada da nota do lead, porque uma coisa é o
negócio valer a pena e outra é haver ali trabalho a fazer.

O texto inteiro da página **não é guardado**: só o que se pode citar. Se a leitura falhar (DNS
inexistente, 403, tempo esgotado, certificado inválido), fica o motivo em português — nunca um
dossiê inventado. Sem site, o motivo é a oportunidade.

### 2. Escrever a partir dos factos

`POST /api/ops/leads/:id/rascunho` compõe a mensagem:

- **Com motor de IA ligado**, o prompt só pode citar os factos listados. A resposta passa por um
  pente (`guardDraft`): se o motor citar entre aspas algo que não está no que se leu, ou prometer
  «o melhor do mercado», a mensagem **inteira** é recusada e volta-se ao modelo local. Um modelo
  que inventa uma vez inventa outra; cortar só a frase deixaria um texto mutilado.
- **Sem motor**, um modelo escrito à mão (curto, com um facto, uma oferta e uma pergunta).
- Em ambos os casos a mensagem diz **de onde veio** (`generated_by`) e **porquê** (`why`), e leva
  consigo os factos citáveis.

A oferta é tua e vive nas definições: `GET/POST /api/ops/oferta` — nome, preço, prazo, garantia.
Aparece tal e qual nas mensagens e nas respostas às objeções.

### 3. Prever a resposta antes de enviar

Cada rascunho traz `predictions`: as objeções prováveis **e a resposta já escrita** — «Já tenho
Instagram e chega», «Quanto custa?», «Não tenho tempo para isto», «Já tenho quem faça isso», mais
as específicas do que se viu (site sem versão móvel, rodapé de 2019, marcações só por telefone).
São regras do negócio, não do modelo — para não haver respostas inventadas a objeções inventadas.

No ecrã **Hoje**, o cartão abre com «Ver porquê» e mostra os factos e as objeções. Na gaveta
**◉ OPERAÇÃO**, o botão `PESQUISAR` de cada lead mostra o dossiê e `ESCREVER COM OS FACTOS`
gera o rascunho.

### 4. O ciclo que fecha

`POST /api/ops/messages/:id/sinal` com `respondeu`, `interessado`, `reuniao`, `cliente`,
`ignorou`, `recusou` ou `pediu_parar`. Cada sinal guarda os **atributos** do lead naquele momento
(sem-site, tem-site, avaliação baixa, sem-mobile, desactualizado…), e daí saem pesos:

```
peso = (positivos − negativos) / max(6, n) × 12     limitado a ±8
```

Com **amostra mínima de 3** — abaixo disso é coincidência, e coincidências não se escrevem na nota
dos outros. A nota passa a ter duas partes visíveis: `score_base` e `score_learned` (limitado a
±12), com a razão escrita: «+4 aprendido: sem-site (3 sinais)». `GET /api/ops/aprendizagem` mostra
o que já se aprendeu e o que está à espera de amostra.

Os sinais também movem o funil: «respondeu» leva o lead a `respondeu` (se estava contactado),
«interessado»/`reuniao` a `reuniao`, «cliente» fecha, «recusou» fecha como perdido.

## Autonomia graduada, ensaio e avaliações (passo 4)

**A pergunta certa não é «queres autonomia?».** É «já provaste que este tipo de mensagem merece
confiança?». A unidade de autonomia é o **tipo de mensagem**: `scope = <canal>:<gancho>`, por
exemplo `whatsapp:sem-site` ou `email:com-marcacao`. O que se aprende numa clínica não autoriza
nada numa barbearia.

| Nível | O que faz |
|---|---|
| `pedir_sempre` | O estado de todos os tipos no primeiro dia. Nada sai sem o teu OK. |
| `proposto` | O Órbita encontrou números que justificam autonomia e propõe-no no ecrã Hoje. |
| `autonomo` | As mensagens desse tipo nascem aprovadas. Os travões de baixo continuam a mandar. |

A regra de subida é verificável em `recommendation()`: **≥ 50 casos decididos** e **≥ 95% de
aprovações** (configuráveis com `POST /api/ops/autonomia/limiar`). Abaixo disso o texto é
honesto e concreto — «faltam 47 casos decididos (3/50)» — em vez de uma barra a 6% sem
explicação. `POST /api/ops/autonomia/:scope/subir` responde **409** sem amostra; `force: true`
existe para o dono assumir a decisão, e fica no registo com essa razão. Descer
(`…/descer`) nunca falha e nunca pede justificação.

**Ser autónomo não é ser livre de tudo.** A aprovação automática em `draftMessage` verifica, na
mesma linha: opt-out do destinatário, interruptor de emergência (`outbox.sendBlocked`), aquecimento
do canal e modo ensaio. Se qualquer um travar, a mensagem fica rascunho ou bloqueada — e o registo
diz qual foi o travão.

**Modo ensaio.** `POST /api/ops/ensaio {"activo": true}` põe o escritório a escrever sem deixar
sair nada: as mensagens nascem em `ensaio`, o Hoje mostra um aviso, e o relatório
(`GET /api/ops/ensaio`) devolve o que **teria** saído, por tipo, com uma amostra e a frase «nada
disto saiu». Uma mensagem em ensaio promove-se a rascunho (`…/promover`) ou rejeita-se; ambas
contam como decisão para efeitos de autonomia — mas só a aprovação conta a favor.

**Avaliações.** Mudar uma palavra no prompt e descobrir o dano num cliente é o pior ciclo
possível. `src/ops/evals.mjs` tem um conjunto fixo de casos com expectativas escritas — negócio
sem site, site com rodapé de 2019, clínica moderna sem marcação, um motor que inventa e um motor
honesto — e três guardas (citação inventada, promessa, texto limpo). Cada corrida grava
`{at, suite, prompt_version, total, passed, failed, detail}` na tabela `evals`; se uma corrida da
mesma versão passar menos casos do que a anterior, `GET /api/ops/evals` devolve `regressao: true`
e o aviso. Corre-se com `node evals.mjs` (ou `--json`) e também da gaveta, na aba AUTONOMIA.

## Agência e saldo (passo 5)

**Um ficheiro por cliente, não uma coluna.** `src/ops/tenants.mjs` cria, para cada cliente, uma
pasta `data/clientes/<slug>-<id4>/` com o seu `orbita.db` e a sua oferta (na tabela `meta` desse
ficheiro). O registo vive em `data/clientes.db`; o cliente activo fica no setting
`cliente.activo`. A consequência prática: apagar ou corromper o espaço de um cliente não toca nos
outros, e uma consulta mal escrita não pode misturar leads de dois negócios. O preço é honesto —
o resumo da agência (`GET /api/ops/agencia`) abre cada ficheiro à vez. Trocar de espaço chama
`switchClient()`, que fecha a ligação anterior antes de abrir a seguinte.

Criar um cliente (`POST /api/ops/clientes`) devolve **três próximos passos** com o que falta,
incluindo a chave que a procura exige. O onboarding é curto de propósito: nome, nicho, cidade,
oferta — o resto aprende-se a usar.

**Saldo.** `GET /api/ops/saldo?dias=90` soma três coisas que existem mesmo:

- **receita** — só a que o dono escreveu (`POST /api/ops/receita`, em cêntimos ou euros, com
  campanha e nota). Nada é inferido de leads ou de conversas.
- **custos** — da tabela `usage`, escrita por quem chama as APIs (Places, pesquisa, motores).
- **margem** — a diferença, por campanha e por fornecedor, mais os custos unitários: por lead,
  por contactado, por cliente, e receita por cliente.

Sem entradas registadas a margem é **negativa** (gastaste e não entraste nada) e a resposta traz
`semDados.receita` com essa frase, em vez de um zero que parecia equilíbrio. `spentToday()` é o
que o travão diário de custos usa.

## A mesa de trabalho (leads e aprovação)

O escritório 3D mostra os agentes; a **mesa** mostra o trabalho. `/app` (botão ▤ MESA na barra)
serve `dist/mesa.html`, construído a partir de `src/mesa.html` + `src/mesa.js` com uma entrada
própria no `build.mjs` — sem three.js, sem pedidos externos, 46 KB.

**Leads** (`#/leads`) lê `GET /api/ops/leads` e filtra no browser: por texto (nome, cidade, nicho,
telefone, email, site) e por três recortes que interessam — por contactar, sem site, responderam.
Não inventa agregados: conta o que está na base.

**A aprovação** é a página de cada lead (`#/lead/:id`), servida por `GET /api/ops/leads/:id`, que
devolve numa só resposta o lead, o dossiê (`research.dossier`) e as suas mensagens. A página mostra
a mensagem mais relevante (revisão → rascunho → ensaio → aprovada → enviada), o estado por
palavras, os sinais do **porquê** (as razões da nota e os factos citáveis) e as acções:

| Estado da mensagem | O que a página oferece |
|---|---|
| `rascunho` | **Rejeitar** · **Aprovar e enviar** |
| `ensaio` | **Rejeitar** · **Promover e aprovar** (sai do ensaio, depois aprova) |
| `aprovada` | **Abrir WhatsApp** (link com o texto) · **Já enviei** |
| `enviada` | **Respondeu** · **Recusou** (sinais que movem o funil e ensinam a nota) |
| sem mensagem | **Ler o site** · **Escrever mensagem**, com os sinais à vista |

Aprovar **não** envia email sem mais: o servidor responde com a razão (token, consentimento) e a
mesa mostra essa frase. O WhatsApp é um link revisto e enviado à mão — a mesa não finge que
enviou. Nenhuma rota nova contorna o `PARAR TUDO` nem o opt-out.

Também aqui: **Hoje** (números reais — novos, com contacto, respostas desde ontem, custo de APIs a
30 dias — mais a lista do que espera decisão), **Conversas** (`GET /api/ops/messages`) e **Saldo**
(`GET /api/ops/saldo`). No telemóvel, barra inferior fixa e uma coluna.

## Projetos: do briefing ao código, do código à entrega (passo 6)

O pipeline é uma máquina de estados guardada na base de dados:

```
rascunho ──gerar──► gerado ──QA──► qa_passou ──aprovar──► aprovado ──entregar──► entregue
                       ▲              │
                       └── qa_falhou ◄┘        (qualquer geração volta a «gerado»)
```

Cada transição inválida é recusada com a frase do pipeline. Cada passo escreve em `events` (cadeia
de hashes) e em `jobs` (início, fim, resultado) — a evidência fica na base, não na conversa.

**Um negócio, um projeto.** `projects.lead_id` tem índice único (parcial). Criar outro para o mesmo
lead devolve **409** com o nome do que já existe.

**Geração** (`src/ops/generate.mjs`) é determinística e testável: `plan()` devolve os ficheiros em
memória; `writeFiles()` escreve-os e devolve o manifesto. Quatro tipos:

| Tipo | Ficheiros | O que faz |
|---|---|---|
| `landing` | `index.html`, `styles.css`, `app.js`, `README.md` | Conversão: proposta, oferta com preço/prazo, formulário validado que prepara a mensagem |
| `institucional` | + `sobre.html`, `servicos.html`, `contacto.html` | Navegação entre páginas, um `h1` por página |
| `loja` | + `data/products.json` (vazio) | Catálogo, carrinho em `localStorage`, totais, encomenda preparada |
| `dashboard` | + `data/dataset.json` (vazio) | Indicadores do ficheiro, pesquisa, ordenação, CSV |

Nada disto inventa dados: a loja sem produtos mostra um estado vazio que ensina, o sistema sem
dados mostra zero e explica. As integrações que faltam (pagamentos, envio de formulário, servidor)
estão escritas no `README.md` de cada projeto gerado.

**QA** (`src/ops/qa.mjs`) devolve itens com três níveis — `critico`, `importante`, `menor` — e
`passed = críticos + importantes === 0`. Verifica ficheiros obrigatórios, estrutura HTML, links e
recursos, rótulos e `alt`, sintaxe do JS (`vm.Script`), CSS (`@media`, chaves), JSON, e textos de
enchimento. Cada corrida fica em `qa_runs` com o **manifesto sha256**.

**Aprovação e entrega.** `aprovar` exige `qa_passou` e um manifesto igual ao do disco;
`entregar` exige aprovação; qualquer alteração posterior ao QA bloqueia com **409** e a lista de
ficheiros. Destinos:

| Destino | O que acontece de verdade |
|---|---|
| `preview` | Os ficheiros passam a ser servidos em `/preview/<id>/` (com protecção contra `..`) |
| `vercel` | Sem `VERCEL_DEPLOY_HOOK` → 409 a nomear a variável; com ele, o pedido fica **pedido** |
| `github` | Sem `GITHUB_TOKEN` → 409; o envio de ficheiros não está implementado e é dito |

`GET /api/ops/projetos/:id/zip` devolve o projeto num ZIP (PKZIP «store», nomes UTF-8, sha256 no
cabeçalho `x-orbita-sha256`).

## Tarefas: os seis departamentos como cadeia de produção (passo 7)

```
queued ──correr──► running ──► succeeded | failed | awaiting_approval
                     │                              │
                     └── prazo esgotado ──► failed   └── aprovar ──► succeeded (quem aprovou fica escrito)
```

| Departamento | Trata de |
|---|---|
| 01 ORION · command | revisão de prioridades: o que espera aprovação, o que falhou, o que está parado |
| 02 LUNA · prospect | pesquisar o site do lead, qualificar e pontuar (nota ≥ 60 → `qualificado`) |
| 03 KAI · sales | preparar proposta a partir da oferta e dos factos; redigir mensagem (exige IA) |
| 04 NOVA · design | briefing, páginas, critérios de aceitação e tokens do design system |
| 05 ZEKE · engineering | gerar código, auditar QA, entregar preview; corrigir (exige IA) |
| 06 MIRA · media | rascunhos e conteúdo (exige IA) |

Regras que a base de dados impõe:

- **uma tarefa aberta por chave** (`dedupe`) — índice parcial único; quatro pedidos em paralelo criam
  uma só tarefa;
- **tentativas limitadas** (`max_attempts`, 3 por omissão) com `attempts` a subir a cada corrida;
- **prazo** (`timeout_ms`) — o que passa do prazo falha, não fica pendurado;
- **recuperação no arranque** — `tasks.recover()` devolve à fila o que ficou em `running` e passou do
  prazo, ou marca como falhado quando já não há tentativas;
- **acções de risco** (`approval: true`) terminam em `awaiting_approval` e exigem `aprovar` humano;
- **resultado e evidência** guardados na linha — nunca só na conversa.

Sem motor de IA configurado, as tarefas que precisam de texto **falham com o motivo escrito**
(`esta tarefa precisa de um motor de IA e não há nenhum configurado`). A cena 3D e o painel de
agentes leem estes estados: sem tarefa em `running`, ninguém aparece a trabalhar.

## O funil, medido

`GET /api/ops/pipeline` devolve, a partir dos registos:

- quantos leads **chegaram** a cada fase (estado atual + histórico `lead.estado` em `events`);
- conversão entre fases e conversão total até ganho;
- taxa por **origem** (com primeira e última recolha) e por **mês** de recolha;
- **oportunidades paradas**: abertas, sem toque há mais de 14 dias, com os dias contados.

## Contas, papéis e sessões (passo 8)

A credencial única da instalação confundia duas perguntas: *quem és* e *o que podes fazer*. Agora:

```
POST /api/auth/primeiro-dono   → cria o dono (só enquanto não há contas) e abre sessão
POST /api/auth/entrar          → email + palavra-passe → cookie orbita_sessao
GET  /api/auth/eu              → quem sou, papel, permissões
POST /api/auth/sair            → revoga esta sessão e limpa o cookie
```

| Papel | `read` | `write` | `approve` | `admin` |
|---|---|---|---|---|
| dono | ✓ | ✓ | ✓ | ✓ |
| gestor | ✓ | ✓ | ✓ | — |
| operador | ✓ | ✓ | — | — |
| leitor | ✓ | — | — | — |

**Como se aplica.** `permFor(método, rota)` em `serve.mjs` decide a permissão; o `authenticate`
devolve `{ ok, mode, user, role, can(perm) }`. Rotas `/api/ops/utilizadores` e `/api/ops/sessoes`
são sempre `admin` (mesmo para ler: emais não são matéria de leitor). `aprovar`, `entregar`,
`rejeitar`, `stop`, `ensaio`, `evals/correr` e `consent/opt-out` são `approve`. O resto é `write`
(não-GET) ou `read` (GET).

**Sessões.** Token de 32 bytes; na base só o `sha256`. Prazo de `ORBITA_SESSION_HOURS` (12 h).
Cookie `HttpOnly; SameSite=Strict; Path=/` e `Secure` quando a ligação é https
(`ORBITA_SECURE_COOKIE=1` força, `0` desliga). `revokeAll` corre ao trocar a palavra-passe e ao
desactivar a conta.

**Força bruta.** 20 tentativas de entrada por minuto e por IP (`loginLimiter`); 5 falhas numa conta
bloqueiam-na 15 minutos (`auth_attempts`, email em hash). A resposta é sempre a mesma frase para
conta inexistente e palavra-passe errada.

**Modos.** `authState()` devolve um de três: `sessao` (há contas, ou `ORBITA_AUTH=sessao`),
`token` (só `ORBITA_ADMIN_TOKEN` — credencial de máquina, vale como dono) ou `local` (nem contas nem
token — só nesta máquina). O arranque imprime o modo; a mesa mostra o ecrã de entrada quando recebe
`401 { hint: 'sessao' }`.

## O escritório ao vivo (passo 9)

Os monitores do escritório 3D mostram **o trabalho registado**, não uma animação. A regra é a de
sempre: *se não está na base de dados, não aparece no ecrã*.

- **Fonte.** `src/ops/live.mjs` lê `tasks`, `jobs`, `projects` e `qa_runs`. O mapa `SEAT` liga cada
  tipo de tarefa ao **posto que já existe** na cena (`lead.pesquisar → AUDITOR DE WEBSITES`,
  `projeto.qa → QA E TESTES`, …). Não há agentes novos, nem nomes novos, nem departamentos novos.
- **Transporte.** SSE em `GET /api/ops/aovivo/stream`. O servidor calcula uma **impressão digital**
  das tabelas a cada 800 ms e só emite `update` quando muda; entre mudanças manda `ping`. Cada
  `update` leva `alteracoes` (`{ agente, estado, tarefa, idTarefa, at }`) e o retrato completo.
  Sem WebSocket, sem dependências novas, sem polling do cliente.
- **Estados.** `live` (tarefa `running` ou evento nos últimos 2 min) · `waiting` (`queued`,
  `awaiting_approval`) · `error` (falha nos últimos 30 min) · `idle` (diz «sem tarefa registada»).
  Não há percentagens: mostra-se tentativa x/y, hora de início e o que a tarefa produziu.
- **Quando a ligação cai.** Silêncio de 20 s ou erro do `EventSource` → tudo passa a
  **DESATUALIZADO** com a hora do último dado bom, e o botão **ATUALIZAR AGORA** volta a pedir o
  retrato. O `retry: 3000` faz o cliente voltar sozinho. Nunca se chama «ao vivo» a dados velhos.
- **O painel.** Clicar num agente abre o separador **AO VIVO** do rail: identidade que já existia,
  estado, atividade com passos reais, o monitor em direto, verificações de QA, artefactos com link
  (`/preview/…`, `/api/ops/projetos/:id`, `…/zip`), histórico e eventos. Sem informação, di-lo por
  palavras. Fechar volta à cena no mesmo sítio.
- **O que sai do servidor.** `redact()` abrevia caminhos absolutos e oculta chaves/tokens; o
  `payload` da tarefa não é enviado. As rotas exigem sessão (`read`), como as restantes.
- **DEMO.** Com `window.SCREENS` (a cena de demonstração, sessões gravadas de outra empresa) os
  monitores continuam a ser gravações e o painel marca **DEMO** — não se chama «ao vivo» a isso.

**Limitações, ditas:** os postos mostram apenas os tipos de tarefa do mapa `SEAT`; os outros agentes
da cena não têm trabalho na base de dados, por isso ficam `idle` (não inventamos trabalho para eles).
O `projeto.gerar` corre em minutos, não em segundos: o monitor atualiza ao ritmo do trabalho, não a
cada linha de código. Não há histórico de linhas — só o retrato mais recente de cada posto.

## A guarda da porta

- **Contas**: a partir da primeira conta, `/api/ops` e as rotas de dados do escritório
  (`/api/tasks`, `/api/chat`, `/api/email`, `/api/deploy`, …) exigem sessão; `/api/health`,
  `/api/auth/*` e as páginas continuam públicos (a página de entrada tem de carregar).
- **Ritmo**: 300 pedidos por minuto por IP; acima disso, **429** com o tempo de espera.
- **CSRF**: um pedido que muda estado e que traz a credencial em **cookie** é recusado se vier de
  outra origem (**403**). O cabeçalho `x-orbita-admin` e o `Bearer` não têm este problema.
- **Palavra-passe opcional**: `ORBITA_ADMIN_TOKEN` (16+ caracteres). Com ela, todas as rotas
  `/api/ops` exigem `x-orbita-admin`, `Authorization: Bearer` ou o cookie `orbita_admin`; o
  escritório e a mesa pedem o token uma vez e guardam-no no browser.
- Sem a variável, o Órbita está em **modo local** e o arranque di-lo: «sem palavra-passe — só para
  esta máquina». Não é uma falha escondida, é uma escolha explícita.
- O token nunca vai para o HTML: é pedido no browser e enviado por cabeçalho.

## Caixa de entrada e envio

- **Email** exige `RESEND_API_KEY` **e** consentimento registado no lead (`consent: 'dado'`).
  Sem um dos dois, a resposta é uma frase que diz o que falta — não um envio silencioso.
- **WhatsApp** não tem envio automático nesta versão: o servidor prepara o link `wa.me` com
  o texto, o dono revê e envia à mão, e só depois carrega em **JÁ ENVIEI** (`…/confirm`). O
  Órbita não finge que enviou.
- As rotas que escrevem para fora exigem `ORBITA_API_TOKEN` (32+ caracteres) no `.env`.

## Endpoints

Todos devolvem JSON `{ ok, … }`. Os erros trazem uma frase em português.

| Método | Rota | Para quê |
|---|---|---|
| GET | `/api/ops/summary` | Leads, funil, conversão, mensagens, custos, estado da fila |
| GET | `/api/ops/leads?limit=&status=` | A lista, ordenada por nota |
| GET | `/api/ops/leads/:id` | Um lead com o dossiê e as mensagens dele (a página de aprovação) |
| GET/POST | `/api/ops/projetos` | Projetos / criar |
| POST | `/api/ops/leads/:id/projeto` | Criar o projeto de um lead |
| GET | `/api/ops/projetos/:id` | Projeto com ficheiros, QA, entregas e histórico |
| POST | `/api/ops/projetos/:id/gerar` · `/qa` · `/aprovar` · `/entregar` | O pipeline |
| GET | `/api/ops/projetos/:id/zip` | Os ficheiros em ZIP |
| GET/POST | `/api/ops/tarefas` | Tarefas / criar (`correr: true` executa já) |
| POST | `/api/ops/tarefas/:id/correr` · `/aprovar` · `/rejeitar` | Correr, aprovar, rejeitar |
| GET | `/api/ops/agentes` | Estado real dos seis departamentos |
| GET | `/api/ops/aovivo` | Retrato de cada posto: estado, tarefa, linhas do monitor, artefactos, QA, histórico e eventos |
| GET | `/api/ops/aovivo/stream` | O mesmo em **SSE**: `hello`, `update` só quando muda, `ping` de 800 ms, `retry: 3000` |
| GET | `/api/ops/pipeline` | Funil por fase, por origem, e paradas |
| GET | `/api/ops/pesquisa?q=` | Pesquisa global |
| GET | `/api/ops/atividade` | Fila, tarefas e eventos recentes |
| GET | `/preview/:id/…` | Preview real dos ficheiros gerados |
| POST | `/api/ops/leads` | Um lead (`{…}`) ou vários (`{ leads: [...] }`) |
| PATCH | `/api/ops/leads/:id` | Mudar de estado no funil (`{ status, note }`) |
| POST | `/api/ops/leads/:id/consent` | Registar consentimento (`{ consent, reference }`) |
| POST | `/api/ops/leads/:id/follow-up` | Marcar quando voltar a falar (`{ when }`) |
| POST | `/api/ops/leads/importar-gravados` | Trazer para a base de dados o que está em `data/leads.json` |
| GET | `/api/ops/messages?status=&leadId=` | Mensagens com o lead, opcionalmente de um só lead |
| POST | `/api/ops/messages` | Criar rascunho (`{ leadId, channel, subject, body }`) |
| POST | `/api/ops/messages/:id/approve` · `/reject` | A decisão do dono |
| POST | `/api/ops/messages/:id/send` · `/confirm` | Enviar (email, com token) · confirmar envio manual (WhatsApp) |
| POST | `/api/ops/consent/opt-out` | `{ email }` ou `{ phone }` — bloqueia para sempre |
| GET | `/api/ops/queue` | Estado da fila e os últimos trabalhos |
| POST | `/api/ops/queue/tick` | Correr agora o que está devido |
| GET | `/api/ops/events?limit=` | A auditoria |
| GET | `/api/ops/usage?days=` | Consumo e custo por fornecedor |
| GET | `/api/ops/today` | O ecrã Hoje: decidir, aconteceu, a seguir, presença |
| POST | `/api/ops/stop` | Interruptor de emergência (`{ "stop": true \| false }`) |
| GET | `/api/ops/outbox` | Fila de saída com tentativas, alugueres e revisões |
| GET | `/api/ops/events/verify` | Verifica a cadeia de hashes do registo |
| POST | `/api/ops/leads/:id/pesquisar` | Lê o site do lead e devolve o dossiê |
| GET | `/api/ops/leads/:id/dossier` | O que já se sabe (sem ir à rede) |
| POST | `/api/ops/leads/:id/rascunho` | Escreve com os factos (`{ "channel": "whatsapp" }`) |
| POST | `/api/ops/messages/:id/sinal` | O que responderam (`{ "kind": "respondeu" }`) |
| GET | `/api/ops/aprendizagem` | Pesos, sinais e o que falta para aprender |
| GET/POST | `/api/ops/oferta` | A tua oferta: nome, preço, prazo, garantia |
| GET | `/api/ops/autonomia` | Nível por tipo, propostas e limiares |
| POST | `/api/ops/autonomia/limiar` | `{ minCasos, minTaxa }` |
| POST | `/api/ops/autonomia/:scope/subir` · `/descer` | Dar autonomia (409 sem amostra) · revogar |
| GET/POST | `/api/ops/ensaio` | O modo ensaio e o seu relatório |
| POST | `/api/ops/messages/:id/promover` | Tirar uma mensagem do ensaio |
| GET | `/api/ops/evals` | Histórico, última corrida, regressão |
| POST | `/api/ops/evals/correr` | Correr os casos fixos agora |
| GET | `/api/ops/saldo?dias=` | Receita, custos, margem, por campanha e unitários |
| POST | `/api/ops/receita` · DELETE `/api/ops/receita/:id` | Registar / apagar uma entrada |
| GET/POST | `/api/ops/clientes` | Os espaços de cliente / criar um |
| POST | `/api/ops/clientes/:id/entrar` | Passar a trabalhar no espaço desse cliente |
| GET | `/api/ops/agencia` | O resumo de todos os espaços |

A pesquisa da Google (`/api/google/search`) continua a guardar na gaveta e **passa a gravar
também na base de dados**, já pontuado e sem duplicados. A resposta traz `baseDeDados` com
`{ created, updated, refused }`.

## O que ainda não está — dito por palavras

- **Servidor de base de dados em rede.** Isto é SQLite num ficheiro: um servidor, um dono.
  Para várias máquinas o caminho é Postgres/Supabase — o esquema está versionado em
  `meta.schema_version` (`SCHEMA_VERSION` em `src/ops/db.mjs`), para a migração ser escrita,
  não adivinhada.
- **Cobranças.** Não há Stripe nesta versão. A tabela `revenue` guarda o que o dono escreve
  (valor, campanha, lead, nota) e o saldo é receita menos custo de API — medido, não adivinhado.
  Uma fatura emitida fora do Órbita não entra sozinha: alguém tem de a registar.
- **Envio real de WhatsApp Business.** Falta a conta Meta, o número aprovado e o token.
  Enquanto não existir, o caminho é o link revisto à mão.
- **Testes A/B de mensagem.** (por fazer) A tabela `messages` já tem o que é preciso para medir
  (`predictions`, `generated_by`, `sent_at` e os sinais); falta a variante explícita e a escolha
  da vencedora.
- **Instagram e avaliações lidas a sério.** O dossiê detecta o perfil e usa a nota do Google
  Places que já temos; ler o conteúdo do Instagram exige a API da Meta (conta e token) — sem
  isso seria raspar, e raspar não é base para escrever a um cliente.
- **Postgres/Supabase.** O esquema é SQLite versionado (`SCHEMA_VERSION` 5 em `src/ops/db.mjs`).
  `supabase/orbita_schema.sql` cobre só leads e nunca foi executado por falta de credenciais —
  não há RLS em uso nem migração aplicada. O caminho é escrever as migrações novas antes de dizer
  «Supabase ativo».
- **Envio para o GitHub e deployment na Vercel.** Os adaptadores existem e recusam com o nome da
  variável que falta; o envio de ficheiros para o GitHub não está implementado, e o hook da Vercel
  apenas regista um pedido — o estado final tem de ser confirmado no serviço.
- **Agente de código.** A geração é determinística, não é um agente a escrever código. Não há
  runner de IA configurado (`GEMINI_API_KEY` vazia): o fluxo manual é abrir a pasta e editar.
- **Testes de navegador.** Não há Chromium neste ambiente: o QA reporta `navegador.executado=false`
  com o motivo, e o smoke com Chrome falha. A verificação do preview é feita por HTTP (200 + HTML/CSS
  esperados) e com jsdom, não por renderização real.
- **Uma instalação, um conjunto de contas.** Não há multi-tenant com contas separadas por cliente:
  os espaços de cliente (`tenants`) isolam dados, mas as contas vivem todas na mesma instalação.
  Para servir vários clientes expostos, falta ligar contas a espaços e RLS a sério.
- **Sem 2FA, sem recuperação de palavra-passe.** Um dono repõe a palavra-passe de outra conta pelo
  servidor; não há email de recuperação (exigiria Resend configurado e consentimento).
- **Lint e tipos.** A stack gerada é HTML/CSS/JS sem build: não há ESLint nem `tsc` a correr no QA.
  O que existe é verificação de sintaxe (`vm.Script`), CSS e JSON — e é isso que o relatório diz.
- **Agente de código.** `projeto.corrigir` exige IA e falha sem chave; a correcção é manual, na
  pasta do projeto, e o QA volta a correr depois.
- **Regras aprendidas com correções.** O `learn.mjs` já guarda lições e regras; ligá-las às
  aprovações (rejeitar uma mensagem e a razão virar regra) é o passo seguinte.

## Verificar sem estragar nada

```bash
npm run test:ops     # 69 testes, SQLite em memória, nenhum serviço externo
npm run check        # inclui os testes da operação e um servidor isolado que prova as rotas
```

O `check.mjs` arranca um servidor à parte com `ORBITA_DATA_DIR` e `ORBITA_DB` temporários:
prova as rotas de ponta a ponta **sem tocar nos dados do dono**, e apaga a pasta no fim.

---

*Órbita — criado por Chelton Mahoze.*
