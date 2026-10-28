/* ===========================================================================
   1.52.1 · A LISTA DO PAINEL, VISTA DE FORA

   O painel de tarefas constrói o menu do modelo no browser
   (`src/lista-modelos.js` → `opcoesDoCatalogo`). Isto é o mesmo cálculo, do lado
   do servidor, para se poder PROVAR o que o painel mostra sem abrir um browser:
   o catálogo lido agora, os fornecedores que podem responder, o que fica de fora
   e a ordem por evidência.

   Uma regra só: este ficheiro não decide nada — importa a função do painel. Se a
   regra mudar, muda nos dois sítios ao mesmo tempo (é o teste que o garante).
   =========================================================================== */
import { opcoesDoCatalogo, notaDaLista } from '../../src/lista-modelos.js';

/** O que `GET /api/prova-chat?lista=1` devolve — sem inventar nada. */
export function provaDaLista({ catalogo, estado = null, provas = null } = {}) {
  const r = opcoesDoCatalogo(catalogo, estado || {}, provas || {});
  return {
    versao: '1.52.1',
    grupos: r.grupos.map((g) => ({
      rotulo: g.rotulo,
      quantos: g.opcoes.length,
      opcoes: g.opcoes.map((o) => o.etiqueta),
      valores: g.opcoes.map((o) => o.valor),
    })),
    contagem: r.contagem,
    nota: notaDaLista(r.contagem),
    /* o que o <select> do painel terá, ao certo */
    totalNoMenu: r.grupos.reduce((n, g) => n + g.opcoes.length, 0),
  };
}
