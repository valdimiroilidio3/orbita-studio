## 1.13.2 — 28 out 2026 · As portas passaram a abrir para o Cérebro (e a ponte sai delas)

Pedido: *«melhore os lugares das portas e analisa bem e muda isso com dev apple design 3D»*.

### A análise, primeiro

A 1.13.1 pôs a porta no **meio do pano de fundo** de cada sala. Era melhor do que o canto, mas partia
de uma suposição falsa: **o Cérebro não está em frente desse pano**. As seis salas estão em diagonal
no campus (`±30, ±23` e `0, ±48`, com o pod do Cérebro em `0,0`), e o vector «centro da sala →
Cérebro» sai do pod por um canto, não pelo meio do pano. Resultado: a passadeira saía enviesada da
porta e corria **encostada ao pod**; nas salas de canto a porta ficava **perpendicular ao pano que a
recebia**; e nas três salas cuja porta caía no bordo aberto a porta estava de pé no vazio.

O que a planta diz agora (conta em `src/circulation.js`, valores reais):

| sala | porta no lado | vão | ponte |
|---|---|---|---|
| emails | `+x` | **anteparo** (lado aberto) | 13,8 m → canto `-8,-8` |
| delivery | `+z` | **anteparo** | 22,1 m → `0,-8` |
| sales | `-x` | vão na parede lateral | 13,8 m → canto `8,-8` |
| marketing | `+x` | **anteparo** | 13,8 m → canto `-8,8` |
| fin | `-x` | vão na parede lateral | 13,8 m → canto `8,8` |
| ops | `-z` | vão na parede de fundo | 22,1 m → `0,8` |

### O que mudou

- **`src/circulation.js`** (novo): a regra num sítio só. A porta fica no lado da sala que olha para o
  Cérebro, no ponto em que a linha *centro → átrio* sai do pod; a ponte vai desse ponto ao canto do
  pod do Cérebro **em linha recta**, e nasce 0,9 m à frente da porta, no eixo dela.
- **O vão passou a poder abrir nos dois panos.** `makeRoomWalls` aceita `opening: { side, at, w, h }`:
  parte a parede de **fundo** (`-z`) ou a **lateral** (`-x`), com verga, rodapé partido e ripaado que
  não atravessa. Antes só o pano de fundo sabia abrir-se.
- **A porta passou a assentar na face interior do pano que a recebe** (0,46 m para dentro: espessura da
  parede + meio aro) e, quando não há parede, no bordo do pod com 3 cm de folga.
- **O ANTEPARO** — um pano próprio para as três salas cuja porta cai no lado aberto: base de marfim
  até 1,02 m, **banda de vidro** até 2,80 m, montantes e remate de latão, fio de luz na cor da sala.
  É de vidro por cima de propósito: fecha a porta sem tapar a sala à câmara.
- **A PRAÇA do limiar** — um disco de pedra de 2,30 m de raio em cada porta, com aro de latão e anel
  aceso. Não é enfeite: quatro das seis pontes chegam à porta em diagonal, e um tapete de 3,2 m a
  entrar a 36° numa porta de 2,6 m deixava uma cunha à vista e um canto a raspar no pano. A praça
  absorve o ângulo — o tapete nasce debaixo dela — e dá às seis entradas o mesmo gesto.
- **A passadeira, o percurso dos chefes e a porta leem a MESMA conta**: `deptRT.gate`/`brainGate`
  passam a sair de `bridge.from`/`bridge.to`, por isso o chefe anda por cima do tapete em vez de
  atravessar o chão ao lado dele.

### Provas

- **`circulation.test.mjs`** (novo, 9 testes, sem three): porta no bordo do pod, eixo aponta ao
  Cérebro, 2 m à frente da porta é fora do pod, ponte nasce a 0,9 m no eixo, acaba no bordo do pod,
  não atravessa a sala nem o pod, 3 paredes / 3 anteparos, seis sítios distintos, átrio como
  argumento (átrio maior → pontes mais curtas), sala inexistente dá erro.
- **`scene.smoke.mjs`** (8 asserções novas, agora sobre o que foi CONSTRUÍDO): o vão na parede é o da
  planta, o eixo da porta é o da planta, a passadeira começa e acaba onde a ponte manda, o anteparo
  cobre a porta e a praça existe. Total: **130/130** (121 antes).
- **`tools/portas.mjs`** (novo) desenha a planta inteira sem browser (o desenho está em
  `docs/planta-portas.png`), e o **`tools/room.mjs`** passou a montar a sala **com** o vão e a porta —
  antes desenhava uma sala fechada que já não existia.

## 1.13.1 — 28 out 2026 · As portas passaram a ser portas

Pedido: *«melhore o design 3D das portas»*.

### O que estava errado (e porquê)

- **A porta flutuava.** O `rboxGeo` cresce a partir da BASE do objecto, e a primeira versão colocava os
  montantes a meia altura (`H/2`): os postes começavam a 1,3 m do chão. Vê-se no primeiro desenho.
- **A porta não tinha parede.** O corredor saía do *canto* da sala — a 1 m da esquina — e o pórtico
  ficava 1,1 m à frente do pano, solto no ar. Não havia buraco, não havia passagem: de fora não se
  via nada, e de dentro era um adereço ao lado de uma parede inteira.

### O que mudou

- **O corredor passa a nascer no MEIO do pano que dá para o Cérebro.** É a raiz da correcção: ao
  centro há parede onde abrir um vão, e a porta assenta nele. As esquinas ficam livres.
- **A parede abre-se.** `makeRoomWalls` aceita `opening: {x, w, h}` e parte o pano de fundo em dois
  troços, com **verga** por cima, **rodapé partido** e **ripaado que não atravessa** o vão. Três salas
  têm vão na parede; as outras três recebem a porta no bordo aberto (não há parede para abrir).
- **Porta nova**, à escala de uma pessoa e de um corredor de 3,2 m:
  - aro de latão **2,84 × 2,64** com 0,24 de fundo e **vão livre de 2,60 × 2,18**;
  - **duas folhas de vidro fosco** (opacidade 0,26) que abrem **ao meio**, 0,45 cada — como uma porta
    automática — com **puxador de latão** no bordo de ataque de cada uma;
  - **carril** com carros à vista e **bolsos** nas pontas (a folha deslizada recolhe ali; sem eles, uma
    folha aberta ficava pendurada no ar nas salas sem parede);
  - **soleira**, dois **filetes de luz** no piso e uma **mancha de luz** que a entrada deixa cair no
    corredor;
  - **luz sob a padieira** dos dois lados e dentro do vão da parede;
  - **placa com o NOME da sala** (1,12 × 0,26, duas faces, desenhada em canvas na cor do vidro) — é a
    única peça escrita da cena, e diz o nome do sítio, não um número;
  - **barra de topo acesa** na cor da sala: é a peça que se lê da câmara isométrica, que olha o
    escritório de cima — antes de se ver a porta, vê-se a cor dela na entrada;
  - **aro de latão na face do corredor**, para o mesmo desenho dos dois lados.
- **`WALL` e `DOOR` exportados** por `src/builders.js`: a parede e a porta passam a ler as mesmas
  medidas. Foi a falta disto que deixou a primeira versão 10 cm ao lado do buraco.
- **Corrimãos do corredor encurtados** 1,15 m do lado da sala: passavam à frente da porta e cortavam a
  entrada ao meio.
- **No escuro**: latão velho, vidro mais denso, LED da entrada mais intenso — a porta é das últimas
  coisas que se apagam numa sala sem luz.

### Provas

`node scene.smoke.mjs` passou a exigir, além das cores:

```
✓ contorno de 2,7–3,2 m e vão livre ≥ 2,4 × 2,0
✓ duas folhas abertas mais de 0,3 m
✓ a placa de cada porta diz o nome da sala
✓ 3 salas com vão na parede (≥ 2,8 × 2,2) e 3 com a porta no bordo aberto
```

Desenhos do rascunho (o rasterizador caseiro não tem emissão nem texturas, por isso o LED e a placa
aparecem sem brilho): `docs/porta-sala.png`, `docs/porta-corredor.png`, `docs/porta-na-sala.png`.

### Dito sem enfeitar

- A **placa não é legível de todos os ângulos**: a câmara é isométrica e olha as paredes de cima; o
  nome lê-se, mas em escorço. A cor e a barra acesa é que fazem a identificação à distância.
- O **vidro não é vidro**: é um material transparente com 0,26 de opacidade, sem refracção nem
  reflexos do ambiente. À escala do escritório lê-se como vidro fosco; ao lado, não engana ninguém.

## 1.13.0 — 28 out 2026 · Passadeiras a andar, entradas à cor da sala, e a API que já está de pé

Pedido: *«faça passadeiras rolantes no corredor, preta, e entradas na sala (roxa, azul e amarela); e
implementa entrada de API real — assim que lançar o projecto, colocar a API já deve funcionar de
forma automática; faz esse preparo agora, para todos os tipos de app, as APIs devem funcionar logo,
instantaneamente. E o terminal deve funcionar perfeitamente, se possível de acordo com a máquina
onde o sistema foi aberto.»*

### As passadeiras andam — e são pretas

- O corredor deixou de ser uma laje com uma linha de luz. É uma **passadeira de aeroporto**: tapete
  **preto** (`#23252B`) com ripas em relevo, **guardas de latão** dos dois lados, um canal de LED na
  cor da sala e o aro de chegada fundido no latão.
- **O tapete rola a sério**: uma textura de ripas (64×64, gerada uma vez e clonada por corredor, com
  `repeat = comprimento / 1,15`) desloca-se ao longo do comprimento. Nada de aspecto: o `offset` da
  textura muda entre dois frames, e é isso que o teste verifica.
- A direcção é a do trabalho: **para o Cérebro**, a mesma da luz da sala por cima. Sala com trabalho
  (`live` + `waiting`) → a fita **e** o tapete andam 2,6× mais depressa.

### Cada sala tem uma entrada na sua cor

- `makeRoomEntrance` (novo em `src/builders.js`): **pórtico** de 4,6 × 2,62 m — dois montantes de
  latão, lintel, **cova de luz acesa na cor do vidro da sala** e soleira escura com dois filetes
  acesos.
- Assenta **1,1 m para dentro** da porta, virado ao corredor (a direcção vem do `main`, que é quem
  conhece o corredor). É clicável: clicar no pórtico foca a sala.
