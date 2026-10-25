// v1 data extracted VERBATIM from command-centre.html (lines 646-666, 671-1095, 2176, 2975-3021).
import { applyV1 } from './profile.js';
// Do not hand-edit agent content here — it is the single source of truth shared with v1.
export const clockStr = () => new Date().toLocaleTimeString("pt-PT",{hour:"2-digit",minute:"2-digit",hour12:false}); // 24 horas
export const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-");
export const P = {
  first:['Sarah','Mike','Priya','Tom','Aroha','Ben','Chloe','Dev','Emma','Finn','Grace','Hemi','Isla','Jake','Kiri','Liam','Mia','Nikau','Olivia','Pete','Ruby','Sam','Tane','Zoe','Harper','Josh','Nina','Ravi','Sofia','Callum'],
  last:['Walker','Patel','Thompson','Ngata','Chen','Murphy','Kaur','Wilson','Fraser','Hohepa','Brooks','Sharma','Reid','Tui','Marsh','Oduya','King','Parata','Lowe','Baxter'],
  co:['Harbour City Roofing','Southern Cross Fitness','Kea Logistics','Fern & Field Landscaping','Ridgeline Property Group','BlueWater Marine','Totara Legal','Summit HVAC','GoldCoast Solar','Pounamu Recruitment','Marlborough Wines Direct','UrbanNest Realty','Silver Fern Security','Bay Plumbing Co','Crestline Finance','Mako Digital','Kauri Dental Group','Westhaven Charters','Alpine Freight','Nectar Foods'],
  plan:['Starter','Growth','Scale','Enterprise'],
  competitor:['CallForge','RingPilot','Quotient CRM','DialAxis','Velora'],
  city:['Auckland','Wellington','Christchurch','Sydney','Melbourne','Brisbane','Hamilton','Tauranga','Perth','Dunedin'],
};
export const rnd = a => a[Math.floor(Math.random()*a.length)];
export const ri = (a,b) => a + Math.floor(Math.random()*(b-a+1));
export const person = () => rnd(P.first)+' '+rnd(P.last);
export const money = n => '$'+n.toLocaleString('en-NZ');
/* ---------- KPIs ---------- */
export const KPIS = [
  { id:'tarefas',     label:'TAREFAS CONCLUÍDAS',     val:128, fmt:v=>Math.round(v) },
  { id:'leads',       label:'LEADS QUALIFICADOS',     val:47,  fmt:v=>Math.round(v) },
  { id:'sites',       label:'SITES DIAGNOSTICADOS',   val:31,  fmt:v=>Math.round(v) },
  { id:'propostas',   label:'PROPOSTAS ENVIADAS',     val:6,   fmt:v=>Math.round(v) },
  { id:'ecras',       label:'ECRÃS DESENHADOS',       val:23,  fmt:v=>Math.round(v) },
  { id:'projetos',    label:'PROJETOS NO AR',         val:9,   fmt:v=>Math.round(v) },
  { id:'publicacoes', label:'PUBLICAÇÕES APROVADAS',  val:14,  fmt:v=>Math.round(v) },
];
export const V1 = [
/* ============ (Customer Support retired 5 Sep 2026 — see EMAILS below) ============ */
/* ============ SALES ============ */
{ id:'enzo', name:'ENRIQUECEDOR', dept:'sales', desk:[17,3], sit:[17,4], hair:'#1c1c2e', shirt:'#fbbf24',
  role:'Dados de contacto e enriquecimento',
  tagline:'Completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar.',
  tasks:['A varrer o Google Maps à procura de empresas sem site','A analisar a presença digital de 20 empresas','A enriquecer os contactos do lote de hoje','A pontuar leads novos face ao ICP','A remover duplicados da lista'],
  ev:[
    {i:'📋', t:()=>`Enriquecer ${ri(8,40)} registos com decisor e e-mail — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Verificar os telemóveis do lote de hoje — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Preencher a dimensão de 12 empresas — à espera do OK do proprietário`, p:2, kpi:{id:'leads',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Vendas — verificar os telemóveis do lote de hoje`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: dados de contacto e enriquecimento — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: fullenrich, apollo — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Leads enriquecidos — últimos 7 dias', chart:[52,61,48,67,55,23,47],
  greeting:`Bom dia. Sou ENRIQUECEDOR, na sala Prospeção. O meu trabalho: completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar. Neste momento: enriquecer ${ri(8,40)} registos com decisor e e-mail; verificar os telemóveis do lote de hoje.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'lexi', name:'CALENDÁRIO EDITORIAL', dept:'marketing', desk:[20,3], sit:[20,4], hair:'#5a2d0c', shirt:'#f59e0b', 
  role:'Planeamento de publicações',
  tagline:'Mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado.',
  tasks:['A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn','A analisar alcance e leads gerados','A otimizar as campanhas pagas','A preparar o calendário editorial da semana'],
  ev:[
    {i:'📋', t:()=>`Atualizar a fila de aprovações — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Resolver 2 conflitos de canal — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Marcar o que está bloqueado — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — resolver 2 conflitos de canal`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: planeamento de publicações — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, googlecalendar — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Horas de chamada em fila para os comerciais — últimos 7 dias', chart:[11,12,10,12,11,4,9],
  greeting:`Bom dia. Sou CALENDÁRIO EDITORIAL, na sala Media. O meu trabalho: mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado. Neste momento: atualizar a fila de aprovações; resolver 2 conflitos de canal.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'ona', name:'RECEÇÃO DE CLIENTES', dept:'ops', desk:[17,6], sit:[17,7], hair:'#0d0d0d', shirt:'#fcd34d',
  role:'Onboarding e relação inicial',
  tagline:'Acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia.',
  tasks:['A preparar a abordagem para 6 leads quentes','A responder a propostas em aberto','A marcar reuniões com decisores','A seguir 8 conversas paradas','A fechar a proposta da Kea Logistics'],
  ev:[
    {i:'📋', t:()=>`Arranque da ${rnd(P.co)}: acessos e expectativas — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Lista de integração da ${rnd(P.co)} — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Apresentar o primeiro relatório à ${rnd(P.co)} — à espera do OK do proprietário`, p:2, kpi:{id:'propostas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — lista de integração da ${rnd(P.co)}`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: onboarding e relação inicial — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: imessage, gmail — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Utilizadores integrados — últimos 7 dias', chart:[3,4,2,5,3,1,3],
  greeting:`Bom dia. Sou RECEÇÃO DE CLIENTES, na sala Vendas. O meu trabalho: acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia. Neste momento: arranque da ${rnd(P.co)}: acessos e expectativas; lista de integração da ${rnd(P.co)}.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'pros', name:'LEAD HUNTER', dept:'sales', lead:true, desk:[20,6], sit:[20,7], hair:'#2a1a0e', shirt:'#eab308',
  role:'Prospeção e qualificação de empresas',
  tagline:'Procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade.',
  tasks:['A enriquecer os contactos do lote de hoje','A pontuar leads novos face ao ICP','A remover duplicados da lista','A entregar a lista qualificada ao Sales Closer','A varrer o Google Maps à procura de empresas sem site'],
  ev:[
    {i:'📋', t:()=>`Varrer o Google Maps: 60 empresas sem site em um setor — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Pontuar 40 empresas face ao ICP — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Remover duplicados da lista de ${ri(8,40)} leads — à espera do OK do proprietário`, p:2, kpi:{id:'leads',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Vendas — pontuar 40 empresas face ao ICP`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: prospeção e qualificação de empresas — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: territool, apollo, chrome — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Potenciais clientes obtidos — últimos 7 dias', chart:[38,45,41,52,44,18,36],
  greeting:`Bom dia. Sou LEAD HUNTER, na sala Prospeção. O meu trabalho: procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade. Neste momento: varrer o Google Maps: 60 empresas sem site em um setor; pontuar 40 empresas face ao ICP.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'folo', name:'SEGUIMENTOS', dept:'ops', desk:[20,9], sit:[20,10], hair:'#171717', shirt:'#fcd34d',
  role:'Segundo contacto e reativação',
  tagline:'Retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados.',
  tasks:['A preparar a abordagem para 6 leads quentes','A responder a propostas em aberto','A marcar reuniões com decisores','A seguir 8 conversas paradas','A fechar a proposta da Kea Logistics'],
  ev:[
    {i:'📋', t:()=>`Retomar ${ri(8,40)} propostas sem resposta — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Segundo contacto para 8 leads frios — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Reativar quem testou e não avançou — à espera do OK do proprietário`, p:2, kpi:{id:'propostas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — segundo contacto para 8 leads frios`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: segundo contacto e reativação — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: gmail, imessage — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Negócios reativados — últimos 7 dias', chart:[2,3,1,4,2,0,2],
  greeting:`Bom dia. Sou SEGUIMENTOS, na sala Vendas. O meu trabalho: retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados. Neste momento: retomar ${ri(8,40)} propostas sem resposta; segundo contacto para 8 leads frios.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ MARKETING ============ */
{ id:'riley', name:'INTELIGÊNCIA DE MERCADO', dept:'sales', desk:[4,12], sit:[4,13], hair:'#8a4a1f', shirt:'#f472b6',
  role:'Pesquisa de mercado e tendências',
  tagline:'Faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte.',
  tasks:['A pontuar leads novos face ao ICP','A remover duplicados da lista','A entregar a lista qualificada ao Sales Closer','A varrer o Google Maps à procura de empresas sem site','A analisar a presença digital de 20 empresas'],
  ev:[
    {i:'📋', t:()=>`Varrimento diário de 47 fontes — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Extrair 3 tendências, com fonte — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Nota de mercado para o Sales Closer — à espera do OK do proprietário`, p:2, kpi:{id:'leads',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Vendas — extrair 3 tendências, com fonte`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: pesquisa de mercado e tendências — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: chrome, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Itens assinalados — últimos 7 dias', chart:[4,2,3,5,3,1,3],
  greeting:`Bom dia. Sou INTELIGÊNCIA DE MERCADO, na sala Prospeção. O meu trabalho: faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte. Neste momento: varrimento diário de 47 fontes; extrair 3 tendências, com fonte.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'newt', name:'CONTEÚDO E NEWSLETTER', dept:'marketing', desk:[7,12], sit:[7,13], hair:'#26140a', shirt:'#ec4899',
  role:'Texto, casos de estudo e newsletter',
  tagline:'Escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita.',
  tasks:['A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn','A analisar alcance e leads gerados','A otimizar as campanhas pagas','A preparar o calendário editorial da semana'],
  ev:[
    {i:'📋', t:()=>`Newsletter mensal: caso de estudo — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Legenda para o vídeo da ${rnd(P.co)} — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Escrever o caso de estudo com números reais — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — legenda para o vídeo da ${rnd(P.co)}`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: texto, casos de estudo e newsletter — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: beehiiv, loops — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Taxa de abertura % — últimas 6 edições', chart:[31,34,38,36,41,43],
  greeting:`Bom dia. Sou CONTEÚDO E NEWSLETTER, na sala Media. O meu trabalho: escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita. Neste momento: newsletter mensal: caso de estudo; legenda para o vídeo da ${rnd(P.co)}.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'ada', name:'ANÚNCIOS META', dept:'marketing', desk:[4,15], sit:[4,16], hair:'#101020', shirt:'#f9a8d4',
  role:'Publicidade paga',
  tagline:'Corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir.',
  tasks:['A preparar o calendário editorial da semana','A escrever o caso de estudo do último projeto','A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn','A analisar alcance e leads gerados'],
  ev:[
    {i:'📋', t:()=>`Renovar o conjunto de anúncios saturado — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Lançar 4 variantes do anúncio de um setor — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Relatório de CPA e do que aprendemos — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — lançar 4 variantes do anúncio de um setor`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: publicidade paga — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: meta — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'CPA $ — últimos 7 dias', chart:[52,48,45,49,43,40,41],
  greeting:`Bom dia. Sou ANÚNCIOS META, na sala Media. O meu trabalho: corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir. Neste momento: renovar o conjunto de anúncios saturado; lançar 4 variantes do anúncio de um setor.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'iggy', name:'REDES SOCIAIS', dept:'marketing', desk:[6,15], sit:[6,16], hair:'#1a1026', shirt:'#fb7185',
  role:'Instagram, LinkedIn e comunidade',
  tagline:'Prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa.',
  tasks:['A preparar o calendário editorial da semana','A escrever o caso de estudo do último projeto','A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn','A analisar alcance e leads gerados'],
  ev:[
    {i:'📋', t:()=>`Agendar 3 publicações no Instagram — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Responder a 14 mensagens diretas — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Preparar a publicação de LinkedIn da ${rnd(P.co)} — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — responder a 14 mensagens diretas`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: instagram, linkedin e comunidade — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: meta, canva — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Taxa de interação % — últimas 7 publicações', chart:[3.2,4.1,3.8,5.6,4.4,6.2,5.1],
  greeting:`Bom dia. Sou REDES SOCIAIS, na sala Media. O meu trabalho: prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa. Neste momento: agendar 3 publicações no Instagram; responder a 14 mensagens diretas.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'vid', name:'VÍDEO', dept:'marketing', desk:[3,15], sit:[3,16], hair:'#1b1b24', shirt:'#93c5fd',
  role:'Vídeos, demonstrações e cortes',
  tagline:'Produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal.',
  tasks:['A otimizar as campanhas pagas','A preparar o calendário editorial da semana','A escrever o caso de estudo do último projeto','A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn'],
  ev:[
    {i:'📋', t:()=>`Vídeo de demonstração do projeto ${rnd(P.co)} — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Cortes de 15 s com legendas — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Exportar em 9:16 e 1:1 — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — cortes de 15 s com legendas`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: vídeos, demonstrações e cortes — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: hyperframes — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Cortes entregues — últimos 7 dias', chart:[1,2,1,3,2,1,2],
  greeting:`Bom dia. Sou VÍDEO, na sala Media. O meu trabalho: produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal. Neste momento: vídeo de demonstração do projeto ${rnd(P.co)}; cortes de 15 s com legendas.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'gfx', name:'CREATIVE ARCHITECT', dept:'fin', lead:true, desk:[1,15], sit:[1,16], hair:'#0e0e16', shirt:'#f0abfc',
  role:'Estratégia digital, UX/UI e direção de arte',
  tagline:'Lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável.',
  tasks:['A desenhar a landing page de ${rnd(P.co)}','A preparar mockups para a apresentação','A escrever os textos de interface','A validar o fluxo de contacto com dados de uso','A entregar as especificações à Engenharia'],
  ev:[
    {i:'📋', t:()=>`Briefing da ${rnd(P.co)}: problema, público e ação — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Definir a estrutura e a navegação do site novo — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Fechar o design system do projeto ${rnd(P.co)} — à espera do OK do proprietário`, p:2, kpi:{id:'ecras',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — definir a estrutura e a navegação do site novo`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: estratégia digital, ux/ui e direção de arte — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: canva, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Recursos entregues — últimos 7 dias', chart:[2,3,2,4,3,1,2],
  greeting:`Bom dia. Sou CREATIVE ARCHITECT, na sala Design Lab. O meu trabalho: lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável. Neste momento: briefing da ${rnd(P.co)}: problema, público e ação; definir a estrutura e a navegação do site novo.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ OPERATIONS ============ */
{ id:'piper', name:'PROPOSTAS', dept:'ops', desk:[15,12], sit:[15,13], hair:'#3a1d08', shirt:'#60a5fa',
  role:'Propostas comerciais',
  tagline:'Escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos.',
  tasks:['A fechar a proposta da Kea Logistics','A registar o motivo dos negócios perdidos','A preparar a abordagem para 6 leads quentes','A responder a propostas em aberto','A marcar reuniões com decisores'],
  ev:[
    {i:'📋', t:()=>`Proposta para a ${rnd(P.co)}, três opções — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Atualizar o preçário de manutenção — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Reescrever o âmbito da ${rnd(P.co)} após a reunião — à espera do OK do proprietário`, p:2, kpi:{id:'propostas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — atualizar o preçário de manutenção`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: propostas comerciais — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: pandadoc, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Propostas enviadas — últimos 7 dias', chart:[2,3,1,4,2,0,2],
  greeting:`Bom dia. Sou PROPOSTAS, na sala Vendas. O meu trabalho: escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos. Neste momento: proposta para a ${rnd(P.co)}, três opções; atualizar o preçário de manutenção.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'scout', name:'ANÁLISE COMPETITIVA', dept:'sales', desk:[18,12], sit:[18,13], hair:'#141414', shirt:'#93c5fd',
  role:'Concorrentes e posicionamento',
  tagline:'Acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados.',
  tasks:['A varrer o Google Maps à procura de empresas sem site','A analisar a presença digital de 20 empresas','A enriquecer os contactos do lote de hoje','A pontuar leads novos face ao ICP','A remover duplicados da lista'],
  ev:[
    {i:'📋', t:()=>`Comparar os preços dos 3 estúdios rivais — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Memorando: subida de preços do concorrente — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Atualizar os argumentos de venda com 2 factos — à espera do OK do proprietário`, p:2, kpi:{id:'leads',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Vendas — memorando: subida de preços do concorrente`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: concorrentes e posicionamento — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: chrome, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Movimentos da concorrência avaliados — últimos 7 dias', chart:[1,2,0,2,1,0,1],
  greeting:`Bom dia. Sou ANÁLISE COMPETITIVA, na sala Prospeção. O meu trabalho: acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados. Neste momento: comparar os preços dos 3 estúdios rivais; memorando: subida de preços do concorrente.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'legal', name:'CONTRATOS', dept:'ops', desk:[15,15], sit:[15,16], hair:'#20242e', shirt:'#a78bfa',
  role:'Revisão de contratos e termos',
  tagline:'Lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco.',
  tasks:['A responder a propostas em aberto','A marcar reuniões com decisores','A seguir 8 conversas paradas','A fechar a proposta da Kea Logistics','A registar o motivo dos negócios perdidos'],
  ev:[
    {i:'📋', t:()=>`Rever o contrato da ${rnd(P.co)}, 2 cláusulas — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Verificar os termos da proposta aceite — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Política de privacidade, revisão anual — à espera do OK do proprietário`, p:2, kpi:{id:'propostas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — verificar os termos da proposta aceite`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: revisão de contratos e termos — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: pandadoc, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Contratos revistos — últimos 7 dias', chart:[3,2,4,1,3,0,2],
  greeting:`Bom dia. Sou CONTRATOS, na sala Vendas. O meu trabalho: lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco. Neste momento: rever o contrato da ${rnd(P.co)}, 2 cláusulas; verificar os termos da proposta aceite.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'comply', name:'PERMISSÕES E CONFORMIDADE', dept:'emails', desk:[18,15], sit:[18,16], hair:'#5a3a1a', shirt:'#c4b5fd',
  role:'Aprovações, consentimento e RGPD',
  tagline:'Verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação.',
  tasks:['A rever as prioridades do dia com as seis salas','A assinalar tarefas atrasadas e agentes parados','A atualizar o painel central da empresa','A fechar o resumo de resultados da semana','A confirmar as aprovações à espera do proprietário'],
  ev:[
    {i:'📋', t:()=>`Auditar o consentimento dos formulários — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Confirmar a aprovação antes de 2 envios — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Revisar a lista de contactos com consentimento — à espera do OK do proprietário`, p:2, kpi:{id:'tarefas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — confirmar a aprovação antes de 2 envios`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: aprovações, consentimento e rgpd — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, gmail — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Alterações reais detetadas — últimos 7 dias', chart:[1,0,2,1,0,0,1],
  greeting:`Bom dia. Sou PERMISSÕES E CONFORMIDADE, na sala Comando. O meu trabalho: verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação. Neste momento: auditar o consentimento dos formulários; confirmar a aprovação antes de 2 envios.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'report', name:'ANALISTA DE RESULTADOS', dept:'emails', desk:[21,15], sit:[21,16], hair:'#2e2118', shirt:'#8b5cf6',
  role:'Relatórios de estado e desempenho',
  tagline:'Escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou.',
  tasks:['A atualizar o painel central da empresa','A fechar o resumo de resultados da semana','A confirmar as aprovações à espera do proprietário','A distribuir o trabalho novo pelas salas','A rever as prioridades do dia com as seis salas'],
  ev:[
    {i:'📋', t:()=>`Relatório semanal: vendas, leads e projetos — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Consolidar os números do mês no Cérebro — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Comparar a produtividade das seis salas — à espera do OK do proprietário`, p:2, kpi:{id:'tarefas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — consolidar os números do mês no Cérebro`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: relatórios de estado e desempenho — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, clarity — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Relatórios e atualizações entregues — últimos 7 dias', chart:[6,7,5,8,6,2,4],
  greeting:`Bom dia. Sou ANALISTA DE RESULTADOS, na sala Comando. O meu trabalho: escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou. Neste momento: relatório semanal: vendas, leads e projetos; consolidar os números do mês no Cérebro.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ FINANCE — ACCOUNTING TEAM ============ */
{ id:'alead', name:'DIREÇÃO DE ARTE', dept:'fin', desk:[21,12], sit:[21,13], hair:'#1f1f1f', shirt:'#60a5fa', 
  role:'Imagem, mockups e identidade',
  tagline:'Cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita.',
  tasks:['A entregar as especificações à Engenharia','A definir a estrutura e o design system do novo site','A desenhar a landing page de ${rnd(P.co)}','A preparar mockups para a apresentação','A escrever os textos de interface'],
  ev:[
    {i:'📋', t:()=>`Mockups do site da ${rnd(P.co)} para apresentação — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Capa e peças do caso de estudo — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Três conceitos visuais para a ${rnd(P.co)} — à espera do OK do proprietário`, p:2, kpi:{id:'ecras',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — capa e peças do caso de estudo`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: imagem, mockups e identidade — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: canva, higgsfield — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Exceções apanhadas — últimos 7 dias', chart:[2,1,3,1,2,0,1],
  greeting:`Bom dia. Sou DIREÇÃO DE ARTE, na sala Design Lab. O meu trabalho: cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita. Neste momento: mockups do site da ${rnd(P.co)} para apresentação; capa e peças do caso de estudo.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'invo', name:'PESQUISA UX', dept:'fin', desk:[17,15], sit:[17,16], hair:'#4a2c14', shirt:'#7ab8f7',
  role:'Pesquisa, fluxos e validação',
  tagline:'Mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas.',
  tasks:['A definir a estrutura e o design system do novo site','A desenhar a landing page de ${rnd(P.co)}','A preparar mockups para a apresentação','A escrever os textos de interface','A validar o fluxo de contacto com dados de uso'],
  ev:[
    {i:'📋', t:()=>`Mapear o percurso de contacto do site — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Escrever os textos de interface — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Validar o fluxo com 40 sessões gravadas — à espera do OK do proprietário`, p:2, kpi:{id:'ecras',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — escrever os textos de interface`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: pesquisa, fluxos e validação — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, clarity — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Faturas emitidas — últimos 7 dias', chart:[7,9,6,11,8,2,5],
  greeting:`Bom dia. Sou PESQUISA UX, na sala Design Lab. O meu trabalho: mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas. Neste momento: mapear o percurso de contacto do site; escrever os textos de interface.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'apay', name:'DEPLOYS E INFRA', dept:'delivery', desk:[20,15], sit:[20,16], hair:'#111', shirt:'#4d94e8',
  role:'Publicação, domínios e manutenção',
  tagline:'Publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar.',
  tasks:['A ligar o formulário ao CRM','A testar responsividade e velocidade','A corrigir erros da última entrega','A publicar o site no domínio do cliente','A escrever a documentação técnica'],
  ev:[
    {i:'📋', t:()=>`Publicar o site da ${rnd(P.co)} no domínio — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Configurar a cópia de segurança semanal — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Verificar certificado e monitorização — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — configurar a cópia de segurança semanal`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: publicação, domínios e manutenção — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: webflow, chrome — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Movimentos auditados — últimos 7 dias', chart:[3,4,2,5,3,0,2],
  greeting:`Bom dia. Sou DEPLOYS E INFRA, na sala Engenharia. O meu trabalho: publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar. Neste momento: publicar o site da ${rnd(P.co)} no domínio; configurar a cópia de segurança semanal.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'recon', name:'ANALYTICS DE CONTEÚDO', dept:'marketing', desk:[23,15], sit:[23,16], hair:'#3a2a1a', shirt:'#a5cdf7',
  role:'Alcance, tráfego e leads',
  tagline:'Mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe.',
  tasks:['A escrever o caso de estudo do último projeto','A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn','A analisar alcance e leads gerados','A otimizar as campanhas pagas'],
  ev:[
    {i:'📋', t:()=>`Alcance e leads por publicação — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Ligar 12 leads à peça que os trouxe — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Comparar com o mês anterior — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — ligar 12 leads à peça que os trouxe`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: alcance, tráfego e leads — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: clarity, meta — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Transações conciliadas — últimos 7 dias', chart:[22,18,25,19,24,6,14],
  greeting:`Bom dia. Sou ANALYTICS DE CONTEÚDO, na sala Media. O meu trabalho: mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe. Neste momento: alcance e leads por publicação; ligar 12 leads à peça que os trouxe.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ EMAILS (V3.1, 5 Sep 2026 — replaced Customer Support) ============ */
{ id:'elead', name:'ORBITA DIRECTOR', dept:'emails', desk:[7,6], sit:[7,7], hair:'#2b2b2b', shirt:'#2dd4bf', lead:true,
  role:'Direção e coordenação de agentes',
  tagline:'Coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa.',
  tasks:['A fechar o resumo de resultados da semana','A confirmar as aprovações à espera do proprietário','A distribuir o trabalho novo pelas salas','A rever as prioridades do dia com as seis salas','A assinalar tarefas atrasadas e agentes parados'],
  ev:[
    {i:'📋', t:()=>`Rever as prioridades do dia com as seis salas — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Assinalar 3 tarefas atrasadas e reagendar — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Fechar o relatório de estado da empresa — à espera do OK do proprietário`, p:2, kpi:{id:'tarefas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — assinalar 3 tarefas atrasadas e reagendar`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: direção e coordenação de agentes — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, googlecalendar, slack — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'E-mails tratados — últimos 7 dias', chart:[118,131,96,142,127,88,121],
  greeting:`Bom dia. Sou ORBITA DIRECTOR, na sala Comando. O meu trabalho: coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa. Neste momento: rever as prioridades do dia com as seis salas; assinalar 3 tarefas atrasadas e reagendar.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'cmail', name:'COMUNICAÇÃO COM CLIENTES', dept:'ops', desk:[4,3], sit:[4,4], hair:'#3b2b1d', shirt:'#2dd4bf',
  role:'E-mail de clientes',
  tagline:'Responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta.',
  tasks:['A marcar reuniões com decisores','A seguir 8 conversas paradas','A fechar a proposta da Kea Logistics','A registar o motivo dos negócios perdidos','A preparar a abordagem para 6 leads quentes'],
  ev:[
    {i:'📋', t:()=>`Responder aos 9 e-mails de clientes da noite — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Explicar o prazo novo à ${rnd(P.co)} — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Enviar o resumo de arranque à ${rnd(P.co)} — à espera do OK do proprietário`, p:2, kpi:{id:'propostas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — explicar o prazo novo à ${rnd(P.co)}`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: e-mail de clientes — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: gmail, slack — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'E-mails de clientes respondidos — últimos 7 dias', chart:[31,28,36,24,39,22,30],
  greeting:`Bom dia. Sou COMUNICAÇÃO COM CLIENTES, na sala Vendas. O meu trabalho: responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta. Neste momento: responder aos 9 e-mails de clientes da noite; explicar o prazo novo à ${rnd(P.co)}.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'imail', name:'CHEFE DE GABINETE', dept:'emails', desk:[7,3], sit:[7,4], hair:'#111', shirt:'#14b8a6',
  role:'Coordenação de tarefas e prioridades',
  tagline:'Transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo.',
  tasks:['A atualizar o painel central da empresa','A fechar o resumo de resultados da semana','A confirmar as aprovações à espera do proprietário','A distribuir o trabalho novo pelas salas','A rever as prioridades do dia com as seis salas'],
  ev:[
    {i:'📋', t:()=>`Transformar 6 pedidos em tarefas com dono e prazo — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Atualizar a lista de tarefas paradas — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Marcar as revisões semanais no calendário — à espera do OK do proprietário`, p:2, kpi:{id:'tarefas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — atualizar a lista de tarefas paradas`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: coordenação de tarefas e prioridades — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, slack, googlecalendar — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'E-mails internos triados — últimos 7 dias', chart:[42,38,51,29,46,18,40],
  greeting:`Bom dia. Sou CHEFE DE GABINETE, na sala Comando. O meu trabalho: transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo. Neste momento: transformar 6 pedidos em tarefas com dono e prazo; atualizar a lista de tarefas paradas.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'vmail', name:'AUDITOR DE WEBSITES', dept:'sales', desk:[4,6], sit:[4,7], hair:'#7a3b12', shirt:'#5eead4',
  role:'Diagnóstico da presença digital',
  tagline:'Abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente.',
  tasks:['A pontuar leads novos face ao ICP','A remover duplicados da lista','A entregar a lista qualificada ao Sales Closer','A varrer o Google Maps à procura de empresas sem site','A analisar a presença digital de 20 empresas'],
  ev:[
    {i:'📋', t:()=>`Diagnosticar 15 sites da lista — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Testar HTTPS e velocidade de 10 sites — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Registar o que está mal no site da ${rnd(P.co)} — à espera do OK do proprietário`, p:2, kpi:{id:'leads',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Vendas — testar HTTPS e velocidade de 10 sites`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: diagnóstico da presença digital — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: playwright, chrome — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'E-mails de fornecedores tratados — últimos 7 dias', chart:[9,12,7,14,10,4,11],
  greeting:`Bom dia. Sou AUDITOR DE WEBSITES, na sala Prospeção. O meu trabalho: abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente. Neste momento: diagnosticar 15 sites da lista; testar HTTPS e velocidade de 10 sites.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'kmail', name:'DOCUMENTAÇÃO TÉCNICA', dept:'delivery', desk:[7,9], sit:[7,10], hair:'#4a2a10', shirt:'#2dd4bf',
  role:'Manuais, notas e entrega técnica',
  tagline:'Escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro.',
  tasks:['A publicar o site no domínio do cliente','A escrever a documentação técnica','A construir a página inicial do novo projeto','A ligar o formulário ao CRM','A testar responsividade e velocidade'],
  ev:[
    {i:'📋', t:()=>`Manual de manutenção do site da ${rnd(P.co)} — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Documentar as decisões do projeto ${rnd(P.co)} — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Arquivar a documentação no Cérebro — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — documentar as decisões do projeto ${rnd(P.co)}`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: manuais, notas e entrega técnica — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, googledrive — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'E-mails de freelancers — últimos 7 dias', chart:[7,11,9,13,8,3,10],
  greeting:`Bom dia. Sou DOCUMENTAÇÃO TÉCNICA, na sala Engenharia. O meu trabalho: escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro. Neste momento: manual de manutenção do site da ${rnd(P.co)}; documentar as decisões do projeto ${rnd(P.co)}.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ SALES additions (V3.1) ============ */
{ id:'ilm', name:'QUALIFICADOR', dept:'sales', desk:[20,3], sit:[20,4], hair:'#26140a', shirt:'#fbbf24',
  role:'Leads recebidos e marcações',
  tagline:'Responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe.',
  tasks:['A remover duplicados da lista','A entregar a lista qualificada ao Sales Closer','A varrer o Google Maps à procura de empresas sem site','A analisar a presença digital de 20 empresas','A enriquecer os contactos do lote de hoje'],
  ev:[
    {i:'📋', t:()=>`Qualificar ${ri(8,40)} pedidos recebidos pelo site — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Marcar 3 reuniões com o Sales Closer — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Responder a ${rnd(P.co)} na primeira hora — à espera do OK do proprietário`, p:2, kpi:{id:'leads',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Vendas — marcar 3 reuniões com o Sales Closer`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: leads recebidos e marcações — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: gmail, googlecalendar — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Leads recebidos qualificados — últimos 7 dias', chart:[14,11,19,16,22,8,17],
  greeting:`Bom dia. Sou QUALIFICADOR, na sala Prospeção. O meu trabalho: responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe. Neste momento: qualificar ${ri(8,40)} pedidos recebidos pelo site; marcar 3 reuniões com o Sales Closer.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ OPERATIONS additions (V3.1) ============ */
{ id:'dash', name:'PAINEL CENTRAL', dept:'emails', desk:[18,18], sit:[18,19], hair:'#0d0d0d', shirt:'#a78bfa',
  role:'Dashboard da empresa',
  tagline:'Constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro.',
  tasks:['A atualizar o painel central da empresa','A fechar o resumo de resultados da semana','A confirmar as aprovações à espera do proprietário','A distribuir o trabalho novo pelas salas','A rever as prioridades do dia com as seis salas'],
  ev:[
    {i:'📋', t:()=>`Atualizar o painel de leads e propostas — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Acrescentar o bloco de entregas dentro do prazo — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Corrigir o gráfico de vendas, período errado — à espera do OK do proprietário`, p:2, kpi:{id:'tarefas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — acrescentar o bloco de entregas dentro do prazo`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: dashboard da empresa — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: clarity, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Vistas de painel — últimos 7 dias', chart:[48,52,61,45,70,22,58],
  greeting:`Bom dia. Sou PAINEL CENTRAL, na sala Comando. O meu trabalho: constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro. Neste momento: atualizar o painel de leads e propostas; acrescentar o bloco de entregas dentro do prazo.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

/* ============ DELIVERY (V3.1, 5 Sep 2026 — new department) ============ */
{ id:'mlead', name:'GROWTH PUBLISHER', dept:'marketing', desk:[3,0], sit:[3,1], hair:'#2a1a0e', shirt:'#f87171', lead:true,
  role:'Marketing, conteúdo e distribuição',
  tagline:'Dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados.',
  tasks:['A otimizar as campanhas pagas','A preparar o calendário editorial da semana','A escrever o caso de estudo do último projeto','A montar o vídeo de demonstração','A agendar publicações no Instagram e LinkedIn'],
  ev:[
    {i:'📋', t:()=>`Plano editorial de outubro — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Fechar o calendário da próxima semana — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Rever o que funcionou no Instagram — à espera do OK do proprietário`, p:2, kpi:{id:'publicacoes',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à direção — fechar o calendário da próxima semana`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: marketing, conteúdo e distribuição — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: meta, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Publicações acima da linha de base — últimas 8 semanas', chart:[1,2,1,3,2,2,3,2],
  greeting:`Bom dia. Sou GROWTH PUBLISHER, na sala Media. O meu trabalho: dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados. Neste momento: plano editorial de outubro; fechar o calendário da próxima semana.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'olead', name:'SALES CLOSER', dept:'ops', desk:[15,6], sit:[15,7], hair:'#111111', shirt:'#a78bfa', lead:true,
  role:'Vendas, negociação e fecho',
  tagline:'Transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho.',
  tasks:['A responder a propostas em aberto','A marcar reuniões com decisores','A seguir 8 conversas paradas','A fechar a proposta da Kea Logistics','A registar o motivo dos negócios perdidos'],
  ev:[
    {i:'📋', t:()=>`Preparar a abordagem de 6 leads quentes — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Fechar a proposta da ${rnd(P.co)} — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Responder às objeções de 3 negócios abertos — à espera do OK do proprietário`, p:2, kpi:{id:'propostas',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — fechar a proposta da ${rnd(P.co)}`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: vendas, negociação e fecho — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: gmail, googlecalendar, pandadoc — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Contratos revistos — últimas 8 semanas', chart:[2,1,3,2,2,3,2,3],
  greeting:`Bom dia. Sou SALES CLOSER, na sala Vendas. O meu trabalho: transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho. Neste momento: preparar a abordagem de 6 leads quentes; fechar a proposta da ${rnd(P.co)}.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'dlead', name:'SYSTEMS ENGINEER', dept:'delivery', desk:[12,0], sit:[12,1], hair:'#1f1f1f', shirt:'#38bdf8', lead:true,
  role:'Desenvolvimento, sistemas e qualidade',
  tagline:'Constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação.',
  tasks:['A testar responsividade e velocidade','A corrigir erros da última entrega','A publicar o site no domínio do cliente','A escrever a documentação técnica','A construir a página inicial do novo projeto'],
  ev:[
    {i:'📋', t:()=>`Construir a página inicial do projeto ${rnd(P.co)} — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Ligar o formulário ao CRM — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Rever a arquitetura da área de clientes — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — ligar o formulário ao CRM`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: desenvolvimento, sistemas e qualidade — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: webflow, playwright — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Projetos entregues — últimas 8 semanas', chart:[2,3,2,4,3,3,5,4],
  greeting:`Bom dia. Sou SYSTEMS ENGINEER, na sala Engenharia. O meu trabalho: constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação. Neste momento: construir a página inicial do projeto ${rnd(P.co)}; ligar o formulário ao CRM.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'pco', name:'GESTOR DE PROJETOS', dept:'delivery', desk:[9,3], sit:[9,4], hair:'#3d2814', shirt:'#7dd3fc',
  role:'Planos, prazos e capacidade',
  tagline:'Mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda.',
  tasks:['A publicar o site no domínio do cliente','A escrever a documentação técnica','A construir a página inicial do novo projeto','A ligar o formulário ao CRM','A testar responsividade e velocidade'],
  ev:[
    {i:'📋', t:()=>`Plano da ${rnd(P.co)}: marcos e datas — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Refazer 3 marcos após alteração de âmbito — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Registar as horas da semana por projeto — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — refazer 3 marcos após alteração de âmbito`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: planos, prazos e capacidade — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: notion, googlecalendar — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Marcos atingidos — últimos 7 dias', chart:[2,1,3,2,1,0,2],
  greeting:`Bom dia. Sou GESTOR DE PROJETOS, na sala Engenharia. O meu trabalho: mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda. Neste momento: plano da ${rnd(P.co)}: marcos e datas; refazer 3 marcos após alteração de âmbito.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'qa', name:'QA E TESTES', dept:'delivery', desk:[12,3], sit:[12,4], hair:'#101820', shirt:'#bae6fd',
  role:'Testes funcionais, responsivos e de desempenho',
  tagline:'Testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto.',
  tasks:['A construir a página inicial do novo projeto','A ligar o formulário ao CRM','A testar responsividade e velocidade','A corrigir erros da última entrega','A publicar o site no domínio do cliente'],
  ev:[
    {i:'📋', t:()=>`Testar o site da ${rnd(P.co)} em telemóvel e computador — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Corrigir 4 erros do último deploy — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Teste de regressão no formulário de reserva — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — corrigir 4 erros do último deploy`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: testes funcionais, responsivos e de desempenho — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: playwright, chrome — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Problemas apanhados — últimos 7 dias', chart:[3,1,2,4,2,0,2],
  greeting:`Bom dia. Sou QA E TESTES, na sala Engenharia. O meu trabalho: testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto. Neste momento: testar o site da ${rnd(P.co)} em telemóvel e computador; corrigir 4 erros do último deploy.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'crep', name:'FRONTEND', dept:'delivery', desk:[9,6], sit:[9,7], hair:'#6b3410', shirt:'#7dd3fc',
  role:'Implementação de interface',
  tagline:'Implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect.',
  tasks:['A construir a página inicial do novo projeto','A ligar o formulário ao CRM','A testar responsividade e velocidade','A corrigir erros da última entrega','A publicar o site no domínio do cliente'],
  ev:[
    {i:'📋', t:()=>`Página de serviços fiel ao design aprovado — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Otimizar a velocidade da página inicial — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Componentes reutilizáveis da área de clientes — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — otimizar a velocidade da página inicial`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: implementação de interface — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: webflow, playwright — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Relatórios enviados — últimas 8 semanas', chart:[3,4,2,5,4,3,6,4],
  greeting:`Bom dia. Sou FRONTEND, na sala Engenharia. O meu trabalho: implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect. Neste momento: página de serviços fiel ao design aprovado; otimizar a velocidade da página inicial.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'cass', name:'BACKEND E INTEGRAÇÕES', dept:'delivery', desk:[12,6], sit:[12,7], hair:'#141414', shirt:'#bae6fd',
  role:'Dados, CRM e automações',
  tagline:'Liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual.',
  tasks:['A construir a página inicial do novo projeto','A ligar o formulário ao CRM','A testar responsividade e velocidade','A corrigir erros da última entrega','A publicar o site no domínio do cliente'],
  ev:[
    {i:'📋', t:()=>`Ligar os pagamentos Stripe ao projeto ${rnd(P.co)} — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Garantir que cada formulário entra no CRM — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Teste de integração das automações — à espera do OK do proprietário`, p:2, kpi:{id:'projetos',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho a Media — garantir que cada formulário entra no CRM`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: dados, crm e automações — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: stripe, notion — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Recursos sincronizados — últimos 7 dias', chart:[64,48,91,37,72,12,58],
  greeting:`Bom dia. Sou BACKEND E INTEGRAÇÕES, na sala Engenharia. O meu trabalho: liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual. Neste momento: ligar os pagamentos Stripe ao projeto ${rnd(P.co)}; garantir que cada formulário entra no CRM.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

{ id:'dasst', name:'UI E DESIGN SYSTEM', dept:'fin', desk:[9,9], sit:[9,10], hair:'#552200', shirt:'#7dd3fc',
  role:'Interfaces e componentes',
  tagline:'Constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita.',
  tasks:['A escrever os textos de interface','A validar o fluxo de contacto com dados de uso','A entregar as especificações à Engenharia','A definir a estrutura e o design system do novo site','A desenhar a landing page de ${rnd(P.co)}'],
  ev:[
    {i:'📋', t:()=>`Ecrãs do site da ${rnd(P.co)}, computador e telemóvel — em curso · ${ri(20,90)} min`, p:3},
    {i:'✅', t:()=>`Fechar os componentes do design system — concluído às ${rnd(['8h30','10h','11h15','14h','16h40'])}`},
    {i:'⏳', t:()=>`Versões responsivas da página de preços — à espera do OK do proprietário`, p:2, kpi:{id:'ecras',n:0.2}},
    {i:'🤝', t:()=>`Passou o trabalho à Engenharia — fechar os componentes do design system`, p:2},
    {i:'🧠', t:()=>`Nota escrita no Cérebro: interfaces e componentes — o que ficou decidido e porquê`, brain:true, p:1},
    {i:'🧰', t:()=>`Ferramentas usadas: canva, webflow — resultado registado`, p:1},
  ],
  stats:[['Tarefas esta semana',()=>ri(8,26)],['Em curso',()=>ri(1,4)],['À tua espera',()=>ri(0,3)],['Tempo médio',()=>ri(6,40)+' min']],
  chartLbl:'Peças de design entregues — últimos 7 dias', chart:[3,2,4,1,3,0,2],
  greeting:`Bom dia. Sou UI E DESIGN SYSTEM, na sala Design Lab. O meu trabalho: constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita. Neste momento: ecrãs do site da ${rnd(P.co)}, computador e telemóvel; fechar os componentes do design system.`,  chat:[
    { k:['secretária','tarefa','trabalho','fila','estado'], r:['Constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita.'] },
    { k:['ajuda','podes','fazer','ferramenta','como'], r:['Constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita. Trabalho a partir do Cérebro; diz-me o que queres saber.'] },
  ],
  fallback:[`Constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita. Pergunta-me pelo que estou a fazer, pelo que está à espera de aprovação ou pelo último resultado.`,`Experimenta «o que estás a fazer?», «o que está à espera?» ou «mostra o último resultado».`],
  chips:['O que estás a fazer?','O que está à espera de aprovação?','Mostra o último resultado'] },

];
export const STATS = { emailsSent:128, drafts:41, reports:9, projects:12, onTrack:11, chats:11, insMkt:3, insOps:5, cpa:41.0, spencer:14, arwin:31, jack:16, managers:5, autoOnb:17, billsPaid:14 };
export const FILE_GEN = {
  elead: ()=>{ const co=rnd(P.co); return { icon:'🧭', name:`plano-de-prioridades-${clockStr().replaceAll(":", "")}.md`, meta:'decisões do dia · aprovações pedidas', content:`ENTREGA — ORBITA DIRECTOR
sala: Comando · agente: ORBITA DIRECTOR · ${clockStr()}

objetivo
  Coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, googlecalendar, slack

resultado
  6 tarefas atribuídas · 2 atrasadas reagendadas · 1 bloco à espera do proprietário

estado: à espera do OK do proprietário antes de sair
` };},
  imail: ()=>{ const co=rnd(P.co); return { icon:'🗂', name:`quadro-de-tarefas-${clockStr().replaceAll(":", "")}.md`, meta:'tarefas com dono e prazo', content:`ENTREGA — CHEFE DE GABINETE
sala: Comando · agente: CHEFE DE GABINETE · ${clockStr()}

objetivo
  Transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, slack, googlecalendar

resultado
  tarefas criadas com responsável · 3 sem dono fechadas

estado: à espera do OK do proprietário antes de sair
` };},
  report: ()=>{ const co=rnd(P.co); return { icon:'📊', name:`relatorio-de-estado-${clockStr().replaceAll(":", "")}.md`, meta:'números do Cérebro · semanal', content:`ENTREGA — ANALISTA DE RESULTADOS
sala: Comando · agente: ANALISTA DE RESULTADOS · ${clockStr()}

objetivo
  Escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, clarity

resultado
  vendas, leads, projetos e produtividade, com a variação da semana

estado: à espera do OK do proprietário antes de sair
` };},
  dash: ()=>{ const co=rnd(P.co); return { icon:'📈', name:`painel-central-spec.md`, meta:'painel central · ligação ao Cérebro', content:`ENTREGA — PAINEL CENTRAL
sala: Comando · agente: PAINEL CENTRAL · ${clockStr()}

objetivo
  Constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: clarity, notion

resultado
  5 blocos · todos com número de origem

estado: à espera do OK do proprietário antes de sair
` };},
  comply: ()=>{ const co=rnd(P.co); return { icon:'⚖', name:`verificacao-de-permissoes-${clockStr().replaceAll(":", "")}.md`, meta:'aprovações antes de sair', content:`ENTREGA — PERMISSÕES E CONFORMIDADE
sala: Comando · agente: PERMISSÕES E CONFORMIDADE · ${clockStr()}

objetivo
  Verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, gmail

resultado
  4 envios retidos · 2 aprovados pelo proprietário

estado: à espera do OK do proprietário antes de sair
` };},
  pros: ()=>{ const co=rnd(P.co); return { icon:'⛏', name:`lista-de-leads-${clockStr().replaceAll(":", "")}.csv`, meta:'empresas sem site · pontuadas', content:`ENTREGA — LEAD HUNTER
sala: Prospeção · agente: LEAD HUNTER · ${clockStr()}

objetivo
  Procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: territool, apollo, chrome

resultado
  empresas listadas · duplicados removidos · pontuação 0–100 com a razão

estado: à espera do OK do proprietário antes de sair
` };},
  enzo: ()=>{ const co=rnd(P.co); return { icon:'🔎', name:`lote-enriquecido-${clockStr().replaceAll(":", "")}.csv`, meta:'decisor, e-mail e telemóvel', content:`ENTREGA — ENRIQUECEDOR
sala: Prospeção · agente: ENRIQUECEDOR · ${clockStr()}

objetivo
  Completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: fullenrich, apollo

resultado
  registos completados · 4 retidos por correspondência baixa

estado: à espera do OK do proprietário antes de sair
` };},
  ilm: ()=>{ const co=rnd(P.co); return { icon:'📥', name:`pedidos-qualificados-${clockStr().replaceAll(":", "")}.md`, meta:'recebidos pelo site · primeira hora', content:`ENTREGA — QUALIFICADOR
sala: Prospeção · agente: QUALIFICADOR · ${clockStr()}

objetivo
  Responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: gmail, googlecalendar

resultado
  3 reuniões marcadas · 5 pedidos fora do ICP

estado: à espera do OK do proprietário antes de sair
` };},
  riley: ()=>{ const co=rnd(P.co); return { icon:'📰', name:`nota-de-mercado-${clockStr().replaceAll(":", "")}.md`, meta:'varrimento de 47 fontes', content:`ENTREGA — INTELIGÊNCIA DE MERCADO
sala: Prospeção · agente: INTELIGÊNCIA DE MERCADO · ${clockStr()}

objetivo
  Faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: chrome, notion

resultado
  3 tendências, cada uma com fonte

estado: à espera do OK do proprietário antes de sair
` };},
  scout: ()=>{ const co=rnd(P.co); return { icon:'♟', name:`analise-competitiva-${clockStr().replaceAll(":", "")}.md`, meta:'preços e posicionamento', content:`ENTREGA — ANÁLISE COMPETITIVA
sala: Prospeção · agente: ANÁLISE COMPETITIVA · ${clockStr()}

objetivo
  Acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: chrome, notion

resultado
  3 rivais · 2 argumentos de venda atualizados

estado: à espera do OK do proprietário antes de sair
` };},
  vmail: ()=>{ const co=rnd(P.co); return { icon:'🔬', name:`diagnostico-de-sites-${clockStr().replaceAll(":", "")}.md`, meta:'presença digital · o que está mal', content:`ENTREGA — AUDITOR DE WEBSITES
sala: Prospeção · agente: AUDITOR DE WEBSITES · ${clockStr()}

objetivo
  Abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: playwright, chrome

resultado
  15 sites · HTTPS, velocidade, formulário e responsividade

estado: à espera do OK do proprietário antes de sair
` };},
  olead: ()=>{ const co=rnd(P.co); return { icon:'🤝', name:`abordagem-e-proposta-${clockStr().replaceAll(":", "")}.md`, meta:'leads quentes · próximo passo com data', content:`ENTREGA — SALES CLOSER
sala: Vendas · agente: SALES CLOSER · ${clockStr()}

objetivo
  Transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: gmail, googlecalendar, pandadoc

resultado
  6 abordagens · 2 objeções respondidas · 1 proposta em fecho

estado: à espera do OK do proprietário antes de sair
` };},
  piper: ()=>{ const co=rnd(P.co); return { icon:'📄', name:`proposta-${slug(co)}.pdf`, meta:'três opções · sem desconto', content:`ENTREGA — PROPOSTAS
sala: Vendas · agente: PROPOSTAS · ${clockStr()}

objetivo
  Escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: pandadoc, notion

resultado
  âmbito, preço, prazo e exclusões explícitas

estado: à espera do OK do proprietário antes de sair
` };},
  folo: ()=>{ const co=rnd(P.co); return { icon:'🔁', name:`seguimentos-${clockStr().replaceAll(":", "")}.md`, meta:'conversas paradas retomadas', content:`ENTREGA — SEGUIMENTOS
sala: Vendas · agente: SEGUIMENTOS · ${clockStr()}

objetivo
  Retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: gmail, imessage

resultado
  propostas seguidas · 1 fechada como perdida, com motivo

estado: à espera do OK do proprietário antes de sair
` };},
  ona: ()=>{ const co=rnd(P.co); return { icon:'🫱', name:`arranque-de-cliente-${clockStr().replaceAll(":", "")}.md`, meta:'boas-vindas, acessos e expectativas', content:`ENTREGA — RECEÇÃO DE CLIENTES
sala: Vendas · agente: RECEÇÃO DE CLIENTES · ${clockStr()}

objetivo
  Acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: imessage, gmail

resultado
  pontos de contacto e data do primeiro resultado

estado: à espera do OK do proprietário antes de sair
` };},
  legal: ()=>{ const co=rnd(P.co); return { icon:'📜', name:`revisao-de-contrato-${clockStr().replaceAll(":", "")}.md`, meta:'segundo olhar, não parecer jurídico', content:`ENTREGA — CONTRATOS
sala: Vendas · agente: CONTRATOS · ${clockStr()}

objetivo
  Lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: pandadoc, notion

resultado
  2 cláusulas assinaladas com o risco explicado

estado: à espera do OK do proprietário antes de sair
` };},
  cmail: ()=>{ const co=rnd(P.co); return { icon:'✉️', name:`resposta-a-cliente-${clockStr().replaceAll(":", "")}.md`, meta:'âmbito e prazos do Cérebro', content:`ENTREGA — COMUNICAÇÃO COM CLIENTES
sala: Vendas · agente: COMUNICAÇÃO COM CLIENTES · ${clockStr()}

objetivo
  Responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: gmail, slack

resultado
  respondido dentro de uma hora · sem promessas novas

estado: à espera do OK do proprietário antes de sair
` };},
  gfx: ()=>{ const co=rnd(P.co); return { icon:'🎨', name:`briefing-e-design-system-${clockStr().replaceAll(":", "")}.md`, meta:'estrutura, navegação e identidade', content:`ENTREGA — CREATIVE ARCHITECT
sala: Design Lab · agente: CREATIVE ARCHITECT · ${clockStr()}

objetivo
  Lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: canva, notion

resultado
  problema, público, ação principal e componentes

estado: à espera do OK do proprietário antes de sair
` };},
  dasst: ()=>{ const co=rnd(P.co); return { icon:'🧩', name:`ecras-${slug(co)}.md`, meta:'computador e telemóvel', content:`ENTREGA — UI E DESIGN SYSTEM
sala: Design Lab · agente: UI E DESIGN SYSTEM · ${clockStr()}

objetivo
  Constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: canva, webflow

resultado
  grelha, componentes e estados · tudo no kit de marca

estado: à espera do OK do proprietário antes de sair
` };},
  alead: ()=>{ const co=rnd(P.co); return { icon:'🖼', name:`mockups-${slug(co)}.md`, meta:'apresentação e redes', content:`ENTREGA — DIREÇÃO DE ARTE
sala: Design Lab · agente: DIREÇÃO DE ARTE · ${clockStr()}

objetivo
  Cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: canva, higgsfield

resultado
  3 formatos por peça · licenças verificadas

estado: à espera do OK do proprietário antes de sair
` };},
  invo: ()=>{ const co=rnd(P.co); return { icon:'🔍', name:`pesquisa-ux-${clockStr().replaceAll(":", "")}.md`, meta:'fluxos, textos e validação', content:`ENTREGA — PESQUISA UX
sala: Design Lab · agente: PESQUISA UX · ${clockStr()}

objetivo
  Mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, clarity

resultado
  percurso de contacto + 40 sessões revistas

estado: à espera do OK do proprietário antes de sair
` };},
  dlead: ()=>{ const co=rnd(P.co); return { icon:'🛠', name:`entrega-tecnica-${clockStr().replaceAll(":", "")}.md`, meta:'o que foi construído e o que falta', content:`ENTREGA — SYSTEMS ENGINEER
sala: Engenharia · agente: SYSTEMS ENGINEER · ${clockStr()}

objetivo
  Constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: webflow, playwright

resultado
  frontend, backend e integrações · pronto para QA

estado: à espera do OK do proprietário antes de sair
` };},
  pco: ()=>{ const co=rnd(P.co); return { icon:'🗓', name:`plano-de-projeto-${slug(co)}.md`, meta:'marcos, datas e capacidade', content:`ENTREGA — GESTOR DE PROJETOS
sala: Engenharia · agente: GESTOR DE PROJETOS · ${clockStr()}

objetivo
  Mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, googlecalendar

resultado
  marcos definidos · dependências e horas por semana

estado: à espera do OK do proprietário antes de sair
` };},
  qa: ()=>{ const co=rnd(P.co); return { icon:'✅', name:`relatorio-de-testes-${clockStr().replaceAll(":", "")}.md`, meta:'telemóvel, computador e velocidade', content:`ENTREGA — QA E TESTES
sala: Engenharia · agente: QA E TESTES · ${clockStr()}

objetivo
  Testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: playwright, chrome

resultado
  verificações feitas · 0 bloqueios · 4 notas

estado: à espera do OK do proprietário antes de sair
` };},
  crep: ()=>{ const co=rnd(P.co); return { icon:'💻', name:`frontend-${slug(co)}.md`, meta:'fiel ao design aprovado', content:`ENTREGA — FRONTEND
sala: Engenharia · agente: FRONTEND · ${clockStr()}

objetivo
  Implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: webflow, playwright

resultado
  componentes reutilizáveis e velocidade medida

estado: à espera do OK do proprietário antes de sair
` };},
  cass: ()=>{ const co=rnd(P.co); return { icon:'🔌', name:`integracoes-${slug(co)}.md`, meta:'formulários, CRM e pagamentos', content:`ENTREGA — BACKEND E INTEGRAÇÕES
sala: Engenharia · agente: BACKEND E INTEGRAÇÕES · ${clockStr()}

objetivo
  Liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: stripe, notion

resultado
  cada ligação com um teste que prova que funciona

estado: à espera do OK do proprietário antes de sair
` };},
  apay: ()=>{ const co=rnd(P.co); return { icon:'🚀', name:`checklist-de-deploy-${slug(co)}.md`, meta:'domínio, cópia e monitorização', content:`ENTREGA — DEPLOYS E INFRA
sala: Engenharia · agente: DEPLOYS E INFRA · ${clockStr()}

objetivo
  Publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: webflow, chrome

resultado
  publicado depois do OK do QA e do proprietário

estado: à espera do OK do proprietário antes de sair
` };},
  kmail: ()=>{ const co=rnd(P.co); return { icon:'📚', name:`documentacao-${slug(co)}.md`, meta:'como funciona e como se mantém', content:`ENTREGA — DOCUMENTAÇÃO TÉCNICA
sala: Engenharia · agente: DOCUMENTAÇÃO TÉCNICA · ${clockStr()}

objetivo
  Escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, googledrive

resultado
  o que é, como se muda, o que não se deve tocar

estado: à espera do OK do proprietário antes de sair
` };},
  mlead: ()=>{ const co=rnd(P.co); return { icon:'📅', name:`plano-editorial-${clockStr().replaceAll(":", "")}.md`, meta:'objetivo, público e canal', content:`ENTREGA — GROWTH PUBLISHER
sala: Media · agente: GROWTH PUBLISHER · ${clockStr()}

objetivo
  Dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: meta, notion

resultado
  peças planeadas · uma por dia · aprovação pedida antes de sair

estado: à espera do OK do proprietário antes de sair
` };},
  newt: ()=>{ const co=rnd(P.co); return { icon:'✍', name:`caso-de-estudo-${slug(co)}.md`, meta:'números reais do Cérebro', content:`ENTREGA — CONTEÚDO E NEWSLETTER
sala: Media · agente: CONTEÚDO E NEWSLETTER · ${clockStr()}

objetivo
  Escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: beehiiv, loops

resultado
  problema, o que fizemos, resultado e citação

estado: à espera do OK do proprietário antes de sair
` };},
  ada: ()=>{ const co=rnd(P.co); return { icon:'📣', name:`relatorio-meta-${clockStr().replaceAll(":", "")}.md`, meta:'CPA e o que aprendemos', content:`ENTREGA — ANÚNCIOS META
sala: Media · agente: ANÚNCIOS META · ${clockStr()}

objetivo
  Corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: meta

resultado
  orçamento intocado sem aprovação · um teste de cada vez

estado: à espera do OK do proprietário antes de sair
` };},
  iggy: ()=>{ const co=rnd(P.co); return { icon:'📱', name:`calendario-social-${clockStr().replaceAll(":", "")}.md`, meta:'Instagram e LinkedIn', content:`ENTREGA — REDES SOCIAIS
sala: Media · agente: REDES SOCIAIS · ${clockStr()}

objetivo
  Prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: meta, canva

resultado
  publicações prontas · comentários no tom da casa

estado: à espera do OK do proprietário antes de sair
` };},
  vid: ()=>{ const co=rnd(P.co); return { icon:'🎞', name:`video-${slug(co)}.md`, meta:'demonstração com legendas', content:`ENTREGA — VÍDEO
sala: Media · agente: VÍDEO · ${clockStr()}

objetivo
  Produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: hyperframes

resultado
  9:16 e 1:1 · gancho nos primeiros 3 s

estado: à espera do OK do proprietário antes de sair
` };},
  lexi: ()=>{ const co=rnd(P.co); return { icon:'🗒', name:`fila-de-aprovacoes-${clockStr().replaceAll(":", "")}.md`, meta:'o que sai, onde e quando', content:`ENTREGA — CALENDÁRIO EDITORIAL
sala: Media · agente: CALENDÁRIO EDITORIAL · ${clockStr()}

objetivo
  Mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: notion, googlecalendar

resultado
  peças prontas · 2 bloqueadas

estado: à espera do OK do proprietário antes de sair
` };},
  recon: ()=>{ const co=rnd(P.co); return { icon:'📉', name:`analytics-de-conteudo-${clockStr().replaceAll(":", "")}.md`, meta:'alcance, tráfego e leads', content:`ENTREGA — ANALYTICS DE CONTEÚDO
sala: Media · agente: ANALYTICS DE CONTEÚDO · ${clockStr()}

objetivo
  Mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe.

o que foi feito
  · o trabalho do dia, registado passo a passo
  · ferramentas usadas: clarity, meta

resultado
  comparação com o período anterior + 1 decisão recomendada

estado: à espera do OK do proprietário antes de sair
` };},
};
// INDUSTRY PROFILE (12 Sep 2026): the fake world + every persona come from the profile in a per-industry demo file. No-op otherwise.
applyV1({ P, V1, FILE_GEN, clockStr });
