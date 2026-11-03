/* ===========================================================================
   1.62.0 · O ESCRITÓRIO É OPCIONAL NO TELEMÓVEL (2 nov 2026)

   O pedido 6 dizia duas coisas que parecem contradizer-se: o escritório 3D é a
   marca e não pode ser um obstáculo; no telemóvel a experiência é própria. A
   resposta é esta: no telefone abre-se na PLANTA (2D, sem WebGL, legível com o
   polegar) e o 3D fica a um botão — com o mesmo estado, as mesmas salas e o
   mesmo toque. No computador nada muda: abre no 3D.

   Regras da decisão:
     · uma escolha explícita do dono manda sempre (guardada neste browser);
     · sem escolha, `prefers-reduced-motion` vence: quem pediu menos movimento
       não leva com uma cena animada por omissão;
     · depois, o toque: ecrã pequeno e sem rato abre na planta;
     · em todos os casos o 3D continua a um toque — nunca se esconde a marca.

   Contas puras: sem DOM, sem WebGL, provadas em `escritorio.test.mjs`.
   =========================================================================== */

export const CHAVE_MODO = 'orbita.oficina.modo';
export const MODOS = { planta: 'planta', '3d': '3d' };

/** Lê a escolha guardada; o que não for um modo conhecido vale «sem escolha». */
export function lerModo(storage) {
  try {
    const v = storage && storage.getItem(CHAVE_MODO);
    return v === 'planta' || v === '3d' ? v : null;
  } catch { return null; }
}

export function gravarModo(storage, modo) {
  if (modo !== 'planta' && modo !== '3d') return false;
  /* sem armazém não se diz «guardei»: a próxima visita volta ao que era. */
  if (!storage) return false;
  try { storage.setItem(CHAVE_MODO, modo); return true; } catch { return false; }
}

/**
 * Que vista abrir no arranque.
 * @returns {{modo:'planta'|'3d', porque:string, decididoPor:'dono'|'movimento'|'toque'|'ecra'|'computador'|'armazem'}}
 */
export function modoInicial({ guardado = null, toque = false, estreito = false, movimentoReduzido = false, semArmazem = false } = {}) {
  if (guardado === 'planta' || guardado === '3d') {
    return { modo: guardado, decididoPor: 'dono', porque: guardado === 'planta' ? 'escolheste a planta uma vez — fica assim até mudares' : 'escolheste o 3D uma vez — fica assim até mudares' };
  }
  if (movimentoReduzido) {
    return { modo: 'planta', decididoPor: 'movimento', porque: 'pediste menos movimento: a planta abre primeiro e o 3D fica a um toque' };
  }
  if (toque && estreito) {
    return { modo: 'planta', decididoPor: 'toque', porque: 'no telemóvel a planta abre primeiro — o 3D está no botão ao lado' };
  }
  if (toque) {
    return { modo: 'planta', decididoPor: 'toque', porque: 'com o dedo, a planta é mais rápida de ler; o 3D continua a um toque' };
  }
  if (estreito) {
    return { modo: '3d', decididoPor: 'ecra', porque: 'ecrã estreito mas com rato: o 3D abre como sempre' };
  }
  if (semArmazem) {
    return { modo: '3d', decididoPor: 'armazem', porque: 'este browser não guarda preferências: fica o 3D de sempre' };
  }
  return { modo: '3d', decididoPor: 'computador', porque: 'no computador o escritório abre em 3D, como sempre' };
}

/** O botão diz o que vai fazer, não onde estás. */
export function rotuloDoBotao(modo) {
  return modo === 'planta'
    ? { texto: 'Ver em 3D', titulo: 'abrir o escritório em 3D (a marca, com toque)', aria: 'ver o escritório em 3D' }
    : { texto: 'Planta 2D', titulo: 'planta 2D — trabalho intensivo (M)', aria: 'ver a planta 2D do escritório' };
}

/** Alternar é trocar de vista; o que se guarda é a vista que fica. */
export function proximoModo(modo) {
  return modo === 'planta' ? '3d' : 'planta';
}

/** Uma frase para o rodapé/ajuda — sempre com o caminho de volta. */
export function fraseDoModo(modo) {
  return modo === 'planta'
    ? 'Planta 2D: as seis salas e o estado real, sem animação. O 3D está no botão «Ver em 3D».'
    : 'Escritório 3D: arrasta no vazio para rodar, dois dedos para aproximar. A planta está no botão «Planta 2D».';
}
