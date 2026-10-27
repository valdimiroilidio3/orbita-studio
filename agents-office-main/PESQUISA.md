# Pesquisa: Tavily (principal) + Geoapify (empresas)

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
| `POST /pesquisa/leads` | **Geoapify**: `oQue`, `onde`, `limite`, `raio` — com `guardar:false` para só espiar |

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

## Prova real (produção, 27 out 2026)

| Pedido | Resultado |
|---|---|
| `GET /pesquisa/teste` | `ok:true`, 575 ms, «Coimbra (40.211, -8.429)» |
| `GET /pesquisa/leads?oQue=dentistas&onde=Coimbra` | 5 empresas reais, notas 80/48 |
| `GET /pesquisa/web?q=mercado de clínicas dentárias em Coimbra` | Tavily: 3 fontes com excertos + resposta curta |

## Limites, ditos sem rodeios

- A Tavily tem quota mensal gratuita (créditos). O escritório não faz pedidos em ciclo:
  cada pesquisa é um gesto teu. Quando a quota acaba, a resposta é «a fonte está a
  limitar os pedidos» — não se insiste em ciclo.
- Os resultados da web **não entram no funil**. Uma página não é uma empresa: sem nome,
  telefone e morada verificáveis, não há lead. Só o Geoapify escreve no funil.
- A nota de oportunidade é uma regra explícita (sem site pesa muito), não um modelo.
- Procurar não contacta ninguém. Enviar continua a exigir o teu OK.
