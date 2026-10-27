# A plataforma — as APIs reais, e a máquina onde o escritório corre

Este documento existe por causa de uma frase do dono:

> *«implementa entrada de API real — assim que lançar o projecto, colocar a API já deve funcionar de
> forma automática; faz esse preparo agora, para todos os tipos de app, as APIs devem funcionar logo,
> instantaneamente.»*

A resposta está em `platform.mjs` e nas três rotas `/api/platform*`. O princípio é o mesmo do resto do
projecto: **nada de simulação**. Um serviço só é «pronto» depois de uma chamada real ter respondido;
quem não tem chave aparece com o **nome exacto da variável que falta**.

---

## 1 · O que acontece no arranque

Exemplo de arranque (esta máquina, 28 out 2026 — com a rede do contentor a bloquear as sondas, que
é justamente o caso onde a mensagem tem de ser útil):

```
node serve.mjs
  api: criei ORBITA_API_TOKEN (43 caracteres) em .env — as rotas privadas já funcionam
  máquina: Linux 6.8.0 · x64 · 8 núcleos · 31.3 GB · node v22.22.3 · shell /bin/bash
  plataforma: 0 de 27 API(s) prontas · 1 com chave · falta configurar: AIRTABLE_TOKEN, … (+25) → /api/platform
```

1. **O token interno nasce sozinho** se não existir (`ensureApiToken`): 256 bits em base64url, 43
   caracteres, escrito no `.env` com permissões `600` e uma linha de comentário que explica de onde
   veio. Se já houver um token — no ambiente ou no ficheiro — não se toca em nada. Isto é o que faz
   as rotas privadas (email, deploy, CRM, Instagram) funcionarem **à primeira**, sem passos manuais.
2. **O `.env` é lido** por dois leitores próprios que já existiam (`config.mjs` e
   `integrations.mjs`) e agora também pelo `platform.mjs`, que não presume nada: relê o ficheiro e
   sabe exactamente que chaves estão preenchidas.
3. **As sondas correm em segundo plano**, quatro de cada vez, com 6 s de prazo. O servidor não fica
   à espera delas para aceitar pedidos.
4. **O ficheiro é vigiado.** Gravar o `.env` com uma chave nova é o mesmo que reiniciar — sem
   reiniciar:

```
  plataforma: .env mudou (RESEND_API_KEY) — chaves recarregadas e serviços sondados de novo
```

---

## 2 · O catálogo (27 serviços)

| Tipo | Serviços | Sonda |
|---|---|---|
| IA | OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, Hugging Face, Replicate, ElevenLabs | `GET` de metadados/conta |
| Dados | Google Places/Geocoding, Google Programmable Search | uma pesquisa de 1 resultado |
| Base de dados | Supabase, Airtable, Notion | `whoami` / raiz REST |
| Código e deploy | GitHub, Vercel, Cloudflare, **AWS** | conta, `tokens/verify` |
| Pagamentos e loja | Stripe, Shopify Admin | saldo, `shop.json` |
| Mensagens e redes | Resend, SendGrid, Twilio, Telegram, Slack, Discord, Meta/Instagram | conta, `getMe`, `auth.test` |

**AWS não tem sonda barata** (assinatura SigV4 exige região): aparece como *configurada* e
*verificada: false*, e diz isso na nota. Preferimos uma meia-verdade escrita a uma mentira completa.

Cada serviço devolve, em `/api/platform`:

```json
{ "id": "github", "name": "GitHub", "kind": "codigo",
  "configured": true, "ready": true, "verified": true,
  "missing": [], "status": 200, "latencyMs": 118,
  "checkedAt": "2026-10-28T10:12:44.190Z", "error": null, "note": "" }
```

`configured` = as variáveis existem. `verified` = a sonda respondeu agora (10 min de validade).
`ready` = verificado **ou** configurado sem sonda possível.

### Nenhuma chave sai do processo

As mensagens de erro passam por `redactValue`: qualquer valor de ambiente com 8+ caracteres é
substituído por `***` antes de sair no JSON. Há um teste dedicado a isto (`platform.test.mjs`), com o
pior caso — um serviço que devolve a chave dentro do texto do erro.

---

## 3 · Para todos os tipos de app: `data/api/providers.json`

O catálogo cobre o que é comum. O que não estiver lá entra por ficheiro, sem tocar em código:

```json
[
  {
    "id": "meu-crm",
    "name": "CRM da casa",
    "kind": "crm",
    "env": ["MEU_CRM_TOKEN"],
    "docs": "https://crm.exemplo.pt/docs",
    "probe": { "url": "https://crm.exemplo.pt/api/me", "header": "Authorization", "prefix": "Bearer " }
  }
]
```

Regras: `id` (minúsculas, `a-z0-9-_`), `name`, `env` (uma ou mais variáveis — **todas** têm de
existir), `probe` opcional. Entradas inválidas são ignoradas; nunca rebentam o arranque. Máximo de 60
serviços.

Assim, uma app de contabilidade, uma loja, um CRM interno ou um serviço que ainda não existe no
catálogo entram pelo mesmo caminho: uma chave no `.env`, uma entrada no JSON, e aparece no retrato da
plataforma como qualquer outro.

---

## 4 · As rotas