- As seis cores são as do vidro de cada sala: verde (#1FA36B), amarelo (#E3B93A), vermelho
  (#DC5348), roxo (#8B5AD6), azul (#4A6DE0) e azul-céu (#41AEE4). Nenhuma foi escolhida à mão: vêm
  de `src/data.js`.

### A API real, de pé ao arrancar (`platform.mjs`)

- **Catálogo de 27 serviços** com sonda própria: IA (OpenAI, Anthropic, Gemini, OpenRouter, Groq,
  Mistral, Hugging Face, Replicate, ElevenLabs), dados (Google Places, Programmable Search),
  base de dados (Supabase, Airtable, Notion), código e deploy (GitHub, Vercel, Cloudflare, AWS),
  pagamentos e loja (Stripe, Shopify) e mensagens (Resend, SendGrid, Twilio, Telegram, Slack,
  Discord, Meta).
- No arranque o servidor **sonda** cada serviço que tenha chave — uma chamada barata, com prazo de
  6 s, sem efeitos secundários — e guarda o resultado 10 minutos. `GET /api/platform` devolve o
  retrato: máquina, versões, o que está `ready`, o que falhou e **qual variável falta em cada um**.
- **`.env` a quente**: o ficheiro é vigiado; gravar uma chave nova entra no processo e dispara novas
  sondas **sem reiniciar**. É o «instantaneamente» do pedido, e é literal.
- **O token interno deixa de ser um passo manual**: se `ORBITA_API_TOKEN` não existir em lado nenhum,
  nasce no primeiro arranque (256 bits, 43 caracteres) e é escrito no `.env` com permissões 600.
- **Qualquer app**: `data/api/providers.json` acrescenta serviços sem tocar em código (`id`, `name`,
  `env`, `probe.url`, `probe.header`, `prefix`). Entradas inválidas são ignoradas com aviso.
- `GET /api/platform` e `/api/platform/apis` abrem **CORS** (`*`): uma app web, um telemóvel ou outro
  servidor pode perguntar «com que contas eu» no arranque dela. As rotas privadas continuam fechadas.

### O terminal olha para a máquina

- `:help` ficou **curto** (três linhas); a lista completa mudou para `:comandos`.
- `:maquina` mostra SO, arquitectura, núcleos, CPU, memória, uptime, fuso, `node`, `shell`, `pid`,
  directoria e **as ferramentas do PATH com a versão que elas dizem** (e as que faltam).
- `:api` mostra quantos serviços estão prontos, os que falharam com o erro, e a chave que falta.
- **Tab** completa o comando; **↑ ↓** percorrem o histórico e o rascunho a meio não se perde.
- Ao abrir, o terminal escreve **uma** linha com a máquina onde está — uma vez por sessão.
- Comando desconhecido → sugestão do mais parecido (distância de edição), em vez de silêncio.

### Provas

- `node scene.smoke.mjs` — passa a verificar **6 passadeiras pretas** (`#23252b`), que o `offset` do
  tapete **muda entre dois passos** da simulação, e **6 entradas** cuja cor é a do vidro da sala.
- `node --test platform.test.mjs` — 12 testes: `.env` (aspas, `export`, lixo), token gerado uma só
  vez, 200 → pronta, 401 → «com chave mas falhou», **a chave nunca sai numa mensagem de erro**, AWS
  não finge estar verificada, chave nova a quente sem reiniciar, ambiente real a mandar sobre o
  ficheiro, serviços declarados em JSON, máquina e descoberta de rotas.
- `node --test terminal.test.mjs` — 8 testes com jsdom sobre o `src/forge.js` que vai para o browser:
  `:help` curto, `:comandos` completo, `:maquina`/`:api` a mostrarem **o que o servidor respondeu**,
  Tab, histórico, sugestão, e a linha da máquina uma só vez.

### Dito sem enfeitar

- Uma chave de terceiros continua a ser **do dono**: a automação cobre o token interno, a leitura do
  `.env`, as sondas, o diagnóstico e o recarregamento. Sem a chave da Gemini não há Gemini — o que
  passa a haver é a resposta exacta de qual variável falta, em vez de um erro genérico.
- AWS não tem sonda barata (assinatura SigV4 exige região): aparece como configurada e **não
  verificada**, e diz isso.
- O `node check.mjs` continua a marcar falha no `smoke: browser` nesta máquina: não há Chromium.

## 1.12.0 — 28 out 2026 · A circulação: o Cérebro é a sala, e o escritório mexe-se

Pedido: *«nos vidros deve passar uma luz LED da cor, e também quero arriscar numa elegância neste
projecto, criando uma estrutura mais bonita; cria corredores na direcção do Cérebro, que será onde as
pessoas vão passar os projectos para a outra equipa pegar e continuar… o Cérebro vira uma sala
futurística, coisa de outro mundo, rodeada de LED; mantém o globo em destaque, como um ponto onde
cada chefe se reúne… e cria movimentos para cada chefe: quando tiver dúvida ou quiser pedir ajuda,
dirige-se à sala do Cérebro. Quando peço algo no chat, o chefe deve estar na sala, depois vai à sala
dele, explica ao grupo e criam — como 100% de pessoas normais numa empresa de engenharia.»*

### O Cérebro passou a ser uma sala (não um objecto)

- **A praça**: dois aros de latão no chão (r 3,1 e 6,4) e um **aro de LED a fechar a sala** (r 7,1).
- **Seis púlpitos**, um por sala, a 5,0 m do centro: pé e fuste de latão, tampo de vidro inclinado
  para quem está de pé, **aresta acesa e ecrã na cor da sala**. É o lugar de cada chefe, e vê-se de
  longe quem é de onde.
- **Três colunas** de 2,7 m com um **colar de luz** a meio fuste: marcam a sala sem a fechar (o pod
  não tem tecto).
- O **orbe** (o globo) não foi tocado: continua a ser o centro, e agora tem uma sala à altura dele.

### O LED que passa

- Cada pano de parede ganhou **uma calha acesa** no arranque do vidro e **uma luz a percorrer o vidro**
  — uma textura de cometa em mistura aditiva que rola ao longo da faixa, na cor da sala.
- **18 faixas** no total: 2 por sala nas paredes + 1 por corredor. Anima-se tudo numa passagem por
  frame; **a luz acelera onde há trabalho real** (`live` + `waiting` daquela sala) e continua lenta
  onde não há. Não é telemetria: é ambiente — mas não mente sobre onde há trabalho.

### Os corredores

A passadeira branca por baixo do chão passou a **corredor**: piso ao nível das salas, guardas de
latão dos dois lados, **linha de LED na cor da sala a correr para o Cérebro** e um aro de latão a
marcar a chegada. Lê-se a direcção do trabalho.

### A circulação (o coração do pedido)

- O chefe **levanta-se quando há trabalho**: uma tarefa nova na sala → vai ao Cérebro buscá-la
  (3,0 s no anel, virado ao orbe), volta pelo corredor e **explica ao grupo no topo da sala** (3,2 s).
- Alguém **à espera de uma decisão** → o chefe vai ao Cérebro **pedir ajuda** (2,4 s) e volta a contar
  o que trouxe (2,0 s).
- Uma tarefa **acaba de correr bem** → o chefe **leva o trabalho ao Cérebro** (2,2 s) — o «passar o
  projecto» do pedido — e volta ao posto sem discurso.
- **O último troço é sempre a pé** até à cadeira: o chefe nunca «teleporta» do topo da sala para o
  lugar (fase `seat`).
- **O grupo levanta-se para ouvir** — pose nova `listen` (de pé, braços ao lado do corpo, cabeça
  voltada a quem fala) — e volta ao posto quando ele acaba.
- **Só a base de dados manda alguém andar.** O sinal é o `id` do trabalho, com memória: o mesmo pedido
  nunca faz o chefe andar duas vezes. Sinais velhos (>25 s) caem; 9 s de descanso entre viagens.
- O percurso usa o **eixo central** da sala (o único corredor que não atravessa uma secretária) e a
  **porta** (o canto aberto). O mesmo nos dois sentidos.

### O que ficou provado (e como)

`npm run test:scene` — 34 asserções novas, incluindo o ciclo completo da coreografia, com um
sinal **real** e o tempo avançado à mão (`CC.stepSim`, porque o WebGL falso do harness morre no
primeiro *render target*):

```
✓ 18 faixas de LED (3 por sala) · corredores com guardas em 6 salas
✓ sala-mestre com 6 lugares de chefe e um aro de 7,1 de raio
✓ o chefe levanta-se, chega ao Cérebro, volta, explica, o grupo levanta-se
✓ o mesmo trabalho não o manda andar duas vezes
```

`node tools/master.mjs` desenha a sala-mestre com o rasterizador caseiro → `docs/cerebro-sala.png`.
Guia: [`docs/CIRCULACAO.md`](docs/CIRCULACAO.md).

### Limites declarados

Não há procura de caminho (são rectas entre pontos fixos), nem colisões entre pessoas, nem conversa
entre agentes (não há motor de IA nesta máquina): o grupo levanta-se e ouve, e a postura não finge
conteúdo. A passagem de um projecto de uma equipa para outra acontece no Cérebro, onde os chefes se
cruzam, mas não há um estado «entregue a outrem» inventado no registo do trabalho.

## 1.11.0 — 27 out 2026 · A oficina: os agentes forjam as próprias ferramentas

Pedido: *«implementa um sistema capaz de cada agente criar próprias ferramentas para operar e
possibilidade de eu poder ver o que está a fazer através do terminal»*.

### O que é

Cada sala tem uma **oficina**. Quando falta uma ferramenta, a oficina: escolhe a receita, escreve o
código, grava-o em disco, **prova-o contra os dados reais**, repara-o se ele se partir, e só então o
põe no catálogo — em rascunho se a ferramenta escreve, porque aí quem decide é o dono. A ferramenta
passa a correr **antes de o agente escrever** e o resultado entra no prompt como dados.

```
⌁ mlead precisa de uma ferramenta: “contar as palavras das notas do cérebro”
▸ receita escolhida: notas-contagem (contar, palavras, notas, cerebro) · segunda: notas-procura
⌸ gravada marketing/contagem-do-cerebro v1 · data/forge/tools/marketing/contagem-do-cerebro/
✓ prova 1/1 · 7 ms · {"notas":35,"palavras":1122,"ligacoes":80,…}
✦ contagem-do-cerebro v1 ACTIVA · 1/1 provas · escopos brain:read
▶ primeira execução: {"notas":35,"palavras":1122,"ligacoes":80,"maiores":[…]}
⌁ marketing: Contagem do cérebro v1 (active) · 13 ms
```

Isto é saída real, copiada de uma execução nesta máquina.

### O terminal (a segunda metade do pedido)

- **Tecla F** (ou o botão `›_` ao lado do zoom) — painel escuro sobre a cena clara, com filtros por
  sala, contadores (`activas/total · execuções · falhas · média ms`) e um prompt de comandos:
  `:ls`, `:forge <sala> <necessidade>`, `:run`, `:adopt`, `:activate`, `:eventos`, `:help`.
- **`node tools/forge.mjs watch`** — o mesmo fluxo na linha de comandos, com cores; `ls`, `forge`,
  `run`, `adopt`, `activate`, `log`.
- **`GET /api/forge/stream`** é SSE; o histórico fica em `data/forge/log.ndjson`.
- **Sem encenação**: cada linha do terminal nasceu de um evento emitido pelo servidor depois de uma
  execução. Um terminal que caia não derruba a oficina (os subscritores são isolados).

### Como está construído

| peça | papel |
|---|---|
| `forge/manifest.mjs` | o portão: valida o manifesto e recusa código perigoso (diz a linha) |
| `forge/primitives.mjs` | as únicas funções que uma ferramenta tem — atrás de escopos |
| `forge/sandbox.mjs` | contexto `vm`, ponte só de texto, prazo de 400 ms, tecto de saída |
| `forge/compose.mjs` | 7 receitas, escolhedor com «porquê», duas regras de reparação |
| `forge/registry.mjs` | gravação atómica, versões, histórico, uso, adopção com proveniência |
| `forge/bus.mjs` | eventos → SSE + `log.ndjson` |
| `src/forge.js` · `tools/forge.mjs` | o terminal no browser e na linha de comandos |

### Segurança, dita sem marketing

Três vedações: **o portão** (recusa `require`, `import`, `process`, `eval`, `Function`,
`constructor`, `prototype`, rede, temporizadores, ciclos infinitos — com a linha), **o contexto**
(reino próprio, geração de código desligada, primitivas devolvem JSON em texto para que os dados não
tragam protótipos do anfitrião) e **o prazo** (400 ms por execução, cortados à força). O que isto não
é: um sandbox de segurança a sério — está escrito no `FORGE.md`, com o comando `--permission` do Node
para quem quiser mais. As ferramentas que escrevem nascem em **rascunho** e as provas correm em
**ensaio** (`dry: true`): provar nunca suja o cérebro.

### Integração com os agentes

- O prompt de cada tarefa ganhou a lista das ferramentas da sala e a instrução `FORGE: <o que falta>`.
- O servidor lê essa linha do resultado e **forja-a** (uma por tarefa), dizendo-o no fim do trabalho.
- `sense()` corre as ferramentas-sensor antes de o agente escrever e entrega os dados no prompt.
- `adopt` leva uma ferramenta a outra sala com proveniência e volta a prová-la **com os dados da
  sala de destino**.

### Provas

`test:forge` **29/29** (novo): o portão recusa seis formas de escapar e exige provas que olhem para
`result`; dentro do sandbox `process`/`require`/`fetch` não existem; um ciclo infinito é cortado em
menos de 3 s; o tecto de saída recusa em vez de corromper; sem escopo a primitiva recusa; a escrita
em ensaio não toca no disco; o compositor escolhe a receita certa e mais nenhuma; a reparação só
actua em falhas que reconhece; uma ferramenta partida fica `broken`; a adopção guarda a proveniência;
os eventos chegam por ordem ao terminal e ao `log.ndjson`.
`test:scene` ganhou o painel: existe no bundle, começa fechado, abre e fecha, tem 7 abas — e não
rebenta sem servidor nem `EventSource` (o caso de abrir o ficheiro com duplo clique).
Restantes: `test:office` 51/51 · `test:a11y` 21/21 · `test:ops` 71/71 · build 1 429 kB.

### Limites, ditos

Sem motor de IA ligado, quem escolhe é o compositor (7 receitas determinísticas) — com motor, o
mesmo portão aceita código escrito pelo modelo. A ponte MCP (expor as ferramentas ao `claude -p`) é o
passo seguinte; hoje as ferramentas correm no servidor, antes de o agente escrever.

## 1.10.4 — 27 out 2026 · A mesa no fim da sala (as salas de sete)

Pedido: *«nas salas com 7 agentes a mesa no fim da sala ficou com uma apresentação feia, melhore isso
de forma inteligente, colocando em outra posição ou aumenta a dimensão da sala»*.

A causa não era o adereço: era a **conta do lugar das secretárias**.

```
antes (main.js):  gz = (fila − 1) × 6,4 − 1        ← um número que não sabia o tamanho da sala
agora (data.js):  gz = −d/2 + 3,9 + fila × 6,4     ← as filas encostam à parede de fundo
```

Com três filas, os dois números coincidiam por sorte. Nas salas de **quatro filas** (marketing e
delivery têm sete agentes; sales e ops usam a linha 3) a última fila ia até `z = 11,8` — com a
cadeira até 13,5 — e o salão do adereço, que vive na faixa da frente, ficava **debaixo das
secretárias**: a mesa do salão entre dois postos. Vaia-se no render (`docs/salas-7agentes-antes.png`).

**A correção, em três peças:**

1. **A conta muda de sítio e de regra.** `stationSpot(dept, grid)` e `deskFront(dept)` passam a viver
   em `src/data.js`, com a grelha declarada (`SEAT_GRID`: 2 colunas de 8,6, filas de 6,4, parede de
   fundo a 3,9 da primeira fila, 2,6 de profundidade por fila, **6,0 m de faixa de entrada** que
   nenhuma fila pode comer). A cena e o `tools/room.mjs` chamam a **mesma função** — não há duas
   versões da planta do escritório.
2. **As salas de quatro filas ficam mais fundas**: sales, ops, delivery e marketing passam de
   `d = 30` para **`d = 34`**. As de três (emails, fin, d = 26) ficam como estavam. Resultado medido:
   a faixa da frente é agora de **6,7 m** (emails, fin) e **8,3 m** (as outras quatro) — antes eram
   0,6 m nas de sete.
3. **O adereço ancora-se às secretárias, não a um número**: `makeRoomDressing(..., { front })`
   recebe o `deskFront` da sala e põe o tapete 1,2 m depois da última cadeira, sempre dentro do pod.
   O mesmo `front` passa a governar a árvore, os candeeiros e o candeeiro de braço.

**Provas.** `officeProblems()` ganhou três invariantes novas (nenhuma secretária sai pela parede
lateral, nenhuma atravessa a parede de fundo, nenhuma encosta ao bordo da frente) e a invariante da
**faixa de entrada ≥ 6 m**. `test:office` passou de 49 para **51/51** com dois testes novos (a
primeira fila encosta à parede de fundo; a mesma fila recua ~4 m entre a sala de 26 e a de 34 e as
colunas continuam simétricas). `test:scene` trocou a constante `ADEREÇO_MAX = 8,4` — que era
exactamente o que **escondia** o problema — pelo `deskFront` que a cena mede, e ganhou a prova de que
o tapete fica depois das secretárias e de que sobra entrada em todas as salas. **Visto a falhar**
duas vezes: a primeira com o tapete a rasar as secretárias em `emails`/`fin`, a segunda ao empurrar
a grelha 1,1 m à frente (`wallGap` 3,9 → 5,0), que fez cair a invariante da entrada em três sítios.

Renders: `docs/salas-7agentes-antes.png` → `docs/salas-7agentes-depois.png` (a mesma sala MEDIA,
com os sete agentes). Restantes: `test:a11y` 21/21, `test:ops` 71/71, `test:google` 5/5,
`test:integracoes` 13/13, build **1 418 kB**.

## 1.10.3 — 27 out 2026 · As salas, «chique chique»

Pedido: *«quero que melhores brutalmente as salas, deixando mais bonita e elegante, chique chique»*.
O alvo são as **seis salas** — não a interface. O que estava lá era uma caixa branca com uma faixa
de vidro fina e uma laje de vidro colorido: lia-se como maquete de cartão.

O que mudou, por camadas:

- **O remate das paredes.** A parede passou a ter o que uma parede de hotel tem: **ripaado vertical**
  a cada 0,92 (sombras reais, de graça em 3D), **rodapé de latão** de 0,20 em vez da faixa alta de
  tinta, uma **cova de luz** na cor da sala (`base − 0,26`, emissiva) debaixo do remate, **montantes
  de latão** no vidro e um **remate de latão à cabeça do vidro** — a linha que faz a parede ler como
  pavilhão e não como aquário. A banda de vidro desceu de 2,6 para **1,9** (a parede total fica em
  4,7 e não em 5,4: mais íntima, e sobra mais céu na câmara).
- **O chão.** Um **vinco de sombra** a todo o perímetro da laje (`#26272B`, 0,045) separa o vidro do
  volume branco do pod, e um **filé de latão** de 0,035 corre pela aresta — o remate que faltava
  entre o chão colorido e o branco.
- **O adereço da sala** (`makeRoomDressing`): a faixa da frente das salas — a mais visível de todas
  e até agora vazia — passa a ser uma **entrada de hotel**: tapete do salão (8,0 × 3,4) de campo
  escuro com moldura de marfim e filete de latão, **soleira de latão** do lado de fora, **duas
  poltronas de marfim** com pés de latão e almofada de carvão, **mesa redonda de latão** com uma
  taça, **dois candeeiros de pé** de 1,90 nos corredores, **candeeiro de braço** de 2,46 com cúpula
  acesa sobre a mesa (é a peça que se vê por cima das secretárias), **aparadora** de latão no
  corredor esquerdo com livros e jarro, e uma **árvore** no canto que a câmara vê.
- **Sinalética.** A placa da sala deixou de ser branca sobre branco: latão `#8A6F45`, recuada, a 2,36.
- **Modo escuro.** Os part novos (`wallTrim`, `wallCap`, `wallGlass`, `wallCove`, `wallSign`,
  `floorInlay`, `dress`, `dressRug`, `dressIvory`, `dressMetal`, `dressGlow`) entram no `setDark`:
  o latão no escuro não fica cinzento, fica **latão velho**; a cova e a cúpula sobem de emissão.

**A regra de motor que isto obrigou**: a primeira versão das paredes somava ~60 malhas por sala
(uma por ripa, uma por montante). Agora as peças são **fundidas por material** — a parede são cinco
malhas (`wall`, `wallTrim`, `wallGlass`, `wallCap`, `wallCove`) e o adereço são cinco. Seis salas
custam 60 draw calls no total, não 360.

**Como foi visto sem browser.** Chromium não corre neste ambiente, por isso o julgamento foi feito
com um rasterizador próprio (`tools/raster.mjs`, agora com **alfa** — sem ele o vidro pintava a laje
de branco) e uma câmara **ortográfica igual à da app** (`tools/room.mjs`, ISO `(1,.92,1)`, FR 42).
Para os builders com textura de canvas correrem em node, `tools/domstub.mjs` dá-lhes um canvas falso.

Provas: `test:scene` ✓ com **doze asserções novas por sala** (o adereço existe nas seis, o tapete tem
a medida do salão e **não entra por baixo das secretárias**, não sai do pod, os dois candeeiros
existem, aparadora, árvore e a luz do salão por cima das mesas) — e uma delas foi **vista a falhar**
(o tapete a rasar as secretárias em `emails` e `fin`, onde a sala tem 26 de fundo em vez de 30) antes
de o cálculo da faixa da frente ser corrigido. `test:office` 49/49, `test:a11y` 21/21, `test:ops`
71/71, `test:google` 5/5, `test:integracoes` 13/13, build **1 417 kB**.

Renders do processo (raster, não browser): `/tmp/room-p4.png` … `/tmp/room-p15.png`.

## 1.10.2 — 27 out 2026 · O canto esquerdo: a licença

Pedido: *«licença ORBITA PROJECT 1.0.0 — coloca mesmo de forma bem inteligente, POR CHELTON MAHOZE
no canto esquerdo»*.

O que estava lá era uma **linha de 130 caracteres ao centro do fundo**, branca em
`mix-blend-mode: difference`, a atravessar o escritório: não se lia, e ficava por cima da cena como
uma legenda de televisão. No mesmo canto já vivia uma pastilha de assinatura, cada uma com as suas
coordenadas absolutas.

Agora o canto é **um sítio só** — `#corner`, um *flex* de duas peças — e a licença é uma **placa de
três linhas com hierarquia**:

```
licença · PolyForm Noncommercial        ← o que é (7,5 px, versaletes, cinza)
ÓRBITA PROJECT  1.0.0                   ← de quem é (serifa de marca, 15 px) + selo da versão
por CHELTON MAHOZE                      ← quem o fez (8 px, versaletes, o nome em tinta)
```

- **A frase legal inteira não se perdeu**: mudou de sítio — vive no `aria-label` (licença, versão,
  uso pessoal e interno, não para revenda, © 2026 Chelton Mahoze), onde um leitor de ecrã a lê toda.
- **Uma superfície em vez de um truque**: creme a 82% + `backdrop-filter` + fio de 1 px, como os
  outros elementos flutuantes. Sai o `mix-blend-mode: difference` (a placa lê-se igual sobre chão
  claro, escuro, e no modo escuro da interface, onde o creme já é tinta escura).
- **A assinatura** (`chelton_`, a pastilha preta que abre o repositório) passou a ser a segunda peça
  do mesmo *flex*: sem `left/bottom` próprios, alinhada pela base com a placa.
- **Sem colisões**: com a gaveta da sala aberta à esquerda, o canto inteiro passa para o lado dela
  (`body.railLeft`); no calendário e no cérebro a assinatura sai (têm cabeçalho próprio) e o rodapé
  desses painéis sobe para não ficar debaixo da placa; abaixo de 760 px o rótulo da licença recolhe.
- **A cena continua a receber o rato**: só a assinatura tem `pointer-events: auto`.

A versão `1.0.0` da placa é o rótulo do projecto (o que o dono pediu) — a versão de construção
continua a ser a do `package.json` e a que `/api/health` devolve (1.10.2).

Provas: `test:scene` ✓ com 12 asserções novas (o canto é um elemento, a placa tem três linhas, diz
«ÓRBITA PROJECT 1.0.0» e «POR CHELTON MAHOZE», o aria-label guarda a PolyForm inteira, a frase
antiga não voltou, a assinatura abre o repositório) — uma delas foi **vista a falhar** ao trocar
`1.0.0` por `9.9.9`. `test:office` 49/49, `test:a11y` 21/21, build 1 410 kB.

## 1.10.1 — 27 out 2026 · A barra do compositor de tarefas

Pedido: *«o chat deve ter um design bonito nesta área»* — apontando para a caixa de tarefas da
direita (`MEDIA · Escreve uma tarefa… · SONNET · AUTOMÁTICO · REPETIR · EQUIPA · SEM IA · ADICIONAR`).

A segunda linha eram seis pastilhas de 8,5 px, todas iguais: o modelo, o esforço, dois
interruptores, o motor e a acção. Lia-se como uma legenda e não dizia o que era o quê.

- **Dois campos com rótulo** — `Modelo` e `Esforço`, o valor em 12,5 px em vez de maiúsculas de
  8,5 px, com um caret próprio e uma marca verde no rótulo quando a escolha é tua (`.tp-fld`,
  `.tp-sel`, `:has(select.set)`).
- **Um grupo segmentado** para os interruptores (`.tp-tools`): uma moldura só, divisórias de 1 px,
  o activo em tinta, `aria-pressed` a acompanhar o `.on` (que antes só existia na cor).
- **Uma nota** que diz o que a tarefa usa por omissão, lida do servidor: `padrão: Sonnet · Automático`.
- **O ADICIONAR é a única coisa sólida** da caixa, à direita, com o `↵` ao lado.
- **O esforço em português**: `Automático · Baixo · Médio · Alto · Muito alto · Máximo` (as chaves
  `low … max` no pedido não mudaram). O tooltip já dizia «Baixo a Máximo» enquanto o menu mostrava
  `LOW … X-HIGH` — duas línguas no mesmo sítio. O mesmo se fez no conversador (`EFFORT_LABEL`).
- Os modelos deixaram de ser gritados: `Sonnet · Opus · Fable`.

Provas: `test:office` 49/49 (rótulos fixados), `test:scene` ✓ (estrutura nova no bundle: dois campos
com rótulo, três botões no grupo, opções em português, a nota com `padrão:`), build 1 407 kB.

## 1.10.0 — 27 out 2026 · As pessoas

Pedido 28: *«melhorar as interações do braço de avatar mexendo realmente o mouse e digitando nos
teclados e melhore o avatar, uma vibe mais pessoa real com roupa formal, mas cada sala mantém a
coloração da roupa ficando mais realista, cabelo diferente para cada agente (35), alguns com
chapéu, alguns serão mulheres»*.

O problema não era a animação — era a geometria. As mãos nunca tocavam em nada porque **ninguém
sabia onde estava o teclado**: o `builders.js` desenhava-o a `z=0.42`, o avatar esticava o braço
para o sítio nenhum e o ombro oscilava 6 cm para fingir trabalho. Resolveu-se com um contrato.

### O contrato: `src/deskmap.js`

Um ficheiro puro (sem `three`, sem DOM) onde vivem os números da secretária: `SEAT`, `KEYBOARD`,
`KEY_GRID` (57 teclas), `MOUSE_PAD`, `MOUSE`, `MOUSE_TRAVEL` e, por cima, funções que respondem a
perguntas: `mouseAt(t)`, `nearestKey(x, z)`, `typingHand(t)`, `clickBeat(t)`, `contact(t)`.
Quem desenha (`builders.js`), quem posa (`avatar.js`) e quem anima (`main.js`) leem daqui — se
alguém mudar o teclado de sítio, a mão vai atrás. É por isso que passou a haver um teste que
compara **a ponta do dedo com a tecla**: antes, o IK resolvia para um braço de `0.60+0.55` enquanto
a geometria media `0.54+0.50`, e a mão parava 8 cm antes do alvo.

### O que se vê agora

- **A digitar** — a mão segue uma tecla do `KEY_GRID`, a tecla **afunda** (instância própria, uma
  malha para as 57) e volta. As duas mãos escrevem; a cada ~5 s uma delas vai ao rato.
- **No rato** — o rato é uma malha própria (`mouseG`) e desliza no tapete; **vai onde a mão está**,
  não ao contrário. A palma segue-o com o pulso e o cotovelo resolvidos por IK de dois ossos.
- **A transição** — a mão não salta do teclado para o rato: atravessa a mesa em ~0.3 s e não prime
  teclas a caminho.

### As 35 pessoas

`src/looks.js` é uma tabela escrita à mão (não sorteada): 35 assinaturas distintas — 15 estilos de
cabelo × 4 variantes, 14 mulheres, 8 chapéus (fedora, boné, barrete, gorro), 11 barbas, 7 óculos.

- **Fato formal** — casaco com lapelas, camisa, gravata (ou lenço, ou blazer, ou vestido para
  algumas mulheres), sapatos, cinto, punhos. O **fato é a cor da sala** (matiz do `chip`, mais
  fundo e levemente dessaturado); a **gravata acende com o vidro**. A sala continua a ler-se pela
  cor, mas agora veste-se em vez de pintar-se.
- **Cara** — olhos, sobrolhos, nariz, lábios, brincos, óculos com aro e ponte, barbas por tipo.
- **Pescoço e ombros** — pescoço próprio, cabeça a `1.86S` e ombros a `1.42S` (estavam à altura da
  cintura, o que fazia os braços saírem do cinto). O tronco passou a afunilar (ombros > cintura) e
  acabou na anca: o casaco ia até aos tornozelos e lia-se como uma saia.

### Achado pelo caminho

`geometry.scale()` escala em torno da **origem**, não do centro: o rato estava 1 m abaixo do tapete
(desenhado, invisível). E o `GEO.box()` do `builders.js` cresce a partir da base, não do centro —
daí o tampo ter passado a estar 11 cm abaixo do teclado durante uma tarde.

### Custo

35 avatares com ~10 malhas cada (a cabeça inteira é uma malha, o tronco outra, cada mão outra), e
**uma** malha instanciada por teclado para as 57 teclas. Build: 1 403 kB.

## 1.9.9 — 27 out 2026 · O conversador

Pedido 27: *«implementa este conversador de IA, substituindo o atual»*, com um componente React
(`ai-prompt-composer-with-model-selector.tsx`) e as instruções de integração shadcn.

O que existia era um campo de uma linha e uma seta. O que o dono mandou é um compositor: modos,
modelo com provedor e esforço, anexos, contexto, voz, favoritos, aviso e tour. **Foi esse desenho
que substituiu o antigo** — e cada peça faz alguma coisa no servidor, ou está desligada a dizer
porquê.

### A decisão: portar, não colar

O projecto não tem React, Tailwind, TypeScript, `tsconfig`, `tailwind.config` nem `components.json`
— e, de propósito, o Órbita é **um ficheiro HTML** que abre offline, construído por esbuild a partir
de módulos JS. Instalar React + Tailwind para um componente punha um runtime de ~140 kB entre o dono
e uma caixa de texto e acabava com o «um ficheiro só». O desenho e o comportamento foram **portados**
para `src/composer.js` (557 linhas, zero dependências): mesmos elementos, mesmas regras, mesma calma.
O detalhe (e o que fazer se algum dia o projecto passar a React) está em **[docs/CONVERSA.md](docs/CONVERSA.md)**.

### O que o cartão tem

- **Modos** — `Planear` (o servidor desliga as ferramentas e pede um plano), `Perguntar` (a conversa
  com as notas da empresa) e `Construir` (**cria mesmo a tarefa** em `/api/tasks` com `run: true`, começa a corrê-la na fila do servidor e diz o id).
- **Modelo e esforço** — a lista vem de `/api/health` (`sonnet · opus · fable`, `low … max`), com
  separadores **Favoritos/Todos**, estrela, pílula de provedor e `Auto` (a precedência da casa).
  Escolher um modelo ou esforço envia-o naquela mensagem; o servidor devolve o que usou.
- **+ Ficheiros** — texto até 5 ficheiros, 40 000 caracteres cada, 60 000 no total, só naquela
  mensagem. Imagens e PDF dizem que não são lidos.
- **@ Contexto** — `@Cérebro` e `@Documentos` reais (com os números que o servidor declara);
  `@Terminal` **desactivado com a razão**, porque não há terminal ligado ao agente.
- **Ditar** — a `SpeechRecognition` do browser quando existe; desactivado com a razão quando não.
- **Aviso do motor** (o lugar do «Upgrade to Pro») — o Órbita não vende planos, por isso não há
  preço: no mesmo sítio aparece o estado real (motor, modelo, esforço, notas, documentos) quando
  falta motor, e desaparece quando há.
- **Tour** de quatro passos, dispensável, e **avisos** com `aria-live`.

### O que se recusou copiar

- **«Upgrade to Pro» com planos e preços** — não há faturação no Órbita; um preço inventado seria
  dado de demonstração (pedido 19). O lugar do banner ficou com o aviso do motor.
- **A lista de modelos de exemplo** (`kimi-k3`, `gpt-56-terra`, `sonnet-5`, `opus-48`…) — a lista é
  a que o servidor sabe correr. Sem motor, o botão diz «sem motor».
- **O `@terminal`** — não existe, e fingir que existe era mentir no sítio onde se pede contexto.

### O que mudou no servidor

`POST /api/chat` passou a aceitar `mode`, `model`, `effort`, `auto`, `files` e `context`, e a
responder com `mode`, `model`, `modelName`, `modelFrom`, `effort`, `effortName`, `context` e
`files`. `GET /api/health` passou a declarar o tamanho do contexto (`context.notes`, `context.docs`).
Em modo `Planear` não há rotinas nem entrevistas: o pedido só devolve um plano, sem ferramentas. `POST /api/tasks` aceita `run: true`: a tarefa nasce em `doing` e entra na fila do servidor no mesmo instante (era só `next`, à espera de um RUN à mão).

### Provas

- **`test:office` — 38/38** (eram 31). Sete testes novos: os três modos e o que cada um promete, os
  anexos (limites e recusas), o `@contexto` com o terminal desactivado, o corpo do pedido (Auto cala
  o modelo; lixo cai em `ask`; história limitada a 8), a linha do que correu, e as preferências
  guardadas (incluindo lixo no `localStorage`).
- **`test:scene` — ✓** com 24 asserções novas no bundle real: os três modos trocam com
  `aria-pressed`, o menu do modelo abre e fecha com `aria-expanded`, o seletor de ficheiros, o menu
  de contexto com a linha do terminal desactivada **e a razão escrita**, o aviso do motor visível
  quando o servidor não responde (o harness responde 503) e o `#mcModal` **fora do `#rail`** (a
  gaveta tem `overflow:hidden` e `transform`; um `fixed` lá dentro ficava cortado). *O teste tem
  dentes:* mudei o id do menu de contexto e ele caiu na hora.
- **Contra um motor de teste local** (um servidor OpenAI-compatible de 40 linhas, sem tocar no
  repositório): `mode: "plan"` chegou ao motor com a regra de planear, `tools: false` e
  `max_tokens: 900`; `files` levou o conteúdo do `brief.md`; `context: ["brain","docs"]` levou as
  notas escolhidas e `docs/CENA.md`; e `auto:false, model:"opus", effort:"max"` foi corrido com o
  modelo que o fornecedor declara para `opus`.
- `test:a11y` **21/21** · `ops` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só
  `smoke: browser`, que precisa de Chrome) · build **1380 KB** + `mesa.html` 86 KB.
- **Vi o cartão antes de o entregar:** `docs/conversor-claro.png`, `docs/conversor-escuro.png` e
  `docs/conversor-modelo.png` são capturas do CSS real, com o Chromium headless — foi assim que
  corrigi a pílula do modelo a cortar «Sonnet» em «S…» e o menu a crescer para fora do ecrã.

### Limitações, declaradas

- **O esforço só existe nos motores CLI.** Nas APIs compatíveis com OpenAI o protocolo não tem
  esse campo: vai o modelo, não vai o esforço — e o menu diz isso quando o motor é desse tipo.
- **Numa API, os três nomes da casa podem responder com o mesmo modelo**, se o fornecedor não
  declarar um por nome.
- **Anexos são texto.** PDF, DOCX e imagens não são extraídos; 60 kB é o tecto por mensagem.
- **`@Documentos` lê o título e as primeiras linhas** de cada markdown (até 6 000 caracteres).
- **Sem motor ligado, a conversa não inventa:** responde com a razão da falha. Nesta máquina não há
  `claude`, `codex` nem `gemini` no `PATH`, por isso o aviso do compositor é o estado normal aqui.
- **A cena 3D continua sem captura neste sandbox** (SwiftShader sem bibliotecas de sistema); as
  imagens do conversador são DOM puro, por isso são reais.

## 1.9.8 — 26 out 2026 · A secretária: preta, com a luz da sala

Pedido 26: *«melhorias nível Apple design 3D mais moderna e elegante, com LEDs Aukora combinando com a cor da sala, uma vibe de mesa moderna preta com LED, e acessórios gamers, muito bonito e chamativo»*.

O que havia era um tampo de madeira clara, dois armários brancos, um teclado branco e uma caneca — mobiliário de escritório de 2014. Não faltava material: faltava desenho. E faltava a coisa que faz uma mesa com LED parecer **desta sala** e não de uma loja: a cor.

### A mesa

- **Preta, e não cinzenta.** Tampo e corpo em `#1C1E23` acetinado (metalness 0.28), pernas em lâmina de grafite com sapata de metal, calha de cabos e travessa. Saiu a madeira; saíram os armários brancos.
- **Sete luzes, uma cor.** Fita LED sob a aresta da frente e nas laterais, LED nas pernas, halo atrás do monitor, **barra de luz Aukora** presa no cimo do ecrã, teclado retroiluminado, contorno do tapete do rato, anéis das colunas, **três ventoinhas da torre** e a costura da cadeira — **todas em `dept.glass`**, a mesma cor do vidro do chão. Uma sala, uma cor. É o que faz o conjunto ler como um sistema.
- **Acessórios gamers:** monitor com moldura preta, suporte e barra de luz; teclado mecânico; rato sobre tapete iluminado; duas colunas com anel de luz; auricular pendurado num suporte em arco; caneca; torre com vidro lateral e ventoinhas acesas. E, **de posto para posto, a mesa muda**: comando de jogos, telemóvel em suporte ou mini barra Aukora — três variantes decididas por semente, para a sala parecer vivida e não clonada.
- **A cadeira** acompanha: preta, em concha, com a costura do encosto e do assento na cor da sala, coluna a gás, estrela de cinco braços com rodas.

### Como o brilho é feito (e porque não há bloom)

O polimento de 1.9.1 continua **revertido**, como o dono pediu: sem PMREM, sem tone mapping, sem pós-processamento. O brilho não vem de um *bloom* — vem de **material emissivo** (o LED em si) mais **quês aditivos** (`glowDisc`: geometria com alfa por vértice e gradiente de queda, `depthWrite: false`). É o truque de sempre dos jogos, é determinístico, existe sem browser (por isso é testável) e não mexe no pipeline de render.

### Correções que isto obrigou

- **`mergeGeos` só sabia juntar cor RGB.** Os halos precisam de **alfa por vértice** (quatro componentes) e o three só o respeita assim. A função passou a juntar na largura máxima (3 ou 4) e a preencher com 1 o que falta. Sem isto, o halo ficava opaco.
- **O `dimTwin` (escurecer a sala que não está em foco) só apagava a cor.** Resultado: a sala apagava-se e o LED ficava aceso, a brilhar no escuro. Passou a **escurecer a emissão** também (para 22 %).
- **No modo escuro, uma mesa preta sobre fundo escuro desaparecia.** O corpo sobe para grafite (`#2E3138`), o mate para `#23252A` e o LED ganha 45 % de intensidade — é assim que uma secretária com luz se comporta à noite.
- **A textura da tela exigia `document`.** Em Node (testes) rebentava; agora devolve uma tela vazia e o monitor desenha-se na mesma, com um fundo escuro.

### Provas

- **`test:office` — 31/31** (eram 25). Seis testes novos sobre a secretária: a tela e a moldura que o `main.js` espera, o LED na cor da sala em três salas diferentes, o corpo preto e metálico, o halo aditivo sem escrita de profundidade, as três variantes determinísticas e o limite de malhas por posto.
- **`test:scene` — ✓ 35 postos** … e agora **posto a posto**: cada uma das 35 secretárias tem de ter a malha do LED com a cor emissiva **exacta** do vidro daquela sala, corpo escuro, halo, e a costura da cadeira na mesma cor. *O teste tem dentes:* troquei a cor por magenta à força e ele apontou as 35 (`✗ 35 falhas · elead: o LED da secretária é #ff00ff e a sala é #1FA36B`); reposto, ✓.
- **Vi a mesa antes de a entregar**, com o mesmo rasterizador da 1.9.6: foi ele que mostrou que o halo do monitor parecia uma lua, que a luz da barra caía por cima do teclado, e que a torre era um bloco preto sem forma. Três correções saíram daí; os retratos ficam em `docs/secretarias-3-variantes.png` e `docs/secretaria-detalhe.png`.
- **Custo:** cada secretária ficou em **≤ 12 malhas** (eram 8 peças soltas + 5 da cadeira antes, agora tudo fundido por material: corpo, aresta, mate, metal, LED, acento, vidro, halo, tela, moldura, teclado, tapete). Mais detalhe, menos draw calls.
- `test:a11y` **21/21** · `ops.test` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só `smoke: browser`) · build **1341 KB** + `mesa.html` 86 KB.

