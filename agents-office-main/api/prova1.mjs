/* PROVA TEMPORÁRIA (1.19.2) — uma execução completa, em produção, com um
   fornecedor keyless (LLM7). GET /api/_prova?token=<PROVA_TOKEN>

   Não fica no repositório: existe só para esta entrega e é apagado a seguir. */
export const config = { maxDuration: 60 };

import { createSupabaseRepo, envBase } from './_repo.mjs';
import { criarMotor } from './_ia/motor.mjs';
import { correr } from './_ia/orquestrador.mjs';
import { envDoPedido } from './_env.mjs';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const q = new URL(String(req.url || '/'), 'http://x').searchParams;
  if (!process.env.PROVA_TOKEN || q.get('token') !== process.env.PROVA_TOKEN) { res.status(404).json({ error: 'não existe' }); return; }
  const base = envBase();
  if (!base.pronto) { res.status(503).json({ error: 'base não configurada' }); return; }

  const env = envDoPedido(req);
  const repo = createSupabaseRepo(base);
  const motor = criarMotor({ repo, env });
  const saida = {};

  try {
    const est = await motor.estado();
    saida.fornecedoresProntos = est.fornecedores.filter((f) => f.configurado).map((f) => `${f.id}${f.variavel ? '' : ' (sem chave)'}`);

    const fase = q.get('fase') || 'tudo';
    const testes = {};
    if (fase !== 'correr') {
      for (const id of ['llm7', 'ovh'].filter((x) => saida.fornecedoresProntos.some((y) => y.startsWith(x)))) {
        try { testes[id] = await motor.testar(id); } catch (e) { testes[id] = { ok: false, erro: String(e.message).slice(0, 160) }; }
        if (testes[id].ok) break;
      }
      saida.testes = testes;
    }
    if (fase === 'teste') { res.status(200).json(saida); return; }

    /* A Vercel AI Gateway está configurada por OIDC mas recusa sem cartão: cada
       chamada gastava duas tentativas antes de chegar ao LLM7. Desliga-se para
       esta prova — e o registo diz isso mesmo. */
    await repo.ia.config.gravar('desligados', ['vercel']);
    /* Um só modelo, o mais directo do LLM7, para o planeamento e a revisão não
       andarem a saltar entre candidatos dentro dos 60 s da função. */
    await repo.ia.config.gravar('agentes', {
      orchestrator: { modelo: { fornecedor: 'llm7', modelo: 'gpt-oss-20b' } },
      reviewer: { modelo: { fornecedor: 'llm7', modelo: 'gpt-oss-20b' } },
    });

    if (fase === 'correr' || Object.values(testes).some((t) => t.ok)) {
      const run = await correr({
        repo, motor,
        objetivo: 'Contar quantos leads existem agora na base e escrever uma nota de memória com esse número real.',
        limites: { maxChamadas: 4, maxTokens: 40000 },
        env,
      });
      const passos = await repo.ia.steps.porRun(run.id);
      const mem = await repo.ia.memoria.listar({ limite: 5 });
      saida.run = {
        id: run.id, estado: run.estado, modelo: run.modelo, fornecedor: run.fornecedor,
        passos: passos.map((p) => ({ ordem: p.ordem, agente: p.agente, estado: p.estado, modelo: p.modelo, ferramentas: (p.ferramentas || []).map((f) => `${f.nome}:${f.ok}`) })),
        revisao: run.revisao ? { decisao: run.revisao.decisao, justificacao: String(run.revisao.justificacao || '').slice(0, 300) } : null,
        erro: run.erro || null,
        resultado: String(run.resultado || '').slice(0, 900),
        artefactos: run.artefactos ? { limites: run.artefactos.limites, orcamento: run.artefactos.orcamento, ferramentas: run.artefactos.ferramentasUsadas } : null,
      };
      saida.memoria = { notas: mem.length, ultima: mem[0] ? { titulo: mem[0].titulo, fonte: mem[0].fonte } : null };
    }
  } catch (e) {
    saida.erro = String(e.message || e).slice(0, 500);
  }
  res.status(200).json(saida);
}
