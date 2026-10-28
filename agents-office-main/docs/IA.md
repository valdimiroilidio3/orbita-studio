# ORBITA — APIs multimodelo e orquestração de agentes (1.18.0)

Este documento descreve a camada que liga a mesa a vários fornecedores de IA, o router que
escolhe o modelo por tarefa, os oito agentes e as ferramentas que eles podem mesmo executar.
Foi escrito depois de a coisa correr — não antes.

---

## 1. Arquitectura

```
browser (mesa, #/ia)                 ← nunca vê uma chave
   │  POST /api/rpc {caminho:'/ia/estado', …}   (envelope do 1.17.0)
   ▼
api/rpc.mjs → api/_rotas.mjs → api/_ia/rotas.mjs
                                   ├─ catalogo.mjs   quem existe (fornecedores, modelos, capacidades)
                                   ├─ cliente.mjs    falar em 3 dialetos (openai/anthropic/google)
                                   ├─ router.mjs     que modelo para este trabalho + fallback + orçamento
                                   ├─ ferramentas.mjs o que os agentes podem executar (validação + permissões)
                                   ├─ agentes.mjs    8 identidades, instruções, critérios
                                   ├─ motor.mjs      junta tudo; regista uso; testa fornecedores
                                   └─ orquestrador.mjs plano → passos → revisão
                                   │
                                   ▼
                        Supabase (PostgREST) — orbita_ai_runs / steps / uso / config
                        Fornecedores (HTTPS, chave no cabeçalho)
```

Sem `SUPABASE_URL`/`SUPABASE_SECRET_KEY` a mesa cai no modo local (1.17.0) e o Control Center
diz que a IA precisa do servidor. Sem chaves de fornecedor, `/ia/estado` responde `pronto` falso
e qualquer trabalho nasce `falhou` com a razão escrita.

## 2. Fornecedores e dialetos

| id | fornecedor | dialeto | variável de ambiente | plano gratuito |
|---|---|---|---|---|
| `openrouter` | OpenRouter | openai | `OPENROUTER_API_KEY` | sim (20/min, 50/dia) |
| `google` | Google AI Studio | google | `GOOGLE_AI_API_KEY` ou `GEMINI_API_KEY` | sim (por modelo) |
| `groq` | Groq | openai | `GROQ_API_KEY` | sim (~1000/dia) |
| `cerebras` | Cerebras | openai | `CEREBRAS_API_KEY` | sim (1M tokens/dia) |
| `mistral` | Mistral | openai | `MISTRAL_API_KEY` | sim (exige opt-in de treino) |
| `huggingface` | HF Inference Providers | openai | `HF_TOKEN` | $0,10/mês |
| `nvidia` | NVIDIA NIM | openai | `NVIDIA_API_KEY` | sim (40/min, telefone) |
| `vercel` | Vercel AI Gateway | openai | `AI_GATEWAY_API_KEY` | $5/mês |
| `anthropic` | Anthropic | anthropic | `ANTHROPIC_API_KEY` | não |
| `openai` | OpenAI | openai | `OPENAI_API_KEY` | não |
| `deepseek` | DeepSeek | openai | `DEEPSEEK_API_KEY` | não |

Os limites vêm do README de `free-llm-api-resources` (abril 2026) e mudam sem aviso. O único
estado em que se pode confiar é o que o **teste real** devolve.

## 3. Router

Cada tipo de trabalho tem etiquetas **exigidas** (filtram) e **desejadas** (ordenam):

| tipo | exige | gosta |
|---|---|---|
| `plano` | raciocinio | contexto, ferramentas |
| `codigo` | codigo | ferramentas, contexto |
| `backend` | codigo | raciocinio, ferramentas |
| `ui` | texto | codigo, ferramentas |
| `auditoria` | codigo | raciocinio, contexto |
| `qa` | codigo | raciocinio |
| `revisao` | raciocinio | contexto, ferramentas |
| `texto` | texto | raciocinio |
| `investigar` | texto | raciocinio, contexto |
| `visao` | visao | texto |
| `rapido` | rapido | barato |

