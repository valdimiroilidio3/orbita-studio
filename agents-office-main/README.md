# Órbita

![Órbita — seis salas à volta do Cérebro, com o painel de Estado das Tarefas](assets/readme-hero.jpg)

Um escritório isométrico 3D onde agentes de IA fazem trabalho real no teu próprio login do Claude.

**Criado por Chelton Mahoze.**

> **Publicado:** <https://orbita-agentes.vercel.app> — o escritório a cores, aberto no browser. Sem
> servidor não há tarefas nem conectores, e a página di-lo em vez de os inventar: o trabalho real vive
> na tua máquina (`npm start`). Ver [docs/LANCAMENTO.md](docs/LANCAMENTO.md).

Seis salas, trinta e cinco agentes nas secretárias, uma barra de tarefas que encaminha o
que escreves para a pessoa certa, e um Cérebro no centro que é a tua própria pasta de notas.
Escreves uma tarefa, o escritório entrega-a a quem deve, essa pessoa lê as tuas notas, usa os
conectores que já tens no Claude Code, faz o trabalho e arquiva o resultado de volta nas notas.
Tudo corre na tua máquina.

## O que precisas

- macOS, Linux ou Windows (no Windows usa os comandos `npm` diretamente, o `./setup` é Bash)
- Node.js 20+ — https://nodejs.org
- git
- **uma chave de IA** — qualquer uma destas serve:
  - `GEMINI_API_KEY` do Google AI Studio (aistudio.google.com/apikey): **não instala nada**, fala
    direto com a API do Google (`gemini-flash-latest` por omissão);
  - **Claude Code** com sessão iniciada, ou uma `ANTHROPIC_API_KEY`.

## Instalação

```bash
git clone <este-repositório>
cd agents-office-main
npm ci
cp .env.example .env   # põe lá a GEMINI_API_KEY (o .env nunca vai para o git)
node build.mjs         # gera dist/command-centre-v2.html (o escritório num único ficheiro)
npm start              # → http://localhost:4520
```

Sem chave nenhuma o escritório abre e diz, em cada sítio, o que falta — não finge que trabalha.
Com a chave do AI Studio, os 35 agentes encaminham, escrevem e conversam de imediato. Para Chrome,
ficheiros e conectores MCP, precisa do Claude Code (uma API dá voz, não mãos): ver
[AI.md](AI.md).

Atalho: `./setup` faz as três coisas e arranca o escritório uma vez para testar.

## Os primeiros cinco minutos

1. Abre http://localhost:4520. O painel à direita diz **EM DIRETO · CLAUDE** quando o servidor
   está ligado. Abrir `dist/command-centre-v2.html` com duplo clique mostra o mesmo escritório
   sozinho, em modo de demonstração.
2. Na barra do topo do painel escolhe um departamento, escreve a tarefa em palavras simples e
   prime **Adicionar**. O Claude escolhe o agente e dá-lhe nome; a tarefa aparece na lista, o
   agente pega nela, trabalha, e o resultado cai na conversa desse agente e na tua pasta de notas.
3. Clica num agente para falares com ele. O cartão da conversa deixa escolher o **modo**
   (Planear · Perguntar · Construir), o **modelo e o esforço**, anexar ficheiros de texto, pedir
   **@contexto** e ditar. Responde no seu papel, ancorado nas tuas notas. Diz `revê: mais curto` e
   ele refaz a última entrega. O que cada peça faz — e o que não faz — está em
   **[docs/CONVERSA.md](docs/CONVERSA.md)**.
4. Prime **G**, ou clica no Cérebro, para ver as notas como grafo. Passa o rato numa nota para ver
   as ligações, clica para ler onde está e quem a leu ou escreveu.
5. A barra do topo mostra os conectores a que o teu Claude Code está ligado. Quando um agente usa
   um deles, o logótipo pulsa e o fio até esse departamento acende.
6. As primeiras entregas vão ser competentes e genéricas: os agentes conhecem o estúdio de exemplo
   e uma frase sobre o próprio trabalho. Aponta o Cérebro para as tuas notas e ensina-os a
   trabalhar contigo (abaixo). É aí que o escritório passa a ser teu.

## Conectores

A barra por baixo de **LIGADO A** é real: é a lista do `claude mcp list` nesta máquina, a mesma
que os agentes recebem como ferramentas. Gmail, Slack, Notion, Google Drive, Canva, o que tiveres
ligado em claude.ai ou adicionado com `claude mcp add`. Um servidor que precise de autenticação
aparece a cinzento com a razão ao passar o rato, e não é ligado a nenhuma sala até funcionar.
Nada ligado? A barra di-lo.