### Limitações, declaradas

- **A tela do monitor aparece preta nos retratos.** É fiel ao que o meu rasterizador sabe desenhar: o conteúdo do ecrã é uma textura em canvas, desenhada no browser em tempo real pelo painel AO VIVO. Na cena servida, o ecrã tem conteúdo.
- **A cena 3D continua sem captura neste sandbox** (o WebGL não arranca: faltam bibliotecas de sistema ao Chromium). Os retratos são de luz de estudo e provam a forma e a cor — não julgam a luz final da cena. Essa parte é o olho do dono.

## 1.9.7 — 26 out 2026 · «ÓRBITA AGENTES», e a conversa

Pedido 25: *«remove o BETA e coloca ÓRBITA AGENTES; o lugar onde se escrevem as mensagens deve ficar ainda mais elegante, inspira-te no ChatGPT, com mais vibe Apple design»*.

### A marca

- **Saiu o «BETA», entrou «ÓRBITA AGENTES».** A etiqueta da barra lia-se «V1» e, quando o escritório ficava ao vivo, o JavaScript **reescrevia-a para «BETA»** — o produto mudava de nome conforme o servidor acordasse. Agora é «ÓRBITA AGENTES», uma palavra só, e **fica quieta**: a linha que a trocava passou a mudar apenas o título da página.
- **O título também.** `Órbita — escritório de agentes` → **`Órbita Agentes — escritório de agentes`**.

