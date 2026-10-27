# Pesquisa: Tavily (principal) + Geoapify (empresas)

> 1.30.0 (27 out 2026): tudo passa por uma **camada de ferramentas** (`api/_ferramentas.mjs`),
> com cache, tectos por minuto/dia/mês e uma linha de registo por execução. Os agentes
> passaram a ter a pesquisa web (`orbita_web_search`) e as empresas (`orbita_business_search`).
> Ver «A camada de ferramentas» mais abaixo.

> **1.29.0 · 27 out 2026.** O Google saiu do produto. A pesquisa do escritório passa a
> assentar em duas fontes que não pedem cartão, e a **Tavily é a pesquisa principal**:
> é dela que sai todo o contexto — mercado, concorrência, notícias e páginas inteiras.
> O Geoapify continua a dar as **fichas de empresa** que alimentam os leads.

| | Tavily | Geoapify |
|---|---|---|
| Papel | **pesquisa principal** | fonte dos leads |
| O que devolve | resposta curta, excertos, links, notícias com data | empresas reais (OpenStreetMap): nome, morada, telefone, site |
| Para que serve no escritório | contexto, mercado, concorrência, notícias, ler uma página | prospeção: quem contactar e porquê (a nota) |
| Variável | `TAVILY_API_KEY` | `GEOAPIFY_API_KEY` |
| Onde se cria | app.tavily.com | myprojects.geoapify.com |

As duas chaves vivem **só** no ambiente do servidor (variáveis da Vercel, cifradas em
repouso pela plataforma). Não passam pelo browser, não entram em ficheiros e não
aparecem em mensagens de erro. O que o visitante vê são dados; a configuração vive no
Centro de Controlo, que é do dono.

## Porque é que o Google saiu

Não foi por gosto: era o caminho mais caro de manter e o menos fiável de explicar.

- Pedia **duas APIs** diferentes (Places API (New) e Custom Search) e **duas contas de
  configuração** (projecto + motor de pesquisa programável) para fazer o mesmo trabalho.
- Pedia **cartão ligado** ao projecto, mesmo dentro do nível gratuito.
- Nunca foi ligado nesta instalação — ou seja, durante meses foi código a prometer algo
  que não existia. Código assim não é opção: é dívida.

A Tavily faz o mesmo trabalho com uma chave, sem cartão, e devolve melhor matéria
(resposta sintetizada + excertos + data de publicação nas notícias).

## O que se pode pedir (rotas publicadas)

Todas em `GET`/`POST` sobre `/api/rpc?caminho=…` — as mesmas que a função da Vercel serve:

| Rota | Para que serve |
|---|---|
| `GET /pesquisa/estado` | o que está ligado, qual é a principal, e o que falta a cada fonte |
| `GET /pesquisa/categorias` | as 25 atividades que o Geoapify sabe procurar |
| `GET /pesquisa/teste?fonte=tavily` | um pedido real, agora, sem escrever nada |
| `POST /pesquisa/web` | **Tavily**: `consulta`, `limite`, `topico` (`general`/`news`), `dias`, `dominios`, `profundidade` |
| `POST /pesquisa/pagina` | **Tavily extract**: o texto limpo de uma página já conhecida |
| `POST /pesquisa/leads` | **Geoapify**: `oQue`, `onde`, `limite`, `raio`, `pais` — com `guardar:false` para só espiar |
| `GET /pesquisa/uso` | quanto se gastou hoje e no mês, por fornecedor, com tecto, restante, cache e últimas execuções |
| `GET /pesquisa/ferramentas` | o catálogo que os agentes podem chamar, com o fornecedor escolhido e quem usa o quê |

Todas as rotas de pesquisa passam pela mesma camada: **validação antes de gastar um
crédito**, cache de 5 minutos, tecto por minuto e por dia, e registo da execução. Os
códigos de erro são estáveis: `parametros` (400), `limite`/`quota` (429), `semchave`,
`vazio`, `timeout`, `limite-fornecedor` e `falha` (502) — `vazio` na web devolve 200
com `ok:false` porque «não há nada de relevante» é uma resposta, não uma avaria.

### Notícias com recorte temporal

`topico: 'news'` muda o índice da Tavily para notícias e aceita `dias` (1 a 365). Cada
resultado traz `publicado`. Em modo `general`, `dias` **não é enviado** — pedir uma
janela temporal a uma pesquisa geral é um erro da API, não uma funcionalidade, e por
isso a gaveta esconde o selector quando o modo é «Geral».

### Ler a página

O excerto da Tavily chega para decidir, não para trabalhar. Quando é preciso o detalhe
(preços, serviços, contactos de uma clínica), `POST /pesquisa/pagina` devolve o texto
limpo até 20 000 caracteres. Na gaveta isso é o botão **«ler a página»** em cada
resultado; o que já foi lido fica guardado na sessão para não gastar créditos duas vezes.

## A camada de ferramentas (1.30.0)

O problema que isto resolve: cada sítio do código chamava o fornecedor à sua maneira.
Os agentes não tinham pesquisa web nenhuma (regressão do 1.29.0) e nada impedia a
interface de repetir o mesmo pedido dez vezes seguidas.

