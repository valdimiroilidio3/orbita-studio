# A OFICINA — ferramentas que os agentes forjam

> Pedido do dono: *«implementa um sistema capaz de cada agente criar próprias ferramentas para
> operar e possibilidade de eu poder ver o que está a fazer através do terminal»*.

Um agente que só sabe falar é um comentador. Um agente que sabe **construir uma ferramenta** e
**prová-la** antes de a usar é um colega. A Oficina (1.11.0) é o sítio onde isso acontece — e o
terminal que mostra tudo, linha por linha, sem uma única linha escrita à mão.

```
agente diz o que falta
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ OFICINA                                                              │
│  1. escolher a receita   (7 receitas: notas, tarefas, docs, escrita) │
│  2. escrever o código    (só primitivas; sem fs, rede, processo)     │
│  3. gravar em disco      (data/forge/tools/<sala>/<id>/vN.tool.js)   │
│  4. PROVAR               (corre contra os dados REAIS desta máquina) │
│  5. reparar (≤2 voltas)  (regras determinísticas, visíveis no log)   │
│  6. activar OU deixar em rascunho (se escreve, o dono decide)        │
│  7. primeira execução    (e o resultado real aparece no terminal)    │
└──────────────────────────────────────────────────────────────────────┘
        │
        ▼
terminal (tecla F) · CLI `node tools/forge.mjs watch` · SSE · log.ndjson
```

## O que fica onde

| caminho | o que é |
|---|---|
| `forge/manifest.mjs` | o portão: valida o manifesto e recusa código perigoso |
| `forge/primitives.mjs` | as ÚNICAS funções que uma ferramenta pode chamar (com escopo) |
| `forge/sandbox.mjs` | onde o código corre: contexto `vm`, prazo de CPU, tecto de saída |
| `forge/compose.mjs` | as 7 receitas, o escolhedor (com o porquê) e as regras de reparação |
| `forge/registry.mjs` | gravação atómica, versões, histórico, uso, adopção |
| `forge/bus.mjs` | eventos → terminal e `data/forge/log.ndjson` |
| `forge/index.mjs` | a fachada: `forge · run · test · sense · activate · adopt` |
| `data/forge/tools/<sala>/<id>/` | o manifesto + `v1.tool.js`, `v2.tool.js`, … (histórico) |
| `src/forge.js` | o terminal do browser (SSE + comandos) |
| `tools/forge.mjs` | o mesmo terminal, na linha de comandos |

`data/` está no `.gitignore`: as ferramentas que os agentes escrevem são **estado local desta
máquina**, como as tarefas. Não viajam no repositório.

## O código de uma ferramenta

Uma ferramenta é um ficheiro com uma função. Não tem imports: o mundo dela são as primitivas.

```js
function run(input, ctx) {
  const notas = ctx.brain.notes();
  return { notas: notas.length, palavras: notas.reduce((s, n) => s + n.words, 0) };
}
```

E um manifesto que diz quem a escreveu, o que toca e como se prova:

```json
{
  "id": "contagem-do-cerebro", "room": "marketing", "author": "mlead",
  "name": "Contagem do cérebro", "summary": "Conta as notas, as palavras e as ligações.",
  "scopes": ["brain:read"], "state": "active", "version": 1,
  "examples": [{ "input": { "limite": 3 },
                 "expect": "typeof result.palavras === \"number\" && Array.isArray(result.maiores)" }]
}
```

Uma ferramenta **sem provas não entra**. Uma prova que não olhe para `result` também não: o
objectivo não é ter um exemplo, é ter uma coisa que possa falhar.

## As primitivas e os escopos

| primitiva | escopo |
|---|---|
| `ctx.brain.notes()` · `.search(termo)` · `.read(nome)` | `brain:read` |
| `ctx.brain.writeNote(nome, corpo)` | `brain:write` *(pede o dono para activar)* |
| `ctx.tasks.list()` · `.stats()` | `tasks:read` |
| `ctx.docs.list()` | `docs:read` |
| `ctx.text.words/lines/top/clip` · `ctx.clock.*` · `ctx.log(...)` | — |
| `ctx.scratch.write/read` | `scratch:write` |
| `ctx.room` | — (a sala, como texto) |

`notes()` devolve o **rosto** de cada nota (nome, título, palavras, ligações), não o texto todo: uma
ferramenta que precisa do texto pede-o com `read()`. Foi uma decisão de desenho, não uma limitação —
impede que uma ferramenta despeje o cérebro inteiro para dentro do prompt de um agente.

## Segurança: três vedações, e o que elas não são

1. **O portão** (`manifest.mjs`) recusa `require`, `import`, `process`, `eval`, `Function`,
   `constructor`, `prototype`, `globalThis`, rede, temporizadores e ciclos infinitos óbvios — e diz
   a **linha** onde viu o problema.
2. **O contexto `vm`** corre o código num reino próprio, com a geração de código a partir de texto
   desligada; não existe `process`, `require` nem `fetch` lá dentro. As primitivas devolvem **JSON
   em texto** e quem o lê é o `JSON.parse` do contexto: os dados que a ferramenta vê nunca trazem
   os protótipos do processo que os leu.
