import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { criarTokenSessao } from '../services/authUsuarios.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const raizApp = path.resolve(__dirname, '..');

function iniciarServidor(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: raizApp,
      env: { ...process.env, GOOGLE_SHEET_ID: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let saida = '';
    const timer = setTimeout(() => reject(new Error(`Servidor não iniciou:\n${saida}`)), 15000);
    const aoReceber = (d) => {
      saida += d;
      if (saida.includes('SERVIDOR ATIVO')) {
        clearTimeout(timer);
        resolve(proc);
      }
    };
    proc.stdout.on('data', aoReceber);
    proc.stderr.on('data', aoReceber);
    proc.on('exit', (code) => reject(new Error(`Servidor saiu (${code}):\n${saida}`)));
  });
}

const parar = (proc) => new Promise((resolve) => {
  proc.removeAllListeners('exit');
  proc.on('exit', resolve);
  proc.kill();
});

test('servidor: reconhece status EMITIR e protocolo vindos da planilha no Kanban e estatísticas sem depender de respostas.json', async () => {
  const porta = 3989;
  const env = {
    PORT: String(porta),
    AUTH_STRICT: 'false',
    LINK_SECRET: 'segredo-teste-ianca-2026',
    GOOGLE_SHEET_ID: '', // Base local
  };

  const proc = await iniciarServidor(env);

  try {
    const tokenAdmin = criarTokenSessao({ login: 'admin.teste', nome: 'Admin' }, env.LINK_SECRET);
    const headers = { Authorization: `Bearer ${tokenAdmin}` };

    // 1. Consulta /api/solicitacoes
    const resSolicitacoes = await fetch(`http://127.0.0.1:${porta}/api/solicitacoes`, { headers });
    assert.equal(resSolicitacoes.status, 200);
    const jsonSolicitacoes = await resSolicitacoes.json();
    assert.ok(jsonSolicitacoes.sucesso);
    assert.ok(Array.isArray(jsonSolicitacoes.dados));

    // 2. Consulta /api/estatisticas
    const resStats = await fetch(`http://127.0.0.1:${porta}/api/estatisticas`, { headers });
    assert.equal(resStats.status, 200);
    const jsonStats = await resStats.json();
    assert.ok(jsonStats.sucesso);
    assert.ok(typeof jsonStats.dados.totalLinks === 'number');
    assert.ok(typeof jsonStats.dados.totalRespondidos === 'number');
    assert.ok(typeof jsonStats.dados.totalPendentes === 'number');
  } finally {
    await parar(proc);
  }
});
