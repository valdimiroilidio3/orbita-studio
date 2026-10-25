# Órbita — para o Claude Code

Estás no repositório do Órbita. O proprietário vai pedir-te, quase sempre, para mudar **quem são os agentes e o que fazem**, para ensinar a um agente **como se faz um tipo de trabalho** (um briefing ou uma competência), para pôr algo **no horário** (uma rotina), ou para mudar **que conectores os agentes podem usar**. Faz isso editando os ficheiros JSON e as pastas de competências descritas abaixo. Não toques em `src/`, `serve.mjs` nem no build para esses pedidos.

## Mudar os agentes

O plantel vive em `office.agents.json` (valores por omissão) e em `office.agents.local.json` (a cópia do proprietário, ignorada pelo git). **Escreve sempre em `office.agents.local.json`**: se não existir, cria-o com `{"agents": []}` e acrescenta apenas os agentes que estás a mudar. Nunca edites `office.agents.json` a menos que te peçam para mudar os valores por omissão.

Cada agente tem este aspeto:

```json
{ "id": "newt", "department": "marketing", "lead": false,
  "name": "NEWSLETTER", "role": "Agente Criador de Newsletter",
  "does": "Escreve a newsletter mensal que os teus registos realmente abrem.",
  "tools": ["beehiiv", "loops"],
  "brief": "Cinco pontos e uma citação de destaque. Linhas de assunto com menos de 40 caracteres. Nunca começar pelo nome da empresa." }
```

Podes mudar **name, role, does, tools, brief, model**. Mantém o `name` curto e em maiúsculas (é a etiqueta na secretária). O `does` é o que o agente lê sobre si próprio antes de cada tarefa, por isso escreve-o como uma descrição de funções numa ou duas frases. `tools` nomeia os conectores a que este agente costuma recorrer (usa os nomes da barra superior, em minúsculas). `brief` são as instruções permanentes do proprietário para aquele agente, lidas antes de cada tarefa e de cada conversa: até 2 000 caracteres, uma string ou uma lista de linhas. Tudo o que for mais longo, ou que tenha passos e um modelo, é uma competência (secção seguinte). `model` é `sonnet`, `opus` ou `fable`, ou vazio para o valor do escritório (Sonnet); define-o só quando o proprietário nomear um — uma tarefa ou uma rotina pode ainda definir o seu por cima. `effort` é `low`, `medium`, `high`, `xhigh` ou `max`, ou vazio para a definição do escritório e depois a do modelo (o Opus corre em high); mesma regra, mesma precedência.

O plantel é lido por esta ordem, o último ganha: `office.agents.json` → `<cérebro>/Órbita/agents.json` → `office.agents.local.json`. O cérebro é a pasta indicada por `brain` em `office.config.json` (ou `office.config.local.json`, que ganha). Se o proprietário guarda o plantel no cérebro, escreve lá em vez do ficheiro local.

Fixo, e o escritório ignora alterações: `id`, `department`, `lead`. Há **seis departamentos e 35 lugares** e é esse o escritório. Não acrescentes nem removas agentes, departamentos ou grupos. Quando o proprietário quer um novo tipo de agente, **renomeia um lugar** no departamento certo. Quando quer menos, deixa o lugar como está; um agente parado não custa nada.

Chaves dos departamentos: `emails` (5 lugares) · `sales` (6) · `marketing` (7) · `ops` (6) · `fin` (4) · `delivery` (7). Cada sala tem um líder (ORBITA Director, Lead Hunter, Sales Closer, Creative Architect, Systems Engineer, Growth Publisher) e o líder continua a ser o líder.

Depois de editar: corre `npm run check` (valida o plantel e mostra todos os problemas) e diz ao proprietário para reiniciar o escritório (`npm start`). Nomes, funções e descrições atualizam-se no próximo carregamento da página.

## Ensinar um agente a fazer uma tarefa (competências)

