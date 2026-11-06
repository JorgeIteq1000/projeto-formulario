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
  addDays,
  gerarSugestoesPeriodos,
  formatDateISO,
  formatDateBR,
  parseDate
} from '../src/utils/dateSuggestions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXACT_ERROR_TEXT = 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão';

// ============================================================================
// SUITE 1: ADVERSARIAL CALENDAR MATH & SUBTRACT MONTHS (17 MONTHS)
// ============================================================================

test('ADV-1.1: Exact 17 months subtraction across all 12 calendar months', () => {
  // Test reference dates in 2026 across every single month
  const testCases = [
    { base: '2026-01-15', expected: '2024-08-15', desc: 'Jan 2026 -> Aug 2024' },
    { base: '2026-02-15', expected: '2024-09-15', desc: 'Feb 2026 -> Sep 2024' },
    { base: '2026-03-15', expected: '2024-10-15', desc: 'Mar 2026 -> Oct 2024' },
    { base: '2026-04-15', expected: '2024-11-15', desc: 'Apr 2026 -> Nov 2024' },
    { base: '2026-05-15', expected: '2024-12-15', desc: 'May 2026 -> Dec 2024' },
    { base: '2026-06-15', expected: '2025-01-15', desc: 'Jun 2026 -> Jan 2025' },
    { base: '2026-07-15', expected: '2025-02-15', desc: 'Jul 2026 -> Feb 2025' },
    { base: '2026-08-15', expected: '2025-03-15', desc: 'Aug 2026 -> Mar 2025' },
    { base: '2026-09-15', expected: '2025-04-15', desc: 'Sep 2026 -> Apr 2025' },
    { base: '2026-10-15', expected: '2025-05-15', desc: 'Oct 2026 -> May 2025' },
    { base: '2026-11-15', expected: '2025-06-15', desc: 'Nov 2026 -> Jun 2025' },
    { base: '2026-12-15', expected: '2025-07-15', desc: 'Dec 2026 -> Jul 2025' }
  ];

  for (const tc of testCases) {
    const d = parseDate(tc.base);
    const sub = subtractMonths(d, 17);
    assert.equal(
      formatDateISO(sub),
      tc.expected,
      `Failed on ${tc.desc}: got ${formatDateISO(sub)}, expected ${tc.expected}`
    );
  }
});

test('ADV-1.2: Month clipping on 31st landing on shorter months (28, 29, 30)', () => {
  // 1. July 31, 2026 - 17 months -> Feb 2025 (non-leap year has 28 days)
  const jul31_2026 = parseDate('2026-07-31');
  const feb2025 = subtractMonths(jul31_2026, 17);
  assert.equal(formatDateISO(feb2025), '2025-02-28', 'July 31 - 17m in non-leap year must clip to Feb 28');

  // 2. July 31, 2025 - 17 months -> Feb 2024 (leap year has 29 days)
  const jul31_2025 = parseDate('2025-07-31');
  const feb2024 = subtractMonths(jul31_2025, 17);
  assert.equal(formatDateISO(feb2024), '2024-02-29', 'July 31 - 17m in leap year must clip to Feb 29');

  // 3. July 30, 2025 - 17 months -> Feb 2024 (leap year has 29 days, day 30 clips to 29)
  const jul30_2025 = parseDate('2025-07-30');
  const feb2024_30 = subtractMonths(jul30_2025, 17);
  assert.equal(formatDateISO(feb2024_30), '2024-02-29', 'July 30 - 17m in leap year must clip to Feb 29');

  // 4. July 29, 2025 - 17 months -> Feb 2024 (exact Feb 29)
  const jul29_2025 = parseDate('2025-07-29');
  const feb2024_29 = subtractMonths(jul29_2025, 17);
  assert.equal(formatDateISO(feb2024_29), '2024-02-29', 'July 29 - 17m in leap year must land on Feb 29');

  // 5. July 28, 2025 - 17 months -> Feb 2024 (exact Feb 28)
  const jul28_2025 = parseDate('2025-07-28');
  const feb2024_28 = subtractMonths(jul28_2025, 17);
  assert.equal(formatDateISO(feb2024_28), '2024-02-28', 'July 28 - 17m in leap year must land on Feb 28');

  // 6. Leap day itself: Feb 29, 2024 - 17 months -> Sep 29, 2022
  const leapDay = parseDate('2024-02-29');
  const sep2022 = subtractMonths(leapDay, 17);
  assert.equal(formatDateISO(sep2022), '2022-09-29', 'Feb 29 - 17m must land on Sep 29');

  // 7. March 31, 2026 - 17 months -> Oct 31, 2024 (31 days)
  const mar31_2026 = parseDate('2026-03-31');
  const oct31_2024 = subtractMonths(mar31_2026, 17);
  assert.equal(formatDateISO(oct31_2024), '2024-10-31', 'March 31 - 17m must preserve day 31 in Oct');

  // 8. August 31, 2026 - 17 months -> Mar 31, 2025 (31 days)
  const aug31_2026 = parseDate('2026-08-31');
  const mar31_2025 = subtractMonths(aug31_2026, 17);
  assert.equal(formatDateISO(mar31_2025), '2025-03-31', 'Aug 31 - 17m must preserve day 31 in Mar');

  // 9. October 31, 2026 - 17 months -> May 31, 2025 (31 days)
  const oct31_2026 = parseDate('2026-10-31');
  const may31_2025 = subtractMonths(oct31_2026, 17);
  assert.equal(formatDateISO(may31_2025), '2025-05-31', 'Oct 31 - 17m must preserve day 31 in May');

  // 10. December 31, 2026 - 17 months -> Jul 31, 2025 (31 days)
  const dec31_2026 = parseDate('2026-12-31');
  const jul31_2025_res = subtractMonths(dec31_2026, 17);
  assert.equal(formatDateISO(jul31_2025_res), '2025-07-31', 'Dec 31 - 17m must preserve day 31 in Jul');
});