Os agentes podem chamar esses servidores enquanto trabalham, mais a pesquisa web. Nunca recebem
Bash, ferramentas de ficheiros nem sub-agentes. A regra permanente: lê à vontade; enviar,
publicar, pagar, apagar ou alterar só quando tu pedires.

### As integrações do próprio Órbita

Além do que estiver ligado no teu Claude Code, o escritório traz o seu próprio servidor MCP —
`orbita_integrations`, em `mcp-servers/orbita-integrations/` — com **22 ferramentas**: pesquisa
de empresas (Geoapify, sem duplicados), **pesquisa web em tempo real (Tavily, com fontes e datas)**,
leitura de páginas, consumo da pesquisa, **criar um site** e **digitalizar documentos**, CRM de leads, rascunhos com Gemini, email aprovado pelo
Resend, metadados e commit de um ficheiro no GitHub, link de WhatsApp, fila de conteúdo,
publicação no Instagram e deploy na Vercel. É arrancado e testado a sério no arranque (`initialize` + `tools/list`)
e entregue aos agentes por `--mcp-config`; o estado real está em `GET /api/mcp`.

O servidor `orbita_google` saiu em 1.29.0, com o Google: a pesquisa do escritório é
**Tavily** (contexto, notícias e leitura de páginas) mais **Geoapify** (empresas reais
do OpenStreetMap). Uma chave para cada, sem cartão. Ver [PESQUISA.md](PESQUISA.md).

As rotas HTTP equivalentes vivem em `/api/*` e exigem `Authorization: Bearer $ORBITA_API_TOKEN`
com 32+ caracteres — **e esse token já não é um passo teu**: se não existir, o Órbita gera-o no
primeiro arranque e escreve-o no `.env`. Guia completo, limites e o que **não** existe (Stripe, envio pela WhatsApp
Business API): [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md). O segundo servidor local,
`mcp-servers/view-image-mcp/`, dá olhos aos agentes — abre qualquer URL pública como imagem e
precisa de `npm install` dentro dessa pasta.

## As APIs de pé ao arrancar, e a máquina onde corre

`platform.mjs` faz o preparo de que o dono falou: no arranque, o servidor **lê o `.env`, gera o token
interno se faltar, e sonda 27 serviços reais** (IA, dados, base de dados, código, deploy, pagamentos,
mensagens) com uma chamada barata e um prazo de 6 s. O retrato está em `GET /api/platform` — com
CORS aberto, para qualquer app o poder ler no arranque dela:

```bash
curl -s localhost:4520/api/platform | jq '{maquina: .machine.os, prontas: .apis.summary.ready, falta: .apis.summary.missingKeys}'
```

Gravar uma chave nova no `.env` **basta**: o ficheiro é vigiado, a chave entra a quente e as sondas
correm outra vez, sem reiniciar. Serviços que não estejam no catálogo entram por
`data/api/providers.json`, sem tocar em código — é isso que faz «todos os tipos de app».

No terminal (tecla `F`): `:api` mostra o que está pronto e que chave falta; `:maquina` mostra o
sistema, a memória, o `node`, o `shell` e as ferramentas do PATH **com a versão que cada uma diz**.
Guia completo, incluindo o que **não** é automático: [docs/PLATAFORMA.md](docs/PLATAFORMA.md).

## Os 35 agentes

| Sala | Quem lá está |
|---|---|
| **Comando** | ORBITA Director · Chefe de Gabinete · Analista de Resultados · Painel Central · Permissões e Conformidade |
| **Prospeção** | Lead Hunter · Enriquecador · Qualificador · Inteligência de Mercado · Análise Competitiva · Auditor de Websites |
| **Vendas** | Sales Closer · Propostas · Seguimentos · Receção de Clientes · Contratos · Comunicação com Clientes |
| **Design Lab** | Creative Architect · UI e Design System · Direção de Arte · Pesquisa UX |
| **Engenharia** | Systems Engineer · Gestor de Projetos · QA e Testes · Frontend · Backend e Integrações · Deploys e Infra · Documentação Técnica |
| **Media** | Growth Publisher · Conteúdo e Newsletter · Anúncios Meta · Redes Sociais · Vídeo · Calendário Editorial · Analytics de Conteúdo |

Cada agente tem: um papel, uma descrição do que faz, as ferramentas que pode usar, as
competências que segue e um briefing com as tuas instruções permanentes. Tudo isso se edita em
`office.agents.json` (ou em `office.agents.local.json`, que o git ignora).

