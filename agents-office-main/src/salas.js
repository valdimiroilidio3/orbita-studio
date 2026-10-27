// Órbita — AS SALAS QUE CRESCEM (27 out 2026, 1.20.0)
//
// Pedido do dono: «controlar as seis salas, mudar o tamanho das salas, acrescentar
// agentes onde aumentar o tamanho da sala automaticamente conforme vou adicionando
// agentes, mudança de funções, cores…».
//
// Porque este ficheiro existe. As salas (`DEPTS`), a planta (`LAYOUT`) e os agentes
// (`AGENTS`) vivem em `data.js`, e a cena 3D lê-os como constantes. Para a sala
// crescer quando entra um agente, a conta tem de acontecer ANTES de a cena assentar
// — e tem de ser a mesma conta para a planta, para as secretárias e para a interface.
// Aqui está essa conta, pura: sem `three`, sem DOM, sem rede. `node --test` corre-a.
//
// Regras que este ficheiro respeita:
//   · a sala cresce em FILAS inteiras, nunca em centímetros soltos — uma secretária
//     precisa da fila toda (secretária + cadeira + corredor);
//   · nunca encolhe abaixo da planta original: acrescentar é seguro, tirar não move
//     paredes que já existiam;
//   · a faixa da frente fica sempre livre (é a entrada que a câmara vê);
//   · nenhum agente fica sem lugar: quem não cabe numa fila abre a fila seguinte.

import { SEAT_GRID } from './data.js';

/** Quantas filas são precisas para `n` agentes, com `cols` secretárias por fila. */
export function filasNecessarias(n, cols = SEAT_GRID.cols) {
  const total = Math.max(0, Math.floor(Number(n) || 0));
  if (!total) return 1;
  return Math.ceil(total / Math.max(1, cols));
}

/** Profundidade que uma sala precisa para ter `filas` filas completas.
 *  Mesma fórmula de `data.js`: parede de fundo → filas → faixa da frente. */
export function profundidadePara(filas) {
  const f = Math.max(1, Math.floor(Number(filas) || 1));
  return SEAT_GRID.wallGap + (f - 1) * SEAT_GRID.rowStep + SEAT_GRID.depth + SEAT_GRID.entryBand;
}

/** O primeiro lugar livre numa sala, percorrendo colunas e depois filas. */
export function lugarLivre(agentes, dept, cols = SEAT_GRID.cols) {
  const ocupados = new Set(
    agentes.filter((a) => a.dept === dept).map((a) => `${a.grid?.[0] ?? 0}:${a.grid?.[1] ?? 0}`),
  );
  for (let fila = 0; fila < 999; fila += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!ocupados.has(`${col}:${fila}`)) return [col, fila];
    }
  }
  return [0, 0];
}

/** Quantos agentes tem hoje uma sala (base + acrescentados). */
export function contarAgentes(agentes, dept) {
  return agentes.filter((a) => a.dept === dept).length;
}

/**
 * Ajusta a planta à lotação real. Devolve cópias — não mexe nos objectos originais
 * (a cena ainda está a ler deles quando isto corre).
 * `layout` = { dept: { pos:[x,z], w, d } }.
 */
export function plantaAjustada(layout, agentes) {
  const saida = {};
  for (const [dept, L] of Object.entries(layout)) {
    const filas = filasNecessarias(contarAgentes(agentes, dept));
    /* `w` (largura) não muda: as colunas são fixas. Só a profundidade cresce. */
    saida[dept] = { ...L, d: Math.max(L.d, profundidadePara(filas)), filas };
  }
  return saida;
}

/** Limite de agentes por sala — o que a mesa aceita acrescentar. Acima disto a
 *  sala ficaria com mais de seis filas e deixaria de caber no escritório. */
export const MAX_POR_SALA = 12;

/** Uma cor só entra se for hexadecimal de 3 ou 6 dígitos. */
export function corValida(cor) {
  return typeof cor === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(cor.trim());
}