### A conversa (o sítio onde se escrevem as mensagens)

Referência declarada: o ChatGPT. O que se copia é a **calma**; o que é nosso é a tipografia SF, o vidro e as cores da casa.

- **O compositor deixou de ser uma caixa de uma linha.** Era um `<input>` com um botão «ENVIAR» ao lado — a versão mais barata possível de uma conversa. Agora é um **campo que cresce com o texto** (até 132 px, depois rola), com a seta de enviar num círculo escuro do lado direito e a **tecla Enter a enviar** (Shift + Enter muda de linha, como no ChatGPT). Com o campo vazio a seta está apagada e não responde: o botão diz a verdade sobre o que pode fazer.
- **As sugestões subiram para cima do compositor** e passaram a pílulas de vidro em SF — antes eram sete botões de contorno que pareciam formulário.
- **Uma linha de ajuda discreta** por baixo (`Enter envia · Shift + Enter nova linha`). Quem não sabe, aprende; quem sabe, não repara.
- **As mensagens.** A resposta do agente é um cartão claro com um canto mais apertado do lado de quem fala; a fala do dono passou de **bloco preto** a **cinza baço** (numa coluna de 400 px, três blocos pretos seguidos pesam mais do que informam) — o escuro fica para o modo escuro. Entram uma animação de 0,3 s na chegada de cada mensagem, um desvanecimento no topo da lista (o texto desaparece, não é cortado a direito) e uma barra de deslocamento fina.
- **Os indicadores de trabalho** («Helena Prado está a pensar») deixaram de ser monospace cinzento e passaram a uma linha pequena com um ponto a pulsar.
- **Os separadores «AO VIVO / CONVERSA»** passam a **«Ao vivo / Conversa»** num *segmented control* (a mesma leitura do menu da 1.9.3). Isto apanhou uma incoerência minha: na 1.9.5 escrevi nos testes «o texto é PT-PT e conta o que está lá» e deixei dois rótulos em maiúsculas de 10 px com `letter-spacing: .14em` — exactamente o que a 1.9.3 tinha vindo corrigir no menu.
- **A saudação de abertura** já não diz «pede trabalho na barra à direita» (uma barra que já não existe há versões) — diz o que se faz: escrever aqui em baixo.
- **Acessibilidade a acompanhar:** o campo tem `<label>` próprio (`.sr-only`), a seta tem `aria-label` e `title`, e o `textarea` continua a travar os atalhos da cena enquanto se escreve.

