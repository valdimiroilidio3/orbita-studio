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
