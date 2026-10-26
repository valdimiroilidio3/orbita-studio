# ORBITA — Integrações de API

Esta camada adiciona uma API de integração ao backend Node e um servidor MCP local que disponibiliza ferramentas aos agentes Claude Code. A cena Three.js não ganha automaticamente novos ecrãs de CRM/marketing; a integração dos agentes é feita através do MCP. Não substitui o motor de agentes já baseado no Claude Code. Nenhuma credencial está incluída. Integrações que exigem contas permanecem inativas até configurares as variáveis de ambiente e testares as permissões.

## Primeiro arranque

1. Copia `.env.example` para `.env`.
2. Gera um token local para proteger os endpoints privados:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```
3. Coloca-o em `ORBITA_API_TOKEN` no `.env` (mínimo 32 caracteres). Nunca publiques o `.env`.
4. Reinicia o Agents Office e, se Claude Code pedir, aprova o servidor MCP local `orbita_integrations` para este projeto. Confirma-o com `claude mcp list`.
5. Executa `npm run test:integrations`, depois `npm run check`.
6. Consulta `GET /api/integrations` para ver quais providers estão configurados. `configured` significa que existem variáveis; só uma chamada real válida confirma funcionamento.

Nesta instalação o `.env` **é mesmo lido**: `config.mjs` carrega-o antes de qualquer
configuração (parser próprio, sem dependências) e nunca sobrepõe variáveis já exportadas no
ambiente. Sem `.env` a aplicação também arranca — só as rotas privadas respondem `503`.

O servidor MCP `orbita_integrations` é arrancado e interrogado a sério (`initialize` +
`tools/list`) sempre que o escritório inicia, e o mesmo ficheiro é entregue aos agentes do Claude
Code por `--mcp-config`. O estado real — servidor, ferramentas, erros — está em `GET /api/mcp`.

O projeto original foi concebido como uma aplicação local. Antes de o expor publicamente, implementa autenticação completa e autorização para as rotas existentes do produto, não apenas para estes novos endpoints. A camada nova protege endpoints privados via Bearer `ORBITA_API_TOKEN`; esse token não deve ser embutido no JavaScript do browser.

## Endpoints novos

| Método | Endpoint | Uso | Segurança |
|---|---|---|---|
| GET | `/api/integrations` | Estado de configuração dos providers (sem segredos) | Público, só metadados |
| GET | `/api/github/repo?owner=OWNER&repo=REPO` | Metadados de repositório GitHub | Bearer obrigatório; `GITHUB_TOKEN` opcional no servidor |
| PUT | `/api/github/file` | Cria/atualiza um ficheiro num branch e faz commit | Bearer, `approved:true`, `GITHUB_TOKEN` com Contents: write; bloqueia segredos e workflows |
| MCP | `orbita_business_discover`, `orbita_leads_*`, `orbita_ai_assist`, `orbita_content_*` | Ferramentas usadas pelos agentes de trabalho | Via `orbita_integrations` no `.mcp.json`; providers externos continuam sujeitos a chaves/quota |
| POST | `/api/whatsapp/link` | Gera um link `wa.me` com texto pré-preenchido | Bearer obrigatório; não envia a mensagem |
| POST | `/api/crm/leads/discover` | Pesquisa manual por zona/categoria via Nominatim + Overpass | Bearer obrigatório para evitar abuso do serviço público; `save:true` grava no CRM |
| GET | `/api/crm/leads?limit=100` | Lista CRM | Bearer obrigatório |
| POST | `/api/crm/leads` | Cria um lead ou array `{ "leads": [...] }` | Bearer obrigatório; máximo 30 por chamada |
| PATCH | `/api/crm/leads/:id` | Atualiza `status`/`notes` | Bearer obrigatório |
| POST | `/api/ai/assist` | Rascunhos e qualificação com Gemini: `qualify`, `outreach`, `social`, `project_brief` | Bearer obrigatório; `GEMINI_API_KEY` |
| GET | `/api/content/drafts` | Lista rascunhos de marketing | Bearer obrigatório |
| POST | `/api/content/drafts` | Guarda rascunho para um projeto | Bearer obrigatório |
| POST | `/api/email/send` | Envia um email individual | Bearer, aprovação explícita e referência de consentimento/base de contacto |
| POST | `/api/email/suppress` | Regista um pedido de oposição | Bearer obrigatório |
| POST | `/api/social/instagram/publish` | Publica uma imagem aprovada ou um `draftId` | Bearer, `approved:true`, credenciais Meta e URL HTTPS pública |
| POST | `/api/deploy/vercel` | Dispara um deploy do projeto/branch ligado ao Deploy Hook | Bearer e `approved:true`; URL secreta apenas no servidor |

Exemplo de pesquisa manual:

```bash
curl -X POST http://localhost:4520/api/crm/leads/discover \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ORBITA_API_TOKEN" \
  -d '{"location":"Coimbra, Portugal","category":"salon","radiusMeters":3000,"limit":15}'