### Provas — e, desta vez, olhos

- **Vi o resultado.** Até aqui todas as entregas diziam «não há Chrome nesta máquina». Hoje há: instalei um Chromium headless (`@sparticuz/chromium`, sem tocar no `package.json`) e o `playwright-core` que já estava no projecto, e **abri a página a 1× e 2×**. O WebGL não corre neste sandbox (SwiftShader sem bibliotecas de sistema), por isso a captura da cena falha — mas a **conversa é DOM puro** e pôde ser fotografada com o CSS real: `docs/conversa-clara.png` e `docs/conversa-escura.png`.
- **O que as capturas mostraram** (e que os testes não mostrariam): o campo crescia mas o botão ficava colado ao fundo; o separador antigo cortava a lista com uma linha; e, à segunda volta, a linha de ajuda caía por baixo da marca do canto. Dois dos três foram corrigidos por olho.
- **`test:scene` — ✓ 35 postos** … e agora com **a marca e o compositor**: exige que a barra leia «ÓRBITA AGENTES» (e falha se voltar a dizer «BETA»), que o campo seja `<textarea>`, que a seta comece apagada e acorde ao escrever, que Enter seja tratado pelo compositor e que **Shift + Enter não** seja apanhado.
- `test:office` **25/25** · `test:a11y` **21/21** · `ops.test` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só `smoke: browser`) · build **1333 KB** + `mesa.html` 86 KB.

### Limitações, declaradas

- **A cena 3D continua sem captura**: neste sandbox o WebGL não arranca (falta o conjunto de bibliotecas de sistema do Chromium; só consegui as do NSS). O que ficou provado com olhos é a interface em HTML — a conversa, a barra, os separadores. A cena continua a ser provada pelos testes.
- **As capturas são de uma folha de contacto** (o `shell.html` real com uma conversa de exemplo e sem a cena por trás), não do escritório ao vivo: o objectivo era julgar o desenho da conversa, e a cena não muda nada nele.

## 1.9.6 — 26 out 2026 · As plantas: forma em vez de esferas

Pedido 24: *«dá melhorias nível Apple design 3D nas plantas, dando total realismo nelas»*.

