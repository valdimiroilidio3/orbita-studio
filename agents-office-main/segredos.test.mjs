// A guarda dos segredos (1.25.0, 27 out 2026).
//
// O dono deu duas chaves e pediu «depois criptografa tudo». A parte que depende
// de mim é esta: garantir que nenhuma chave entra no repositório — nem hoje, nem
// num commit distraído daqui para a frente. Este teste corre com a suite e falha
// se encontrar o formato de uma chave verdadeira num ficheiro versionado.
//
// O que NÃO se prova aqui: que a Vercel guarda as variáveis cifradas (isso é da
// plataforma, e está declarado em docs/SEGREDOS.md). O que se prova é o que está
// ao nosso alcance: o repositório não as tem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const raiz = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

/* Formatos que nunca podem aparecer num ficheiro versionado. */
const PADROES = [
  { nome: 'chave de desenvolvimento da Tavily', re: /tvly-[A-Za-z0-9_-]{16,}/ },
  { nome: 'chave da Geoapify (32 hex)', re: /\b[0-9a-f]{32}\b(?=[^\n]{0,40}apiKey)|apiKey=[0-9a-f]{32}/i },
  { nome: 'chave da Google (AIza…)', re: /AIza[0-9A-Za-z_-]{35}/ },
  { nome: 'chave OpenAI (sk-…)', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { nome: 'token do GitHub (ghp_/gho_)', re: /\bgh[pou]_[A-Za-z0-9]{36}\b/ },
  { nome: 'chave secreta do Supabase', re: /\bsb_secret_[A-Za-z0-9_-]{16,}/ },
  { nome: 'URL de base de dados com password', re: /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/ },
];

/* Ficheiros que são exemplos por natureza: só valem se não tiverem chaves a sério
   (os padrões acima já os apanham; esta lista serve para excluir binários). */
const IGNORAR = [/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|mp3|mp4|zip|pdf)$/i, /^dist\//];

test('segredos: nenhum ficheiro versionado tem o formato de uma chave verdadeira', () => {
  const ficheiros = execFileSync('git', ['ls-files', '-z'], { cwd: raiz, encoding: 'utf8' })
    .split('\0').filter(Boolean)
    .filter((f) => !IGNORAR.some((re) => re.test(f)));

  const achados = [];
  for (const rel of ficheiros) {
    const abs = path.join(raiz, rel);
    let bruto;
    try {
      const st = fs.statSync(abs);
      if (st.size > 2 * 1024 * 1024) continue;
      bruto = fs.readFileSync(abs, 'utf8');
    } catch { continue; }
    if (bruto.includes('\0')) continue; // binário
    for (const p of PADROES) {
      const m = bruto.match(p.re);
      if (m) achados.push(`${rel}: ${p.nome} (${m[0].slice(0, 6)}…)`);
    }
  }
  assert.deepEqual(achados, [], `há segredos em ficheiros versionados:\n${achados.join('\n')}`);
});

test('segredos: o .gitignore fecha as portas óbvias', () => {
  const txt = fs.readFileSync(path.join(raiz, 'agents-office-main/.gitignore'), 'utf8');
  for (const alvo of ['.env', 'node_modules']) assert.ok(txt.includes(alvo), `.gitignore não cobre ${alvo}`);
});

test('segredos: as chaves vivem no ambiente, e o código lê-as de lá', () => {
  const base = path.join(raiz, 'agents-office-main');
  const pesquisa = fs.readFileSync(path.join(base, 'api/_pesquisa.mjs'), 'utf8');
  for (const v of ['GEOAPIFY_API_KEY', 'TAVILY_API_KEY']) assert.ok(pesquisa.includes(v), `a pesquisa não conhece ${v}`);
  /* nenhuma chave escrita à mão no módulo que as usa */
  assert.equal(/apiKey\s*[:=]\s*['"][0-9a-f]{20,}['"]/i.test(pesquisa), false);
  /* a função que mostra segredos existe e mascara */
  assert.ok(pesquisa.includes('export const mascarar'));
});
