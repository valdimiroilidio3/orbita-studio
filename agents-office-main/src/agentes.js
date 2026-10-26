// Órbita — quem é quem. Isto é **identidade**, não demonstração: o nome vem de `data.js` (os 35
// lugares da cena) e a função e a descrição vêm daqui, para o rail, o painel ao vivo e o servidor
// (`roster.mjs`) dizerem a mesma coisa. Nada aqui é um número, um evento ou um resultado.
//
// O que este ficheiro substitui: `v1data.js` (1 300 linhas de empresa fictícia, eventos, métricas,
// documentos e conversas de exemplo) e `profile.js` (as variantes de demonstração por indústria).
// Sobrou o que é verdade: o papel de cada agente.

export const IDENTITY = {
  enzo: { role: 'Dados de contacto e enriquecimento', does: 'Completa cada empresa da lista com decisor, cargo, e-mail, telemóvel, LinkedIn e dimensão, e remove o que não se consegue verificar.' },
  lexi: { role: 'Planeamento de publicações', does: 'Mantém o calendário editorial e a fila de aprovações: o que sai, em que canal, em que dia, e o que está bloqueado.' },
  ona: { role: 'Onboarding e relação inicial', does: 'Acompanha cada cliente novo desde o sim até ao primeiro resultado: boas-vindas, acessos, expectativas, pontos de contacto e handoff para a Engenharia.' },
  pros: { role: 'Prospeção e qualificação de empresas', does: 'Procura empresas que precisam de website ou sistema — Google Maps, diretórios públicos e pesquisa web —, analisa a presença digital, elimina duplicados e pontua cada oportunidade.' },
  folo: { role: 'Segundo contacto e reativação', does: 'Retoma conversas paradas: propostas sem resposta, reuniões adiadas, testes terminados e contactos frios autorizados.' },
  riley: { role: 'Pesquisa de mercado e tendências', does: 'Faz o varrimento diário de fontes, tendências e novidades do setor, e entrega três pontos que merecem atenção com a fonte.' },
  newt: { role: 'Texto, casos de estudo e newsletter', does: 'Escreve legendas, publicações, casos de estudo e a newsletter mensal, com a voz da Órbita.' },
  ada: { role: 'Publicidade paga', does: 'Corre as campanhas pagas: criativos, públicos, orçamento e otimização, e diz o que escalar, cortar ou corrigir.' },
  iggy: { role: 'Instagram, LinkedIn e comunidade', does: 'Prepara e agenda publicações para Instagram e LinkedIn, responde a comentários e mensagens dentro do tom da casa.' },
  vid: { role: 'Vídeos, demonstrações e cortes', does: 'Produz vídeos curtos e demonstrações dos projetos: guião, montagem, legendas e exportação para cada canal.' },
  gfx: { role: 'Estratégia digital, UX/UI e direção de arte', does: 'Lê o briefing do cliente, define estrutura, navegação, identidade visual e design system, e transforma a necessidade comercial num conceito digital defensável.' },
  piper: { role: 'Propostas comerciais', does: 'Escreve e envia propostas a partir do preçário e dos casos do Cérebro: âmbito, opções, preço, prazo e próximos passos.' },
  scout: { role: 'Concorrentes e posicionamento', does: 'Acompanha os estúdios e agências concorrentes: preços, portefólio, posicionamento e campanhas, e mantém os argumentos de venda atualizados.' },
  legal: { role: 'Revisão de contratos e termos', does: 'Lê contratos, propostas aceites e termos de serviço antes de saírem, e assinala cláusulas de risco.' },
  comply: { role: 'Aprovações, consentimento e RGPD', does: 'Verifica o que pode sair para fora: consentimento de contactos, limites de abordagem, dados pessoais e aprovação humana antes de qualquer envio ou publicação.' },
  report: { role: 'Relatórios de estado e desempenho', does: 'Escreve o relatório de estado da empresa — vendas, leads, projetos e produtividade — com os números do Cérebro, e diz o que melhorou e o que piorou.' },
  alead: { role: 'Imagem, mockups e identidade', does: 'Cria a camada visual dos projetos: imagens, mockups de website, capas e peças de apresentação coerentes com a identidade premium da Órbita.' },
  invo: { role: 'Pesquisa, fluxos e validação', does: 'Mapeia o percurso do utilizador, escreve os textos de interface e valida as decisões com dados de uso e sessões gravadas.' },
  apay: { role: 'Publicação, domínios e manutenção', does: 'Publica os projetos, configura domínios, cópias de segurança e monitorização, e mantém o que está no ar a funcionar.' },
  recon: { role: 'Alcance, tráfego e leads', does: 'Mede o que o conteúdo traz: alcance, interações, tráfego para o site e leads gerados, e liga cada lead à peça que o trouxe.' },
  elead: { role: 'Direção e coordenação de agentes', does: 'Coordena as seis salas da Órbita, distribui o trabalho e mantém toda a operação orientada a resultados: prioridades do dia, tarefas atrasadas, agentes parados e o estado geral da empresa.' },
  cmail: { role: 'E-mail de clientes', does: 'Responde aos clientes a partir do Cérebro: âmbito, prazos, resultados e o que não está incluído. Nada fica mais de uma hora sem resposta.' },
  imail: { role: 'Coordenação de tarefas e prioridades', does: 'Transforma o pedido do proprietário em tarefas concretas, escolhe a sala e o agente certos, marca prazos e avisa quando algo está parado ou fora do prazo.' },
  vmail: { role: 'Diagnóstico da presença digital', does: 'Abre o site de cada empresa da lista e regista o que está mal: sem HTTPS, lento, não responsivo, sem formulário, desatualizado ou inexistente.' },
  kmail: { role: 'Manuais, notas e entrega técnica', does: 'Escreve a documentação de cada projeto — como está feito, como se mantém, o que foi decidido — e arquiva-a no Cérebro.' },
  ilm: { role: 'Leads recebidos e marcações', does: 'Responde a quem chega pelo site ou pelas redes na primeira hora, qualifica a necessidade e marca reunião com o Sales Closer quando há encaixe.' },
  dash: { role: 'Dashboard da empresa', does: 'Constrói e mantém o painel central: leads, propostas, projetos em curso, entregas e vendas, cada bloco ligado a um número do Cérebro.' },
  mlead: { role: 'Marketing, conteúdo e distribuição', does: 'Dirige a divulgação da Órbita e dos projetos dos clientes: plano editorial, calendário, canais, orçamento e resultados.' },
  olead: { role: 'Vendas, negociação e fecho', does: 'Transforma leads qualificados em reuniões, propostas e clientes: abordagem personalizada, resposta a objeções, proposta, seguimento e fecho.' },
  dlead: { role: 'Desenvolvimento, sistemas e qualidade', does: 'Constrói websites e aplicações a partir das especificações aprovadas: frontend, backend, base de dados, integrações, testes e publicação.' },
  pco: { role: 'Planos, prazos e capacidade', does: 'Mantém os planos de projeto verdadeiros: marcos, prazos, horas e dependências, e avisa cedo quando algo muda.' },
  qa: { role: 'Testes funcionais, responsivos e de desempenho', does: 'Testa cada entrega antes de sair: ligações, formulários, responsividade, velocidade, acessibilidade e fluxos de compra ou contacto.' },
  crep: { role: 'Implementação de interface', does: 'Implementa os ecrãs aprovados em código limpo e rápido, fiel ao design system e às especificações do Creative Architect.' },
  cass: { role: 'Dados, CRM e automações', does: 'Liga formulários, CRM, pagamentos e automações, e garante que cada contacto chega ao sítio certo sem intervenção manual.' },
  dasst: { role: 'Interfaces e componentes', does: 'Constrói os ecrãs e o design system: grelha, tipografia, componentes, estados e versões responsivas, tudo dentro da identidade da Órbita.' },
};

/** O posto que trata de cada tipo de tarefa — o mesmo mapa que `src/ops/live.mjs` usa no servidor.
 *  Um teste (`ops.test.mjs`) compara os dois, para não haver dois escritórios diferentes. */
export const SEAT = {
  'lead.pesquisar': 'vmail',
  'lead.qualificar': 'ilm',
  'proposta.preparar': 'piper',
  'mensagem.redigir': 'folo',
  'projeto.briefing': 'dasst',
  'projeto.gerar': 'crep',
  'projeto.qa': 'qa',
  'projeto.corrigir': 'cass',
  'projeto.entregar': 'apay',
  'conteudo.rascunho': 'newt',
  'command.revisao': 'elead',
};

export const roleOf = id => IDENTITY[id]?.role || '';
export const doesOf = id => IDENTITY[id]?.does || '';
/** Que posto recebe este tipo de tarefa (vazio se o tipo não tiver posto). */
export const seatOf = kind => SEAT[kind] || '';
