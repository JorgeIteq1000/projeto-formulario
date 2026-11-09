import './_env.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gravarLinksNaPlanilha } from '../services/googleSheets.js';

const CAB = [
  'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO', 'CURSO', 'CERTIFICADORA',
  'CONTRATO', 'STATUS DO EVENTO', 'ID DO EVENTO', 'DATA CRIAÇÃO EVENTO', 'TELEFONE',
  'DATA INÍCIO (ISO)', 'CRIAÇÃO MATRÍCULA (ISO)', 'USER ID', 'RG', 'Nacionalidade',
  'Data de Nascimento', 'Protocolo', 'Link'
];
const BASE = 'https://newsolicitacoes.vercel.app/solicitacoes/';

function planilha(linhas) {
  const gravado = [];
  return {
    gravado,
    sheets: {
      spreadsheets: {
        get: async () => ({ data: { sheets: [{ properties: { sheetId: 267936837, title: 'Extensões e Aperfeiçoamentos' } }] } }),
        values: {
          get: async () => ({ data: { values: [CAB, ...linhas] } }),
          batchUpdate: async ({ resource }) => { gravado.push(...resource.data); return { data: {} }; }
        }
      }
    }
  };
}

const linha = (cpf, link) => {
  const l = new Array(20).fill('');
  l[1] = cpf; l[2] = 'Aluno'; l[11] = '11999990000';
  if (link !== undefined) l[19] = link;
  return l;
};

test('links na coluna T: grava em todas as linhas do aluno (CPF sem zero à esquerda inclusive)', async () => {
  const p = planilha([linha('04097334824'), linha('99988877766'), linha('4097334824')]);
  const r = await gravarLinksNaPlanilha({
    spreadsheetId: 'x', sheetsOverride: p.sheets,
    itens: [{ cpf: '04097334824', url: BASE + 'AAA' }]
  });
  assert.equal(r.sucesso, true);
  assert.equal(r.coluna, 'T');
  assert.equal(r.linhasAtualizadas, 2);
  assert.deepEqual(p.gravado.map((u) => u.range), [
    "'Extensões e Aperfeiçoamentos'!T2",
    "'Extensões e Aperfeiçoamentos'!T4"
  ]);
  assert.ok(p.gravado.every((u) => u.values[0][0] === BASE + 'AAA'));
});

test('links na coluna T: é idempotente, atualiza link antigo do formulário e preserva outro conteúdo', async () => {
  const p = planilha([
    linha('11111111111', BASE + 'IGUAL'),          // já correto
    linha('22222222222', BASE + 'ANTIGO'),         // link nosso desatualizado -> atualiza
    linha('33333333333', 'anotação da equipe')     // conteúdo de terceiros -> preserva
  ]);
  const r = await gravarLinksNaPlanilha({
    spreadsheetId: 'x', sheetsOverride: p.sheets,
    itens: [
      { cpf: '11111111111', url: BASE + 'IGUAL' },
      { cpf: '22222222222', url: BASE + 'NOVO' },
      { cpf: '33333333333', url: BASE + 'X' }
    ]
  });
  assert.equal(r.jaCorretos, 1);
  assert.equal(r.preservados, 1);
  assert.equal(r.linhasAtualizadas, 1);
  assert.equal(p.gravado.length, 1);
  assert.equal(p.gravado[0].values[0][0], BASE + 'NOVO');
});

test('links na coluna T: dryRun não grava nada', async () => {
  const p = planilha([linha('44444444444')]);
  const r = await gravarLinksNaPlanilha({
    spreadsheetId: 'x', sheetsOverride: p.sheets, dryRun: true,
    itens: [{ cpf: '44444444444', url: BASE + 'D' }]
  });
  assert.equal(r.linhasAtualizadas, 1);
  assert.equal(p.gravado.length, 0);
});