## Rotinas: o escritório no seu próprio relógio

Uma rotina é uma tarefa com uma hora dentro, dita em português simples:

```
todos os dias úteis às 8h, triar a caixa de entrada e dizer-me o que precisa de mim
todas as segundas e quintas ao meio-dia, rever as propostas abertas
de hora a hora, das 9h às 17h, ver as campanhas de anúncios
a cada 30 minutos, verificar a fila de entrada
todas as sextas às 17h30, fechar a semana e escrever o resumo
```

O servidor cumpre a rotina ao minuto, mesmo com a página fechada. Se a rotina puder enviar,
publicar ou pagar algo, o resultado **espera pelo teu OK** antes de sair. As rotinas vivem em
`brain/Órbita/routines.json` e podem ser escritas à mão.

## O calendário (P)

Tudo no dia a que pertence: tarefas concluídas, o trabalho de hoje, tarefas agendadas e todas as
rotinas projetadas para a frente. Clica num dia para agendar uma tarefa, ou liga **REPETIR** para
começar uma rotina nessa data. Uma barra lateral lista as rotinas; clicar numa mostra só os dias
dela. Mês e semana, com modo escuro.

## As equipas: o líder divide, as secretárias trabalham

Prime **EQUIPA** ou diz «em equipa» na frase. O líder do departamento reparte o trabalho pelas
secretárias, todas trabalham ao mesmo tempo, deixam notas umas às outras e o líder escreve a
versão final. O número máximo de secretárias configura-se em `office.config.json` (`teams.max`).

## Qual modelo e quanto do teu plano

Sonnet, Opus ou Fable — por tarefa, por rotina, por agente ou para o escritório inteiro, com um
menu de esforço (Baixo a Máximo). A barra do topo mostra a sessão e a semana do teu plano quando o
Claude Code as expõe; sem login, mostra a contagem do próprio escritório.

## Pesquisa real: leads da Google

O botão **◈ LEADS**, na barra do topo, procura empresas **verdadeiras** na Google Places API (New):
nome, morada, telefone, site, avaliação e link do mapa, com uma nota de oportunidade explicada
(sem site pesa muito). Escreve «clínicas dentárias» e «Lisboa», prime PROCURAR — o que aparece fica
guardado em `data/leads.json`, sem duplicados. **→ TAREFA** transforma os melhores numa tarefa para
o Lead Hunter.

A **Prospeção** e as **Vendas** leem os oito melhores leads por contactar no início de cada tarefa e
escrevem com nomes e cidades reais — sem inventar contactos. Enviar continua a exigir o teu OK.

Precisa de uma chave: `GOOGLE_MAPS_API_KEY` (leads) e, se quiseres pesquisa web com o Programmable
Search, `GOOGLE_API_KEY` + `GOOGLE_CSE_ID`. Sem chave o escritório diz exatamente o que falta — não
inventa resultados. Guia completo, quotas e cuidados em **[PESQUISA.md](PESQUISA.md)**.

## Escrever a cada negócio como quem lá esteve

Antes de escrever a alguém, o Órbita **vai ver o negócio**: lê o site do lead uma vez (respeitando
o `robots.txt`, sem tocar em redes privadas, com tempo e tamanho limitados) e tira de lá factos
com a frase exacta de onde saíram — «a página não se adapta ao telemóvel», «o rodapé ainda diz
2019», «não há formulário, só telefone». A soma desses factos é a **oportunidade** (0–100),
separada da nota do lead.

A mensagem nasce daí. Com um motor de IA ligado, o prompt só pode citar os factos listados — e
uma citação inventada **derruba o rascunho inteiro**, que volta ao modelo local. Sem motor, há um
modelo escrito à mão que faz o mesmo com menos graça. Em qualquer dos casos a mensagem diz de onde
veio e porquê.

Cada rascunho traz ainda as **objeções prováveis já respondidas** («Já tenho Instagram e chega»,
«Quanto custa?», «Não tenho tempo»). E quando marcas o que responderam — respondeu, quer falar,
ignorou, recusou — isso entra na pontuação dos leads parecidos, com amostra mínima de 3 e a razão
escrita. Guia completo em **[OPS.md](OPS.md)**.

## Hoje: um ecrã, três perguntas

Abres o escritório e vês **Hoje**: o que precisa da tua decisão, o que aconteceu enquanto
dormias e o que vai acontecer. Os agentes não são uma lista — são um anel discreto na barra, que
pulsa quando há trabalho a acontecer.