```

Exemplo de commit de um único ficheiro (usa um branch dedicado e revê o diff antes de publicar):

```bash
curl -X PUT http://localhost:4520/api/github/file \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ORBITA_API_TOKEN" \
  -d '{"approved":true,"owner":"OWNER","repo":"REPO","path":"src/example.ts","content":"export const example = true;\n","message":"feat: add example","branch":"orbita/integration"}'
```

`approved:true` representa uma ação deliberada do proprietário, não substitui revisão do conteúdo nem permissões mínimas do token.

Exemplo de criação privada de lead:

```bash
curl -X POST http://localhost:4520/api/crm/leads \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $ORBITA_API_TOKEN" \
  -d '{"companyName":"Empresa Exemplo","website":"https://example.pt","city":"Coimbra","source":"manual"}'
```

## Providers e limites

### OpenStreetMap / Nominatim / Overpass

Sem chave, mas **não é uma API ilimitada nem um diretório comercial garantido**. A pesquisa é acionada pelo utilizador, usa cidade + categoria, cacheia resultados por 30 minutos, aplica intervalos conservadores e limita raio/resultados. Os resultados podem não ter website, telefone ou email e não confirmam que uma empresa precisa de um site. A interface/processo deve manter a atribuição `© OpenStreetMap contributors` e respeitar a licença ODbL. Evita pesquisas sistemáticas, scraping de detalhes ou varrimento de áreas inteiras; para geocodificação do serviço público Nominatim, máximo de uma requisição por segundo e os restantes requisitos da política oficial aplicam-se.

Políticas: https://operations.osmfoundation.org/policies/nominatim/ e https://operations.osmfoundation.org/policies/api/.

### Gemini Developer API

É opcional e usa `GEMINI_API_KEY`, `GEMINI_MODEL` (por omissão `gemini-3.6-flash`). A tier gratuita tem acesso/modelos e quotas variáveis e pode permitir usar prompts para melhorar produtos Google; envia apenas informação comercial não sensível, não credenciais nem detalhes pessoais de clientes. As respostas são rascunhos, não verificação factual. O motor principal atual do Agents Office continua a ser Claude Code/SDK e não se torna gratuito por se adicionar Gemini.

Documentação: https://ai.google.dev/gemini-api/docs/pricing e https://ai.google.dev/gemini-api/docs/models.

### Supabase Free

Sem configuração Supabase, a aplicação guarda leads em `data/orbita-leads.json` (que não deve ser committed). Para cloud storage, cria um projeto Supabase, executa `supabase/orbita_schema.sql`, preenche `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. A chave service-role pode ignorar RLS e deve existir só no servidor. A tabela não tem políticas públicas; os clientes `anon`/`authenticated` não recebem acesso. A disponibilidade/limites gratuitos podem mudar e há quotas de projeto/storage.

Documentação: https://supabase.com/docs/guides/api.

### Resend

Plano gratuito listado atualmente com até 3.000 emails/mês e 100/dia, sujeito a alterações, limites e verificação do domínio. Só é permitido envio individual para `requested_follow_up` ou `transactional`, com `approved:true`, `recipientConsent:true` e `consentReference`. Existe uma lista local de supressão. Isto é uma proteção técnica adicional, não uma decisão jurídica automática sobre a base legal; confirma RGPD/ePrivacy e os pedidos de oposição antes de contactar um lead. Não usar para disparos em massa.

Documentação e preço: https://resend.com/pricing.

### GitHub REST API

A leitura de metadados de repositórios públicos não requer token, mas está sujeita ao rate limit anónimo. `GITHUB_TOKEN` opcional aumenta o limite autenticado. A leitura de metadados funciona com a API pública. Opcionalmente, `orbita_github_file_commit` / `PUT /api/github/file` permite criar ou atualizar **um ficheiro por chamada** num branch definido. Exige token fino com `Contents: write` no repositório alvo, `approved:true`, revisão do diff e bloqueia ficheiros `.env`, chaves/credenciais e workflows. Cada chamada gera um commit; não é uma transação multi-ficheiro, pelo que as alterações devem ser revistas e testadas antes do deploy. Um redeploy Vercel pode ser solicitado separadamente através de `VERCEL_DEPLOY_HOOK_URL`.

