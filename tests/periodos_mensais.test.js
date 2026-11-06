import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ehFeriado, domingoDePascoa, feriadosDoAno } from '../src/utils/feriados.js';
import {
  parseCargaHoraria,
  mesesDoPeriodo,
  periodoMensal,
  primeiroDiaUtilDoMes,
  ultimoDiaUtilDoMes,
  gerarSugestoesPeriodos,
  recalcularPeriodosComJanela30Dias,
  diasEntreDatas,
  MIN_DIAS_ENTRE_CONCLUSOES,
  validarDataConclusao,
  formatDateISO
} from '../src/utils/dateSuggestions.js';

const iso = (p) => [formatDateISO(p.inicio), formatDateISO(p.fim)];
const HOJE = new Date(2026, 10, 3); // 03/11/2026

test('parseCargaHoraria aceita número, "45h" e "100 horas"', () => {
  assert.equal(parseCargaHoraria(45), 45);
  assert.equal(parseCargaHoraria('45'), 45);
  assert.equal(parseCargaHoraria('45h'), 45);
  assert.equal(parseCargaHoraria('100 horas'), 100);
  assert.equal(parseCargaHoraria(''), null);
  assert.equal(parseCargaHoraria(undefined), null);
});

test('mesesDoPeriodo: 45h=1, 100h=120h=2, 180h=3; sem regra usa o padrão do tipo e marca como estimada', () => {
  assert.deepEqual(mesesDoPeriodo(45, 'Extensão'), { meses: 1, cargaConsiderada: 45, estimada: false });
  assert.deepEqual(mesesDoPeriodo('100', 'Extensão'), { meses: 2, cargaConsiderada: 100, estimada: false });
  assert.deepEqual(mesesDoPeriodo(180, 'Aperfeiçoamento'), { meses: 3, cargaConsiderada: 180, estimada: false });
  // Sem carga: Extensão = 100h, Aperfeiçoamento = 180h
  assert.deepEqual(mesesDoPeriodo('', 'Extensão Saúde'), { meses: 2, cargaConsiderada: 100, estimada: true });
  assert.deepEqual(mesesDoPeriodo(null, 'Aperfeiçoamento Presencial'), { meses: 3, cargaConsiderada: 180, estimada: true });
  // 120h segue a mesma regra de 100h
  assert.deepEqual(mesesDoPeriodo(120, 'Extensão'), { meses: 2, cargaConsiderada: 120, estimada: false });
  // Carga sem regra (ex.: 36h) usa o padrão do tipo
  assert.deepEqual(mesesDoPeriodo(36, 'Extensão'), { meses: 2, cargaConsiderada: 100, estimada: true });
});

test('dias úteis: 1º e último dia útil do mês pulam fim de semana', () => {
  // Out/2026: dia 1 é quinta; dia 31 é sábado
  assert.equal(formatDateISO(primeiroDiaUtilDoMes(2026, 9)), '2026-10-01');
  assert.equal(formatDateISO(ultimoDiaUtilDoMes(2026, 9)), '2026-10-30');
  // Ago/2026: dia 1 é sábado
  assert.equal(formatDateISO(primeiroDiaUtilDoMes(2026, 7)), '2026-08-03');
  // Fev/2026 termina em sábado (28): último dia útil = 27
  assert.equal(formatDateISO(ultimoDiaUtilDoMes(2026, 1)), '2026-02-27');
});

test('exemplos do setor: 45h, 100h e Aperfeiçoamento 180h', () => {
  assert.deepEqual(iso(periodoMensal(2026, 9, 1)), ['2026-10-01', '2026-10-30']); // 45h
  assert.deepEqual(iso(periodoMensal(2026, 8, 2)), ['2026-09-01', '2026-10-30']); // 100h
  // 180h: o exemplo informado começa em 01/08/2026, mas é sábado; pela regra "pula fim de semana" começa em 03/08
  assert.deepEqual(iso(periodoMensal(2026, 7, 3)), ['2026-08-03', '2026-10-30']);
});

test('gerarSugestoesPeriodos: 1º curso começa no 1º dia útil do mês seguinte à evolução', () => {
  const cursos = [
    { curso: 'A', tipoCurso: 'Extensão', cargaHoraria: 100 },
    { curso: 'B', tipoCurso: 'Extensão', cargaHoraria: '45' }
  ];
  const [a, b] = gerarSugestoesPeriodos('2026-06-15', cursos, HOJE);
  assert.deepEqual([a.dataInicio, a.dataFim], ['2026-07-01', '2026-08-31']);
  assert.deepEqual([b.dataInicio, b.dataFim], ['2026-09-01', '2026-09-30']);
  assert.equal(a.mesesPeriodo, 2);
  assert.equal(a.ultrapassaHoje, false);
  assert.equal(b.ultrapassaHoje, false);
});