O que havia era um vaso de tronco-de-cone com **cinco esferas verdes** — e era a peça que mais denunciava a cena, ao lado de pessoas com pescoço e ombros. Não faltava material: faltava forma. Uma esfera iluminada por muito boa luz continua a ser uma esfera.

### A folha

- **Uma superfície, não um sólido.** `leafGeometry()` gera uma grelha paramétrica: estreita na base, larga a um terço, em bico no fim. **Dobrada ao meio** — o nervo central é uma aresta, não uma linha pintada — com o bordo ondulado e uma **queda que cresce com o quadrado do comprimento**: é assim que uma folha real pendura quando o pecíolo a larga.
- **A cor varia onde a luz varia.** Cada vértice leva a sua cor: escura na base e na nervura, clara a meio do limbo, e cada folha com o seu desvio de matiz (`warm`). O material é `vertexColors`, com uma textura de nervuras muito discreta por cima. Uma folha pintada de uma cor só parece plástico, mesmo com a melhor luz do mundo.
- **O pecíolo é um tubo.** `stemGeometry()` segue uma Catmull-Rom — sai do tronco, arqueia, entrega a folha — e afina da base para a ponta. O caule principal é o mesmo tubo, inclinado: nada na natureza é vertical.

### A planta

- **Filotaxia, não simetria.** As folhas nascem em espiral de **ângulo dourado (137,5°)**, em três andares, com alturas e comprimentos que variam (< 0,86 de expoente: mais folhas em baixo, como numa planta que cresceu) e um rolamento próprio. As velhas **pendem** (`pitchOld`), as novas **abrem** (`pitchNew`) — é o que dá silhueta em vez de volume.
- **Duas espécies.** `upright` (figueira/oliveira): tronco alto e limpo, 24 folhas pequenas, ≈ 2,5 de altura — para as salas onde há pouco espaço. `broad` (monstera/filodendron): sem tronco à vista, 15 folhas grandes em pecíolos que arqueiam, ≈ 2,1 — para as salas largas e para o centro, que passa a ser a peça de apresentação.
- **O vaso é cerâmica torneada.** `LatheGeometry` com pé, pança e **lábio virado para dentro**; terra escura abaixo do lábio e umas pedras. E, o que faltava: uma **sombra de contacto** (disco com gradiente, `depthWrite: false`, a 0,010 do chão). Sem ela, o objeto flutua por muito bom que seja o resto.
- **Tudo determinístico.** `seededRandom()` (mulberry32) por planta: a mesma semente dá sempre a mesma planta. A cena deixou de mudar a cada recarregamento — e passou a poder ser testada.
- **O lugar é medido, não escolhido a olho.** Mede-se o raio da folhagem (`Box3`), afasta-se o vaso do canto o suficiente para **nenhuma folha atravessar a parede de vidro** (folga 0,45) e mede-se a distância à cadeira mais próxima. Antes eram cinco vasos encostados ao canto «mais ou menos».
- **Duas plantas a mais.** A DESIGN LAB não tinha nenhuma; o centro passou a ter a peça de apresentação. São **sete**.

### O que não mudou

- **Nada do resto da cena.** Nem chão, nem paredes, nem secretárias, nem pessoas, nem câmara. O chão de vidro, as 35 secretárias e o espelho acessível da 1.9.5 continuam a passar os seus testes sem uma linha alterada.
- **O polimento de 1.9.1 continua revertido**, como o dono pediu: **sem** environment map, **sem** tone mapping, **sem** vernizes novos. O realismo vem de geometria e de cor — os materiais são `MeshStandardMaterial` simples e o brilho das folhas é o especular largo da luz-chave que já existia. Um realismo que dependesse de um PMREM seria o mesmo truque que foi rejeitado.
- **Custo controlado:** 5–6 malhas por planta (folhagem, caules, vaso, terra, pedras, sombra), com as folhas e os caules *merged* por geometria. Sete plantas ≈ 110 k triângulos e ~35 draw calls — não 40 por planta.

### Provas

- **`test:office` — 25/25** (eram 17): oito testes novos sobre a forma. A folha estreita na base, engorda a um terço e acaba em bico; dobra ao meio e a ponta cai; a cor varia dentro da folha (base escura, limbo claro, nervura mais escura que o limbo); o pecíolo afina; a planta monta-se em poucas malhas com cor por vértice e duas faces; as duas espécies são diferentes e cada uma tem altura e largura razoáveis; e a mesma semente dá a mesma planta.
- **`test:scene` — ✓ 35 postos, chão de vidro em 7 pods, 7 plantas (3 verticais · 4 de folha larga, 2,1–2,6 de altura)**. O teste novo exige `inside: true` em cada sala: o raio da folhagem somado ao afastamento do canto tem de caber no pod.
- **O teste tem dentes.** Repus as plantas no canto à força (`dx = dz = 9.5`) e voltei a correr: `✗ · delivery: a folhagem sai do pod (raio 1,7) · sales · marketing · fin · ops`. Depois reposto: ✓.
- **Vi a planta antes de a entregar.** Sem Chrome nesta máquina, escrevi um rasterizador mínimo (ortográfico, Lambert, z-buffer, sRGB) para olhar para as duas espécies em `node`. Foi ele que mostrou dois erros que os testes não apanhavam: folhas demasiado horizontais (a planta lia-se como um prato) e o vaso de Ø 1,10 para folhas de 0,6 — um vaso de árvore com uma planta de sala dentro. Ambos corrigidos; os retratos ficam em `docs/planta-vertical.png` e `docs/planta-folha-larga.png`.
- `ops.test` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só `smoke: browser`, sem navegador) · build **1327 KB** + `mesa.html` 86 KB.

### Limitações, declaradas

- **Continuo sem ver a cena com a luz real.** Os retratos são de um rasterizador meu, com luz de estudo: provam a **forma**, não julgam a luz, as sombras ou o tom final. O olho do dono, na cena servida, é a última prova.
- **As folhas são planas** (uma superfície de duas faces). De perto e de lado vê-se a ausência de espessura. Fechar as folhas em sólidos custaria três a quatro vezes mais triângulos por uma diferença que se nota a 30 cm de um ecrã — não vale a pena nesta escala, e fica escrito.

## 1.9.5 — 26 out 2026 · O escritório, para quem não usa rato

Pedido 23: *«O escritório é rato-apenas — 18 handlers de clique em `div`/sprite; o `<canvas>` não tem `role`/`aria-label`; nem os 7 cartões de sala nem as 35 pastilhas entram no Tab. Um espelho acessível (as salas e os agentes navegáveis por teclado, com `Enter`) resolve sem tocar no 3D.»*

**O diagnóstico, antes de mexer.** Uma passagem de leitura pelo `main.js` e pelo `shell.html` contou o que havia: **18** `addEventListener('click')` em `div`, `canvas` e sprites; **zero** `role` e **zero** `tabIndex` criados pelo escritório (os únicos do ficheiro eram os três botões do zoom e os formulários das gavetas); um `<canvas id="scene">` **sem nome** — para um leitor de ecrã, uma caixa vazia; e a página declarada em `lang="en"` com o produto todo em português. Um utilizador de teclado podia abrir as gavetas do menu e escrever uma tarefa, mas **não conseguia entrar numa sala nem abrir um agente**.

### O espelho: `src/a11y.js` (novo, puro)

- **A mesma coisa, por palavras.** Uma lista em HTML com as **7 superfícies** (as 6 salas e o centro) e os **35 agentes**, cada um um **`<button type="button">` a sério** — não um `div` com `role="button"`. É a diferença entre imitar um botão e ser um: o `Enter`, o `Espaço`, o `Tab` e o anúncio do leitor de ecrã vêm da semântica do browser, não de código nosso que se pode esquecer.
- **Um diálogo a sério.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby` a apontar para o título e para o subtítulo («7 salas · 35 agentes · a mesma informação da cena, para teclado e leitores de ecrã»), ciclo de foco próprio (`Tab` no último volta ao primeiro, `Shift+Tab` no primeiro vai ao último), `Esc` fecha, e o foco **volta a quem abriu**.
- **As mesmas acções, uma só implementação.** `onRoom(k)` chama `zoomToDept(k)` (ou `brain.open()` no centro) e `onAgent(id)` chama o mesmo `openAgent(...)` do clique na pessoa — incluindo o desvio para a conversa quando o agente está preso numa aprovação. O espelho **não duplica lógica**: recebe as duas funções por parâmetro. É por isso que ele não sabe nada do escritório — nem importa o `three`.
- **`close(false)`.** Quando a acção escolhida abre o rail, quem fecha a lista **não** devolve o foco: quem trata da acção manda (o rail recebe-o no sítio certo). O foco é um só, e não salta duas vezes.

### O Tab na cena (sem tocar no 3D)

- **Os 7 cartões de sala** (`div` que já respondiam ao clique) passam a `role="button"`, `tabIndex = 0`, com `aria-label` escrito por palavras — *«Abrir a sala Comando — 5 agentes, 2 a trabalhar, 1 à espera de aprovação»* — e `Enter`/`Espaço` a chamar o `.click()` que já existia, em vez de um segundo caminho.
- **As 35 pastilhas dos agentes** são botões, mas **com uma regra**: só as da **sala em foco** ficam com `tabIndex = 0`. Sem essa regra, atravessar a cena eram **35 paragens de `Tab`** a passar por nomes que se sobrepõem no ecrã — a acessibilidade a atrapalhar quem a usa. A regra vive no `tickLOD`, que já sabe qual é a sala em foco; escreve `tabIndex` só quando muda.
- **O rótulo acompanha os números.** `updateBillboards` passou a refrescar o `aria-label` dos cartões (via `syncBadgeLabels`), para não haver um cartão a dizer «2 à espera» e um leitor de ecrã a anunciar «0». O que se ouve é o que se vê.
- **O botão de aprovação deixou de ser uma `div`.** Nos dois sítios onde existe (o cartão da sala e o cabeçalho do rail) é agora `<button type="button">` com `aria-label`: recebe foco, aceita `Enter`, e deixa de ser um clique que só existe para o rato. (Precisou de três linhas de CSS para lhe devolver o que a `div` tinha de graça: fonte herdada, largura e cursor.)
- **O estado falado é o estado real.** `agentStateOf(id)` traduz o que já vem da base de dados — `a trabalhar`, `na fila`, `à espera do teu OK`, `última tarefa concluída`, `a última tarefa falhou`, `última tarefa cancelada`, `sem tarefa registada`. **Sem ligação ao vivo**, não se afirma o presente: diz «último estado conhecido — sem ligação ao vivo». Nada disto é inventado nem decorativo; é a mesma fonte de que vivem o monitor e o chip.

### Por onde se entra

- **A tecla `L`** abre e fecha a lista (a seguir à guarda do calendário: com o calendário aberto, as teclas são dele).
- **Um botão visível ao lado do zoom** (`#zIndex`, um ícone de linhas) abre o mesmo — porque um atalho que ninguém sabe que existe não é uma porta.
- **Uma ligação «Saltar para a lista do escritório»** (`#skipIndex`) é a **primeira paragem do `Tab`**: está fora do ecrã até receber foco e aí desce como um botão escuro. Quem navega por teclado não tem de atravessar a barra toda para chegar ao conteúdo.

### O canvas fala

- `role="img"`, `aria-label` («Escritório isométrico com seis salas em volta de um cérebro central e trinta e cinco agentes») e `aria-describedby` a apontar para uma descrição longa (`#sceneHelp`, `.sr-only`) que explica o que ali está **e** como chegar ao resto. Uma imagem sem nome é, para um leitor de ecrã, uma caixa vazia — e esta é a imagem principal do produto.
- `lang="en"` → **`lang="pt"`**. Um leitor de ecrã com a voz inglesa a ler «Operação» não está a ler português.

### O que **não** mudou

