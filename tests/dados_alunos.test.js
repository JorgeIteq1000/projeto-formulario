import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import {
  montarDadosAlunos,
  montarDadosAlunosDeLista,
  registrarRespostaNoSheet
} from '../services/googleSheets.js';

const raizApp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('aba DADOS_ALUNOS: reconhece cabeçalhos em qualquer ordem, com acento e caixa diferentes', () => {
  const dados = montarDadosAlunos([
    ['Naturalidade', 'RG', 'CPF', 'Data de Nascimento'],
    ['São Paulo - SP', '12.345.678-9', '123.456.789-09', '15/03/1985'],
    ['Santos - SP', '98.765.432-1', '987.654.321-00', '02/11/1990']
  ]);
  assert.equal(dados.size, 2);
  assert.deepEqual(dados.get('12345678909'), {
    dataNascimento: '15/03/1985',
    rg: '12.345.678-9',
    naturalidade: 'São Paulo - SP'
  });
});

test('aba DADOS_ALUNOS: CPF sem zeros à esquerda é completado, e linhas sem CPF são ignoradas', () => {
  const dados = montarDadosAlunos([
    ['CPF', 'RG'],
    ['4097334824', '11.111.111-1'], // perdeu o zero à esquerda na planilha
    ['', '22.222.222-2'],
    ['   ', '33.333.333-3']
  ]);
  assert.equal(dados.size, 1);
  assert.equal(dados.get('04097334824').rg, '11.111.111-1');
  assert.equal(dados.get('04097334824').dataNascimento, '');
});

test('aba DADOS_ALUNOS: sem coluna CPF ou vazia resulta em Map vazio', () => {
  assert.equal(montarDadosAlunos([]).size, 0);
  assert.equal(montarDadosAlunos([['RG', 'NATURALIDADE'], ['1', 'x']]).size, 0);
});

test('arquivo local: lista de alunos vira Map por CPF', () => {
  const dados = montarDadosAlunosDeLista([
    { cpf: '111.222.333-44', dataNascimento: '01/01/2000', rg: '1', naturalidade: 'Recife - PE' },
    { cpf: '', rg: 'ignorado' }
  ]);
  assert.equal(dados.size, 1);
  assert.equal(dados.get('11122233344').naturalidade, 'Recife - PE');
  assert.equal(montarDadosAlunosDeLista(null).size, 0);
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

test('servidor: dados pessoais do arquivo local chegam ao formulário do aluno', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dados-alunos-'));
  const porta = '3990';
  const base = `http://127.0.0.1:${porta}`;
  const envBase = {
    PORT: porta,
    RESPOSTAS_FILE: path.join(dir, 'respostas.json'),
    DADOS_ALUNOS_FILE: path.join(dir, 'inexistente.json')
  };

  // 1ª subida, sem dados pessoais: campos vazios (o formulário mostra "Não informado")
  let servidor = await iniciarServidor(envBase);
  let cpf;
  try {
    const lista = await (await fetch(`${base}/api/solicitacoes`)).json();
    cpf = lista.dados[0].cpf.replace(/\D/g, '');
    const token = lista.dados[0].token;
    const sem = (await (await fetch(`${base}/api/link/${token}`)).json()).dados;
    assert.equal(sem.rg, '');
    assert.equal(sem.dataNascimento, '');
  } finally {
    await parar(servidor);
  }

  // 2ª subida, com o arquivo de dados pessoais
  const arquivo = path.join(dir, 'dados.json');
  fs.writeFileSync(arquivo, JSON.stringify([
    { cpf, dataNascimento: '15/03/1985', rg: '12.345.678-9', naturalidade: 'São Paulo - SP' }
  ]));
  servidor = await iniciarServidor({ ...envBase, DADOS_ALUNOS_FILE: arquivo });
  try {
    const lista = await (await fetch(`${base}/api/solicitacoes`)).json();
    const token = lista.dados.find((d) => d.cpf.replace(/\D/g, '') === cpf).token;
    const com = (await (await fetch(`${base}/api/link/${token}`)).json()).dados;
    assert.equal(com.dataNascimento, '15/03/1985');
    assert.equal(com.rg, '12.345.678-9');
    assert.equal(com.naturalidade, 'São Paulo - SP');
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
