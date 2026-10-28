## 1.44.1 — 28 out 2026 · a prova aprende onde não vale a pena insistir

A primeira prova em produção (1.44.0, `GET /ia/provar-modelos?limite=12`) deu 2 provados
reais — `pollinations/openai` (3,3 s) e `pollinations/openai-large` (4,1 s) — e mostrou o
defeito: **9 das 12 tentativas foram ao OpenCode**, todas com «Free usage limit reached».
Um limite do fornecedor não se resolve a tentar o modelo seguinte dele.

- **Curto-circuito:** quando o erro é do fornecedor (`limite`, `credito`, `chave`, `semchave`),
  os modelos restantes desse fornecedor saem do lote e ficam em `saltados` com o motivo.
- **Prioridade:** chave própria no ambiente → keyless → chave publicada por terceiro. O lote
  passa a gastar-se onde há quota real.
- `provasDe` conserva as etiquetas declaradas no catálogo (provar não pode empobrecer o que a
  cadeia já sabia do modelo).
- `porProvarRestantes` passa a ser contado pelo que **não** foi tentado.

**Testes:** 550 (1 novo: um 429 a 6 modelos faz 1 pedido, não 6).

## 1.44.0 — 28 out 2026 · «Provar os por provar»: de descoberto a funcional

O 1.43.x descobriu o que os fornecedores têm e filtrou o que não conversa. Ficou a faltar
o passo que o dono pediu — **«faz com que uma boa parte dos outros também funcionem»**.
Descobrir não é funcionar: enquanto não houver uma resposta registada, o modelo é uma linha
bonita na mesa e a cadeia não conta com ele.

- **`POST /ia/provar-modelos`** (também `GET`, para verificação): pega nos modelos declarados
  e descobertos que ainda não responderam, faz **um pedido curto real a cada um** e grava a prova
  em `cfg.testes[fornec].provados`. É essa lista que põe o modelo na cadeia (`provasDe`), logo o
  efeito não é cosmético: o modelo passa a ser escolhido para trabalho.
- Tecto honesto para caber nos 60 s da função: 12 s por modelo, 4 em paralelo, 16 de cada vez,
  e a resposta diz quantos ficaram para a próxima chamada (`porProvarRestantes`).
- Não gasta pedidos em fornecedores sem acesso nem repete os já provados (`forcar: true` repete).
- **Mesa:** botão «Provar os por provar» no cartão «Modelos no motor», com a contagem
  «N provados» no cabeçalho; o toast diz quais responderam e quantos faltam.

**O que isto NÃO faz:** não promete que os 158 declarados respondem; um modelo que falha fica
com o motivo à vista e não é apagado. Só entra o que respondeu, com hora e latência.

**Testes:** 549 (3 novos: promoção só do que responde e entrada na cadeia; nenhum pedido em
fornecedor sem chave nem em já provado; rota GET e recusa de fornecedor desconhecido).

## 1.43.1 — 28 out 2026 · a descoberta não enche a cadeia de modelos que não conversam

A descoberta correu em produção e provou o ponto — e mostrou o problema. O OVH devolveu
`whisper-large-v3`, `nvr-tts-en-us`, `bge-m3`, `stable-diffusion-xl-base-v10`: são modelos reais
dele, mas **não respondem a uma mensagem**. Cada um seria uma tentativa perdida no meio da
cadeia, e o utilizador veria «todos os modelos falharam» com um fornecedor a funcionar.

`eModeloDeConversa()` exclui pela família do id (embedding, rerank, whisper/tts/asr, difusão,
imagem, moderação/guard, ocr). É uma lista de **exclusão**: na dúvida deixa passar, porque perder
um modelo bom é pior do que tentar um que falha uma vez. Tecto de 80 modelos descobertos por
fornecedor para a cadeia não crescer sem limite.

**Testes:** 546 (1 novo, com os ids que o OVH devolveu a sério).

## 1.43.0 — 28 out 2026 · os modelos que o fornecedor tem, e não os que eu escrevi à mão

Pedido: «já colocaste todos os modelos disponíveis? quero que coloques todos no motor, e também
na página mesa» e «faz com que uma boa parte dos outros também funcionem, para o sistema render
mais». O problema não era falta de fornecedores — eram **158 modelos declarados** e **3** do
Pollinations, quando o tier com chave publica dezenas. O sistema estava a usar uma fracção do que
já tinha pago.

**1 · Descoberta automática, com cache de 6 h.** `motor.descobrirSePreciso()` pergunta a lista
real a **todos** os fornecedores que se podem listar (chave, chave pública ou keyless) e guarda-a
na base (`cfg.descobertos`). Pergunta **uma vez a cada 6 h por fornecedor** — não há pedidos
repetidos, e uma falha é silenciosa porque descoberta é extra, não caminho crítico. Roda ao abrir
`/ia/gratuitos` (é o que a mesa lê) e no botão novo «Descobrir modelos» (`POST
/ia/modelos/descobrir` com `fornecedor: 'todos'`).

**2 · `paid_only` respeitado.** A lista do tier do Pollinations diz, modelo a modelo, se é pago.
`descobertosSalvos()` só deixa entrar `paid_only === false`; sem essa marca (todos os outros
fornecedores) não se presume nada. Um modelo pago nunca entra na cadeia como gratuito.

**3 · Etiquetas do que é afirmado, não do nome.** `etiquetasDoModelo()` usa `tools`, `reasoning`,
as modalidades de entrada e o contexto que a própria lista declara; o `etiquetasDoId()` continua a
ser a adivinha para quem não declara nada. Assim um modelo de visão descoberto não fica «texto».

**4 · `listarModelosDetalhados()`.** Nova função no cliente: devolve `{id, pago, ferramentas,
raciocinio, janela, visao}` em vez de só ids. O `listarModelos()` antigo fica igual — não parti
nada de quem já o usava.

**5 · A mesa passa a mostrar os modelos, não um contador.** Cartão novo «Modelos no motor»:
todos os modelos utilizáveis agora, agrupados por fornecedor, com etiquetas, contexto, e o estado
honesto de cada um — `provado` (há resposta registada), `descoberto` (o fornecedor disse que o
tem), `com chave`, ou `declarado`. Cada linha tem «Provar», que faz **um** pedido curto real.
O cartão «IA gratuita» ganhou o botão «Descobrir modelos».

**O que isto NÃO faz:** não inventa quotas nem chaves. Os fornecedores sem chave continuam a
aparecer como `sem chave`, e os modelos descobertos aparecem como `descoberto` até responderem.
Um catálogo maior não é a mesma coisa que um catálogo funcional — é por isso que cada linha diz
em que estado está.

**Testes:** 545 (540 + 5: `paid_only` fora da cadeia, fornecedor com chave fechada, catálogo sem
duplicados, cache de 6 h a não repetir pedidos, e a rota «todos» de ponta a ponta).

## 1.42.0 — 28 out 2026 · as gratuitas a sério: Pollinations com chave, padrão gratuito, `/ia/diagnostico`

Pedido: «coloca IAs a sério no motor e as APIs; o padrão será uma gratuita» e «usa também
esta IA gratuita» (Pollinations), mais a Tavily e o Geoapify. O que se fez, com o que ficou
por provar dito à letra.

**1 · O Pollinations passou a ser falado a sério.** O `freellmapi` só conhecia o tier anónimo
(`text.pollinations.ai/<prompt>`, um GET, 1 pedido/15 s). A 28 out 2026 medi que existe um
tier OpenAI-compatível com chave, em `gen.pollinations.ai/v1`, com modelos que o anónimo não
vê. O cliente tem agora dois caminhos: **com `POLLINATIONS_API_KEY`** fala
`POST https://gen.pollinations.ai/v1/chat/completions` com `Authorization: Bearer`, ferramentas
e o modelo do tier; **sem chave** fala `POST https://text.pollinations.ai/openai` (OpenAI-compatível,
aceita `tools`, ao contrário do GET antigo) com o `openai-fast`. `listarModelos` lê o catálogo
certo em cada caso. **Prova real:** `GET gen.pollinations.ai/text/…?model=openai&key=…` devolveu
`órbita`; o anónimo devolveu `orbita`. A chave nunca viaja em URL dentro da aplicação (o
`?key=` só foi usado no teste manual, porque o sandbox não tem rede de saída).

**2 · O padrão do motor é uma gratuita.** `preferidoDoAmbiente()` decide, a partir do ambiente,
por onde começar: com a chave do Pollinations, o motor e o fornecedor `gratis` começam por ele;
sem chave, pela cadeia anónima (LLM7 → OVH → OpenCode Zen → Pollinations anónimo). O preferido
pode ser um **fornecedor** (`modelo: null`) e não um modelo fixo — assim cada tipo de trabalho
usa o melhor modelo desse fornecedor (o `openai-large` para plano/raciocínio, o `openai` para
texto/visão/rápido). Medido no router: `plano → pollinations/openai-large`,
`rapido → pollinations/openai`, `visao → pollinations/openai`. Um modelo fixado em `ai.models`
continua a ganhar.

**3 · `soComChave`.** Os modelos do tier (`openai`, `openai-large`) só existem com chave. Sem
esse campo, o router punha-os na cadeia anónima e gastava uma tentativa garantidamente falhada
— foi o que o novo teste do diagnóstico apanhou. Agora o router e `/ia/diagnostico` filtram-nos.

**4 · `GET /ia/diagnostico`.** Um pedido curto e real a cada fornecedor activo, com tecto de
tempo, e a resposta com quem tem chave, que modelo respondeu, quanto demorou e o texto. Não
grava nada (para isso é `/ia/testar`). `?fornec=pollinations` limita a um. Correu contra o
servidor local: a rota responde 200 e regista «sem ligação: fetch failed» por fornecedor — este
sandbox não tem rede de saída, e é isso que se lê em vez de um «ok» inventado.

**5 · Prontidão.** O grupo «Motor de IA» passou a reconhecer o Pollinations como a chave
gratuita que é, e ganhou o conceito de item **opcional**: um extra em falta já não deixa a
função «desligada». A chave paga continua listada como opcional.

**6 · Correio de testes que estava vermelho no `main`.** `segredos.test.mjs` falhava desde antes
desta versão: as fixtures de `prontidao.test.mjs` tinham o formato exacto de chaves verdadeiras
(`sb_secret_…`, `tvly-…`, URL Postgres com password). Passaram a `sb_secret_FAKE`, `tvly-FAKE` e
uma URL sem password — a guarda continua a apanhar chaves a sério, e a suite voltou a verde.

**7 · Tavily e Geoapify, agora provados em produção.** O Geoapify respondeu a sério (Coimbra →
`40.2111874, -8.4291478`, `place_id`, `Europe/Lisbon`). A Tavily foi medida **depois do deploy**,
em produção, pelo `GET /pesquisa/teste?fonte=tavily`: `ok:true`, `status 200`, **«2 resultado(s)
reais»**, 4,0 s. A suspeita de «chave recusada» era do teste errado — o `GET` com `?api_key=`
responde `Unauthorized`, e o caminho verdadeiro é o que o código já usava: `POST` com
`Authorization: Bearer`. A pesquisa web funcionou de ponta a ponta (`/pesquisa/web` → 3 fontes
reais e resposta curta em 1,8 s).

**8 · Deploy e provas em produção (28 out, 07:33 UTC).** `dpl_4tyGn5x9JdmG8LegMNnTkDwZUPGU`,
`READY` e `PROMOTED`, a partir de `main` `3d008ae`; `orbita-agentes.vercel.app/api/health` →
`versao: 1.42.0`. `/ia/diagnostico` em produção: **2 de 5 responderam** — `llm7/codestral-latest`
(1856 ms) e **`pollinations/gpt-5.4-nano-2026-03-17` (3416 ms)**, ambos com a resposta «órbita»;
é a prova de que a chave do Pollinations vale no tier (`gen.pollinations.ai/v1`). A cadeia de
`/ia/gratuitos` começa em `pollinations/openai-large` (plano, texto, investigar, revisão) e
`pollinations/openai` (rápido) — **o padrão é a gratuita**, como pedido.
O `health` passou a dizer `ok:false` com `mensagensErro: «a base existe mas falta o esquema
(corre supabase/orbita_mesa.sql)»`: é o 1.41.0 a olhar para as colunas, e a base de produção
ainda não tem a mesa aplicada. Fica declarado, não escondido — aplicar o SQL exige saber o que
já lá está (a armadilha do `orbita_schema.sql` descrita abaixo).

**9 · Com chave ou só anónimo, dito no estado.** `GET /ia/estado` ganhou `comChaveAgora`: o
Pollinations é keyless *e* tem tier, e sem este campo o painel não distinguia os dois motores.

**Testes:** 540 (534 + 6 novos: o padrão do Pollinations, o `listarModelos` do tier, a rota
`/ia/diagnostico` com resposta e sem rede, a cadeia por tipo, os modelos `soComChave` fora da
cadeia anónima e o estado com/sem chave). Suite 540/540 ·
`scene.smoke.mjs` ✓ · `mesa.smoke.mjs` ✓ · `npm run build` ✓ (1553 KB) · `check.mjs` 94/95
(a falha de sempre: WebGL falso no harness).

## 1.41.0 — 28 out 2026 · lançar a sério: produção em dia, `/api` provado, SQL inteiro, chaves certas

Pedido: «implementa 1+2+3+4». Os quatro itens eram *publicar*, *ter `/api` a responder*,
*aplicar o SQL* e *ter as variáveis certas*. Fazer isto revelou três defeitos que só se vêem
do lado de fora.