Ordenação: preferido do agente (se configurado) → etiquetas → ferramentas → preço → contexto →
latência média real registada. O resultado é uma **cadeia** de até 4 candidatos.

Fallback: passa ao seguinte quando o erro é `limite`, `avaria`, `tempo`, `rede`, `modelo` ou
`credito`; em `chave` recusada também passa (mas não repete o mesmo par). Cada tentativa fica em
`orbita_ai_uso`. Orçamento por execução: 16 chamadas e 160 mil tokens por omissão.

## 4. Agentes

`AGENTES` em `api/_ia/agentes.mjs`, numerados 01–08 como no escritório: Orchestrator, Research,
UI/UX Designer, Frontend Developer, Backend Engineer, QA Engineer, Creative Specialist, Reviewer.
Cada um tem instruções próprias, **lista fechada de ferramentas** e critérios de conclusão. O
servidor recusa ferramentas fora da lista — não é o prompt que decide.

## 5. Ferramentas

| ferramenta | faz | destrutiva |
|---|---|---|
| `mesa_resumo` | números reais | não |
| `leads_listar` | lista leads | não |
| `lead_criar` | cria com dedupe nome+cidade | não |
| `lead_actualizar` | estado/notas | não |
| `projetos_listar` / `projeto_criar` | projetos | não |
| `mensagem_rascunhar` | rascunho, nunca envio | não |
| `receita_registar` | entrada de dinheiro | não |
| `receita_apagar` | apaga | **sim — exige aprovação** |

Declaradamente **indisponíveis** nesta arquitectura: pesquisa web, execução de código, ficheiros
do workspace, geração de imagens, navegação de sites. Aparecem na interface com a razão.

## 6. Segurança

- Chaves só no ambiente da Vercel. `/ia/estado` devolve o **nome** da variável e uma máscara
  (`sk-or-…a1b2`). Há um teste que falha se a chave aparecer numa resposta.
- Google recebe a chave em cabeçalho, nunca em `?key=` (não fica em logs de URL).
- Argumentos de ferramentas validados contra o esquema antes de tocar na base.
- `/ia/chat` limita a mensagem a 8000 caracteres; `/ia/runs` a 2000; histórico a 8 mensagens.
- Auditoria: cada passo e cada pedido ficam registados (fornecedor, modelo, ms, tokens, erro).
  O conteúdo não é guardado no uso — só no passo, que é o resultado do trabalho.
- RLS fechado nas quatro tabelas novas; só `service_role` lê.

## 7. Limitações conhecidas

1. **Não há login ainda.** O `/api` é público (declarado no CHANGELOG 1.17.0). Até haver Supabase
   Auth, qualquer pessoa com o endereço pode escrever. É o próximo passo, e é maior que esta
   entrega.
2. **Sem streaming de tokens.** A função da Vercel corre o trabalho e a mesa acompanha por
   *polling* a cada 2,5 s (o que se vê são passos reais gravados na base, não uma animação).
   O streaming SSE ficaria pendurado no fim da função — a arquitectura escolhida foi a de 1.17.0.
3. **A execução vive dentro de um pedido HTTP.** Se o browser fechar, o pedido pode ser cortado;
   os passos já gravados ficam, o resto não corre. Cancelar é verificado entre passos.
4. **Sem ferramentas de sistema.** Não há shell, ficheiros nem browser no servidor: frontend e
   backend produzem código e planos, não aplicam alterações.
5. **Custos.** Modelos `:free` do OpenRouter contam para uma quota comum de 50/dia (1000/dia com
   $10 de crédito). Uma execução de 6 passos gasta ~6–12 pedidos — ou seja, 4 a 8 execuções por
   dia com uma chave gratuita. Acima disso, ou se paga, ou se distribui por fornecedores.
