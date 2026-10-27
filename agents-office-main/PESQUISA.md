# Pesquisa real: leads da Google

O escritório escrevia bem; faltava-lhe matéria-prima verdadeira. Este documento explica como se
liga a pesquisa da Google, o que ela devolve, o que fica guardado e como os agentes a usam.

Duas APIs, dois trabalhos diferentes:

| API | Para que serve | O que precisa |
|---|---|---|
| **Google Places API (New)** — `places:searchText` | **Leads reais**: empresas com nome, morada, telefone, site, avaliação e nº de avaliações | `GOOGLE_MAPS_API_KEY` (e «Places API (New)» ligada no projeto) |
| **Programmable Search (Custom Search JSON API)** | **Informação**: resultados da web com título, link e excerto — contexto, concorrência, notícias | `GOOGLE_API_KEY` + `GOOGLE_CSE_ID` |

Uma chave da Google Cloud serve para as duas. Nada é instalado; sem chave, o escritório diz
exatamente qual variável falta e não inventa resultados.

## Ligar em três passos

1. Em `console.cloud.google.com`, cria (ou escolhe) um projeto e **ativa**:
   - *Places API (New)* — para leads;
   - *Custom Search API* — só se também quiseres pesquisa web.
2. Cria uma **chave de API** (APIs & Services → Credentials). Restringe-a às duas APIs; para um
   servidor, restringe por IP.
3. Põe as chaves no ambiente do escritório e reinicia:

```bash
export GOOGLE_MAPS_API_KEY="a-tua-chave"      # leads (Places)
export GOOGLE_API_KEY="a-tua-chave"           # pesquisa web (Custom Search)
export GOOGLE_CSE_ID="xxxxxxxxxxxx:yyyyyyy"   # o cx do motor de pesquisa
node serve.mjs
```

