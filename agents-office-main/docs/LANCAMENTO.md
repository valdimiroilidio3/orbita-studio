# O lançamento — o que está publicado, como se publica, e o que falta

**Endereço:** <https://orbita-agentes.vercel.app>
**Projeto Vercel:** `orbita-agentes` · equipa `orbita-projetos` · `prj_nPSo2eo8WQ1TzVqZC4CmadWNkFv3`
**Repositório:** `valdimiroilidio3/orbita-studio` · **ramo de produção:** `main`
**Construção:** `npm ci` → `node build.mjs` → publica `dist/` · **funções:** `api/*.mjs`
**Versão publicada:** ver `/api/health` → `versao` (fonte única: `package.json`)

---

## 1 · O que aconteceu (e porque este documento existe)

A 28 de outubro de 2026, a produção estava na **1.29.0** — commit `3c00e5b`, merge do PR #59 —
enquanto o repositório já ia na 1.40.0. Os treze merges seguintes criaram **previews**
(`target: null`) e nenhum promoveu produção. O site público mostrava a versão antiga: o rodapé
dizia «1.0.0», o botão «afastar» era o quadrado pequeno, e quem abrisse o link via um produto
diferente do que estava no `main`.

**Corrigido:** produção promovida a partir do `main` (`dpl_FxyiKUq7cLVPokm5SmDyDb4ryc6A`, commit
`4e71164`) e depois novamente na 1.41.0. A prova não é este texto — é o `/api/health`:

```bash
curl -s https://orbita-agentes.vercel.app/api/health | jq
# { "ok": true, "base": "dpfq…", "faltam": [], "modo": "base", "versao": "1.41.0", … }
```

> **Lição:** um merge em `main` não é um lançamento até o `/api/health` dizer a versão nova.
> É por isso que a 1.41.0 põe a prontidão e a versão dentro da própria saúde.

---

## 2 · Publicar (o item 1)

Há dois caminhos. O segundo é o que se usa quando a integração Git falha em promover:

```bash
# A · pelo Git (o normal): merge em main → o Vercel constrói e promove
git checkout main && git pull
# … e confirmar, sempre:
curl -s https://orbita-agentes.vercel.app/api/health | jq '.versao'

# B · forçar uma produção a partir do main (quando o Git só criou previews)
#    Vercel → Project → Deployments → ⋯ → "Create deployment" → branch main → Promote
#    ou, por API, um deployment com target=production e git ref=main
```

**Depois de publicar, três provas em 30 segundos:**

| prova | comando | esperado |
|---|---|---|
| a versão certa | `/api/health` | `versao` = a do `package.json` |
| o `/api` responde | `/api/rpc?caminho=/ops/summary` | `{"status":200, "modo":"base"}` |
| a prontidão | `/sistema/prontidao` (via `/api/rpc`) | `pronto: true` ou a lista do que falta |

---

## 3 · O `/api` em produção (o item 2)

Na Vercel, uma função de `api/` só responde no caminho exato do ficheiro. Por isso **não existe**
`/api/ops/summary`: a mesa manda o caminho dentro do pedido.

```http
POST /api/rpc            { "caminho": "/ops/leads", "metodo": "POST", "corpo": { … } }
GET  /api/rpc?caminho=/ops/summary          (só leitura)
GET  /api/health                            (prova pública)
GET  /api/rpc?caminho=/sistema/prontidao     (o que falta para lançar)
GET  /api/setup?token=…                      (aplica o esquema — apaga-se depois)
```

**Defeito corrigido na 1.41.0:** sem `SUPABASE_URL`/`SUPABASE_SECRET_KEY`, o `/api/health` rebentava
com `ReferenceError: Cannot access 'ia' before initialization` (usava `ia` no ramo de erro e só o
declarava seis linhas abaixo). Em produção isso era um **500 da Vercel** em vez do 503 explicativo.
Um teste chama agora o handler com o ambiente vazio e exige o 503.

---

## 4 · O esquema da base (o item 3)

**Estado real:** aplicado. O `/api/health` devolve `faltam: []`, e a saúde passou também a provar as
**colunas** do envio (`subject`, `to`, `from`, `provider`, `enviada_at`, `recebida_at`) — um
`select` das colunas certas, sem escrever nada. Sem isso, o `SELECT *` respondia 200 e o `INSERT`
rebentava com 400 («column does not exist»), que foi exatamente o defeito de 27 de outubro.

**Como se aplica, pela ordem certa** (a ordem é o contrato — dois ficheiros criam a mesma tabela):

