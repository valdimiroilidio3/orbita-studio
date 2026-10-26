# view-image-mcp

Um servidor MCP com uma ferramenta: **`view_image`**. Recebe o URL público de uma imagem (incluindo
links do Google Drive em `uc?export=view&id=…`), descarrega-a e devolve-a como bloco de imagem em
base64 — para que um agente com visão a possa **ver**, descrever e usar como referência.

```bash
npm ci          # @modelcontextprotocol/sdk
node index.mjs  # fala MCP por stdio (initialize · tools/list · tools/call)
```

## Ligar ao Órbita (Claude Code)

```bash
claude mcp add --scope user view-image -- node "$(pwd)/index.mjs"
claude mcp list      # view-image … connected
```

Depois disto os agentes recebem `mcp__view-image__view_image` — o `office.config.json` já permite
todos os servidores ligados (`mcp.allow: []`), portanto não é preciso mais nada. O escritório mostra
o servidor em `/api/mcp` e acende a ferramenta no feed quando é usada.

## Comportamento honesto

- Só `http(s)://`; nada de `file://` nem de caminhos locais.
- Limite de tamanho e de tempo na descarga; erro devolvido como `isError` com a mensagem, sem derrubar
  o servidor.
- Falha de rede → `{"error":"fetch failed"}` no conteúdo, não um crash.

## Verificado nesta máquina

`initialize` → `serverInfo: view-image-mcp 1.0.0` · `tools/list` → `view_image` com `url` obrigatório ·
`tools/call` com URL inacessível → erro tratado, processo vivo.

Órbita — criado por **Chelton Mahoze**.