/** Escurece uma cor para a parede de vidro (a mesma relação que data.js usa). */
export function corDoVidro(chip) {
  if (!corValida(chip)) return chip;
  let c = chip.trim().slice(1);
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const n = parseInt(c, 16);
  const escurecer = (v) => Math.max(0, Math.min(255, Math.round(v * 0.82)));
  const r = escurecer((n >> 16) & 255);
  const g = escurecer((n >> 8) & 255);
  const b = escurecer(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Nome curto para um agente novo, a partir do que o dono escreveu. */
export function nomeCurto(nome) {
  return String(nome || '').trim().replace(/\s+/g, ' ').slice(0, 28);
}

/** Identificador estável e legível (`dlead-2`, `agente-x9`). */
export function idDeAgente(nome, existentes = []) {
  const base = String(nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 18) || 'agente';
  const usados = new Set(existentes.map((a) => a.id));
  if (!usados.has(base)) return base;
  for (let i = 2; i < 500; i += 1) if (!usados.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

/* ---------- o que fica guardado ---------- */

export const CHAVE = 'orbita.salas';

/** Lê os ajustes guardados. Nunca lança: uma configuração estragada é ignorada
 *  (a cena tem de abrir sempre, mesmo com um JSON meio escrito). */
export function lerAjustes(store = null) {
  const vazio = { cores: {}, agentes: [] };
  if (!store || typeof store.getItem !== 'function') return vazio;
  let bruto = null;
  try { bruto = JSON.parse(store.getItem(CHAVE) || 'null'); } catch { return vazio; }
  if (!bruto || typeof bruto !== 'object') return vazio;

  const cores = {};
  for (const [k, v] of Object.entries(bruto.cores || {})) if (corValida(v)) cores[k] = v.trim();

  const agentes = (Array.isArray(bruto.agentes) ? bruto.agentes : [])
    .filter((a) => a && typeof a === 'object' && nomeCurto(a.nome) && typeof a.dept === 'string')
    .slice(0, 60)
    .map((a) => ({
      id: String(a.id || '').slice(0, 40) || idDeAgente(a.nome),
      nome: nomeCurto(a.nome),
      dept: String(a.dept).slice(0, 20),
      funcao: String(a.funcao || 'Agente acrescentado pelo dono').slice(0, 120),
    }));
  return { cores, agentes };
}

export function gravarAjustes(store, ajustes) {
  const limpos = lerAjustes({ getItem: () => JSON.stringify(ajustes) });
  try { store?.setItem?.(CHAVE, JSON.stringify(limpos)); } catch { /* sem armazenamento */ }
  return limpos;
}

/**
 * Aplica os ajustes aos objectos que a cena vai ler — no lugar, porque a cena
 * arranca logo a seguir e não há tempo para voltar a assentar tudo.
 * Devolve um resumo do que mudou (é isso que a interface mostra).
 */
export function aplicarNaCena({ DEPTS, LAYOUT, AGENTS }, ajustes) {
  const cores = [];
  for (const [dept, cor] of Object.entries(ajustes?.cores || {})) {
    if (!DEPTS[dept] || !corValida(cor)) continue;
    DEPTS[dept].chip = cor;
    DEPTS[dept].ink = corDoVidro(cor);
    DEPTS[dept].glass = corDoVidro(cor);
    cores.push(dept);
  }

  const existentes = new Set(AGENTS.map((a) => a.id));
  const entraram = [];
  for (const extra of ajustes?.agentes || []) {
    if (!DEPTS[extra.dept] || existentes.has(extra.id)) continue;
    if (contarAgentes(AGENTS, extra.dept) >= MAX_POR_SALA) continue;
    const grid = lugarLivre(AGENTS, extra.dept);
    AGENTS.push({
      id: extra.id, name: extra.nome.toUpperCase(), dept: extra.dept, grid,
      hair: '#1c1c1e', skin: '#E8B98E', acrescentado: true, funcao: extra.funcao,
    });
    existentes.add(extra.id);
    entraram.push(extra.id);
  }

  const planta = plantaAjustada(LAYOUT, AGENTS);
  const salas = {};
  for (const [dept, L] of Object.entries(planta)) {
    LAYOUT[dept].d = L.d;
    salas[dept] = { filas: L.filas, profundidade: L.d, agentes: contarAgentes(AGENTS, dept) };
  }
  return { cores, entraram, salas };
}