**1 · A produção estava 11 versões atrás.** O `/api/health` dizia `1.29.0` (commit `3c00e5b`,
PR #59) enquanto o `main` já ia na 1.40.0: os treze merges seguintes criaram **previews** e
nenhum promoveu produção. O site público mostrava o rodapé «1.0.0» e o botão «afastar» antigo.
Produção promovida a partir do `main` e confirmada no próprio `/api/health` → `versao: 1.40.0`.

**2 · O `/api/health` rebentava sem base.** Usava `ia` no ramo de erro e só o declarava seis
linhas abaixo: `ReferenceError: Cannot access 'ia' before initialization`. Em produção, sem
chaves, isso é um **500 da Vercel** em vez de um 503 explicativo. Corrigido e preso por um teste
que chama o handler com o ambiente vazio.

**3 · Dois nomes para a mesma chave.** O painel dizia «Resend configurado» com
`ORBITA_EMAIL_FROM`, e o envio real lia `ORBITA_FROM_EMAIL` — caía em `onboarding@resend.dev`.
O mesmo com o Supabase, que o painel só reconhecia como `SUPABASE_SERVICE_ROLE_KEY`. Agora há
uma função (`remetente()`) e um conjunto de nomes aceitos, os mesmos em todos os sítios.

**4 · O SQL aplicava-se a meio.** O `/api/setup` corria só `orbita_ia.sql`, num único `query`
sem transacção, e respondia «ok» mesmo com metade das tabelas em falta. Agora aplica
`orbita_mesa.sql` → `orbita_ia.sql` → `orbita_1_37_0.sql`, **um ficheiro por transacção**, e diz
quantas tabelas da mesa existem mesmo. E recusa aplicar `orbita_schema.sql` — o desenho da
migração do SQLite, que cria `orbita_leads` com `company_name`/`lead_status` e, se corresse
primeiro, deixava a mesa sem as colunas que usa (o `if not exists` seguinte era ignorado em
silêncio).

**5 · A prontidão, num sítio só.** `api/_prontidao.mjs` lista as variáveis por grupo, com os
nomes alternativos que o código aceita e o que se perde SEM cada uma — nunca valores. Lê-se em
três sítios que dizem o mesmo: `npm run prontidao` (terminal, sai com 1 se faltar algo crítico),
`/api/health` (resumo) e `GET /sistema/prontidao` (completo, pela rota normal).

**6 · A saúde passou a olhar para as colunas.** `faltam: []` só provava tabelas. O `1.37.0`
acrescentou `subject`, `to`, `from`, `provider` e as datas a `orbita_messages`; sem elas o
`SELECT *` responde 200 e o `INSERT` rebenta com 400 («column does not exist») — o defeito real
de 27 de outubro. O `health` faz agora um `select` dessas colunas e devolve `mensagensProntas`.

**Documentação:** `docs/LANCAMENTO.md` reescrito (dizia 1.14.0 e afirmava que a nuvem «não tem
`/api/*`», o que já era falso), `.env.example` completo e comentado por grupo.

**Testes:** 533/533 — 14 novos em `prontidao.test.mjs` (lista e alternativas, nenhum valor no
retrato, token curto não conta, esquema pela ordem certa com rollback, `?so=`, rota de prontidão,
`/api/health` sem base a responder 503, `/api/setup` sem token a responder 404, colunas do envio).

**Limitação declarada:** a promoção a produção foi feita pela API do Vercel com `target=production`
sobre o `main`; a integração Git continua a criar apenas previews para ramos `arena/*` — o
lançamento é o merge, e a prova é o `/api/health`. As chaves em falta (pesquisa, correio,
WhatsApp) só o dono as cria, e o painel diz quais.

## 1.40.0 — 28 out 2026 · a luz acende, a operação respira, o «afastar» aparece

O dono pediu quatro coisas: «leds a acender realmente», «o campo de operações bem
funcional e activo», «o Centro de Controlo 100 % funcional ao site mudando
permanentemente, em tempo real», e «o botão afastar mais visível e mais elegante».
Nenhuma delas se resolve com um tema novo.

**1 · A luz vem do trabalho (pedido: «falta iluminação, ganhando vida»).**
Novo módulo puro `src/leds.js` — `alvo`, `respirar`, `acender`, `aproximar`,
`luzDaSala`, `fimDoArranque` — com os números num sítio só (`LUZ`). Cada uma das
seis salas ganha uma `PointLight` própria, no alto, e os materiais que já emitiam
(fitas de LED, aro, ecrã e derrame da porta) passam a ter brilho variável. A
intensidade lê `deptCount(..., 'live'|'waiting')`: **a sala com três tarefas está
mais acesa do que a sala vazia**, e isso vê-se. Sem trabalho não há escuridão —
há um repouso baixo (0,34), porque um escritório apagado é um armazém. Com
trabalho, a sala acende em 620 ms; quando o trabalho acaba, despede-se devagar
(1,4 s de propósito). No arranque, as salas acendem uma a uma (95 ms entre cada)
e o **Cérebro nunca se apaga** — pulsa baixinho, é o centro. Quem pediu menos
movimento (`prefers-reduced-motion`) recebe a luz sem cintilar e sem respirar.

**2 · Operações ao vivo, e sem apagar o que estás a escrever.** A gaveta lia de
15 em 15 segundos e **repintava tudo** — levava consigo um lead meio escrito e o
cursor de quem estava a mudar a fase. Agora: a leitura automática (12 s) **espera
enquanto houver um formulário aberto ou foco num campo**; quando os dados são os
mesmos, não repinta nada; e um ponto no cabeçalho diz a verdade — «ao vivo», «há
12 s», «sem servidor» — em vez de um relógio imaginário. O «Atualizar» e as
acções lêem sempre: são gestos explícitos.

**3 · Centro de Controlo: cada sala diz o que está a fazer AGORA.** Os cartões
das seis salas passaram a mostrar o trabalho real da cena
(`window.ORBITA.trabalho`, a mesma conta que acende a luz), actualizado de 3 em
3 segundos **sem reconstruir o painel**. A entrada do painel deixou de animar
`filter: blur` durante 420 ms: nasce do canto de onde é chamada
(`transform-origin: top right`) em 240 ms, só com `transform` e `opacity`.

**4 · O botão «afastar».** Era um quadrado de 30 px com um glifo de texto. É
agora uma cápsula de 38 px, com ícone desenhado (duas setas viram-se para cima
quando está recolhido), rótulo em versaletes e estado `aria-pressed`. Ganha
contraste no hover (só em `hover: hover`) e assenta num fundo sólido quando está
recolhido, para não desaparecer sobre a cena clara.

**Testes:** 520/520 — 14 novos: 8 do modelo da luz (`leds.test.mjs`), 4 da gaveta
viva (`ops-vivo.test.mjs`: guarda de foco, sem repaint sem novidade, «ao vivo» e
«sem servidor»), 2 do Centro de Controlo ao vivo. O fumo da cena passou a olhar
para as lâmpadas: seis salas com lâmpada, a intensidade a seguir o modelo e o
Cérebro sempre aceso. `npm run build` ✓, `mesa.smoke.mjs` ✓.

**Limitação declarada:** o tamanho (profundidade) de uma sala continua a aplicar-se
no arranque seguinte — a geometria não se reescala a meio sem partir as portas; o
painel diz isso em vez de fingir. E os testes da luz correm com o WebGL falso do
`jsdom`: provam a conta e o valor aplicado à cena, não o que os teus olhos vêem.

## 1.39.0 — 27 out 2026 · todas as gratuitas, provadas com um clique

«Implementa todas as gratuitas» não se cumpre a listar: cumpre-se a provar. O
catálogo já tinha os modelos; o que faltava era o caminho entre «existe» e
«respondeu» — e o escritório a arrancar sem chave nenhuma.

**1 · `POST /ia/provar-gratuitas`.** Percorre os fornecedores que **não pedem
chave nova** — os keyless (LLM7, OVH, Pollinations) e os que publicam a chave
(OpenCode Zen) —, faz um pedido real a cada um (até três modelos por fornecedor,
tecto de 6 fornecedores por chamada) e grava o resultado na mesma prova que
`/ia/testar` usa. Só o que responde passa a `funcional`; o que falha fica com o
motivo escrito, um por um. Sem resposta real, a resposta é `ok: false`.

**2 · Um botão, não uma tabela.** No cartão «IA gratuita» do Control Center há
agora **«Provar todas as sem chave»**. Carrega-se, corre, e a lista deixa de ter
«por provar».

**3 · O escritório arranca sem chave — provado.** Um teste corre o motor real do
escritório (`providers.mjs`) com o ambiente limpo de chaves: o motor activo é a
cadeia gratuita (`gratis`), o `ask` devolve texto, o `modelId` diz **quem**
respondeu (`llm7/codestral-latest`) e `tools` vem vazio — porque esta cadeia
escreve e não mexe. É isto que faz a diferença entre «há uma IA configurada nesta
máquina» e «as salas conseguem começar a trabalhar».

**Testes:** 506/506 (5 novos: prova keyless com `fetch` falso, falha com motivo,
tecto respeitado, escolha explícita de fornecedores, e o arranque do escritório
sem chaves). Fumo da mesa verde; `check.mjs` 94/95 (falta Chromium).

**Limitação declarada:** o `fetch` é falso e o contrato é o real. A prova de rede
acontece em produção no momento em que se carrega no botão — e o resultado fica
gravado em `/ia/gratuitos`, não numa frase deste registo.

## 1.38.0 — 27 out 2026 · mandar mensagens a sério (e o funil a andar)

O dono foi taxativo: «mandar mensagens aos clientes tem de ser real e muito
funcional». O envio já existia por dentro, mas faltava o que separa «tem código»
de «funciona»: provas por canal, o funil a mexer, e o WhatsApp a sair sozinho
quando há chaves.

**1 · Prova do envio, com o fornecedor simulado no contrato real.** Nove testes
novos: o email sai para `api.resend.com/emails` com o `from` configurado, o
assunto e o texto; fica `enviada` com `provider`, `provider_id` e `enviada_at`; o
mesmo envio duas vezes é **409 e não sai um segundo email**; sem
`RESEND_API_KEY` é **503** e a mensagem continua `aprovada` (não se marca como
falhada o que não se tentou); uma recusa do fornecedor (422) é **502** com o
motivo guardado e permite **repetir**; uma falha de rede deixa `erro: rede: …` e
nunca finge envio; o WhatsApp monta a chamada certa à Graph API (número só com
dígitos, `messaging_product`) e devolve o `wamid`.

**2 · O funil anda.** Enviar não é responder, mas não pode ficar tudo parado: quem
estava `novo` passa a `contactado` quando o envio sai. Não se toca em quem já
respondeu, é reunião, cliente ou perdido — o funil só anda para a frente.

**3 · WhatsApp automático primeiro, link depois.** Ao aprovar uma mensagem de
WhatsApp, a mesa tenta o envio real; se não houver chaves, diz porquê e abre o
link `wa.me` como antes. O caminho manual deixou de ser o único — e continua a
haver um humano a confirmar quando não há credenciais.

**4 · SQL que faltava, versionado (1.37.0).** `supabase/orbita_1_37_0.sql` traz as
colunas que o envio/recepção usavam e não estavam no esquema (`provider_id`,
`enviada_at`, `canal_confirmado`, `erro`, `id_externo`, `direction`,
`recebida_at`, …), o CHECK de estado alargado e os índices. **Tem de ser corrido
no Supabase** — sem isso, o envio devolve 400 do PostgREST.

**Testes:** 501/501. O fumo da mesa continua verde.

**Limitação declarada:** as provas são contra o contrato dos fornecedores, com
`fetch` simulado — **nenhum email nem WhatsApp verdadeiro saiu daqui**, porque
faltam `RESEND_API_KEY`, `ORBITA_FROM_EMAIL`, `WHATSAPP_TOKEN` e
`WHATSAPP_PHONE_ID`. A primeira mensagem real tem de ser enviada com essas chaves
e o `provider_id` guardado; só então isto passa de «por provar» a «funcional».

## 1.37.0 — 27 out 2026 · as respostas voltam, e a mesa vive no teu computador

Três buracos que só se vêem a usar: o cliente respondia e ninguém sabia; a mesa
publicada ficava «a carregar» a IA para sempre; e no telemóvel não havia X para
sair. Fecharam-se os três.

**1 · As respostas dos clientes (o lado que faltava).** Até aqui a mesa mandava e
ficava à espera. Agora há dois webhooks — `POST /api/webhooks/whatsapp` (Meta) e
`POST /api/webhooks/resend` (email) — que recebem, **verificam a assinatura**
(Svix no Resend, `x-hub-signature-256` na Meta), encontram a pessoa certa (primeiro
pela mensagem a que se responde, depois pelo telefone/email) e gravam a resposta
na conversa. O lead passa a `respondeu`, mas **quem já é cliente não anda para
trás**. É idempotente: a Meta repete o webhook quando não recebe 200, e a mesma
resposta nunca aparece duas vezes. Uma resposta de quem não está no funil não se
perde — fica registada com o remetente e sem lead. Os estados «entregue» e «lido»
actualizam a mensagem que saiu em vez de criar outra. Sem segredo configurado,
o webhook **recusa** (503): nunca se aceita um POST anónimo a fingir de cliente.

**2 · A mesa fala com o servidor também no teu computador.** Novo `/api/rpc` no
`serve.mjs` com o mesmo envelope da Vercel (`{status, corpo}`), sobre um ficheiro
`data/mesa.json`. Consequência prática: em `npm start`, a mesa deixa de cair em
«modo local» e passa a ter leads, conversas e Control Center reais — e no preview.
O ficheiro é teu: vê-se, copia-se e leva-se.

**3 · X para sair da mesa, também no telemóvel.** Em ecrãs estreitos a barra
lateral desaparece — e o X ia com ela. Passa a haver um X fixo (44 px) no canto,
com nome acessível, que leva ao escritório.

**4 · As gratuitas passam a ser uma escolha.** No canto de IA do escritório, cada
modelo gratuito **provado** é um botão: clicar fixa-o (`POST /api/ai/switch` com
`provider: 'gratis'` e o modelo) e a escolha fica em `data/ai.json`, sobrevivendo a
um reinício. O motor continua a cair para os restantes se esse falhar — fixar é
preferir, não é ficar sem motor. As que ainda não responderam continuam à vista,
a cinzento: não se escolhe o que não se provou.

**5 · SQL que faltava, versionado.** O envio já escrevia `provider_id`,
`enviada_at`, `canal_confirmado`, `erro` e a recepção precisa de `id_externo`,
`direction`, `recebida_at` — colunas que **não estavam** em `supabase/orbita_mesa.sql`.
Numa base criada só do repo, o envio respondia 400 do PostgREST. Há agora
`supabase/orbita_1_37_0.sql`, idempotente, com as colunas, o CHECK de estado
alargado (`ensaio`, `falhou`, `bloqueada`, `revisao`, `recebida`) e os índices.

**Testes:** 499/499 (13 novos da recepção, 1 do modelo fixado, 1 do modo local) e
o fumo da mesa a confirmar o X do telemóvel, a resposta do cliente no histórico e
a edição de leads. `node check.mjs` 94/95 (falta Chromium).

**Limitação declarada:** a assinatura e a normalização foram provadas contra os
corpos reais dos fornecedores, mas **ainda não houve um evento verdadeiro** (faltam
`WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `RESEND_WEBHOOK_SECRET` e uma conta
Meta). E o deploy de produção continua bloqueado do meu lado (limite de 100/dia).

## 1.36.0 — 27 out 2026 · editar o lead sem sair da mesa

Faltava o «actualizar» do pedido 57e: a API já aceitava `PATCH /ops/leads/:id`,
mas a mesa não tinha por onde. Quem via um telefone errado tinha de o apagar e
criar outro — e com ele ia o histórico.

**1 · «✎ Editar» na página do lead.** Abre um formulário com os campos que a API
aceita — telefone, email, site, nicho, cidade e notas. O funil (novo →
contactado → …) continua a ser decidido pelos botões do funil: dois caminhos para
a mesma decisão davam duas verdades.

**2 · Validação antes de escrever.** Um email sem `@` ou um telefone com dois
dígitos não vão para a base para voltarem como erro genérico: a mesa recusa e diz
porquê, e o formulário fica aberto com o que estava escrito. O site aceita-se à
mão (`empresa.pt`) e é guardado como `https://empresa.pt`.

**3 · Campo vazio apaga.** «Não sei» é melhor do que um telefone errado: deixar
um campo vazio remove o que lá estava. O que não é tocado não se perde — e as
notas, o histórico de mensagens e a data de contacto ficam como estavam.

**4 · Igual no browser e na base.** O modo local (`src/localapi.js`) ganhou o
mesmo `PATCH`, com a mesma regra de «só os campos que vêm»: quem está sem base
consegue editar exactamente como quem está ligado, e a cópia de segurança leva a
alteração.

**Testes:** 486/486; o fumo da mesa passa a abrir um lead, carregar em Editar,
gravar telefone/email/site e confirmar no armazém do browser — e ainda que um
email torto **não** é guardado.

## 1.35.0 — 27 out 2026 · a IA gratuita que começa os trabalhos

Pedido: *«implementa uma IA para começar os trabalhos, implementa todas
gratuitas»*. O escritório (`providers.mjs`) só sabia falar com motores que exigem
chave ou um CLI instalado — numa instalação limpa não havia motor nenhum e as
salas não arrancavam. As gratuitas existiam no `api/_ia`, mas não na camada que
executa o trabalho.

**1 · Um motor «Gratuitas (sem chave)» no escritório.** Novo fornecedor `gratis`
(`style: 'orbita'`) que usa a cadeia do `api/_ia`: **LLM7 → OVH → OpenCode Zen →
Pollinations**, pela ordem que foi medida em produção. Sem chave, sem conta, sem
CLI. Quando há um motor com chave, esse continua à frente; sem nada, é este que
assume — por isso um ambiente novo já trabalha.

**2 · Fallback a sério.** Um pedido que falha num fornecedor passa ao seguinte e
diz qual respondeu (`modelId` = `fornecedor/modelo`). Quando todos falham, o erro
nomeia cada um e o que disse — não se inventa uma resposta. O runner continua a
declarar `tools: false`: esta cadeia escreve, não mexe.

**3 · Provado com uma corrida completa.** Um teste novo corre o orquestrador do
princípio ao fim — plano, dois passos, revisor — com o `fetch` a responder como o
LLM7 e o OVH responderiam, sem uma única chave, e verifica que os passos ficam
gravados com saída, estado `concluido` e o fornecedor certo. Outro teste desliga
todos os gratuitos e confirma que a execução **falha com a razão escrita**, em vez
de ficar a correr para sempre.

**4 · Todas as gratuitas, e as que faltam por chave.** Sem chave funcionam hoje
quatro fornecedores (LLM7, OVH, OpenCode Zen e Pollinations). Os que têm nível
gratuito mas exigem chave — Groq, Google AI Studio, Mistral, NVIDIA NIM,
OpenRouter `:free` — já estão no catálogo e entram na cadeia **sozinhos** no
momento em que a chave aparecer no ambiente; não foi preciso código novo para
eles, e a interface diz qual falta.

**Testes:** 485/485 (5 do motor gratuitos, 2 da corrida), `node check.mjs` 94/95
(falta o Chromium, como antes).

**Limitação declarada:** este sandbox só alcança github/npm/pypi, por isso a
prova foi feita com respostas HTTP simuladas no contrato dos fornecedores; a
prova de rede é o primeiro trabalho real depois do deploy. E o envio por
WhatsApp/Google continua a depender de credenciais que só o dono cria.

## 1.34.0 — 27 out 2026 · sair da mesa, a IA que não fica a carregar, leads e mensagens reais

Pedido do dono, em quatro frases: um X para voltar, a IA que ficava em «A
carregar o Control Center…», os leads a funcionar na mesa, e conversas que sejam
mesmo reais.

**1 · X para sair.** A mesa é uma página inteira e só se saía pelo endereço. Há
agora um X ao lado da marca (34 px, com nome acessível «Fechar a mesa e voltar ao
escritório») que leva a `/`. Fica no canto onde se procura, não no fim da página.

**2 · A IA deixou de ficar presa.** O defeito não era o motor: era a leitura
falhar e a vista não ter estado de erro. Duas causas, ambas corrigidas:
- a mesa trata o `status` **dentro** do envelope do `/api/rpc` (a resposta HTTP é
  200; o 404 viaja no JSON). Antes isso era um erro que abortava `carregarIA`, e
  a vista ficava em «A carregar…» para sempre;
- `carregarIA` guarda a razão em `S.iaErro`, continua a mostrar o último estado
  bom com um aviso em cima, e a vista oferece **Tentar outra vez** em vez de um
  esqueleto eterno.

**3 · Todas as gratuitas à vista, também no modo local.** O modo local listava
zero fornecedores. Agora lista os quatro motores sem chave — LLM7, OVH, OpenCode
Zen e Pollinations — com o modelo e o limite reais (`GRATUITOS_LOCAIS`, espelho do
catálogo do servidor, com teste que impede a divergência) e diz que provar exige
o servidor, em vez de oferecer um botão que não pode funcionar.

**4 · O canto da IA ganhou vida.** O rodapé do painel IA era uma frase fixa («Um
CLI dá mãos…»). Passou a ler `/ia/gratuitos` (por `/api/ia/gratuitos`, com o
`/api/rpc` como alternativa na Vercel) e a dizer: o que o **motor actual** faz
(recebe ferramentas e mexe, ou só escreve), as gratuitas **provadas** com ✓, as
**por provar** com ·, a frase do estado, e um atalho «ver todas na mesa». Sem
servidor diz que não conseguiu ler — não inventa modelos.

**5 · Leads na mesa, a sério.** A mesa tinha o funil e o lead, mas a pesquisa real
só existia no escritório. Agora há um cartão «Procurar leads reais»: nicho, zona e
quantos; chama `POST /pesquisa/leads` (Geoapify, com dedupe), guarda no funil e
recarrega a lista. **Procurar mais** repete com mais 20 até 100 — o fornecedor não
tem paginação, tem teto, e é isso que o botão diz. **↻ Actualizar** volta a ler a
base. No modo local a procura responde 503 com a razão (a chave vive no servidor).

**6 · Conversas reais: o envio que nunca chegava a existir.** A mesa chamava
`/ops/messages/:id/approve`, `/send`, `/reject`, `/confirm`, `/promover` e
`/sinal` — em inglês. A API só tinha `aprovar` e `rejeitar`; tudo o resto era
**404**. O fluxo de mensagens estava partido desde a 1.21 e o sintoma era «não
funciona». Agora:
- os dois nomes valem (o português é o canónico, o inglês é o que está publicado);
- `enviar` faz um pedido **real**: email pela **Resend** (`RESEND_API_KEY`,
  `ORBITA_FROM_EMAIL`) e WhatsApp pela **Cloud API** (`WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_ID`). Sem chave é 503/501 com o nome da variável — nunca «enviada»;
- o estado só passa a `enviada` quando o fornecedor devolve um id; um erro deixa a
  mensagem em `falhou` com o motivo e um botão «Tentar outra vez»; enviar duas
  vezes é 409; aprovar antes de enviar é obrigatório;
- `confirmar` continua a marcar enviada à mão, e diz que foi um humano; um sinal
  «respondeu»/«recusou» move o lead no funil;
- no email, o botão da mensagem aprovada passa a «Enviar agora»; no WhatsApp
  continua «Abrir WhatsApp» + «Já enviei».

**Testes:** 478/478 (8 novos em `mensagens-envio.test.mjs` e 6 em
`ia-vista.test.mjs`), `mesa.smoke.mjs` a verificar o X, a vista IA sem «A
carregar», os quatro motores sem chave e o cartão de procura de leads.
`node check.mjs`: 94/95 (falta o Chromium, igual a antes).

**O que ainda não está feito, sem rodeios:** entrada com conta **Google** não
existe — precisa de `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` criados pelo dono e
de um redirect `/auth/google` aprovado no projeto. O envio automático por
WhatsApp também exige as credenciais da Cloud API; até lá, o WhatsApp abre na app
e a confirmação é humana — e é isso que a interface diz.

## 1.33.1 — 27 out 2026 · provar um modelo gratuito, e o estado honesto na mesa

Continuação do 1.33.0: a ligação existia, faltava a prova modelo a modelo.

**1 · «Provar» um modelo, não só um fornecedor.** O cartão novo **IA gratuita**
mostra os dois grupos: os **provados** (com resposta registada e latência) e os
**por provar**, cada um com o botão «Provar». O botão chama `/ia/testar` com
`{fornecedor, modelo}` e faz **um** pedido curto a esse modelo — só se ele
responder é que sai da lista. Se o fornecedor responder por outro modelo, o
toast di-lo («respondeu com X, não com o Y») e o Y continua por provar. O
resultado fica em `/ia/uso` e em `cfg.testes[fornecedor].provados[modelo]`; a
lista real do fornecedor (`lista`) e as provas anteriores sobrevivem a um teste
que corra mal.

**2 · 402 com retry.** O `402` (Pollinations usa-o para o limite por IP) passa a
ser explicitamente retentável noutro fornecedor, em vez de morrer ali.

**Testes:** 464/464, com 11 novos em `ia-gratuitos.test.mjs`: o GET do Pollinations
sem chave, o `Bearer public` do OpenCode a responder quando os outros falham, o
teste real do Pollinations a guardar a lista, a descoberta a alimentar a cadeia (e
a recusar modelos pagos num gateway), a separação provados/por provar, e a prova
a promover um modelo — incluindo o caso em que o fornecedor responde por outro
e isso **não** conta como prova, e o caso em que uma falha não apaga a lista.

**Limitação declarada:** o sandbox desta sessão só alcança github/npm/pypi, por
isso o POST ao OpenCode e o GET ao Pollinations a partir da app ficam por testar
aqui — o endpoint do Pollinations foi provado por HTTP directo e o OpenCode por
`GET /models`. A prova final é `/ia/testar` em produção depois do deploy.

**Testes:** 464/464 (4 novos), 94/95 no check (falta Chromium).

## 1.33.0 — 27 out 2026 · OpenCode Zen e Pollinations, sem chave do dono

Pedido do dono: *«liga»* — as duas IA gratuitas que não precisam de nenhuma chave
sua, depois da lista do 1.32.0.

**1 · OpenCode Zen (`opencode.ai/zen/v1`).** O serviço publica a chave dos modelos
gratuitos (`Authorization: Bearer public`), por isso passa a trabalhar sem conta:
`chavePublica` no catálogo, tratada em `comChave`, no router e no motor — a chave
é a que o serviço indica, não uma inventada. Nove modelos `-free`, lidos de
`GET /models` a 27 out 2026: `big-pickle`, `beam-free`, `flint-40b-free`,
`mimo-v2.6-flash-free`, `nemotron-3.5-lightning-free`,
`nemotron-3.5-super-vl-free` (**visão** — a segunda fonte com olhos, a par do OVH),
`jev-1.13-free`, `deepseek-v4.1-flash-free`, `glm-5.3-flash-free`.

**2 · Pollinations (`text.pollinations.ai`).** O tier anónimo é um **GET** com o
prompt no caminho, não um `POST` OpenAI: novo dialeto `pollinations` no cliente
(`GET /<prompt>?model=…&system=…`, texto simples de volta, sem cabeçalho de chave).
Provado a 27 out 2026: devolveu a palavra pedida. É lento por desenho (1 pedido a
cada 15 s), serve para desempatar quando o OVH responde 429 — o mesmo GPT-OSS 20B
por outra estrada.

**3 · A descoberta alimenta a cadeia.** `GET /models` guarda a lista real no teste
(`testes[x].lista`) e `catalogoDaCadeia()` junta-a ao catálogo — só para
fornecedores sem custo. Num gateway misto (OpenRouter, Requesty…) só entram ids
que dizem `free`. Isto resolve o problema que apanhámos hoje: **os quatro nomes do
OpenCode do catálogo já não existiam** (mudaram todos em dois meses); escrevê-los
à mão era garantir que ficavam velhos.

**4 · Honestidade no `/ia/gratuitos`.** Passa a separar **provados** (com resposta
registada na app: `llm7/codestral`, `ovh/Qwen3.5`, `ovh/gpt-oss-120b`) de **por
provar** (existem e estão prontos, mas ainda não responderam — é ali que ficam o
OpenCode, o Pollinations e os modelos do OVH nunca medidos). O Pollinations foi
provado por HTTP directo, mas ainda não pela app, por isso **não** entra na
primeira lista até o `/ia/testar` o registar. A frase do Control Center diz as
duas contas.

## 1.32.0 — 27 out 2026 · A IA gratuita começa a trabalhar

Pedido do dono: *«implementa uma IA para começar os trabalhos, implementa todas
gratuitas»*.

A auditoria de produção (27 out 2026, `/ia/uso`) explicou porque é que nada
trabalhava: **62 pedidos ao LLM7, 16 respostas**; **55 pedidos à Vercel, 0
respostas**; **52 ao OVH, 28 respostas** mas em 13–45 s, contra um tecto de 45 s.
Os erros eram literais: `Model 'gpt-oss-20b' is currently unavailable`,
`Model 'ministral-8b-2512' is currently unavailable`, `ovh não respondeu em 45 s`,
`API rate limit exceeded`.

**1 · A lista curada (`api/_ia/gratuitos.mjs`).** Três pares que responderam mesmo,
com data, número de sucessos e latência: `llm7/codestral-latest` (16/16, 0,9–3,4 s),
`ovh/Qwen3.5-397B-A17B` (13 s) e `ovh/gpt-oss-120b` (13–45 s). Não é uma promessa de
quota: é uma vantagem de partida, medida em `/ia/uso`. Nenhum deles precisa de chave.

**2 · O codestral deixou de ser ignorado.** O catálogo tinha-o, mas sem as etiquetas
`rapido`/`barato` — por isso o router preferia modelos que o fornecedor dizia não ter.
Agora as etiquetas do catálogo e da lista somam-se, e o par medido ganha +2000 menos a
latência. Quem tiver uma chave paga continua à frente: os keyless recuam 900 pontos
quando há pelo menos uma chave real no ambiente. Sem chave nenhuma — o estado deste
escritório — os gratuitos mandam.

**3 · Os modelos mortos saem do caminho.** Os quatro modelos do LLM7 que respondem
400 «currently unavailable» ficam marcados `indisponivel` com a data e o motivo, e
`MODELOS` deixa de os oferecer. Não desaparecem: `MODELOS_INDISPONIVEIS` explica em
`/ia/estado` porque não são usados.

**4 · Tecto próprio para quem é lento.** O OVH passa a ter 75 s (antes: os 45 s
globais, que matavam metade das respostas a caminho) e o LLM7 25 s. O global
continua a ser o último recurso.

**5 · «Fora» sobrevive ao arranque a frio.** Em serverless, a memória do processo
morre a cada invocação — a lista de «este modelo não existe» perdia-se e o mesmo erro
era pago outra vez. Agora é gravada na config e relida no pedido seguinte.

**6 · `GET /ia/gratuitos` (e `/api/ia/gratuitos` no servidor local).** Diz, sem
revelar chaves, quantos modelos gratuitos estão activos, qual é o mais rápido, o que
foi medido e a cadeia real de cada tipo de trabalho (`plano`, `codigo`, `texto`,
`investigar`, `revisao`, `rapido`, `visao`). `visao` continua a não ser relaxada: um
modelo sem olhos não lê uma imagem.

**7 · A função deixa de morrer a meio.** `api/rpc.mjs` não declarava `maxDuration`
e era cortada no tempo por omissão do plano. Um modelo que responde em 13–45 s — o
caso do OVH — nunca chegaria ao fim. Passa a 60 s, como `prova1` e `setup`.

**Testes:** 453/453, incluindo `ia-gratuitos.test.mjs` (10): a cadeia põe o medido à
frente, o fallback salta o indisponível, a marca de «fora» sobrevive a um processo
novo, o motor pede ao modelo certo sem chave e a rota não vaza chaves.

**Limitação declarada:** a prova em rede (um pedido real ao LLM7/OVH a partir deste
ambiente) não foi possível — o sandbox só alcança github/npm/pypi. A verificação
real faz-se em produção com `POST /ia/chat`; até lá, o que está provado é o
comportamento, não a resposta do fornecedor.

## 1.31.0 — 27 out 2026 · As salas passam a entregar: sites e digitalização

Pedido do dono: *«já quero que as salas comecem a trabalhar e que sejam capazes de criar
um site ou de digitalizar qualquer coisa»*.

Até aqui a resposta honesta era «não conseguem»: o lançador desliga `Write`, `Edit` e
`Bash` a todos os agentes (`providers.mjs`), e com razão. A solução não foi abrir o
disco — foi dar-lhes duas ferramentas com contorno.

**1 · Criar um site (sem lhes dar o disco).** `orbita_site_create` recebe o negócio em
dados confirmados (nome, atividade, cidade, contactos, serviços) e devolve o
`index.html`, o `estilo.css` e um `LEIA-ME.md`. O site nasce **rascunho**. Regras que
ficaram em código:

- telefone, email, morada e site só aparecem se vierem no brief — campo ausente fica
  ausente, e a página diz que os contactos ainda não estão confirmados;
- tudo o que vem do brief é escapado; não há scripts no HTML nem dependências externas;
- o mesmo brief dá exactamente o mesmo site, e é por isso que se guarda **o brief, não
  o HTML**: uma aprovação, uma verdade;
- `inferido` diz o que a casa escreveu (título, chamada) e `real` o que veio do brief.

Publicar é um acto humano: `orbita_site_publicar` (ou `POST /artefactos/:id/publicar`)
exige `aprovado: true` **e** o nome de quem aprova, e recusa páginas sem um único
contacto confirmado. Sem isso, 409 e nada muda.

**2 · Digitalizar papel e imagem.** `orbita_digitalizar` / `POST /digitalizar` aceita
uma imagem ou PDF em base64 (até 6 MB) ou um URL http(s), passa-o por um OCR
configurado (`ORBITA_OCR_URL`, adaptador trocável) e extrai, por regras determinísticas:
NIF **com dígito de controlo**, telefone português normalizado para `+351…`, email,
código postal, IBAN **mascarado**, valor em euros e data. Cada campo diz a sua origem e
confiança; o que não estiver no documento fica de fora e é listado em `faltam`.
`POST /digitalizar/lead` devolve a proposta de lead — **não grava no funil**.

Sem `ORBITA_OCR_URL` a resposta é 503 com o nome da variável que falta. Nada é
adivinhado, e o texto do documento nunca entra no registo de actividade (só o número de
campos e o estado).

**3 · Onde ficam os rascunhos.** Sem migração nova: com base, em `orbita_ai_memoria`
(`projeto: 'artefactos'`); sem base, em `data/artefactos/<id>.json` (fora do git), que é
também o que o servidor MCP usa — a sala e o dono vêem o mesmo rascunho.

**Rotas novas:** `GET/POST /artefactos`, `/artefactos/site`, `/artefactos/:id`,
`/artefactos/:id/preview`, `/artefactos/:id/publicar`, `/digitalizar`,
`/digitalizar/estado`, `/digitalizar/lead`. O `serve.mjs` local serve as mesmas
(`/api/artefactos*`, `/api/digitalizar*`), por isso dá para experimentar sem publicar.

**MCP: 18 → 22 ferramentas** (`orbita_site_create`, `orbita_site_list`,
`orbita_site_publicar`, `orbita_digitalizar`).

**O que ainda não faz:** não faz deploy do site (marca o artefacto como aprovado e
entrega os ficheiros; publicar no alojamento é um passo à parte) e não tem OCR incluído
— é preciso apontar `ORBITA_OCR_URL` a um Tesseract/PaddleOCR teu, e sem isso a
digitalização diz que falta, em vez de fingir.

**Testes:** `node --test` → **443/443** (424 antes; 19 novos em `artefactos.test.mjs`),
incluindo um ciclo HTTP real (criar → preview → publicar com e sem OK) e o MCP a sério
por stdio.

## 1.30.0 — 27 out 2026 · A pesquisa chega aos agentes, com travão e recibo

A auditoria de 1.29.0 encontrou sete defeitos. Este trabalho fecha os quatro que o dono
mandou tratar por ordem. O mais grave era uma regressão: **os agentes não tinham
pesquisa web nenhuma** — a Tavily era principal no papel e ausente no servidor MCP.

**1 · Pesquisa web para os agentes.** `orbita_web_search` entra no servidor MCP
(`mcp-servers/orbita-integrations`): consulta, limite, `topic: news` com `days`,
domínios, profundidade e um limiar de relevância próprio. Devolve título, URL, excerto,
data de publicação e `score` de cada fonte, mais as fontes em lista e os avisos. E
`orbita_business_search` põe as empresas do Geoapify nas mãos dos agentes — normalizadas,
sem duplicados e **sem inventar telefone, email ou site**: campo vazio quer dizer
desconhecido. `orbita_business_discover` continua a existir (ninguém parte por causa
disto) e passa a usar o Geoapify quando há chave; sem ela, volta ao OSM de antes.

**2 · Limiar de relevância e aviso de zona.** A Tavily devolvia seis resultados sobre o
ETF QQQ para «zxqv inexistente qqq», com pontuações 0,06–0,13. Agora há um limiar
(0,15 por omissão, `ORBITA_RELEVANCIA_MIN` ou `minRelevancia` na chamada): o que fica
abaixo é contado em `descartados` e, se não sobrar nada, a resposta é `vazio` — «não há
nada de relevante», não uma lista de ruído com URL. No Geoapify, `zonaDiverge` compara a
zona pedida com o centro resolvido e avisa («pediste Lisboa e a zona resolvida é
Alcorcón»); avisa também quando o país pedido não é o resolvido. **Avisa, não bloqueia** —
o geocode tolerante continua a resolver, mas agora di-lo.

**3 · Cache, tectos e `/pesquisa/uso`.** Uma camada nova, `api/_limites.mjs`:
cache de 5 minutos (250 entradas), janela deslizante de um minuto, quota diária e mensal
por fornecedor, e contagem de créditos. Os números reais em `PLANOS` — Tavily 1000/mês
grátis, 60/dia e 20/minuto por defeito, $0,008 por crédito; Geoapify 3000/dia, 60/minuto.
`GET /pesquisa/uso` mostra gasto, tecto, restante, cache e últimas execuções;
`GET /pesquisa/ferramentas` mostra o catálogo. Nada disto devolve chaves.

**4 · Registo por execução.** `api/_ferramentas.mjs` guarda, para cada chamada,
ferramenta, fornecedor, estado, tempo, cache, fontes e erro. Com base ligada vai para
`orbita_atividade` (`tipo: 'pesquisa'`); sem base, para `data/pesquisa-log.json`. O
envelope distingue `real` (veio de um fornecedor, com URL) de `inferido` (o que o modelo
deduz), e os testes garantem que nenhuma chave entra no registo.

**O que mudou no comportamento.** As rotas `/pesquisa/{leads,web,pagina}` mantêm os
campos que a interface já conhecia e ganham `ferramenta`, `ms`, `cache`, `codigo` e
`avisos`; a tradução para HTTP passou a ser explícita — 400 para parâmetros, 429 para
tecto/quota, 502 para avarias da fonte. A gaveta de leads diz no título do selo da fonte
quanto já se gastou hoje e no mês. O servidor local (`serve.mjs`) deixou de ser a única
porta sem travão: `/api/pesquisa/procurar` passou a usar a mesma camada, e ganhou
`/api/pesquisa/uso` e `/api/pesquisa/ferramentas`.

**Limitações que ficam ditas.** Os contadores são por instância da função (na Vercel,
cada arranque a frio recomeça): são travão, não factura. O `pais` continua a filtrar só o
geocode, não os lugares. O servidor local não serve `/api/rpc` — a gaveta que o usa
funciona contra a base, não contra o `serve.mjs`.

**Testes:** `node --test` → **423/423** (403 antes; 20 novos em
`pesquisa-ferramentas.test.mjs`), incluindo dois que arrancam o MCP a sério por stdio.

## 1.29.0 — 27 out 2026 · A pesquisa é Tavily; o Google saiu de vez

Pedido do dono: «muda de Google para uma API de pesquisas grátis, usa a Tavily, que
será a forma de pesquisa principal».

**A Tavily passa a ser a pesquisa principal do escritório.** `/pesquisa/estado` abre
com `principal: 'tavily'`; a gaveta diz «Tavily · pesquisa principal» ou
«Tavily · notícias». Duas coisas novas, para ser principal a sério e não só de nome:

- **notícias com recorte temporal** — `topico: news` + `dias` (1–365) e `publicado` em
  cada resultado. Em modo `general` a janela não é enviada: pedir `days` a uma pesquisa
  geral é um erro da API, não uma funcionalidade.
- **ler a página** — `POST /pesquisa/pagina` (Tavily `extract`) devolve o texto limpo;
  na gaveta é o botão «ler a página» em cada resultado, com o texto aberto ali mesmo e
  o que já foi lido guardado na sessão para não gastar créditos duas vezes.

**O Google saiu** — apagados `google.mjs`, `google.test.mjs` e o servidor MCP
`mcp-servers/orbita-google`; saíram as rotas `/api/google*`, as duas entradas do
catálogo (`google-places`, `google-search`) e os passos do `check.mjs`. Não foi por
gosto: pedia duas APIs, duas contas de configuração e cartão ligado, e nunca esteve
ligado nesta instalação — era código a prometer o que não existia.

O que **não** mudou: os leads continuam a vir do **Geoapify** (OpenStreetMap). É a
única fonte que dá telefone, morada estruturada e o sinal «não tem site» — e é esse
sinal que faz um lead valer 80 em vez de 48. Uma página encontrada pela Tavily não é
uma empresa: sem nome, telefone e morada verificáveis, não entra no funil.

A lista local de leads (`data/leads.json`) vivia dentro de `google.mjs` por arrasto.
Saiu para `leads-store.mjs` — armazenamento puro, sem chave, sem rede, sem fornecedor.

Prova: 5 testes novos (estado sem Google, notícias com `days`/`days` recusado no modo
geral, domínios, rotas, e dois de interface para o modo notícias e para «ler a página»).

## 1.28.1 — 27 out 2026 · A pesquisa global da mesa deixou de ser um placeholder

`GET /ops/pesquisa` devolvia `{ query, grupos: [] }` — sempre. A caixa «Pesquisar
leads, projetos e tarefas…» da mesa escrevia, esperava 280 ms e não encontrava
nada, mesmo com o nome à frente. Era a última pesquisa do produto que não
pesquisava. Agora:

- procura em **leads, projetos, tarefas e mensagens**, sem acentos e sem
  distinguir maiúsculas («optica» encontra «Óptica»; «ÓPTICA» também);
- cada resultado leva a algum lado (`#/lead/:id`, `#/projeto/:id`, `#/tarefas`,
  `#/conversas`) — um resultado que não se pode abrir não é resultado;
- devolve só os grupos com itens e uma nota honesta: «nada corresponde — nem
  leads, nem projetos, nem tarefas, nem mensagens»;
- abaixo de duas letras não procura: diz isso em vez de varrer a base inteira.

Também saíram as últimas frases que prometiam a Google na mesa: o formulário de
lead à mão e o estado vazio dos leads passam a apontar para a gaveta ◈ LEADS,
que procura a sério.

Prova: 2 testes novos em `pesquisa.test.mjs` (resultados nas quatro tabelas e
insensibilidade a acentos/maiúsculas); suite 403/403.

## 1.28.0 — 27 out 2026 · A pesquisa passou a acontecer (e o manual saiu do site)

Duas frases do dono, e o que cada uma obrigou a fazer:

> «faz as pesquisas já estarem realmente a funcionar — leads e qualquer outra coisa»

A pesquisa do servidor estava pronta desde 1.25.0 (Geoapify + Tavily), mas a
gaveta do canto falava com `/api/google` e `/api/google/search` — caminhos que só
existem em `serve.mjs`. Na aplicação publicada davam 404: a gaveta abria, dizia
«sem chave da Google» e nunca procurava nada. Agora fala com as rotas que estão
mesmo publicadas, `/api/rpc?caminho=/pesquisa/*`:

- **Empresas** → `POST /pesquisa/leads` (Geoapify, dados do OpenStreetMap):
  nome, morada, telefone, site, nota de oportunidade explicada; o que entra no
  funil vai sem duplicados (`dedupe_key`).
- **Web** → `POST /pesquisa/web` (Tavily): resposta curta, excertos e endereço de
  cada fonte. Nada disto entra no funil como lead.
- **Sugestões** → `GET /pesquisa/categorias` (25 atividades reais) e a lista
  guardada em `GET /ops/leads`.
- O rodapé diz o que aconteceu de verdade: quantas empresas, quantos segundos,
  quantas novas no funil.

> «remove isso, porque esse tipo de informações não devem aparecer no site»

O bloco «Para procurar preciso de uma chave da Google. 1. Cria uma chave em
console.cloud.google.com… 2. Põe GOOGLE_MAPS_API_KEY…» saiu da interface, assim
como os nomes de variáveis na gaveta e no painel de IA. As chaves continuam a
existir — no ambiente do servidor, que é o sítio delas — e o Centro de Controlo,
que é do dono, continua a dizer o que falta a cada serviço. Quando uma fonte cai,
o visitante lê «esta fonte não está disponível agora»; o nome da variável fica no
registo, não no ecrã.

**Configurações redesenhadas** (pedido: «cara de um dev da Apple, elegância e
perfeição, tudo bem calculado e animado»): grelha de 4 px, cinco degraus
tipográficos, superfícies em camadas, controlo segmentado com pastilha elevada,
interruptores a sério (não caixas de selecção pintadas), pastilhas de estado com
pulso contínuo no que está ligado, entrada com mola, revelação em cascata de
40 ms por secção, esqueleto a deslizar enquanto o catálogo carrega e
`prefers-reduced-motion` a desligar tudo.

Prova real, em produção, antes deste commit: `GET /pesquisa/teste` → Geoapify
ok em 575 ms; `GET /pesquisa/leads?oQue=dentistas&onde=Coimbra` → 5 empresas
verdadeiras (Clínica Santa Madalena, Optidente, Clínica Delille, O meu Doutor,
Clínica de Medicina Dentária de Celas) com notas 80/48; `GET /pesquisa/web?q=…`
→ Tavily com 3 fontes e resposta curta. Interface: 5 testes novos em
`pesquisa-ui.test.mjs` (jsdom) provam as rotas pedidas, os leads desenhados e a
ausência de manuais de configuração.

## 1.27.0 — 27 out 2026 · Vercel Connect: credenciais ao minuto em vez de chaves em repouso

O dono pediu `getToken('opencode/orbita-agentes', { subject: { type: 'user', id } })`.
Está implementado no servidor, com o conector `scl_qldewGbrB7mPvtjEQXyVQ`:

- `api/_conect.mjs` — pede o token com `getTokenResponse` (validade e conector na
  resposta), autentica com o OIDC da função, guarda em cache até 30 s antes de
  expirar e revalida quando se força.
- **O token nunca sai da função.** As rotas devolvem só o retrato: conector,
  sujeito, validade e `4…4` caracteres.
- Erros da SDK traduzidos para acções: falta autorização, falta instalação,
  conector não ligado ao projecto, ambiente não autorizado, credencial recusada.
- Centro de Controlo: «Vercel Connect» no grupo **Credenciais**, com «Testar
  ligação» a pedir um token a sério e a guardar o resultado.
- `POST /conectar/consentimento` gera o link de autorização, desligado por
  omissão (`ORBITA_PERMITIR_CONSENTIMENTO=1`) enquanto a aplicação não tiver
  autenticação.

Limites declarados: o sujeito por omissão é `app` (a app não tem login, logo não
se inventa um `usr_…`); o conector tem de estar ligado ao projecto/ambiente na
Vercel; e ainda nenhum agente usa o token — a função existe e está testada, mas
ligá-la a uma tarefa concreta é o passo seguinte, só com teste real a passar.

Prova: 15 testes em `conectar.test.mjs`; suite 389/389.

## 1.26.0 — 27 out 2026 · Verificar em produção sem escrever nada

A cópia de segurança (1.23.0) e a cifra (1.25.0) já existiam. Faltava poder
**verificar** as duas na aplicação publicada, onde não há cliente que faça POST.
Duas rotas passam a aceitar leitura:

- **`GET /backup/teste`** — faz o ensaio completo (exportar → reler → conferir a
  marca → restaurar em memória) e **não** escreve no registo de alterações. O
  POST continua a ser o botão «Testar cópia», e esse assina.
- **`GET /backup/cifrado`** — devolve o pacote cifrado por leitura pura, sem
  escrever nada nem devolver a cópia em claro ao lado.

Nada disto mudou o comportamento anterior: os testes de 1.23.0 (em
`controlo.test.mjs`) continuam a passar, e o módulo `api/_backup.mjs` não foi
tocado.

Prova: 3 testes em `backup.test.mjs`; suite completa verde.

## 1.25.2 — 27 out 2026 · Etiquetas do OpenStreetMap não são a atividade

A verificação seguinte, no mesmo sítio, apanhou outra: a Clínica Delille saía com
`categoria: "wheelchair.yes"`. A lista de categorias do OSM mistura a atividade
(`healthcare.dentist`) com etiquetas de acesso (`wheelchair.yes`, `payment.cards`).

- A categoria passa a ser a atividade **mais específica**, depois de tirar as
  etiquetas; se não sobrar nenhuma, vale a que foi pedida.
- A nota e a razão do lead usam a mesma categoria — deixam de citar `wheelchair.yes`.

Prova: 17 testes em `pesquisa.test.mjs` (fixture com etiquetas); suite 371/371;
confirmado em produção com `GET /pesquisa/leads?oQue=dentistas&onde=Coimbra`.

## 1.25.1 — 27 out 2026 · Dois números no mesmo campo não viram um número inventado

A primeira pesquisa real em produção (dentistas em Coimbra) mostrou dois defeitos
que os testes de mentira não apanhavam:

- um sítio do OpenStreetMap trazia `+351 239 923 125; +351 910 529 405` e o
  telefone saía colado: `+351239923125+351910529405`. Passa a ficar o **primeiro**
  número, que é o que existe;
- a categoria vinha como `healthcare` (a raiz) em vez de `healthcare.dentist`.
  Passa a usar a mais específica do caminho.

Prova: 17 testes em `pesquisa.test.mjs`, incluindo os dois casos acima; suite
371/371. Confirmado em produção com `GET /pesquisa/leads?oQue=dentistas&onde=Coimbra`.

## 1.25.0 — 27 out 2026 · A pesquisa passa a existir na aplicação publicada

Até aqui, procurar leads só funcionava em `serve.mjs`, ou seja, na máquina de quem
abria o escritório. Na versão publicada não havia pesquisa nenhuma — e as duas
chaves que o dono deu não serviam de nada. Agora:

- **Geoapify** (`GEOAPIFY_API_KEY`): geocodifica a zona e devolve empresas reais
  do OpenStreetMap por categoria (`/pesquisa/leads`). A atividade escrita em
  português é traduzida para a categoria do Geoapify (26 atividades); o que não
  está na tabela é **recusado com a lista**, não substituído por negócios ao acaso.
- **Tavily** (`TAVILY_API_KEY`): pesquisa web com excertos e resposta curta
  (`/pesquisa/web`) e extracção de uma página já conhecida (`/pesquisa/pagina`).
  Resultados da web **não** entram no funil: dão contexto, não são leads.
- **Google** continua disponível, mas exige chave com facturação ligada; sem ela
  o estado diz que falta, em vez de fingir que procura.
- **Centro de Controlo**: as duas fontes aparecem no inventário com o botão
  «Testar ligação» a fazer um pedido real (GET no Geoapify, POST na Tavily).
- **Cifra** (`api/_cripto.mjs`, AES-256-GCM): `POST /backup/cifrado` devolve a
  cópia de segurança cifrada e `POST /backup/decifrar` confirma-a sem despejar
  dados. Chave mestra de `ORBITA_CHAVE` ou derivada (HKDF) da chave da base.
- **Guarda**: `segredos.test.mjs` falha se alguma chave com formato verdadeiro
  entrar num ficheiro versionado.

Provas: 16 testes em `pesquisa.test.mjs`, 9 em `cripto.test.mjs`, 3 em
`segredos.test.mjs`; suite completa verde. **Limites:** a base não está cifrada
campo a campo, a aplicação continua sem autenticação, e a quota gratuita dos
fornecedores não é garantida.

## 1.24.0 — 27 out 2026 · Ligações por conector, sem confundir com chaves

- **Um conector não é uma chave.** O assistente pode ter o Vercel ligado por
  conector (OAuth do lado da Arena) e isso **não** dá credencial à aplicação: a
  app continua a precisar de `VERCEL_TOKEN` para falar com a API quando corre
  sozinha. O Centro de Controlo passa a mostrar as duas coisas em separado:
  selo «conector», estado «ligada por conector», `via` =
  `conector` / `chave` / `conector+chave`, e a frase que falta para os agentes
  usarem a integração em produção.
- A lista vem de uma variável do servidor (`CONECTORES=vercel`), não de uma
  suposição da interface: sem a variável, nada aparece como ligado.
- Resumo do catálogo ganha `porConector`, ao lado de `configuradas` e
  `verificadas`.
- Provas: `controlo.test.mjs` passa de 25 para **26** (conector sem chave,
  conector com chave, e o caso em que não há conector nenhum).

## 1.23.1 — 27 out 2026 · O router aprende com o que o fornecedor recusa

- **Modelo indisponível deixa de ser tentado.** O LLM7 respondeu *«Model
  'gpt-oss-20b' is currently unavailable»* e o router insistia nele em cada
  passo, gastando a cadeia toda e falhando execuções que tinham alternativa.
  Agora, quando a resposta é «não existe / indisponível», o par
  fornecedor+modelo fica de fora durante **6 h** (`foraDoAr`, marcado por
  `marcarFora`) e a chamada seguinte já não conta com ele. É memória curta, em
  processo — não vai para a base e não esconde nada.
- **Quem já respondeu vem à frente.** O modelo que passou no último teste real
  do fornecedor sobe na ordem da cadeia (`usados`), em vez de se escolher só por
  etiquetas e preço.
- Provas: `ia.test.mjs` passa de 40 para **44** (o modelo recusado sai da
  cadeia e volta depois do prazo; a dica do teste real muda a ordem; as frases
  de recusa são reconhecidas; `falarComFallback` marca ao ouvir a recusa).

## 1.23.0 — 27 out 2026 · Cópia de segurança que se pode testar

- **`GET /backup`** — um JSON com as tabelas que interessam (leads, projetos,
  tarefas, mensagens, receitas, atividade, execuções, uso e configuração), as
  contagens e uma **marca sha256** do conteúdo.
- **`POST /backup/teste`** — exporta, relê o que exportou, confere a marca,
  compara contagem com lista e **restaura de facto tudo numa base em memória**,
  linha a linha. Se faltar uma linha, falha e diz qual. Fica no registo de
  alterações.
- **Interface:** secção «Backups» com «Descarregar cópia» (ficheiro
  `orbita-copia-<data>.json`) e «Testar cópia», que mostra `✓ 42 linhas · 7 ms ·
  marca …` na própria linha.
- **Limite declarado:** prova que a cópia está inteira e que volta a entrar numa
  base com o mesmo esquema. O restauro no Postgres de produção é um ensaio à
  parte — não se afirma feito.
- Provas: `controlo.test.mjs` passa de 22 para **25** (marca estável, marca que
  apanha uma linha alterada, restauro contado, e o caso em que o destino perde
  linhas e o teste **falha** de propósito). Suite **337/337**.

## 1.22.0 — 27 out 2026 · Testar cada integração, uma a uma

- **`POST /platform/testar`** — o botão que faltava: faz um pedido real à
  integração escolhida, agora, e devolve o que aconteceu. Para os fornecedores de
  IA usa o teste verdadeiro que já existia (lista de modelos + uma resposta
  pequena, com até três modelos candidatos, porque um modelo de raciocínio pode
  gastar o orçamento de saída a «pensar» e devolver texto vazio — isso **não** é
  um teste bem-sucedido). Para GitHub, Vercel, Supabase e Resend faz um pedido à
  API de cada um com o token do ambiente e lê a resposta.
- **O resultado fica guardado** em `testes` (a mesma tabela que a IA usa) e no
  registo de alterações. «Verificada» passa a significar «um pedido real
  respondeu», não «tem uma chave».
- **Bug corrigido:** `/platform/apis` filtrava fornecedores por `tipo === 'chat'`,
  campo que o catálogo não tem — a lista de IA vinha **vazia**. Agora só ficam de
  fora os serviços de pesquisa (Exa, Linkup, Firecrawl…), e o fornecedor
  «Vercel AI Gateway» passa a `ia:vercel` para não colidir com o serviço
  «Vercel».
- **Interface:** cada linha de integração tem «Testar ligação» (desactivado sem
  chave, com a razão no `title`), e a resposta aparece na própria linha: modelo,
  HTTP, milissegundos e, quando há, o texto que o modelo devolveu.
- Provas: `controlo.test.mjs` passa de 20 para **22** (teste real do GitHub com
  `fetch` falso, chave em falta, HTTP 403, integração inexistente → 404, e a
  lista de IA deixar de vir vazia).

## 1.21.0 — 27 out 2026 · Salas: cor ao vivo, tamanho à mão e registo de quem mudou

- **A cor de uma sala muda sem recarregar.** Ao escolher a cor, o painel chama
  `window.ORBITA.recolor(dept, cor)` e repinta as peças seguras — vidro do chão,
  base, borda, poça de luz, LED das secretárias, passadeiras e entrada. Paredes e
  mobiliário ficam como estão: mudar a planta é construir outra sala, não pintar
  esta. A interface diz **quantas peças** mudaram (não diz «feito» em abstracto), e
  quando a cena ainda não está viva mantém o botão «Recarregar a cena».
- **Tamanho à mão por sala** (`POST /controlo/salas/:dept/tamanho`): um cursor de
  profundidade mostra o mínimo que a lotação exige (`data-minimo`) e vai até +20 m
  (`CRESCER_MAX`). O servidor volta a aplicar o limite — pedir 999 m guarda o
  máximo, pedir abaixo do mínimo sobe ao mínimo. A sala nunca encolhe abaixo do
  que os agentes pedem.
- **Registo de alterações** (`GET /controlo/registo`, também em `/controlo/estado`):
  cada mudança de sala (cor, tamanho, agente que entra ou sai, substituição da
  configuração) fica em `orbita_atividade` com hora e autor. O painel mostra as
  últimas seis. O autor é **sempre «dono»** — não há login, e o registo di-lo em
  vez de inventar utilizadores.
- Provas: `controlo.test.mjs` passa de 16 para **20** (limites do tamanho, sala que
  não encolhe, registo com hora/autor, e a tabela de peças que se repintam). Suite
  completa **332/332**.

## 1.20.0 — 27 out 2026 · Configurações passam a Centro de Controlo

Pedido do dono: «a aba de Configurações deve ser um Centro de Controlo Inteligente…
controlar as seis salas, mudar o tamanho das salas, acrescentar agentes onde aumentar
o tamanho da sala automaticamente, mudança de funções, cores… modelos de IA, APIs,
execução de tarefas, segurança e tema». E a regra que ficou por cima de tudo:

> «A aba deve distinguir claramente três estados: Configurado, Ligado e A funcionar.
> Ter uma API configurada não significa que esteja ligada; estar ligada não significa
> que um agente esteja a executar uma tarefa.»

### Os três estados, provados e não pintados

`GET /api/controlo/estado` (novo) devolve, por fornecedor de IA, três marcas
independentes:

| marca | de onde vem | quando é `null` |
|---|---|---|
| `configurado` | existe chave no ambiente, ou o fornecedor é keyless | nunca |
| `ligado` | o **último teste real** (`/ia/testar`) respondeu | sem teste — a interface diz «por provar» |
| `a_funcionar` | houve execuções registadas nas últimas 24 h | sem execuções |

E o mesmo para a execução (`runs24h`, `chamadas24h`, última chamada, último modelo) e
para a segurança (login, chaves no servidor, aprovação humana). Nada é estimado.

### As salas crescem com os agentes — e a conta é uma só

`src/salas.js` (novo, puro, testado) calcula:

- `filasNecessarias(n)` = filas de duas secretárias que a lotação pede;
- `profundidadePara(filas)` = parede de fundo + filas + faixa da frente (a **mesma**
  fórmula de `data.js`, com o `SEAT_GRID`);
- `lugarLivre()` = primeiro lugar vago, sem pôr ninguém em cima de outro.

`src/escritorio.js` aplica isto **antes de a cena assentar** (`main.js` importa-o
primeiro): cores escolhidas, agentes acrescentados e a sala mais funda. Uma sala
**nunca encolhe** abaixo da planta original, e a faixa da frente fica sempre livre —
há provas para as duas coisas.

### O que se pode fazer na aba

- **cor de cada sala** (chip + vidro derivado), guardada no servidor e no browser;
- **acrescentar/tirar agentes** por sala (limite de 12 por sala), com função escrita;
- ver **as filas, os lugares livres e se a sala foi ampliada**;
- ver **Inteligência** (motor pronto, configurados, ligados, por testar), **Execução**
  (execuções e chamadas em 24 h) e **Segurança** (login, chaves, aprovação);
- o tema (claro/escuro/automático) que já existia.

Aviso honesto na própria aba: a cena aplica as mudanças **no próximo arranque** — o
painel não finge que já mudaram.

### O painel falava com um endereço que não existe

A Vercel só alcança a função de `api/` no caminho exacto do ficheiro: `/api/platform/apis`
e `/api/controlo/estado` respondem **404**. O painel pedia-os a sério — por isso a lista
de APIs nunca aparecia em produção. Passou tudo por `/api/rpc` (o mesmo envelope que a
mesa já usava), com leitura por GET e escrita por POST.

### APIs no modo base

`GET /api/platform/apis` **não existia** no modo base: o painel pedia e recebia 404.
Agora responde com o catálogo real (serviços + os 76 fornecedores de IA), dizendo por
cada um que variáveis existem e quais faltam. `POST /api/platform/key` passa a
responder **501 com a razão** — em produção as variáveis de ambiente são só de leitura
e uma interface que «guarda chaves» seria mentira.

### Provas

- `controlo.test.mjs` (novo, 16 provas): crescimento em filas inteiras, sala que não
  encolhe, lugar livre, cor inválida recusada, configuração estragada ignorada,
  rotas a guardar/devolder, e os três estados a nascerem de factos.
- Suite completa: **328/328**. Build: `dist/mesa.html` 127 KB. `mesa.smoke` verde.

## 1.19.1 — 27 out 2026 · o que a produção corrigiu no 1.19.0

O 1.19.0 foi publicado e depois **testado contra a produção** (Vercel + Supabase
reais). Três coisas que o código dizia e o mundo não confirmava:

1. **Um keyless nunca entrava numa cadeia.** `fornecedorActivo()` exigia chave;
   o OVH aparecia como «configurado» no estado e era descartado pelo router. Uma
   execução respondia «todos os modelos falharam» com um fornecedor a responder.
   Agora entra quem tem chave **ou** não precisa dela.
2. **O Kilo já não é anónimo.** O pedido sem chave devolve `403 — You need to
   sign in to use this model.` O catálogo passou a dizer isso (`keyless: false`,
   limite e nota escritos com a medição) em vez de prometer acesso livre.
3. **O OVH não tinha um único modelo no catálogo.** Respondia, mas o router não
   tinha por onde o escolher. Entraram os **9 modelos de chat** da lista real de
   `/v1/models` (medida em produção; janelas só onde são públicas).

Confirmado com pedidos reais: OVH AI Endpoints responde **sem chave** (22
modelos listados, resposta em ~0,8 s), e a rota `/ia/testar` marca-o «funcional»
— os outros 76 fornecedores continuam «sem chave» até alguém os configurar.

O **bootstrap temporário foi removido** depois de usado: o endpoint
`/api/setup` (protegido por token), a entrada em `vercel.json`, a dependência
`pg` e a variável `SETUP_TOKEN` já não existem nesta versão. O esquema vive em
`supabase/*.sql`; a base de produção ficou com as tabelas criadas.

Ver também: `docs/IA.md` §15.

## 1.19.0 — 27 out 2026 · freellmapi, memória do Graft e estúdio OpenMontage

Três pedidos, três camadas novas — e a mesma regra: nada se apresenta como
funcional sem um teste real, e nada é reconstruído sem necessidade.

### 1 · Todos os fornecedores do `freellmapi`

O repositório recebeu o `freellmapi-main.zip` (MIT, © Tashfeen Ahmed), com 49
adaptadores de fornecedores e uma tabela de modelos com limites por minuto, por
dia e contexto. Em vez de copiar o código dele, escrevi um extractor:

- **`scripts/extrair-freellmapi.mjs`** lê o zip extraído e gera
  **`api/_ia/catalogo-extra.json`**: **72 fornecedores** e **116 modelos** com
  os números que ele declara (rpm/rpd/tpm/tpd, contexto, ranks de inteligência e
  velocidade, orçamento mensal).
- O catálogo da mesa passou de 11 fornecedores e 30 modelos para **76 e 146**.
  Os 11 do núcleo mandam (não são substituídos); os do freellmapi entram com
  `familia: 'freellmapi'` e dizem de onde vieram.
- **Dois fornecedores não precisam de chave nenhuma**: **Kilo Gateway** e **OVH
  AI Endpoints** (acesso anónimo, limite por IP). Entram no router como
  «prontos», mas **continuam por testar** até um pedido real — é o `/ia/testar`
  que decide, não o catálogo.
- 21 adaptadores não são utilizáveis por este cliente (dialeto próprio — Cohere,
  AI Horde, ACLIDE, Moondream, Sail, os seis de pesquisa — ou base que o código
  dele não declara). Não desaparecem: aparecem na interface com a razão, num
  `<details>`.

### 2 · A memória dos plugins do Graft

O `Graft-master.zip` (Apache-2.0, © AEndrix03) traz um plugin com seis skills:
`graft-init`, `graft`, `recall`, `memoryze`, `learn`, `memory-audit`. Não compilei
o CLI em C++: implementei o **comportamento** no servidor, com as mesmas ideias e
a mesma honestidade.

- **`api/_ia/memoria.mjs`** — `procurar` (pontuação lexical por título, texto e
  etiquetas), `guardar` (recusa notas vazias, não duplica iguais), `aprender`
  (plano primeiro, grava só com `confirmar`), `auditar` (duplicados, notas
  curtas, sem fonte, paradas — **não apaga nada**), `estado`.
- **Duas ferramentas novas** para os oito agentes: `memoria_procurar` e
  `memoria_guardar`. O orquestrador **consulta a memória antes de planear** e
  **escreve uma nota no fim** de cada execução concluída (memoryze), com a
  decisão do Reviewer.
- **`/ia/memoria`** (GET/POST), `/ia/memoria/procurar`, `/ia/memoria/aprender`,
  `/ia/memoria/auditar`, `DELETE /ia/memoria/:id`.
- A interface diz o que isto **não** é: procura por palavras, não embeddings;
  sem grafo, sem daemon, sem o modelo de 600 MB.

### 3 · Estúdio de media com o OpenMontage

O **OpenMontage** (AGPL-3.0, © calesthio) faz vídeo, imagem, áudio, animação e
3D com agentes — e precisa de Python, FFmpeg, Node e chaves pagas. Não cabe numa
função da Vercel. Por isso a integração é uma **fila** e um **worker**:

- **`supabase/orbita_ia.sql`** ganhou `orbita_media_jobs` (pedido, tipo, estado,
  pipeline, resultado, erro) e `orbita_ai_memoria`, ambas com RLS fechado.
- **`api/_ia/media.mjs`** — catálogo de 13 pipelines, validação do pedido,
  fila, `assumir`/`concluir`/`falhar` com **token próprio do worker**
  (`MEDIA_WORKER_TOKEN`) e `sinal` (heartbeat com versão, commit, demos e se há
  FFmpeg).
- **`scripts/estudio-worker.mjs`** — corre numa máquina com o OpenMontage
  instalado: envia sinal, puxa um trabalho, corre `python render_demo.py <demo>`
  (limite de 20 min) e devolve o ficheiro ou a **saída real** do comando.
- **`scripts/instalar-openmontage.sh`** — clona o projecto oficial, cria a venv,
  instala `requirements.txt`, verifica FFmpeg e mostra o diagnóstico.
- **`docs/OPENMONTAGE.md`** — o desenho, o contrato, a licença e o que fica por
  fazer.
- Sem worker, o trabalho nasce **`indisponivel`** com a razão escrita. Nunca
  «concluído».

### Provas

- `ia.test.mjs` **33/33** (com os fornecedores keyless e o teste de «nenhum
  fornecedor ficou funcional sem teste»).
- `estudio.test.mjs` **12/12**: procura lexical sem inventar achados, dedupe,
  auditoria que não apaga, `aprender` com portão de confirmação, estúdio que
  recusa pedidos vazios, fila conduzida pelo worker com token, heartbeat, e o
  ciclo completo **execução → nota na memória** e **memória → plano**.
- `localapi.test.mjs` **13/13** (memória e estúdio dizem que precisam do
  servidor no modo local).
- `node build.mjs` + `mesa.smoke` verdes.

### Limitações (ditas, não escondidas)

1. Os 72 fornecedores do freellmapi são **catálogo**, não promessa: sem chave
   (ou sem ser keyless) não há pedido. Os limites vêm do código dele e mudam.
2. **Kilo e OVH** dizem, na documentação dele, que os prompts podem ser usados
   para treino — não servem para dados de clientes.
3. A memória é lexical; não há embeddings nem grafo.
4. O estúdio **não** faz render na nuvem: precisa de um worker com FFmpeg. Nesta
   máquina de trabalho instalou-se o OpenMontage (venv + `requirements.txt`) e
   `render_demo.py --list` devolveu três demos; **não há FFmpeg aqui**, por isso
   nenhum `.mp4` foi produzido — e é isso que o worker reporta.
5. O `/api` continua público (herdado de 1.17.0): falta login.

## 1.18.0 — 30 out 2026 · APIs multimodelo e orquestração de agentes

O dono pediu uma infraestrutura de IA a sério: vários fornecedores, escolha de modelo por
tarefa, agentes com ferramentas reais, um Control Center, e provas — não ecrãs bonitos.

### Auditoria primeiro (o que já existia)

- A mesa falava `/api` (1.17.0) com Supabase atrás; não havia **nenhuma** chamada a modelos.
- `providers.mjs` (25 out) já sabia falar com APIs e CLIs, mas **só no servidor local**
  (`npm start`): na Vercel não há binários, e as chaves nunca estiveram lá.
- `integrations.mjs`/`mcp.mjs` servem o Claude Code local; não tocam no site publicado.
- Tarefas criadas na mesa terminavam `failed — sem motor`. Era verdade, e deixou de ser.
- O catálogo de fornecedores vem do README de `free-llm-api-resources` (abril 2026), extraído
  para `api/_ia/catalogo.mjs` — com a nota de que os limites mudam e só um teste conta.

### O que foi construído

- **`api/_ia/catalogo.mjs`** — 11 fornecedores (OpenRouter, Google AI Studio, Groq, Cerebras,
  Mistral, Hugging Face, NVIDIA NIM, Vercel AI Gateway, Anthropic, OpenAI, DeepSeek) e ~30
  modelos com capacidades, janela, preço indicativo e limites.
- **`api/_ia/cliente.mjs`** — uma função (`falar`) e três dialetos (openai, anthropic, google),
  com tempo limite, classificação de erros (chave/crédito/limite/avaria/modelo) e uso de tokens.
  A chave viaja em cabeçalho — no Google também (nunca em `?key=`).
- **`api/_ia/router.mjs`** — escolhe por tipo de trabalho com etiquetas exigidas e desejadas,
  respeita o modelo preferido de cada agente, ordena por custo/latência real, e devolve uma
  cadeia com fallback e orçamento (16 chamadas / 160 mil tokens por execução).
- **`api/_ia/ferramentas.mjs`** — 9 ferramentas que mexem na base a sério (leads, projetos,
  rascunhos, dinheiro), com validação de argumentos, permissões por agente e aprovação
  obrigatória nas destrutivas. O que não existe está declarado em `INDISPONIVEIS`.
- **`api/_ia/agentes.mjs`** — os oito agentes (01 Orchestrator … 08 Reviewer), cada um com
  instruções, ferramentas fechadas e critérios de conclusão.
- **`api/_ia/orquestrador.mjs`** — plano → passos → ferramentas → revisão independente, tudo
  gravado passo a passo (`orbita_ai_runs`/`steps`), com cancelamento verificado entre passos e
  **retomar** que continua do plano gravado sem repetir os passos já concluídos.
- **`api/_ia/rotas.mjs`** — `/ia/estado`, `/ia/agentes`, `/ia/modelos`, `/ia/modelos/descobrir`,
  `/ia/testar`, `/ia/chat`, `/ia/runs` (+correr/abrir/cancelar), `/ia/uso`, `/ia/config`.
- **`supabase/orbita_ia.sql`** — quatro tabelas novas, RLS fechado, só `service_role`.
- **AI Control Center** (`Mesa → IA`, `src/ia.js`): fornecedores com estado real, botão
  **Testar** (dois pedidos a sério), descoberta de modelos, modelo por agente, execução de um
  trabalho com o plano e os passos a aparecerem da base, cancelar, uso/latência/erros, e a lista
  do que esta instalação não faz.

### Regras que a camada cumpre

- **Nunca** diz que um fornecedor funciona sem um teste real bem-sucedido (`por_testar` é um
  estado próprio).
- **Nunca** devolve uma chave: `/ia/estado` dá o nome da variável e a máscara; há um teste que
  falha se a chave aparecer numa resposta.
- **Nunca** inventa ferramentas: um agente só executa o que está na sua lista, validado no
  servidor; o texto do modelo não é prova de execução — a prova é o `ok:true` do executor.
- **Nunca** promete o que não há: pesquisa web, execução de código, ficheiros e imagens estão
  declarados como indisponíveis, com a razão.

### Provas em produção (27 out 2026, `orbita-agentes.vercel.app`)

1. `/api/setup?…&smoke=1` aplicou `orbita_mesa.sql` + `orbita_ia.sql` nas dez tabelas e provou a
   escrita/leitura/limpeza nas quatro tabelas da IA (`runCriado`, `runRelido`, `stepCriado`,
   `usoRegistado`, `configGravada`, `limpeza` — tudo `true`, `restam: 0`). **As tabelas existem.**
2. `/api/health` responde `versao:"1.18.0"` e `ia.fornecedoresComChave:["vercel"]`: o motor
   encontrou o AI Gateway **sem chave nenhuma**, pelo token OIDC que a Vercel injecta em cada
   pedido (`x-vercel-oidc-token` → `Bearer`). O token não é guardado nem devolvido.
3. `/api/setup?…&ia=1` fez um pedido real ao Gateway e um trabalho completo. Resultado honesto:
   o Gateway autenticou (o token foi aceite) e **recusou por falta de cartão**:
   *«AI Gateway requires a valid credit card on file to service requests»*. O `run` fechou
   `falhou` com essa frase, os dois modelos da cadeia tentados, zero passos inventados.
   Ou seja: o caminho está construído e testado ponta a ponta; falta um cartão **ou** uma chave
   de um fornecedor sem cartão (Groq, Google AI Studio, Cerebras, OpenRouter).
4. O `/api/setup` era temporário: foi **apagado** e o `SETUP_TOKEN` também, no mesmo dia.

### Provas

- **`ia.test.mjs` — 30 provas, todas verdes**: os três dialetos (com `fetch` falso), classificação
  de erros, router (chaves/desligados/preferido/visão), fallback com registo de uso, orçamento,
  validação e permissões de ferramentas, dedupe de leads, plano em JSON embrulhado em prosa,
  **orquestração completa** (plano → 2 passos → ferramenta a criar um lead → revisão aprovada,
  com passos e uso gravados), falha honesta sem fornecedor, cancelamento, e as rotas `/ia/*`
  incluindo o teste real a marcar «funcional» e uma chave recusada a marcar «erro».
- **`ia.test.mjs` — 33 provas** com o retomar incluído: plano gravado → corre só o passo em falta,
  reaproveita o contexto do passo anterior, não volta a pedir plano; e retomar sem plano é 409.
- Continua tudo o resto: **204 testes** no total, `mesa.smoke` e `scene.smoke` exit 0.

### O que falta (dito, não escondido)

1. **Chaves.** Nenhum fornecedor tem chave na Vercel ainda: o Control Center abre com
   «Sem motor» e diz qual variável criar. Sem isso, nada corre — e é assim que deve ser.
2. **Login.** O `/api` continua público (herdado de 1.17.0). Escrever na base a partir de um
   agente só é seguro depois de haver contas.
3. **Streaming.** Acompanhamento por polling de 2,5 s; o que se vê são passos gravados, não uma
   animação.

## 1.17.0 — 30 out 2026 · A base de dados a sério (Supabase atrás do `/api`)

O dono entregou as chaves do Supabase e disse «podes aplicar». Até aqui a mesa trabalhava no
armazém do browser; agora tem uma base de dados, e o `/api` que a mesa sempre chamou passou a
existir em produção.

### O que foi feito

- **`api/[...rota].mjs`** — o `/api` que faltava na Vercel. Uma função só, com o **mesmo contrato**
  que a mesa já chamava (`/auth/eu`, `/ops/summary`, `/ops/leads`, `/ops/projetos`, `/ops/tarefas`,
  `/ops/saldo`, `/ops/receita`, `/ops/today`, `/ops/pipeline`, `/ops/atividade`, `/ops/importar`).
- **`api/_repo.mjs`** — a única porta para o Postgres, por REST (PostgREST) com a chave secreta, que
  vive **só** no ambiente da Vercel. Duas implementações da mesma interface: Supabase (produção) e
  memória (testes) — por isso as rotas provam-se sem rede.
- **`api/_rotas.mjs`** — as rotas, uma vez só: não sabem (nem querem saber) onde está a base.
- **`supabase/orbita_mesa.sql`** — as seis tabelas da mesa (`orbita_leads`, `orbita_projects`,
  `orbita_tasks`, `orbita_messages`, `orbita_receitas`, `orbita_atividade`), idempotente, RLS ligado
  em todas e **nenhuma política para `anon`/`authenticated`**: o browser não fala com a base, fala
  com `/api`. (O `orbita_schema.sql` antigo continua a ser o desenho da migração do SQLite, e
  continua marcado como não executado.)
- **`/api/health`** — a prova: diz se a base responde e, se faltar o esquema, quais as tabelas em
  falta. Não se diz «ligado» sem isto responder.
- **A mesa acompanha**: 503 com `modo: 'local'` (base sem chaves ou sem esquema) faz a mesa voltar
  ao armazém do browser **e dizer porquê**; quando a base responde, a barra passa a uma linha
  verde «Base de dados ligada». E há **«Enviar para a base»**: o que já esteve no modo local sobe
  para o Postgres sem duplicar leads (dedupe por nome+cidade).
- **Dedupe real na base**: `dedupe_key` único + `on_conflict=dedupe_key` no upsert; a contagem de
  novos vs. repetidos é feita antes da escrita, para não mentir nos números.
- **Honestidade mantida**: uma tarefa criada sem motor continua a terminar «falhou — sem motor»; os
  custos de API aparecem a 0; enviar mensagem responde 501 (não há canal).

### Aplicado de facto (30 out 2026)

O esquema **foi aplicado** no Supabase, não ficou à espera de ninguém. Foi preciso um
bootstrap temporário (`/api/setup`, com token, GET, apagado logo a seguir) porque as funções
da Vercel não correm DDL pelo PostgREST e o ambiente de onde este código foi escrito não
sai para `supabase.co`. Duas lições que ficaram no código:

- o `pg` faz `Object.assign({}, config, parse(connectionString))` — **a URL ganha às
  opções**, e a cadeia de certificados do pooler do Supabase não valida com o CA do
  runtime da Vercel. Passar `ssl: { rejectUnauthorized: false }` com `connectionString`
  não serve: os campos têm de ser montados à mão;
- o PostgREST só conhece as tabelas novas depois de recarregar a cache do esquema (uns
  segundos). O primeiro `insert` a seguir ao DDL ainda pode responder «falta o esquema».

O resultado, em produção: `/api/health` → `{"ok":true,"faltam":[]}`, e um lead escrito pelo
mesmo cliente que o `/api` usa, relido e apagado (o `smoke` do bootstrap), sem deixar lixo
na base. Depois disso o bootstrap foi removido do repositório e o token apagado da Vercel.

### A rota que não existia (corrigido a 30 out, em produção)

O primeiro `/api` foi escrito como catch-all (`api/[...rota].mjs`), a pensar em
`/api/ops/summary`. Em produção provou-se o contrário: `/api/health` e `/api/ops`
respondiam, `/api/ops/summary` dava **404 da Vercel** — na Vercel a função só é
alcançada no caminho exacto do ficheiro; o catch-all apanha um segmento, não a árvore.

Não se resolveu com reescritas que dependem de detalhes do construtor. A mesa passou a
mandar o caminho **dentro do pedido**, e o envelope é aberto num sítio só (`src/mesa.js`):

```
POST /api/rpc  { "caminho": "/ops/leads", "metodo": "POST", "corpo": { … } }
→ 200 { "status": <o do caminho>, "corpo": <a resposta do caminho> }
```

`api/_rotas.mjs` não mudou uma linha — o contrato é o mesmo, e os 171 testes continuam a
prová-lo. `GET /api/rpc?caminho=/ops/summary` fica como porta de leitura para diagnóstico
(nunca aceita escrita por GET); `GET /api/health` é um ficheiro próprio, plano, que responde
no caminho exacto.

### A barra não aparecia com a base ligada

`paint()` só punha a barra de estado quando `S.modoLocal` era verdade. Com a base a responder,
a mesa funcionava e não dizia onde — que é exactamente o que não pode acontecer. Agora há dois
estados visíveis: **verde** («Base de dados ligada — o que escreves aqui fica guardado e anda
contigo entre aparelhos») ou **âmbar** (modo local, com o motivo do 503 escrito por extenso).
`mesa.smoke` passa a cobrir os três casos: 404 (sem `/api`), 503 (base em baixo) e envelopes do
`/api/rpc` (base a responder). Em produção, `/app` mostra a barra verde.

### Limitação declarada: ainda não há contas

O `/api` é público: quem souber o endereço pode ler e escrever na mesa. Não é um descuido —
é o passo que falta (login com Supabase Auth, e o RLS a sério por utilizador). Até lá, a única
protecção é o endereço não ser divulgado. Fica escrito aqui e no relatório ao dono.

### Provas

- **`api.test.mjs` (novo, 14 testes)**: contrato completo (leads com dedupe, projetos à mão e a
  partir de um lead, dinheiro, tarefas honestas, mensagens, importação), e o cliente PostgREST —
  cabeçalhos, `on_conflict`, chave **nunca** na URL, e a distinção entre «tabela em falta» (503,
  com a instrução de correr o SQL) e «rede em baixo».
- **171 testes** no total; `mesa.smoke` ganhou o caso 503 (base em baixo → modo local, com o motivo
  escrito) e continua a provar o 404 (sem `/api`).
- **O que NÃO se prova aqui**: a ligação real ao Supabase. O ambiente onde este código foi escrito
  não tem saída para `supabase.co`. Isso prova-se em produção, em `/api/health`.

## 1.16.0 — 30 out 2026 · A mesa deixa de ser uma demonstração

Pedido do dono, com uma fotografia do telemóvel à frente: *«todas estas páginas já deram aceitar e
estar muito bem funcionais, chega de demonstrações só»*. Na fotografia, a mesa publicada dizia
«A mesa precisa do Órbita a correr na tua máquina» e um botão para voltar ao escritório.

### O que estava mal

A mesa é um cliente HTTP (`src/mesa.js`, `const API = '/api'`). Publicada na Vercel, `/api` não
existe — a Vercel serve ficheiros estáticos — e a página tinha uma saída de recurso: um cartão a
mandar arrancar o Órbita na máquina. Para quem abre o site, isso é uma demonstração. E a decisão
anterior (servidor a sério num host à parte) ficou presa por não haver base de dados disponível.

### O que mudou

- **A mesa passou a trabalhar neste browser** (`src/localapi.js`): o **mesmo contrato** que o
  servidor (`/auth/eu`, `/ops/summary`, `/ops/leads`, `/ops/projetos`, `/ops/tarefas`,
  `/ops/saldo`, `/ops/receita`, `/ops/today`, `/ops/pipeline`, `/ops/atividade`…), implementado
  sobre o `localStorage`. A mesa não soube a diferença: `call()` é o único ponto de entrada e, se o
  `fetch` der 404 ou falhar a rede, passa a usar o armazém local.
- **Sem dados de demonstração**: o armazém nasce vazio. Um lead escrito fica escrito, sobrevive a
  fechar e reabrir, e conta no resumo e no funil. O que não existe responde com o vazio honesto:
  agentes com 0 a correr, atividade vazia, pesquisa vazia.
- **O que não sabe fazer, diz que não sabe**: uma tarefa criada sem motor de IA fica registada e
  **termina «falhou — sem motor»**, nunca «concluída». Custos de API aparecem a 0 porque não
  houve nenhum. `enviar` responde 501 («no modo local não há canal de envio»).
- **Aviso sempre à vista** (não um erro, não se fecha): «Modo local — os teus dados ficam neste
  browser», com o número de leads e projetos, e duas acções: **Guardar cópia** (descarrega um
  `.json` com tudo) e **Ler cópia** (substitui, com confirmação). Um browser não é uma base de
  dados — e isso passa a estar dito e resolvido, em vez de escondido.
- **O cartão de demonstração saiu.** O único ecrã de falha que resta é o honesto: se o browser
  bloquear o armazenamento (navegação privada), diz-se isso e o que fazer.
- A porta para a base a sério continua aberta: no dia em que houver `/api` (Vercel + Postgres), é
  ela que manda e o modo local fica como recurso — a mesa já escolhe sozinha.

### Provas

- **`mesa.smoke.mjs` (novo)**: carrega o bundle publicado num DOM **com `/api` a responder 404** (é
  o que a Vercel faz) e verifica que a mesa abre, que o cartão de demonstração desapareceu, que o
  aviso do modo local está lá, e — a sério — que o formulário de lead **escreve no armazém** e que
  ao reabrir a página o lead **volta a ser lido**.
- **`localapi.test.mjs` (novo, 13 testes)**: começa vazio; identidade local; lead guardado e
  relido; dedupe que atualiza em vez de duplicar; sem nome não entra; dinheiro entra/soma/apaga sem
  custos inventados; projetos à mão e a partir de um lead; tarefa sem motor que o diz; vazio
  honesto; 501 no que não existe; cópia de segurança; resumo e funil a contar só o que existe.
- **157 testes** no total (144 + 13) e as duas cenas verdes.

### Limitações declaradas

Nada é enviado para fora; os dados vivem neste aparelho e neste browser (limpar os dados do site
apaga-os — daí a cópia). Não há agentes a correr, nem WhatsApp/email a sair, porque não há motor
nem canal. Para partilhar entre aparelhos é preciso a base de dados — a interface e o contrato já
estão prontos para ela.

## 1.15.2 — 30 out 2026 · O Cérebro responsivo — e um ✕ para sair

Pedido do dono: *«deixa responsivo a parte do cérebro, deixando a tela capaz de fazer qualquer
actividade, e implementa um botão X para sair»*.

### O defeito que estava lá

O ✕ do Cérebro **existia no HTML e nunca se viu**: o CSS escondia-o em todos os estados
(`#bvClose { display: none }` **e** `#brainOv.on #bvClose { display: none }`, com o comentário
«Esc e o pod fecham»). No computador fechava-se com `Esc`; **num telemóvel não há `Esc`** — o grafo
era uma armadilha. E o grafo era só de rato: `mousemove`/`mousedown`/`wheel`, zero toque, zero
pinhole. Num dedo não se movia, não se ampliava e nem se abria uma nota.

### O que mudou

- **✕ a sério**: sempre visível com o grafo aberto (34 px no ecrã grande, **44 px no telemóvel**),
  com `aria-label`, a fechar pelo mesmo caminho do `Esc`, e a devolver o foco a quem o tinha antes.
  A marca «O CÉREBRO» saiu da frente dele.
- **A nota é uma folha, não uma coluna**: em ≤ 640 px o painel de 340 px (mais largo do que um
  telemóvel de 320) passa a folha inferior de 46 vh, com **✕ próprio** — que fecha a **nota** e
  deixa o grafo aberto. Com a folha aberta, a placa da licença sai da frente.
- **Barra de topo em duas filas**: pesquisa a 100% com **16 px** (o iOS deixa de ampliar ao tocar) e
  os filtros num carrossel horizontal com `-webkit-overflow-scrolling`.
- **O grafo trabalha com o dedo**: `pointerdown/move/up` com captura do ponteiro (rato e dedo no
  mesmo caminho), **pinhole** para ampliar, toque simples abre a nota, arrasto move (só passa a
  arrasto depois de 6 px — um dedo treme sempre), `touch-action: none` no vidro. O centro da
  escala passa a ser o **centro do que se vê**, já descontada a folha.
- **Sair deixa tudo limpo**: dedos, arrasto, pinhole e nota são esquecidos no `close()`; a nota lida
  não reaparece na visita seguinte; `role="dialog"` + `aria-label` no overlay e no canvas.

### Um defeito no próprio teste

O relatório de falhas do `scene.smoke.mjs` estava **a meio do ficheiro**: as provas escritas depois
dele (o pé da escada, os cartões do telemóvel, o Cérebro) corriam e **ninguém as contava**. Passou
para o fim. Na primeira execução apanhou logo três coisas — uma delas real: ao inserir o CSS do
Cérebro, o passo dos 400 px dos cartões tinha sido apagado sem querer. Restaurado.

### Provas

- `scene.smoke.mjs` ✓ com as provas todas a contar: o ✕ alterna entre escondido e visível, fecha de
  verdade (`#brainOv` perde `.on`, `body` perde `brainOpen`), a nota tem ✕ próprio, `body.bv-note`
  sobe e desce sem fechar o Cérebro, a escala amplia e respeita o tecto de 7, e sair não deixa nota
  nem dedo pendurados.
- **144/144** testes. Nota honesta: os gestos não se simulam em jsdom — provam-se a conta da escala
  e os estados; o pinhole e a folha julgam-se com o dedo no telemóvel.

## 1.15.1 — 30 out 2026 · Os cartões das salas no telemóvel

Pedido do dono: *«na versão mobile eu quero que diminuas o tamanho dos quadrados de indicação da sala
(as tabelas de indicação dos temas das salas) — deixa bem responsivo na versão mobile»*.

O cartão de cada sala foi desenhado para uma secretária: **138 px** de largura mínima e três métricas
em linha (rótulo à esquerda, número à direita). Num telemóvel de 390 px, seis destes tapavam o
escritório. No ecrã pequeno o mesmo cartão passa a caber — **sem perder um número**:

- **as três métricas passam a três colunas**: rótulo curto por cima (`CURSO · ESPERA · 24H`, o texto
  completo continua no DOM e no `aria-label`), número por baixo;
- o cartão fica em **88 px** de largura mínima (80 px abaixo dos 400 px de janela) e o tipo desce o
  suficiente para se ler a 30 cm do ecrã;
- a fila de aprovação reduz-se a **⚠ e ao contador** — a frase inteira continua no `aria-label`;
- o filete da cor do vidro encurta com o cartão, e o cartão do Cérebro encolhe para uma pastilha
  ainda mais fina.

E duas coisas que não são só CSS:

- **a escala acompanha a janela** (`badgeFit`: 1,00 a partir de 900 px, 0,88 aos 400 px) — a cena
  continua a projetar os cartões nos sítios certos, só que mais pequenos;
- **em ecrã ≤ 640 px os cartões arrumam-se**: quem colidir com outro é empurrado para baixo até
  deixar de o tapar, com o topo e o fundo do ecrã como limites. Nenhum cartão sai da vista e nenhum
  fica escondido atrás de outro.

O ecrã grande não mudou — as regras novas vivem dentro de dois `@media` e a arrumação só corre em
ecrã estreito.

### Provas

- `scene.smoke.mjs` passou a provar: a escala desce com a largura (`1280 → 1,00`, `640 < 900`,
  `390 < 0,95`), os **7** cartões (6 salas + Cérebro) continuam com as **três** métricas e com o
  rótulo curto, o «À ESPERA DE APROVAÇÃO» não desapareceu do cartão, três cartões no mesmo sítio
  saem de cima uns dos outros, e o CSS do telemóvel está no bundle (três colunas, `attr(data-short)`,
  o passo dos 400 px).
- **144/144** testes (`a11y · office · forge · platform · terminal · circulation · settings`).
- Nota de honestidade: o harness não tem layout (`offsetWidth` é 0), por isso o tamanho final do
  cartão prova-se pela conta (escala + CSS) e pelo olho — não por uma medição em jsdom.

## 1.15.0 — 29 out 2026 · Configurações a sério: APIs, tema, avisos, painéis — e o pé da escada

Pedido do dono: *«cria um campo para implementação de APIs, configurações reais, até mudança de tema
(claro para escuro) e notificações reais, e depois atualiza no deploy. versão mobile possibilidade de
fechar as janelas, possibilidade de afastar o campo de IA e estado de tarefas, e por último dar mais
um toque de melhoria na escada, só no canto que toca a sala em baixo»*.

### Um painel, quatro coisas que funcionam

Tecla **`,`** ou o botão **Config** na barra. Tudo o que aqui se guarda é a sério; nada é decorativo.

- **APIs.** O catálogo real do servidor (`/api/platform/apis`): 27 serviços, o que cada um é, e o que
  lhe falta. Um campo por variável de ambiente e **«Guardar e testar»**: a chave é escrita no `.env`
  da máquina, o ficheiro é relido sem reiniciar nada (o vigia já existia desde 1.12) e o serviço é
  **sondado logo a seguir** — o que aparece é o HTTP e a latência reais, ou o erro real
  (`fetch failed: ECONNRESET`, por exemplo). «Apagar chave» remove-a do ficheiro.
  A rota `POST /api/platform/key` só aceita pedidos **de loopback** (ou com o token da API): escrever
  chaves é um acto local. Ela valida que a variável pertence mesmo ao serviço, recusa valores com
  mudança de linha, e **nunca devolve o valor da chave** — só o nome.
- **Tema.** Claro · Escuro · Automático (o que o sistema disser), aplicado no arranque, guardado no
  browser (`orbita.tema`) e a acompanhar a cena 3D. A tecla `D` continua, mas agora escolhe e guarda.
- **Avisos.** Notificações do browser pedidas **num clique teu** (nunca no arranque) e disparadas só
  por trabalho real: um posto que fica à espera do teu OK, um posto que falha. O primeiro retrato do
  servidor é o ponto de partida — não chovem janelas por trabalho que já estava parado; o mesmo aviso
  não se repete ao segundo; no máximo três de cada vez. Sem servidor, o interruptor aparece desligado
  e diz porquê.
- **Painéis.** Afastar o **campo de IA** (a conversa fica, a caixa recolhe a uma linha) e o **estado
  das tarefas** (fica um botão no canto). A escolha fica guardada num browser e no telemóvel a coluna
  das tarefas nasce recolhida.

### Telemóvel: fechar as janelas

- O painel do posto ganhou um **✕** (`#railClose`) — o telemóvel não tem `Esc`.
- Leads, Operação e Configurações passam a **ocupar o ecrã** em ecrãs estreitos, e todos os fechar
  passam a ter **44 px** de alvo. O campo das chaves usa 16 px de letra (o iOS deixa de fazer zoom
  sozinho ao tocar).

### O pé da escada

Só a ponta que **assenta na sala** mudou; a ponta do Cérebro ficou exactamente como estava. A
passadeira deixou de acabar num corte direito: agora há um **platô** com o mesmo tapete escuro (mas
parado — é um patamar), nove dentes de latão no pente de entrada, dois cantos arredondados a fechar a
guarda, e a linha de LED da sala a atravessá-lo até uma barra de entrada em frente à porta. Ao todo,
três malhas a mais por corredor.

### Dois defeitos que isto destapou

- **O modo escuro rebentava a cena.** `brain.js` mexia em `eqMat`, uma variável que já não existe
  desde que o equalizador da nebulosa saiu. Só se abria escuro pela tecla `D` ou por `/dark`; com o
  tema a aplicar-se no arranque, era o escritório inteiro a desaparecer. Corrigido.
- **Aplicar o tema cedo demais** (antes de existirem materiais e luzes) também dava cena em branco —
  o tema passa a ser aplicado no arranque, depois de a cena estar montada.

### Provas

- **144/144** testes (`settings.test.mjs` é novo: 14 testes do tema, dos avisos, dos painéis e do
  `.env`), cena verde, e o `POST /api/platform/key` provado contra o servidor real: escreveu a chave,
  releu o `.env`, sondou, devolveu o erro da sonda, e apagou-a quando pedido — sem devolver o valor.
- `node build.mjs` → `dist/` com o sítio completo.

## 1.14.1 — 29 out 2026 · o que só se vê com o site aberto

A página estava publicada; estas quatro coisas só apareceram ao lê-la **em produção**, com os olhos de
quem chega de fora.

- **A barra dizia «LIGADO A» sem nada ligado.** A correção do rótulo existia num caminho, mas o ciclo de
  desenho reescrevia-o por frame (ao entrar e sair de uma sala). Passa a haver **uma constante**
  (`ROTULO`) usada nos três sítios: **CONECTORES** quando não há servidor.
- **A oficina (tecla F) ficava em «a ligar…» para sempre.** Sem servidor não há nada a ligar; agora
  consulta o estado ao abrir e diz **«sem servidor — abre com `npm start` para ver a oficina a trabalhar»**.
- **O contador de aprovações nascia em 1.** Os 35 postos estão `idle` e o contador vinha do cartão de
  demonstração. Agora nasce em **0** e só sobe quando a base de dados tem uma tarefa `awaiting_approval`.
- **A mesa (`/app`) respondia «HTTP 404»** na vista publicada. Um 404 aqui não é uma avaria: é «não há
  servidor neste sítio». Passa a explicar isso e a apontar para `npm start` e para o escritório.

Provado na página publicada: `CONECTORES · sem servidor`, `MOTOR · sem servidor`, `⚠ 0 À ESPERA DE
APROVAÇÃO` nas seis salas, `SÓ VISUALIZAÇÃO` no painel de tarefas, **130/130** testes e cena verde.

## 1.14.0 — 29 out 2026 · Lançamento: a marca, o sítio e a honestidade de estar sem servidor

Pedido: *«faça as melhorias gerais finais, analisa coisa por coisa, passo por passo e depois faça o
lançamento — um deploy para Vercel já oficial»*.

### O que faltava para isto ser um lançamento

- **A página não tinha cara.** Abria como um ficheiro; partilhada, aparecia sem ícone e sem cartão.
  Agora tem **ícone** (`icon.svg` + `apple-touch-icon`), **manifesto** (guarda-se no ecrã inicial),
  **description**, **Open Graph** e **Twitter card**, e uma **imagem de partilha 1200×630**.
- **A marca desenha-se, não se escreve à mão.** `tools/brand.mjs` (novo) gera os quatro ficheiros a
  partir da paleta das seis salas (`src/data.js`): o ícone é o circuito — seis pastilhas, uma por
  sala, em volta do Cérebro — e a imagem de partilha é a **planta real** do escritório (salas, pontes,
  Cérebro) com o nome por cima, desenhado numa fonte 5×7 feita à mão. Zero dependências: PNG escrito
  com `node:zlib`.
- **O `dist/` passou a ser um sítio.** `index.html` na raiz, a mesa em `/app` (e `/app.html`),
  `icon.svg`, `og.png`, `manifest.webmanifest`, `robots.txt` e uma `404.html` que diz a verdade em vez
  de um erro de servidor. `vercel.json` com `cleanUrls`, cabeçalhos de segurança e cache.

### O que estava errado e agora está dito

- **Sem servidor, o escritório mentia por omissão.** Na vista publicada (estática) a barra mostrava
  **«LIGADO A Notion · Gmail»** e **«CORRE SEM INTERFACE EM Claude»** — herança do cartão de
  demonstração. Não havia servidor nenhum a responder. Agora a barra diz **«sem servidor — os
  conectores vêm do `claude mcp list` desta máquina»**, e o motor diz o mesmo. Continua a não haver
  tarefa inventada: a barra de tarefas responde com o que falta, e o canto passou a dizer
  **«SÓ VISUALIZAÇÃO»** (antes ficava em silêncio e parecia avariado).
- **Duas frases para o mesmo silêncio.** O aviso do compositor distinguia mal «não há servidor» de
  «há servidor e não há motor de IA»; agora distingue — e um `404` em `/api/health` conta como
  «não há API aqui», que é o que é.
- **Os nomes das salas estavam escritos em três sítios** (`forge.js`, `live.js`, `data.js`) e dois
  deles já divergiam (`ENTREGA`/`ENGENHARIA`, `DESIGN`/`DESIGN LAB`). Passam a ler `DEPTS[k].short`.

### Acessibilidade

- **`prefers-reduced-motion` chegou à cena 3D.** O CSS já respeitava a preferência; a luz dos vidros e
  o tapete das passadeiras continuavam a correr. Passam a andar a **um terço** da velocidade — a luz
  continua viva (é a vida das salas), mas deixa de puxar pelo olho. Fica exposto em `CC.motion`.

### Provas

- `node tools/brand.mjs` → 4 ficheiros; `node build.mjs` → 14 ficheiros em `dist/`.
- **130/130** testes (`node --test …`) e **cena verde** (`node scene.smoke.mjs`), sem regressões.
- **Publicado e aberto**: https://orbita-agentes.vercel.app — ver `docs/LANCAMENTO.md` para o que está
  publicado, o que é estático e o que é preciso para ter dados a sério.

## 1.13.2 — 28 out 2026 · As portas passaram a abrir para o Cérebro (e a ponte sai delas)

Pedido: *«melhore os lugares das portas e analisa bem e muda isso com dev apple design 3D»*.

### A análise, primeiro

A 1.13.1 pôs a porta no **meio do pano de fundo** de cada sala. Era melhor do que o canto, mas partia
de uma suposição falsa: **o Cérebro não está em frente desse pano**. As seis salas estão em diagonal
no campus (`±30, ±23` e `0, ±48`, com o pod do Cérebro em `0,0`), e o vector «centro da sala →
Cérebro» sai do pod por um canto, não pelo meio do pano. Resultado: a passadeira saía enviesada da
porta e corria **encostada ao pod**; nas salas de canto a porta ficava **perpendicular ao pano que a
recebia**; e nas três salas cuja porta caía no bordo aberto a porta estava de pé no vazio.

O que a planta diz agora (conta em `src/circulation.js`, valores reais):

| sala | porta no lado | vão | ponte |
|---|---|---|---|
| emails | `+x` | **anteparo** (lado aberto) | 13,8 m → canto `-8,-8` |
| delivery | `+z` | **anteparo** | 22,1 m → `0,-8` |
| sales | `-x` | vão na parede lateral | 13,8 m → canto `8,-8` |
| marketing | `+x` | **anteparo** | 13,8 m → canto `-8,8` |
| fin | `-x` | vão na parede lateral | 13,8 m → canto `8,8` |
| ops | `-z` | vão na parede de fundo | 22,1 m → `0,8` |

### O que mudou

- **`src/circulation.js`** (novo): a regra num sítio só. A porta fica no lado da sala que olha para o
  Cérebro, no ponto em que a linha *centro → átrio* sai do pod; a ponte vai desse ponto ao canto do
  pod do Cérebro **em linha recta**, e nasce 0,9 m à frente da porta, no eixo dela.
- **O vão passou a poder abrir nos dois panos.** `makeRoomWalls` aceita `opening: { side, at, w, h }`:
  parte a parede de **fundo** (`-z`) ou a **lateral** (`-x`), com verga, rodapé partido e ripaado que
  não atravessa. Antes só o pano de fundo sabia abrir-se.
- **A porta passou a assentar na face interior do pano que a recebe** (0,46 m para dentro: espessura da
  parede + meio aro) e, quando não há parede, no bordo do pod com 3 cm de folga.
- **O ANTEPARO** — um pano próprio para as três salas cuja porta cai no lado aberto: base de marfim
  até 1,02 m, **banda de vidro** até 2,80 m, montantes e remate de latão, fio de luz na cor da sala.
  É de vidro por cima de propósito: fecha a porta sem tapar a sala à câmara.
- **A PRAÇA do limiar** — um disco de pedra de 2,30 m de raio em cada porta, com aro de latão e anel
  aceso. Não é enfeite: quatro das seis pontes chegam à porta em diagonal, e um tapete de 3,2 m a
  entrar a 36° numa porta de 2,6 m deixava uma cunha à vista e um canto a raspar no pano. A praça
  absorve o ângulo — o tapete nasce debaixo dela — e dá às seis entradas o mesmo gesto.
- **A passadeira, o percurso dos chefes e a porta leem a MESMA conta**: `deptRT.gate`/`brainGate`
  passam a sair de `bridge.from`/`bridge.to`, por isso o chefe anda por cima do tapete em vez de
  atravessar o chão ao lado dele.

### Provas

- **`circulation.test.mjs`** (novo, 9 testes, sem three): porta no bordo do pod, eixo aponta ao
  Cérebro, 2 m à frente da porta é fora do pod, ponte nasce a 0,9 m no eixo, acaba no bordo do pod,
  não atravessa a sala nem o pod, 3 paredes / 3 anteparos, seis sítios distintos, átrio como
  argumento (átrio maior → pontes mais curtas), sala inexistente dá erro.
- **`scene.smoke.mjs`** (8 asserções novas, agora sobre o que foi CONSTRUÍDO): o vão na parede é o da
  planta, o eixo da porta é o da planta, a passadeira começa e acaba onde a ponte manda, o anteparo
  cobre a porta e a praça existe. Total: **130/130** (121 antes).
- **`tools/portas.mjs`** (novo) desenha a planta inteira sem browser (o desenho está em
  `docs/planta-portas.png`), e o **`tools/room.mjs`** passou a montar a sala **com** o vão e a porta —
  antes desenhava uma sala fechada que já não existia.

## 1.13.1 — 28 out 2026 · As portas passaram a ser portas

Pedido: *«melhore o design 3D das portas»*.

### O que estava errado (e porquê)

- **A porta flutuava.** O `rboxGeo` cresce a partir da BASE do objecto, e a primeira versão colocava os
  montantes a meia altura (`H/2`): os postes começavam a 1,3 m do chão. Vê-se no primeiro desenho.
- **A porta não tinha parede.** O corredor saía do *canto* da sala — a 1 m da esquina — e o pórtico
  ficava 1,1 m à frente do pano, solto no ar. Não havia buraco, não havia passagem: de fora não se
  via nada, e de dentro era um adereço ao lado de uma parede inteira.

### O que mudou

- **O corredor passa a nascer no MEIO do pano que dá para o Cérebro.** É a raiz da correcção: ao
  centro há parede onde abrir um vão, e a porta assenta nele. As esquinas ficam livres.
- **A parede abre-se.** `makeRoomWalls` aceita `opening: {x, w, h}` e parte o pano de fundo em dois
  troços, com **verga** por cima, **rodapé partido** e **ripaado que não atravessa** o vão. Três salas
  têm vão na parede; as outras três recebem a porta no bordo aberto (não há parede para abrir).
- **Porta nova**, à escala de uma pessoa e de um corredor de 3,2 m:
  - aro de latão **2,84 × 2,64** com 0,24 de fundo e **vão livre de 2,60 × 2,18**;
  - **duas folhas de vidro fosco** (opacidade 0,26) que abrem **ao meio**, 0,45 cada — como uma porta
    automática — com **puxador de latão** no bordo de ataque de cada uma;
  - **carril** com carros à vista e **bolsos** nas pontas (a folha deslizada recolhe ali; sem eles, uma
    folha aberta ficava pendurada no ar nas salas sem parede);
  - **soleira**, dois **filetes de luz** no piso e uma **mancha de luz** que a entrada deixa cair no
    corredor;
  - **luz sob a padieira** dos dois lados e dentro do vão da parede;
  - **placa com o NOME da sala** (1,12 × 0,26, duas faces, desenhada em canvas na cor do vidro) — é a
    única peça escrita da cena, e diz o nome do sítio, não um número;
  - **barra de topo acesa** na cor da sala: é a peça que se lê da câmara isométrica, que olha o
    escritório de cima — antes de se ver a porta, vê-se a cor dela na entrada;
  - **aro de latão na face do corredor**, para o mesmo desenho dos dois lados.
- **`WALL` e `DOOR` exportados** por `src/builders.js`: a parede e a porta passam a ler as mesmas
  medidas. Foi a falta disto que deixou a primeira versão 10 cm ao lado do buraco.
- **Corrimãos do corredor encurtados** 1,15 m do lado da sala: passavam à frente da porta e cortavam a
  entrada ao meio.
- **No escuro**: latão velho, vidro mais denso, LED da entrada mais intenso — a porta é das últimas
  coisas que se apagam numa sala sem luz.

### Provas

`node scene.smoke.mjs` passou a exigir, além das cores:

```
✓ contorno de 2,7–3,2 m e vão livre ≥ 2,4 × 2,0
✓ duas folhas abertas mais de 0,3 m
✓ a placa de cada porta diz o nome da sala
✓ 3 salas com vão na parede (≥ 2,8 × 2,2) e 3 com a porta no bordo aberto
```

Desenhos do rascunho (o rasterizador caseiro não tem emissão nem texturas, por isso o LED e a placa
aparecem sem brilho): `docs/porta-sala.png`, `docs/porta-corredor.png`, `docs/porta-na-sala.png`.

### Dito sem enfeitar

- A **placa não é legível de todos os ângulos**: a câmara é isométrica e olha as paredes de cima; o
  nome lê-se, mas em escorço. A cor e a barra acesa é que fazem a identificação à distância.
- O **vidro não é vidro**: é um material transparente com 0,26 de opacidade, sem refracção nem
  reflexos do ambiente. À escala do escritório lê-se como vidro fosco; ao lado, não engana ninguém.

## 1.13.0 — 28 out 2026 · Passadeiras a andar, entradas à cor da sala, e a API que já está de pé

Pedido: *«faça passadeiras rolantes no corredor, preta, e entradas na sala (roxa, azul e amarela); e
implementa entrada de API real — assim que lançar o projecto, colocar a API já deve funcionar de
forma automática; faz esse preparo agora, para todos os tipos de app, as APIs devem funcionar logo,
instantaneamente. E o terminal deve funcionar perfeitamente, se possível de acordo com a máquina
onde o sistema foi aberto.»*

### As passadeiras andam — e são pretas

- O corredor deixou de ser uma laje com uma linha de luz. É uma **passadeira de aeroporto**: tapete
  **preto** (`#23252B`) com ripas em relevo, **guardas de latão** dos dois lados, um canal de LED na
  cor da sala e o aro de chegada fundido no latão.
- **O tapete rola a sério**: uma textura de ripas (64×64, gerada uma vez e clonada por corredor, com
  `repeat = comprimento / 1,15`) desloca-se ao longo do comprimento. Nada de aspecto: o `offset` da
  textura muda entre dois frames, e é isso que o teste verifica.
- A direcção é a do trabalho: **para o Cérebro**, a mesma da luz da sala por cima. Sala com trabalho
  (`live` + `waiting`) → a fita **e** o tapete andam 2,6× mais depressa.

### Cada sala tem uma entrada na sua cor

- `makeRoomEntrance` (novo em `src/builders.js`): **pórtico** de 4,6 × 2,62 m — dois montantes de
  latão, lintel, **cova de luz acesa na cor do vidro da sala** e soleira escura com dois filetes
  acesos.
- Assenta **1,1 m para dentro** da porta, virado ao corredor (a direcção vem do `main`, que é quem
  conhece o corredor). É clicável: clicar no pórtico foca a sala.
- As seis cores são as do vidro de cada sala: verde (#1FA36B), amarelo (#E3B93A), vermelho
  (#DC5348), roxo (#8B5AD6), azul (#4A6DE0) e azul-céu (#41AEE4). Nenhuma foi escolhida à mão: vêm
  de `src/data.js`.

### A API real, de pé ao arrancar (`platform.mjs`)

- **Catálogo de 27 serviços** com sonda própria: IA (OpenAI, Anthropic, Gemini, OpenRouter, Groq,
  Mistral, Hugging Face, Replicate, ElevenLabs), dados (Google Places, Programmable Search),
  base de dados (Supabase, Airtable, Notion), código e deploy (GitHub, Vercel, Cloudflare, AWS),
  pagamentos e loja (Stripe, Shopify) e mensagens (Resend, SendGrid, Twilio, Telegram, Slack,
  Discord, Meta).
- No arranque o servidor **sonda** cada serviço que tenha chave — uma chamada barata, com prazo de
  6 s, sem efeitos secundários — e guarda o resultado 10 minutos. `GET /api/platform` devolve o
  retrato: máquina, versões, o que está `ready`, o que falhou e **qual variável falta em cada um**.
- **`.env` a quente**: o ficheiro é vigiado; gravar uma chave nova entra no processo e dispara novas
  sondas **sem reiniciar**. É o «instantaneamente» do pedido, e é literal.
- **O token interno deixa de ser um passo manual**: se `ORBITA_API_TOKEN` não existir em lado nenhum,
  nasce no primeiro arranque (256 bits, 43 caracteres) e é escrito no `.env` com permissões 600.
- **Qualquer app**: `data/api/providers.json` acrescenta serviços sem tocar em código (`id`, `name`,
  `env`, `probe.url`, `probe.header`, `prefix`). Entradas inválidas são ignoradas com aviso.
- `GET /api/platform` e `/api/platform/apis` abrem **CORS** (`*`): uma app web, um telemóvel ou outro
  servidor pode perguntar «com que contas eu» no arranque dela. As rotas privadas continuam fechadas.

### O terminal olha para a máquina

- `:help` ficou **curto** (três linhas); a lista completa mudou para `:comandos`.
- `:maquina` mostra SO, arquitectura, núcleos, CPU, memória, uptime, fuso, `node`, `shell`, `pid`,
  directoria e **as ferramentas do PATH com a versão que elas dizem** (e as que faltam).
- `:api` mostra quantos serviços estão prontos, os que falharam com o erro, e a chave que falta.
- **Tab** completa o comando; **↑ ↓** percorrem o histórico e o rascunho a meio não se perde.
- Ao abrir, o terminal escreve **uma** linha com a máquina onde está — uma vez por sessão.
- Comando desconhecido → sugestão do mais parecido (distância de edição), em vez de silêncio.

### Provas

- `node scene.smoke.mjs` — passa a verificar **6 passadeiras pretas** (`#23252b`), que o `offset` do
  tapete **muda entre dois passos** da simulação, e **6 entradas** cuja cor é a do vidro da sala.
- `node --test platform.test.mjs` — 12 testes: `.env` (aspas, `export`, lixo), token gerado uma só
  vez, 200 → pronta, 401 → «com chave mas falhou», **a chave nunca sai numa mensagem de erro**, AWS
  não finge estar verificada, chave nova a quente sem reiniciar, ambiente real a mandar sobre o
  ficheiro, serviços declarados em JSON, máquina e descoberta de rotas.
- `node --test terminal.test.mjs` — 8 testes com jsdom sobre o `src/forge.js` que vai para o browser:
  `:help` curto, `:comandos` completo, `:maquina`/`:api` a mostrarem **o que o servidor respondeu**,
  Tab, histórico, sugestão, e a linha da máquina uma só vez.

### Dito sem enfeitar

- Uma chave de terceiros continua a ser **do dono**: a automação cobre o token interno, a leitura do
  `.env`, as sondas, o diagnóstico e o recarregamento. Sem a chave da Gemini não há Gemini — o que
  passa a haver é a resposta exacta de qual variável falta, em vez de um erro genérico.
- AWS não tem sonda barata (assinatura SigV4 exige região): aparece como configurada e **não
  verificada**, e diz isso.
- O `node check.mjs` continua a marcar falha no `smoke: browser` nesta máquina: não há Chromium.

## 1.12.0 — 28 out 2026 · A circulação: o Cérebro é a sala, e o escritório mexe-se

Pedido: *«nos vidros deve passar uma luz LED da cor, e também quero arriscar numa elegância neste
projecto, criando uma estrutura mais bonita; cria corredores na direcção do Cérebro, que será onde as
pessoas vão passar os projectos para a outra equipa pegar e continuar… o Cérebro vira uma sala
futurística, coisa de outro mundo, rodeada de LED; mantém o globo em destaque, como um ponto onde
cada chefe se reúne… e cria movimentos para cada chefe: quando tiver dúvida ou quiser pedir ajuda,
dirige-se à sala do Cérebro. Quando peço algo no chat, o chefe deve estar na sala, depois vai à sala
dele, explica ao grupo e criam — como 100% de pessoas normais numa empresa de engenharia.»*

### O Cérebro passou a ser uma sala (não um objecto)

- **A praça**: dois aros de latão no chão (r 3,1 e 6,4) e um **aro de LED a fechar a sala** (r 7,1).
- **Seis púlpitos**, um por sala, a 5,0 m do centro: pé e fuste de latão, tampo de vidro inclinado
  para quem está de pé, **aresta acesa e ecrã na cor da sala**. É o lugar de cada chefe, e vê-se de
  longe quem é de onde.
- **Três colunas** de 2,7 m com um **colar de luz** a meio fuste: marcam a sala sem a fechar (o pod
  não tem tecto).
- O **orbe** (o globo) não foi tocado: continua a ser o centro, e agora tem uma sala à altura dele.

### O LED que passa

- Cada pano de parede ganhou **uma calha acesa** no arranque do vidro e **uma luz a percorrer o vidro**
  — uma textura de cometa em mistura aditiva que rola ao longo da faixa, na cor da sala.
- **18 faixas** no total: 2 por sala nas paredes + 1 por corredor. Anima-se tudo numa passagem por
  frame; **a luz acelera onde há trabalho real** (`live` + `waiting` daquela sala) e continua lenta
  onde não há. Não é telemetria: é ambiente — mas não mente sobre onde há trabalho.

### Os corredores

A passadeira branca por baixo do chão passou a **corredor**: piso ao nível das salas, guardas de
latão dos dois lados, **linha de LED na cor da sala a correr para o Cérebro** e um aro de latão a
marcar a chegada. Lê-se a direcção do trabalho.

### A circulação (o coração do pedido)

- O chefe **levanta-se quando há trabalho**: uma tarefa nova na sala → vai ao Cérebro buscá-la
  (3,0 s no anel, virado ao orbe), volta pelo corredor e **explica ao grupo no topo da sala** (3,2 s).
- Alguém **à espera de uma decisão** → o chefe vai ao Cérebro **pedir ajuda** (2,4 s) e volta a contar
  o que trouxe (2,0 s).
- Uma tarefa **acaba de correr bem** → o chefe **leva o trabalho ao Cérebro** (2,2 s) — o «passar o
  projecto» do pedido — e volta ao posto sem discurso.
- **O último troço é sempre a pé** até à cadeira: o chefe nunca «teleporta» do topo da sala para o
  lugar (fase `seat`).
- **O grupo levanta-se para ouvir** — pose nova `listen` (de pé, braços ao lado do corpo, cabeça
  voltada a quem fala) — e volta ao posto quando ele acaba.
- **Só a base de dados manda alguém andar.** O sinal é o `id` do trabalho, com memória: o mesmo pedido
  nunca faz o chefe andar duas vezes. Sinais velhos (>25 s) caem; 9 s de descanso entre viagens.
- O percurso usa o **eixo central** da sala (o único corredor que não atravessa uma secretária) e a
  **porta** (o canto aberto). O mesmo nos dois sentidos.

### O que ficou provado (e como)

`npm run test:scene` — 34 asserções novas, incluindo o ciclo completo da coreografia, com um
sinal **real** e o tempo avançado à mão (`CC.stepSim`, porque o WebGL falso do harness morre no
primeiro *render target*):

```
✓ 18 faixas de LED (3 por sala) · corredores com guardas em 6 salas
✓ sala-mestre com 6 lugares de chefe e um aro de 7,1 de raio
✓ o chefe levanta-se, chega ao Cérebro, volta, explica, o grupo levanta-se
✓ o mesmo trabalho não o manda andar duas vezes
```

`node tools/master.mjs` desenha a sala-mestre com o rasterizador caseiro → `docs/cerebro-sala.png`.
Guia: [`docs/CIRCULACAO.md`](docs/CIRCULACAO.md).

### Limites declarados

Não há procura de caminho (são rectas entre pontos fixos), nem colisões entre pessoas, nem conversa
entre agentes (não há motor de IA nesta máquina): o grupo levanta-se e ouve, e a postura não finge
conteúdo. A passagem de um projecto de uma equipa para outra acontece no Cérebro, onde os chefes se
cruzam, mas não há um estado «entregue a outrem» inventado no registo do trabalho.

## 1.11.0 — 27 out 2026 · A oficina: os agentes forjam as próprias ferramentas

Pedido: *«implementa um sistema capaz de cada agente criar próprias ferramentas para operar e
possibilidade de eu poder ver o que está a fazer através do terminal»*.

### O que é

Cada sala tem uma **oficina**. Quando falta uma ferramenta, a oficina: escolhe a receita, escreve o
código, grava-o em disco, **prova-o contra os dados reais**, repara-o se ele se partir, e só então o
põe no catálogo — em rascunho se a ferramenta escreve, porque aí quem decide é o dono. A ferramenta
passa a correr **antes de o agente escrever** e o resultado entra no prompt como dados.

```
⌁ mlead precisa de uma ferramenta: “contar as palavras das notas do cérebro”
▸ receita escolhida: notas-contagem (contar, palavras, notas, cerebro) · segunda: notas-procura
⌸ gravada marketing/contagem-do-cerebro v1 · data/forge/tools/marketing/contagem-do-cerebro/
✓ prova 1/1 · 7 ms · {"notas":35,"palavras":1122,"ligacoes":80,…}
✦ contagem-do-cerebro v1 ACTIVA · 1/1 provas · escopos brain:read
▶ primeira execução: {"notas":35,"palavras":1122,"ligacoes":80,"maiores":[…]}
⌁ marketing: Contagem do cérebro v1 (active) · 13 ms
```

Isto é saída real, copiada de uma execução nesta máquina.

### O terminal (a segunda metade do pedido)

- **Tecla F** (ou o botão `›_` ao lado do zoom) — painel escuro sobre a cena clara, com filtros por
  sala, contadores (`activas/total · execuções · falhas · média ms`) e um prompt de comandos:
  `:ls`, `:forge <sala> <necessidade>`, `:run`, `:adopt`, `:activate`, `:eventos`, `:help`.
- **`node tools/forge.mjs watch`** — o mesmo fluxo na linha de comandos, com cores; `ls`, `forge`,
  `run`, `adopt`, `activate`, `log`.
- **`GET /api/forge/stream`** é SSE; o histórico fica em `data/forge/log.ndjson`.
- **Sem encenação**: cada linha do terminal nasceu de um evento emitido pelo servidor depois de uma
  execução. Um terminal que caia não derruba a oficina (os subscritores são isolados).

### Como está construído

| peça | papel |
|---|---|
| `forge/manifest.mjs` | o portão: valida o manifesto e recusa código perigoso (diz a linha) |
| `forge/primitives.mjs` | as únicas funções que uma ferramenta tem — atrás de escopos |
| `forge/sandbox.mjs` | contexto `vm`, ponte só de texto, prazo de 400 ms, tecto de saída |
| `forge/compose.mjs` | 7 receitas, escolhedor com «porquê», duas regras de reparação |
| `forge/registry.mjs` | gravação atómica, versões, histórico, uso, adopção com proveniência |
| `forge/bus.mjs` | eventos → SSE + `log.ndjson` |
| `src/forge.js` · `tools/forge.mjs` | o terminal no browser e na linha de comandos |

### Segurança, dita sem marketing

Três vedações: **o portão** (recusa `require`, `import`, `process`, `eval`, `Function`,
`constructor`, `prototype`, rede, temporizadores, ciclos infinitos — com a linha), **o contexto**
(reino próprio, geração de código desligada, primitivas devolvem JSON em texto para que os dados não
tragam protótipos do anfitrião) e **o prazo** (400 ms por execução, cortados à força). O que isto não
é: um sandbox de segurança a sério — está escrito no `FORGE.md`, com o comando `--permission` do Node
para quem quiser mais. As ferramentas que escrevem nascem em **rascunho** e as provas correm em
**ensaio** (`dry: true`): provar nunca suja o cérebro.

### Integração com os agentes

- O prompt de cada tarefa ganhou a lista das ferramentas da sala e a instrução `FORGE: <o que falta>`.
- O servidor lê essa linha do resultado e **forja-a** (uma por tarefa), dizendo-o no fim do trabalho.
- `sense()` corre as ferramentas-sensor antes de o agente escrever e entrega os dados no prompt.
- `adopt` leva uma ferramenta a outra sala com proveniência e volta a prová-la **com os dados da
  sala de destino**.

### Provas

`test:forge` **29/29** (novo): o portão recusa seis formas de escapar e exige provas que olhem para
`result`; dentro do sandbox `process`/`require`/`fetch` não existem; um ciclo infinito é cortado em
menos de 3 s; o tecto de saída recusa em vez de corromper; sem escopo a primitiva recusa; a escrita
em ensaio não toca no disco; o compositor escolhe a receita certa e mais nenhuma; a reparação só
actua em falhas que reconhece; uma ferramenta partida fica `broken`; a adopção guarda a proveniência;
os eventos chegam por ordem ao terminal e ao `log.ndjson`.
`test:scene` ganhou o painel: existe no bundle, começa fechado, abre e fecha, tem 7 abas — e não
rebenta sem servidor nem `EventSource` (o caso de abrir o ficheiro com duplo clique).
Restantes: `test:office` 51/51 · `test:a11y` 21/21 · `test:ops` 71/71 · build 1 429 kB.

### Limites, ditos

Sem motor de IA ligado, quem escolhe é o compositor (7 receitas determinísticas) — com motor, o
mesmo portão aceita código escrito pelo modelo. A ponte MCP (expor as ferramentas ao `claude -p`) é o
passo seguinte; hoje as ferramentas correm no servidor, antes de o agente escrever.

## 1.10.4 — 27 out 2026 · A mesa no fim da sala (as salas de sete)

Pedido: *«nas salas com 7 agentes a mesa no fim da sala ficou com uma apresentação feia, melhore isso
de forma inteligente, colocando em outra posição ou aumenta a dimensão da sala»*.

A causa não era o adereço: era a **conta do lugar das secretárias**.

```
antes (main.js):  gz = (fila − 1) × 6,4 − 1        ← um número que não sabia o tamanho da sala
agora (data.js):  gz = −d/2 + 3,9 + fila × 6,4     ← as filas encostam à parede de fundo
```

Com três filas, os dois números coincidiam por sorte. Nas salas de **quatro filas** (marketing e
delivery têm sete agentes; sales e ops usam a linha 3) a última fila ia até `z = 11,8` — com a
cadeira até 13,5 — e o salão do adereço, que vive na faixa da frente, ficava **debaixo das
secretárias**: a mesa do salão entre dois postos. Vaia-se no render (`docs/salas-7agentes-antes.png`).

**A correção, em três peças:**

1. **A conta muda de sítio e de regra.** `stationSpot(dept, grid)` e `deskFront(dept)` passam a viver
   em `src/data.js`, com a grelha declarada (`SEAT_GRID`: 2 colunas de 8,6, filas de 6,4, parede de
   fundo a 3,9 da primeira fila, 2,6 de profundidade por fila, **6,0 m de faixa de entrada** que
   nenhuma fila pode comer). A cena e o `tools/room.mjs` chamam a **mesma função** — não há duas
   versões da planta do escritório.
2. **As salas de quatro filas ficam mais fundas**: sales, ops, delivery e marketing passam de
   `d = 30` para **`d = 34`**. As de três (emails, fin, d = 26) ficam como estavam. Resultado medido:
   a faixa da frente é agora de **6,7 m** (emails, fin) e **8,3 m** (as outras quatro) — antes eram
   0,6 m nas de sete.
3. **O adereço ancora-se às secretárias, não a um número**: `makeRoomDressing(..., { front })`
   recebe o `deskFront` da sala e põe o tapete 1,2 m depois da última cadeira, sempre dentro do pod.
   O mesmo `front` passa a governar a árvore, os candeeiros e o candeeiro de braço.

**Provas.** `officeProblems()` ganhou três invariantes novas (nenhuma secretária sai pela parede
lateral, nenhuma atravessa a parede de fundo, nenhuma encosta ao bordo da frente) e a invariante da
**faixa de entrada ≥ 6 m**. `test:office` passou de 49 para **51/51** com dois testes novos (a
primeira fila encosta à parede de fundo; a mesma fila recua ~4 m entre a sala de 26 e a de 34 e as
colunas continuam simétricas). `test:scene` trocou a constante `ADEREÇO_MAX = 8,4` — que era
exactamente o que **escondia** o problema — pelo `deskFront` que a cena mede, e ganhou a prova de que
o tapete fica depois das secretárias e de que sobra entrada em todas as salas. **Visto a falhar**
duas vezes: a primeira com o tapete a rasar as secretárias em `emails`/`fin`, a segunda ao empurrar
a grelha 1,1 m à frente (`wallGap` 3,9 → 5,0), que fez cair a invariante da entrada em três sítios.

Renders: `docs/salas-7agentes-antes.png` → `docs/salas-7agentes-depois.png` (a mesma sala MEDIA,
com os sete agentes). Restantes: `test:a11y` 21/21, `test:ops` 71/71, `test:google` 5/5,
`test:integracoes` 13/13, build **1 418 kB**.

## 1.10.3 — 27 out 2026 · As salas, «chique chique»

Pedido: *«quero que melhores brutalmente as salas, deixando mais bonita e elegante, chique chique»*.
O alvo são as **seis salas** — não a interface. O que estava lá era uma caixa branca com uma faixa
de vidro fina e uma laje de vidro colorido: lia-se como maquete de cartão.

O que mudou, por camadas:

- **O remate das paredes.** A parede passou a ter o que uma parede de hotel tem: **ripaado vertical**
  a cada 0,92 (sombras reais, de graça em 3D), **rodapé de latão** de 0,20 em vez da faixa alta de
  tinta, uma **cova de luz** na cor da sala (`base − 0,26`, emissiva) debaixo do remate, **montantes
  de latão** no vidro e um **remate de latão à cabeça do vidro** — a linha que faz a parede ler como
  pavilhão e não como aquário. A banda de vidro desceu de 2,6 para **1,9** (a parede total fica em
  4,7 e não em 5,4: mais íntima, e sobra mais céu na câmara).
- **O chão.** Um **vinco de sombra** a todo o perímetro da laje (`#26272B`, 0,045) separa o vidro do
  volume branco do pod, e um **filé de latão** de 0,035 corre pela aresta — o remate que faltava
  entre o chão colorido e o branco.
- **O adereço da sala** (`makeRoomDressing`): a faixa da frente das salas — a mais visível de todas
  e até agora vazia — passa a ser uma **entrada de hotel**: tapete do salão (8,0 × 3,4) de campo
  escuro com moldura de marfim e filete de latão, **soleira de latão** do lado de fora, **duas
  poltronas de marfim** com pés de latão e almofada de carvão, **mesa redonda de latão** com uma
  taça, **dois candeeiros de pé** de 1,90 nos corredores, **candeeiro de braço** de 2,46 com cúpula
  acesa sobre a mesa (é a peça que se vê por cima das secretárias), **aparadora** de latão no
  corredor esquerdo com livros e jarro, e uma **árvore** no canto que a câmara vê.
- **Sinalética.** A placa da sala deixou de ser branca sobre branco: latão `#8A6F45`, recuada, a 2,36.
- **Modo escuro.** Os part novos (`wallTrim`, `wallCap`, `wallGlass`, `wallCove`, `wallSign`,
  `floorInlay`, `dress`, `dressRug`, `dressIvory`, `dressMetal`, `dressGlow`) entram no `setDark`:
  o latão no escuro não fica cinzento, fica **latão velho**; a cova e a cúpula sobem de emissão.

**A regra de motor que isto obrigou**: a primeira versão das paredes somava ~60 malhas por sala
(uma por ripa, uma por montante). Agora as peças são **fundidas por material** — a parede são cinco
malhas (`wall`, `wallTrim`, `wallGlass`, `wallCap`, `wallCove`) e o adereço são cinco. Seis salas
custam 60 draw calls no total, não 360.

**Como foi visto sem browser.** Chromium não corre neste ambiente, por isso o julgamento foi feito
com um rasterizador próprio (`tools/raster.mjs`, agora com **alfa** — sem ele o vidro pintava a laje
de branco) e uma câmara **ortográfica igual à da app** (`tools/room.mjs`, ISO `(1,.92,1)`, FR 42).
Para os builders com textura de canvas correrem em node, `tools/domstub.mjs` dá-lhes um canvas falso.

Provas: `test:scene` ✓ com **doze asserções novas por sala** (o adereço existe nas seis, o tapete tem
a medida do salão e **não entra por baixo das secretárias**, não sai do pod, os dois candeeiros
existem, aparadora, árvore e a luz do salão por cima das mesas) — e uma delas foi **vista a falhar**
(o tapete a rasar as secretárias em `emails` e `fin`, onde a sala tem 26 de fundo em vez de 30) antes
de o cálculo da faixa da frente ser corrigido. `test:office` 49/49, `test:a11y` 21/21, `test:ops`
71/71, `test:google` 5/5, `test:integracoes` 13/13, build **1 417 kB**.

Renders do processo (raster, não browser): `/tmp/room-p4.png` … `/tmp/room-p15.png`.

## 1.10.2 — 27 out 2026 · O canto esquerdo: a licença

Pedido: *«licença ORBITA PROJECT 1.0.0 — coloca mesmo de forma bem inteligente, POR CHELTON MAHOZE
no canto esquerdo»*.

O que estava lá era uma **linha de 130 caracteres ao centro do fundo**, branca em
`mix-blend-mode: difference`, a atravessar o escritório: não se lia, e ficava por cima da cena como
uma legenda de televisão. No mesmo canto já vivia uma pastilha de assinatura, cada uma com as suas
coordenadas absolutas.

Agora o canto é **um sítio só** — `#corner`, um *flex* de duas peças — e a licença é uma **placa de
três linhas com hierarquia**:

```
licença · PolyForm Noncommercial        ← o que é (7,5 px, versaletes, cinza)
ÓRBITA PROJECT  1.0.0                   ← de quem é (serifa de marca, 15 px) + selo da versão
por CHELTON MAHOZE                      ← quem o fez (8 px, versaletes, o nome em tinta)
```

- **A frase legal inteira não se perdeu**: mudou de sítio — vive no `aria-label` (licença, versão,
  uso pessoal e interno, não para revenda, © 2026 Chelton Mahoze), onde um leitor de ecrã a lê toda.
- **Uma superfície em vez de um truque**: creme a 82% + `backdrop-filter` + fio de 1 px, como os
  outros elementos flutuantes. Sai o `mix-blend-mode: difference` (a placa lê-se igual sobre chão
  claro, escuro, e no modo escuro da interface, onde o creme já é tinta escura).
- **A assinatura** (`chelton_`, a pastilha preta que abre o repositório) passou a ser a segunda peça
  do mesmo *flex*: sem `left/bottom` próprios, alinhada pela base com a placa.
- **Sem colisões**: com a gaveta da sala aberta à esquerda, o canto inteiro passa para o lado dela
  (`body.railLeft`); no calendário e no cérebro a assinatura sai (têm cabeçalho próprio) e o rodapé
  desses painéis sobe para não ficar debaixo da placa; abaixo de 760 px o rótulo da licença recolhe.
- **A cena continua a receber o rato**: só a assinatura tem `pointer-events: auto`.

A versão `1.0.0` da placa é o rótulo do projecto (o que o dono pediu) — a versão de construção
continua a ser a do `package.json` e a que `/api/health` devolve (1.10.2).

Provas: `test:scene` ✓ com 12 asserções novas (o canto é um elemento, a placa tem três linhas, diz
«ÓRBITA PROJECT 1.0.0» e «POR CHELTON MAHOZE», o aria-label guarda a PolyForm inteira, a frase
antiga não voltou, a assinatura abre o repositório) — uma delas foi **vista a falhar** ao trocar
`1.0.0` por `9.9.9`. `test:office` 49/49, `test:a11y` 21/21, build 1 410 kB.

## 1.10.1 — 27 out 2026 · A barra do compositor de tarefas

Pedido: *«o chat deve ter um design bonito nesta área»* — apontando para a caixa de tarefas da
direita (`MEDIA · Escreve uma tarefa… · SONNET · AUTOMÁTICO · REPETIR · EQUIPA · SEM IA · ADICIONAR`).

A segunda linha eram seis pastilhas de 8,5 px, todas iguais: o modelo, o esforço, dois
interruptores, o motor e a acção. Lia-se como uma legenda e não dizia o que era o quê.

- **Dois campos com rótulo** — `Modelo` e `Esforço`, o valor em 12,5 px em vez de maiúsculas de
  8,5 px, com um caret próprio e uma marca verde no rótulo quando a escolha é tua (`.tp-fld`,
  `.tp-sel`, `:has(select.set)`).
- **Um grupo segmentado** para os interruptores (`.tp-tools`): uma moldura só, divisórias de 1 px,
  o activo em tinta, `aria-pressed` a acompanhar o `.on` (que antes só existia na cor).
- **Uma nota** que diz o que a tarefa usa por omissão, lida do servidor: `padrão: Sonnet · Automático`.
- **O ADICIONAR é a única coisa sólida** da caixa, à direita, com o `↵` ao lado.
- **O esforço em português**: `Automático · Baixo · Médio · Alto · Muito alto · Máximo` (as chaves
  `low … max` no pedido não mudaram). O tooltip já dizia «Baixo a Máximo» enquanto o menu mostrava
  `LOW … X-HIGH` — duas línguas no mesmo sítio. O mesmo se fez no conversador (`EFFORT_LABEL`).
- Os modelos deixaram de ser gritados: `Sonnet · Opus · Fable`.

Provas: `test:office` 49/49 (rótulos fixados), `test:scene` ✓ (estrutura nova no bundle: dois campos
com rótulo, três botões no grupo, opções em português, a nota com `padrão:`), build 1 407 kB.

## 1.10.0 — 27 out 2026 · As pessoas

Pedido 28: *«melhorar as interações do braço de avatar mexendo realmente o mouse e digitando nos
teclados e melhore o avatar, uma vibe mais pessoa real com roupa formal, mas cada sala mantém a
coloração da roupa ficando mais realista, cabelo diferente para cada agente (35), alguns com
chapéu, alguns serão mulheres»*.

O problema não era a animação — era a geometria. As mãos nunca tocavam em nada porque **ninguém
sabia onde estava o teclado**: o `builders.js` desenhava-o a `z=0.42`, o avatar esticava o braço
para o sítio nenhum e o ombro oscilava 6 cm para fingir trabalho. Resolveu-se com um contrato.

### O contrato: `src/deskmap.js`

Um ficheiro puro (sem `three`, sem DOM) onde vivem os números da secretária: `SEAT`, `KEYBOARD`,
`KEY_GRID` (57 teclas), `MOUSE_PAD`, `MOUSE`, `MOUSE_TRAVEL` e, por cima, funções que respondem a
perguntas: `mouseAt(t)`, `nearestKey(x, z)`, `typingHand(t)`, `clickBeat(t)`, `contact(t)`.
Quem desenha (`builders.js`), quem posa (`avatar.js`) e quem anima (`main.js`) leem daqui — se
alguém mudar o teclado de sítio, a mão vai atrás. É por isso que passou a haver um teste que
compara **a ponta do dedo com a tecla**: antes, o IK resolvia para um braço de `0.60+0.55` enquanto
a geometria media `0.54+0.50`, e a mão parava 8 cm antes do alvo.

### O que se vê agora

- **A digitar** — a mão segue uma tecla do `KEY_GRID`, a tecla **afunda** (instância própria, uma
  malha para as 57) e volta. As duas mãos escrevem; a cada ~5 s uma delas vai ao rato.
- **No rato** — o rato é uma malha própria (`mouseG`) e desliza no tapete; **vai onde a mão está**,
  não ao contrário. A palma segue-o com o pulso e o cotovelo resolvidos por IK de dois ossos.
- **A transição** — a mão não salta do teclado para o rato: atravessa a mesa em ~0.3 s e não prime
  teclas a caminho.

### As 35 pessoas

`src/looks.js` é uma tabela escrita à mão (não sorteada): 35 assinaturas distintas — 15 estilos de
cabelo × 4 variantes, 14 mulheres, 8 chapéus (fedora, boné, barrete, gorro), 11 barbas, 7 óculos.

- **Fato formal** — casaco com lapelas, camisa, gravata (ou lenço, ou blazer, ou vestido para
  algumas mulheres), sapatos, cinto, punhos. O **fato é a cor da sala** (matiz do `chip`, mais
  fundo e levemente dessaturado); a **gravata acende com o vidro**. A sala continua a ler-se pela
  cor, mas agora veste-se em vez de pintar-se.
- **Cara** — olhos, sobrolhos, nariz, lábios, brincos, óculos com aro e ponte, barbas por tipo.
- **Pescoço e ombros** — pescoço próprio, cabeça a `1.86S` e ombros a `1.42S` (estavam à altura da
  cintura, o que fazia os braços saírem do cinto). O tronco passou a afunilar (ombros > cintura) e
  acabou na anca: o casaco ia até aos tornozelos e lia-se como uma saia.

### Achado pelo caminho

`geometry.scale()` escala em torno da **origem**, não do centro: o rato estava 1 m abaixo do tapete
(desenhado, invisível). E o `GEO.box()` do `builders.js` cresce a partir da base, não do centro —
daí o tampo ter passado a estar 11 cm abaixo do teclado durante uma tarde.

### Custo

35 avatares com ~10 malhas cada (a cabeça inteira é uma malha, o tronco outra, cada mão outra), e
**uma** malha instanciada por teclado para as 57 teclas. Build: 1 403 kB.

## 1.9.9 — 27 out 2026 · O conversador

Pedido 27: *«implementa este conversador de IA, substituindo o atual»*, com um componente React
(`ai-prompt-composer-with-model-selector.tsx`) e as instruções de integração shadcn.

O que existia era um campo de uma linha e uma seta. O que o dono mandou é um compositor: modos,
modelo com provedor e esforço, anexos, contexto, voz, favoritos, aviso e tour. **Foi esse desenho
que substituiu o antigo** — e cada peça faz alguma coisa no servidor, ou está desligada a dizer
porquê.

### A decisão: portar, não colar

O projecto não tem React, Tailwind, TypeScript, `tsconfig`, `tailwind.config` nem `components.json`
— e, de propósito, o Órbita é **um ficheiro HTML** que abre offline, construído por esbuild a partir
de módulos JS. Instalar React + Tailwind para um componente punha um runtime de ~140 kB entre o dono
e uma caixa de texto e acabava com o «um ficheiro só». O desenho e o comportamento foram **portados**
para `src/composer.js` (557 linhas, zero dependências): mesmos elementos, mesmas regras, mesma calma.
O detalhe (e o que fazer se algum dia o projecto passar a React) está em **[docs/CONVERSA.md](docs/CONVERSA.md)**.

### O que o cartão tem

- **Modos** — `Planear` (o servidor desliga as ferramentas e pede um plano), `Perguntar` (a conversa
  com as notas da empresa) e `Construir` (**cria mesmo a tarefa** em `/api/tasks` com `run: true`, começa a corrê-la na fila do servidor e diz o id).
- **Modelo e esforço** — a lista vem de `/api/health` (`sonnet · opus · fable`, `low … max`), com
  separadores **Favoritos/Todos**, estrela, pílula de provedor e `Auto` (a precedência da casa).
  Escolher um modelo ou esforço envia-o naquela mensagem; o servidor devolve o que usou.
- **+ Ficheiros** — texto até 5 ficheiros, 40 000 caracteres cada, 60 000 no total, só naquela
  mensagem. Imagens e PDF dizem que não são lidos.
- **@ Contexto** — `@Cérebro` e `@Documentos` reais (com os números que o servidor declara);
  `@Terminal` **desactivado com a razão**, porque não há terminal ligado ao agente.
- **Ditar** — a `SpeechRecognition` do browser quando existe; desactivado com a razão quando não.
- **Aviso do motor** (o lugar do «Upgrade to Pro») — o Órbita não vende planos, por isso não há
  preço: no mesmo sítio aparece o estado real (motor, modelo, esforço, notas, documentos) quando
  falta motor, e desaparece quando há.
- **Tour** de quatro passos, dispensável, e **avisos** com `aria-live`.

### O que se recusou copiar

- **«Upgrade to Pro» com planos e preços** — não há faturação no Órbita; um preço inventado seria
  dado de demonstração (pedido 19). O lugar do banner ficou com o aviso do motor.
- **A lista de modelos de exemplo** (`kimi-k3`, `gpt-56-terra`, `sonnet-5`, `opus-48`…) — a lista é
  a que o servidor sabe correr. Sem motor, o botão diz «sem motor».
- **O `@terminal`** — não existe, e fingir que existe era mentir no sítio onde se pede contexto.

### O que mudou no servidor

`POST /api/chat` passou a aceitar `mode`, `model`, `effort`, `auto`, `files` e `context`, e a
responder com `mode`, `model`, `modelName`, `modelFrom`, `effort`, `effortName`, `context` e
`files`. `GET /api/health` passou a declarar o tamanho do contexto (`context.notes`, `context.docs`).
Em modo `Planear` não há rotinas nem entrevistas: o pedido só devolve um plano, sem ferramentas. `POST /api/tasks` aceita `run: true`: a tarefa nasce em `doing` e entra na fila do servidor no mesmo instante (era só `next`, à espera de um RUN à mão).

### Provas

- **`test:office` — 38/38** (eram 31). Sete testes novos: os três modos e o que cada um promete, os
  anexos (limites e recusas), o `@contexto` com o terminal desactivado, o corpo do pedido (Auto cala
  o modelo; lixo cai em `ask`; história limitada a 8), a linha do que correu, e as preferências
  guardadas (incluindo lixo no `localStorage`).
- **`test:scene` — ✓** com 24 asserções novas no bundle real: os três modos trocam com
  `aria-pressed`, o menu do modelo abre e fecha com `aria-expanded`, o seletor de ficheiros, o menu
  de contexto com a linha do terminal desactivada **e a razão escrita**, o aviso do motor visível
  quando o servidor não responde (o harness responde 503) e o `#mcModal` **fora do `#rail`** (a
  gaveta tem `overflow:hidden` e `transform`; um `fixed` lá dentro ficava cortado). *O teste tem
  dentes:* mudei o id do menu de contexto e ele caiu na hora.
- **Contra um motor de teste local** (um servidor OpenAI-compatible de 40 linhas, sem tocar no
  repositório): `mode: "plan"` chegou ao motor com a regra de planear, `tools: false` e
  `max_tokens: 900`; `files` levou o conteúdo do `brief.md`; `context: ["brain","docs"]` levou as
  notas escolhidas e `docs/CENA.md`; e `auto:false, model:"opus", effort:"max"` foi corrido com o
  modelo que o fornecedor declara para `opus`.
- `test:a11y` **21/21** · `ops` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só
  `smoke: browser`, que precisa de Chrome) · build **1380 KB** + `mesa.html` 86 KB.
- **Vi o cartão antes de o entregar:** `docs/conversor-claro.png`, `docs/conversor-escuro.png` e
  `docs/conversor-modelo.png` são capturas do CSS real, com o Chromium headless — foi assim que
  corrigi a pílula do modelo a cortar «Sonnet» em «S…» e o menu a crescer para fora do ecrã.

### Limitações, declaradas

- **O esforço só existe nos motores CLI.** Nas APIs compatíveis com OpenAI o protocolo não tem
  esse campo: vai o modelo, não vai o esforço — e o menu diz isso quando o motor é desse tipo.
- **Numa API, os três nomes da casa podem responder com o mesmo modelo**, se o fornecedor não
  declarar um por nome.
- **Anexos são texto.** PDF, DOCX e imagens não são extraídos; 60 kB é o tecto por mensagem.
- **`@Documentos` lê o título e as primeiras linhas** de cada markdown (até 6 000 caracteres).
- **Sem motor ligado, a conversa não inventa:** responde com a razão da falha. Nesta máquina não há
  `claude`, `codex` nem `gemini` no `PATH`, por isso o aviso do compositor é o estado normal aqui.
- **A cena 3D continua sem captura neste sandbox** (SwiftShader sem bibliotecas de sistema); as
  imagens do conversador são DOM puro, por isso são reais.

## 1.9.8 — 26 out 2026 · A secretária: preta, com a luz da sala

Pedido 26: *«melhorias nível Apple design 3D mais moderna e elegante, com LEDs Aukora combinando com a cor da sala, uma vibe de mesa moderna preta com LED, e acessórios gamers, muito bonito e chamativo»*.

O que havia era um tampo de madeira clara, dois armários brancos, um teclado branco e uma caneca — mobiliário de escritório de 2014. Não faltava material: faltava desenho. E faltava a coisa que faz uma mesa com LED parecer **desta sala** e não de uma loja: a cor.

### A mesa

- **Preta, e não cinzenta.** Tampo e corpo em `#1C1E23` acetinado (metalness 0.28), pernas em lâmina de grafite com sapata de metal, calha de cabos e travessa. Saiu a madeira; saíram os armários brancos.
- **Sete luzes, uma cor.** Fita LED sob a aresta da frente e nas laterais, LED nas pernas, halo atrás do monitor, **barra de luz Aukora** presa no cimo do ecrã, teclado retroiluminado, contorno do tapete do rato, anéis das colunas, **três ventoinhas da torre** e a costura da cadeira — **todas em `dept.glass`**, a mesma cor do vidro do chão. Uma sala, uma cor. É o que faz o conjunto ler como um sistema.
- **Acessórios gamers:** monitor com moldura preta, suporte e barra de luz; teclado mecânico; rato sobre tapete iluminado; duas colunas com anel de luz; auricular pendurado num suporte em arco; caneca; torre com vidro lateral e ventoinhas acesas. E, **de posto para posto, a mesa muda**: comando de jogos, telemóvel em suporte ou mini barra Aukora — três variantes decididas por semente, para a sala parecer vivida e não clonada.
- **A cadeira** acompanha: preta, em concha, com a costura do encosto e do assento na cor da sala, coluna a gás, estrela de cinco braços com rodas.

### Como o brilho é feito (e porque não há bloom)

O polimento de 1.9.1 continua **revertido**, como o dono pediu: sem PMREM, sem tone mapping, sem pós-processamento. O brilho não vem de um *bloom* — vem de **material emissivo** (o LED em si) mais **quês aditivos** (`glowDisc`: geometria com alfa por vértice e gradiente de queda, `depthWrite: false`). É o truque de sempre dos jogos, é determinístico, existe sem browser (por isso é testável) e não mexe no pipeline de render.

### Correções que isto obrigou

- **`mergeGeos` só sabia juntar cor RGB.** Os halos precisam de **alfa por vértice** (quatro componentes) e o three só o respeita assim. A função passou a juntar na largura máxima (3 ou 4) e a preencher com 1 o que falta. Sem isto, o halo ficava opaco.
- **O `dimTwin` (escurecer a sala que não está em foco) só apagava a cor.** Resultado: a sala apagava-se e o LED ficava aceso, a brilhar no escuro. Passou a **escurecer a emissão** também (para 22 %).
- **No modo escuro, uma mesa preta sobre fundo escuro desaparecia.** O corpo sobe para grafite (`#2E3138`), o mate para `#23252A` e o LED ganha 45 % de intensidade — é assim que uma secretária com luz se comporta à noite.
- **A textura da tela exigia `document`.** Em Node (testes) rebentava; agora devolve uma tela vazia e o monitor desenha-se na mesma, com um fundo escuro.

### Provas

- **`test:office` — 31/31** (eram 25). Seis testes novos sobre a secretária: a tela e a moldura que o `main.js` espera, o LED na cor da sala em três salas diferentes, o corpo preto e metálico, o halo aditivo sem escrita de profundidade, as três variantes determinísticas e o limite de malhas por posto.
- **`test:scene` — ✓ 35 postos** … e agora **posto a posto**: cada uma das 35 secretárias tem de ter a malha do LED com a cor emissiva **exacta** do vidro daquela sala, corpo escuro, halo, e a costura da cadeira na mesma cor. *O teste tem dentes:* troquei a cor por magenta à força e ele apontou as 35 (`✗ 35 falhas · elead: o LED da secretária é #ff00ff e a sala é #1FA36B`); reposto, ✓.
- **Vi a mesa antes de a entregar**, com o mesmo rasterizador da 1.9.6: foi ele que mostrou que o halo do monitor parecia uma lua, que a luz da barra caía por cima do teclado, e que a torre era um bloco preto sem forma. Três correções saíram daí; os retratos ficam em `docs/secretarias-3-variantes.png` e `docs/secretaria-detalhe.png`.
- **Custo:** cada secretária ficou em **≤ 12 malhas** (eram 8 peças soltas + 5 da cadeira antes, agora tudo fundido por material: corpo, aresta, mate, metal, LED, acento, vidro, halo, tela, moldura, teclado, tapete). Mais detalhe, menos draw calls.
- `test:a11y` **21/21** · `ops.test` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só `smoke: browser`) · build **1341 KB** + `mesa.html` 86 KB.

### Limitações, declaradas

- **A tela do monitor aparece preta nos retratos.** É fiel ao que o meu rasterizador sabe desenhar: o conteúdo do ecrã é uma textura em canvas, desenhada no browser em tempo real pelo painel AO VIVO. Na cena servida, o ecrã tem conteúdo.
- **A cena 3D continua sem captura neste sandbox** (o WebGL não arranca: faltam bibliotecas de sistema ao Chromium). Os retratos são de luz de estudo e provam a forma e a cor — não julgam a luz final da cena. Essa parte é o olho do dono.

## 1.9.7 — 26 out 2026 · «ÓRBITA AGENTES», e a conversa

Pedido 25: *«remove o BETA e coloca ÓRBITA AGENTES; o lugar onde se escrevem as mensagens deve ficar ainda mais elegante, inspira-te no ChatGPT, com mais vibe Apple design»*.

### A marca

- **Saiu o «BETA», entrou «ÓRBITA AGENTES».** A etiqueta da barra lia-se «V1» e, quando o escritório ficava ao vivo, o JavaScript **reescrevia-a para «BETA»** — o produto mudava de nome conforme o servidor acordasse. Agora é «ÓRBITA AGENTES», uma palavra só, e **fica quieta**: a linha que a trocava passou a mudar apenas o título da página.
- **O título também.** `Órbita — escritório de agentes` → **`Órbita Agentes — escritório de agentes`**.

### A conversa (o sítio onde se escrevem as mensagens)

Referência declarada: o ChatGPT. O que se copia é a **calma**; o que é nosso é a tipografia SF, o vidro e as cores da casa.

- **O compositor deixou de ser uma caixa de uma linha.** Era um `<input>` com um botão «ENVIAR» ao lado — a versão mais barata possível de uma conversa. Agora é um **campo que cresce com o texto** (até 132 px, depois rola), com a seta de enviar num círculo escuro do lado direito e a **tecla Enter a enviar** (Shift + Enter muda de linha, como no ChatGPT). Com o campo vazio a seta está apagada e não responde: o botão diz a verdade sobre o que pode fazer.
- **As sugestões subiram para cima do compositor** e passaram a pílulas de vidro em SF — antes eram sete botões de contorno que pareciam formulário.
- **Uma linha de ajuda discreta** por baixo (`Enter envia · Shift + Enter nova linha`). Quem não sabe, aprende; quem sabe, não repara.
- **As mensagens.** A resposta do agente é um cartão claro com um canto mais apertado do lado de quem fala; a fala do dono passou de **bloco preto** a **cinza baço** (numa coluna de 400 px, três blocos pretos seguidos pesam mais do que informam) — o escuro fica para o modo escuro. Entram uma animação de 0,3 s na chegada de cada mensagem, um desvanecimento no topo da lista (o texto desaparece, não é cortado a direito) e uma barra de deslocamento fina.
- **Os indicadores de trabalho** («Helena Prado está a pensar») deixaram de ser monospace cinzento e passaram a uma linha pequena com um ponto a pulsar.
- **Os separadores «AO VIVO / CONVERSA»** passam a **«Ao vivo / Conversa»** num *segmented control* (a mesma leitura do menu da 1.9.3). Isto apanhou uma incoerência minha: na 1.9.5 escrevi nos testes «o texto é PT-PT e conta o que está lá» e deixei dois rótulos em maiúsculas de 10 px com `letter-spacing: .14em` — exactamente o que a 1.9.3 tinha vindo corrigir no menu.
- **A saudação de abertura** já não diz «pede trabalho na barra à direita» (uma barra que já não existe há versões) — diz o que se faz: escrever aqui em baixo.
- **Acessibilidade a acompanhar:** o campo tem `<label>` próprio (`.sr-only`), a seta tem `aria-label` e `title`, e o `textarea` continua a travar os atalhos da cena enquanto se escreve.

### Provas — e, desta vez, olhos

- **Vi o resultado.** Até aqui todas as entregas diziam «não há Chrome nesta máquina». Hoje há: instalei um Chromium headless (`@sparticuz/chromium`, sem tocar no `package.json`) e o `playwright-core` que já estava no projecto, e **abri a página a 1× e 2×**. O WebGL não corre neste sandbox (SwiftShader sem bibliotecas de sistema), por isso a captura da cena falha — mas a **conversa é DOM puro** e pôde ser fotografada com o CSS real: `docs/conversa-clara.png` e `docs/conversa-escura.png`.
- **O que as capturas mostraram** (e que os testes não mostrariam): o campo crescia mas o botão ficava colado ao fundo; o separador antigo cortava a lista com uma linha; e, à segunda volta, a linha de ajuda caía por baixo da marca do canto. Dois dos três foram corrigidos por olho.
- **`test:scene` — ✓ 35 postos** … e agora com **a marca e o compositor**: exige que a barra leia «ÓRBITA AGENTES» (e falha se voltar a dizer «BETA»), que o campo seja `<textarea>`, que a seta comece apagada e acorde ao escrever, que Enter seja tratado pelo compositor e que **Shift + Enter não** seja apanhado.
- `test:office` **25/25** · `test:a11y` **21/21** · `ops.test` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só `smoke: browser`) · build **1333 KB** + `mesa.html` 86 KB.

### Limitações, declaradas

- **A cena 3D continua sem captura**: neste sandbox o WebGL não arranca (falta o conjunto de bibliotecas de sistema do Chromium; só consegui as do NSS). O que ficou provado com olhos é a interface em HTML — a conversa, a barra, os separadores. A cena continua a ser provada pelos testes.
- **As capturas são de uma folha de contacto** (o `shell.html` real com uma conversa de exemplo e sem a cena por trás), não do escritório ao vivo: o objectivo era julgar o desenho da conversa, e a cena não muda nada nele.

## 1.9.6 — 26 out 2026 · As plantas: forma em vez de esferas

Pedido 24: *«dá melhorias nível Apple design 3D nas plantas, dando total realismo nelas»*.

O que havia era um vaso de tronco-de-cone com **cinco esferas verdes** — e era a peça que mais denunciava a cena, ao lado de pessoas com pescoço e ombros. Não faltava material: faltava forma. Uma esfera iluminada por muito boa luz continua a ser uma esfera.

### A folha

- **Uma superfície, não um sólido.** `leafGeometry()` gera uma grelha paramétrica: estreita na base, larga a um terço, em bico no fim. **Dobrada ao meio** — o nervo central é uma aresta, não uma linha pintada — com o bordo ondulado e uma **queda que cresce com o quadrado do comprimento**: é assim que uma folha real pendura quando o pecíolo a larga.
- **A cor varia onde a luz varia.** Cada vértice leva a sua cor: escura na base e na nervura, clara a meio do limbo, e cada folha com o seu desvio de matiz (`warm`). O material é `vertexColors`, com uma textura de nervuras muito discreta por cima. Uma folha pintada de uma cor só parece plástico, mesmo com a melhor luz do mundo.
- **O pecíolo é um tubo.** `stemGeometry()` segue uma Catmull-Rom — sai do tronco, arqueia, entrega a folha — e afina da base para a ponta. O caule principal é o mesmo tubo, inclinado: nada na natureza é vertical.

### A planta

- **Filotaxia, não simetria.** As folhas nascem em espiral de **ângulo dourado (137,5°)**, em três andares, com alturas e comprimentos que variam (< 0,86 de expoente: mais folhas em baixo, como numa planta que cresceu) e um rolamento próprio. As velhas **pendem** (`pitchOld`), as novas **abrem** (`pitchNew`) — é o que dá silhueta em vez de volume.
- **Duas espécies.** `upright` (figueira/oliveira): tronco alto e limpo, 24 folhas pequenas, ≈ 2,5 de altura — para as salas onde há pouco espaço. `broad` (monstera/filodendron): sem tronco à vista, 15 folhas grandes em pecíolos que arqueiam, ≈ 2,1 — para as salas largas e para o centro, que passa a ser a peça de apresentação.
- **O vaso é cerâmica torneada.** `LatheGeometry` com pé, pança e **lábio virado para dentro**; terra escura abaixo do lábio e umas pedras. E, o que faltava: uma **sombra de contacto** (disco com gradiente, `depthWrite: false`, a 0,010 do chão). Sem ela, o objeto flutua por muito bom que seja o resto.
- **Tudo determinístico.** `seededRandom()` (mulberry32) por planta: a mesma semente dá sempre a mesma planta. A cena deixou de mudar a cada recarregamento — e passou a poder ser testada.
- **O lugar é medido, não escolhido a olho.** Mede-se o raio da folhagem (`Box3`), afasta-se o vaso do canto o suficiente para **nenhuma folha atravessar a parede de vidro** (folga 0,45) e mede-se a distância à cadeira mais próxima. Antes eram cinco vasos encostados ao canto «mais ou menos».
- **Duas plantas a mais.** A DESIGN LAB não tinha nenhuma; o centro passou a ter a peça de apresentação. São **sete**.

### O que não mudou

- **Nada do resto da cena.** Nem chão, nem paredes, nem secretárias, nem pessoas, nem câmara. O chão de vidro, as 35 secretárias e o espelho acessível da 1.9.5 continuam a passar os seus testes sem uma linha alterada.
- **O polimento de 1.9.1 continua revertido**, como o dono pediu: **sem** environment map, **sem** tone mapping, **sem** vernizes novos. O realismo vem de geometria e de cor — os materiais são `MeshStandardMaterial` simples e o brilho das folhas é o especular largo da luz-chave que já existia. Um realismo que dependesse de um PMREM seria o mesmo truque que foi rejeitado.
- **Custo controlado:** 5–6 malhas por planta (folhagem, caules, vaso, terra, pedras, sombra), com as folhas e os caules *merged* por geometria. Sete plantas ≈ 110 k triângulos e ~35 draw calls — não 40 por planta.

### Provas

- **`test:office` — 25/25** (eram 17): oito testes novos sobre a forma. A folha estreita na base, engorda a um terço e acaba em bico; dobra ao meio e a ponta cai; a cor varia dentro da folha (base escura, limbo claro, nervura mais escura que o limbo); o pecíolo afina; a planta monta-se em poucas malhas com cor por vértice e duas faces; as duas espécies são diferentes e cada uma tem altura e largura razoáveis; e a mesma semente dá a mesma planta.
- **`test:scene` — ✓ 35 postos, chão de vidro em 7 pods, 7 plantas (3 verticais · 4 de folha larga, 2,1–2,6 de altura)**. O teste novo exige `inside: true` em cada sala: o raio da folhagem somado ao afastamento do canto tem de caber no pod.
- **O teste tem dentes.** Repus as plantas no canto à força (`dx = dz = 9.5`) e voltei a correr: `✗ · delivery: a folhagem sai do pod (raio 1,7) · sales · marketing · fin · ops`. Depois reposto: ✓.
- **Vi a planta antes de a entregar.** Sem Chrome nesta máquina, escrevi um rasterizador mínimo (ortográfico, Lambert, z-buffer, sRGB) para olhar para as duas espécies em `node`. Foi ele que mostrou dois erros que os testes não apanhavam: folhas demasiado horizontais (a planta lia-se como um prato) e o vaso de Ø 1,10 para folhas de 0,6 — um vaso de árvore com uma planta de sala dentro. Ambos corrigidos; os retratos ficam em `docs/planta-vertical.png` e `docs/planta-folha-larga.png`.
- `ops.test` **71/71** · `integrations` **18/18** · `check.mjs` **94/95** (só `smoke: browser`, sem navegador) · build **1327 KB** + `mesa.html` 86 KB.

### Limitações, declaradas

- **Continuo sem ver a cena com a luz real.** Os retratos são de um rasterizador meu, com luz de estudo: provam a **forma**, não julgam a luz, as sombras ou o tom final. O olho do dono, na cena servida, é a última prova.
- **As folhas são planas** (uma superfície de duas faces). De perto e de lado vê-se a ausência de espessura. Fechar as folhas em sólidos custaria três a quatro vezes mais triângulos por uma diferença que se nota a 30 cm de um ecrã — não vale a pena nesta escala, e fica escrito.

## 1.9.5 — 26 out 2026 · O escritório, para quem não usa rato

Pedido 23: *«O escritório é rato-apenas — 18 handlers de clique em `div`/sprite; o `<canvas>` não tem `role`/`aria-label`; nem os 7 cartões de sala nem as 35 pastilhas entram no Tab. Um espelho acessível (as salas e os agentes navegáveis por teclado, com `Enter`) resolve sem tocar no 3D.»*

**O diagnóstico, antes de mexer.** Uma passagem de leitura pelo `main.js` e pelo `shell.html` contou o que havia: **18** `addEventListener('click')` em `div`, `canvas` e sprites; **zero** `role` e **zero** `tabIndex` criados pelo escritório (os únicos do ficheiro eram os três botões do zoom e os formulários das gavetas); um `<canvas id="scene">` **sem nome** — para um leitor de ecrã, uma caixa vazia; e a página declarada em `lang="en"` com o produto todo em português. Um utilizador de teclado podia abrir as gavetas do menu e escrever uma tarefa, mas **não conseguia entrar numa sala nem abrir um agente**.

### O espelho: `src/a11y.js` (novo, puro)

- **A mesma coisa, por palavras.** Uma lista em HTML com as **7 superfícies** (as 6 salas e o centro) e os **35 agentes**, cada um um **`<button type="button">` a sério** — não um `div` com `role="button"`. É a diferença entre imitar um botão e ser um: o `Enter`, o `Espaço`, o `Tab` e o anúncio do leitor de ecrã vêm da semântica do browser, não de código nosso que se pode esquecer.
- **Um diálogo a sério.** `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby` a apontar para o título e para o subtítulo («7 salas · 35 agentes · a mesma informação da cena, para teclado e leitores de ecrã»), ciclo de foco próprio (`Tab` no último volta ao primeiro, `Shift+Tab` no primeiro vai ao último), `Esc` fecha, e o foco **volta a quem abriu**.
- **As mesmas acções, uma só implementação.** `onRoom(k)` chama `zoomToDept(k)` (ou `brain.open()` no centro) e `onAgent(id)` chama o mesmo `openAgent(...)` do clique na pessoa — incluindo o desvio para a conversa quando o agente está preso numa aprovação. O espelho **não duplica lógica**: recebe as duas funções por parâmetro. É por isso que ele não sabe nada do escritório — nem importa o `three`.
- **`close(false)`.** Quando a acção escolhida abre o rail, quem fecha a lista **não** devolve o foco: quem trata da acção manda (o rail recebe-o no sítio certo). O foco é um só, e não salta duas vezes.

### O Tab na cena (sem tocar no 3D)

- **Os 7 cartões de sala** (`div` que já respondiam ao clique) passam a `role="button"`, `tabIndex = 0`, com `aria-label` escrito por palavras — *«Abrir a sala Comando — 5 agentes, 2 a trabalhar, 1 à espera de aprovação»* — e `Enter`/`Espaço` a chamar o `.click()` que já existia, em vez de um segundo caminho.
- **As 35 pastilhas dos agentes** são botões, mas **com uma regra**: só as da **sala em foco** ficam com `tabIndex = 0`. Sem essa regra, atravessar a cena eram **35 paragens de `Tab`** a passar por nomes que se sobrepõem no ecrã — a acessibilidade a atrapalhar quem a usa. A regra vive no `tickLOD`, que já sabe qual é a sala em foco; escreve `tabIndex` só quando muda.
- **O rótulo acompanha os números.** `updateBillboards` passou a refrescar o `aria-label` dos cartões (via `syncBadgeLabels`), para não haver um cartão a dizer «2 à espera» e um leitor de ecrã a anunciar «0». O que se ouve é o que se vê.
- **O botão de aprovação deixou de ser uma `div`.** Nos dois sítios onde existe (o cartão da sala e o cabeçalho do rail) é agora `<button type="button">` com `aria-label`: recebe foco, aceita `Enter`, e deixa de ser um clique que só existe para o rato. (Precisou de três linhas de CSS para lhe devolver o que a `div` tinha de graça: fonte herdada, largura e cursor.)
- **O estado falado é o estado real.** `agentStateOf(id)` traduz o que já vem da base de dados — `a trabalhar`, `na fila`, `à espera do teu OK`, `última tarefa concluída`, `a última tarefa falhou`, `última tarefa cancelada`, `sem tarefa registada`. **Sem ligação ao vivo**, não se afirma o presente: diz «último estado conhecido — sem ligação ao vivo». Nada disto é inventado nem decorativo; é a mesma fonte de que vivem o monitor e o chip.

### Por onde se entra

- **A tecla `L`** abre e fecha a lista (a seguir à guarda do calendário: com o calendário aberto, as teclas são dele).
- **Um botão visível ao lado do zoom** (`#zIndex`, um ícone de linhas) abre o mesmo — porque um atalho que ninguém sabe que existe não é uma porta.
- **Uma ligação «Saltar para a lista do escritório»** (`#skipIndex`) é a **primeira paragem do `Tab`**: está fora do ecrã até receber foco e aí desce como um botão escuro. Quem navega por teclado não tem de atravessar a barra toda para chegar ao conteúdo.

### O canvas fala

- `role="img"`, `aria-label` («Escritório isométrico com seis salas em volta de um cérebro central e trinta e cinco agentes») e `aria-describedby` a apontar para uma descrição longa (`#sceneHelp`, `.sr-only`) que explica o que ali está **e** como chegar ao resto. Uma imagem sem nome é, para um leitor de ecrã, uma caixa vazia — e esta é a imagem principal do produto.
- `lang="en"` → **`lang="pt"`**. Um leitor de ecrã com a voz inglesa a ler «Operação» não está a ler português.

### O que **não** mudou

**Nada do 3D.** Nem geometria, nem materiais, nem câmara, nem LOD, nem cores. O `a11y.js` não importa o `three`, não conhece `scene`, `camera` nem `renderer`, e o teste exige que continue assim (procura `three`/`Geometry`/`Material` no ficheiro e falha se aparecer). As alterações no `main.js` são de DOM: atributos, `tabIndex`, `aria-label` e dois `keydown`. O `test:scene` continua a provar os **35 postos** e as **quatro camadas do chão de vidro em 7 pods** — se o espelho tivesse mexido na cena, esse teste caía.

### Provas

- **`npm run test:a11y` — 21/21 (novo).** Executa o módulo em `jsdom`: 7 salas, 35 `<button>`, ordem de tabulação (fechar → salas → agentes, agrupados por sala), abrir/fechar/Esc, devolução do foco, `close(false)` a não roubar o foco, ciclo de `Tab` e `Shift+Tab`, teclas presas dentro do diálogo, `onRoom`/`onAgent` a receberem a chave certa, `refresh()` a reler o estado, texto em PT-PT, e um nome com `<img onerror>` a aparecer **como texto**. Um segundo bloco lê `main.js`/`shell.html` e verifica os invariantes que precisam da cena para correr.
- **`npm run test:scene` — ✓ 35 postos** … e agora **no bundle real**: a lista está montada com **7 salas + 35 agentes**, a tecla `L` abre, o foco entra, o `Esc` fecha, o botão do zoom abre. Não é o módulo em isolamento: é a página construída.
- **`test:office` 17/17** · **`ops.test` 71/71** · **`integrations` 18/18** · **`check.mjs` 94/95** (só `smoke: browser`) · build **1315 KB** + `mesa.html` 86 KB.
- **O CSS novo foi lido de volta**: 1050 regras de topo, e as regras `.oi-*`, `.sr-only` e `.skip-link` presentes no fim da folha (um erro de sintaxe a meio teria cortado tudo o que vem depois).

### Limitações, declaradas

- **Não há Chrome nesta máquina**, logo não há captura de ecrã, e `smoke: browser` continua vermelho por falta de navegador — como antes, não é uma regressão.
- **Não testei com um leitor de ecrã a sério** (VoiceOver, NVDA, Orca). O que está provado é a semântica (papéis, nomes, ordem), o ciclo de foco e a ausência de armadilhas — em `jsdom`, não em hardware de leitura. Se algo for anunciado de forma estranha, é uma correcção de texto em `a11y.js`, não de arquitectura.
- **O `Tab` na cena é deliberadamente curto**: 7 cartões + as pastilhas da sala em foco. Quem quer os 35 chega lá pela lista, que é o caminho pensado para isso.

## 1.9.4 — 26 out 2026 · O chão é vidro, e o vidro tem a cor da sala

Pedido 22: *«coloca uma chão da cor dos vidros (vermelho, verde, azul, roxo, amarelo e azul céu), e faça melhorias na estrutura»*.

### O chão

- **As seis cores, uma por sala.** O chão deixou de ser uma laje pastel opaca e passou a ser **vidro colorido** — e a cor é a que foi pedida, repartida uma por sala, sempre na família da cor de marca dessa sala (o `chip` continua pastel nos cartões e nas secretárias; o `glass` é a mesma cor, saturada):

  | Sala | Cor pedida | Vidro |
  |---|---|---|
  | PROSPEÇÃO | amarelo | `#E3B93A` |
  | COMANDO | verde | `#1FA36B` |
  | ENGENHARIA | azul céu | `#41AEE4` |
  | MEDIA | vermelho | `#DC5348` |
  | VENDAS | roxo | `#8B5AD6` |
  | DESIGN LAB | azul | `#4A6DE0` |

  O **Cérebro** fica com vidro fosco (neutro, `#AEB6AB`) **de propósito**: é o centro, e o centro não compete com as seis salas que o rodeiam.
- **Quatro camadas, como um painel de vidro laminado visto de cima.** `floorBase` (o tom fundo, opaco, 0.10 — é o que dá profundidade ao vidro, o que garante a cor num ecrã sem transparência, e o que **recebe as sombras**: as sombras das secretárias vêem-se *através* do vidro, e é isso que o faz parecer vidro); `floorEdge` (a aresta polida, mais clara, 0.115 — o vidro real apanha a luz na espessura); `floorGlass` (a laje translúcida, opacidade 0.62, verniz `clearcoat: 1`, 0.12 — o nível exacto do chão, onde as secretárias pousam); `floorPool` (a poça de luz do candeeiro, branca e suave, por cima).
- **A cor chega mais longe do que o chão.** A banda de vidro das paredes passa a usar a **mesma família** (antes usava o pastel do cartão e dizia outra coisa); o cartão que nomeia a sala leva um **filete** com a cor do vidro no cimo; e a pastilha do nome de cada agente leva um **ponto** com a cor da sala. Uma cor, três sítios.
- **Modo escuro a acompanhar.** O vidro escuro não é cinzento: fica mais fundo e mais rico (a base entra 62 % na tinta, a aresta 50 %, a laje 42 %) e a poça de luz fica, mais discreta. Uma tabela (`FLOOR_DARK`) diz quanto entra em cada camada — antes havia um `if` por peça.

### A estrutura

- **`src/palette.js` (novo, puro).** Uma só fonte de verdade para a cor: `parseHex`/`toHex`, `mix`, `shade`, `tint`, `hsl`, `familyOf` (nomeia a família de matiz) e `glassLayers` (de uma cor saem as quatro camadas). Sem `three`, sem DOM — por isso corre em `node --test` e no servidor, e é o que permite provar as cores **sem olhos**.
- **Os builders recebem cores, nunca salas.** `makePlinth(w, d, glassColor)` não sabe o que é a PROSPEÇÃO. Quem sabe é o `main.js`; quem deriva os tons é a paleta.
- **Fim dos índices mágicos.** O `main.js` fazia `plinth.children[0].userData.part = 'plinth'; plinth.children[1]… = 'floor'` — a primeira camada nova partia o modo escuro em silêncio. As peças passam a dizer o que são (`userData.part`, `userData.tint`) e a sair do builder com nome: `plinth.userData.parts`.
- **O escritório valida-se no arranque.** `officeProblems()` (em `data.js`, puro) verifica salas ↔ pods ↔ agentes, cores, ids, chefes de sala e duas pessoas na mesma secretária; o `main.js` escreve o resultado na consola em vez de descobrir o erro a meio de um desenho. `assertOffice()` lança com o problema escrito, e o teste exige a lista vazia. É a lição de 1.9.2 transformada em código.
- **Sete imports mortos saíram do `main.js`** (`TOKENS`, `PLINTH_H`, `mat`, `rbox`, `makeFloorTitle`, `makeServerRack`, `makeMeetingTable`) — o tipo de sobra que faz alguém procurar um título de chão que já não existe. O catálogo `builders.js` fica com as peças que a cena não usa, **declarado** em `docs/CENA.md`.
- **`docs/CENA.md` (novo).** O contrato da cena: que ficheiro sabe o quê, as etiquetas `userData`, as quatro camadas e porquê, o mapa das seis cores, como mudar uma cor, e o que cada teste prova.
- **Um bug apanhado a tempo.** A poça de luz nasceu como caixa arredondada; o `ExtrudeGeometry` mapeia as UVs das tampas em unidades de mundo, e o gradiente saía clampado (a poça desaparecia). Passou a plano com UV 0..1, e o desvanecimento esconde a aresta recta. O teste de cena passa a verificar a **altura real** de cada camada (0.10 · 0.115 · 0.12 · acima) para isto não voltar a passar despercebido.
- O cabeçalho do `brain.js` foi corrigido: ainda descrevia o grafo gravado no chão, que já não existe (o centro é um orbe de vidro desde 25 out).

### Provas

- **`npm run test:office` — 17/17** (novo). Matemática de cor, famílias sem sobreposição, derivação das camadas, e as invariantes dos dados. Inclui um teste que **estraga os dados de propósito** e exige que a validação aponte a sala e o campo.
- **`npm run test:scene` — ✓ 35 postos**, e agora: 7 pods com chão, 4 camadas cada, laje translúcida, **cada uma das seis famílias presente exactamente uma vez**, o centro em vidro fosco, e as alturas das camadas certas. Saída: `chão de vidro em 7 pods (emails verde · delivery azul céu · sales amarelo · marketing vermelho · fin azul · ops roxo)`.
- **O teste tem dentes.** Troquei o amarelo pelo vermelho e voltei a correr: `✗ 3 falhas — os dados não validam: duas salas com a mesma cor de vidro · marketing repete a cor de sales · falta a cor pedida: amarelo`. Depois reposto: ✓.
- `ops.test` **71/71** · `integrations.test` **13/13** · `check.mjs` **94/95** (só `smoke: browser`) · build **1299 KB** + `mesa.html` 86 KB.
- **O que não está provado:** não há Chrome nesta máquina, logo **não há captura de ecrã**. Os números provam camadas, cores e alturas; o gosto do tom final é o olho do dono. Se o vidro parecer escuro ou lavado, afina-se uma linha em `data.js` (a cor) ou uma constante em `builders.js` (opacidade 0.62).

## 1.9.3 — 26 out 2026 · O menu, em vidro

Pedido 21 — *«melhore brutalmente o menu, um design mais vibe apple design»*. É trabalho de forma, não de função: **nenhum `id`, nenhum handler e nenhum comportamento mudou**. O que mudou foi o material, a escala, a hierarquia e o movimento.

- **Uma barra que flutua, em vidro.** A topbar deixa de ser uma faixa opaca de 52 px encostada ao topo. Passa a ser um painel de 54 px a flutuar 8 px do ecrã, com canto contínuo de 17 px, `backdrop-filter: blur(30px) saturate(180%)` (com o prefixo `-webkit-`), um realce especular no topo (o gradiente que dá a impressão de vidro) e três sombras em camadas: um traço interior claro, um traço interior escuro em baixo, e uma sombra larga e difusa. A cena 3D passa a ver-se **através** do menu, que era o ponto.
- **O menu é uma bandeja só.** Os cinco controlos (`#topToday`, `#topOps`, `#topMesa`, `#topLeads`, `#topCal`) vivem agora dentro de um grupo com fundo próprio e 3 px de almofada — a leitura de «segmented control» do macOS. Dentro dele: 34 px de altura, canto de 10 px, fundo transparente, hover que acende, `:active` que encolhe 2,5%.
- **Hierarquia, finalmente.** **HOJE** é a única acção cheia (pill escura em modo claro, clara em modo escuro): é a que pede uma decisão. As outras quatro são vidro que ganha tinta azul quando estão abertas (`.on`, `body.calOpen`) — a cor de selecção do sistema. O contador de aprovações passou de alarme laranja pulsante a selo âmbar discreto (pulso a 2,6 s, com o mesmo handler).
- **Tipografia calibrada.** Sai a etiqueta de 9 px em maiúsculas com `letter-spacing: .16em` (que é o oposto do que a Apple faz). Entra uma pilha SF (`-apple-system`, `BlinkMacSystemFont`, SF Pro, Helvetica Neue), 12,5 px, peso 550, tracking quase nulo; os rótulos passam a caixa de frase — **Hoje, Operação, Mesa, Leads, Calendário**. O relógio deixa de ser serifa de 20 px e passa a números tabulares de 12,5 px com um traço a separá-lo do menu. Os ícones (`◉ ▤ ◈ ◷ ⚠`) foram substituídos por **SVG desenhados à mão** (15 px, traço 1,4), porque glifos de fonte de símbolos falham em metade das máquinas.
- **O contador do HOJE via-se mal — e agora vê-se.** `#topToday .td-badge` tinha `display: none` sem excepção: o JavaScript escrevia o número e o número nunca aparecia. Agora `:not([hidden])` mostra-o como selo vermelho de notificação (mínimo 17 px, tabular). Isto já não é decoração: é a informação que estava a ser perdida.
- **As gavetas que pendem do menu** (`#leadsPanel`, `#opsPanel`) recebem o mesmo vidro, mais espesso (`.88` de opacidade) porque têm texto para ler, canto de 20 px, o mesmo desfoque e uma entrada curta de 6 px. Os cabeçalhos perdem a linha preta e ganham o traço fino do resto do produto.
- **O mesmo vocabulário por dentro.** Os separadores das gavetas (`.ld-seg`, `.op-tabs`) deixam de ser pílulas de 8,5 px em maiúsculas e passam a segmentos de 11,5 px com a tinta azul da selecção; os botões do cabeçalho (`.ld-h`, `.op-h`) ficam pílulas de 10 px com o ✕ num círculo de 24 px; **Procurar** passa a ser o botão cheio da gaveta dos leads. As etiquetas passam a caixa de frase nos sítios onde são nossas (`Empresas`, `Web`, `Leads`, `Mensagens`, `Autonomia`, `Saldo`, `Fila e rasto`, `Atualizar`, `Procurar`) — só texto, porque os handlers usam `data-k`, nunca o rótulo. O conteúdo das listas fica como está: ali a densidade vale mais do que o ar.
- **Acessibilidade e teclado.** Cada controlo tem `aria-label` (a etiqueta pode desaparecer em ecrã estreito; a acção não), o grupo tem `role="group"`, o contador tem `role="status"`, e `:focus-visible` passa a dar um anel azul do sistema em vez do nada que havia.
- **Responsivo por subtracção, não por corte.** ≤1140 px caem as etiquetas de versão e das tiras de motores; ≤1020 px cai a tira de modelos; ≤900 px os botões ficam só com ícone (excepto o HOJE, que nunca perde o nome) e cai a tira de conectores; ≤620 px a barra aperta. Em todos os passos as cinco acções continuam presentes.
- **Movimento discreto e desligável.** Entrada da barra em 0,5 s, gavetas em 0,32 s, hover em 0,2 s — tudo com `prefers-reduced-motion: reduce` a devolver o menu estático (a animação do selo âmbar incluída).
- **Acessório obrigatório: o que vive debaixo da barra desceu 10 px.** `#rail` (62 px), `#overviewBtn` (74), `#board.company` (72), `#board.left/.right` (118) e a marca no canto (76). Sem isto, o vidro flutuante tapava o cimo das gavetas.
- **O que não foi provado.** Não há Chrome nesta máquina, por isso **não há captura de ecrã**: `smoke: browser` continua vermelho por falta de navegador (94/95 no `check.mjs`, como antes). O que está provado é o que se pode provar sem olhos: `test:scene` **✓ 35 postos, sem erros no bundle** (contra o `dist/` construído **e** contra a página servida em `:4550`), `ops.test` **71/71**, e um teste de estrutura novo que confirma os 11 ids do menu, os 5 controlos no grupo, um único `<span>` no `#topAppr` (o JavaScript escreve lá o número) e o `.td-badge` do HOJE. O CSS novo foi validado com `css-tree` (59 regras, 0 erros de sintaxe) — a prova final é o olho do dono.
- **Provas.** build **1289 KB** + `mesa.html` 86 KB · `ops.test` **71/71** · `check.mjs` **94/95** (só `smoke: browser`) · `test:scene` ✓ · `/` a servir **1 320 403 bytes** na porta **4550**.

## 1.9.2 — 26 out 2026 · A cena voltou

- **O que se via.** O escritório aparecia **em branco**: sem salas, sem pessoas, nem a plataforma. O HTML da barra e dos painéis estava lá; o 3D é que nunca era desenhado.
- **Causa.** A limpeza da demonstração (1.9.1) apagou funções que continuavam a ser chamadas — `spawnEmote`, `getEmoteTex`, `emotes`, `tickEmotes`, `walkStep` e `applyStandAndFacing` em `main.js`, e a chamada a `addTask` em `tasks.js`. A primeira `ReferenceError` acontecia ao montar o contexto de `initTasks`, **antes** de `resize()` e do ciclo de desenho: tudo o que vinha depois nunca corria, e o canvas ficava vazio. `node --check` e `npm run build` passam sempre nestes casos — só um teste que **executa** a página apanha isto.
- **Correcção.** As funções voltam (mesma geometria de antes: bolha de emoji por cima do posto, passos, postura). O caminho das rotinas em modo ficheiro deixou de fabricar uma tarefa: diz que sem servidor não há trabalho. `window.CC` já não expõe um `addTask` que não existe.
- **Segunda armadilha, também fechada.** `initMcp` rebentava com `LOGOS[k].img` quando não havia conectores (`/api/mcp` a falhar) e deixava uma promessa rejeitada sem tratamento. Agora o azulejo do motor só é desenhado se houver logotipo, e `loadConnectors()` tem `.catch` — os conectores falham em silêncio visível, a cena não.
- **Teste novo: `npm run test:scene`.** Carrega o bundle construído num DOM (jsdom) com um contexto WebGL falso, espera 3 s e verifica: **nenhum erro no bundle**, nenhuma promessa rejeitada, `window.CC` existe (o módulo chegou ao fim) e há **35 postos** com secretária e pessoa. Contra o bundle que esteve no ar, o teste diz exactamente o que se via: *«esperava 35 postos na cena, encontrei 0»*. Custa ~4 s e não precisa de Chrome.
- **Provas.** `test:scene` **✓ 35 postos** · `ops.test` **71/71** · `check.mjs` **94/95** (só `smoke: browser`) · build **1276 KB** + `mesa.html` 86 KB.

## 1.9.1 — 26 out 2026 · O escritório deixa de fingir trabalho

Pedido 19, frente (a). Sai tudo o que inventava estado; o que não existe é dito por palavras.

- **Nada muda de estado sem trabalho real.** O painel de tarefas passa a ter uma só fonte — `GET /api/ops/tarefas` (a cada 4 s, assinatura `id:estado:tentativas`) — e desenha o que a base de dados tem: `running→a fazer`, `awaiting_approval→à espera`, `queued→a seguir`, o resto concluído ou falhado, com o erro escrito. Saíram as filas sorteadas, as 35 tarefas semeadas ao abrir, as 40 conclusões por dia, as aprovações de rotina e as cadeias de passagem de testemunho.
- **Sem trabalho na base de dados, o escritório di-lo.** O `tick` já não avança progresso sozinho; as percentagens saíram dos cartões (fica o estado e a duração). Sem servidor, o chat e o formulário dizem que a tarefa não existe em vez de a inventarem.
- **A demonstração saiu do código.** `src/hero.js` apagado (agentes a engolir ecrãs, «We're next», ecrãs de LinkedIn pintados) com o mapa `MCP_BY_DEPT` que só ele usava; `src/v1data.js`, `src/profile.js` e `src/screens.js` apagados (empresas, personas e métricas fictícias); as 35 identidades vivem em `src/agentes.js`. Em `src/mcp.js` acabaram o vaivém de pacotes por `Math.random`, os pulsos de modelo sorteados, o «flourish» de arranque e o par Claude+ChatGPT a pulsar sozinho — um feixe só existe quando um agente usa mesmo uma ferramenta. `src/live.js` perdeu o estado `demo`.
- **As salas e os agentes ficam exactamente como estavam.** O polimento de materiais e iluminação que chegou a ser experimentado em 1.9.1 (ambiente PMREM, tone mapping neutro, vernizes, candeeiros, cove) foi **revertido a pedido do dono**: a cena volta a 1.9.0, sem uma única geometria, câmara ou controlo diferente. O trabalho está no histórico (`3d74ea0`) e pode voltar noutra altura, aos poucos.
- **O servidor não morre por falta de bundle.** `serve.mjs` constrói o `dist/` uma vez no arranque se ele faltar (num clone limpo) e, se mesmo assim faltar, `/` e `/app` respondem **503 com o motivo** em vez de derrubarem o processo.
- **Provas.** `ops.test` **71/71** · `check.mjs` **94/95** (só `smoke: browser`, sem Chrome nesta máquina) · `npm run build` **1275 KB** + `mesa.html` 86 KB.

## 1.9.0 — 26 out 2026 · Os monitores mostram o trabalho

- **O escritório ao vivo, a sério.** Os 35 monitores deixam de repetir três linhas de exemplo. Cada posto mostra a **tarefa real** que a base de dados do Órbita registou: título, hora de início, tentativa x/y, o que a tarefa produziu (ficheiros, KB, QA, preview, lead qualificado) e, quando falhou, o erro escrito. Sem trabalho registado, o ecrã diz **«sem tarefa registada»** — não roda texto para parecer ocupado.
- **Cada monitor é diferente porque o trabalho é diferente.** A forma do painel vem do tipo de tarefa: `terminal` (geração, correções, entregas), `relatório` (QA, com as contagens críticos/importantes/menores), `documento` (briefing, conteúdo), `lista` (leads, propostas, mensagens). Nada de uma animação igual em 35 ecrãs.
- **Streaming real, não animação.** `GET /api/ops/aovivo` é o retrato; `GET /api/ops/aovivo/stream` é **SSE** (sem WebSocket, sem dependências). O servidor compara a impressão digital de `tasks`/`jobs`/`projects` a cada 800 ms e **só emite quando algo mudou**; entre mudanças manda um `ping`. Cada `update` traz `alteracoes` — que agente mudou, para que tarefa, para que estado e quando.
- **Estados que dizem a verdade.** `LIVE` só com tarefa a correr ou evento real nos últimos 2 minutos; `WAITING` para fila e aprovações; `ERROR` para falha recente (30 min, para uma falha de ontem não ficar vermelha para sempre); `IDLE` quando não há nada. Sem percentagens inventadas.
- **Ligação que cai fica visível.** O cliente deteta silêncio (20 s) e a falha do `EventSource`; a partir daí os monitores e o painel passam a **DESATUALIZADO** com a hora do último dado bom, em vez de fingirem direto. O `retry: 3000` faz o cliente voltar sozinho e há um botão **ATUALIZAR AGORA**.
- **Clicar num agente abre o painel de inspeção** (separador **AO VIVO** no rail, agora visível): identidade que já existia (nome, função, departamento, cor), estado operacional, atividade atual com passos reais, o **monitor em direto** (o mesmo desenho que está na cena, noutro tamanho), verificações de QA, artefactos com link para o ficheiro/preview/zip/projeto, histórico e eventos. O que não existe é dito por palavras. Fecha sem perder a posição na cena — o rail continua a ser o mesmo.
- **Segurança.** O que sai do servidor passa por `redact()` (caminhos absolutos abreviados, chaves e tokens ocultos); o `payload` da tarefa — que pode levar conteúdo privado — **não** é enviado. As rotas novas estão sob sessão e `permFor(..., 'read')`, com 401 sem credencial.
- **Sem custo no motor.** O tick da cena deixou de sortear linhas: redesenha um monitor quando chega retrato novo e, no máximo, de 2,5 s em 2,5 s (15 s com a câmara longe). Nada muda na geometria, na câmara nem nos controlos; com `window.SCREENS` (cena de demonstração) os ecrãs continuam gravados e o painel marca **DEMO**.
- **Provas.** `ops.test.mjs` **69/69** (6 testes novos: mapa posto→agente, idle honesto, running/queued/falhada, impressão digital, `redact`), `check.mjs` **94/95** (só a do navegador, que precisa de Chrome) com **dois passos novos** — retrato com 401 sem sessão e fluxo SSE que emite só o que mudou —, `evals` 8/8 e `integrations` 18/18. Imagem de prova dos quatro formatos: `monitores-aovivo.png`.

## 1.1.0 — 26 out 2026 · Operação a sério

- **Os dados ficam guardados.** Nova camada `src/ops/` sobre **SQLite** (`node:sqlite`, sem dependências): `leads`, `messages`, `events`, `jobs`, `consents`, `usage`, `meta` em `data/orbita.db`. Um reinício deixa de perder trabalho. O esquema é versionado (`SCHEMA_VERSION`), para o caminho para Postgres/Supabase ser escrito e não adivinhado.
- **Pontuação explicada.** Cada lead tem `score` (0–100) **e** `score_reasons` («sem site (+25) · telefone público (+15) · avaliação 3,8 (+10)»). A nota recalcula-se sobre o lead completo — um segundo contacto sem telefone não apaga o que já se sabia.
- **Sem duplicados, a sério.** Chave por domínio → 9 dígitos finais do telefone → email → nome+cidade. Uma segunda entrada atualiza os dados factuais e **preserva** o que é do dono: estado, notas, consentimento, seguimento.
- **Funil com regras.** `novo → contactado → respondeu → reuniao → cliente`, com `perdido` em qualquer ponto; saltar de «novo» para «cliente» é recusado com a frase do funil.
- **Mensagens com aprovação.** `rascunho → aprovada → enviada`; só o dono aprova, e só uma aprovada pode sair. Email exige `RESEND_API_KEY` **e** consentimento registado; o WhatsApp é um link `wa.me` revisto e enviado à mão, com **JÁ ENVIEI** a confirmar — o Órbita não finge que enviou.
- **Opt-out que manda.** `POST /api/ops/consent/opt-out` bloqueia o email/telefone em definitivo; a partir daí as mensagens ficam `bloqueada` e o lead em `perdido` se ainda não era cliente.
- **Aquecimento do número.** Poucos envios no primeiro dia, a subir por dia até um teto, mais limite por minuto (6) — e a recusa explica o limite em vez de falhar em seco.
- **Fila com tentativas.** Trabalho persistente em `jobs`: falha → volta com espera crescente (15 s → 1 h) → desiste ao fim de `max_attempts`, com o erro escrito. O servidor drena a fila a cada 2 s.
- **Auditoria e custos.** Cada ação escreve em `events` (quem, o quê, quando, sobre o quê). `usage` soma o consumo por fornecedor; `/api/ops/summary` mostra funil, conversão e margem — com `null` e a razão quando não há dados suficientes.
- **A gaveta ◉ OPERAÇÃO.** Na barra: leads com nota e razões, mudança de estado no funil, mensagens à espera de OK (aprovar / rejeitar / abrir WhatsApp / já enviei), fila e rasto.
- **A pesquisa passa a gravar na base de dados.** `/api/google/search` continua a guardar na gaveta e passa a gravar também em `orbita.db`, pontuado e sem duplicados (`baseDeDados: { created, updated, refused }`). O que já estava só em `data/leads.json` entra com `POST /api/ops/leads/importar-gravados`.
- **Provas.** `ops.test.mjs` (12 testes, SQLite em memória, nenhum serviço externo) e cinco passos novos no `check.mjs` com um servidor isolado que exercita as rotas sem tocar nos dados do dono: **55 verificações** (a do navegador continua a falhar sem Chrome). Guia em **OPS.md**.

## 1.2.0 — 26 out 2026 · Hoje, e a base que não se vê

- **O ecrã «Hoje».** Um só ecrã com três perguntas: o que precisa da tua decisão, o que aconteceu enquanto dormias, o que vai acontecer. Abre com `HOJE` na barra (ou `H`), e na primeira visita de cada seis horas abre sozinho quando há algo à tua espera.
- **A decisão é um gesto.** Deslizar para a direita aprova, para a esquerda rejeita, toque longo abre o porquê. Cada gesto tem botão e tecla equivalentes (`←` rejeitar, `→` aprovar) — teclado e leitor de ecrã não ficam de fora. Decisões otimistas: o cartão sai já e volta com a razão se o servidor recusar.
- **Porquê em cada cartão**, feito só com dados guardados (as razões da nota do lead, o canal, o estado, os dias sem resposta). Sem dados que cheguem, o cartão não aparece.
- **Eventos encadeados.** Cada linha de `events` leva o hash da anterior; `GET /api/ops/events/verify` fecha a cadeia ou diz em que linha partiu. O feed do «aconteceu» traduz os eventos em frases.
- **Outbox com idempotência.** O envio é escrito antes de sair, com chave única (mensagem + conteúdo) e aluguer com prazo. Pedir duas vezes é pedir uma; um processo que morre não deixa trabalho preso; um email resgatado depois de um crash vai para `revisao` em vez de se repetir às cegas.
- **Interruptor de emergência.** `POST /api/ops/stop` pára todos os envios de todos os caminhos, com a razão dita na recusa; o ecrã Hoje mostra-o ligado.
- **Tokens de design e acessibilidade.** Espaçamento em múltiplos de 4, escala tipográfica, cores semânticas (`--ok`, `--warn`, `--risk`), modo escuro de raiz, `aria-modal`/`aria-live`, foco visível e `prefers-reduced-motion`.
- **Estados vazios que ensinam** o próximo passo em vez de «sem resultados». **Provas:** 17 testes em memória e **59 verificações** (a do navegador falha sem Chrome).

## 1.3.0 — 26 out 2026 · Personalização por lead

- **Ver o negócio antes de lhe escrever.** `POST /api/ops/leads/:id/pesquisar` lê o site do lead uma vez — respeitando `robots.txt`, recusando endereços privados (SSRF), com 12 s e 400 KB — e guarda factos com a frase de onde saíram: sem versão móvel, rodapé de 2019, sem `https`, sem formulário, sem marcação, plataforma, Instagram, a descrição escrita pela própria casa. O texto inteiro não é guardado, só o que se pode citar. Falhas ficam com o motivo em português (DNS inexistente, 403, tempo esgotado…), nunca com um dossiê inventado.
- **Oportunidade separada da nota.** A soma dos factos dá uma nota de 0–100 que diz quanto trabalho há ali — distinta do valor do lead.
- **Mensagem presa aos factos.** Com motor de IA, o prompt só pode citar a lista de factos; `guardDraft` recusa a mensagem inteira se aparecer uma citação inventada ou uma promessa («o melhor do mercado»). Sem motor, um modelo local escreve na mesma. O rascunho diz sempre de onde veio (`generated_by`) e porquê (`why`).
- **Objeções previstas com resposta pronta** — regras do negócio, não do modelo: Instagram, preço, falta de tempo, «já tenho quem faça», mais as específicas do que se viu no site.
- **A oferta é do dono** (`GET/POST /api/ops/oferta`: nome, preço, prazo, garantia) e entra nas mensagens e nas respostas.
- **Ciclo que fecha.** `POST /api/ops/messages/:id/sinal` com respondeu/interessado/reuniao/cliente/ignorou/recusou/pediu_parar. Cada sinal guarda os atributos do lead, e daí saem pesos com amortecimento e **amostra mínima de 3**; a nota passa a ter `score_base` + `score_learned` (±12), com a razão escrita. Os sinais também movem o funil.
- **Na interface:** o cartão de Hoje mostra os factos e as objeções em «Ver porquê»; a gaveta OPERAÇÃO ganhou `PESQUISAR`, o dossiê e `ESCREVER COM OS FACTOS`, e botões de sinal nas mensagens enviadas, com o que se aprendeu na aba da fila.
- **Provas:** 27 testes em memória (robots, SSRF, falhas, citação inventada, pesos, amostra) e **63 verificações** — a do navegador continua a falhar sem Chrome.

## 1.4.0 — 26 out 2026 · Autonomia graduada, agência e saldo

- **A autonomia não se dá: ganha-se.** Cada tipo de mensagem (canal + gancho, ex.: `whatsapp:sem-site`) começa em **pede-me sempre**. O Órbita só propõe enviar sozinho quando há **50 casos decididos** com **95% de aprovações** (limiares configuráveis em `POST /api/ops/autonomia/limiar`). Antes disso diz o que falta, por palavras: «faltam 47 casos decididos (3/50)». Um `409` é a resposta a quem tente subir sem amostra — a não ser com `force` explícito, que fica registado com a razão.
- **A autonomia nunca passa por cima dos travões.** A aprovação automática continua a respeitar opt-out, o interruptor de emergência, o aquecimento do canal e o **modo ensaio**. Descer é sempre possível, com um toque, e nunca falha.
- **Modo ensaio.** Uma semana a escrever tudo e a não enviar nada: as mensagens nascem em `ensaio`, o **Hoje** avisa, e o relatório diz o que teria saído, por tipo, com uma amostra. Uma mensagem em ensaio pode ser promovida a rascunho (`…/promover`) ou rejeitada — e as duas coisas contam como decisão.
- **Avaliações com versão de prompt.** `src/ops/evals.mjs` traz um conjunto fixo de casos (negócio sem site, site de 2019, clínica moderna sem marcação, motor que inventa, motor honesto) e três guardas. `node evals.mjs` → **8/8** com o prompt `rascunho-v1`; o resultado fica guardado em `evals` com a versão, e uma corrida pior do que a anterior aparece como **regressão**, com o aviso escrito.
- **Modo agência — um ficheiro por cliente.** `src/ops/tenants.mjs`: cada cliente tem a sua pasta (`data/clientes/<slug>-<id4>/orbita.db`), o seu esquema e a sua oferta. O registo vive em `data/clientes.db`; o espaço activo fica nas definições e troca-se no select **Espaço** da gaveta. Um erro de consulta não pode misturar leads de dois negócios — é isolamento, não uma coluna `cliente_id`.
- **Onboarding em três passos**, ditos com o que falta: procurar leads (e a chave que isso exige), escrever, decidir. Criar um cliente leva segundos e acaba em algo concreto.
- **Saldo real.** `src/ops/money.mjs`: entradas registadas à mão (`POST /api/ops/receita`), custos de API somados da tabela `usage`, **margem**, receita por campanha, custos por fornecedor e custos unitários (por lead, por contactado, por cliente). Sem entradas, a margem é **negativa** e o ecrã diz porquê — não é zero.
- **Na gaveta:** select de cliente com `+ CLIENTE`, abas **AUTONOMIA** (nível por tipo, dar/revogar, ensaio, avaliações) e **SALDO** (entrou, gastou, margem, registar entrada, tabelas). O cartão de Hoje ganhou o tipo **autonomia**: a proposta de enviar sozinho aparece onde se decide, com `→` a dar e `←` a recusar.
- **Provas:** `ops.test.mjs` passa a **36 testes** (autonomia com e sem amostra, opt-out a mandar sobre a autonomia, ensaio, regressão nos evals, saldo negativo, isolamento entre clientes) e o `check.mjs` a **67 verificações**, com quatro provas novas contra um servidor isolado: `409` sem amostra, ensaio que não deixa sair, avaliações guardadas, e um cliente novo que vê **0 leads** do anterior. A do navegador continua a falhar sem Chrome.

## 1.5.0 — 26 out 2026 · A mesa de trabalho: leads e aprovação

- **Uma superfície para decidir, ao lado do escritório.** `/app` (botão **▤ MESA** na barra) abre uma página sóbria, de produto: barra lateral com **Hoje**, **Leads**, **Conversas** e **Saldo**, cartões brancos, um azul só para o que é acção. O escritório 3D continua onde está — é lá que os agentes trabalham; a mesa é onde tu decides. Construída como um ficheiro só (`dist/mesa.html`, 46 KB, sem pedidos externos), com entrada própria no `build.mjs` para não arrastar o three.js.
- **A página de leads.** Procura por nome, cidade, nicho, telefone, email ou site; filtros **Todos / Por contactar / Sem site / Responderam**; cada linha traz o nicho e a cidade, a nota com cor, o estado do funil e o contacto. Sem leads, o estado vazio diz de onde eles vêm.
- **A página de aprovação (cada lead).** O texto pronto numa bolha, o canal e o estado por palavras («por aprovar», «aprovada — falta enviar», «em ensaio — não sai»), **Porquê este lead** com os sinais que existem mesmo (as razões da nota e os factos lidos no site), e **Rejeitar** / **Aprovar e enviar**. Aprovar abre o link do WhatsApp com o texto; depois **Já enviei** confirma. Email tenta o envio e mostra a recusa por palavras se faltar token ou consentimento. Sem mensagem, a página mostra os sinais e dois botões: **Ler o site** e **Escrever mensagem**.
- **O que sabemos e o histórico**, na mesma página: telefone, email, site, avaliação, origem, estado, o resultado da última leitura do site (com o motivo quando falha) e todas as mensagens daquele lead com o estado de cada uma.
- **Hoje, na mesa.** Quatro números reais (leads novos, com contacto, respostas desde ontem, custo de APIs a 30 dias), a lista **Precisa de ti** e, ao lado, a mensagem com o porquê e a decisão. As propostas de autonomia aparecem aqui como cartões próprios, com dar/recusar.
- **Saldo, na mesa.** Entrou, gastou, margem; registar uma entrada; receita por campanha, custos por fornecedor, custos unitários e as entradas com a data.
- **O interruptor de emergência é o mesmo** — o estado real (`PARAR TUDO`) está no canto de todas as páginas e liga/desliga pelo servidor, com a frase dita.
- **Telemóvel**: barra inferior com as quatro secções, uma coluna, acções pegadas ao fundo, alvos de toque de 44 px, `aria-current`, foco visível e `prefers-reduced-motion`.
- **Servidor:** nova rota `GET /api/ops/leads/:id` (lead + dossiê + mensagens numa só resposta), filtro `?leadId=` em `/api/ops/messages`, e `/app`·`/mesa` a servir a página. `dist/mesa.js` para desenvolvimento.
- **Provas:** **69/70** verificações — duas novas, contra o servidor isolado: `/app` serve a página construída, e o lead vem com dossiê e mensagens. A do navegador continua a falhar sem Chrome. `ops.test.mjs` 36/36 e `node evals.mjs` 8/8 sem alterações.

## 1.6.0 — 26 out 2026 · Do lead ao código, com provas

- **Projetos a sério.** Nova tabela `projects` (esquema **v5**) com briefing, objetivos, páginas, funcionalidades, critérios de aceitação, stack, estado e pasta própria em `data/projetos/<slug>/`. Um negócio, um projeto: índice único em `lead_id`, e a recusa diz qual é o projeto que já existe.
- **Motor de geração real** (`src/ops/generate.mjs`): quatro pontos de partida — **página de conversão**, **site institucional** (4 páginas), **loja** com catálogo e carrinho, **sistema interno** com indicadores e exportação CSV. Escreve ficheiros que abrem no browser: HTML semântico, CSS responsivo, JavaScript validado. Sem CDN, sem fontes remotas, sem dependências: abre offline.
- **Nada inventado nos dados.** A loja lê `data/products.json` e o sistema lê `data/dataset.json`; ambos nascem vazios, com estados vazios que ensinam a preencher. Não há produtos nem números de demonstração a passar por verdade.
- **QA com critérios objetivos** (`src/ops/qa.mjs`): ficheiros obrigatórios, doctype/lang/viewport/título, um só `h1`, links internos que existem, recursos externos (bloqueados), rótulos em formulários, `alt` em imagens, JavaScript que compila (`vm.Script`), CSS com chaves fechadas e `@media`, JSON válido, e um pente de honestidade (lorem ipsum, TODO, placeholders). Três níveis: crítico, importante, menor. Guarda o **manifesto sha256** de cada corrida em `qa_runs`.
- **Entrega só com provas.** Aprovar exige QA aprovado **e** ficheiros iguais aos auditados; entregar exige aprovação. Se algo mudar depois da auditoria, a entrega é **bloqueada** com a lista dos ficheiros. O **preview é real**: `/preview/<id>/` serve os ficheiros gerados pelo próprio Órbita (com proteção contra `..`), e `GET …/zip` devolve o projeto em ZIP (escrito à mão, PKZIP válido, nomes UTF-8).
- **Vercel e GitHub não fingem.** Sem `VERCEL_DEPLOY_HOOK`, a recusa nomeia a variável que falta; com o hook, o pedido é registado como **pedido** — «pedir não é estar publicado». O envio de ficheiros para o GitHub não está implementado e diz isso.
- **Funil comercial completo**: `novo → qualificado → contactado → em negociação → proposta → ganho`, com `perdido` em qualquer ponto e o caminho curto antigo preservado. Saltos recusados com a frase do funil.
- **Guarda da porta** (`src/ops/guard.mjs`): limitador de 300 pedidos/minuto por IP (429 com o tempo de espera) e, se `ORBITA_ADMIN_TOKEN` (16+) existir, `/api/ops` passa a exigi-lo (cabeçalho `x-orbita-admin`, `Bearer` ou cookie). Sem a variável, o arranque diz em voz alta que está em **modo local, sem palavra-passe**. O escritório e a mesa pedem o token uma vez e guardam-no no browser.
- **Registo de execução**: cada geração e cada QA deixam linha em `jobs` (estado, início, fim, resultado) — evidência do que correu, não só do que se disse.
- **Na mesa**: secção **Projetos**, com pipeline visual (briefing → código → qualidade → aprovação → entrega), relatório de QA legível, lista de ficheiros com marca de «alterado», entregas e histórico; no lead, «Criar projeto» quando ainda não existe.
- **Provas:** `ops.test.mjs` **43 testes** (novos: geração dos quatro tipos, QA a apanhar links partidos/rótulos/lorem, entrega bloqueada por alteração, ZIP válido, funil comercial, guarda e ritmo) e `check.mjs` **74/75** — cinco passos novos de ponta a ponta contra um servidor isolado: lead → qualificar → projeto → gerar (4 ficheiros, 14 KB) → QA → aprovar → entregar → preview HTTP 200 com HTML e CSS reais → mexer invalida a aprovação → Vercel/GitHub recusam com o nome do que falta. A verificação do navegador continua a falhar sem Chrome.

## 1.7.0 — 26 out 2026 · Tarefas com estado real, funil medido e a guarda fechada

- **Tarefas dos seis departamentos** (`src/ops/tasks.mjs`, esquema **v6**): máquina de estados `queued → running → succeeded | failed | awaiting_approval`, com departamento, tentativas limitadas, prazo por tarefa, resultado, evidência e duração. **Uma tarefa aberta por chave** (índice parcial único) — dois pedidos simultâneos do mesmo trabalho devolvem a mesma tarefa. Um processo que morre a meio é recuperado no arranque: o que passou do prazo volta à fila ou falha com o motivo.
- **Aprovação humana** para acções de risco: a tarefa corre, fica em `awaiting_approval` e só passa a `succeeded` com `aprovar` — quem aprovou e quando fica escrito. Repetir uma tarefa falhada é possível até ao limite de tentativas; a anterior fica no registo.
- **Nada inventado sem motor**: as tarefas que precisam de IA (`mensagem.redigir`, `conteudo.rascunho`, `projeto.corrigir`) falham com o motivo escrito quando não há chave — não devolvem um resultado de faz-de-conta. As determinísticas (qualificar, pesquisar, proposta, briefing, gerar, QA, entregar preview, revisão de prioridades) correm sempre.
- **Qualificar avança o funil**: um lead novo com nota ≥ 60 passa a `qualificado`, com o motivo em `events`.
- **Painel de agentes com estado lido da base** (`#/agentes`): cada departamento mostra o que fez, o que falhou e o que está na fila; «a trabalhar» só quando há uma tarefa em `running`. Sem tarefa, sem movimento.
- **Funil medido** (`metrics.pipeline`): quantos leads chegaram a cada fase (estado atual + histórico em `events`), conversão entre fases, taxa por origem com data de recolha, e **oportunidades paradas** há mais de 14 dias.
- **Pesquisa global** (`src/ops/search.mjs`): leads, projetos e tarefas numa só resposta, sem depender de acentos; uma letra não pesquisa.
- **Painel de atividade**: tarefas, jobs de fila e eventos recentes, com a última falha à vista.
- **Guarda fechada**: além do ritmo (300/min por IP) e do token opcional, um pedido mutável autenticado por **cookie** vindo de outra origem é recusado (**403, CSRF**). O cabeçalho `x-orbita-admin` não sofre disto.
- **QA honesto sobre o navegador**: o relatório passa a dizer se os testes de navegador correram; neste ambiente saem como **não executados, com o motivo** — nunca como aprovados.
- **Na mesa**: secções **Tarefas** (filtros por departamento e estado, correr/repetir/aprovar/rejeitar, resultado e evidência) e **Agentes**; cartão do **Funil** nos leads; pesquisa global em leads e projetos; barra de navegação com seis secções no telemóvel.
- **Provas:** `ops.test.mjs` **54 testes** (11 novos: duplicados, falha sem motor, prazo, tentativas, aprovação, recuperação, painel, funil, paradas, pesquisa, CSRF); `check.mjs` **85/86** com dez passos novos de ponta a ponta — incluindo **quatro pedidos em paralelo a criar uma só tarefa** e **reinício do servidor com dados intactos** (3 leads, 6 tarefas, 1 projeto). Só a verificação de navegador falha, por não haver Chrome.

## 1.8.0 — 26 out 2026 · Contas, sessões e papéis

- **Autenticação ≠ autorização, finalmente separadas.** Havia uma palavra-passe para a instalação toda: quem a tinha podia tudo. Agora há **contas** (esquema **v7**: `users`, `sessions`, `auth_attempts`), **sessões** com prazo e revogação, e **quatro papéis** com permissões declaradas:
  - **dono** — tudo: contas, aprovações, entregas, dinheiro e oferta;
  - **gestor** — aprova, entrega e pára envios; não mexe em contas;
  - **operador** — cria e edita leads, projetos, mensagens e tarefas; não aprova nem entrega;
  - **leitor** — vê tudo, não altera nada.
- **A regra vive no servidor.** `permFor(método, rota)` mapeia cada rota para `read`, `write`, `approve` ou `admin`; a mesa esconde o que o papel não permite (cortesia), mas quem recusa é o servidor com **403** e o motivo em palavras.
- **Palavras-passe com scrypt** (N=16384, sal próprio) — nunca em claro, nunca em log, nunca devolvidas por uma API. Política mínima de 12 caracteres que recusa as óbvias, o próprio email e o próprio nome.
- **Sessões** com token de 32 bytes aleatórios; na base fica só o **sha256**. Cookie **HttpOnly + SameSite=Strict + Path=/** (e `Secure` quando é https). Prazo de 12 h configurável, revogação individual na mesa, e trocar a palavra-passe fecha todas as sessões.
- **Primeira conta** criada em `/app` e só enquanto não existir nenhuma — depois disso, só um dono cria contas. O arranque passa a dizer em palavras o modo: contas, token de máquina ou **modo local sem palavra-passe**.
- **Força bruta**: 20 tentativas de entrada por minuto e por IP, e **5 falhas numa conta bloqueiam-na 15 minutos**; o email vai em **hash** para o registo de tentativas, para não deixar dados pessoais em claro. A resposta é a mesma para conta inexistente e palavra-passe errada.
- **O escritório 3D** passa a estar sob a mesma guarda (`/api/tasks`, `/api/chat`, `/api/email`, `/api/deploy`, …): em modo local continua aberto; com contas, quem não entrou é levado a `/app`.
- **Na mesa**: ecrã de entrada (e de criação da primeira conta), nome e papel no rodapé, «Sair», e a secção **Contas** (só para dono) com lista de contas, mudança de papel, criação, desactivação e sessões activas com botão para fechar.
- **Configuração**: `ORBITA_SESSION_HOURS`, `ORBITA_SECURE_COOKIE` e `ORBITA_AUTH=sessao` (desliga a credencial de máquina — o modo certo para expor na internet). O SQL de Postgres ganha `orbita_users`, `orbita_sessions` e `orbita_auth_attempts`, com RLS e sem qualquer política para `anon`.
- **Provas:** `ops.test.mjs` **63 testes** (9 novos: hashing e política, hierarquia de papéis, contas e primeira conta única, expiração/revogação de sessões, troca de palavra-passe que fecha tudo, bloqueio após 5 falhas sem email em claro, guarda com sessão/máquina/local, flags do cookie, estado de autenticação); `check.mjs` **92/93** com sete passos novos por HTTP — primeira conta e cookie `HttpOnly`, 401 com motivo, sessão a abrir `/api/ops`, matriz de papéis (`leitor lê=200 escreve=403 · operador escreve=201 aprova=403 · gestor aprova=200 contas=403 · dono contas=200`), bloqueio de 5 falhas, sair/revogar a fechar na hora e CSRF com cookie de sessão. Só a verificação de navegador falha, por não haver Chrome.

# Changelog

## 1.0.0 — 25 out 2026 · Órbita

- **Google Antigravity como motor.** O `agy` — o CLI da Google, sucessor do Gemini CLI — entra na lista de motores ao lado do Claude Code e do Codex: `agy --print-timeout 15m -p "<system + pedido>"`, com o envelope JSON desembrulhado e o binário procurado também em `~/.local/bin`. O Gemini CLI fica marcado como substituído.
- **Leads reais da Google.** O botão **◈ LEADS** procura empresas verdadeiras na **Places API (New)** — nome, morada, telefone, site, avaliação, mapa — e guarda tudo em `data/leads.json` sem duplicados (domínio → telefone → nome+morada), com uma nota de oportunidade explicada (sem site +40). A Prospeção e as Vendas leem os oito melhores leads por contactar em cada tarefa e escrevem com nomes reais, sem inventar contactos. **Programmable Search** (`GOOGLE_API_KEY` + `GOOGLE_CSE_ID`) traz informação da web. Sem chave, o escritório diz exatamente o que falta. Rotas: `GET /api/google`, `POST /api/google/search`, `GET /api/leads`, `POST /api/leads/status`. Guia em **PESQUISA.md**.
- **Horas de 24 horas, em todo o lado.** `00:00`–`23:59`, nunca AM/PM: um só módulo (`src/time.js`) formata todas as horas e datas, com `hour12: false` explícito e nomes portugueses escritos à mão; os campos de hora passam a mostrar as 24 horas do dia (`#hours24`) em vez do seletor AM/PM do sistema. Um teste do `check.mjs` falha se voltar a aparecer formatação de 12 horas no bundle.
- **Um caminho real para ligar outra IA.** O escritório deixou de estar preso ao Claude Code: `providers.mjs` traz **Claude Code**, **Codex** (`codex exec`), **Gemini** (`gemini -p`), uma **CLI genérica** — e as APIs **Claude, OpenAI, OpenRouter, Groq, Mistral, DeepSeek, xAI, Gemini, Ollama, LM Studio** e **qualquer endpoint compatível com OpenAI**. A escolha é `AO_AI` → `data/ai.json` → `office.config.json` → `ai.fallback` → presets, com failover quando um não existe. O botão **IA** no painel abre a gaveta dos motores: o que está ligado, o que falta e porquê (em português), **TESTAR** (um turno curto a sério, com o texto e os milissegundos) e **USAR** (troca a quente, sem reiniciar). Rotas novas: `GET /api/ai`, `POST /api/ai/test`, `POST /api/ai/switch`; `/api/health` passa a dizer o motor ativo (`backend` + `ai`). Nada é instalado por nós e só o CLI do Claude dá ferramentas ao agente — os outros devolvem texto, e a UI diz «SÓ TEXTO». Sem motor nenhum, o escritório abre na mesma e o selo diz `SEM MOTOR DE IA`. Guia completo em **AI.md**.
- **Seis salas, um fluxo de trabalho real.** O escritório passa a ser a Órbita a operar de ponta a ponta: **ORBITA COMMAND** (o Director coordena as seis salas, distribui trabalho, deteta atrasos e agentes parados e mantém o painel central), **ORBITA PROSPECT** (o Lead Hunter encontra empresas sem site, diagnostica a presença digital, pontua e deduplica), **ORBITA SALES** (o Sales Closer aborda, responde a objeções, propõe, segue e agenda), **ORBITA DESIGN LAB** (o Creative Architect lê o briefing e entrega estrutura, identidade e design system), **ORBITA ENGINEERING** (o Systems Engineer constrói, integra, testa e publica) e **ORBITA MEDIA** (o Growth Publisher publica, mede e alimenta a prospeção com conteúdo).
- **O Cérebro, em 3D.** O grafo é agora um orbe: cada pasta é um aglomerado na superfície da esfera — o hub no centro do aglomerado, as notas à volta — e as arestas são arcos que abraçam a superfície em vez de mergulharem no centro. Cada hub leva um anel 3D na cor da pasta, inclinado à sua maneira. A lente é uma casca de vidro com orla de Fresnel (só as bordas apanham luz, como uma esfera de vidro a sério), um núcleo luminoso por dentro e um equador ténue — é isso que dá o volume. Há esbatimento por profundidade: o que está atrás perde cor e opacidade, e o orbe roda devagar (uma volta a cada ~62 s), que é o que faz ler a terceira dimensão. Assenta em dois anéis de luz na relva do plinto. Modo escuro com a sua própria paleta.
- **Paredes em cada sala.** Cada sala passou a ser uma sala a sério: um L de parede nos dois lados afastados da câmara — base sólida até à altura da secretária, vidro até acima do monitor, rodapé na cor da sala, remate e montantes na cor de tinta, e o nome da sala gravado na parede. O canto que dá para o Cérebro fica aberto: é a porta, e é por onde chega a passadeira. As paredes são clicáveis (focam a sala) e acompanham o modo escuro.
- **Cada agente tem função, tarefas, ferramentas e resultado.** Os 35 lugares ganharam nome, descrição de funções e ferramentas próprias (`office.agents.json`), uma fila de tarefas com estado (`src/tasks.js`), eventos de atividade e um ficheiro de resultado por agente (`FILE_GEN`). A animação mostra o estado; não substitui a execução.
- **Aprovação humana obrigatória.** Tudo o que sai da máquina — contactos, propostas, publicações, pagamentos, alterações — fica à espera do OK do proprietário, com o pedido escrito agente a agente.
- **Nada se perde na tradução.** Chaves internas mantidas (`emails`, `sales`, `ops`, `fin`, `delivery`, `marketing`); rótulos em português; rotinas aceites em Comando, Prospeção e Vendas; entrevista de configuração e competências seguem o mesmo plantel.

## 3.2.1-beta.2 — 19 Sep 2026

- **Licence.** LICENSE now opens with the Required Notices (Copyright 2026 Sahni.ai; Agents Office is a Sahni.ai product) and Sahni.ai's additional terms: the name and mark stay, no renaming or rebranding, no wiring it into or bundling it with another product, agent system or workforce, and anything else needs written permission. The PolyForm Noncommercial 1.0.0 text below them is unchanged. README says the same in plain English. No change to the office itself.

## 3.2.1-beta.1 — 16 Sep 2026

- **The calendar (P).** Month and week. Finished tasks on the day they finished, today's work on today, tasks scheduled for a date, and every routine projected forward on the days it will fire, one dashed card per run. A rail lists the routines themselves (cadence, agent, next run, paused, waits for your OK); click one to see only its days. Department filters, routines and done toggles, search. Click a card: a finished task opens the agent's chat; a routine run offers RUN NOW / PAUSE / DELETE; a scheduled task can be cancelled.
- **Schedule from a day.** Click any day: what should happen, department, time, model, ADD. Claude names the agent now; the server runs it at that minute, page open or not, LATE (once) if the office was off; it waits for your OK if it would send anything. REPEAT makes it a routine that starts on that date (`when.start`, e.g. `every weekday · 08:00 · from 5 Oct`) — on the grid from that day, never before.
- A **CALENDAR** button in the top bar, beside the approval counter, opens it too.
- **Sahni.ai branding.** The `sahni.ai_` wordmark (Kode Mono, embedded) as a small tile at the bottom-left of the office (out of the top bar; with a department in focus it sits at the top-left of the scene), linking to sahni.ai, and a licence line at the bottom of every view: © 2026 Sahni.ai · PolyForm Noncommercial 1.0.0 · free for personal and internal use · not for resale. Hidden in the website hero embed.
- Scheduled tasks show under the SCHEDULED chip and in the SCHEDULED column with CANCEL. `POST /api/tasks` takes `at`; `routines.json` takes `when.start`. Five more checks, one live (a task scheduled 75 s ahead fires and lands; a routine from a date waits for it).


## 3.2.0-beta.3 — 16 Sep 2026

- beta.2 shipped without `teams.mjs` (the release whitelist had not been told about it) and would not start; beta.3 is the same release with the file in, and the release script now refuses to assemble a build whose `serve.mjs` imports a file it is not shipping.

## 3.2.0-beta.2 — 16 Sep 2026

*Numbering: AJ's call, 16 Sep. This is a new release (Agent Teams + Claude in Chrome), not a patch of the 7 Sep 3.2.0-beta.1 (skills); the tag had to be free, and the 3.3–3.6.1 tags stay where they are.*

- **Agent Teams.** Press TEAM in the bar, or say "as a team" / "spawn three teammates to …", and the department lead takes the task, splits it into two to four independent pieces on the desks whose jobs or skills fit, the pieces run at the same time (one Claude process per desk, own context, brief, skills, lessons and connectors), teammates leave notes for each other and the lead (`@lead: …`, shown as 💬 over the desks), and the lead writes the finished deliverable from the pieces, ending with who did what. Piece cards (↳) sit on the teammates' desks, all IN PROGRESS together; each finished piece lands in that teammate's chat and walks back to the lead. The note in the brain carries the final, every piece, and the notes. `revise: …` reworks the final from the same pieces; APPROVE runs the lead's outbound step alone. `"team": true` on a routine. `teams.max` (default 4) and `teams.enabled` in the config. Built by the office from separate headless Claude sessions, because Claude Code's own agent teams only spawn in an interactive terminal.
- **Claude in Chrome.** Every run starts with `--chrome`; with the extension paired (`claude --chrome` once) the agents get the owner's own browser as a tool — open tabs, read pages, search, fill forms on any site the owner is signed in to. A Chrome tile in the bar, wired to every pod, lit when an agent is in the browser; grey with the fix on hover when the extension is not paired. Same rule as every connector: read freely, act on a site only when the task asks for that exact action; a login or CAPTCHA stops the agent. `tools.browser: false` (or `deny: ["Chrome"]`) keeps them out.
- Seven more checks (team intent, plan checking, notes, team routines, the browser flags and prompt, config defaults, the Chrome tile in `/api/mcp`), and two live ones: a real team task with two or more desks, and an agent reading a page in Chrome.


## 3.6.1-beta.1 — 9 Sep 2026

- **A bigger task box.** The bar is two rows now: the department and the text on top, the model menu, REPEAT and ADD underneath, so the text runs the width of the panel. The box grows as you type, up to six lines, then scrolls. Enter adds; Shift+Enter is a new line.
- **Effort, by name.** An EFFORT menu beside the model: AUTO, Low, Medium, High, Extra high, Max, the levels Claude Code uses. AUTO is the model's own (Opus runs at high). Set it on the task, the routine, the agent (`effort` in the roster) or the office (`effort` in the config), same precedence as the model; every card shows it beside the model name and the note records `effort:`.
- **The big editor.** The ⤢ button inside the box (or ⌘⇧E) opens the same task in a large window with room for a whole brief. It shows the department and the same hint line, ⌘↵ adds, Esc closes, and whatever you type there is in the bar when you close it.

## 3.6.0-beta.1 — 9 Sep 2026

- **Three models, by name.** Sonnet, Opus, Fable. Sonnet is the default for everything, including the routing call. A menu beside REPEAT sets the model for the task you are typing or the routine you are setting; agents take a `model` in the roster; the office default is `model` in the config. The task beats the routine beats the agent beats the office, and every card says which ran and where it was set. Opus runs at effort high; nobody sees an effort setting. Until now every run inherited the login's default model.
- **The usage gauge.** The top bar shows your Claude plan the way Claude Code's usage screen does: session and week, bar and percentage, reset times on hover, amber past 75 and red past 90. Read with the login token Claude Code keeps on this machine, sent only to Anthropic's usage endpoint, never stored. When that endpoint does not answer, the office's own count for the current five-hour window shows instead. No dollars anywhere. A live office shows Claude alone in RUNS HEADLESS ON.
- Three checks: the model table and precedence, the gauge parser and window count, and (live) a task set to Opus running on Opus.

## 3.5.0-beta.1 — 9 Sep 2026

- **Routines: the office runs on its own clock.** A task the office does by itself on a timetable — every weekday at 08:00, every Monday, every hour. Emails, Accounting and Sales in this release; the other departments say "later release" if you try.
- **Three ways to set one.** Type it in the bar with the time in the sentence ("every weekday at 8am, triage the inbox…") and the hint reads the schedule back before you press Add, or press REPEAT and pick a cadence and a time; tell a department lead in chat ("routines", "pause …", "run … now", "delete …" work too); or ask Claude Code, which writes `<brain>/Agents Office/routines.json` (`CLAUDE.md` says how).
- **Where they show.** A SCHEDULED chip in the Task Status panel with a countdown and RUN NOW / PAUSE / DELETE on every routine, a next-up line under the chips, a SCHEDULED column on the company board, a clock chip on the agent's name pill and a routines strip at the top of their chat.
- **The clock lives in the server.** `npm start` fires routines and runs them whether or not the page is open; the page polls and shows the card move. A run missed while the machine slept is caught up once when it comes back, marked LATE.
- **"Needs my OK" is real.** A routine that would send, pay or change anything prepares everything and waits in WAITING ON APPROVAL — the draft in the chat, the agent standing and waving. APPROVE and the agent does the outbound step with its tools; REJECT, say what should change, and it comes back reworked (and the correction is remembered). Read-only routines go straight to DONE. Per-routine switch.
- A live office no longer invents approvals: the theatre asks that used to make a random agent stand and wave are demo-only now, so WAITING ON APPROVAL means a real draft. Real work never waits behind theatre either: a task or routine of yours starts the moment it lands, and the demo job that desk was on is finished.
- Quieter at rest. A live office shows only real reads and writes on the Brain (no theatre glints, no six-second pulse), and the connector loom in the overview runs at about half the ink and half the crawl. Inside a department nothing changed.
- Seven more connector logos: Slack, Google Calendar, Google Drive, Webflow, Playwright, Higgsfield, TerriTool. Anything else still gets an initials tile.
- Routine notes carry `routine:` (and `approved:`) in their front matter. `npm run check` gains six checks: the schedule parser, refusals, the clock and catch-up, the demo bar flow, the API, and (live) a two-minute routine firing end to end.

## 3.4.0-beta.1 — 7 Sep 2026

- Every department now has a lead. Marketing Lead and Operations Lead join at the head of their pods (35 agents). Each runs their team, owns the department's set-up interview, and is where a task lands when Claude cannot pick a specialist.

## 3.3.0-beta.2 — 7 Sep 2026

- The built office page moved from the repo root to `dist/command-centre-v2.html`. Same file, same double-click demo, cleaner repo page. `build.mjs`, `npm start` and the checks all point there.

## 3.3.0-beta.1 — 7 Sep 2026

- **The lead interviews you.** Say "set up" to a department lead. Five questions, one at a time; then it writes a brief for each agent on its team and a skill for the job you described, into your brain, and tells you what it wrote and one task to try. "skip", "done", "cancel". A lead whose department has nothing of yours yet offers this in its greeting.
- **They learn from your corrections.** Every `revise: …` is recorded in `<brain>/Agents Office/feedback/<agent>.md`; Claude sorts it into a one-off or a standing rule, and standing rules go into that agent's prompt from then on. Plain Markdown, yours to edit. `/api/lessons` shows them.
- Roster, skills and lessons are re-read before every task and chat, so a brief no longer needs a restart.
- `/api/health` carries which departments are set up; the boot line says so too.

## 3.2.0-beta.1 — 7 Sep 2026

- **Skills: teach an agent how a kind of work is done.** A folder in your brain, `<brain>/Agents Office/skills/<name>/`, with a `SKILL.md` (when it applies, the steps, the shape, the rules) and the template or example beside it, bound to agents or departments in its front matter. Read in full before every task and chat turn for those agents; the deliverable names the skill it followed and the saved note records it. Re-read from disk on every task, so no restart. Three examples ship in `skills/`. Guide: `SKILLS.md`.
- **Briefs.** A `brief` field on any agent in the roster: standing instructions, up to 2,000 characters, read before every task and chat turn.
- **The roster can live in the brain.** `<brain>/Agents Office/agents.json` is read between the shipped roster and the local file.
- The router sees each agent's skills, so a task that names a kind of work lands on the agent who owns that skill.
- `CLAUDE.md` tells Claude Code how to turn an SOP, a template or a good example into a skill and where to write it. `npm run check` validates skills; `/api/skills` lists what is loaded.
- The shipped roster no longer names anyone: "the owner" throughout.

## 3.1.0-beta.3 — 7 Sep 2026

- One HTML file. The separate dark build is gone; `D` and http://localhost:4520/dark open the same file in dark mode.

## 3.1.0-beta.2 — 7 Sep 2026

- The Brain graph header names your business (it was hard-coded to one company).

## 3.1.0-beta.1 — 7 Sep 2026

- **Connectors are real.** The top bar shows the MCP servers your Claude Code is connected to (`claude mcp list`), not a demo list. Servers that need authentication show grey with the reason on hover and are not wired to any pod. Unknown servers get an initials tile. Nothing connected? The bar says so.
- **Agents use tools.** While they work, agents can call those same connected servers, plus web search (`tools.web`). Bash, file tools and sub-agents stay off. Standing rule: read freely; send, post, pay, delete or change data outside the machine only when the task explicitly asks for that exact action. A deliverable says which tools it used, the note records them, and the logos pulse with the real call.
- **The roster is yours.** `office.agents.json` holds the 33 agents: name, role, what they do, their tools. Override in `office.agents.local.json` (ignored by git). Departments, leads and seats stay fixed. A `CLAUDE.md` in the repo means you can open Claude Code in the folder and say what you want changed.
- `office.config.json` grew `mcp.allow` / `mcp.deny` / `mcp.departments` and `tools.web`; `timeout` (seconds) for long tool runs.
- Live chat now opens with the agent's real job description instead of the demo greeting and sample file.
- `npm run check` validates the roster and the connector endpoint.

## 3.0.0-beta.4 — 6 Sep 2026

- Dark mode: press D, add `#dark=1`, open `command-centre-v2-dark.html`, or visit http://localhost:4520/dark. The scene relights, pods and walkways re-tint, the Brain and wires swap ink.

## 3.0.0-beta.3 — 6 Sep 2026

- No more "demo" label: the panel shows LIVE · CLAUDE when the server is connected and nothing otherwise.

## 3.0.0-beta.2 — 6 Sep 2026

- The Brain strip is gone from the task panel. Open the Brain with G, by clicking the pod, or by its tag.

## 3.0.0-beta.1 — 6 Sep 2026

Agents Office v3 (Beta): the V3 office as a real, installable app.

- Six departments, 33 agents, each with a role, a voice and a task pool.
- Task Status panel with a command bar: type a task, pick the department, the office routes it to the right agent through Claude and the agent produces the deliverable, saved as a note in your brain folder.
- The Brain is your own folder of Markdown notes with `[[wiki links]]`, drawn as a graph over the centre pod, rebuilt live as agents write. `G` opens the full graph with search and a note preview.
- Chat with any agent: real conversation in that agent's persona, grounded in your notes. `revise: …` reworks the last deliverable.
- Runs on your existing Claude Code login, or on an API key if you set one. Nothing leaves your machine except the calls to Claude.
- `npm run check` — the build loop: build, offline smoke, server smoke; `npm run check:live` adds one real task and one chat turn.


## 0.1.0 — 7 Aug 2026

First public release: daemon-based office with inboxes, approvals and an outbox.
