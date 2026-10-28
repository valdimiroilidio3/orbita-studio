/* ===========================================================================
   1.49.0 · PROVA DO MEM0 — 28 out 2026

   `GET /api/prova-mem0?token=<PROVA_TOKEN>`

   Uma volta completa, em produção, à memória semântica: **escreve** uma nota
   marcada, **procura-a**, confirma que voltou, e **apaga-a**. Não deixa lixo no
   Mem0 nem na base local.

   Serve para uma coisa só: provar de fora que a chave responde, que a escrita
   entra e que a procura a encontra — em vez de acreditar no `ligada: true` de
   um ping. Protegida pelo `PROVA_TOKEN`, como a `prova1`.

   Devolve, sem inventar: `escrita`, `procura`, `apagada`, `ms` e, se algo
   falhar, o motivo exacto devolvido pelo Mem0.
   =========================================================================== */
export const config = { maxDuration: 30 };

import { createSupabaseRepo, envBase } from './_repo.mjs';
import { envDoPedido } from './_env.mjs';
import * as mem0 from './_ia/mem0.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = new URL(String(req.url || '/'), 'http://x').searchParams;
  if (!process.env.PROVA_TOKEN || q.get('token') !== process.env.PROVA_TOKEN) {
    res.status(404).json({ error: 'não existe' });
    return;
  }
  const base = envBase();
  if (!base.pronto) { res.status(503).json({ error: 'base não configurada' }); return; }

  const env = envDoPedido(req);
  const repo = createSupabaseRepo(base);
  const cfg = mem0.config(env);
  const saida = { versao: '1.49.0', configurada: mem0.configurada(cfg) };

  if (!saida.configurada) {
    saida.erro = 'falta MEM0_API_KEY no ambiente desta função';
    res.status(503).json(saida);
    return;
  }

  const marca = `prova-${Date.now()}`;
  const texto = `Prova da memória semântica ${marca}: o dono prefere respostas curtas, em português de Portugal, sem anglismos.`;

  try {
    const escrita = await mem0.adicionar(cfg, {
      texto,
      titulo: 'Prova Mem0',
      metadados: { prova: marca, projeto: 'prova' },
    });
    saida.escrita = { ok: escrita.ok, id: escrita.id || null, ms: escrita.ms || null, erro: escrita.ok ? null : escrita.motivo };
    if (!escrita.ok) { res.status(502).json(saida); return; }

    /* o índice semântico do Mem0 não é instantâneo: tenta três vezes, com espera */
    let procura = null;
    for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
      procura = await mem0.pesquisar(cfg, { consulta: 'como prefere que lhe respondam', limite: 10 });
      const achou = (procura.achados || []).some((a) => String(a.texto).includes(marca));
      saida.procura = { ok: procura.ok, tentativa, achou, achados: (procura.achados || []).length, ms: procura.ms || null, erro: procura.ok ? null : procura.motivo };
      if (achou) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    /* Apagar pelo que a procura encontrou, não só pelo id da escrita: quando o
       Mem0 responde com um `event_id` (extracção assíncrona) não há id na
       resposta, e uma prova que deixa lixo no projecto não é uma prova. */
    const aApagar = new Set();
    if (saida.escrita.id) aApagar.add(saida.escrita.id);
    for (const a of procura?.achados || []) {
      if (String(a.texto).includes(marca)) aApagar.add(String(a.id).replace(/^mem0:/, ''));
    }
    /* e uma varredura das notas recentes: apanha provas antigas que ficaram */
    const recentes = await mem0.listar(cfg, { limite: 100 });
    for (const m of recentes.memorias || []) {
      if (String(m.texto).includes('Prova da memória semântica prova-') || String(m.texto).includes(marca)) {
        aApagar.add(String(m.id).replace(/^mem0:/, ''));
      }
    }

    const apagadas = [];
    const falhasAoApagar = [];
    for (const id of aApagar) {
      const r = await mem0.apagar(cfg, id);
      if (r.ok) apagadas.push(r.apagada); else falhasAoApagar.push({ id, erro: r.motivo });
    }
    saida.apagada = { ok: falhasAoApagar.length === 0, quantas: apagadas.length, ids: apagadas, falhas: falhasAoApagar };

    /* a nota local também fica limpa: esta prova não é conteúdo do dono */
    try {
      const notas = await repo.ia.memoria.listar({ limite: 500 });
      for (const n of notas.filter((x) => String(x.texto || '').includes(marca))) await repo.ia.memoria.apagar(n.id);
    } catch { /* a base local é um extra nesta prova */ }

    saida.resultado = saida.escrita.ok && saida.procura?.achou ? 'a memória semântica escreve e encontra' : 'a memória escreveu mas não se encontrou';
    res.status(saida.escrita.ok ? 200 : 502).json(saida);
  } catch (e) {
    saida.erro = String(e.message || e).slice(0, 300);
    res.status(500).json(saida);
  }
}
