# Ligar outro motor de IA

O escritório deixou de estar preso ao Claude Code. Fala com qualquer motor que aceite um *system
prompt*, um pedido, e devolva texto — uma CLI instalada na máquina ou uma API com chave. A
diferença entre eles é dita sem rodeios: **um CLI dá mãos ao agente** (ferramentas MCP, Chrome,
ficheiros), **uma API dá-lhe voz** (escreve, não mexe em nada).

Nada é instalado por ti. Se falta o binário ou a chave, o motor aparece como indisponível e a razão
está escrita em português, na gaveta **IA** do painel de tarefas.

## Sem chave nenhuma: os motores gratuitos (1.32.0 · 1.35.0)

Desde a 1.35.0 há um **fornecedor do escritório** que usa esta cadeia:
`gratis` (`style: 'orbita'`), com o rótulo «Gratuitas (sem chave)». É ele que
assume quando não há mais nenhum motor — numa máquina nova ou num ambiente sem
chaves, as salas começam a trabalhar em vez de dizer que não têm IA. O runner
declara `tools: false` (responde texto; não mexe) e a cadeia é a mesma do
`api/_ia`: LLM7 → OVH → OpenCode Zen → Pollinations, com fallback e o nome do
fornecedor que respondeu no `modelId`. Quando há um motor com chave, esse fica à
frente: o gratuito é o chão, não o teto.

Há três pares que **responderam de verdade** em produção a 27 out 2026, sem chave e
sem cartão. Estão em `api/_ia/gratuitos.mjs`, com a data, o número de sucessos e a
latência medidos em `/ia/uso`:

| Fornecedor | Modelo | Medido | Serve para |
|---|---|---|---|
| LLM7 (`api.llm7.io/v1`) | `codestral-latest` | 16/16 · 0,9–3,4 s | código, texto, passos rápidos |
| OVH (`oai.endpoints.kepler.ai.cloud.ovh.net/v1`) | `Qwen3.5-397B-A17B` | 13 s | planos, raciocínio, revisão |
| OVH | `gpt-oss-120b` | 13–45 s | raciocínio, código, ferramentas (último recurso) |
| Pollinations (`text.pollinations.ai`) | `openai-fast` | provado por HTTP a 27 out 2026 | o mesmo GPT-OSS 20B por outra estrada, quando o OVH dá 429 (1 pedido/15 s) |

### 1.33.0 · dois gratuitos que não precisam de chave nenhuma sua

- **OpenCode Zen** — o serviço publica a chave dos modelos gratuitos
  (`Authorization: Bearer public`), por isso funciona sem conta. Nove modelos
  `-free`; o `nemotron-3.5-super-vl-free` é a segunda fonte com **visão**.
- **Pollinations** — tier anónimo por GET (não é OpenAI): o cliente ganhou o
  dialeto `pollinations`.
- **A lista de modelos não é escrita à mão.** `GET /models` é guardado em
  `testes[x].lista` e a cadeia passa a incluí-lo (`catalogoDaCadeia`), só para
  fornecedores sem custo; num gateway misto só entram ids com `free`. Motivo
  concreto: os quatro nomes do OpenCode que estavam no catálogo **já não existiam**
  no serviço.

`/ia/gratuitos` separa agora **provados** (com resposta registada) de **por
provar** (existem e estão prontos, mas ainda não responderam). Só os primeiros
contam como funcionais.

A mesma resposta existe em `GET /ia/gratuitos` (na função) e em
`GET /api/ia/gratuitos` (no `serve.mjs` local, sem base de dados: as latências ao
vivo ficam de fora, a lista medida e a cadeia são as mesmas). Nada disto precisa
de chave.

