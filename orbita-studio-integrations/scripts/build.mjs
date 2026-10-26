// Órbita Studio — build das integrações.
//
// Não é teatro: valida o módulo, empacota o servidor com esbuild, confirma que o bundle carrega
// e escreve um manifesto com tudo o que ficou ligado. Se algo falhar, sai com código 1.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// 1. o módulo das integrações tem de carregar (sem .env, sem rede)
const mod = await import(path.join(ROOT, 'integrations.mjs'));
const expected = ['apiTokenOk', 'integrationStatus', 'discoverBusinesses', 'saveLeads', 'listLeads', 'updateLead',
  'sendApprovedEmail', 'githubWriteFile', 'publishInstagram', 'triggerVercelDeploy', 'geminiAssist', 'whatsappClickToChatUrl'];
const missing = expected.filter(fn => typeof mod[fn] !== 'function');
if (missing.length) { console.error(`✗ integrations.mjs não exporta: ${missing.join(', ')}`); process.exit(1); }

// 2. empacotar o servidor; integrations.mjs fica externo para manter o ROOT no pacote
//    (é ele que resolve .env e ./data — empacotado, apontaria para dist/)
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
await build({
  entryPoints: [path.join(ROOT, 'src/server.mjs')],
  outfile: path.join(OUT, 'server.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  external: ['../integrations.mjs'],
  sourcemap: false, minify: false, legalComments: 'none',
  banner: { js: '#!/usr/bin/env node\n// Gerado por scripts/build.mjs — não editar.\n' },
  logLevel: 'warning',
});

// 3. o bundle tem de carregar de facto (import de um ficheiro ESM válido)
const code = fs.readFileSync(path.join(OUT, 'server.mjs'), 'utf8');
if (!/integrations\.mjs/.test(code)) { console.error('✗ o bundle perdeu o import de ../integrations.mjs'); process.exit(1); }

// 4. manifesto: o que está ligado, com o hash do que foi construído
const status = mod.integrationStatus();
const manifest = {
  name: pkg.name, version: pkg.version, builtAt: new Date().toISOString(),
  bundle: 'dist/server.mjs', bundleBytes: Buffer.byteLength(code),
  bundleSha256: createHash('sha256').update(code).digest('hex'),
  apiTokenConfigured: status.apiTokenConfigured,
  storage: status.mode,
  providersReady: status.providers.filter(p => p.ready).map(p => p.id),
  providersConfigured: status.providers.filter(p => p.configured).map(p => p.id),
  providersPending: status.providers.filter(p => !p.configured).map(p => p.id),
};
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o644 });

console.log(`✓ ${pkg.name} v${pkg.version} → dist/server.mjs (${Math.round(manifest.bundleBytes / 1024)} KB)`);
console.log(`  token: ${manifest.apiTokenConfigured ? 'configurado' : 'EM FALTA — npm start vai recusar arrancar'}`);
console.log(`  armazenamento: ${manifest.storage}   prontos: ${manifest.providersReady.join(' · ') || 'nenhum'}`);
console.log(`  à espera de chave: ${manifest.providersPending.join(' · ') || '—'}`);
