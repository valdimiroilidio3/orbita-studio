// Órbita — os testes das CONFIGURAÇÕES (29 out 2026).
//
// Pedido do dono: «cria um campo para implementação de APIs, configurações reais, até mudança de tema
// (claro para escuro) e notificações reais».
//
// O que se prova aqui é a lógica que pode mentir calada: se a preferência de tema sobrevive, se o
// sistema manda quando a escolha é «automático», se um aviso só sai quando um estado MUDA (e não a
// cada retrato do servidor), e se uma chave escrita no `.env` não estraga as outras nem volta para o
// browser. Nada disto precisa de browser nem de rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { THEME_KEY, normalizeTheme, readTheme, writeTheme, resolveTheme } from './src/theme.js';
import { changes, due, textFor, setPref, prefEnabled, NOTIFY_KEY, NOTIFY_MIN_GAP_MS } from './src/notify.js';
import { readPrefs, writePrefs, PREFS_KEY } from './src/config.js';
import { upsertEnv, createPlatform, parseEnvFile } from './platform.mjs';

const memStore = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-config-'));

/* ---------- o tema ---------- */

test('tema: o que não é um tema conhecido cai em «automático»', () => {
  assert.equal(normalizeTheme('escuro'), 'dark');
  assert.equal(normalizeTheme('CLARO'), 'light');
  assert.equal(normalizeTheme('noite'), 'dark');
  assert.equal(normalizeTheme(''), 'auto');
  assert.equal(normalizeTheme('roxo'), 'auto');
  assert.equal(normalizeTheme(undefined), 'auto');
});

test('tema: a escolha fica guardada e volta igual', () => {
  const s = memStore();
  assert.equal(readTheme(s), 'auto', 'sem nada guardado, começa no automático');
  writeTheme('dark', s);
  assert.equal(s._m.get(THEME_KEY), 'dark');
  assert.equal(readTheme(s), 'dark');
  writeTheme('light', s);
  assert.equal(readTheme(s), 'light');
});

test('tema: «automático» segue o sistema, uma escolha explícita não', () => {
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('light', true), 'light', 'uma escolha explícita ganha ao sistema');
  assert.equal(resolveTheme('dark', false), 'dark');
});

/* ---------- os avisos ---------- */

const retrato = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { state: v }]));

test('avisos: só conta o que MUDOU — um posto já à espera não é notícia', () => {
  const a = retrato({ x: 'live', y: 'idle' });
  const b = retrato({ x: 'waiting', y: 'idle' });
  const c = retrato({ x: 'waiting', y: 'error' });
  assert.deepEqual(changes({}, a).map((e) => e.id), [], 'o primeiro retrato é o ponto de partida');
  assert.deepEqual(changes(a, b).map((e) => e.id), ['x']);
  assert.deepEqual(changes(b, c).map((e) => e.id), ['y']);
  assert.deepEqual(changes(b, retrato({ x: 'live', y: 'idle' })), [], 'voltar a «idle» não é aviso');
});

test('avisos: o mesmo posto não repete o aviso ao segundo', () => {
  const ev = [{ id: 'x', state: 'waiting', task: 'proposta para a Webempresas' }];
  const now = 1_000_000;
  const um = due(ev, {}, now);
  assert.equal(um.send.length, 1);
  const dois = due(ev, um.sent, now + 5_000);
  assert.equal(dois.send.length, 0, 'cinco segundos depois ainda não se repete');
  const tres = due(ev, um.sent, now + NOTIFY_MIN_GAP_MS + 1);
  assert.equal(tres.send.length, 1, 'passado o intervalo, pode voltar a avisar');
});

test('avisos: uma torrente de postos não abre vinte janelas', () => {
  const ev = Array.from({ length: 10 }, (_, i) => ({ id: 'a' + i, state: 'waiting' }));
  const r = due(ev, {}, 1_000_000); // já passou muito tempo desde o último aviso
  assert.equal(r.send.length, 3, 'no máximo três por vez');
});

test('avisos: o texto diz o que aconteceu, em português', () => {
  const w = textFor({ id: 'x', state: 'waiting', task: 'proposta' });
  assert.match(w.title, /OK/);
  assert.match(w.body, /proposta/);
  const e = textFor({ id: 'y', state: 'error', task: 'deploy' });
  assert.match(e.title, /Falhou/);
  assert.match(e.body, /deploy/);
});

test('avisos: a preferência é guardada, e por omissão está desligada', () => {
  const s = memStore();
  assert.equal(prefEnabled(s), false);
  setPref(s, true);
  assert.equal(s._m.get(NOTIFY_KEY), '1');
  assert.equal(prefEnabled(s), true);
  setPref(s, false);
  assert.equal(prefEnabled(s), false);
});

/* ---------- os painéis ---------- */

