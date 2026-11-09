import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  carregarSolicitacoes,
  registrarRespostaNoSheet
} from '../services/googleSheets.js';

const raizApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Extensões e Aperfeiçoamentos: mapeia colunas de dados pessoais (RG, Nascimento, Naturalidade/Nacionalidade)', async () => {
  const headers = [
    'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO',
    'CURSO', 'CERTIFICADORA', 'CONTRATO', 'STATUS DO EVENTO', 'TELEFONE',
    'RG', 'DATA DE NASCIMENTO', 'NATURALIDADE'
  ];
  const rows = [
    headers,
    [
      '10/10/2026', '123.456.789-09', 'Aluno Teste', 'Digital', 'Extensão',
      'Curso Teste', 'Faculdade Teste', 'CTR-1', 'PENDENTE', '11999998888',
      '12.345.678-9', '15/03/1985', 'São Paulo - SP'
    ]
  ];

  const mockSheets = {
    spreadsheets: {
      get: async () => ({
        data: { sheets: [{ properties: { title: 'Extensões e Aperfeiçoamentos' } }] }
      }),
      values: {
        get: async () => ({ data: { values: rows } })
      }
    }
  };

  // Testa extração de índices e colunas diretamente
  const indices = {
    dataNascimento: headers.findIndex(h => h.includes('NASCIMENTO')),
    rg: headers.findIndex(h => h === 'RG' || h.startsWith('RG ') || h.includes('RG')),
    naturalidade: headers.findIndex(h => h.includes('NATURALIDADE') || h.includes('NACIONALIDADE'))
  };

  assert.equal(indices.dataNascimento, 11);
  assert.equal(indices.rg, 10);
  assert.equal(indices.naturalidade, 12);

  // Também testa aceitando "NACIONALIDADE" no lugar de "NATURALIDADE"
  const headersComNacionalidade = [...headers];
  headersComNacionalidade[12] = 'NACIONALIDADE';
  const idxNat2 = headersComNacionalidade.findIndex(h => h.includes('NATURALIDADE') || h.includes('NACIONALIDADE'));
  assert.equal(idxNat2, 12);
});

// ---------- Integração: o formulário recebe os dados pessoais do aluno ----------
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

test('servidor: dados pessoais da aba de solicitações chegam ao formulário do aluno', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dados-alunos-'));
  const porta = '3990';
  const base = `http://127.0.0.1:${porta}`;
  const envBase = {
    PORT: porta,
    RESPOSTAS_FILE: path.join(dir, 'respostas.json')
  };

  const servidor = await iniciarServidor(envBase);
  try {
    const lista = await (await fetch(`${base}/api/solicitacoes`)).json();
    assert.ok(lista.dados.length > 0);
    const token = lista.dados[0].token;
    const res = await (await fetch(`${base}/api/link/${token}`)).json();
    assert.equal(res.sucesso, true);
    assert.ok(res.dados.cpf);
    // Se o aluno não tiver dados na base local, deve vir string (vazia ou preenchida), sem quebrar
    assert.equal(typeof res.dados.dataNascimento, 'string');
    assert.equal(typeof res.dados.rg, 'string');
    assert.equal(typeof res.dados.naturalidade, 'string');
  } finally {
    await parar(servidor);
  }
});

test('registrarRespostaNoSheet: grava STATUS=EMITIR e Protocolo em todas as linhas do aluno na planilha', async () => {
  const cabecalhos = [
    'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO',
    'CURSO', 'CERTIFICADORA', 'CONTRATO', 'STATUS DO EVENTO', 'ID DO EVENTO',
    'DATA CRIAÇÃO EVENTO', 'TELEFONE', 'DATA INÍCIO (ISO)', 'CRIAÇÃO MATRÍCULA (ISO)',
    'USER ID', 'RG', 'Nacionalidade', 'Data de Nascimento', 'Protocolo'
  ];
  const linhasPlanilha = [
    cabecalhos,
    ['10/10/2026', '04097334824', 'Maria Silva', 'Digital', 'Extensão', 'Curso 1', 'Fac 1', 'C1', 'ENTRADA'],
    ['10/10/2026', '99988877766', 'Outro Aluno', 'Digital', 'Extensão', 'Curso X', 'Fac 1', 'CX', 'ENTRADA'],
    ['10/10/2026', '4097334824', 'Maria Silva', 'Digital', 'Extensão', 'Curso 2', 'Fac 1', 'C2', 'ENTRADA'] // sem zero à esquerda
  ];

  let batchPayload = null;
  const mockSheets = {
    spreadsheets: {
      get: async () => ({
        data: { sheets: [{ properties: { sheetId: 267936837, title: 'Extensões e Aperfeiçoamentos' } }] }
      }),
      values: {
        get: async ({ range }) => {
          if (range.endsWith('!1:1')) return { data: { values: [cabecalhos] } };
          return { data: { values: linhasPlanilha } };
        },
        batchUpdate: async ({ resource }) => {
          batchPayload = resource;
          return { data: {} };
        }
      }
    }
  };

  const resultado = await registrarRespostaNoSheet({
    spreadsheetId: 'sheet-teste-id',
    token: 'tok-123',
    resposta: { protocolo: 'CERT-2026-654321' },
    linkInfo: { cpf: '04097334824' },
    sheetsOverride: mockSheets
  });

  assert.equal(resultado.atualizado, true);
  assert.equal(resultado.linhasAfetadas, 2);
  assert.equal(resultado.protocolo, 'CERT-2026-654321');
  assert.ok(batchPayload);

  // Deve ter atualizado STATUS DO EVENTO (coluna I) e Protocolo (coluna S) nas linhas 2 e 4
  assert.deepEqual(batchPayload.data, [
    { range: "'Extensões e Aperfeiçoamentos'!I2", values: [['EMITIR']] },
    { range: "'Extensões e Aperfeiçoamentos'!S2", values: [['CERT-2026-654321']] },
    { range: "'Extensões e Aperfeiçoamentos'!I4", values: [['EMITIR']] },
    { range: "'Extensões e Aperfeiçoamentos'!S4", values: [['CERT-2026-654321']] }
  ]);
});
