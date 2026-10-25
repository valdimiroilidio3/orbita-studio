# Órbita

![Órbita — seis salas à volta do Cérebro, com o painel de Estado das Tarefas](assets/readme-hero.jpg)

Um escritório isométrico 3D onde agentes de IA fazem trabalho real no teu próprio login do Claude.

**Criado por Chelton Mahoze.**

Seis salas, trinta e cinco agentes nas secretárias, uma barra de tarefas que encaminha o
que escreves para a pessoa certa, e um Cérebro no centro que é a tua própria pasta de notas.
Escreves uma tarefa, o escritório entrega-a a quem deve, essa pessoa lê as tuas notas, usa os
conectores que já tens no Claude Code, faz o trabalho e arquiva o resultado de volta nas notas.
Tudo corre na tua máquina.

## O que precisas

- macOS, Linux ou Windows (no Windows usa os comandos `npm` diretamente, o `./setup` é Bash)
- Node.js 20+ — https://nodejs.org
- git
- **Claude Code** com sessão iniciada, ou uma `ANTHROPIC_API_KEY`

## Instalação

```bash
git clone <este-repositório>
cd agents-office-main
npm install
node build.mjs      # gera dist/command-centre-v2.html (o escritório num único ficheiro)
npm start           # → http://localhost:4520
```

Atalho: `./setup` faz as três coisas e arranca o escritório uma vez para testar.

## Os primeiros cinco minutos

1. Abre http://localhost:4520. O painel à direita diz **EM DIRETO · CLAUDE** quando o servidor
   está ligado. Abrir `dist/command-centre-v2.html` com duplo clique mostra o mesmo escritório
   sozinho, em modo de demonstração.
2. Na barra do topo do painel escolhe um departamento, escreve a tarefa em palavras simples e
   prime **Adicionar**. O Claude escolhe o agente e dá-lhe nome; a tarefa aparece na lista, o
   agente pega nela, trabalha, e o resultado cai na conversa desse agente e na tua pasta de notas.
3. Clica num agente para falares com ele. Responde no seu papel, ancorado nas tuas notas.
   Diz `revê: mais curto` e ele refaz a última entrega.
4. Prime **G**, ou clica no Cérebro, para ver as notas como grafo. Passa o rato numa nota para ver
   as ligações, clica para ler onde está e quem a leu ou escreveu.
5. A barra do topo mostra os conectores a que o teu Claude Code está ligado. Quando um agente usa
   um deles, o logótipo pulsa e o fio até esse departamento acende.
6. As primeiras entregas vão ser competentes e genéricas: os agentes conhecem o estúdio de exemplo
   e uma frase sobre o próprio trabalho. Aponta o Cérebro para as tuas notas e ensina-os a
   trabalhar contigo (abaixo). É aí que o escritório passa a ser teu.

## Conectores

A barra por baixo de **LIGADO A** é real: é a lista do `claude mcp list` nesta máquina, a mesma
que os agentes recebem como ferramentas. Gmail, Slack, Notion, Google Drive, Canva, o que tiveres
ligado em claude.ai ou adicionado com `claude mcp add`. Um servidor que precise de autenticação
aparece a cinzento com a razão ao passar o rato, e não é ligado a nenhuma sala até funcionar.
Nada ligado? A barra di-lo.

Os agentes podem chamar esses servidores enquanto trabalham, mais a pesquisa web. Nunca recebem
Bash, ferramentas de ficheiros nem sub-agentes. A regra permanente: lê à vontade; enviar,
publicar, pagar, apagar ou alterar só quando tu pedires.

## Os 35 agentes

| Sala | Quem lá está |
|---|---|
| **Comando** | ORBITA Director · Chefe de Gabinete · Analista de Resultados · Painel Central · Permissões e Conformidade |
| **Prospeção** | Lead Hunter · Enriquecador · Qualificador · Inteligência de Mercado · Análise Competitiva · Auditor de Websites |
| **Vendas** | Sales Closer · Propostas · Seguimentos · Receção de Clientes · Contratos · Comunicação com Clientes |
| **Design Lab** | Creative Architect · UI e Design System · Direção de Arte · Pesquisa UX |
| **Engenharia** | Systems Engineer · Gestor de Projetos · QA e Testes · Frontend · Backend e Integrações · Deploys e Infra · Documentação Técnica |
| **Media** | Growth Publisher · Conteúdo e Newsletter · Anúncios Meta · Redes Sociais · Vídeo · Calendário Editorial · Analytics de Conteúdo |

Cada agente tem: um papel, uma descrição do que faz, as ferramentas que pode usar, as
competências que segue e um briefing com as tuas instruções permanentes. Tudo isso se edita em
`office.agents.json` (ou em `office.agents.local.json`, que o git ignora).

## Rotinas: o escritório no seu próprio relógio