test('painéis: recolher o campo de IA e o estado das tarefas fica lembrado', () => {
  const s = memStore();
  assert.deepEqual(readPrefs(s), { ai: false, tasks: false });
  writePrefs({ ai: true, tasks: false }, s);
  assert.deepEqual(readPrefs(s), { ai: true, tasks: false });
  assert.ok(JSON.parse(s._m.get(PREFS_KEY)));
  // lixo guardado não rebenta a leitura
  s.setItem(PREFS_KEY, 'isto não é json');
  assert.deepEqual(readPrefs(s), { ai: false, tasks: false });
});

/* ---------- o .env ---------- */

test('.env: escrever uma chave não perde o resto nem duplica', () => {
  const antes = '# as minhas chaves\nOPENAI_API_KEY=velha\nSTRIPE_SECRET_KEY=sk_1\n';
  const depois = upsertEnv(antes, { OPENAI_API_KEY: 'nova' });
  assert.match(depois, /^# as minhas chaves$/m, 'os comentários ficam');
  assert.match(depois, /OPENAI_API_KEY=nova/);
  assert.match(depois, /STRIPE_SECRET_KEY=sk_1/, 'as outras chaves ficam');
  assert.equal(depois.match(/OPENAI_API_KEY=/g).length, 1, 'nem uma linha duplicada');
});

test('.env: um valor vazio apaga a chave; um valor com espaços fica entre aspas', () => {
  const t = 'OPENAI_API_KEY=velha\nGEMINI_API_KEY=antiga\n';
  const sem = upsertEnv(t, { OPENAI_API_KEY: '' });
  assert.doesNotMatch(sem, /OPENAI_API_KEY/);
  assert.match(sem, /GEMINI_API_KEY=antiga/);
  const comEspacos = upsertEnv('', { NOME: 'duas palavras' });
  assert.match(comEspacos, /NOME="duas palavras"/);
  assert.equal(parseEnvFile(comEspacos).NOME, 'duas palavras');
});

test('chaves: o servidor grava, relê e SONDA — e o resultado é o da sonda', async () => {
  const root = tmp();
  const env = {};
  let pedidos = 0;
  const fetchImpl = async (url) => {
    pedidos += 1;
    assert.match(String(url), /api\.openai\.com/);
    return { ok: true, status: 200, statusText: 'OK', clone() { return this; }, json: async () => ({ data: [] }) };
  };
  const p = createPlatform({ root, env, fetchImpl });
  const r = await p.saveKey({ id: 'openai', values: { OPENAI_API_KEY: 'sk-teste-123' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.saved, ['OPENAI_API_KEY']);
  assert.equal(r.probe.ok, true);
  assert.equal(r.probe.status, 200);
  assert.equal(pedidos, 1);
  const escrito = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(escrito, /OPENAI_API_KEY=sk-teste-123/);
  const api = r.apis.list.find((x) => x.id === 'openai');
  assert.equal(api.configured, true);
  assert.equal(api.verified, true, 'só fica «pronta» depois da sonda responder');
});

test('chaves: não sai daqui o valor, nem se aceita uma variável de outro serviço', async () => {
  const root = tmp();
  const p = createPlatform({ root, env: {}, fetchImpl: async () => ({ ok: true, status: 200, clone() { return this; }, json: async () => ({}) }) });
  const mau = await p.saveKey({ id: 'openai', values: { STRIPE_SECRET_KEY: 'sk_live_x' } });
  assert.equal(mau.ok, false);
  assert.match(mau.error, /não pertence/);
  assert.equal(fs.existsSync(path.join(root, '.env')), false, 'nada foi escrito');
  const ok = await p.saveKey({ id: 'openai', values: { OPENAI_API_KEY: 'sk-segredo-999' } });
  assert.equal(ok.ok, true);
  const json = JSON.stringify(ok);
  assert.doesNotMatch(json, /sk-segredo-999/, 'o valor da chave nunca volta na resposta');
  const desconhecido = await p.saveKey({ id: 'nao-existe', values: { X: '1' } });
  assert.equal(desconhecido.ok, false);
  assert.ok(Array.isArray(desconhecido.known));
});

test('chaves: sem chave completa ainda não há sonda — diz o que falta', async () => {
  const root = tmp();
  const p = createPlatform({ root, env: {}, fetchImpl: async () => { throw new Error('não devia ser chamado'); } });
  const r = await p.saveKey({ id: 'supabase', values: { SUPABASE_URL: 'https://exemplo.supabase.co' } });
  assert.equal(r.ok, true);
  assert.equal(r.configured, false);
  assert.deepEqual(r.missing, ['SUPABASE_SERVICE_ROLE_KEY']);
  assert.equal(r.probe, null, 'não se sonda um serviço a meio');
});