O Control Center mostra os dois grupos no cartão **IA gratuita**, com a cadeia
real por tipo de trabalho (plano → código → texto → investigar → revisão →
visão). Cada linha «por provar» tem o botão **Provar**: faz um pedido curto
àquele modelo — `POST /ia/testar {fornecedor, modelo}` — e só o promove a
provado se ele responder. Se responder por outro modelo, o toast di-lo e o
pedido não conta como prova. As provas ficam em
`cfg.testes[fornecedor].provados[modelo]` e em `/ia/uso`; a lista real que o
fornecedor publicou (`lista`) não se perde quando um teste falha.

O router põe estes pares à frente do catálogo (+2000 menos a latência medida). Se
houver **uma chave real** no ambiente, os keyless recuam 900 pontos: quem configura
uma chave quer usá-la. A lista não é uma promessa de quota — se um par falhar, o
router marca-o de parte 6 h e segue para o próximo. Essa marca é gravada na config e
sobrevive ao arranque a frio do serverless.

O que **não** funciona e não vale a pena tentar (verificado):

- os outros modelos do LLM7 (`gpt-oss-20b`, `GLM-4.6V-Flash`, `ministral-8b-2512`,
  `Meta-Llama-3.1-8B-Instruct-Turbo`) respondem 400 «currently unavailable» — ficam
  em `MODELOS_INDISPONIVEIS` com a data e o motivo;
- a Vercel AI Gateway exige cartão: 55 pedidos, 0 respostas;
- o Kilo já não responde a pedidos anónimos; `aclide` e `aihorde` falam um dialeto
  próprio que o cliente não fala.

Ver o estado, sem revelar chaves:

```bash
GET /ia/gratuitos          # produção (via /api/rpc?caminho=/ia/gratuitos)
GET /api/ia/gratuitos      # servidor local
```

Devolve `pronto`, `total`, o mais rápido, o que foi medido e a cadeia real de cada
tipo de trabalho (`plano`, `codigo`, `texto`, `investigar`, `revisao`, `rapido`,
`visao`). `visao` não se relaxa: sem um modelo com olhos, a cadeia fica vazia em vez
de aceitar um trabalho que não sabe fazer.

## O que já está ligado