O `cx` obtém-se em [programmablesearchengine.google.com](https://programmablesearchengine.google.com)
→ *Add* → escolher «Search the entire web» → copiar o *Search engine ID*.

As chaves vivem **só** no ambiente. Nunca num ficheiro versionado — `office.config.local.json` é
ignorado pelo git, mas o sítio certo continua a ser o ambiente.

## Na página

O botão **◈ LEADS**, na barra do topo, abre a gaveta. Escreve a atividade («clínicas dentárias») e o
sítio («Lisboa») e prime **PROCURAR**. Cada resultado traz:

- **nome, cidade, telefone, site** (ou «sem site») e link do mapa;
- uma **nota de 0 a 100** com a razão escrita — `sem site · telefone público · avaliação 3.9`;
- tudo o que aparece fica guardado, sem duplicados.

Sem chave, a gaveta não finge: mostra os três passos acima. O botão **→ TAREFA** transforma os
melhores resultados numa tarefa para o Lead Hunter («Abordar estes 6 negócios reais, um a um…»).

## Como se pontua um lead

A nota não é mágica — é uma soma explicada (`scoreLead()` em `google.mjs`):

| Sinal | Efeito |
|---|---|
| Não tem site | **+40** (a maior oportunidade: é isso que se vende) |
| Tem telefone público | +8 (dá para ligar) |
| Avaliação abaixo de 4,2 | +8 (há queixa para resolver) |
| Avaliação 4,6 ou mais | +4 (bom sinal, negócio vivo) |
| 50 ou mais avaliações | +4 (movimento real) |
| Base | 40 |

Máximo 100. Um negócio sem site, com telefone e má avaliação fica no topo — e é o primeiro da lista
em cada tarefa da Prospeção.

## Sem duplicados

`data/leads.json` guarda tudo. A identidade de um lead é, por ordem:

1. o **domínio** do site (ignorando google, facebook, instagram e linkedin);
2. o **telefone** (últimos 9 dígitos);
3. o **nome + morada** normalizados.

Uma segunda pesquisa da mesma zona atualiza os dados factuais (telefone, avaliação, site) sem
duplicar e sem perder o que é teu: o **estado** (`novo`, `contactado`, …) e as notas.

## Da gaveta para a base de dados

A gaveta continua a ser a lista rápida (`data/leads.json`), mas a partir de 26 out 2026 cada
pesquisa grava **também** na base de dados da operação (`data/orbita.db`): com a nota e as
razões recalculadas, a chave de deduplicação do escritório e o estado do funil. A resposta de
`POST /api/google/search` traz `baseDeDados` com `{ created, updated, refused }` — os números
verdadeiros, não uma estimativa.

O que já estava guardado só no ficheiro traz-se com:

```bash
curl -X POST http://localhost:4520/api/ops/leads/importar-gravados
```

A partir daí, o funil, as mensagens com aprovação e as métricas vivem em **◉ OPERAÇÃO**
(ver **[OPS.md](OPS.md)**). A pontuação da gaveta (`score` da Google) e a da base de dados são
calculadas com as mesmas regras; a da base de dados guarda as razões em `score_reasons`.

## O que os agentes recebem

**Prospeção** e **Vendas** leem, no início de cada tarefa, um bloco `LEADS REAIS` com os oito melhores
leads ainda por contactar — nome, cidade, telefone, site ou a falta dele, avaliação e nota. A
instrução é explícita: usar o nome e o contexto reais, e **não inventar contactos** (se falta o email,
dizer que falta).

Os outros quatro departamentos não recebem este bloco: um designer não precisa de uma lista de
clínicas à frente.

**A pesquisa não dá permissão para enviar nada.** Contactar, publicar, pagar ou alterar continua a
exigir o OK do proprietário, como sempre.

## API

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/google` | estado das duas APIs (ligado / o que falta) + contagens |
| POST | `/api/google/search` | procurar: `{"kind":"places","what":"clínicas dentárias","where":"Lisboa","limit":20}` ou `{"kind":"web","q":"…"}` |
| GET | `/api/leads` | a lista guardada, por nota (`?limit=50&status=novo`) |
| POST | `/api/leads/status` | `{"id":"l…","status":"contactado"}` |

Exemplos:

```bash
curl -s localhost:4520/api/google
curl -s -X POST localhost:4520/api/google/search -H 'content-type: application/json' \
  -d '{"kind":"places","what":"ginásios","where":"Porto"}'
curl -s localhost:4520/api/leads?limit=5
```

### Testar sem gastar quota

Os endereços das duas APIs podem ser trocados por ambiente — é assim que a camada é verificada sem
chave, contra um servidor local que devolve o mesmo formato:

```bash
GOOGLE_PLACES_URL=http://127.0.0.1:4601/places GOOGLE_MAPS_API_KEY=teste node serve.mjs
```

## Cuidados

- **Quotas.** A Places API (New) tem quota gratuita mensal por SKU; cada pesquisa de texto conta. Não
  deixes um ciclo a procurar de hora a hora sem querer.
- **Termos da Google.** Guardar o `place_id` e mostrar a atribuição «Dados do Google» é o que os
  termos exigem para uso prolongado; o `googleMapsUri` já vem em cada lead.
- **Privacidade.** Isto são empresas, não pessoas: morada comercial, telefone público e site. Não
  guardes dados pessoais de terceiros em `data/leads.json`.

## Os agentes também procuram — servidor MCP `orbita_google`

A gaveta LEADS é para ti. Para os agentes, o mesmo motor está exposto como servidor MCP local
(`mcp-servers/orbita-google/index.mjs`), registado no `.mcp.json` e entregue aos 35 agentes por
`--mcp-config`:

| Ferramenta | O que faz | Quando é usada |
|---|---|---|
| `google_places_search` | empresas reais: nome, morada, telefone, site, avaliação, nota de oportunidade | prospeção de leads |
| `google_web_search` | resultados da web com título, link e excerto | contexto, concorrência, informação |
| `google_leads_saved` | lê os leads já guardados | antes de procurar outra vez |
| `google_leads_save` | guarda resultados verificados (deduplicado) | depois de confirmar |

Regras que o servidor impõe: nada é enviado, publicado ou contactado por estas ferramentas; sem
chave, a chamada volta com o nome exato da variável em falta; os resultados são públicos e podem
estar incompletos — quem lê confirma antes de contactar.

Prova sem chave nenhuma, contra um Places falso local: `npm run test:integrations` (5 dos 18 testes
são da camada Google: estado honesto, mapeamento, nota, deduplicação e o servidor MCP por stdio).


---

## 1.25.0 · As fontes que funcionam na aplicação publicada

O que está acima descreve a pesquisa **local** (Google Places + Programmable
Search), que precisa de chave com facturação. Na aplicação publicada a pesquisa
passa a ser servida pela função, com duas fontes que não pedem cartão:

| Rota (via `/api/rpc?caminho=`) | Fonte | O que devolve |
|---|---|---|
| `GET /pesquisa/estado` | — | o que está ligado, o que falta, e se há chave de cifra |
| `GET /pesquisa/categorias` | — | as 26 atividades que o Geoapify sabe procurar |
| `POST /pesquisa/leads` | Geoapify | empresas reais na zona pedida, com telefone, site, email e nota |
| `POST /pesquisa/web` | Tavily | excertos e resposta curta (contexto, não leads) |
| `POST /pesquisa/pagina` | Tavily | o texto limpo de um endereço já conhecido |

Exemplo:

```
GET /api/rpc?caminho=/pesquisa/leads  (POST)
{ "oQue": "dentistas", "onde": "Coimbra", "limite": 10, "raio": 8000 }
→ { ok, categoria: "healthcare.dentist", centro, encontrados, leads: [...], guardados: {novos, repetidos} }
```

Regras que continuam de pé: sem chave, a resposta diz qual variável falta; uma
atividade desconhecida é recusada com a lista; a web não escreve no funil; e
procurar não contacta ninguém — enviar continua a exigir o teu OK.