Quando o proprietário diz «é assim que fazemos X», «faz o agente trabalhar desta maneira», «aqui está o nosso procedimento / modelo / um exemplo de que gostei», ou pergunta porque é que as entregas são genéricas, a resposta é uma **competência**. Uma competência é uma pasta com um `SKILL.md` e os ficheiros ao lado, com a mesma forma de uma competência do Claude Code. Guia completo: `SKILLS.md`. Lê-o uma vez antes de escreveres a primeira.

**Onde escrever:** `<cérebro>/Órbita/skills/<nome>/SKILL.md`, em que `<cérebro>` é a pasta de `office.config.local.json` → `office.config.json` (`brain`, por omissão `./brain`). Cria as pastas se não existirem. Nunca escrevas as competências do proprietário na pasta `skills/` do repositório; essa guarda os exemplos incluídos e um `git pull` iria chocar com eles. Uma competência com o mesmo nome no cérebro substitui a incluída.

**Decide primeiro briefing ou competência.** Cabe num parágrafo, sem passos nem modelo → um `brief` no agente. Tem passos, uma forma, regras ou um documento a copiar → uma competência.

**O que precisas antes de escrever.** O gatilho (que tarefas isto cobre), o material de origem (um procedimento, um exemplo, a descrição do proprietário), a forma da coisa acabada e as regras. Se o proprietário te deu um documento, lê-o primeiro na íntegra. Se faltar algum destes, faz uma pergunta para o obter; não inventes o processo do proprietário.

**A pasta:**

```
<cérebro>/Órbita/skills/proposta/
  SKILL.md       front matter + instruções (menos de 6 000 caracteres)
  template.md    a forma da coisa acabada, com os títulos mantidos
  example.md     um exemplo real de que o proprietário gostou (opcional; tira tudo o que seja privado e que ele não te tenha dado)
```

**SKILL.md:**

```markdown
---
name: proposta
description: Como escrevemos uma proposta a um cliente
agents: [piper]
---
# Escrever uma proposta
Usa isto para qualquer pedido que termine num documento a que o cliente diz sim ou não.   ← o gatilho, primeira linha

## Antes de escrever
1. …o que ler primeiro, pelo nome da nota (`10-Negocio/escada-de-ofertas.md`)…
## A forma
Segue o `template.md` ao lado deste ficheiro, secção a secção.
## Regras
- curtas, absolutas, uma por linha
```

**Ligação.** `agents: [id, id]` para um ou mais agentes (ids de `office.agents.json`; escolhe o lugar cujo `does` corresponde e diz qual escolheste). `departments: [emails]` para um departamento inteiro (`emails`, `sales`, `marketing`, `ops`, `fin`, `delivery`). Nenhum dos dois a liga a todos os agentes; só o faças para um estilo da casa, e diz que o fizeste. Ids desconhecidos são recusados e uma competência sem ligação válida é ignorada.

**Limites que o carregador aplica:** corpo do `SKILL.md` 6 000 caracteres; cada ficheiro ao lado 4 000, todos juntos 8 000. Ficheiros legíveis são `.md .txt .csv .json .yaml .html`; o resto é listado apenas pelo nome. Material de referência longo vai para o cérebro como notas normais, que o agente lê quando a tarefa o pede; a competência só as nomeia.

**Regras de escrita.** A primeira linha depois do título diz quando a competência se aplica. Primeiro os passos, depois a forma, depois as regras. Aponta as notas pelo nome. As regras são curtas e absolutas. Uma competência por tipo de trabalho. Nunca ponhas numa competência um número que deva vir do registo de números; diz de onde vem.

**Depois de escrever:** corre `npm run check` (lista todas as competências, a sua ligação e todos os problemas em frases simples; corrige o que estiver a vermelho). Competências e briefings entram em vigor na tarefa seguinte, sem reiniciar. Diz ao proprietário: o caminho da pasta, a que agente está ligada e uma tarefa para escrever e experimentar. Sugere que leia o resultado e o devolva com `revise: …` na conversa; quando uma correção for algo que ele vai querer sempre, incorpora-a na competência.