6. **`gemini`**: fora do UK/CH/EEE os dados podem ser usados para treino. Não usar dados de
   clientes com o plano gratuito.
7. **A verificação de modelos é a do fornecedor.** O catálogo sugere ids; a lista verdadeira vem
   de `POST /ia/modelos/descobrir`. Um id antigo devolve `modelo` no router e cai para o seguinte.

## 8. Como provar que funciona

```bash
# 1. há base?
curl -s https://orbita-agentes.vercel.app/api/health

# 2. que fornecedores estão configurados? (nomes, nunca chaves)
curl -s 'https://orbita-agentes.vercel.app/api/rpc?caminho=/ia/estado'

# 3. teste REAL de um fornecedor (faz dois pedidos)
curl -s -X POST https://orbita-agentes.vercel.app/api/rpc \
  -H 'content-type: application/json' \
  -d '{"caminho":"/ia/testar","metodo":"POST","corpo":{"fornecedor":"openrouter"}}'

# 4. um trabalho de ponta a ponta
curl -s -X POST https://orbita-agentes.vercel.app/api/rpc -H 'content-type: application/json' \
  -d '{"caminho":"/ia/runs","metodo":"POST","corpo":{"objetivo":"resumir os leads e criar o projeto do Café Central"}}'
```

Na interface: **Mesa → IA**. O botão «Testar» de cada fornecedor faz o mesmo que o passo 3.

## 9. Variáveis de ambiente (Vercel → Production e Preview)

Obrigatórias para a base (já criadas pela integração Supabase): `SUPABASE_URL`,
`SUPABASE_SECRET_KEY`.

Pelo menos uma para a IA:

```
OPENROUTER_API_KEY=      # recomendada: uma chave, muitos modelos, plano gratuito
GROQ_API_KEY=            # alternativa rápida
GOOGLE_AI_API_KEY=       # alternativa multimodal
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
HF_TOKEN=
NVIDIA_API_KEY=
AI_GATEWAY_API_KEY=
ANTHROPIC_API_KEY=       # pago
OPENAI_API_KEY=          # pago
DEEPSEEK_API_KEY=        # pago (barato)
```

Nunca `NEXT_PUBLIC_`/`VITE_` nestas variáveis: isso mete-as no bundle do browser.

## 10. Desenvolvimento local

```bash
cd agents-office-main
npm ci
npm test            # inclui ia.test.mjs (30 provas, com fornecedor falso — sem rede)
node serve.mjs      # a mesa local; a IA continua a precisar do /api na Vercel
```

O modo local da mesa (`localStorage`) mostra o Control Center em cinzento com a razão: as chaves
não existem no browser, e não devem existir.


## 11. Estado real da ligação (27 out 2026)

| passo | resultado em produção |
|---|---|
| esquema SQL | aplicado por `/api/setup` (temporário, já apagado); 10 tabelas, smoke de escrita/leitura/limpeza `true` |
| credencial | **nenhuma chave de fornecedor**; o AI Gateway usa o token OIDC do próprio deployment |
| pedido real | o Gateway autenticou e recusou: *«requires a valid credit card on file»* |
| trabalho completo | `run 52f24794…` → `falhou`, com a frase do fornecedor e os dois modelos da cadeia; zero passos inventados |

Para o motor arrancar é preciso **uma** destas coisas:

1. **Cartão na conta Vercel** → desbloqueia os $5/mês de crédito do AI Gateway (nenhuma chave).
2. **Chave de um fornecedor sem cartão** → `GROQ_API_KEY` (a mais rápida de obter),
   `GOOGLE_AI_API_KEY`, `CEREBRAS_API_KEY` ou `OPENROUTER_API_KEY`. Depois: `Mesa → IA → Testar`.

O token OIDC nunca é guardado: `api/_env.mjs` copia-o para o ambiente **daquele pedido** e o
`/ia/estado` só mostra o nome da variável e a máscara.

---

## 12. 1.19.0 · fornecedores do freellmapi