```bash
# no painel do Supabase: Database → SQL Editor, ou pela rota de bootstrap
curl -s "https://orbita-agentes.vercel.app/api/setup?token=$SETUP_TOKEN" | jq

# 1 · orbita_mesa.sql      as tabelas que a aplicação USA
# 2 · orbita_ia.sql        as tabelas da IA
# 3 · orbita_1_37_0.sql    as colunas do envio e das respostas
```

**O que NÃO se aplica:** `orbita_schema.sql`. É o desenho da migração do SQLite (diz isso na
primeira linha) e define `orbita_leads` com `company_name`/`lead_status` — incompatível com a mesa
(`name`/`status`). Se corresse primeiro, o `create table if not exists` seguinte era ignorado em
silêncio e a mesa ficava sem as colunas que usa. A rota devolve esta lista em `naoAplicados`, com a
razão, para ninguém «corrigir» isto por engano.

**Depois de aplicar, apaga-se o `SETUP_TOKEN` na Vercel.** A rota passa a responder 404 para todos.

---

## 5 · As variáveis (o item 4)

Uma só lista, três sítios onde se lê: `npm run prontidao` (terminal), `/api/health` (resumo),
`/sistema/prontidao` (completo). **Nunca** mostram valores — só nomes.

```bash
npm run prontidao          # imprime a lista e sai com 1 se faltar algo CRÍTICO
npm run prontidao -- --json
```

| grupo | crítico? | o que se perde sem ela |
|---|---|---|
| **Base de dados** `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (ou `…_SERVICE_ROLE_KEY`) | sim | a mesa guarda no browser e perde tudo ao fechar o separador |
| **Acesso** `ORBITA_API_TOKEN` (≥32) + `ORBITA_ADMIN_TOKEN` | sim | qualquer pessoa com o endereço manda no escritório e gasta as chaves |
| **Esquema** `SETUP_TOKEN` + `DATABASE_URL` (ou `POSTGRES_URL`) | sim | a base existe mas sem tabelas; o `/api/health` responde 503 |
| **Pesquisa** `TAVILY_API_KEY` + `GEOAPIFY_API_KEY` | não | não há prospeção nem leads reais |
| **Correio** `RESEND_API_KEY` + `ORBITA_FROM_EMAIL` + `RESEND_WEBHOOK_SECRET` | não | as mensagens ficam à espera e nunca saem |
| **WhatsApp** `WHATSAPP_TOKEN`, `_PHONE_ID`, `_APP_SECRET`, `_VERIFY_TOKEN` | não | abre na app e confirma-se à mão |
| **IA** uma de `OPENROUTER/GROQ/GOOGLE_AI/…` | não | arranca na cadeia gratuita (LLM7, OVH, Pollinations) |
| **OCR** `ORBITA_OCR_URL` | não | a digitalização diz que falta o serviço, em vez de inventar campos |

**Defeito corrigido na 1.41.0:** o código usava **dois nomes** para o remetente do correio —
`integrations.mjs` exigia `ORBITA_EMAIL_FROM` (e o painel dizia «ligado») enquanto o envio real lia
`ORBITA_FROM_EMAIL` e caía em `onboarding@resend.dev`. Agora há uma função só (`remetente()`), que
aceita os dois nomes, e o painel e o envio passam a concordar. O mesmo para a chave do Supabase,
que o painel só reconhecia como `SUPABASE_SERVICE_ROLE_KEY`.

**Nota sobre a conta:** existem hoje na Vercel variáveis com o **valor vazio** (`TAVILY_API_KEY`,
`GEOAPIFY_API_KEY`, `OPENCODE_API_KEY`). Um valor vazio conta como «não configurado» — é honesto,
mas convém apagá-las ou preenchê-las, para não parecer que estão feitas.

---

## 6 · O que o endereço ainda NÃO é

- **Sem domínio próprio.** É `…vercel.app`. Um domínio é um clique em *Domains* depois do DNS.
- **Sem contas de utilizador na nuvem** para além do token: `ORBITA_ADMIN_TOKEN` fecha a porta, mas
  não há papéis por pessoa. As contas vivem no servidor local (`/app`).
- **A imagem de partilha** (`og.png`) é desenhada pelo rasterizador do repositório: mostra a planta
  real, não um render de marketing.
- **O tamanho das salas** aplica-se no arranque seguinte — a geometria não se reescala a meio sem
  partir as portas, e o painel diz isso.

## 7 · O que continua a ser teu

1. Preencher as chaves que faltam (pesquisa, correio, WhatsApp) — tabela do §5.
2. Verificar o domínio do remetente no Resend.
3. Apagar o `SETUP_TOKEN` depois de o esquema estar aplicado.
4. Ligar um domínio próprio, se quiseres deixar de escrever `vercel.app`.
