import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { criarCardAlunoSPA } from '../services/bitrix24.js';

const raizApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Bitrix24: sem BITRIX24_WEBHOOK_URL não chama a rede e informa o erro', async () => {
  const urlOriginal = process.env.BITRIX24_WEBHOOK_URL;
  const fetchOriginal = globalThis.fetch;
  let chamadas = 0;
  delete process.env.BITRIX24_WEBHOOK_URL;
  globalThis.fetch = async () => { chamadas++; throw new Error('não deveria chamar'); };
  try {
    const res = await criarCardAlunoSPA({ nome: 'Aluno Teste', cursos: [] });
    assert.equal(res.sucesso, false);
    assert.match(res.erro, /BITRIX24_WEBHOOK_URL/);
    assert.equal(chamadas, 0);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (urlOriginal !== undefined) process.env.BITRIX24_WEBHOOK_URL = urlOriginal;
  }
});

test('servidor: em produção, recusa iniciar sem LINK_SECRET', () => {
  const res = spawnSync(process.execPath, ['server.js'], {
    cwd: raizApp,
    env: { ...process.env, NODE_ENV: 'production', LINK_SECRET: '', PORT: '3988' },
    encoding: 'utf-8',
    timeout: 15000
  });
  assert.equal(res.status, 1);
  assert.match(res.stderr + res.stdout, /LINK_SECRET não configurado/);
});