O `freellmapi-main.zip` (MIT) trazia 49 adaptadores e uma tabela de modelos com
limites. Em vez de copiar código, um extractor lê-o e gera o catálogo:

```bash
unzip freellmapi-main.zip -d /tmp
node scripts/extrair-freellmapi.mjs /tmp/freellmapi-main
# fornecedores: 72 · modelos: 116 · keyless: kilo, ovh
```

| o que | onde |
|---|---|
| extractor | `scripts/extrair-freellmapi.mjs` |
| resultado (gerado) | `api/_ia/catalogo-extra.json` |
| junção no catálogo | `api/_ia/catalogo.mjs` (`familia: 'freellmapi'`) |

- **76 fornecedores, 146 modelos** no total (11 + 72 do freellmapi, menos os
  repetidos; 30 + 116 modelos).
- **Sem chave**: `kilo` (Kilo Gateway, 200 pedidos/hora por IP) e `ovh` (OVH AI
  Endpoints, ~2 pedidos/min por IP). Ficam «prontos» — e **por testar** até um
  pedido real.
- **Não utilizáveis por este cliente** (21): dialeto próprio (Cohere, AI Horde,
  ACLIDE, Moondream, Sail, os seis de pesquisa — Tavily, Brave, Exa, Firecrawl,
  Linkup, Parallel) ou base que o código dele não declara. Aparecem na interface
  com a razão; não entram no router.
- Aviso que fica escrito: a documentação do Kilo diz que prompts e respostas
  podem ser usados para treino. Não é sítio para dados de clientes.

## 13. 1.19.0 · memória (plugins do Graft)

| skill do Graft | o que existe aqui |
|---|---|
| `graft-init` | estado da memória no Control Center (`/ia/estado` → `memoria`) |
| `recall` | `memoria_procurar` + `POST /ia/memoria/procurar` (lexical) |
| `memoryze` | `memoria_guardar` + nota automática no fim de cada execução |
| `learn` | `POST /ia/memoria/aprender` (plano → `confirmar: true`) |
| `memory-audit` | `GET /ia/memoria/auditar` (duplicados, curtas, paradas) |
| `graft` (ciclo) | o orquestrador consulta antes de planear e escreve no fim |

O que **não** existe: embeddings, grafo, daemon, perfis, o modelo de 600 MB. A
procura é por palavras e a resposta diz `modo: 'lexical'`.

Tabela: `orbita_ai_memoria` (RLS fechado, grants revogados a `anon`/`authenticated`).

## 14. 1.19.0 · estúdio de media (OpenMontage)

Ver `docs/OPENMONTAGE.md`. Resumo: fila em `orbita_media_jobs`, worker com
`MEDIA_WORKER_TOKEN`, `scripts/estudio-worker.mjs` a correr onde há Python +
FFmpeg + Node, e o OpenMontage **por fora** do repositório (AGPL-3.0).

Sem worker, um trabalho fica `indisponivel` com a razão — nunca «concluído».

## 15. 1.19.1 · o que a produção ensinou

Testar contra a Vercel e o Supabase reais (27 out 2026) desmentiu três certezas
do 1.19.0. Ficam escritas para não voltarem:

| o que o código dizia | o que a produção disse | o que mudou |
|---|---|---|
| «keyless está pronto» | estava pronto no estado e **fora** do router: `fornecedorActivo()` exigia chave | keyless entra na cadeia por direito próprio |
| «o Kilo é anónimo, 200 req/h» | `403 — You need to sign in to use this model` | `keyless: false`, nota e limite corrigidos |
| «o OVH serve sem chave» | verdade, mas o catálogo não tinha **nenhum** modelo dele | 9 modelos de chat vindos de `/v1/models` (lista real, sem ids inventados) |

O que ficou provado com pedidos reais:

- **OVH AI Endpoints, sem chave**: 22 modelos listados, resposta em ~0,8 s,
  marcado `funcional` pelo `/ia/testar`.
