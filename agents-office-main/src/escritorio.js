// Órbita — APLICAR A CONFIGURAÇÃO DAS SALAS ANTES DE A CENA ASSENTAR (1.20.0)
//
// `main.js` importa este ficheiro ANTES de `data.js`. Quando o corpo do `main.js`
// começa a correr, as cores das salas, os agentes acrescentados e a profundidade
// das salas já são os que o dono escolheu no Centro de Controlo.
//
// O que fica guardado (chave `orbita.salas` no browser):
//
//   { cores: { sales: '#EADC8F', … }, agentes: [ { id, nome, dept, funcao } ] }
//
// A mesma configuração é enviada para o servidor (`/api/controlo/salas`), para não
// se perder ao mudar de máquina; o browser é só a cópia que a cena consegue ler
// sem esperar por rede.

import { DEPTS, LAYOUT, AGENTS } from './data.js';
import { aplicarNaCena, lerAjustes, gravarAjustes } from './salas.js';

function store() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/** Lê, valida e aplica. Devolve o que ficou aplicado (para a interface mostrar). */
export function aplicar({ guardados = null } = {}) {
  const ajustes = lerAjustes(guardados ?? store());
  const resultado = aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, ajustes);
  return { ajustes, resultado };
}

export { lerAjustes, gravarAjustes };

/** Corre no arranque. Uma configuração inválida não parte a cena: é ignorada. */
export const aplicado = aplicar();