A decisão é um **gesto**: desliza para a direita para aprovar, para a esquerda para rejeitar, e
um toque longo abre o **porquê** («escolhi este tom porque o negócio tem 4,8★ e poucas
avaliações»). Cada gesto tem um botão equivalente e uma tecla (`←` rejeitar, `→` aprovar) — quem
usa teclado ou leitor de ecrã não fica de fora. O cartão sai no instante em que decides e, se o
servidor recusar, volta com a razão escrita.

No topo está o **PARAR TUDO**: um toque e não sai mais nenhum envio, seja qual for o caminho.

## Operação: guardado, aprovado, com rasto

Os leads, as mensagens, a fila e o registo do que aconteceu vivem numa base de dados SQLite
(`data/orbita.db`, sem dependências — `node:sqlite`). O botão **◉ OPERAÇÃO**, na barra, abre a
gaveta: os leads por nota com as **razões** dela, as mensagens à espera do teu OK, a fila de
trabalho e a auditoria.

Três regras que a camada faz cumprir: **nada sai sem aprovação** (uma mensagem nasce rascunho e
só o dono a aprova), **o opt-out manda** (quem pede para parar fica bloqueado em definitivo) e
**o funil não salta passos** (de «novo» para «cliente» é recusado). O envio de email exige
consentimento registado e `RESEND_API_KEY`; o WhatsApp é um link revisto e enviado à mão — o
Órbita não finge que enviou. O que falha fica na fila e volta a tentar, com espera crescente.

A pesquisa da Google passa a gravar também nesta base de dados, já pontuada e sem duplicados.
Detalhe completo — tabelas, rotas `/api/ops`, aquecimento do número, custos e **o que ainda não
está** (Stripe, WhatsApp Business real, Postgres) — em **[OPS.md](OPS.md)**.

## Do lead ao código, com provas

Um lead qualificado transforma-se em **projeto** — um só por negócio, com briefing, objetivos,
páginas e critérios de aceitação. O motor (`src/ops/generate.mjs`) escreve ficheiros reais em
`data/projetos/<slug>/` para quatro pontos de partida: página de conversão, site institucional de
quatro páginas, loja com catálogo e carrinho, e sistema interno com indicadores e CSV. Sem CDN,
sem dependências: o que sai abre offline.

O que é gerado não é dado como concluído. Corre o **QA** (`src/ops/qa.mjs`): ficheiros
obrigatórios, `lang`/viewport/`h1`, links internos que existem, rótulos nos formulários, `alt` nas
imagens, JavaScript que compila, CSS com `@media`, JSON válido — e um pente de honestidade
(lorem ipsum, TODO, placeholders). Fica guardado o **manifesto sha256** dos ficheiros auditados.

Só depois: **aprovar** (exige QA aprovado e ficheiros iguais aos auditados) e **entregar**. O
preview é verdadeiro — `/preview/<id>/` serve os ficheiros gerados pelo próprio Órbita — e
`Obter .zip` leva o projeto para qualquer alojamento. **Vercel** e **GitHub** só avançam com
credenciais, e uma recusa nomeia a variável que falta; um pedido de deployment fica registado como
pedido, nunca como publicado.

Segurança: 300 pedidos/minuto por IP, `/api/ops` exige o token quando `ORBITA_ADMIN_TOKEN` está
definido (cabeçalho `x-orbita-admin`), e um pedido mutável autenticado por cookie vindo de outra
origem é recusado (CSRF, 403). Sem a variável o arranque diz que está em **modo local**.

## Quem entra, e o que pode fazer

Autenticação e autorização são coisas diferentes, e aqui estão separadas. A partir da primeira
conta, o Órbita pede entrada em `/app` e cada rota exige uma permissão concreta:

| Papel | Lê | Escreve | Aprova e entrega | Contas e definições |
|---|---|---|---|---|
| **dono** | sim | sim | sim | sim |
| **gestor** | sim | sim | sim | não |
| **operador** | sim | sim | não | não |
| **leitor** | sim | não | não | não |

- **Palavras-passe** com scrypt e sal próprio; mínimo de 12 caracteres, sem as óbvias e sem o
  próprio email. Nunca aparecem numa resposta, num log ou na UI.
- **Sessões** com prazo (`ORBITA_SESSION_HOURS`, 12 h por omissão), cookie `HttpOnly` +
  `SameSite=Strict` (+ `Secure` em https), revogação individual e fecho imediato ao sair.
- **A primeira conta** cria-se em `/app` («Criar conta de dono», no rodapé da mesa enquanto estiver
  em modo local) e só enquanto não existir nenhuma; depois, só um dono cria contas em **Contas**.
  `GET /api/auth/estado` diz sempre em que modo a instalação está.
