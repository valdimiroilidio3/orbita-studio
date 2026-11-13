# Órbita Core — empresa de agentes (primeira entrega)

Núcleo novo, escrito de raiz, para uma pequena empresa de agentes que cria projetos de frontend e backend em etapas.
Não reutiliza código do `agents-office-main/` (licença PolyForm Noncommercial com termos da Sahni.ai).

## O que existe hoje

- **Elenco (14 agentes)** em três divisões: Produto (4), Design (4) e Programação (6). Cada agente tem papel, jeito de trabalhar, missão, entregas e critério de pronto. Ver `src/elenco.mjs`.
- **Fluxo de equipa (10 etapas)**: Gestor de Produto → Priorizador de Sprint → Guardião da Marca → Arquiteto de UX → Designer de UI → Arquiteto de Backend → Desenvolvedor Frontend → Desenvolvedor Backend → Desenvolvedor Sénior → Revisor de Código. Ver `src/equipa.mjs`.
- **Passagens entre agentes**: cada transição escreve um ficheiro em `handoffs/` com de, para, fase, prioridade, contexto, pedido, critérios e evidência exigida.
- **Motor misto, por tarefa**:
  - `gratis`: um modelo gratuito sem chave. No escritório, é a cadeia gratuita já existente (LLM7, OVH, OpenCode Zen, Pollinations). O núcleo recebe uma função `perguntar(sistema, pedido)` e não fala com fornecedores diretamente.
  - `api`: um endpoint compatível com chat completions, com chave no ambiente do servidor.
  - `claude-cli`: o Claude Code desta máquina (`claude`), a correr dentro da pasta do projeto. Só é usado quando é pedido à mão; deixou de ser escolhido por omissão.
  - `sem-motor`: se nenhum estiver disponível, a etapa para e fica registada. Nada é inventado.
  - Ordem por omissão: `api` (se o servidor tiver URL e chave) → `gratis` (se ligado) → `sem-motor`. O `claude-cli` só entra se for pedido.
- **Regra de conclusão**: uma etapa só fica `concluido` se as entregas existirem em disco. Uma etapa falhada para o fluxo; não salta à frente.

## O que ainda não existe

- Ligação ao escritório visual (`agents-office-main/empresa.mjs`): feita na árvore de trabalho, por commitar. A linha de comandos deste núcleo não tem o motor `gratis`: sem `api`, não corre.
- Os agentes fora do fluxo (Pesquisador de Tendências, Sintetizador de Feedback, Pesquisador de UX, Prototipador Rápido) estão no elenco mas ainda não são chamados por nenhuma etapa.
- Marketing, Vendas e Prospeção: fora desta entrega, por decisão do dono.
- Não há prova com um motor real: os testes usam um fornecedor falso. Falta correr uma vez com o Claude Code ou com uma chave de API.

## Como usar

```bash
cd orbita-core
npm test                                  # 13 testes
node src/cli.mjs elenco                   # lista os agentes
node src/cli.mjs motor                    # diz qual motor seria usado
node src/cli.mjs criar "Lista de Compras" "Uma lista partilhável, sem contas." projetos
node src/cli.mjs correr projetos/lista-de-compras            # escolhe o motor
node src/cli.mjs correr projetos/lista-de-compras api        # força a API
```

Variáveis de ambiente (só no servidor, nunca no repositório):

| Variável | Para quê |
|---|---|
| `ORBITA_CORE_CLAUDE_BIN` | Caminho do `claude`, se não estiver no PATH (por defeito `claude`). |
| `ORBITA_CORE_API_URL` | Endpoint compatível com chat completions. |
| `ORBITA_CORE_API_KEY` | Chave da API. Nunca é escrita em ficheiros nem em registos. |
| `ORBITA_CORE_MODEL` | Modelo a pedir ao endpoint. |

## Segurança

- Os agentes só escrevem dentro da pasta do projeto. Caminhos absolutos, `..` e fugas são recusados antes de escrever.
- O motor da API valida todos os caminhos antes de escrever o primeiro ficheiro.
- Nenhum motor usa shell. O Claude Code, quando pedido, corre com `--allowedTools Read,Write,Edit`.
- Motor gratuito: sem chave, por isso nada a guardar. Uma resposta com caminhos inválidos é recusada inteira.

## Atribuição

Ver `NOTICE.md`.