```
agente / rota / interface
        │
        ▼
api/_ferramentas.mjs   ← catálogo + validação + envelope comum + registo
        │
        ├── pesquisar_empresas → ADAPTADORES.empresas.geoapify
        ├── pesquisar_web      → ADAPTADORES.web.tavily
        └── ler_pagina         → ADAPTADORES.web.tavily (extract)
                 │
                 ▼
api/_limites.mjs  ← cache 5 min (250 entradas) · janela de 1 min · dia · mês · créditos
```

**Trocar de fornecedor não muda os agentes.** O fornecedor é escolhido por
`ORBITA_FONTE_EMPRESAS` / `ORBITA_FONTE_WEB` (por omissão `geoapify` e `tavily`); um
adaptador novo só tem de devolver o formato bruto do domínio. O envelope que o agente
recebe é sempre o mesmo:

```json
{ "ok": true, "ferramenta": "pesquisar_web", "fornecedor": "tavily", "ms": 812,
  "cache": false, "fontes": ["https://…"], "avisos": [], "dados": { … },
  "erro": null, "codigo": null, "real": true, "inferido": false }
```

`real: true` quer dizer que veio de um fornecedor com URL; `inferido` fica sempre
`false` nesta camada — o que o modelo deduz a partir disto não é resultado, e é assim
que a interface e os agentes o devem tratar.

**Cache.** A mesma pergunta dentro de 5 minutos não custa créditos (`cache: true`,
`ms: 0`). Sem chave configurada a cache **não** é servida: uma instalação mal
configurada tem de dizer que está mal configurada.

**Tectos** (com override por ambiente):

| Fornecedor | por minuto | por dia | por mês | custo |
|---|---|---|---|---|
| Tavily | 20 | 60 | 1000 | $0,008/crédito (plano gratuito: 1000/mês) |
| Geoapify | 60 | 3000 | — | grátis até 3000 créditos/dia |

`ORBITA_LIMITE_TAVILY_MIN|DIA|MES` e `ORBITA_LIMITE_GEOAPIFY_MIN|DIA` mudam os números
sem tocar no código. Quando o tecto fecha a porta, a resposta traz `codigo: 'limite'` ou
`'quota'` e `esperarMs` — o tempo que falta, para se poder dizer «tenta daqui a X».

**Registo.** Cada execução deixa uma linha com ferramenta, fornecedor, estado, tempo,
cache, fontes e erro; com base ligada vai para `orbita_atividade` (`tipo: 'pesquisa'`),
sem base fica em `data/pesquisa-log.json` (fora do git). `GET /pesquisa/uso` mostra as
últimas. **Nunca entra uma chave no registo** — há um teste que o verifica.

### Nos agentes (MCP)

| Ferramenta | Para quem | O que devolve |
|---|---|---|
| `orbita_web_search` | marketing, sales, delivery, brain | resultados com título, URL, excerto, data e `score`; fontes e avisos |
| `orbita_business_search` | sales, ops, brain | empresas do Geoapify normalizadas, sem duplicados, sem contactos inventados |
| `orbita_research_usage` | todos | consumo por fornecedor e últimas execuções |
| `orbita_business_discover` | (compatibilidade) | agora passa pelo Geoapify; sem chave dele, volta ao OSM de antes |

## Prova real (produção, 27 out 2026)

| Pedido | Resultado |
|---|---|
| `GET /pesquisa/teste` | `ok:true`, 575 ms, «Coimbra (40.211, -8.429)» |
| `GET /pesquisa/leads?oQue=dentistas&onde=Coimbra` | 5 empresas reais, notas 80/48 |
| `GET /pesquisa/web?q=mercado de clínicas dentárias em Coimbra` | Tavily: 3 fontes com excertos + resposta curta |

## Limites, ditos sem rodeios

- A Tavily tem quota mensal gratuita (créditos). O escritório não faz pedidos em ciclo:
  cada pesquisa é um gesto teu, e agora há travão em código (tabela acima). Quando a
  quota acaba, a resposta é «a fonte está a limitar os pedidos» — não se insiste em ciclo.
- **Os contadores são por instância da função.** Na Vercel, cada arranque a frio começa
  do zero: servem de travão contra ciclos, não de factura. O número que conta está no
  painel do fornecedor.
- **O `pais` só filtra o geocode**, não os lugares: `onde=Lisboa&pais=es` pode devolver
  uma zona espanhola. A resposta avisa (`avisos`) mas não bloqueia.
- **O geocode do Geoapify é tolerante**: um sítio inventado pode resolver noutro lado.
  A resposta diz qual foi o centro resolvido (`centro`) e avisa quando diverge do pedido.
- **Resultado sem `score`** (a Tavily às vezes não manda) é aceite com `relevancia: null`
  em vez de ser descartado — o limiar de 0,15 filtra os fracos, não os desconhecidos.
- **O registo em ficheiro** só existe quando não há base: com Supabase, o rasto vive em
  `orbita_atividade`.
- Os resultados da web **não entram no funil**. Uma página não é uma empresa: sem nome,
  telefone e morada verificáveis, não há lead. Só o Geoapify escreve no funil.
- A nota de oportunidade é uma regra explícita (sem site pesa muito), não um modelo.
- Procurar não contacta ninguém. Enviar continua a exigir o teu OK.
