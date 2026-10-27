# Vercel Connect (1.27.0 · 27 out 2026)

## O que é, na prática

Uma chave de API colada numa variável de ambiente vive meses, vale tudo o que o
fornecedor deixar, e fica igual quer a use um agente de prospeção quer um script
esquecido. O Vercel Connect troca isso por **credenciais ao minuto**: o escritório
pede um token no momento em que precisa dele, com o sujeito e os escopos certos,
e a Vercel guarda o refresh token — nós nunca o vemos.

Conector em uso:

```
uid: opencode/orbita-agentes
id:  scl_qldewGbrB7mPvtjEQXyVQ
```

## Como está implementado

`api/_conect.mjs` envolve a SDK (`@vercel/connect@^2.5.6`) e:

- pede o token com `getTokenResponse` (não `getToken`, para se saber a validade e
  o conector que respondeu);
- autentica a chamada com o OIDC que a Vercel injecta na função — o mesmo que a
  camada de IA já usava; `VERCEL_TOKEN` serve de alternativa;
- **guarda em cache** até 30 s antes de expirar: um token por minuto, não um por
  pedido; `forcar: true` ignora a cache e revalida a autorização na Vercel;
- traduz cada erro tipado da SDK para uma instrução em português: falta
  autorização (`UserAuthorizationRequiredError`), falta instalação
  (`ConnectorInstallationRequiredError`), conector não ligado ao projecto,
  ambiente não autorizado, credencial recusada.

## O sujeito (importante)

O token representa alguém:

| Variável | Efeito |
|---|---|
| `ORBITA_DONO_ID` | token do tipo `user`, com esse id (ex.: `usr_123`) |
| *(nada)* | token do tipo `app` — representa a aplicação, não uma pessoa |

Um token `user` exige que essa pessoa tenha autorizado o conector uma vez. Como a
aplicação **ainda não tem autenticação**, o sujeito por omissão é `app`; quando
houver login, o id do utilizador entra por pedido e cada pessoa passa a ter o seu
token. Não se finge aqui uma identidade que não existe.

## Rotas

```
GET  /api/rpc?caminho=/conectar/estado      → conector, id, sujeito, SDK, credencial (nunca o token)
GET  /api/rpc?caminho=/conectar/teste       → pede um token a sério; devolve só 4+4 caracteres
POST /api/rpc  {caminho:'/conectar/teste', corpo:{sujeito?, escopos?}}
POST /api/rpc  {caminho:'/conectar/consentimento'}  → link de autorização (só com ORBITA_PERMITIR_CONSENTIMENTO=1)
```

O Centro de Controlo mostra «Vercel Connect» no grupo **Credenciais**, com o
botão «Testar ligação» — que faz o pedido real e guarda o resultado.

## O que falta, e diz-se

1. **Ligar o conector ao projecto e ambiente** na Vercel (Connect → connector →
   project links). Sem isso a resposta é `nao-ligado`, e é essa que aparece.
2. **Consentimento**, se o conector só emitir tokens de utilizador. O link sai de
   `/conectar/consentimento` (desligado por omissão, porque a app não tem login).
3. **Onde usar o token**: hoje há a função `tokenPara()` no servidor. Nenhum
   agente a chama ainda — ligá-la a uma tarefa concreta (ex.: ler um repositório
   do OpenCode) é o passo seguinte, e só se faz com um teste real a passar.