**Ler as competências de volta.** http://localhost:4520/api/skills (servidor a correr) ou `node -e "import('./skills.mjs').then(async m=>console.log(JSON.stringify(m.loadSkills((await import('./config.mjs')).loadConfig().brainPath,(await import('./roster.mjs')).loadRoster().agents).summary(),null,1)))"`.

## Lições e a entrevista de configuração

Mais duas coisas que o escritório escreve no cérebro sozinho. Ambas são ficheiros simples que podes editar quando o proprietário pedir.

- **Correções** — `<cérebro>/Órbita/feedback/<id-do-agente>.md`. Cada `revise: …` que o proprietário envia aterra aqui, separado em «## Regras permanentes» (lidas por esse agente antes de cada tarefa) e «## Pontuais». Uma linha cada, `- data · regra ← «o que o proprietário disse» (tarefa)`. Quando o proprietário diz «incorpora as lições na competência», «faz disso uma regra», «esquece isso» ou «o agente continua a fazer X»: lê este ficheiro, passa as preferências duradouras para a competência do agente (ou para o `brief`, se não houver competência) como regras curtas e absolutas, e apaga as linhas que moveste para não serem ditas duas vezes. Nunca inventes uma regra que o proprietário não deu.
- **A entrevista** — a conversa do líder do departamento condu-la quando o proprietário diz «configurar» (`onboard.mjs`). Escreve briefings em `<cérebro>/Órbita/agents.json` e uma competência em `<cérebro>/Órbita/skills/<nome>/`. Uma competência anterior com o mesmo nome fica ao lado como `SKILL.md.backup-<hora>`; se o proprietário te pedir para arrumar, junta o que vale a pena e apaga a cópia de segurança. `data/interviews.json` guarda uma entrevista em curso; apaga-o se uma ficar presa.

## Rotinas: tarefas no relógio do escritório

Quando o proprietário diz «todas as segundas…», «cada manhã…», «segundo um horário», «automaticamente às…», «faz X acontecer a cada…», isso é uma **rotina**: uma tarefa que o escritório dispara sozinho a essa hora e corre sem ninguém escrever. **Nesta versão: só Comando, Prospeção e Vendas** (`emails`, `sales`, `ops`). Uma rotina para qualquer outro departamento é recusada pelo escritório; diz ao proprietário que chega numa versão posterior em vez de a escrever.

**Onde:** `<cérebro>/Órbita/routines.json` (`<cérebro>` como acima). Cria-o com `{"routines": []}` se não existir. Nunca escrevas rotinas em mais nenhum sítio.

```json
{ "id": "propostas-paradas", "dept": "ops", "agent": "folo",
  "title": "Listar as propostas sem resposta e preparar os seguimentos",
  "text": "Lista as propostas sem resposta há mais de 14 dias e prepara um seguimento para cada. Gmail em leitura, rascunhos no Gmail.",
  "when": { "kind": "weekly", "days": [1], "at": "09:00" },
  "needsOk": true, "paused": false }
```