### WhatsApp: link de conversa, não envio automático

A rota gera um link `https://wa.me/` para abrir uma conversa com número internacional e texto pré-preenchido. A pessoa ainda revê e envia manualmente. Isto não é a WhatsApp Business Platform API, não faz automação de mensagens e não exige uma API key. Não assumas que a API oficial é gratuita ou ilimitada; confirma os preços e requisitos atuais antes de adotar envio automático.

### Vercel Deploy Hook

Opcional para pedir um novo deployment de um projeto Vercel conectado a um repositório Git. Cria um Deploy Hook em **Project Settings → Git → Deploy Hooks** e guarda a URL completa em `VERCEL_DEPLOY_HOOK_URL`, nunca em código ou browser. O endpoint e a ferramenta MCP exigem `approved:true` e o token ORBITA. O hook apenas solicita uma nova build/deployment; não altera código, não cria commits e a resposta `PENDING`/`accepted` não confirma que o build terminou. Revoga o hook no painel se a URL for exposta. Requer projeto Vercel ligado a um repositório Git.

Documentação oficial: https://vercel.com/docs/deploy-hooks.

### Instagram Graph API

A API não cobra uma taxa por chamada típica, mas exige uma conta Instagram profissional, app Meta, permissões/autorizações aplicáveis e uma imagem acessível publicamente por HTTPS. Configura `META_ACCESS_TOKEN`, `META_IG_USER_ID` e a versão Graph API atualmente suportada em `META_GRAPH_API_VERSION`. A rota requer `approved:true` e aguarda o estado `FINISHED` antes de publicar uma imagem única; não publica Reels, Stories ou carrosséis. Não incluas o token no browser.

Documentação: https://developers.facebook.com/docs/instagram-platform/content-publishing/.

## O que continua por configurar

- Criar as chaves/contas pessoais dos providers que decidires ativar e colocá-las no `.env` local/variáveis do alojamento.
- Verificar disponibilidade real e quotas com chamadas autenticadas a cada provider.
- Configurar login/autorização integral antes da exposição pública da aplicação. As rotas originais do Agents Office também devem ser protegidas.
- Ligar uma UI de CRM/Marketing dedicada à API. A camada MCP disponibiliza as ferramentas aos agentes, mas esta alteração não cria automaticamente novos ecrãs na cena 3D.
- Para publicação social, confirmar o fluxo de autenticação e a versão da API Meta na documentação oficial atual.

## Duas listas de leads, de propósito

O escritório já tinha prospeção própria — `GET/POST /api/leads` com dados da Google (Places API
ou pesquisa web), guardados em `data/leads.json` e mostrados na cena. Esta camada traz um CRM
diferente: fases de venda (`new` → `won`/`lost`), deduplicação por id OSM, domínio ou nome+cidade,
e armazenamento local (`data/orbita-leads.json`) ou Supabase. Para não haver duas rotas a responder
no mesmo sítio — a primeira ganharia sempre, em silêncio — o CRM vive em `/api/crm/leads*`.

| Lista | Rota | Fonte | Onde se vê |
|---|---|---|---|
| Prospeção do escritório | `/api/leads` | Google Places / pesquisa web | painel de Prospeção e Vendas |
| CRM das integrações | `/api/crm/leads` | OpenStreetMap + entrada manual + MCP | ferramentas `orbita_leads_*` dos agentes |

As duas listas existem mesmo: uma não é cópia da outra. Se quiseres uma só, o caminho é mapear o
resultado de `orbita_business_discover` para o formato da prospeção e gravar com `google.saveAll`
em `serve.mjs` — não está feito.

## O que esta camada não tem

Dizê-lo por palavras, porque é a diferença entre «não configurado» e «não existe»:

- **Stripe**: não há nenhuma integração de pagamentos em `integrations.mjs`. Sem rotas, sem chaves.
- **WhatsApp Business (envio)**: só existe o link `wa.me` revisto e enviado à mão (`/api/whatsapp/link`).
  Enviar mensagens pela API oficial exige conta Business, número verificado, token Meta e modelos
  aprovados — nada disso está implementado.
- **Google Places dentro desta camada**: a pesquisa Google é do escritório (`/api/google`, chave
  `GOOGLE_MAPS_API_KEY`), não das integrações. São dois caminhos, com duas chaves diferentes.
- **UI de CRM**: os dados existem e as ferramentas MCP funcionam, mas a cena 3D não ganhou ecrãs
  novos de CRM. Vê-se por HTTP (`GET /api/crm/leads`) e pelos agentes.
