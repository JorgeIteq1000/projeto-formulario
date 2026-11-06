import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { carregarRespostas, salvarRespostas } from '../services/respostasStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raizApp = path.resolve(__dirname, '..');

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'respostas-'));
}

test('respostasStore: salva e restaura as respostas', () => {
  const arquivo = path.join(pastaTemporaria(), 'sub', 'respostas.json');
  const mapa = new Map([['tokenA', { protocolo: 'CERT-1' }], ['tokenB', { protocolo: 'CERT-2' }]]);
  salvarRespostas(arquivo, mapa);

  const lido = carregarRespostas(arquivo);
  assert.equal(lido.size, 2);
  assert.equal(lido.get('tokenB').protocolo, 'CERT-2');
  assert.equal(fs.existsSync(`${arquivo}.tmp`), false, 'não deve sobrar arquivo temporário');
});

test('respostasStore: arquivo ausente resulta em Map vazio', () => {
  const lido = carregarRespostas(path.join(pastaTemporaria(), 'nao-existe.json'));
  assert.equal(lido.size, 0);
});

test('respostasStore: arquivo corrompido é preservado e o Map começa vazio', () => {
  const dir = pastaTemporaria();
  const arquivo = path.join(dir, 'respostas.json');
  fs.writeFileSync(arquivo, '{ isto não é json');

  const lido = carregarRespostas(arquivo);
  assert.equal(lido.size, 0);
  assert.equal(fs.existsSync(arquivo), false);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('respostas.json.corrompido-')));
});

// ---------- Reinício real do servidor ----------
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

test('servidor: resposta sobrevive ao reinício e bloqueia novo envio', async () => {
  // Stub local do Bitrix24 para não chamar o webhook real
  let cardsCriados = 0;
  const bitrix = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      cardsCriados++;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: { item: { id: 900 + cardsCriados } } }));
    });
  });
  await new Promise((r) => bitrix.listen(0, '127.0.0.1', r));

  const dir = pastaTemporaria();
  const env = {
    PORT: '3987',
    RESPOSTAS_FILE: path.join(dir, 'respostas.json'),
    BITRIX24_WEBHOOK_URL: `http://127.0.0.1:${bitrix.address().port}`
  };
  const base = `http://127.0.0.1:${env.PORT}`;

  let servidor = await iniciarServidor(env);
  try {
    const lista = await (await fetch(`${base}/api/solicitacoes`)).json();
    const token = lista.dados[0].token;

    const corpo = JSON.stringify({ professor: false, periodosSugeridos: [], confirmacao: true });
    const enviar = () => fetch(`${base}/api/link/${token}/resposta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: corpo
    });

    // Duplo clique: dois envios simultâneos criam um único card
    const [a, b] = await Promise.all([enviar(), enviar()]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(cardsCriados, 1);
    const protocolo = (await (a.status === 200 ? a : b).json()).protocolo;

    // Reinício do servidor
    await parar(servidor);
    servidor = await iniciarServidor(env);

    const aposReinicio = await (await fetch(`${base}/api/link/${token}`)).json();
    assert.equal(aposReinicio.dados.jaRespondido, true);
    assert.equal(aposReinicio.dados.protocolo, protocolo);

    const reenvio = await enviar();
    assert.equal(reenvio.status, 409);
    assert.equal(cardsCriados, 1, 'não deve criar novo card após reinício');
  } finally {
    await parar(servidor);
    bitrix.close();
  }
});