- `id` curto, único, em minúsculas. `dept` um dos três. `agent` um id do plantel desse departamento; escolhe o lugar cujo `does` corresponde e diz qual escolheste.
- `text` é o que se pede ao agente, escrito como o proprietário o escreveria. `title` é o cartão no quadro (menos de 90 caracteres).
- `when`: `{"kind":"daily","at":"HH:MM"}` · `{"kind":"weekdays","at":"HH:MM"}` · `{"kind":"weekly","days":[1,4],"at":"HH:MM"}` (0 = domingo) · `{"kind":"hourly","every":1,"from":"09:00","to":"17:00","weekdaysOnly":true}` · `{"kind":"minutes","every":2}` (só para testar). As horas são o relógio local da máquina, formato 24 horas.
- `when.start`: `"YYYY-MM-DD"`, opcional (V3.2.1) — a rotina começa nessa data e nunca dispara antes («a partir da próxima segunda», «a começar a 5 de outubro»). Deixa de fora para começar já. O proprietário também pode definir uma clicando num dia do calendário (P) com REPETIR ligado.
- `needsOk` (por omissão true): o resultado fica em À ESPERA DE APROVAÇÃO até o proprietário dar o visto antes de o agente enviar, pagar ou mudar algo. Deixa-o ligado a menos que a rotina só leia e relate (uma triagem, uma lista, uma reconciliação), e diz o que escolheste e porquê.
- `paused: true` mantém-na no horário sem disparar.
- `model`: `sonnet`, `opus` ou `fable`, só quando o proprietário nomear um; caso contrário deixa de fora e aplica-se o modelo do agente ou do escritório (a tarefa ganha à rotina, a rotina ganha ao agente, o agente ganha ao escritório).
- `effort`: `low`, `medium`, `high`, `xhigh` ou `max`, só quando o proprietário nomear um; caso contrário o do agente, depois o do escritório, depois o do próprio modelo.
- `team: true` quando o proprietário quer o departamento inteiro nisto («em equipa», «põe a equipa a…»): o líder do departamento fica dono da rotina (define `agent` com o id do líder; um id de especialista é movido para o líder), planeia as peças quando dispara, as secretárias trabalham ao mesmo tempo e o líder escreve o resultado final. Deixa-o de fora para uma rotina de uma secretária — uma equipa custa duas a quatro execuções mais duas do líder.

O servidor relê o ficheiro a cada 20 segundos, por isso uma rotina entra sem reiniciar; a próxima execução é calculada a partir do momento em que é lida. O estado de execução (próxima, última) vive em `data/routines.json`, nunca no ficheiro do cérebro. Depois de escrever: corre `npm run check` (valida todas as rotinas e nomeia todos os problemas: agente desconhecido, departamento errado, horário incompleto, id duplicado) e diz ao proprietário o título, o horário por palavras, que agente a tem, se espera pelo seu OK, e que aparece sob a etiqueta AGENDADAS com um botão EXECUTAR AGORA para experimentar já.

## Uma tarefa para uma data (o calendário)

Quando o proprietário diz «na sexta…», «na próxima terça às 10…», «no dia 5…» para algo pontual (não «todas as»), isso é uma **tarefa agendada**, não uma rotina. O escritório trata disso sozinho: o proprietário clica no dia no calendário (P), ou a página envia `{ "dept", "text", "at": <ms ou ISO> }` para `/api/tasks`. Não há ficheiro para escrever (vivem em `data/tasks.json`, estado `scheduled`, disparadas pelo relógio do servidor); diz ao proprietário para carregar em P e clicar no dia, e diz o que escrever.

## Mudar os conectores

A barra superior mostra os servidores MCP a que o **Claude Code desta máquina** está ligado (`claude mcp list`). Para acrescentar um: `claude mcp add …` ou liga-o em claude.ai; o escritório apanha-o ao reiniciar. Para decidir o que os agentes podem chamar, edita `office.config.json` (ou `office.config.local.json`):

```json
"mcp": {
  "allow": [],
  "deny": ["Stripe"],
  "departments": { "Slack": ["emails", "ops"] }
},
"tools": { "web": true, "browser": true },
"teams": { "enabled": true, "max": 4 }
```

`allow` vazio significa todos os servidores ligados. `deny` mantém um servidor na barra mas fora das mãos dos agentes (`"Chrome"` também funciona aí). `departments` diz a que grupos um servidor está ligado; servidores desconhecidos ficam disponíveis para todos. `tools.web` dá pesquisa web aos agentes. `tools.browser` (V3.2, 16 set) dá-lhes o próprio Chrome do proprietário através da integração Chrome do Claude Code — a execução começa com `--chrome` e recebe o servidor `claude-in-chrome` (separadores abertos, ler páginas, preencher formulários em sites onde o proprietário tem sessão); precisa da extensão Claude in Chrome emparelhada com esta máquina (`claude --chrome` uma vez) e da sessão do Claude Code. A barra mostra um bloco Chrome ligado a todos os grupos. `teams` (V3.2, 16 set) é o Agent Teams: `enabled` mostra o botão EQUIPA e faz «em equipa» significar isso; `max` limita as secretárias (2–6, por omissão 4).