| Método | Rota | Autenticação | Para quê |
|---|---|---|---|
| GET | `/api/platform` | nenhuma | tudo: máquina, versões, APIs, rotas, token |
| GET | `/api/platform/apis` | nenhuma | só o estado dos serviços |
| POST | `/api/platform/reload` | `Bearer ORBITA_API_TOKEN` | reler o `.env` e sondar tudo outra vez |
| POST | `/api/platform/probe` | `Bearer ORBITA_API_TOKEN` | forçar sondas sem tocar no `.env` |

As duas `GET` respondem com:

```
access-control-allow-origin: *
access-control-allow-headers: content-type, authorization
cache-control: no-store
```

Ou seja: **qualquer app** (uma página web noutro domínio, um telemóvel, outro servidor) pode perguntar
«com que contas eu conto?» no arranque dela. As rotas que escrevem para fora continuam a exigir o
token e **não** abrem CORS.

```bash
curl -s localhost:4520/api/platform | jq '.machine.os, .apis.summary'
curl -s localhost:4520/api/platform/apis | jq '.list[] | select(.ready) | .name'
```

---

## 5 · A máquina

`/api/platform` → `machine` traz o que o processo vê, não o que se supõe:

```json
{ "os": "Linux 6.8.0", "arch": "x64", "cores": 8, "cpu": "AMD Ryzen 7 …",
  "memoryGB": 31.3, "freeGB": 12.1, "uptimeH": 4.2,
  "node": "v22.22.3", "shell": "/bin/bash", "pid": 4242,
  "tz": "Europe/Lisbon", "locale": "pt-PT",
  "tools": [{ "name": "git", "found": true, "path": "/usr/bin/git", "version": "git version 2.43" }] }
```

As ferramentas procuradas são: `git`, `gh`, `node`, `npm`, `python3`, `docker`, `claude`, `codex`,
`gemini`, `rg`, `curl`, `ffmpeg`, `sqlite3` — com a versão que cada uma declara (e `null` quando não
a diz depressa). Windows usa `where`; o resto, `which`. O resultado é guardado 5 minutos.

É isto que o terminal mostra com `:maquina`, e é o que faz o terminal ser **da máquina** em vez de ser
igual em todo o lado.

---

## 6 · O terminal

| Comando | O que faz |
|---|---|
| `:help` | três linhas, as que se usam |
| `:comandos` | a lista completa |
| `:ls` | o catálogo de ferramentas da oficina, por sala |
| `:forge <sala> <necessidade>` | a oficina forja, prova e mostra ao vivo |
| `:run <sala> <id> [{"json"}]` | corre e mostra o resultado real |
| `:adopt` · `:activate` · `:eventos` | adoptar, aprovar, ver o registo |
| `:maquina` | SO, arquitectura, memória, node, shell, PATH |
| `:api` | serviços prontos, falhados, e a chave que falta |
| `:limpar` | limpa o ecrã |

`Tab` completa o comando; `↑` `↓` percorrem o histórico e o rascunho a meio volta com `↓`. Ao abrir, o
terminal escreve uma linha com a máquina (`Linux 6.8.0 · x64 · 8 núcleos · node v22.22.3 · shell
/bin/bash`) — uma vez por sessão.

---

## 7 · Limites declarados

- **A chave de terceiros é do dono.** O que ficou automático é o token interno, a leitura do `.env`,
  as sondas, o diagnóstico e o recarregamento a quente. Sem chave da Gemini não há Gemini; o que passa
  a haver é o nome exacto do que falta.
- **A sonda prova a chave, não o plano.** Um 200 do Stripe diz que a chave é válida; se a conta está
  em modo de teste ou sem saldo, isso só se sabe ao usar.
- **`ready` envelhece.** Uma sonda vale 10 minutos; depois disso o serviço volta a «não verificado»
  até a próxima. É melhor do que mostrar um verde eterno.
- **Serviços com OAuth de utilizador** (Instagram com conta profissional, Slack com scopes) podem
  responder 200 na sonda e falhar na publicação por falta de permissão. A nota de cada serviço em
  `integrations.mjs` continua a ser a verdade sobre isso.
- **Sem `chokidar`**: o vigia usa `fs.watchFile` (1 s de intervalo). Funciona em Linux, macOS e
  Windows; em sistemas de ficheiros de rede pode não disparar — nesse caso, `POST
  /api/platform/reload` faz o mesmo à mão.

## 8 · Quando uma sonda falha (o que a mensagem quer dizer)

O erro de uma sonda traz o código da causa, não só «falhou»:

| erro | quem é | o que fazer |
|---|---|---|
| `HTTP 401 Unauthorized` | a chave está errada ou foi revogada | gerar outra no painel do serviço |
| `HTTP 403 Forbidden` | a chave existe mas não tem aquele scope | dar permissão à chave, não a trocar |
| `sem resposta em 6 s` | o serviço não respondeu no prazo | tentar outra vez; ver firewall/proxy |
| `fetch failed: ENOTFOUND` | o DNS não resolve o nome | ver a rede da máquina |
| `fetch failed: UNABLE_TO_VERIFY_LEAF_SIGNATURE` | há um proxy a interceptar TLS e o Node não confia nele | apontar `NODE_EXTRA_CA_CERTS` ao certificado do proxy **não** desligar a verificação |

Nenhuma mensagem inclui o valor da chave: o que sai com 8+ caracteres de ambiente é substituído por
`***` antes de chegar ao JSON (ou ao terminal).
