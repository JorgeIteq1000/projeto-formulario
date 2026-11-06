import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  subtractMonths,
  validarDataEvolucao17Meses,
  validarDataCustomizada,
  addOneMonth,
  gerarSugestoesPeriodos,
  formatDateISO,
  formatDateBR
} from '../src/utils/dateSuggestions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test('subtractMonths correctly subtracts months with day clipping and boundary conditions', () => {
  // 17 months before 2026-10-28 is 2025-05-28
  const base = new Date(2026, 9, 28); // 2026-10-28
  const sub17 = subtractMonths(base, 17);
  assert.equal(formatDateISO(sub17), '2025-05-28');

  // 31 March (leap year 2024) - 1 month = 29 February 2024
  const march31Leap = new Date(2024, 2, 31);
  const feb29 = subtractMonths(march31Leap, 1);
  assert.equal(formatDateISO(feb29), '2024-02-29');

  // 31 March (non-leap year 2023) - 1 month = 28 February 2023
  const march31NonLeap = new Date(2023, 2, 31);
  const feb28 = subtractMonths(march31NonLeap, 1);
  assert.equal(formatDateISO(feb28), '2023-02-28');

  // 31 May - 1 month = 30 April
  const may31 = new Date(2025, 4, 31);
  const apr30 = subtractMonths(may31, 1);
  assert.equal(formatDateISO(apr30), '2025-04-30');

  // 24 months before 2026-01-15 is 2024-01-15
  const jan2026 = new Date(2026, 0, 15);
  const sub24 = subtractMonths(jan2026, 24);
  assert.equal(formatDateISO(sub24), '2024-01-15');

  // null / empty input returns null
  assert.equal(subtractMonths(null, 1), null);
  assert.equal(subtractMonths('', 1), null);
});

test('validarDataEvolucao17Meses accepts dates within 17 months and rejects older dates', () => {
  const refDate = new Date(2026, 9, 28); // 28/10/2026 -> 17 months ago is 2025-05-28
  const exactError = 'O período não pode ser contabilizado. Entre em contato com a Central de Atendimento, pelo telefone (11) 2074-5110, no setor de Emissão.';

  // Exactly on boundary (2025-05-28) -> Valid
  const resBoundary = validarDataEvolucao17Meses('2025-05-28', refDate);
  assert.equal(resBoundary.valida, true);
  assert.equal(resBoundary.erro, null);
  assert.equal(resBoundary.limite17MesesISO, '2025-05-28');

  // Recent date (2026-02-15) -> Valid
  const resRecent = validarDataEvolucao17Meses('2026-02-15', refDate);
  assert.equal(resRecent.valida, true);
  assert.equal(resRecent.erro, null);

  // 1 day before boundary (2025-05-27) -> Invalid with exact error
  const resOlder = validarDataEvolucao17Meses('2025-05-27', refDate);
  assert.equal(resOlder.valida, false);
  assert.equal(resOlder.erro, exactError);
  assert.equal(resOlder.limite17MesesISO, '2025-05-28');

  // Much older date (2024-01-01) -> Invalid with exact error
  const resMuchOlder = validarDataEvolucao17Meses('2024-01-01', refDate);
  assert.equal(resMuchOlder.valida, false);
  assert.equal(resMuchOlder.erro, exactError);

  // Missing or invalid format
  const resMissing = validarDataEvolucao17Meses('', refDate);
  assert.equal(resMissing.valida, false);
  assert.equal(resMissing.erro, 'Data de evolução não informada.');

  const resInvalid = validarDataEvolucao17Meses('data-invalida', refDate);
  assert.equal(resInvalid.valida, false);
  assert.equal(resInvalid.erro, 'Data de evolução inválida.');
});

test('validarDataCustomizada validates 17 months and future completion', () => {
  const refDate = new Date(2026, 9, 28); // 28/10/2026

  // Valid custom date: start 2026-08-01, end 2026-09-01 (<= 2026-10-28)
  const validCustom = validarDataCustomizada('2026-08-01', refDate);
  assert.equal(validCustom.valida, true);
  assert.equal(validCustom.dataInicioISO, '2026-08-01');
  assert.equal(validCustom.dataFimISO, '2026-09-01');

  // Custom date too old (< 17 months)
  const oldCustom = validarDataCustomizada('2025-05-20', refDate);
  assert.equal(oldCustom.valida, false);
  assert.equal(oldCustom.erro, 'O período não pode ser contabilizado. Entre em contato com a Central de Atendimento, pelo telefone (11) 2074-5110, no setor de Emissão.');

  // Custom date with end > today (e.g. start 2026-10-15 -> end 2026-11-15 > 2026-10-28)
  const futureCustom = validarDataCustomizada('2026-10-15', refDate);
  assert.equal(futureCustom.valida, false);
  assert.match(futureCustom.erro, /ultrapassa a data atual/);
});

test('gerarSugestoesPeriodos creates sequential monthly periods (business days) after evolution', () => {
  const refDate = new Date(2026, 9, 28);
  const cursos = [
    { curso: 'Curso A', tipoCurso: 'Extensão', certificadora: 'Faculdade 1', contrato: '1', cargaHoraria: 100 },
    { curso: 'Curso B', tipoCurso: 'Extensão', certificadora: 'Faculdade 2', contrato: '2', cargaHoraria: 45 }
  ];

  // Evolução em 10/01/2026: o 1º curso (100h) começa no 1º dia útil de fevereiro e dura 2 meses
  const periodos = gerarSugestoesPeriodos('2026-01-10', cursos, refDate);
  assert.equal(periodos.length, 2);
  assert.equal(periodos[0].dataInicio, '2026-02-02');
  assert.equal(periodos[0].dataFim, '2026-03-31');
  // O 2º curso (45h) começa no mês seguinte e dura 1 mês
  assert.equal(periodos[1].dataInicio, '2026-04-01');
  assert.equal(periodos[1].dataFim, '2026-04-30');
  assert.equal(periodos[0].ultrapassaHoje, false);
});

test('StudentForm.jsx source code conforms to M1 requirements', () => {
  const formPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');
  const source = fs.readFileSync(formPath, 'utf8');

  // 1. Must NOT contain <textarea id="observacao"
  assert.equal(source.includes('id="observacao"'), false, 'textarea id="observacao" must be completely removed');
  assert.equal(source.includes('<textarea'), false, 'No textarea should exist in StudentForm');

  // 2. Must contain the exact institutional notice text with <strong>96hr</strong>
  const expectedNoticeSnippet = 'Caso seja necessário atualização ou correção de algum dado pessoal, é necessário que primeiro seja realizada a atualização dentro da sua área do aluno, pois após o envio deste formulário, as informações serão processadas conforme consta em sistema. Os dados devem ser atualizados exclusivamente na área do aluno, aba "Meus Dados". A falta de finalização do formulário em <strong>96hr</strong>, ocasionará o cancelamento da solicitação, devendo o aluno, abrir uma nova solicitação dentro da área do aluno.';
  assert.equal(source.includes(expectedNoticeSnippet), true, 'Must include exact institutional notice text with <strong>96hr</strong>');

  // 3. Must block form when evolution date is invalid (formularioValido includes validacaoEvolucao.valida)
  assert.equal(source.includes('validacaoEvolucao.valida'), true, 'formularioValido must check validacaoEvolucao.valida');

  // 4. Must render exact error alert
  assert.equal(source.includes('validacaoEvolucao.erro'), true, 'StudentForm must render validacaoEvolucao.erro');
});
