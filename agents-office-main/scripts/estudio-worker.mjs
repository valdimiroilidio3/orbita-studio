#!/usr/bin/env node
/* ===========================================================================
   1.19.0 · WORKER DO ESTÚDIO (OpenMontage) — 27 out 2026

   Corre numa máquina que tenha o OpenMontage instalado (Python, FFmpeg, Node).
   Não corre na Vercel, e é isso que se diz na mesa quando não há worker.

   O ciclo:
     1. `sinal`   — diz à mesa o que está instalado (versão, commit, demos, ffmpeg)
     2. `assumir` — pega o próximo trabalho da fila (o servidor marca `a_correr`)
     3. corre     — `python render_demo.py <demo>` no directório do OpenMontage
     4. devolve   — `concluir` com o caminho do ficheiro, ou `falhar` com o erro

   Uso:
     ORBITA_URL=https://orbita-agentes.vercel.app \
     MEDIA_WORKER_TOKEN=… \
     OPENMONTAGE_DIR=~/OpenMontage \
     node scripts/estudio-worker.mjs            # ciclo contínuo (20 s)
     node scripts/estudio-worker.mjs --uma-vez  # processa no máximo um trabalho
     node scripts/estudio-worker.mjs --doutor   # só diagnostica e sai

   Nada aqui inventa resultados: o que vai para a mesa é o que o comando disse.
   =========================================================================== */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const URL_BASE = (process.env.ORBITA_URL || 'https://orbita-agentes.vercel.app').replace(/\/+$/, '');
const TOKEN = process.env.MEDIA_WORKER_TOKEN || '';
const DIR = (process.env.OPENMONTAGE_DIR || path.join(os.homedir(), 'OpenMontage')).replace(/^~/, os.homedir());
const UMA_VEZ = process.argv.includes('--uma-vez');
const SO_DOUTOR = process.argv.includes('--doutor');

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function temComando(cmd) {
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return r.status === 0;
}

function pythonDoProjecto() {
  const venv = path.join(DIR, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv;
  const venvWin = path.join(DIR, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvWin)) return venvWin;
  return 'python3';
}

function git(campo) {
  const r = spawnSync('git', ['-C', DIR, campo], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function demos() {
  const py = pythonDoProjecto();
  const r = spawnSync(py, ['render_demo.py', '--list'], { cwd: DIR, encoding: 'utf8' });
  if (r.status !== 0) return { ok: false, erro: (r.stderr || r.stdout || 'render_demo.py falhou').slice(-600), lista: [] };
  const lista = r.stdout.split('\n').slice(1).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  return { ok: true, lista };
}

function doutor() {
  const existe = fs.existsSync(DIR) && fs.existsSync(path.join(DIR, 'render_demo.py'));
  const d = existe ? demos() : { ok: false, erro: `não encontrei o OpenMontage em ${DIR} (define OPENMONTAGE_DIR)`, lista: [] };
  return {
    versao: existe ? (() => { try { return JSON.parse(fs.readFileSync(path.join(DIR, 'package.json'), 'utf8')).version || '0.1.0'; } catch { return '0.1.0'; } })() : null,
    commit: existe ? git('rev-parse --short HEAD') : null,
    pipelines: d.lista,
    ferramentas: { python: temComando(pythonDoProjecto()), ffmpeg: temComando('ffmpeg'), node: temComando('node'), git: temComando('git') },
    erroDemos: d.ok ? null : d.erro,
  };
}

async function chamar(caminho, corpo = {}) {
  const r = await fetch(`${URL_BASE}/api/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caminho, metodo: 'POST', corpo: { ...corpo, token: TOKEN } }),
  });
  const texto = await r.text();
  let j = null;
  try { j = JSON.parse(texto); } catch { j = { erro: texto.slice(0, 300) }; }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${String(j?.erro || j?.error || texto).slice(0, 300)}`);
  return j.corpo !== undefined ? j.corpo : j;
}

function correrTrabalho(job) {
  const py = pythonDoProjecto();
  const d = demos();
  if (!d.ok) return { ok: false, motivo: `o OpenMontage não respondeu: ${d.erro}` };

  const pedido = String(job.pipeline || '');
  const demo = d.lista.includes(pedido) ? pedido : d.lista[0];
  if (!demo) return { ok: false, motivo: 'o OpenMontage não tem demos instaladas' };

  const antes = new Set(listarRenders());
  log(`a renderizar demo «${demo}» (pedido: ${job.pedido.slice(0, 80)})`);
  const r = spawnSync(py, ['render_demo.py', demo], { cwd: DIR, encoding: 'utf8', timeout: 20 * 60 * 1000 });
  const saida = `${r.stdout || ''}\n${r.stderr || ''}`.trim();

  if (r.status !== 0) return { ok: false, motivo: `render_demo.py saiu com ${r.status}: ${saida.slice(-600)}` };

  const novos = listarRenders().filter((f) => !antes.has(f));
  const ficheiro = novos[0] || listarRenders()[0] || null;
  return {
    ok: true,
    resposta: { demo, ficheiro, saida: saida.slice(-1200) },
    url: null,                                  // fica no disco do worker; a mesa mostra o caminho
    nota: ficheiro ? `ficheiro local: ${ficheiro} (o worker não o publica sozinho)` : 'o comando correu mas não encontrei o ficheiro de saída',
  };
}

function listarRenders() {
  const dir = path.join(DIR, 'projects', 'demos', 'renders');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')).map((f) => path.join(dir, f));
}

async function ciclo() {
  const info = doutor();
  await chamar('/media/sinal', info).catch((e) => log('sinal falhou:', e.message));
  log(`sinal enviado · demos: ${info.pipelines.length} · ffmpeg: ${info.ferramentas.ffmpeg ? 'sim' : 'NÃO'} · python: ${info.ferramentas.python ? 'sim' : 'NÃO'}`);
  if (!info.ferramentas.ffmpeg) log('aviso: sem ffmpeg os renders falham — instala ffmpeg primeiro');

  const { trabalho } = await chamar('/media/assumir', {});
  if (!trabalho) { log('fila vazia'); return false; }

  log(`trabalho ${trabalho.id}: ${trabalho.pedido.slice(0, 80)}`);
  const r = correrTrabalho(trabalho);
  if (r.ok) {
    await chamar(`/media/${trabalho.id}/concluir`, { url: r.url, resposta: { ...r.resposta, nota: r.nota }, pipeline: r.resposta.demo });
    log(`concluído (${r.nota})`);
  } else {
    await chamar(`/media/${trabalho.id}/falhar`, { motivo: r.motivo });
    log(`falhou: ${r.motivo.slice(0, 160)}`);
  }
  return true;
}

async function principal() {
  if (SO_DOUTOR) { console.log(JSON.stringify(doutor(), null, 2)); return; }
  if (!TOKEN) { console.error('falta MEDIA_WORKER_TOKEN'); process.exit(2); }
  log(`worker do estúdio · ${URL_BASE} · OpenMontage em ${DIR}`);

  if (UMA_VEZ) { await ciclo(); return; }
  for (;;) {
    try { await ciclo(); } catch (e) { log('erro no ciclo:', e.message); }
    await new Promise((r) => setTimeout(r, 20_000));
  }
}

principal().catch((e) => { console.error(e); process.exit(1); });
