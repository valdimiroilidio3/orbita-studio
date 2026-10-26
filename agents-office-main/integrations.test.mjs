import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as mcpConfig from './mcp.mjs';
import {
  apiTokenOk, integrationStatus, normalizeLead, saveLeads, listLeads, updateLead,
  createContentDraft, listContentDrafts, suppressEmail, sendApprovedEmail,
  geminiAssist, publishInstagram, getIntegrationError, whatsappClickToChatUrl, triggerVercelDeploy, githubWriteFile,
} from './integrations.mjs';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-integrations-'));
const withEnv = async (values, fn) => {
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]));
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null) delete process.env[k]; else process.env[k] = String(v);
  }
  try { return await fn(); }
  finally { for (const [k, v] of Object.entries(previous)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};

test('API token validation rejects absent/short tokens and checks bearer tokens', async () => {
  await withEnv({ ORBITA_API_TOKEN: 'x' }, () => assert.equal(apiTokenOk({ headers: { authorization: 'Bearer x' } }), false));
  const secret = '1234567890abcdef1234567890abcdef';
  await withEnv({ ORBITA_API_TOKEN: secret }, () => {
    assert.equal(apiTokenOk({ headers: { authorization: `Bearer ${secret}` } }), true);
    assert.equal(apiTokenOk({ headers: { authorization: 'Bearer wrongwrongwrongwrongwrongwrong' } }), false);
  });
});

test('integration status reports configuration only and never reveals secret values', async () => {
  const marker = 'this-is-a-secret-test-marker';
  await withEnv({ GEMINI_API_KEY: marker, RESEND_API_KEY: '', ORBITA_EMAIL_FROM: '' }, () => {
    const status = integrationStatus();
    assert.equal(status.providers.find(p => p.id === 'gemini').ready, true);
    assert.equal(JSON.stringify(status).includes(marker), false);
    assert.equal(status.providers.find(p => p.id === 'openstreetmap').ready, true);
  });
});

test('lead normalization validates required fields and deduplicates by website domain', () => {
  const lead = normalizeLead({ name: '  Café Exemplo ', website: 'www.example.pt', city: 'Coimbra', source: 'import' });
  assert.equal(lead.companyName, 'Café Exemplo');
  assert.equal(lead.website, 'https://www.example.pt/');
  assert.equal(lead.dedupeKey, 'domain:example.pt');
  assert.throws(() => normalizeLead({ website: 'example.pt' }), /companyName é obrigatório/);
  assert.throws(() => normalizeLead({ companyName: 'A', email: 'invalid' }), /publicEmail inválido/);
});

test('local CRM persists leads, skips duplicates and updates status', async () => {
  const dir = tempDir();
  try {
    await withEnv({ SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, async () => {
      const first = await saveLeads(dir, [{ companyName: 'Empresa A', website: 'https://empresa.pt', city: 'Coimbra' }]);
      const duplicate = await saveLeads(dir, [{ companyName: 'Empresa A outra designação', website: 'https://empresa.pt', city: 'Porto' }]);
      assert.equal(first.saved, 1);
      assert.equal(duplicate.saved, 0);
      const listed = await listLeads(dir, 10);
      assert.equal(listed.length, 1);
      const updated = await updateLead(dir, listed[0].id, { status: 'qualified', notes: 'Possível oportunidade.' });
      assert.equal(updated.status, 'qualified');
      assert.equal((await listLeads(dir, 10))[0].notes, 'Possível oportunidade.');
    });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('content queue saves drafts and never marks them as published automatically', () => {
  const dir = tempDir();
  try {
    const draft = createContentDraft(dir, { projectName: 'Site Demo', platform: 'instagram', caption: 'Conhece o novo projeto.', imageUrl: 'https://cdn.example.pt/site.png' });
    assert.equal(draft.status, 'draft');
    assert.equal(listContentDrafts(dir, 10)[0].id, draft.id);
    assert.equal(listContentDrafts(dir, 10)[0].publishedAt, null);
    assert.throws(() => createContentDraft(dir, { projectName: 'Site', caption: 'x', imageUrl: 'http://insecure.example/site.png' }), /https:\/\//i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('email suppression is persisted and blocks sending before provider credentials are needed', async () => {
  const dir = tempDir();
  try {
    suppressEmail(dir, 'client@example.pt', 'requested opt-out');
    await assert.rejects(() => sendApprovedEmail(dir, { approved: true, recipientConsent: true, consentReference: 'ticket-123', purpose: 'requested_follow_up', to: 'client@example.pt', subject: 'Follow up', text: 'Hello' }), /lista de supressão/);
    await assert.rejects(() => sendApprovedEmail(dir, { approved: false, to: 'client@example.pt' }), /aprovação humana/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('optional providers fail closed when keys or approval are missing', async () => {
  await withEnv({ GEMINI_API_KEY: '' }, async () => assert.rejects(() => geminiAssist({ task: 'social', data: { projectName: 'Demo' } }), /não está configurado/));
  await withEnv({ META_ACCESS_TOKEN: '', META_IG_USER_ID: '', META_GRAPH_API_VERSION: '' }, async () => {
    await assert.rejects(() => publishInstagram({ approved: false }), /approved=true/);
    await assert.rejects(() => publishInstagram({ approved: true, imageUrl: 'https://example.com/image.png', caption: 'Demo' }), /não configurado/);
  });
});

test('GitHub file writes fail closed without approval/token and block sensitive paths', async () => {
  await withEnv({ GITHUB_TOKEN: '' }, async () => {
    await assert.rejects(() => githubWriteFile({ approved: false }), /pedido explícito|approved=true/);
    await assert.rejects(() => githubWriteFile({ approved: true, owner: 'owner', repo: 'repo', path: 'src/app.ts', content: 'export {}', message: 'test', branch: 'main' }), /não configurada/);
  });
  await withEnv({ GITHUB_TOKEN: 'example-write-token-not-used' }, async () => {
    await assert.rejects(() => githubWriteFile({ approved: true, owner: 'owner', repo: 'repo', path: '.env', content: 'API_KEY=secret', message: 'never', branch: 'main' }), /recusado por segurança/);
    await assert.rejects(() => githubWriteFile({ approved: true, owner: 'owner', repo: 'repo', path: '../secret.txt', content: 'nope', message: 'never', branch: 'main' }), /path inválido/);
    await assert.rejects(() => githubWriteFile({ approved: true, owner: 'owner', repo: 'repo', path: 'src/app.ts', content: 'export {}', message: 'x', branch: 'bad..branch' }), /branch inválida|message é obrigatório/);
  });
});

test('Vercel deployment fails closed without explicit approval or a valid secret hook', async () => {
  await withEnv({ VERCEL_DEPLOY_HOOK_URL: '' }, async () => {
    await assert.rejects(() => triggerVercelDeploy({ approved: false }), /approved=true/);
    await assert.rejects(() => triggerVercelDeploy({ approved: true }), /não configurado ou inválido/);
  });
  await withEnv({ VERCEL_DEPLOY_HOOK_URL: 'https://evil.example/v1/integrations/deploy/project/secret' }, async () => {
    await assert.rejects(() => triggerVercelDeploy({ approved: true }), /não configurado ou inválido/);
  });
});

test('provider error mapping keeps rate-limit and auth failures understandable', () => {
  assert.equal(getIntegrationError(Object.assign(new Error('too many'), { status: 429 })).status, 429);
  assert.equal(getIntegrationError(Object.assign(new Error('no'), { status: 401 })).status, 502);
  assert.equal(getIntegrationError(Object.assign(new Error('missing'), { status: 404 })).status, 404);
});

test('WhatsApp helper returns a safe click-to-chat link and never sends automatically', () => {
  const result = whatsappClickToChatUrl('+351 912 345 678', 'Olá, gostaria de mostrar um exemplo.');
  assert.equal(result.url.startsWith('https://wa.me/351912345678?text='), true);
  assert.equal(result.doesNotSend, true);
  assert.throws(() => whatsappClickToChatUrl('912345678', 'Olá'), /formato internacional/);
  assert.equal(whatsappClickToChatUrl('00351 912 345 678').phone, '+351912345678');
});


test('local MCP server speaks JSON-RPC and exposes ORBITA tools', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, ['mcp-servers/orbita-integrations/index.mjs'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  const stderr = [];
  child.stderr.on('data', chunk => stderr.push(String(chunk)));
  const readLine = () => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { lines.removeListener('line', onLine); reject(new Error(`MCP response timeout. stderr=${stderr.join('')}`)); }, 3000);
    const onLine = line => { clearTimeout(timer); lines.removeListener('line', onLine); try { resolve(JSON.parse(line)); } catch (e) { reject(e); } };
    lines.on('line', onLine);
  });
  try {
    const initialized = readLine();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } } }) + '\n');
    const initResponse = await initialized;
    assert.equal(initResponse.id, 1);
    assert.equal(initResponse.result.serverInfo.name, 'orbita-integrations');

    const listed = readLine();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    const listResponse = await listed;
    const names = listResponse.result.tools.map(tool => tool.name);
    assert.ok(names.includes('orbita_business_discover'));
    assert.ok(names.includes('orbita_email_send'));
    assert.ok(names.includes('orbita_instagram_publish'));
    assert.ok(names.includes('orbita_vercel_deploy'));
    assert.ok(names.includes('orbita_whatsapp_link'));

    const called = readLine();
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'orbita_whatsapp_link', arguments: { phone: '+351912345678', message: 'Olá' } } }) + '\n');
    const callResponse = await called;
    const payload = JSON.parse(callResponse.result.content[0].text);
    assert.equal(payload.doesNotSend, true);
    assert.ok(payload.url.startsWith('https://wa.me/351912345678'));
  } finally {
    child.kill('SIGTERM');
    lines.close();
  }
});


test('project MCP config places ORBITA tools in the agent allowlist', async () => {
  mcpConfig.configure({ mcp: { allow: [], deny: [], departments: {} }, tools: { web: true, browser: false } });
  await mcpConfig.discover({ timeout: 500 });
  const names = mcpConfig.allowedTools();
  assert.ok(names.includes('mcp__orbita_integrations'));
  assert.ok(mcpConfig.usable().some(server => server.id === 'orbita_integrations' && server.key === 'orbita'));
});
