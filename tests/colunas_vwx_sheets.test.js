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

test('gravarStatusWhatsAppNaPlanilha: reserva V, W, X e cria colunas de WhatsApp somente a partir de Y', async () => {
  const headers = ['SOLICITAÇÃO', 'CPF', 'NOME']; // planilha mínima simulada
  const linha = ['25/11/2026', '12345678901', 'Aluno Teste'];

  const { sheets, batches } = criarMockSheets([headers, linha]);

  const res = await gravarStatusWhatsAppNaPlanilha({
    spreadsheetId: 'sheet-mock-3',
    itens: [{ cpf: '12345678901', statusWhatsApp: 'D0_ENVIADO', dataUltimoWhatsApp: '25/11/2026 16:05:00', totalLembretes: 0 }],
    sheetsOverride: sheets
  });

  assert.equal(res.sucesso, true);
  const updates = batches.flat();
  const ranges = updates.map((u) => u.range);

  assert.ok(ranges.some((r) => r.includes('!Y1')));
  assert.ok(ranges.some((r) => r.includes('!Z1')));
  assert.ok(ranges.some((r) => r.includes('!AA1')));
  assert.equal(ranges.some((r) => r.includes('!V') || r.includes('!W') || r.includes('!X')), false);
});
