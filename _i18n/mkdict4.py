# -*- coding: utf-8 -*-
import json, os
H=os.path.dirname(os.path.abspath(__file__))
P=[
("Circulate the weekly numbers","Fazer circular os números da semana"),
("Prep the month-end pack","Preparar o pacote de fecho do mês"),
("Research hook angles for the next reel","Investigar ângulos de gancho para o próximo reel"),
("Review overnight enrichment before the reps see it","Rever o enriquecimento da noite antes de os comerciais verem"),
("Summarise the vendor SLA revision","Resumir a revisão do SLA do fornecedor"),
("Vendor rate review","Revisão de valores do fornecedor"),
("Verify mobiles on the AU batch","Verificar telemóveis no lote AU"),
("Verify mobiles on the new batch","Verificar telemóveis no novo lote"),
("Write the hook for the carousel","Escrever o gancho do carrossel"),
("Write the reel script from the research","Escrever o guião do reel a partir da investigação"),
("added by you","adicionado por ti"),("added by you · live","adicionado por ti · em direto"),
("board pack","relatório para a direção"),("call list","lista de chamadas"),
("cold call anxiety","ansiedade da chamada fria"),("content plan","plano de conteúdo"),
("credit note","nota de crédito"),("website lead","lead do site"),
("from the Brain","a partir do Cérebro"),
("office poll:","consulta ao escritório:"),
("office server not reachable — running offline:","servidor do escritório inacessível — a correr offline:"),
("sched scheduled","agendada"),("sent back to revise","devolvida para revisão"),
("the model's own","o do próprio modelo"),
("I am","Sou"),
("CLIENT EMAILS READ MOC-DELIVERY","E-MAILS DE CLIENTES LERAM MOC-DELIVERY"),
("Claude Code is not installed","O Claude Code não está instalado"),
("no Claude Code login found on this machine","não há sessão do Claude Code nesta máquina"),
("task.team","task.team"),
("ANÚNCIOS META","ANÚNCIOS META"),
("Prep the board pack sections","Preparar as secções do relatório para a direção"),
]
D = json.load(open(os.path.join(H,'dict.json'), encoding='utf-8'))
D.update(dict(P))
json.dump(D, open(os.path.join(H,'dict.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(D))