3. **O prazo e o tecto**: 400 ms de CPU por execução (cortados à força) e um limite de saída — que
   **recusa** em vez de cortar JSON a meio.

O que isto **não** é: uma fronteira contra código malicioso a sério. Um `vm` do Node não é um
sandbox de segurança, e nós não vamos fingir que é. A confiança aqui é a do dono: as ferramentas são
escritas pelos agentes dele, e as que escrevem fora do rascunho **só activam depois de ele carregar
no botão**. Quem quiser isolamento a sério corre o servidor com o modelo de permissões do Node:

```bash
node --permission --allow-fs-read="$PWD" --allow-fs-write="$PWD/data" serve.mjs
```

## O terminal

**No browser:** tecla **F** (ou o botão `›_` junto ao zoom). Painel escuro, filtros por sala, e um
prompt onde se escreve comandos a sério — todos batem na API:

| comando | o que faz |
|---|---|
| `:ls` | o catálogo, por sala, com estado, versão e uso |
| `:forge <sala> <o que precisas>` | a oficina forja, prova e activa (ou deixa em rascunho) |
| `:run <sala> <id> [{"json"}]` | corre e mostra o resultado **real** |
| `:adopt <sala> <id> <destino>` | leva a ferramenta a outra sala (nasce em rascunho, é provada lá) |
| `:activate <sala> <id>` | aprova uma ferramenta que escreve |
| `:eventos` · `:limpar` · `:help` | |

**Na linha de comandos** (o mesmo fluxo, para um `tmux` ao lado da cena):

```bash
node tools/forge.mjs ls
node tools/forge.mjs forge marketing "contar as palavras das notas do cérebro"
node tools/forge.mjs run marketing contagem-do-cerebro '{"limite":5}'
node tools/forge.mjs adopt marketing contagem-do-cerebro sales
node tools/forge.mjs watch            # segue o fluxo ao vivo (Ctrl+C sai)
```

**Por baixo:** `GET /api/forge/stream` é SSE; `curl -N http://localhost:4550/api/forge/stream` mostra
o mesmo que o painel. O histórico fica em `data/forge/log.ndjson`, uma linha JSON por evento.

## Como os agentes usam isto

- **Antes de escrever**, o servidor corre as ferramentas-sensor da sala (`auto`, sem efeitos) e
  mete o resultado no prompt: *«DADOS DAS TUAS FERRAMENTAS (lidos agora, nesta máquina)»*. O agente
  escreve sobre números reais em vez de os inventar.
- **No prompt**, cada agente vê a lista do que a sala já forjou e a instrução: se precisar de algo
  que não tem, escreve `FORGE: <o que precisa>`. O servidor lê essa linha do resultado, forja a
  ferramenta (uma por tarefa) e ela existe na tarefa seguinte. O trabalho do agente passa a
  acrescentar ao escritório, não só a si próprio.
- **Entre salas**, `adopt` copia uma ferramenta com proveniência (`origin`) e volta a prová-la
  contra os dados da sala de destino — o que a MEDIA aprendeu, as VENDAS não têm de reaprender.

## API

| rota | |
|---|---|
| `GET /api/forge` | catálogo (salas, ferramentas, receitas, primitivas, limites) |
| `GET /api/forge/events?n=120` | últimos eventos + estatísticas |
| `GET /api/forge/stream` | SSE ao vivo |
| `POST /api/forge/draft` | `{ room, need }` → turno completo (200 com rascunho, 422 com recusa) |
| `POST /api/forge/run` | `{ room, id, input }` → resultado real |
| `POST /api/forge/activate` | `{ room, id }` → provas outra vez, depois activa |
| `POST /api/forge/adopt` | `{ room, id, to }` |

## Limites, ditos

- **Sem motor de IA ligado, quem escolhe é o compositor.** As 7 receitas são determinísticas: o
  pedido é casado por palavras e a ferramenta é uma instância provada. Com um motor ligado, o mesmo
  portão aceita código escrito pelo modelo (`POST /api/forge/draft` com `code`) — muda quem escreve,
  não o que é exigido.
- **Ainda não há ponte MCP.** Hoje as ferramentas correm no servidor antes de o agente escrever;
  expô-las como ferramentas MCP ao `claude -p` é o passo seguinte.
- **As provas correm em ensaio quando a ferramenta escreve** (`dry: true`). Uma prova nunca suja o
  cérebro — é por isso que o resultado das escritas diz `seco: true`.

## Provas

```bash
npm run test:forge     # 29 testes: portão, sandbox, primitivas, compositor, oficina, terminal
npm run test:scene     # o painel existe no bundle, abre e fecha sem rede
```

O que os testes fixam, e não é pouco: `process` não existe dentro do sandbox; um ciclo infinito é
cortado em menos de 3 s; um erro dentro da ferramenta volta como mensagem; o tecto de saída recusa
em vez de corromper; sem escopo a primitiva recusa; a escrita em ensaio não toca no disco; a
reparação só actua em falhas que reconhece; uma ferramenta partida fica `broken` e nunca conta como
activa; a adopção guarda a proveniência; e os eventos chegam por ordem ao terminal e ao
`log.ndjson`.