Uma rotina é uma tarefa com uma hora dentro, dita em português simples:

```
todos os dias úteis às 8h, triar a caixa de entrada e dizer-me o que precisa de mim
todas as segundas e quintas ao meio-dia, rever as propostas abertas
de hora a hora, das 9h às 17h, ver as campanhas de anúncios
a cada 30 minutos, verificar a fila de entrada
todas as sextas às 17h30, fechar a semana e escrever o resumo
```

O servidor cumpre a rotina ao minuto, mesmo com a página fechada. Se a rotina puder enviar,
publicar ou pagar algo, o resultado **espera pelo teu OK** antes de sair. As rotinas vivem em
`brain/Órbita/routines.json` e podem ser escritas à mão.

## O calendário (P)

Tudo no dia a que pertence: tarefas concluídas, o trabalho de hoje, tarefas agendadas e todas as
rotinas projetadas para a frente. Clica num dia para agendar uma tarefa, ou liga **REPETIR** para
começar uma rotina nessa data. Uma barra lateral lista as rotinas; clicar numa mostra só os dias
dela. Mês e semana, com modo escuro.

## As equipas: o líder divide, as secretárias trabalham

Prime **EQUIPA** ou diz «em equipa» na frase. O líder do departamento reparte o trabalho pelas
secretárias, todas trabalham ao mesmo tempo, deixam notas umas às outras e o líder escreve a
versão final. O número máximo de secretárias configura-se em `office.config.json` (`teams.max`).

## Qual modelo e quanto do teu plano

Sonnet, Opus ou Fable — por tarefa, por rotina, por agente ou para o escritório inteiro, com um
menu de esforço (Baixo a Máximo). A barra do topo mostra a sessão e a semana do teu plano quando o
Claude Code as expõe; sem login, mostra a contagem do próprio escritório.

## Ensinar os agentes

- **Entrevista**: abre a conversa de um líder e diz `configurar`. Ele faz-te cinco perguntas e
  escreve os briefings da equipa e uma competência para o trabalho que descreveste.
- **Correções**: quando devolves uma entrega com uma nota (`revê: …`), a lição fica registada em
  `brain/Órbita/feedback/<agente>.md`. Regras permanentes entram em todas as tarefas seguintes.

## Competências (skills)

Cada pasta em `skills/` é uma competência: um `SKILL.md` com cabeçalho (`name`, `description` e,
opcionalmente, `departments`/`agents`) e o procedimento em markdown. As tuas vivem em
`brain/Órbita/skills/<nome>/SKILL.md` e ganham em caso de nome igual.

## Configuração

`office.config.json`:

```json
{
  "name": "Órbita Studio",
  "brain": "./brain",
  "port": 4520,
  "model": "sonnet",
  "mcp": { "allow": [], "deny": [], "departments": {} },
  "tools": { "web": true, "browser": true },
  "teams": { "enabled": true, "max": 4 }
}
```

Variáveis de ambiente: `AO_MODEL` (modelo), `ANTHROPIC_API_KEY` (usa a API em vez da CLI),
`AO_PORT`. Alterações locais vão para `office.config.local.json` (ignorado pelo git).

## API

| Método | Rota | O que faz |
|---|---|---|
| GET | `/api/health` | versão, empresa, modelo, departamentos, agentes |
| GET | `/api/agents` | o elenco tal como está em disco |
| GET | `/api/brain` | o grafo de notas |
| GET/POST | `/api/tasks` | listar / criar tarefas |
| POST | `/api/tasks/:id/run` · `/revise` · `/approve` · `/reject` | correr, rever, aprovar, rejeitar |
| GET/POST | `/api/routines` | ler / criar rotinas |
| POST | `/api/chat` | falar com um agente |

## Verificação

```bash
npm run check         # 34 verificações locais (build, elenco, competências, rotinas, servidor)
npm run check:live    # uma tarefa e uma conversa a sério, pelo Claude
```

A única verificação que falha numa máquina sem Chrome instalado é a do navegador
(`npx playwright install chrome`).

## Estrutura

```
serve.mjs            servidor local + API
src/                 a página: cena 3D, painel, calendário, cérebro
brain/               as tuas notas (o Cérebro)
skills/              competências incluídas
office.agents.json   o elenco
office.config.json   nome, porta, modelo, equipas
data/                tarefas e estado (ignorado pelo git)
dist/                o escritório compilado num único HTML
```

## Licença e créditos

- **Órbita** — criado por **Chelton Mahoze**.
- Derivado de *Agents Office* (Sahni.ai), distribuído sob **PolyForm Noncommercial 1.0.0** com
  termos adicionais. Vê [LICENSE](LICENSE): uso pessoal e interno, sem revenda nem rebranding
  comercial do produto original.
- O texto original em inglês deste README está em [README.en.md](README.en.md).