**Nada do 3D.** Nem geometria, nem materiais, nem câmara, nem LOD, nem cores. O `a11y.js` não importa o `three`, não conhece `scene`, `camera` nem `renderer`, e o teste exige que continue assim (procura `three`/`Geometry`/`Material` no ficheiro e falha se aparecer). As alterações no `main.js` são de DOM: atributos, `tabIndex`, `aria-label` e dois `keydown`. O `test:scene` continua a provar os **35 postos** e as **quatro camadas do chão de vidro em 7 pods** — se o espelho tivesse mexido na cena, esse teste caía.

### Provas

- **`npm run test:a11y` — 21/21 (novo).** Executa o módulo em `jsdom`: 7 salas, 35 `<button>`, ordem de tabulação (fechar → salas → agentes, agrupados por sala), abrir/fechar/Esc, devolução do foco, `close(false)` a não roubar o foco, ciclo de `Tab` e `Shift+Tab`, teclas presas dentro do diálogo, `onRoom`/`onAgent` a receberem a chave certa, `refresh()` a reler o estado, texto em PT-PT, e um nome com `<img onerror>` a aparecer **como texto**. Um segundo bloco lê `main.js`/`shell.html` e verifica os invariantes que precisam da cena para correr.
- **`npm run test:scene` — ✓ 35 postos** … e agora **no bundle real**: a lista está montada com **7 salas + 35 agentes**, a tecla `L` abre, o foco entra, o `Esc` fecha, o botão do zoom abre. Não é o módulo em isolamento: é a página construída.
- **`test:office` 17/17** · **`ops.test` 71/71** · **`integrations` 18/18** · **`check.mjs` 94/95** (só `smoke: browser`) · build **1315 KB** + `mesa.html` 86 KB.
- **O CSS novo foi lido de volta**: 1050 regras de topo, e as regras `.oi-*`, `.sr-only` e `.skip-link` presentes no fim da folha (um erro de sintaxe a meio teria cortado tudo o que vem depois).

### Limitações, declaradas

- **Não há Chrome nesta máquina**, logo não há captura de ecrã, e `smoke: browser` continua vermelho por falta de navegador — como antes, não é uma regressão.
- **Não testei com um leitor de ecrã a sério** (VoiceOver, NVDA, Orca). O que está provado é a semântica (papéis, nomes, ordem), o ciclo de foco e a ausência de armadilhas — em `jsdom`, não em hardware de leitura. Se algo for anunciado de forma estranha, é uma correcção de texto em `a11y.js`, não de arquitectura.
- **O `Tab` na cena é deliberadamente curto**: 7 cartões + as pastilhas da sala em foco. Quem quer os 35 chega lá pela lista, que é o caminho pensado para isso.

## 1.9.4 — 26 out 2026 · O chão é vidro, e o vidro tem a cor da sala

Pedido 22: *«coloca uma chão da cor dos vidros (vermelho, verde, azul, roxo, amarelo e azul céu), e faça melhorias na estrutura»*.

### O chão

- **As seis cores, uma por sala.** O chão deixou de ser uma laje pastel opaca e passou a ser **vidro colorido** — e a cor é a que foi pedida, repartida uma por sala, sempre na família da cor de marca dessa sala (o `chip` continua pastel nos cartões e nas secretárias; o `glass` é a mesma cor, saturada):

  | Sala | Cor pedida | Vidro |
  |---|---|---|
  | PROSPEÇÃO | amarelo | `#E3B93A` |
  | COMANDO | verde | `#1FA36B` |
  | ENGENHARIA | azul céu | `#41AEE4` |
  | MEDIA | vermelho | `#DC5348` |
  | VENDAS | roxo | `#8B5AD6` |
  | DESIGN LAB | azul | `#4A6DE0` |

  O **Cérebro** fica com vidro fosco (neutro, `#AEB6AB`) **de propósito**: é o centro, e o centro não compete com as seis salas que o rodeiam.
- **Quatro camadas, como um painel de vidro laminado visto de cima.** `floorBase` (o tom fundo, opaco, 0.10 — é o que dá profundidade ao vidro, o que garante a cor num ecrã sem transparência, e o que **recebe as sombras**: as sombras das secretárias vêem-se *através* do vidro, e é isso que o faz parecer vidro); `floorEdge` (a aresta polida, mais clara, 0.115 — o vidro real apanha a luz na espessura); `floorGlass` (a laje translúcida, opacidade 0.62, verniz `clearcoat: 1`, 0.12 — o nível exacto do chão, onde as secretárias pousam); `floorPool` (a poça de luz do candeeiro, branca e suave, por cima).
- **A cor chega mais longe do que o chão.** A banda de vidro das paredes passa a usar a **mesma família** (antes usava o pastel do cartão e dizia outra coisa); o cartão que nomeia a sala leva um **filete** com a cor do vidro no cimo; e a pastilha do nome de cada agente leva um **ponto** com a cor da sala. Uma cor, três sítios.
- **Modo escuro a acompanhar.** O vidro escuro não é cinzento: fica mais fundo e mais rico (a base entra 62 % na tinta, a aresta 50 %, a laje 42 %) e a poça de luz fica, mais discreta. Uma tabela (`FLOOR_DARK`) diz quanto entra em cada camada — antes havia um `if` por peça.

### A estrutura

- **`src/palette.js` (novo, puro).** Uma só fonte de verdade para a cor: `parseHex`/`toHex`, `mix`, `shade`, `tint`, `hsl`, `familyOf` (nomeia a família de matiz) e `glassLayers` (de uma cor saem as quatro camadas). Sem `three`, sem DOM — por isso corre em `node --test` e no servidor, e é o que permite provar as cores **sem olhos**.
- **Os builders recebem cores, nunca salas.** `makePlinth(w, d, glassColor)` não sabe o que é a PROSPEÇÃO. Quem sabe é o `main.js`; quem deriva os tons é a paleta.
- **Fim dos índices mágicos.** O `main.js` fazia `plinth.children[0].userData.part = 'plinth'; plinth.children[1]… = 'floor'` — a primeira camada nova partia o modo escuro em silêncio. As peças passam a dizer o que são (`userData.part`, `userData.tint`) e a sair do builder com nome: `plinth.userData.parts`.
- **O escritório valida-se no arranque.** `officeProblems()` (em `data.js`, puro) verifica salas ↔ pods ↔ agentes, cores, ids, chefes de sala e duas pessoas na mesma secretária; o `main.js` escreve o resultado na consola em vez de descobrir o erro a meio de um desenho. `assertOffice()` lança com o problema escrito, e o teste exige a lista vazia. É a lição de 1.9.2 transformada em código.
- **Sete imports mortos saíram do `main.js`** (`TOKENS`, `PLINTH_H`, `mat`, `rbox`, `makeFloorTitle`, `makeServerRack`, `makeMeetingTable`) — o tipo de sobra que faz alguém procurar um título de chão que já não existe. O catálogo `builders.js` fica com as peças que a cena não usa, **declarado** em `docs/CENA.md`.
- **`docs/CENA.md` (novo).** O contrato da cena: que ficheiro sabe o quê, as etiquetas `userData`, as quatro camadas e porquê, o mapa das seis cores, como mudar uma cor, e o que cada teste prova.
- **Um bug apanhado a tempo.** A poça de luz nasceu como caixa arredondada; o `ExtrudeGeometry` mapeia as UVs das tampas em unidades de mundo, e o gradiente saía clampado (a poça desaparecia). Passou a plano com UV 0..1, e o desvanecimento esconde a aresta recta. O teste de cena passa a verificar a **altura real** de cada camada (0.10 · 0.115 · 0.12 · acima) para isto não voltar a passar despercebido.
- O cabeçalho do `brain.js` foi corrigido: ainda descrevia o grafo gravado no chão, que já não existe (o centro é um orbe de vidro desde 25 out).

### Provas

- **`npm run test:office` — 17/17** (novo). Matemática de cor, famílias sem sobreposição, derivação das camadas, e as invariantes dos dados. Inclui um teste que **estraga os dados de propósito** e exige que a validação aponte a sala e o campo.
- **`npm run test:scene` — ✓ 35 postos**, e agora: 7 pods com chão, 4 camadas cada, laje translúcida, **cada uma das seis famílias presente exactamente uma vez**, o centro em vidro fosco, e as alturas das camadas certas. Saída: `chão de vidro em 7 pods (emails verde · delivery azul céu · sales amarelo · marketing vermelho · fin azul · ops roxo)`.
- **O teste tem dentes.** Troquei o amarelo pelo vermelho e voltei a correr: `✗ 3 falhas — os dados não validam: duas salas com a mesma cor de vidro · marketing repete a cor de sales · falta a cor pedida: amarelo`. Depois reposto: ✓.
- `ops.test` **71/71** · `integrations.test` **13/13** · `check.mjs` **94/95** (só `smoke: browser`) · build **1299 KB** + `mesa.html` 86 KB.
- **O que não está provado:** não há Chrome nesta máquina, logo **não há captura de ecrã**. Os números provam camadas, cores e alturas; o gosto do tom final é o olho do dono. Se o vidro parecer escuro ou lavado, afina-se uma linha em `data.js` (a cor) ou uma constante em `builders.js` (opacidade 0.62).

## 1.9.3 — 26 out 2026 · O menu, em vidro

Pedido 21 — *«melhore brutalmente o menu, um design mais vibe apple design»*. É trabalho de forma, não de função: **nenhum `id`, nenhum handler e nenhum comportamento mudou**. O que mudou foi o material, a escala, a hierarquia e o movimento.