- **Vercel AI Gateway por OIDC**: o token é aceite como autenticação (aparece
  mascarado), mas o Gateway recusa servir sem cartão:
  `AI Gateway requires a valid credit card on file`.
- **Registo de uso**: as tentativas falhadas ficam em `orbita_ai_uso` com o erro
  e a latência — a interface não inventa métricas.
- **Limite dos keyless**: o OVH limita por IP (~2 pedidos/min). Chega para
  provar que responde; **não** chega para uma execução de vários passos. Sem
  chave própria, oito agentes não correm.

O esquema foi aplicado em produção por um endpoint temporário
(`/api/setup`, protegido por token, já removido): `orbita_ai_memoria` e
`orbita_media_jobs` existem na base, e `orbita_ai_uso` já tem linhas reais.

## 16. 1.49.0 · Mem0 — a memória passou a ter duas camadas

Até aqui a memória da Órbita era uma só: notas na tabela `orbita_ai_memoria`,
procuradas **por palavras** (`modo: 'lexical'`). Funcionava e dizia o que era.
Faltava-lhe o que os embeddings dão: encontrar «prefere respostas curtas» quando
se procura «como escrever no ecrã».

A partir desta versão há duas camadas, e nenhuma delas mente sobre a outra:

| camada | onde | quando responde | o que custa |
|---|---|---|---|
| local | `orbita_ai_memoria` | sempre, mesmo sem rede | nada |
| Mem0 | `api.mem0.ai` | quando há `MEM0_API_KEY` | pedidos ao fornecedor |

**Leitura.** `procurar()` soma as duas. Se o Mem0 responder, `modo` é
`'mem0+lexical'` e cada achado traz `origem: 'mem0'` ou `'origem': 'local'` —
a nota que vier nas duas fica uma vez só. Se o Mem0 falhar, `modo` volta a
`'lexical'` e `mem0.motivo` diz o que aconteceu (401, 429, tempo esgotado,
`ECONNRESET`). O Orchestrator passa a escrever no prompt de planeamento se a
memória que recebeu foi «por sentido» ou «por palavras».

**Escrita.** `guardar()` grava localmente **primeiro** e só depois empurra para o
Mem0 (`infer: false`: o texto fica como está, sem extracção por LLM). Se o Mem0
recusar, a nota está guardada e a resposta diz `mem0: { ok: false, motivo }`.
Uma memória remota em baixo não pode perder uma nota.

**O que entra no prompt** continua a ser pouco de propósito: 5 notas, 300
caracteres cada. Memória a mais é contexto a menos para o trabalho.

### Rotas

| rota | o que faz |
|---|---|
| `GET /ia/memoria` | estado das duas camadas: `modo`, `camadas`, `mem0` com a chave mascarada |
| `POST /ia/memoria` | guarda uma nota (local e Mem0), devolve as duas respostas |
| `POST /ia/memoria/procurar` | procura nas duas camadas; `modo` diz qual respondeu |
| `POST /ia/memoria/importar` | lote para o Mem0 — sem `confirmar: true` só devolve o plano |
| `DELETE /ia/memoria/mem0:<id>` | apaga a memória semântica (o resto apaga a nota local) |

### Configuração

Só ambiente, nada na base:

| variável | obrigatória | para quê |
|---|---|---|
| `MEM0_API_KEY` | sim, para ligar | a chave; sem ela a memória é lexical |
| `MEM0_BASE_URL` | não | `https://api.mem0.ai` por omissão |
| `MEM0_ORG_ID` | não | vai em `X-Org-Id` (diagnóstico) |
| `MEM0_PROJECT_ID` | não | vai em `X-Project-Id` (diagnóstico) |
| `MEM0_USER_ID` | não | espaço de nomes; `orbita` por omissão |

A chave nunca sai do servidor: o Control Center mostra `m0-F…T149`, o mesmo tipo
de máscara que já se usa para os outros fornecedores.

### Importar o que já existe

