import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  mesesDoPeriodo,
  ultimoDiaUtilDoMes,
  validarDataConclusao,
  formatDateISO
} from '../src/utils/dateSuggestions.js';

const raizApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function iniciarServidor(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: raizApp,
      env: { ...process.env, GOOGLE_SHEET_ID: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let saida = '';
    const timer = setTimeout(() => reject(new Error(`Servidor não iniciou:\n${saida}`)), 20000);
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

test('servidor: "Não Aceito" tem o período recalculado pela carga do curso e rejeita data futura', async () => {
  const corposBitrix = [];
  const bitrix = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (d) => { corpo += d; });
    req.on('end', () => {
      corposBitrix.push(corpo);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ result: { item: { id: 1 } } }));
    });
  });
  await new Promise((r) => bitrix.listen(0, '127.0.0.1', r));

  const env = {
    PORT: '3989',
    RESPOSTAS_FILE: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nao-aceito-')), 'respostas.json'),
    BITRIX24_WEBHOOK_URL: `http://127.0.0.1:${bitrix.address().port}`
  };
  const base = `http://127.0.0.1:${env.PORT}`;
  const servidor = await iniciarServidor(env);
  try {
    const lista = await (await fetch(`${base}/api/solicitacoes`)).json();
    const token = lista.dados[0].token;
    const link = (await (await fetch(`${base}/api/link/${token}`)).json()).dados;
    const curso = link.cursos[0];
    const { meses } = mesesDoPeriodo(curso.cargaHoraria, curso.tipoCurso);

    const enviar = (periodo) => fetch(`${base}/api/link/${token}/resposta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ professor: false, periodosSugeridos: [periodo], confirmacao: true })
    });
    const base1 = { indice: 1, curso: curso.curso, contrato: curso.contrato, aceite: 'Não Aceito', customizado: true };

    // Conclusão no futuro: recusada
    const hoje = new Date();
    const futuro = formatDateISO(new Date(hoje.getFullYear(), hoje.getMonth() + 2, 15));
    const rejeitada = await enviar({ ...base1, dataFimCustomizada: futuro });
    assert.equal(rejeitada.status, 400);

    // Conclusão válida (último dia útil do mês anterior), com início adulterado pelo navegador
    const fim = ultimoDiaUtilDoMes(hoje.getFullYear(), hoje.getMonth() - 1);
    const esperado = validarDataConclusao(formatDateISO(fim), hoje, meses);
    assert.equal(esperado.valida, true);
    const aceita = await enviar({
      ...base1,
      dataInicioCustomizada: '1999-01-01',
      dataFimCustomizada: formatDateISO(fim)
    });
    assert.equal(aceita.status, 200);

    // O Bitrix recebe o período recalculado no servidor, não o início adulterado
    const resumo = corposBitrix.join('');
    assert.ok(resumo.includes(esperado.dataInicioFormatada), `esperava início ${esperado.dataInicioFormatada} no card`);
    assert.ok(!resumo.includes('01/01/1999'));
  } finally {
    await parar(servidor);
    bitrix.close();
  }
});
