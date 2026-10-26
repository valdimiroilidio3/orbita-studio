# Integrações do Órbita Studio

Uma ponte HTTP, autenticada por token, entre o Órbita e os serviços de fora. A lógica vive em
`integrations.mjs` (Node puro, sem dependências); o servidor em `src/server.mjs` só lhe põe um
cabeçalho de segurança por cima: token, limite de pedidos, corpo máximo e aprovação explícita para
tudo o que sair para o mundo.

**Nada é reportado como «ligado» só porque o código existe.** `GET /v1/status` diz, serviço a
serviço, se há chave (`configured`) e se está realmente pronto (`ready`), com uma nota em português
a explicar o que falta. Sem chave, a rota responde `503` com a razão — nunca inventa resultados nem
finge um envio.

## Arrancar

```bash
npm ci                      # instala o esbuild (só para o build)
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# cola o resultado em ORBITA_API_TOKEN= dentro do .env
npm run build
npm run test:integrations
npm start                   # http://localhost:4530
```

Sem `ORBITA_API_TOKEN` (ou com menos de 32 caracteres) o servidor **não arranca**: falha fechado,
com a instrução exata no terminal. O `.env` é ignorado pelo git; o `.env.example` é o único que
entra no repositório.

## Quais serviços ligar

Só se liga o que se quer. Nesta versão estão **prontos sem chave** (não precisam de nada):

| Serviço | Para que serve | Nota |
|---|---|---|
| **OpenStreetMap** (Nominatim + Overpass) | descobrir empresas reais por zona e categoria | dados públicos; atribuição e políticas obrigatórias (ver abaixo) |
| **GitHub REST** (leitura) | ler metadados de repositórios | público; com `GITHUB_TOKEN` sobe o limite de pedidos |
| **Fila de conteúdo** | rascunhos locais de publicações | persiste em `data/orbita-content-drafts.json` |

E ficam **à espera de chave** (dizem que não estão prontos, com a razão):

| Serviço | Variáveis | O que ativa |
|---|---|---|
| **Supabase** (CRM) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | leads em Postgres em vez de JSON local |
| **Resend** (email) | `RESEND_API_KEY` + `ORBITA_EMAIL_FROM` | email transacional **um a um**, com aprovação |
| **Gemini** | `GEMINI_API_KEY` | assistência de escrita (`/v1/gemini/assist`) |
| **Instagram** (Meta Graph) | `META_ACCESS_TOKEN` + `META_IG_USER_ID` + `META_GRAPH_API_VERSION` | publicação **aprovada** de uma imagem |
| **Vercel Deploy Hook** | `VERCEL_DEPLOY_HOOK_URL` | deploy **aprovado** (a URL é secreta) |
| **GitHub Contents** (escrita) | `GITHUB_TOKEN` | commit de **um** ficheiro **aprovado** |

Se quiseres começar só com leads, não configures mais nada: o resto responde `503` com uma frase a
dizer o que falta, e o resto do serviço funciona.

## Variáveis de ambiente

| Variável | Obrigatória | O que faz |
|---|---|---|
| `ORBITA_API_TOKEN` | **sim** | token de 32+ caracteres para todas as rotas `/v1/*` |
| `PORT` · `HOST` | não | `4530` e `0.0.0.0` por omissão |
| `RATE_LIMIT` | não | pedidos por minuto por token (120 por omissão) |
| `ORBITA_DATA_DIR` | não | onde ficam leads, rascunhos e supressões (`./data`) |
| `OSM_NOMINATIM_URL` · `OSM_OVERPASS_URL` | não | trocar os serviços públicos por instâncias próprias |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | não | CRM em Postgres |
| `RESEND_API_KEY` · `ORBITA_EMAIL_FROM` | não | email; o remetente tem de estar verificado |
| `GEMINI_API_KEY` · `GEMINI_MODEL` | não | assistência de escrita |
| `GITHUB_TOKEN` | não | leitura autenticada e commits aprovados |
| `META_ACCESS_TOKEN` · `META_IG_USER_ID` · `META_GRAPH_API_VERSION` | não | Instagram |
| `VERCEL_DEPLOY_HOOK_URL` | não | deploy |

Nenhum valor de chave sai do servidor: nem no `/health`, nem na página inicial, nem nos erros.

## A API

Todas as rotas `/v1/*` levam o token: `-H "Authorization: Bearer $ORBITA_API_TOKEN"` (ou
`-H "x-orbita-api-token: …"`). Sem token → `401`.

| Método | Rota | O que faz |
|---|---|---|
| GET | `/` | página de estado (aberta, sem segredos) |
| GET | `/health` | vivo, versão, uptime, token configurado |
| GET | `/v1/status` | estado honesto de cada provider |
| GET | `/v1/leads?limit=` | lista de leads |
| POST | `/v1/leads` | guardar um lead ou `{"leads":[…]}` (máx. 30) |
| POST | `/v1/leads/preview` | normalizar sem gravar (validar um lote) |
| PATCH | `/v1/leads/:id` | mudar `status` e/ou `notes` |
| POST | `/v1/leads/discover` | descobrir empresas no OSM (`location`, `category`, `radiusMeters`, `limit`, `save`) |
| POST | `/v1/whatsapp/link` | link `wa.me` com texto (não envia nada) |
| POST | `/v1/gemini/assist` | `{task, data}` → texto assistido |
| POST | `/v1/email/send` | email individual **aprovado** |
| POST | `/v1/email/suppress` | pôr um email na lista de supressão |
| GET | `/v1/github/repo?owner=&repo=` | metadados de um repositório |
| POST | `/v1/github/file` | commit de um ficheiro **aprovado** |
| POST | `/v1/instagram/publish` | publicação **aprovada** |
| POST | `/v1/vercel/deploy` | deploy **aprovado** |
| GET / POST | `/v1/content` | listar / criar rascunhos |
| POST | `/v1/content/:id/published` | marcar como publicado |