| Motor | Como é chamado | Precisa de |
|---|---|---|
| `claude-cli` **Claude Code** | `claude -p … --output-format stream-json` | `npm i -g @anthropic-ai/claude-code` e entrar uma vez |
| `codex-cli` **Codex** | `codex exec --skip-git-repo-check --model {model} {prompt}` | `npm i -g @openai/codex` e `codex` uma vez |
| `antigravity` **Antigravity** | `agy --output-format json --print-timeout 15m -p {prompt}` (o system prompt entra no prompt; o envelope JSON é desembrulhado; saída vazia com código 0 é recusada — issue #76 do antigravity-cli) | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` → `~/.local/bin/agy`, e `agy` uma vez para entrar |
| `gemini-cli` **Gemini** | `gemini -p {prompt} --model {model}` | `npm i -g @google/gemini-cli` e `gemini` uma vez — **substituído pelo Antigravity em junho de 2026**; fica por compatibilidade |
| `cli` **CLI personalizada** | o que puseres em `ai.providers.cli` | um binário, `args` com `{prompt}` `{system}` `{model}` |
| `anthropic` **Claude (API)** | `POST /v1/messages` | `ANTHROPIC_API_KEY` |
| `gemini-api` **Gemini (API do Google)** | `POST /v1beta/models/{modelo}:generateContent` com `X-Goog-Api-Key`; system prompt em `systemInstruction` | **só** `GEMINI_API_KEY` (chave do AI Studio). Sem CLI, sem login. Modelo por omissão `gemini-flash-latest` |
| `openai` · `openrouter` · `groq` · `mistral` · `deepseek` · `xai` · `gemini` | `POST /chat/completions` | `OPENAI_API_KEY` · `OPENROUTER_API_KEY` · `GROQ_API_KEY` · `MISTRAL_API_KEY` · `DEEPSEEK_API_KEY` · `XAI_API_KEY` · `GEMINI_API_KEY` |
| `ollama` · `lmstudio` **locais** | `POST /chat/completions` em `127.0.0.1` | o servidor local a responder |
| `openai-compatible` **qualquer endpoint** | `POST /chat/completions` | `baseUrl` + `model` (+ `AO_AI_KEY` se pedir chave) |

As chaves vivem **só** no ambiente. Nada de segredos em ficheiros versionados — o `.env` da raiz é
lido no arranque (`config.mjs`), nunca sobrepõe o que já estiver exportado, e está no `.gitignore`.

**O caminho mais curto para o escritório funcionar a sério**: uma chave do AI Studio.

```bash
# .env (nunca vai para o git)
GEMINI_API_KEY=a-tua-chave
AO_AI=gemini-api            # opcional: força o motor (sem isto, é escolhido por ter chave)
AO_AI_MODEL=gemini-flash-latest
```

Com isso, os 35 agentes encaminham, escrevem e conversam — sem instalar nada. Os agentes ficam sem
ferramentas MCP (uma API dá voz, não mãos): para Chrome, ficheiros e conectores, o Claude Code
continua a ser o único motor com mãos.

O `agy` instala-se em `~/.local/bin`, que muitas vezes não está no PATH do servidor: o escritório
procura também em `~/.local/bin`, `~/bin`, `/usr/local/bin`, `/opt/homebrew/bin` e `/snap/bin`.

## Ver, testar e trocar

Na barra do painel de tarefas, ao lado de EQUIPA, o botão **IA** diz quem está a responder (ou
`SEM IA`, a vermelho, quando não há nenhum). Clica: a gaveta lista todos os motores, o que falta a
cada um, e dois botões por linha — **TESTAR** faz um turno curto a sério e devolve o texto e os
milissegundos; **USAR** troca a quente, sem reiniciar.

O mesmo por API:

```bash
curl -s localhost:4520/api/ai        # o que está instalado, o que falta e porquê
curl -s -X POST localhost:4520/api/ai/test   -H 'content-type: application/json' -d '{"provider":"codex-cli"}'
curl -s -X POST localhost:4520/api/ai/switch -H 'content-type: application/json' -d '{"provider":"codex-cli"}'
```

`/api/health` passa a trazer `backend` (o id) e `ai` (o motor ativo); `/api/mcp` e o campo `tools`
dizem se os agentes recebem ferramentas neste momento.

## Escolher por ficheiro

`office.config.json` (ou `office.config.local.json`, que ganha):

```json
{
  "ai": {
    "provider": "auto",
    "fallback": ["claude-cli", "codex-cli", "gemini-cli", "anthropic", "openai"],
    "models": { "openai": "gpt-5.1", "openrouter": "anthropic/claude-sonnet-5" },
    "providers": {
      "openai-compatible": {
        "baseUrl": "https://a-tua-empresa.example/v1",
        "keyEnv": "A_MINHA_CHAVE",
        "model": "modelo-da-casa"
      }
    }
  }
}
```

A ordem é esta: **`AO_AI`** (ambiente) → **`data/ai.json`** (o que trocaste na UI) → **`ai.provider`**
→ **`ai.fallback[]`** → os presets. Com `"provider": "auto"`, ganha o primeiro que estiver mesmo
utilizável nesta máquina. `AO_AI_MODEL` força o modelo de qualquer motor.

Modelos: cada motor tem os seus, mapeados a partir dos nomes da casa (`sonnet`, `opus`, `fable`).
O `ai.models` do ficheiro de configuração e o `AO_AI_MODEL` sobrepõem-se ao mapa.

## Sem motor nenhum

O escritório abre na mesma — mostra as salas, o Cérebro e as tarefas guardadas — e diz a verdade no
selo: `SEM MOTOR DE IA`. Uma tarefa nova responde com a razão exata (`Claude Code: 'claude' não está
no PATH — instala com …`), não com um estoiro. Quando ligares um motor, o botão **REVER** da gaveta
deteta-o sem reiniciares o servidor.