test('gerarSugestoesPeriodos: evolução no 1º dia útil do mês começa no mês seguinte (estritamente após)', () => {
  const [a] = gerarSugestoesPeriodos('2026-09-01', [{ curso: 'A', tipoCurso: 'Extensão', cargaHoraria: 45 }], HOJE);
  assert.equal(a.dataInicio, '2026-10-01');
});

test('gerarSugestoesPeriodos: períodos que terminam depois de hoje são cancelados por data futura', () => {
  const [a, b] = gerarSugestoesPeriodos(
    '2026-08-20',
    [
      { curso: 'A', tipoCurso: 'Extensão', cargaHoraria: 100 }, // set a out -> termina 30/10 (ok)
      { curso: 'B', tipoCurso: 'Extensão', cargaHoraria: 45 } // nov -> termina 30/11 (futuro)
    ],
    HOJE
  );
  assert.equal(a.dataFim, '2026-10-30');
  assert.equal(a.ultrapassaHoje, false);
  assert.equal(b.dataInicio, '2026-11-03'); // 02/11 é feriado (Finados)
  assert.equal(b.dataFim, '2026-11-30');
  assert.equal(b.ultrapassaHoje, true);
  assert.equal(b.cancelado, true);
});

test('gerarSugestoesPeriodos: sem evolução parte do limite de 17 meses', () => {
  const [a] = gerarSugestoesPeriodos('', [{ curso: 'A', tipoCurso: 'Extensão', cargaHoraria: 45 }], HOJE);
  // 03/11/2026 - 17 meses = 03/06/2025: 1º dia útil em/depois dessa data é 01/07/2025
  assert.equal(a.dataInicio, '2025-07-01');
});

test('gerarSugestoesPeriodos: Aperfeiçoamento sem carga usa 3 meses e marca carga estimada', () => {
  const [a] = gerarSugestoesPeriodos('2026-05-10', [{ curso: 'X', tipoCurso: 'Aperfeiçoamento' }], HOJE);
  assert.equal(a.mesesPeriodo, 3);
  assert.equal(a.cargaEstimada, true);
  assert.deepEqual([a.dataInicio, a.dataFim], ['2026-06-01', '2026-08-31']);
});

test('validarDataConclusao: início calculado pela duração, em dias úteis', () => {
  // 100h (2 meses), conclusão 30/10/2026 -> 01/09/2026 a 30/10/2026
  const ok = validarDataConclusao('2026-10-30', HOJE, 2);
  assert.equal(ok.valida, true);
  assert.deepEqual([ok.dataInicioISO, ok.dataFimISO], ['2026-09-01', '2026-10-30']);
  // 180h (3 meses): início = 1º dia útil de agosto
  assert.equal(validarDataConclusao('2026-10-30', HOJE, 3).dataInicioISO, '2026-08-03');
  // 45h (1 mês)
  assert.equal(validarDataConclusao('2026-10-30', HOJE, 1).dataInicioISO, '2026-10-01');
});

test('validarDataConclusao: fim de semana é antecipado para o último dia útil', () => {
  const res = validarDataConclusao('2026-10-31', HOJE, 1); // sábado
  assert.equal(res.valida, true);
  assert.equal(res.dataFimISO, '2026-10-30');
});

test('validarDataConclusao: bloqueia futuro e início anterior ao limite de 17 meses', () => {
  const futuro = validarDataConclusao('2026-11-30', HOJE, 1);
  assert.equal(futuro.valida, false);
  assert.match(futuro.erro, /ultrapassa a data atual/);

  const antigo = validarDataConclusao('2025-06-10', HOJE, 1); // início 02/06/2025 < 03/06/2025
  assert.equal(antigo.valida, false);
  assert.match(antigo.erro, /período não pode ser contabilizado/i);
  assert.equal(validarDataConclusao('', HOJE, 1).valida, false);
});

test('feriados: Páscoa, Sexta-feira Santa e feriados fixos', () => {
  assert.equal(formatDateISO(domingoDePascoa(2026)), '2026-04-05');
  assert.equal(formatDateISO(domingoDePascoa(2025)), '2025-04-20');
  assert.equal(ehFeriado(new Date(2026, 3, 3)), true); // Sexta-feira Santa 2026
  assert.equal(ehFeriado(new Date(2026, 10, 2)), true); // Finados
  assert.equal(ehFeriado(new Date(2026, 6, 9)), true); // 9 de julho (SP)
  assert.equal(ehFeriado(new Date(2026, 0, 25)), true); // aniversário de São Paulo
  assert.equal(ehFeriado(new Date(2026, 1, 17)), false); // Carnaval é ponto facultativo
  assert.equal(ehFeriado(new Date(2026, 5, 4)), false); // Corpus Christi é ponto facultativo
  assert.equal(feriadosDoAno(2026).length, 12);
});

