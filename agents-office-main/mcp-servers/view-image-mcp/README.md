# view-image-mcp

Um servidor MCP mínimo (stdio, JSON-RPC) com uma ferramenta: `view_image`.

Dá olhos aos agentes. Recebe o URL de uma imagem — incluindo links do Google Drive, que devolvem
HTML em vez de bytes — e devolve a imagem em conteúdo que o modelo consegue **ver**.

## Instalar

```bash
cd agents-office-main/mcp-servers/view-image-mcp
npm ci
```

## Ligar ao Claude Code

```bash
claude mcp add --scope user view-image -- node "$(pwd)/index.mjs"
```

`office.config.json` já permite todos os servidores ligados (`"mcp": { "allow": [] }`), por isso não
é preciso mais nada para os agentes a receberem.

## Ferramenta

| Nome | Entrada | O que faz |
|---|---|---|
| `view_image` | `url` (obrigatório) | Vai buscar a imagem e devolve-a ao modelo. Em URLs do Google Drive tenta a descarga direta. |

Uma falha de rede devolve um erro tratado (`{"error":"fetch failed"}`), nunca uma imagem inventada.
