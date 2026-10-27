# O Centro de Controlo (1.20.0)

A aba de Configurações deixou de ser uma lista de opções e passou a ser o sítio onde se
vê — e se muda — o estado real da Órbita: as seis salas, a inteligência, a execução e a
segurança. Este documento diz o que está implementado, com que provas, e o que fica
declarado como não feito.

## 1 · Os três estados

A regra que o dono escreveu: *«Ter uma API configurada não significa que esteja ligada;
estar ligada não significa que um agente esteja a executar uma tarefa.»*

Por isso cada linha tem **três marcas separadas**, todas vindas de factos:

| marca | como se prova | quando não se sabe |
|---|---|---|
| **Configurado** | a variável de ambiente existe (`env[CHAVE]`), ou o fornecedor é keyless por desenho | nunca é inventado |
| **Ligado** | o último `/ia/testar` fez um pedido real e recebeu resposta com texto | `null` → a interface diz **por provar** |
| **A funcionar** | existe execução (`orbita_ai_runs`) ou uso (`orbita_ai_uso`) nas últimas 24 h | falso, com a data da última chamada à vista |

Onde isto vive: `api/_controlo.mjs` → `retrato()`, servido em `GET /api/controlo/estado`.
A interface (`src/config.js`) só desenha o que recebe; não calcula estados.

## 2 · As salas que crescem

`src/salas.js` é geometria pura (sem `three`, sem DOM), e é a **única** conta:

```
filas        = ceil(agentes / 2)                    // duas secretárias por fila
profundidade = wallGap + (filas-1)*rowStep + depth + entryBand
               (3,9 + (filas-1)*6,4 + 2,6 + 6,0)
```

- a sala cresce em **filas inteiras** — uma secretária precisa da fila toda;
- **nunca encolhe** abaixo da planta original (`Math.max(base, necessário)`);
- a **faixa da frente** (entrada que a câmara vê) fica sempre livre;
- o agente novo recebe o **primeiro lugar vago** (`lugarLivre`), nunca o de outro.

`src/escritorio.js` corre **antes** de a cena assentar (`main.js` importa-o primeiro) e
aplica: cores escolhidas, agentes acrescentados e a profundidade nova. O que fica
guardado (`localStorage`, chave `orbita.salas`) é só:

```json
{ "cores": { "sales": "#EADC8F" }, "agentes": [ { "id": "gestor-de-trafego", "nome": "Gestor de tráfego", "dept": "sales", "funcao": "anúncios" } ] }
```

O servidor guarda a mesma configuração (`orbita_ai_config.salas`), para não se perder ao
mudar de máquina. O browser é a cópia que a cena consegue ler sem esperar por rede.

## 3 · O que a aba faz hoje

| secção | o que mostra | o que muda |
|---|---|---|
| Tema | claro · escuro · automático | muda já, fica guardado |
| **Centro de Controlo · salas** | nome, cor, agentes, filas, lugares livres, «ampliada» | cor (`POST /controlo/salas/:id/cor`), acrescentar (`POST /controlo/agentes`), tirar (`DELETE /controlo/agentes/:id`) |
| **Inteligência** | motor pronto, quantos configurados, quantos **ligados**, quantos por testar | leitura (`/ia/estado`, `/ia/testar`) |
| **Execução** | execuções e chamadas em 24 h, última chamada, último modelo | leitura |
| **Segurança** | login, chaves no servidor, aprovação humana | leitura (a configuração faz-se na Vercel) |
| APIs | catálogo real: variáveis presentes e em falta, último teste | leitura (`/api/platform/apis`) |
| Avisos / painéis | permissão do browser, recolher painéis | muda já |

## 4 · Limites declarados (não escondidos)

1. **A cena aplica no próximo arranque.** Mudar a cor ou acrescentar um agente grava,
   mostra na lista e avisa «recarrega para a cena assentar». Não há recarregamento a
   quente da cena — e o painel diz isso em vez de fingir.
2. **As chaves não se escrevem pela interface.** `POST /api/platform/key` responde
   **501** com a razão: em produção as variáveis de ambiente são só de leitura. A
   interface continua a listar o que falta, que é o que é útil.
3. **Login não existe.** `/api/controlo/estado` devolve `seguranca.autenticacao: false`
   e a aba escreve «login: não configurado». Quem souber o endereço entra.
4. **Limite de 12 agentes por sala** — acima disso a sala passaria de seis filas e
   deixaria de caber no escritório. O servidor recusa com a razão escrita.
5. **Não há histórico de quem mudou o quê.** As alterações gravam-se, mas não há
   auditoria por utilizador (não há utilizadores).

## 5 · Provas

`controlo.test.mjs` — 16 provas que correm com `node --test`, sem rede (a última desenha o painel num DOM falso e confirma as seis salas e os três estados):

- `filasNecessarias`, `profundidadePara`, `lugarLivre`, `plantaAjustada`;
- a sala cresce com 11 agentes e **não encolhe** com zero;
- cor inválida recusada; vidro derivado mais escuro que o chip;
- agente novo entra na cena, na sala certa, e não duplica ao reaplicar;
- configuração estragada no armazenamento é ignorada (a cena abre na mesma);
- rotas a guardar e a devolver; `POST /platform/key` recusado com a razão;
- os três estados: `ligado` só com teste real, `a_funcionar` só com execuções nas
  últimas 24 h (uma execução com três dias já não conta).

Suite completa: **328/328**.
