// Órbita — O TEMA (29 out 2026).
//
// Pedido do dono: «configurações reais, até mudança de tema (claro para escuro)».
//
// Havia modo escuro desde 6 de Setembro, mas escondido numa tecla (D) e/ou no endereço `/dark`:
// quem chega não descobre, e quem descobre perde a escolha ao fechar o separador. Aqui a preferência
// passa a ser um valor a sério — `claro`, `escuro` ou `automático` (o que o sistema diz) — guardada
// no browser e aplicada no arranque, antes de a cena aparecer.
//
// Este ficheiro é PURO de propósito: não toca no DOM nem no `localStorage` sem lhe passarem um
// `store`. É isso que permite prová-lo em Node (`settings.test.mjs`) sem um browser.

export const THEME_KEY = 'orbita.tema';
export const THEMES = ['auto', 'light', 'dark'];
export const THEME_LABEL = { auto: 'Automático', light: 'Claro', dark: 'Escuro' };

/** Um `localStorage` que nunca rebenta (modo privado, file://, browser antigo). */
export function safeStore(store) {
  if (store) return store;
  try {
    const s = globalThis.localStorage;
    if (s && typeof s.getItem === 'function') return s;
  } catch { /* sem armazenamento: fica em memória */ }
  const mem = new Map();
  return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
}

/** Normaliza o que estiver guardado: o que não for um tema conhecido é «automático». */
export function normalizeTheme(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'dark' || s === 'escuro' || s === 'noite') return 'dark';
  if (s === 'light' || s === 'claro' || s === 'dia') return 'light';
  return 'auto';
}

export function readTheme(store = safeStore()) {
  try { return normalizeTheme(store.getItem(THEME_KEY)); } catch { return 'auto'; }
}

export function writeTheme(pref, store = safeStore()) {
  const p = normalizeTheme(pref);
  try { store.setItem(THEME_KEY, p); } catch { /* sem armazenamento: a escolha vale só nesta sessão */ }
  return p;
}

/** A pergunta que interessa: com esta preferência e um sistema que diz X, que tema se desenha? */
export function resolveTheme(pref, systemPrefersDark = false) {
  const p = normalizeTheme(pref);
  if (p !== 'auto') return p;
  return systemPrefersDark ? 'dark' : 'light';
}