// ============================================================================
// SUITE 2: ADVERSARIAL VALIDATION OF 17-MONTH RULE (BOUNDARY, +1, -1, ERROR TEXT)
// ============================================================================

test('ADV-2.1: Tri-state boundary vectors (exact boundary, boundary - 1 day, boundary + 1 day)', () => {
  const refDate = parseDate('2026-10-28');
  // 17 months ago from 2026-10-28 is 2025-05-28
  const cutoff = '2025-05-28';
  const beforeCutoff = '2025-05-27'; // 17 months + 1 day ago -> INVALID
  const afterCutoff = '2025-05-29';  // 17 months - 1 day ago -> VALID

  // Exact boundary: MUST BE VALID
  const resExact = validarDataEvolucao17Meses(cutoff, refDate);
  assert.equal(resExact.valida, true, 'Exact 17 months cutoff MUST be valid');
  assert.equal(resExact.erro, null, 'Error must be null on exact boundary');
  assert.equal(resExact.limite17MesesISO, cutoff);

  // 1 day after cutoff (within window): MUST BE VALID
  const resAfter = validarDataEvolucao17Meses(afterCutoff, refDate);
  assert.equal(resAfter.valida, true, '1 day after boundary MUST be valid');
  assert.equal(resAfter.erro, null);

  // 1 day before cutoff (too old): MUST BE REJECTED
  const resBefore = validarDataEvolucao17Meses(beforeCutoff, refDate);
  assert.equal(resBefore.valida, false, '1 day before boundary MUST be rejected');
  assert.equal(resBefore.erro, EXACT_ERROR_TEXT, 'Must return verbatim error text');
  assert.equal(resBefore.limite17MesesISO, cutoff);
});

test('ADV-2.2: Leap year tri-state boundary (July 31, 2025 -> Feb 29, 2024)', () => {
  const refDate = parseDate('2025-07-31');
  const cutoff = '2024-02-29'; // Feb 29, 2024 is leap day
  const beforeCutoff = '2024-02-28'; // 1 day before leap day cutoff -> REJECTED
  const afterCutoff = '2024-03-01'; // 1 day after leap day cutoff -> VALID

  const resCutoff = validarDataEvolucao17Meses(cutoff, refDate);
  assert.equal(resCutoff.valida, true, 'Leap day cutoff 2024-02-29 MUST be valid');
  assert.equal(resCutoff.erro, null);

  const resAfter = validarDataEvolucao17Meses(afterCutoff, refDate);
  assert.equal(resAfter.valida, true, '2024-03-01 MUST be valid');

  const resBefore = validarDataEvolucao17Meses(beforeCutoff, refDate);
  assert.equal(resBefore.valida, false, '2024-02-28 MUST be rejected because it is prior to 2024-02-29');
  assert.equal(resBefore.erro, EXACT_ERROR_TEXT);
});

test('ADV-2.3: Non-leap year tri-state boundary (July 31, 2026 -> Feb 28, 2025)', () => {
  const refDate = parseDate('2026-07-31');
  const cutoff = '2025-02-28';
  const beforeCutoff = '2025-02-27';
  const afterCutoff = '2025-03-01';

  const resCutoff = validarDataEvolucao17Meses(cutoff, refDate);
  assert.equal(resCutoff.valida, true, '2025-02-28 MUST be valid');

  const resAfter = validarDataEvolucao17Meses(afterCutoff, refDate);
  assert.equal(resAfter.valida, true, '2025-03-01 MUST be valid');

  const resBefore = validarDataEvolucao17Meses(beforeCutoff, refDate);
  assert.equal(resBefore.valida, false, '2025-02-27 MUST be rejected');
  assert.equal(resBefore.erro, EXACT_ERROR_TEXT);
});

test('ADV-2.4: Character-by-character and byte verification of exact error text', () => {
  const refDate = parseDate('2026-10-28');
  const res = validarDataEvolucao17Meses('2020-01-01', refDate);

  const expected = 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão';
  assert.equal(res.erro, expected);

  // Character code match to ensure no encoding corruption
  assert.equal(res.erro.length, expected.length);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(
      res.erro.charCodeAt(i),
      expected.charCodeAt(i),
      `Mismatch at char ${i}: '${res.erro[i]}' (${res.erro.charCodeAt(i)}) !== '${expected[i]}' (${expected.charCodeAt(i)})`
    );
  }
});