- **Força bruta**: 20 tentativas/min por IP e 5 falhas por conta bloqueiam-na 15 minutos. O email
  vai em hash para o registo de tentativas — não fica em claro.
- **A credencial de máquina** (`ORBITA_ADMIN_TOKEN`, 16+ caracteres) continua a existir para
  scripts e CI e vale como dono. Com contas, o normal é desligá-la: `ORBITA_AUTH=sessao`.
- **Sem contas nem token** o Órbita fica em **modo local** — e o arranque di-lo em voz alta, porque
  é só para esta máquina.

## O Cérebro é a sala-mestre, e o escritório mexe-se

O centro deixou de ser um objecto exposto. Passou a ser **uma sala**: uma praça de latão rodeada por
um aro de LED, três colunas com colar de luz e **seis púlpitos — um por sala, com a cor dessa sala**.
O orbe fica no meio, em destaque, e é o ponto onde os seis chefes se encontram.

Os corredores que ligam as salas ao centro são corredores a sério: piso ao nível das salas, guardas
de latão e **uma linha de LED na cor da sala, com a luz a correr para o Cérebro**. Nas paredes, a
mesma ideia: uma calha acesa e uma luz que percorre o vidro — e que **acelera onde há trabalho real**.

E as pessoas circulam:

- uma **tarefa nova** na sala → o chefe vai ao Cérebro buscá-la, volta e **explica ao grupo** (que se
  levanta para ouvir);
- alguém **à espera de uma decisão** → o chefe vai ao Cérebro **pedir ajuda** e volta a contar;
- sem trabalho, ninguém anda.

Nada disto é encenação: os sinais vêm da base de dados e o mesmo trabalho nunca faz o chefe andar
duas vezes. O guia completo — circuito, regras, tempos e limites — está em
[`docs/CIRCULACAO.md`](docs/CIRCULACAO.md).

## A oficina: os agentes forjam as próprias ferramentas

Um agente que precisa de olhar para o negócio e não tem com que o fazer não inventa números: pede
uma ferramenta. A **oficina** escolhe a receita, escreve o código, **prova-o contra os dados reais
desta máquina** (o cérebro, as tarefas, a documentação), repara-o uma ou duas vezes se ele se
partir, e só depois o deixa no catálogo da sala. A partir daí a ferramenta corre **antes** de o
agente escrever — e o que ela leu entra no prompt como dados.

E vê-se tudo. A tecla **F** abre o **terminal da oficina**: um painel escuro sobre o escritório onde
cada linha é uma coisa que aconteceu (a receita escolhida, o código a ser escrito, cada prova, a
reparação, a activação, o primeiro resultado real). O mesmo fluxo, na linha de comandos:

```bash
node tools/forge.mjs forge marketing "contar as palavras das notas do cérebro"
node tools/forge.mjs watch
```

As ferramentas vivem em `data/forge/tools/<sala>/<id>/` (com histórico de versões), correm num
contexto isolado com prazo de CPU e sem `process`, `require` ou rede, e as que **escrevem** só
activam com a tua mão. Guia completo, com a régua de segurança e os limites ditos: **[FORGE.md](FORGE.md)**.

## Tarefas: trabalho com dono, prazo e resultado

Os seis departamentos — **ORION** (command), **LUNA** (prospect), **KAI** (sales), **NOVA** (design),
**ZEKE** (engineering) e **MIRA** (media) — trabalham por tarefas guardadas na base de dados:

```
queued → running → succeeded | failed | awaiting_approval
```

Cada tarefa tem departamento, tentativas limitadas, prazo, resultado e evidência. Uma só tarefa
aberta por chave (o índice parcial impede duplicados mesmo com pedidos em paralelo). Um processo
que morre a meio é recuperado no arranque. Acções de risco param em `awaiting_approval` e só
avançam com a tua aprovação — fica escrito quem aprovou.

O que precisa de um motor de IA (redigir mensagens, rascunhos de conteúdo, correcções de código)
**falha com o motivo** quando não há chave; as tarefas determinísticas — qualificar um lead,
pesquisar, preparar proposta, escrever o briefing, gerar o código, auditar, entregar o preview,
revisão de prioridades — correm sempre.

Na mesa: **Tarefas** (`#/tarefas`) para correr, repetir e aprovar; **Agentes** (`#/agentes`) mostra o
estado real de cada departamento — «a trabalhar» só quando há uma tarefa em curso.

