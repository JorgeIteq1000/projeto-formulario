import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registrarRespostaNoSheet,
  atualizarStatusLyraNoSheet,
  gravarStatusWhatsAppNaPlanilha
} from '../services/googleSheets.js';

function criarMockSheets(rowsIniciais) {
  const batches = [];
  const rows = rowsIniciais.map((r) => [...r]);

  const sheets = {
    spreadsheets: {
      get: async () => ({
        data: {
          sheets: [{ properties: { sheetId: 267936837, title: 'Extensões e Aperfeiçoamentos' } }]
        }
      }),
      values: {
        get: async ({ range }) => {
          if (range.includes('!1:1')) {
            return { data: { values: [rows[0]] } };
          }
          return { data: { values: rows } };
        },
        batchUpdate: async ({ resource }) => {
          batches.push(resource.data);
          return { data: { totalUpdatedCells: resource.data.length } };
        }
      }
    }
  };

  return { sheets, batches };
}

test('registrarRespostaNoSheet: grava EMITIR (I), Protocolo (S), MODIFICAÇÃO DO STATUS (W) e STATUS LYRA (V) quando emitido', async () => {
  const headers = [
    'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO',
    'CURSO', 'CERTIFICADORA', 'CONTRATO', 'STATUS DO FORMULÁRIO', 'ID DO EVENTO',
    'DATA CRIAÇÃO EVENTO', 'TELEFONE', 'DATA INÍCIO (ISO)', 'CRIAÇÃO MATRÍCULA (ISO)',
    'USER ID', 'RG', 'NACIONALIDADE', 'DATA DE NASCIMENTO', 'PROTOCOLO', 'LINK',
    'INSERIDO NA PLANILHA EM', 'STATUS LYRA', 'MODIFICAÇÃO DO STATUS', 'PRAZO MÍNIMO PARA CONCLUSÃO'
  ];
  const linhaAluno = [
    '25/11/2026', '43777553824', 'Ianca Pires', 'Digital', 'Extensão',
    'Curso A', 'Alpha', 'c1', 'PENDENTE_ENVIO', 'N/A',
    '25/11/2026 10:00:00', '11999999999', '', '', '', '', '', '', '', '',
    '25/11/2026 10:00:00', 'Aguardando Aprovação', '', '25/01/2027'
  ];

  const { sheets, batches } = criarMockSheets([headers, linhaAluno]);

  const res = await registrarRespostaNoSheet({
    spreadsheetId: 'sheet-mock-1',
    token: 'tok-1',
    linkInfo: { cpf: '437.775.538-24' },
    resposta: {
      protocolo: 'CERT-2026-112233',
      dataSubmissaoFormatada: '25/11/2026 15:50:00',
      emitidoNoLyra: true
    },
    sheetsOverride: sheets
  });

  assert.equal(res.atualizado, true);
  assert.equal(res.linhasAfetadas, 1);

  const updates = batches.flat();
  const porRange = new Map(updates.map((u) => [u.range, u.values[0][0]]));

  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!I2"), 'EMITIR');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!S2"), 'CERT-2026-112233');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!W2"), '25/11/2026 15:50:00');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!V2"), 'Aprovado');
});

test('atualizarStatusLyraNoSheet: atualiza Coluna V (STATUS LYRA) e Coluna W (MODIFICAÇÃO DO STATUS)', async () => {
  const headers = [
    'SOLICITAÇÃO', 'CPF', 'NOME', 'TIPO DE CERTIFICADO', 'TIPO DE CURSO',
    'CURSO', 'CERTIFICADORA', 'CONTRATO', 'STATUS DO FORMULÁRIO', 'ID DO EVENTO',
    'DATA CRIAÇÃO EVENTO', 'TELEFONE', 'DATA INÍCIO (ISO)', 'CRIAÇÃO MATRÍCULA (ISO)',
    'USER ID', 'RG', 'NACIONALIDADE', 'DATA DE NASCIMENTO', 'PROTOCOLO', 'LINK',
    'INSERIDO NA PLANILHA EM', 'STATUS LYRA', 'MODIFICAÇÃO DO STATUS', 'PRAZO MÍNIMO PARA CONCLUSÃO'
  ];
  const linha = new Array(24).fill('');
  linha[1] = '12345678901';

  const { sheets, batches } = criarMockSheets([headers, linha]);

  const res = await atualizarStatusLyraNoSheet({
    spreadsheetId: 'sheet-mock-2',
    cpf: '123.456.789-01',
    statusLyra: 'Aprovado',
    dataModificacao: '25/11/2026 16:00:00',
    sheetsOverride: sheets
  });

  assert.equal(res.atualizado, true);
  const updates = batches.flat();
  const porRange = new Map(updates.map((u) => [u.range, u.values[0][0]]));

  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!V2"), 'Aprovado');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!W2"), '25/11/2026 16:00:00');
});

test('gravarStatusWhatsAppNaPlanilha: marca Enviado (I), grava data na Coluna Y e reserva V, W, X', async () => {
  const headers = [
    'SOLICITAÇÃO', 'CPF', 'NOME', '', '', '', '', '', 'STATUS DO FORMULÁRIO'
  ];
  const linhaPendente = ['25/11/2026', '12345678901', 'Aluno Pendente', '', '', '', '', '', 'PENDENTE_ENVIO'];
  const linhaJaEmitir = ['25/11/2026', '99988877766', 'Aluno Emitir', '', '', '', '', '', 'EMITIR'];

  const { sheets, batches } = criarMockSheets([headers, linhaPendente, linhaJaEmitir]);

  const res = await gravarStatusWhatsAppNaPlanilha({
    spreadsheetId: 'sheet-mock-3',
    itens: [
      { cpf: '12345678901', statusWhatsApp: 'D0_ENVIADO', dataUltimoWhatsApp: '25/11/2026 16:05:00', totalLembretes: 0 },
      { cpf: '99988877766', statusWhatsApp: 'D0_ENVIADO', dataUltimoWhatsApp: '25/11/2026 16:05:00', totalLembretes: 0 }
    ],
    sheetsOverride: sheets
  });

  assert.equal(res.sucesso, true);
  const updates = batches.flat();
  const porRange = new Map(updates.map((u) => [u.range, u.values[0][0]]));

  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!Y1"), 'DATA ENVIO WHATSAPP');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!Z1"), 'STATUS WHATSAPP');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!AA1"), 'TOTAL LEMBRETES WHATSAPP');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!I2"), 'Enviado');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!Y2"), '25/11/2026 16:05:00');
  assert.equal(porRange.get("'Extensões e Aperfeiçoamentos'!Z2"), 'D0_ENVIADO');
  assert.equal(porRange.has("'Extensões e Aperfeiçoamentos'!I3"), false, 'Não deve sobrescrever status EMITIR');
  assert.equal(updates.some((u) => u.range.includes('!V') || u.range.includes('!W') || u.range.includes('!X')), false);
});