test('ADV-2.5: Resilient handling of malformed and adversarial date inputs', () => {
  const refDate = parseDate('2026-10-28');

  // Null / undefined / empty
  const resNull = validarDataEvolucao17Meses(null, refDate);
  assert.equal(resNull.valida, false);
  assert.equal(resNull.erro, 'Data de evolução não informada.');

  const resUndef = validarDataEvolucao17Meses(undefined, refDate);
  assert.equal(resUndef.valida, false);
  assert.equal(resUndef.erro, 'Data de evolução não informada.');

  const resEmpty = validarDataEvolucao17Meses('', refDate);
  assert.equal(resEmpty.valida, false);
  assert.equal(resEmpty.erro, 'Data de evolução não informada.');

  // Garbage strings
  const resGarbage1 = validarDataEvolucao17Meses('banana', refDate);
  assert.equal(resGarbage1.valida, false);
  assert.equal(resGarbage1.erro, 'Data de evolução inválida.');

  const resGarbage2 = validarDataEvolucao17Meses('2025/13/45', refDate);
  assert.equal(resGarbage2.valida, false);
  assert.equal(resGarbage2.erro, 'Data de evolução inválida.');

  // BR format DD/MM/YYYY support
  const resBRValid = validarDataEvolucao17Meses('28/05/2025', refDate);
  assert.equal(resBRValid.valida, true);

  const resBROld = validarDataEvolucao17Meses('27/05/2025', refDate);
  assert.equal(resBROld.valida, false);
  assert.equal(resBROld.erro, EXACT_ERROR_TEXT);
});

test('ADV-2.6: Time-of-day and timezone timestamp variance resistance', () => {
  // Midnight vs End of day
  const refStartOfDay = new Date(2026, 9, 28, 0, 0, 0, 0);
  const refEndOfDay = new Date(2026, 9, 28, 23, 59, 59, 999);
  const refMidday = new Date(2026, 9, 28, 12, 34, 56, 789);

  const resStart = validarDataEvolucao17Meses('2025-05-28', refStartOfDay);
  const resEnd = validarDataEvolucao17Meses('2025-05-28', refEndOfDay);
  const resMid = validarDataEvolucao17Meses('2025-05-28', refMidday);

  assert.equal(resStart.limite17MesesISO, '2025-05-28');
  assert.equal(resEnd.limite17MesesISO, '2025-05-28');
  assert.equal(resMid.limite17MesesISO, '2025-05-28');

  assert.equal(resStart.valida, true);
  assert.equal(resEnd.valida, true);
  assert.equal(resMid.valida, true);
});

// ============================================================================
// SUITE 3: STUDENTFORM.JSX LOGICAL SECURITY & SUBMISSION BARRIER
// ============================================================================

test('ADV-3.1: StudentForm.jsx enforces submit barrier on invalid evolution date', () => {
  const formPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');
  const src = fs.readFileSync(formPath, 'utf8');

  // 1. Submit button must be disabled when form is invalid
  assert.match(
    src,
    /disabled=\{!formularioValido \|\| enviando\}/,
    'Submit button must be disabled when formularioValido is false'
  );

  // 2. Form submission handler must guard against invalid form
  assert.match(
    src,
    /if\s*\(!formularioValido\)\s*return;/,
    'enviar() function must immediately return if !formularioValido'
  );

  // 3. formularioValido MUST include validacaoEvolucao.valida
  assert.match(
    src,
    /validacaoEvolucao\.valida/,
    'formularioValido boolean expression must include validacaoEvolucao.valida'
  );

  // 4. When validacaoEvolucao is invalid, periodosSugeridos MUST be empty
  assert.match(
    src,
    /if\s*\(!validacaoEvolucao\.valida\)\s*return\s*\[\];/,
    'periodosSugeridos must return empty array if evolution date is invalid'
  );

  // 5. Error banner must display validacaoEvolucao.erro
  assert.match(
    src,
    /\{validacaoEvolucao\.erro\}/,
    'UI must render validacaoEvolucao.erro'
  );
});

test('ADV-3.2: Verification of Institutional Notice (96h) and absence of observacao textarea', () => {
  const formPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');
  const src = fs.readFileSync(formPath, 'utf8');

  // Textarea must be completely eradicated
  assert.equal(src.includes('id="observacao"'), false, 'id="observacao" must NOT exist');
  assert.equal(src.includes('<textarea'), false, '<textarea> must NOT exist anywhere in StudentForm');

  // Must contain 96hr in bold
  assert.match(src, /<strong>96hr<\/strong>/, 'Notice must highlight 96hr with <strong> tag');

  // Core text paragraphs must be present
  assert.ok(
    src.includes('Caso seja necessário atualização ou correção de algum dado pessoal'),
    'Notice text beginning must match specification'
  );
  assert.ok(
    src.includes('ocasionará o cancelamento da solicitação'),
    'Notice cancellation clause must be present'
  );
});