## A mesa de trabalho: leads e aprovação

O botão **▤ MESA** (ou `http://localhost:4520/app`) abre a superfície de trabalho: barra lateral
com **Hoje**, **Leads**, **Conversas** e **Saldo**, cartões brancos e um azul só para o que é
acção. Não substitui o escritório — é a página que se abre de manhã para decidir.

- **Leads** — procura por nome, cidade, nicho, telefone, email ou site; filtros «por contactar»,
  «sem site», «responderam»; cada linha com a nota, o estado do funil e o contacto. Clicar abre o
  lead.
- **A aprovação de cada lead** — a mensagem pronta numa bolha, o canal e o estado por palavras, o
  **porquê** com os sinais que existem mesmo, e dois botões: **Rejeitar** e **Aprovar e enviar**.
  Aprovar abre o link de WhatsApp já com o texto; depois confirmas com **Já enviei**. O email
  tenta a saída e, se faltar token ou consentimento, di-lo em vez de fingir.
- **Hoje** — quatro números reais e a lista do que espera decisão, com a mensagem ao lado.
- **Saldo** — entrou, gastou, margem, por campanha, por fornecedor e por unidade.

A mesa é um ficheiro só (`dist/mesa.html`), sem pedidos externos, e funciona no telemóvel com
barra inferior. O **PARAR TUDO** está em todas as páginas, com o estado verdadeiro.

## Autonomia que se ganha, e a agência

O Órbita **não te pede para confiar**: pede-te decisões, conta-as, e só depois propõe mais. Cada
tipo de mensagem (canal + gancho, por exemplo `whatsapp:sem-site`) começa em **pede-me sempre**.
Aos **50 casos decididos com 95% de aprovações** — limiares que podes mudar — o Hoje faz a
pergunta: «posso enviar este tipo sozinho?». Dizes que sim com o mesmo gesto de sempre, e podes
voltar atrás com um toque, a qualquer momento. Antes disso, o texto é concreto: «faltam 47 casos
decididos». A autonomia nunca passa por cima do opt-out, do PARAR TUDO, do aquecimento do número
nem do **modo ensaio** — a semana em que o escritório escreve tudo e não envia nada, e no fim te
mostra o que teria saído.

O rascunho tem **avaliações próprias**: um conjunto fixo de casos com expectativas escritas
(preço certo, pergunta no fim, nenhuma citação inventada, nenhuma promessa) que corre a cada
mudança de prompt. `node evals.mjs` → 8/8 hoje; o resultado fica guardado com a versão, e uma
corrida pior aparece como regressão em vez de se descobrir num cliente.

A aba **SALDO** fecha a conta que interessa: o que entrou (escrito por ti, com campanha), o que
gastaste em APIs, e a margem — mais custos por lead, por contactado e por cliente. Sem entradas
registadas a margem é negativa, e o ecrã di-lo em vez de mostrar zero.

No modo agência, cada cliente tem **o seu próprio ficheiro de base de dados**
(`data/clientes/<slug>/orbita.db`): um erro num não pode misturar leads de outro. O select
**Espaço**, no topo da gaveta, troca de negócio; `+ CLIENTE` cria um em três passos.

## Integrar outra IA (Codex, Antigravity, qualquer API)

O escritório não está preso ao Claude Code. O botão **IA**, ao lado de EQUIPA no painel de tarefas,
mostra o motor que está a responder; clica e vês todos os que existem nesta máquina — **Claude Code**,
**Codex**, **Gemini**, uma **CLI personalizada**, e as APIs **Claude, OpenAI, OpenRouter, Groq,
Mistral, DeepSeek, xAI, Gemini, Ollama e LM Studio**, mais **qualquer endpoint compatível com OpenAI**.
Cada linha diz se está ligado ou o que lhe falta («`codex` não está no PATH — instala com
`npm i -g @openai/codex`»), tem **TESTAR** (um turno curto a sério, com o texto e os milissegundos)
e **USAR** (troca a quente, sem reiniciar).

A diferença é honesta: o **Claude Code** é o único que dá mãos ao agente (ferramentas MCP e Chrome);
os outros devolvem texto. As chaves vivem no ambiente, nunca em ficheiros. Nada é instalado por ti.
O detalhe — tabela de motores, `ai.*` no `office.config.json`, ordem de escolha (`AO_AI` →
`data/ai.json` → `ai.provider` → `ai.fallback`) e as rotas `/api/ai` — está em **[AI.md](AI.md)**.

## Ensinar os agentes

