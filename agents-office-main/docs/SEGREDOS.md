# Segredos e cifra (1.25.0 · 27 out 2026)

Este documento responde a duas perguntas, sem rodeios: **onde vivem as chaves** e
**o que é que está cifrado**. Tudo o que não está cifrado também está dito.

## 1. As chaves

| Onde | O quê | Cifrado? |
|---|---|---|
| Variáveis de ambiente da Vercel | `GEOAPIFY_API_KEY`, `TAVILY_API_KEY`, `SUPABASE_SECRET_KEY`, `GITHUB_TOKEN`, `VERCEL_TOKEN`, `CONECTORES`… | **Sim, em repouso** — é a plataforma que guarda e só as injecta na função. A interface mostra-as mascaradas e não as devolve. |
| Repositório Git | nada | — há um teste (`segredos.test.mjs`) que falha se aparecer uma chave com formato verdadeiro num ficheiro versionado |
| Browser | nada | o que chega ao ecrã é o nome da variável (`GEOAPIFY_API_KEY`), nunca o valor |
| Registos / mensagens de erro | nada | `mascarar()` mostra no máximo `tvly…8OC`; os erros dizem o código HTTP e a razão, não a chave |
| Base de dados | nada | as chaves **não** são guardadas na base; `POST /platform/key` continua a responder **501** e a explicar porquê |

Rotação, quando for preciso: cria uma chave nova no fornecedor → substitui a
variável na Vercel (Settings → Environment Variables) → faz *redeploy* →
confirma com «Testar ligação» no Centro de Controlo → revoga a antiga. Um
redeploy demora cerca de um minuto; a partir daí o nome da variável é o mesmo e
nada no código muda.

## 2. A cifra

`api/_cripto.mjs` — **AES-256-GCM**, IV novo em cada cópia, etiqueta de
autenticação (uma cópia alterada não abre). A chave mestra vem de:

1. `ORBITA_CHAVE` (32 bytes em base64 ou 64 caracteres hexadecimais), se existir;
2. senão, derivada com **HKDF-SHA256** de `SUPABASE_SECRET_KEY` — evita inventar
   mais um segredo para copiar.

Custo declarado do caminho 2: se rodares a chave da base, as cópias **antigas**
deixam de abrir. Para independência total, define `ORBITA_CHAVE`.

Rotas:

```
POST /backup/cifrado   → { formato, alg, bytes, impressao, chaveDe, copia:{quando,tabelas,total}, pacote }
POST /backup/decifrar  → { ok, quando, tabelas, total, contagens, marca }   (confirma; não despeja dados)
```

O `pacote` é o que se guarda ou se envia. A resposta do `cifrado` **não** leva a
cópia em claro ao lado do pacote — há um teste que verifica isto à letra.

## 3. O que **não** está cifrado (e não se finge que está)

- **O tráfego dentro da função**: as chaves viajam em claro entre a variável de
  ambiente e o `fetch` (é o processo da Vercel; a ligação para fora é HTTPS).
- **A base de dados**: os leads e as mensagens estão em claro no Supabase. Cifrar
  campos ali exigiria mudar o esquema e perder a pesquisa por texto; não foi
  feito. Quem tiver a `SUPABASE_SECRET_KEY` lê a base — é essa a fronteira.
- **A aplicação não tem autenticação**: qualquer pessoa com o endereço pode usar
  as rotas. A cifra protege a **cópia** que sai, não o acesso ao servidor.
- **Backups automáticos**: não existem. `POST /backup/cifrado` é um pedido
  explícito, feito quando quiseres.

## 4. As duas chaves novas, em concreto

| Variável | Para que serve | Onde se cria |
|---|---|---|
| `GEOAPIFY_API_KEY` | empresas reais por categoria e zona (leads) | <https://myprojects.geoapify.com> |
| `TAVILY_API_KEY` | pesquisa web com excertos (contexto) | <https://app.tavily.com> |

Nenhuma das duas pede cartão para o plano gratuito. Os limites gratuitos mudam
sem aviso: o `/pesquisa/estado` diz o que está ligado, não quanto resta da quota.
Quando o fornecedor recusar por limite (HTTP 429), a resposta diz isso mesmo.