### Exemplos

```bash
# descobrir dentistas em Coimbra e guardar
curl -s -X POST http://localhost:4530/v1/leads/discover \
  -H "Authorization: Bearer $ORBITA_API_TOKEN" -H 'content-type: application/json' \
  -d '{"location":"Coimbra, Portugal","category":"dentist","radiusMeters":3000,"save":true}'

# guardar um lead manual
curl -s -X POST http://localhost:4530/v1/leads \
  -H "Authorization: Bearer $ORBITA_API_TOKEN" -H 'content-type: application/json' \
  -d '{"companyName":"Barbearia Nova","website":"barbearia-nova.pt","city":"Coimbra","source":"referral"}'

# preparar a conversa de WhatsApp (não envia)
curl -s -X POST http://localhost:4530/v1/whatsapp/link \
  -H "Authorization: Bearer $ORBITA_API_TOKEN" -H 'content-type: application/json' \
  -d '{"phone":"+351912345678","message":"Olá! Falamos do site da clínica?"}'
```

Categorias aceites em `/v1/leads/discover`: `salon`, `restaurant`, `cafe`, `dentist`, `clinic`,
`hotel`, `school`, `shop`, `office`, `service`.

## A segurança, por dentro

- **Token obrigatório** e comparado em tempo constante (`timingSafeEqual`). Falha fechado no arranque.
- **Aprovação humana explícita**: email, Instagram, Vercel e commit exigem `approved: true` no corpo.
  Sem isso, `400` com a razão. Isto é uma escolha do módulo, não uma sugestão.
- **Email só um a um**: exige `recipientConsent: true`, uma `consentReference` e um `purpose` limitado a
  `requested_follow_up` ou `transactional`. Campanhas em massa estão fora, por desenho.
- **Lista de supressão**: quem pediu para não receber fica registado e o envio é recusado (`409`).
- **Limite de pedidos** (`429` + `Retry-After`) e **corpo máximo de 256 KB** (`413`).
- **Segredos só no servidor**: o `GITHUB_TOKEN`, a chave do Supabase e a URL do Deploy Hook nunca
  entram numa resposta.
- **Ficheiros com permissões apertadas**: o JSON de dados é escrito com `0600` e de forma atómica
  (ficheiro temporário + rename), para não ficar meio escrito num crash.

## OpenStreetMap: as regras

Os dados são © OpenStreetMap contributors, sob ODbL. O Nominatim público pede no máximo **1 pedido
por segundo** e um `User-Agent` identificável — o módulo já serializa os pedidos e identifica-se.
Para volume a sério, aponta `OSM_NOMINATIM_URL` e `OSM_OVERPASS_URL` para instâncias próprias.
Resultados OSM **não são uma lista exaustiva** e não provam que a empresa precise de um site:
confirma cada oportunidade antes de contactar.

## Supabase (opcional)

Sem Supabase, os leads ficam em `data/orbita-leads.json`. Para usar Postgres, cria a tabela e define
as duas variáveis:

```sql
create table if not exists public.orbita_leads (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text unique not null,
  company_name text not null,
  website text, category text, address text, city text, phone text, public_email text,
  osm_type text, osm_id text, source text not null default 'manual', source_url text,
  digital_presence text default 'unknown', lead_status text not null default 'new',
  notes text, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.orbita_leads enable row level security;
-- service-role só no servidor; nenhuma política pública
```

`dedupe_key` é único: é isso que impede duplicados (osm:id → domínio → nome+cidade).

## Testes

```bash
npm run test:integrations
```

Correm contra o servidor construído e contra o módulo, **sem rede**: um OpenStreetMap falso local
devolve o mesmo formato do Nominatim e do Overpass. Cobrem o token (ausente, curto, errado, certo),
a honestidade do `/v1/status`, a deduplicação de leads, a validação do WhatsApp, os bloqueios de
aprovação, a supressão de email, o 404/405/413/429 e o formato dos rascunhos.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| `ORBITA_API_TOKEN ausente ou demasiado curto` | falta o `.env` ou o token tem menos de 32 caracteres |
| `503 … não está configurado` | falta a chave desse serviço — é intencional |
| `429` | limite por minuto; sobe `RATE_LIMIT` ou espera |
| `401` com token válido | espaço a mais no cabeçalho, ou aspas no `.env` |
| descobrir devolve 0 resultados | categoria/raio estreitos, ou a zona não existe no OSM |
| `EADDRINUSE` | já há algo na porta 4530 — muda `PORT` |

## Ver também

- `README.md` — o que é este pacote.
- `../agents-office-main/PESQUISA.md` — a pesquisa Google do escritório (leads por Places).
- `../agents-office-main/AI.md` — os motores de IA do escritório.