- **Entrevista**: abre a conversa de um líder e diz `configurar`. Ele faz-te cinco perguntas e
  escreve os briefings da equipa e uma competência para o trabalho que descreveste.
- **Correções**: quando devolves uma entrega com uma nota (`revê: …`), a lição fica registada em
  `brain/Órbita/feedback/<agente>.md`. Regras permanentes entram em todas as tarefas seguintes.

## Competências (skills)

Cada pasta em `skills/` é uma competência: um `SKILL.md` com cabeçalho (`name`, `description` e,
opcionalmente, `departments`/`agents`) e o procedimento em markdown. As tuas vivem em
`brain/Órbita/skills/<nome>/SKILL.md` e ganham em caso de nome igual.

## Configuração

`office.config.json`:

```json
{
  "name": "Órbita Studio",
  "brain": "./brain",
  "port": 4520,
  "model": "sonnet",
  "mcp": { "allow": [], "deny": [], "departments": {} },
  "tools": { "web": true, "browser": true },
  "teams": { "enabled": true, "max": 4 },
  "ai": { "provider": "auto", "fallback": ["claude-cli", "codex-cli", "gemini-cli", "anthropic", "openai"] }
}
```

Variáveis de ambiente: `AO_MODEL` (modelo da casa), `AO_PORT`, `AO_AI` (motor de IA: `claude-cli`,
`codex-cli`, `gemini-cli`, `anthropic`, `openai`, `ollama`, …), `AO_AI_MODEL` (modelo desse motor) e
as chaves de cada API (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`,
`MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `AO_AI_KEY`) e as da pesquisa
(`GOOGLE_MAPS_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CSE_ID`). Alterações locais vão para
`office.config.local.json` (ignorado pelo git). Ver [AI.md](AI.md) e [PESQUISA.md](PESQUISA.md).

As horas em todo o escritório são de **24 horas** (`00:00`–`23:59`), nunca AM/PM — o campo de hora
mostra as 24 horas do dia e a hora que o browser está a usar não muda isso.