test('dias úteis pulam feriados (além de fins de semana)', () => {
  // 01/01/2026 é quinta e feriado: o 1º dia útil é sexta, 02/01
  assert.equal(formatDateISO(primeiroDiaUtilDoMes(2026, 0)), '2026-01-02');
  // 01/05/2026 é sexta e feriado: o 1º dia útil é segunda, 04/05
  assert.equal(formatDateISO(primeiroDiaUtilDoMes(2026, 4)), '2026-05-04');
  // 02/11/2026 é segunda e feriado: o 1º dia útil é terça, 03/11
  assert.equal(formatDateISO(primeiroDiaUtilDoMes(2026, 10)), '2026-11-03');
  // 25/12/2027 é sábado e 31/12/2027 é sexta; já 25/12/2026 (sexta) não afeta o último dia do mês
  assert.equal(formatDateISO(ultimoDiaUtilDoMes(2026, 11)), '2026-12-31');
});

test('conclusão em feriado é antecipada para o dia útil anterior', () => {
  // 01/01/2026 (feriado) -> 31/12/2025 (quarta)
  const res = validarDataConclusao('2026-01-01', HOJE, 1);
  assert.equal(res.dataFimISO, '2025-12-31');
});

test('120h segue a regra das 100h (2 meses)', () => {
  const [a] = gerarSugestoesPeriodos('2026-06-15', [{ curso: 'A', tipoCurso: 'Extensão', cargaHoraria: 120 }], HOJE);
  assert.equal(a.mesesPeriodo, 2);
  assert.equal(a.cargaEstimada, false);
  assert.deepEqual([a.dataInicio, a.dataFim], ['2026-07-01', '2026-08-31']);
});

test('recalcularPeriodosComJanela30Dias: garante janela mínima de 30 dias entre datas de conclusão e retorna índices modificados', () => {
  const cursos = [
    { curso: 'A NECESSIDADE DA FORMAÇÃO CONTINUADA PARA OS PROFESSORES', tipoCurso: 'Extensão 45h', cargaHoraria: '' },
    { curso: 'A LUDICIDADE E A RELAÇÃO ENTRE BRINCAR E O APRENDER', tipoCurso: 'Extensão 45h', cargaHoraria: '' },
    { curso: 'INCLUSÃO NA EDUCAÇÃO: TEORIA E APLICAÇÃO', tipoCurso: 'Extensão 100h', cargaHoraria: '' },
    { curso: 'NEUROPSICOPEDAGOGIA E APRENDIZAGEM', tipoCurso: 'Extensão 100h', cargaHoraria: '100h' }
  ];
  const sugeridos = gerarSugestoesPeriodos('2026-02-16', cursos, HOJE);
  // Verifica que todos os períodos sugeridos já respeitam >= 30 dias entre conclusões
  for (let i = 1; i < sugeridos.length; i++) {
    assert.ok(
      diasEntreDatas(sugeridos[i - 1].dataFim, sugeridos[i].dataFim) >= MIN_DIAS_ENTRE_CONCLUSOES,
      `Esperado >= 30 dias entre curso ${i} (${sugeridos[i - 1].dataFim}) e curso ${i + 1} (${sugeridos[i].dataFim})`
    );
  }

  // Aluno altera conclusão do Curso 1 para 01/07/2026
  const recalc = recalcularPeriodosComJanela30Dias(sugeridos, 1, '2026-07-01', HOJE);
  assert.equal(recalc.validacaoEditado.valida, true);
  assert.equal(recalc.periodos[0].dataInicio, '2026-06-01');
  assert.equal(recalc.periodos[0].dataFim, '2026-07-01');

  // Curso 2 (que terminava antes de 31/07/2026) deve ser ajustado para ter no mínimo 30 dias após 01/07/2026 -> 31/07/2026
  assert.equal(recalc.periodos[1].dataFim, '2026-07-31');
  assert.ok(diasEntreDatas(recalc.periodos[0].dataFim, recalc.periodos[1].dataFim) >= 30);
  assert.ok(recalc.indicesModificados.includes(2));

  // Todos os cursos subsequentes também respeitam a janela mínima de 30 dias entre conclusões
  for (let i = 1; i < recalc.periodos.length; i++) {
    assert.ok(
      diasEntreDatas(recalc.periodos[i - 1].dataFim, recalc.periodos[i].dataFim) >= MIN_DIAS_ENTRE_CONCLUSOES,
      `Esperado >= 30 dias entre curso ${i} (${recalc.periodos[i - 1].dataFim}) e curso ${i + 1} (${recalc.periodos[i].dataFim})`
    );
  }
});