Os agentes só recebem servidores ligados (mais a web quando ativa, mais o navegador quando ativo e emparelhado). Nunca recebem Bash, ferramentas de ficheiros ou subagentes. A regra permanente deles: ler livremente; enviar, publicar, pagar, apagar ou alterar dados fora desta máquina **só** quando a tarefa do proprietário pedir explicitamente essa ação exata — no navegador também.

## Equipas de agentes

Quando o proprietário diz «em equipa», «põe a equipa nisto», «cria três colegas para…», ou carrega em EQUIPA na barra, o **líder** do departamento assume a tarefa e divide-a em duas a `teams.max` peças independentes nas secretárias cujo `does` ou competências se encaixam; as peças correm ao mesmo tempo, um processo Claude cada; os colegas podem deixar notas de uma linha (`@lider: …`, `@<id>: …`) que chegam ao líder; o líder escreve o resultado final a partir das peças. Esta é a construção própria do escritório da forma (líder · colegas · lista partilhada de peças · notas) a partir de sessões Claude sem interface separadas — as equipas de agentes do próprio Claude Code só nascem num terminal interativo, por isso não são o que corre aqui. Não há nada a escrever para uma tarefa de equipa; é o mesmo plantel, os mesmos briefings e as mesmas competências. Para tornar uma secretária melhor colega, melhora o `does` (o líder divide por ele) e as competências. Uma rotina de equipa é `"team": true` em `routines.json` com o líder como `agent`.

## Os motores de IA (e ligar outro)

O escritório já não assume o Claude Code. `providers.mjs` descreve os motores — `claude-cli`,
`codex-cli`, `gemini-cli`, `cli` (genérica) e as APIs `anthropic`, `openai`, `openrouter`, `groq`,
`mistral`, `deepseek`, `xai`, `gemini`, `ollama`, `lmstudio`, `openai-compatible` — e `resolve()`
escolhe o primeiro que está mesmo utilizável: o pedido em `AO_AI`, depois `data/ai.json` (o que o
proprietário trocou na gaveta **IA**), depois `office.config.json` → `ai.provider`, depois
`ai.fallback`, depois os presets. `makeRunner()` faz o turno; `summary()` alimenta `/api/health` e
`/api/ai`. Lê **[AI.md](AI.md)** antes de mexer nisto.

Regras que não se quebram:

- **Nada é instalado por nós.** Falta o binário ou a chave? O motor sai da lista com uma frase em
  português a dizer o que falta — nunca um estoiro, nunca um silêncio.
- **Só o CLI do Claude tem mãos.** `tools: true` é exclusivo de `claude-cli` (MCP + Chrome). Todos os
  outros devolvem texto e `tools` fica vazio; a UI diz «SÓ TEXTO».
- **As chaves vivem no ambiente.** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, `AO_AI_KEY`.
  Nunca num ficheiro versionado.
- **Trocar não reinicia.** `POST /api/ai/switch` valida, grava `data/ai.json` e reconstrói o runner;
  as tarefas seguintes correm no motor novo. `GET /api/ai?refresh=1` volta a detetar o que existe.
- **Um motor novo** é um preset em `providers.mjs` (com `kind`, `bin`/`baseUrl`, `model` e `hint`) e
  uma linha em `AI.md` — mais nada.

## Tudo o resto

- `npm run check` é o ciclo. Corre-o depois de qualquer alteração ao código; corrige o que estiver a vermelho.
- `README.md` diz o que o produto faz. Mantém-no fiel ao código.
- Lançamento: `node scripts/release.mjs --push` (só o proprietário).