## API

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/platform` | a máquina, as versões e as APIs reais (prontas, falhadas, chaves em falta) — com CORS |
| GET | `/api/platform/apis` | só o estado dos serviços sondados |
| POST | `/api/platform/reload` · `/probe` | reler o `.env` · forçar sondas (token) |
| GET | `/api/health` | versão, empresa, modelo, departamentos, agentes |
| GET | `/api/agents` | o elenco tal como está em disco |
| GET | `/api/brain` | o grafo de notas |
| GET/POST | `/api/tasks` | listar / criar tarefas |
| POST | `/api/tasks/:id/run` · `/revise` · `/approve` · `/reject` | correr, rever, aprovar, rejeitar |
| GET/POST | `/api/routines` | ler / criar rotinas |
| POST | `/api/chat` | falar com um agente |
| GET | `/api/ai` | os motores de IA: o que está ligado, o que falta e porquê |
| POST | `/api/ai/test` | um turno curto a um motor (`{"provider":"codex-cli"}`) |
| POST | `/api/ai/switch` | trocar de motor a quente (`{"provider":"anthropic"}`) |
| GET | `/api/pesquisa/estado` | o que está ligado na pesquisa (Tavily principal + Geoapify) |
| POST | `/api/pesquisa/procurar` | procurar contexto na Tavily ou empresas no Geoapify (`{"kind":"places","what":"ginásios","where":"Porto"}`) |
| GET | `/api/leads` | a lista de leads guardada, por nota |
| POST | `/api/leads/status` | mudar o estado de um lead |
| GET | `/api/ops/summary` | funil, conversão, custos e estado da fila |
| GET | `/api/ops/aovivo` · `/aovivo/stream` | o que cada posto está a fazer (SSE; 401 sem sessão) |
| GET/POST | `/api/ops/leads` | os leads guardados / importar (um ou `{ leads: [...] }`) |
| PATCH | `/api/ops/leads/:id` | andar um passo no funil (`{ "status": "contactado" }`) |
| POST | `/api/ops/consent/opt-out` | bloquear um email/telefone para sempre |
| GET/POST | `/api/ops/messages` | mensagens / criar rascunho |
| POST | `/api/ops/messages/:id/approve` · `/reject` · `/send` · `/confirm` | a decisão e o envio |
| GET | `/api/ops/queue` · `/api/ops/events` · `/api/ops/usage` | fila, auditoria, consumo |
| GET | `/api/ops/today` | o ecrã Hoje: decisões, acontecimentos, o que vem a seguir |
| POST | `/api/ops/stop` | interruptor de emergência (`{ "stop": true }`) |
| GET | `/api/ops/outbox` | fila de saída: alugueres, tentativas, revisões |
| GET | `/api/ops/events/verify` | verifica a cadeia de hashes do registo |
| POST | `/api/ops/leads/:id/pesquisar` | lê o site do lead e devolve os factos |
| POST | `/api/ops/leads/:id/rascunho` | escreve a mensagem a partir dos factos |
| POST | `/api/ops/messages/:id/sinal` | registar o que responderam (a nota aprende) |
| GET/POST | `/api/ops/oferta` | a tua oferta: preço, prazo, garantia |
| GET | `/api/ops/autonomia` · POST `…/limiar` · POST `…/:scope/subir` · `/descer` | o nível de autonomia por tipo de mensagem |
| GET/POST | `/api/ops/ensaio` · POST `/api/ops/messages/:id/promover` | o modo ensaio e a saída dele |
| GET | `/api/ops/evals` · POST `/api/ops/evals/correr` | as avaliações do rascunho |
| GET | `/api/ops/saldo` · POST `/api/ops/receita` | receita, custos, margem |
| GET/POST | `/api/ops/clientes` · POST `/api/ops/clientes/:id/entrar` · GET `/api/ops/agencia` | os espaços de cliente |
| GET | `/api/ops/leads/:id` | um lead com o dossiê e as suas mensagens (a página do lead) |
| GET | `/api/ops/messages?leadId=` | as mensagens de um lead |
| GET/POST | `/api/ops/projetos` | a lista de projetos / criar um |
| POST | `/api/ops/leads/:id/projeto` | criar o projeto de um lead (409 se já existe) |
| GET | `/api/ops/projetos/:id` | projeto, ficheiros, QA, entregas e histórico |
| POST | `/api/ops/projetos/:id/gerar` · `/qa` · `/aprovar` · `/entregar` | o pipeline, passo a passo |
| GET | `/api/ops/projetos/:id/zip` | os ficheiros gerados em ZIP |
| GET/POST | `/api/ops/tarefas` | as tarefas / criar uma (`correr: true` executa já) |
| POST | `/api/ops/tarefas/:id/correr` · `/aprovar` · `/rejeitar` | correr, aprovar ou rejeitar |
| GET | `/api/ops/agentes` | estado real dos seis departamentos |
| GET | `/api/ops/pipeline` | funil por fase, por origem e oportunidades paradas |
| GET | `/api/ops/pesquisa?q=` | pesquisa global (leads, projetos, tarefas) |
| GET | `/api/ops/atividade` | tarefas, fila e eventos recentes |
| GET | `/preview/:id/…` | o preview real do projeto |

## Verificação

```bash
npm run check         # 94 verificações locais (build, elenco, competências, rotinas, operação, Hoje, autonomia, saldo, mesa, projetos, tarefas, contas, ao vivo, servidor)
npm run test:ops      # 69 testes da operação: base de dados em memória, nenhum serviço externo
# os monitores do escritório 3D leem a base de dados por SSE: GET /api/ops/aovivo · /api/ops/aovivo/stream
node evals.mjs        # 8 casos fixos do rascunho (preço, pergunta, citações, promessas)
npm run test:integrations  # 18 testes das integrações e da pesquisa Google
npm run check:live    # uma tarefa e uma conversa a sério, pelo Claude
```

A única verificação que falha numa máquina sem Chrome instalado é a do navegador
(`npx playwright install chrome`).

## Estrutura

```
serve.mjs            servidor local + API
providers.mjs        os motores de IA: CLIs e APIs (ver AI.md)
leads-store.mjs      a lista local de leads: ler, gravar sem duplicar, por estado (sem fornecedor nenhum)
api/_pesquisa.mjs    a pesquisa do servidor: Tavily (principal) e Geoapify (empresas) — ver PESQUISA.md
src/                 a página: cena 3D, painel, calendário, cérebro
brain/               as tuas notas (o Cérebro)
skills/              competências incluídas
office.agents.json   o elenco
office.config.json   nome, porta, modelo, equipas
data/                tarefas e estado (ignorado pelo git)
dist/                o escritório compilado num único HTML
```

## Licença e créditos

- **Órbita** — criado por **Chelton Mahoze**.
- Derivado de *Agents Office* (Sahni.ai), distribuído sob **PolyForm Noncommercial 1.0.0** com
  termos adicionais. Vê [LICENSE](LICENSE): uso pessoal e interno, sem revenda nem rebranding
  comercial do produto original.
- O texto original em inglês deste README está em [README.en.md](README.en.md).