Duas portas, ambas com o mesmo formato (`[{ memory, metadata }]`, o que o
`openclaw mem0 import` também lê):

- **do workspace do OpenClaw** — `mem0-import/construir-import.mjs` lê
  `~/.openclaw/workspace/{SOUL,IDENTITY,USER,MEMORY}.md` e os diários dos últimos
  30 dias e escreve `/tmp/mem0_import.json`; `mem0-import/enviar-para-orbita.mjs`
  envia-o para `POST /ia/memoria/importar` da Órbita.
- **das notas locais** — botão «Enviar as notas para o Mem0» no Control Center
  (`{ origem: 'locais', confirmar: true }`).

### O que continua a não existir

- **Não há grafo de ligações** nem daemon: o Mem0 é um índice semântico, não um
  grafo de conhecimento.
- **Não há captura automática** de tudo o que se escreve na mesa. As notas entram
  no fim de cada execução concluída e quando o dono as escreve — nada mais.
- **Não há deduplicação semântica local**: o duplicado exacto é recusado, o
  «quase igual» não. É o Mem0 que funde o que lá chega (`infer: true`), e nós
  enviamos com `infer: false` de propósito.

### Provar de fora, não acreditar no ping

`GET /api/prova-mem0?token=<PROVA_TOKEN>` faz a volta completa em produção:
escreve uma nota marcada, procura-a por sentido (até três tentativas, porque o
índice do Mem0 não é instantâneo), confirma que voltou e **apaga-a** — no Mem0 e
na base local. Devolve `escrita`, `procura`, `apagada` e `resultado`, com o
motivo exacto quando algo falha. Sem o token responde 404, como a `prova1`.

## 17. 1.50.0 · escolher a IA, e um erro que não mente

### O que estava errado

O escritório publicado na Vercel é a página estática (`dist/index.html`). A
Vercel serve `/api/health` (função a sério) mas **não** serve `/api/tasks` nem
`/api/chat` — essas só existem no `serve.mjs`, no computador do dono. O código
perguntava `/api/health`, via `ok:true`, marcava o escritório como «ao vivo», e
depois fazia `res.json()` sobre a página de erro em HTML. O erro aparecia como

> «Não foi criada: Unexpected token 'T', "The page c"... Sem um motor de IA
> ligado, o escritório não finge que a tarefa existe.»

Duas coisas erradas: a rota não existia, e a IA existe (na mesa, com seis
fornecedores prontos naquele momento).

### Como está agora

`src/falhas.js` decide a frase a partir do que veio (HTML/JSON/status). Nunca
diz «sem motor» a menos que o servidor o tenha dito. A barra confirma
`GET /api/tasks` antes de prometer o escritório; sem essa rota, o selo diz
`SEM SERVIDOR LOCAL` (ou `MESA · n FORNECEDOR(ES)` quando a mesa responde) e
qualquer tentativa de criar trabalho explica o que fazer e onde.

### Escolher a IA

| onde | o que dá para escolher | como fica guardado |
|---|---|---|
| Mesa → AI → Conversa | agente + modelo do catálogo real, por mensagem | «Fixar para o agente» → `PATCH /ia/config` |
| `POST /ia/chat` | `fornecedor` + `modelo` (validados) | nada: vale para essa mensagem |
| Barra de tarefas (servidor local) | motor CLI/API (TESTAR/USAR) e gratuitas | `data/ai.json` |
| Barra de tarefas (sem servidor) | leitura da IA da Órbita via `/api/rpc` | na mesa |

`POST /ia/chat` recusa com `400` um modelo fora do catálogo (e devolve a lista
do fornecedor) ou um fornecedor desconhecido; se só vier o modelo, o fornecedor
é resolvido pelo catálogo — e um nome que exista em dois fornecedores pede que
se diga qual. A resposta traz sempre `fornecedor`, `modelo` e `pedido`, para a
interface poder mostrar quem respondeu de facto (o fallback pode escolher outro).