- **Uma barra que flutua, em vidro.** A topbar deixa de ser uma faixa opaca de 52 px encostada ao topo. Passa a ser um painel de 54 px a flutuar 8 px do ecrã, com canto contínuo de 17 px, `backdrop-filter: blur(30px) saturate(180%)` (com o prefixo `-webkit-`), um realce especular no topo (o gradiente que dá a impressão de vidro) e três sombras em camadas: um traço interior claro, um traço interior escuro em baixo, e uma sombra larga e difusa. A cena 3D passa a ver-se **através** do menu, que era o ponto.
- **O menu é uma bandeja só.** Os cinco controlos (`#topToday`, `#topOps`, `#topMesa`, `#topLeads`, `#topCal`) vivem agora dentro de um grupo com fundo próprio e 3 px de almofada — a leitura de «segmented control» do macOS. Dentro dele: 34 px de altura, canto de 10 px, fundo transparente, hover que acende, `:active` que encolhe 2,5%.
- **Hierarquia, finalmente.** **HOJE** é a única acção cheia (pill escura em modo claro, clara em modo escuro): é a que pede uma decisão. As outras quatro são vidro que ganha tinta azul quando estão abertas (`.on`, `body.calOpen`) — a cor de selecção do sistema. O contador de aprovações passou de alarme laranja pulsante a selo âmbar discreto (pulso a 2,6 s, com o mesmo handler).
- **Tipografia calibrada.** Sai a etiqueta de 9 px em maiúsculas com `letter-spacing: .16em` (que é o oposto do que a Apple faz). Entra uma pilha SF (`-apple-system`, `BlinkMacSystemFont`, SF Pro, Helvetica Neue), 12,5 px, peso 550, tracking quase nulo; os rótulos passam a caixa de frase — **Hoje, Operação, Mesa, Leads, Calendário**. O relógio deixa de ser serifa de 20 px e passa a números tabulares de 12,5 px com um traço a separá-lo do menu. Os ícones (`◉ ▤ ◈ ◷ ⚠`) foram substituídos por **SVG desenhados à mão** (15 px, traço 1,4), porque glifos de fonte de símbolos falham em metade das máquinas.
- **O contador do HOJE via-se mal — e agora vê-se.** `#topToday .td-badge` tinha `display: none` sem excepção: o JavaScript escrevia o número e o número nunca aparecia. Agora `:not([hidden])` mostra-o como selo vermelho de notificação (mínimo 17 px, tabular). Isto já não é decoração: é a informação que estava a ser perdida.
- **As gavetas que pendem do menu** (`#leadsPanel`, `#opsPanel`) recebem o mesmo vidro, mais espesso (`.88` de opacidade) porque têm texto para ler, canto de 20 px, o mesmo desfoque e uma entrada curta de 6 px. Os cabeçalhos perdem a linha preta e ganham o traço fino do resto do produto.
- **O mesmo vocabulário por dentro.** Os separadores das gavetas (`.ld-seg`, `.op-tabs`) deixam de ser pílulas de 8,5 px em maiúsculas e passam a segmentos de 11,5 px com a tinta azul da selecção; os botões do cabeçalho (`.ld-h`, `.op-h`) ficam pílulas de 10 px com o ✕ num círculo de 24 px; **Procurar** passa a ser o botão cheio da gaveta dos leads. As etiquetas passam a caixa de frase nos sítios onde são nossas (`Empresas`, `Web`, `Leads`, `Mensagens`, `Autonomia`, `Saldo`, `Fila e rasto`, `Atualizar`, `Procurar`) — só texto, porque os handlers usam `data-k`, nunca o rótulo. O conteúdo das listas fica como está: ali a densidade vale mais do que o ar.
- **Acessibilidade e teclado.** Cada controlo tem `aria-label` (a etiqueta pode desaparecer em ecrã estreito; a acção não), o grupo tem `role="group"`, o contador tem `role="status"`, e `:focus-visible` passa a dar um anel azul do sistema em vez do nada que havia.
- **Responsivo por subtracção, não por corte.** ≤1140 px caem as etiquetas de versão e das tiras de motores; ≤1020 px cai a tira de modelos; ≤900 px os botões ficam só com ícone (excepto o HOJE, que nunca perde o nome) e cai a tira de conectores; ≤620 px a barra aperta. Em todos os passos as cinco acções continuam presentes.
- **Movimento discreto e desligável.** Entrada da barra em 0,5 s, gavetas em 0,32 s, hover em 0,2 s — tudo com `prefers-reduced-motion: reduce` a devolver o menu estático (a animação do selo âmbar incluída).
- **Acessório obrigatório: o que vive debaixo da barra desceu 10 px.** `#rail` (62 px), `#overviewBtn` (74), `#board.company` (72), `#board.left/.right` (118) e a marca no canto (76). Sem isto, o vidro flutuante tapava o cimo das gavetas.
- **O que não foi provado.** Não há Chrome nesta máquina, por isso **não há captura de ecrã**: `smoke: browser` continua vermelho por falta de navegador (94/95 no `check.mjs`, como antes). O que está provado é o que se pode provar sem olhos: `test:scene` **✓ 35 postos, sem erros no bundle** (contra o `dist/` construído **e** contra a página servida em `:4550`), `ops.test` **71/71**, e um teste de estrutura novo que confirma os 11 ids do menu, os 5 controlos no grupo, um único `<span>` no `#topAppr` (o JavaScript escreve lá o número) e o `.td-badge` do HOJE. O CSS novo foi validado com `css-tree` (59 regras, 0 erros de sintaxe) — a prova final é o olho do dono.
- **Provas.** build **1289 KB** + `mesa.html` 86 KB · `ops.test` **71/71** · `check.mjs` **94/95** (só `smoke: browser`) · `test:scene` ✓ · `/` a servir **1 320 403 bytes** na porta **4550**.

## 1.9.2 — 26 out 2026 · A cena voltou

- **O que se via.** O escritório aparecia **em branco**: sem salas, sem pessoas, nem a plataforma. O HTML da barra e dos painéis estava lá; o 3D é que nunca era desenhado.
- **Causa.** A limpeza da demonstração (1.9.1) apagou funções que continuavam a ser chamadas — `spawnEmote`, `getEmoteTex`, `emotes`, `tickEmotes`, `walkStep` e `applyStandAndFacing` em `main.js`, e a chamada a `addTask` em `tasks.js`. A primeira `ReferenceError` acontecia ao montar o contexto de `initTasks`, **antes** de `resize()` e do ciclo de desenho: tudo o que vinha depois nunca corria, e o canvas ficava vazio. `node --check` e `npm run build` passam sempre nestes casos — só um teste que **executa** a página apanha isto.
- **Correcção.** As funções voltam (mesma geometria de antes: bolha de emoji por cima do posto, passos, postura). O caminho das rotinas em modo ficheiro deixou de fabricar uma tarefa: diz que sem servidor não há trabalho. `window.CC` já não expõe um `addTask` que não existe.
- **Segunda armadilha, também fechada.** `initMcp` rebentava com `LOGOS[k].img` quando não havia conectores (`/api/mcp` a falhar) e deixava uma promessa rejeitada sem tratamento. Agora o azulejo do motor só é desenhado se houver logotipo, e `loadConnectors()` tem `.catch` — os conectores falham em silêncio visível, a cena não.
- **Teste novo: `npm run test:scene`.** Carrega o bundle construído num DOM (jsdom) com um contexto WebGL falso, espera 3 s e verifica: **nenhum erro no bundle**, nenhuma promessa rejeitada, `window.CC` existe (o módulo chegou ao fim) e há **35 postos** com secretária e pessoa. Contra o bundle que esteve no ar, o teste diz exactamente o que se via: *«esperava 35 postos na cena, encontrei 0»*. Custa ~4 s e não precisa de Chrome.
- **Provas.** `test:scene` **✓ 35 postos** · `ops.test` **71/71** · `check.mjs` **94/95** (só `smoke: browser`) · build **1276 KB** + `mesa.html` 86 KB.

## 1.9.1 — 26 out 2026 · O escritório deixa de fingir trabalho

Pedido 19, frente (a). Sai tudo o que inventava estado; o que não existe é dito por palavras.

- **Nada muda de estado sem trabalho real.** O painel de tarefas passa a ter uma só fonte — `GET /api/ops/tarefas` (a cada 4 s, assinatura `id:estado:tentativas`) — e desenha o que a base de dados tem: `running→a fazer`, `awaiting_approval→à espera`, `queued→a seguir`, o resto concluído ou falhado, com o erro escrito. Saíram as filas sorteadas, as 35 tarefas semeadas ao abrir, as 40 conclusões por dia, as aprovações de rotina e as cadeias de passagem de testemunho.
- **Sem trabalho na base de dados, o escritório di-lo.** O `tick` já não avança progresso sozinho; as percentagens saíram dos cartões (fica o estado e a duração). Sem servidor, o chat e o formulário dizem que a tarefa não existe em vez de a inventarem.
- **A demonstração saiu do código.** `src/hero.js` apagado (agentes a engolir ecrãs, «We're next», ecrãs de LinkedIn pintados) com o mapa `MCP_BY_DEPT` que só ele usava; `src/v1data.js`, `src/profile.js` e `src/screens.js` apagados (empresas, personas e métricas fictícias); as 35 identidades vivem em `src/agentes.js`. Em `src/mcp.js` acabaram o vaivém de pacotes por `Math.random`, os pulsos de modelo sorteados, o «flourish» de arranque e o par Claude+ChatGPT a pulsar sozinho — um feixe só existe quando um agente usa mesmo uma ferramenta. `src/live.js` perdeu o estado `demo`.
- **As salas e os agentes ficam exactamente como estavam.** O polimento de materiais e iluminação que chegou a ser experimentado em 1.9.1 (ambiente PMREM, tone mapping neutro, vernizes, candeeiros, cove) foi **revertido a pedido do dono**: a cena volta a 1.9.0, sem uma única geometria, câmara ou controlo diferente. O trabalho está no histórico (`3d74ea0`) e pode voltar noutra altura, aos poucos.
- **O servidor não morre por falta de bundle.** `serve.mjs` constrói o `dist/` uma vez no arranque se ele faltar (num clone limpo) e, se mesmo assim faltar, `/` e `/app` respondem **503 com o motivo** em vez de derrubarem o processo.
- **Provas.** `ops.test` **71/71** · `check.mjs` **94/95** (só `smoke: browser`, sem Chrome nesta máquina) · `npm run build` **1275 KB** + `mesa.html` 86 KB.

## 1.9.0 — 26 out 2026 · Os monitores mostram o trabalho

- **O escritório ao vivo, a sério.** Os 35 monitores deixam de repetir três linhas de exemplo. Cada posto mostra a **tarefa real** que a base de dados do Órbita registou: título, hora de início, tentativa x/y, o que a tarefa produziu (ficheiros, KB, QA, preview, lead qualificado) e, quando falhou, o erro escrito. Sem trabalho registado, o ecrã diz **«sem tarefa registada»** — não roda texto para parecer ocupado.
- **Cada monitor é diferente porque o trabalho é diferente.** A forma do painel vem do tipo de tarefa: `terminal` (geração, correções, entregas), `relatório` (QA, com as contagens críticos/importantes/menores), `documento` (briefing, conteúdo), `lista` (leads, propostas, mensagens). Nada de uma animação igual em 35 ecrãs.
- **Streaming real, não animação.** `GET /api/ops/aovivo` é o retrato; `GET /api/ops/aovivo/stream` é **SSE** (sem WebSocket, sem dependências). O servidor compara a impressão digital de `tasks`/`jobs`/`projects` a cada 800 ms e **só emite quando algo mudou**; entre mudanças manda um `ping`. Cada `update` traz `alteracoes` — que agente mudou, para que tarefa, para que estado e quando.
- **Estados que dizem a verdade.** `LIVE` só com tarefa a correr ou evento real nos últimos 2 minutos; `WAITING` para fila e aprovações; `ERROR` para falha recente (30 min, para uma falha de ontem não ficar vermelha para sempre); `IDLE` quando não há nada. Sem percentagens inventadas.
- **Ligação que cai fica visível.** O cliente deteta silêncio (20 s) e a falha do `EventSource`; a partir daí os monitores e o painel passam a **DESATUALIZADO** com a hora do último dado bom, em vez de fingirem direto. O `retry: 3000` faz o cliente voltar sozinho e há um botão **ATUALIZAR AGORA**.
- **Clicar num agente abre o painel de inspeção** (separador **AO VIVO** no rail, agora visível): identidade que já existia (nome, função, departamento, cor), estado operacional, atividade atual com passos reais, o **monitor em direto** (o mesmo desenho que está na cena, noutro tamanho), verificações de QA, artefactos com link para o ficheiro/preview/zip/projeto, histórico e eventos. O que não existe é dito por palavras. Fecha sem perder a posição na cena — o rail continua a ser o mesmo.
- **Segurança.** O que sai do servidor passa por `redact()` (caminhos absolutos abreviados, chaves e tokens ocultos); o `payload` da tarefa — que pode levar conteúdo privado — **não** é enviado. As rotas novas estão sob sessão e `permFor(..., 'read')`, com 401 sem credencial.
- **Sem custo no motor.** O tick da cena deixou de sortear linhas: redesenha um monitor quando chega retrato novo e, no máximo, de 2,5 s em 2,5 s (15 s com a câmara longe). Nada muda na geometria, na câmara nem nos controlos; com `window.SCREENS` (cena de demonstração) os ecrãs continuam gravados e o painel marca **DEMO**.
- **Provas.** `ops.test.mjs` **69/69** (6 testes novos: mapa posto→agente, idle honesto, running/queued/falhada, impressão digital, `redact`), `check.mjs` **94/95** (só a do navegador, que precisa de Chrome) com **dois passos novos** — retrato com 401 sem sessão e fluxo SSE que emite só o que mudou —, `evals` 8/8 e `integrations` 18/18. Imagem de prova dos quatro formatos: `monitores-aovivo.png`.

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
