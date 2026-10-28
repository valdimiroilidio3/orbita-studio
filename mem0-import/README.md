# Mem0 no OpenClaw — o que correr, e onde

Estes utilitários correm **no host onde o OpenClaw vive**, ao lado de
`~/.openclaw/workspace/`. Não correm neste sandbox: aqui não há `openclaw`,
não há `~/.openclaw` e a saída para `api.mem0.ai` está fechada (o handshake TLS
é cortado; `api.mem0.ai` não está na lista de hosts permitidos).

## 1 · instalar e ligar

```bash
openclaw plugins install @Mem0/openclaw-mem0
export MEM0_API_KEY='m0-...'
openclaw mem0 init --api-key "$MEM0_API_KEY" --user-id "$(whoami)"
openclaw mem0 status --json        # tem de trazer connected: true
```

Se o `status` não disser conectado, **pára**: o problema está na chave ou na
rede, não no import.

## 2 · verificar antes de importar

```bash
MEM0_API_KEY='m0-...' node verificar-mem0.mjs --pesquisa preferences
```

Prova três coisas: a chave responde em `/v1/ping/`, as memórias são legíveis, e
a pesquisa devolve resultados. A chave aparece mascarada; nunca é impressa.

## 2b · na Órbita (produção) — as memórias passam a ser usadas

A Órbita (este repositório) já tem o Mem0 ligado na memória da IA desde a 1.49.0,
e as variáveis `MEM0_API_KEY`, `MEM0_BASE_URL`, `MEM0_ORG_ID` e `MEM0_PROJECT_ID`
já existem no projecto Vercel `orbita-agentes`. Duas formas de as encher:

```bash
# a partir do workspace do OpenClaw
node construir-import.mjs
node enviar-para-orbita.mjs            # mostra o plano, não envia
node enviar-para-orbita.mjs --enviar   # envia para POST /ia/memoria/importar
```

ou, sem sair do browser: **Control Center → Memória → «Enviar as notas para o
Mem0»** (envia as notas que já estão na base).

O painel da memória mostra `Memória semântica ligada (Mem0) · chave m0-…` quando
a chave responde, e a razão quando não responde. A procura passa a dizer, em cada
resultado, se veio do `mem0` ou do `local`.

## 3 · construir e importar

```bash
node construir-import.mjs                 # lê ~/.openclaw/workspace → /tmp/mem0_import.json
openclaw mem0 import /tmp/mem0_import.json
openclaw mem0 search "preferences" --json
```

O `import` imprime `Imported N memories.` **e**, se alguma falhar,
`N memories failed to import.` — lê as duas linhas. Falhas individuais não
interrompem o lote.

## Notas que valem a pena

**`orgId` e `projectId` não são configuração do plugin.** O
`configSchema` do `@mem0/openclaw-mem0@1.2.1` tem `additionalProperties: false`
e só conhece `mode`, `apiKey`, `userId`, `baseUrl`, `userEmail`, `autoCapture`,
`autoRecall`, `customInstructions`, `customCategories`, `customPrompt`,
`searchThreshold`, `topK`, `oss` e `skills`. Meter `orgId`/`projectId` em
`openclaw.json` faz a validação falhar. A chave já é de um projecto; o plugin
passa ao `mem0ai` apenas `{ apiKey, host: baseUrl }`.

**`MEM0_BASE_URL` também não é lido pelo plugin.** O que existe é a chave
`baseUrl` na configuração:

```json
{
  "plugins": {
    "openclaw-mem0": {
      "mode": "platform",
      "apiKey": "${MEM0_API_KEY}",
      "baseUrl": "https://api.mem0.ai",
      "userId": "nuno"
    }
  }
}
```

(Confirma a forma exacta com `openclaw mem0 config show` antes de editar à mão;
o ficheiro é `~/.openclaw/openclaw.json`.)

**A chave fica melhor em variável de ambiente.** `${MEM0_API_KEY}` ou um
SecretRef `{"source":"env","provider":"default","id":"MEM0_API_KEY"}` — o próprio
plugin avisa nisso no `uiHints.apiKey`.

**Rotação.** Qualquer chave colada em conversa deve ser tratada como exposta:
gera outra em `app.mem0.ai/dashboard/api-keys` e repete o passo 1 com a nova. As
memórias não se perdem — estão ligadas ao projecto, não à chave.

## Ficheiros

- `construir-import.mjs` — workspace → JSON no formato que o `mem0 import` lê
  (`{memory, metadata, user_id?}`). Ficheiros < 2000 palavras num só item;
  maiores partidos por cabeçalho (`#`, e `##` se uma secção continuar enorme).
  `SOUL/IDENTITY/USER/MEMORY.md` entram; `AGENTS/BOOTSTRAP/HEARTBEAT/TOOLS.md`
  não; `memory/YYYY-MM-DD.md` só dos últimos 30 dias. `--seco` conta sem escrever.
- `verificar-mem0.mjs` — ping, leitura e pesquisa contra a API, com a chave
  mascarada.
- `enviar-para-orbita.mjs` — manda o JSON para `POST /ia/memoria/importar` da
  Órbita (plano por omissão; `--enviar` grava).

Nenhum dos dois ficheiros contém chaves.
