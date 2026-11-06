/**
 * Utilitário de cálculo e sugestão de períodos pedagógicos para cursos de extensão
 * 
 * Regras de Negócio:
 * 1. Limite retroativo: 17 meses a partir de hoje.
 * 2. Períodos mensais em dias úteis, conforme a carga horária (45h = 1 mês, 100h = 2 meses, 180h = 3 meses).
 * 3. Proibida sobreposição (não pode haver 2 cursos no mesmo período).
 * 4. Cursos sequenciais: o Curso 2 inicia no mês seguinte ao término do Curso 1.
 */

import { ehFeriado } from './feriados.js';

export const DATA_LIMITE_INICIAL = '2025-11-10'; // 10 de Novembro de 2025

export function parseDate(str) {
  if (!str) return null;
  // Formato YYYY-MM-DD
  const mISO = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (mISO) {
    return new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]));
  }
  // Formato DD/MM/YYYY
  const mBR = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(str);
  if (mBR) {
    return new Date(Number(mBR[3]), Number(mBR[2]) - 1, Number(mBR[1]));
  }
  return null;
}

export function formatDateBR(date) {
  if (!date || isNaN(date.getTime())) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

export function formatDateISO(date) {
  if (!date || isNaN(date.getTime())) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
  const res = new Date(date.getTime());
  res.setDate(res.getDate() + days);
  return res;
}

/**
 * Adiciona exatamente 1 mês à data (ex: 10/11/2025 -> 10/12/2025)
 * Trata estouros de meses com menos dias (ex: 31 de janeiro -> 28/29 de fevereiro)
 */
export function addOneMonth(date) {
  const ano = date.getFullYear();
  const mes = date.getMonth();
  const dia = date.getDate();

  // Mês seguinte
  const novoMes = mes + 1;
  const novoAno = ano + Math.floor(novoMes / 12);
  const mesAjustado = novoMes % 12;

  // Descobre quantos dias tem o mês de destino
  const diasNoMesDestino = new Date(novoAno, mesAjustado + 1, 0).getDate();
  const diaFinal = Math.min(dia, diasNoMesDestino);

  return new Date(novoAno, mesAjustado, diaFinal);
}

/**
 * Subtrai months meses da data, respeitando o número de dias do mês de destino
 * (ex: 31 de março - 1 mês = 28/29 de fevereiro).
 * @param {Date|string} date
 * @param {number} months
 * @returns {Date}
 */
export function subtractMonths(date, months) {
  if (!date) return null;
  const d = typeof date === 'string' ? parseDate(date) || new Date(date) : new Date(date.getTime ? date.getTime() : date);
  if (isNaN(d.getTime())) return null;

  const ano = d.getFullYear();
  const mes = d.getMonth();
  const dia = d.getDate();

  const novoMes = mes - months;
  const novoAno = ano + Math.floor(novoMes / 12);
  const mesAjustado = ((novoMes % 12) + 12) % 12;

  const diasNoMesDestino = new Date(novoAno, mesAjustado + 1, 0).getDate();
  const diaFinal = Math.min(dia, diasNoMesDestino);

  return new Date(novoAno, mesAjustado, diaFinal);
}

/**
 * Valida se a data de evolução informada respeita o limite retroativo de até 17 meses da data atual.
 * @param {string} dataEvolucaoStr - Data no formato YYYY-MM-DD ou DD/MM/YYYY
 * @param {Date} [dataHoje] - Data de referência (padrão: hoje)
 * @returns {{ valida: boolean, erro: string|null, limite17MesesISO: string }}
 */
export function validarDataEvolucao17Meses(dataEvolucaoStr, dataHoje = new Date()) {
  const limite17 = subtractMonths(dataHoje, 17);
  const limite17MesesISO = formatDateISO(limite17);

  if (!dataEvolucaoStr) {
    return {
      valida: false,
      erro: 'Data de evolução não informada.',
      limite17MesesISO
    };
  }

  const evolucaoParsed = parseDate(dataEvolucaoStr);
  if (!evolucaoParsed || isNaN(evolucaoParsed.getTime())) {
    return {
      valida: false,
      erro: 'Data de evolução inválida.',
      limite17MesesISO
    };
  }

  const dataEvolucaoISO = formatDateISO(evolucaoParsed);

  if (dataEvolucaoISO < limite17MesesISO) {
    return {
      valida: false,
      erro: 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão',
      limite17MesesISO
    };
  }

  return {
    valida: true,
    erro: null,
    limite17MesesISO
  };
}

/**
 * Valida data de início customizada para um certificado (limite 17 meses e término <= hoje).
 * @param {string} dataInicioStr - Data no formato YYYY-MM-DD ou DD/MM/YYYY
 * @param {Date} [dataHoje] - Data de referência (padrão: hoje)
 * @returns {{ valida: boolean, erro: string|null, dataInicioISO: string, dataFimISO: string, dataInicioFormatada: string, dataFimFormatada: string }}
 */
export function validarDataCustomizada(dataInicioStr, dataHoje = new Date()) {
  const limite17 = subtractMonths(dataHoje, 17);
  const limite17MesesISO = formatDateISO(limite17);

  if (!dataInicioStr || !/^\d{4}-\d{2}-\d{2}$/.test(dataInicioStr)) {
    return {
      valida: false,
      erro: 'Informe uma data de início válida.',
      dataInicioISO: '',
      dataFimISO: '',
      dataInicioFormatada: '',
      dataFimFormatada: ''
    };
  }

  const dataInicio = parseDate(dataInicioStr);
  if (!dataInicio || isNaN(dataInicio.getTime())) {
    return {
      valida: false,
      erro: 'Informe uma data de início válida.',
      dataInicioISO: '',
      dataFimISO: '',
      dataInicioFormatada: '',
      dataFimFormatada: ''
    };
  }

  const dataInicioISO = formatDateISO(dataInicio);

  if (dataInicioISO < limite17MesesISO) {
    return {
      valida: false,
      erro: 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão',
      dataInicioISO,
      dataFimISO: '',
      dataInicioFormatada: formatDateBR(dataInicio),
      dataFimFormatada: ''
    };
  }

  const dataFim = addOneMonth(dataInicio);
  const dataFimISO = formatDateISO(dataFim);
  const dataHojeISO = formatDateISO(dataHoje);

  if (dataFimISO > dataHojeISO) {
    return {
      valida: false,
      erro: 'O término da extensão (+1 mês corrido) ultrapassa a data atual.',
      dataInicioISO,
      dataFimISO,
      dataInicioFormatada: formatDateBR(dataInicio),
      dataFimFormatada: formatDateBR(dataFim)
    };
  }

  return {
    valida: true,
    erro: null,
    dataInicioISO,
    dataFimISO,
    dataInicioFormatada: formatDateBR(dataInicio),
    dataFimFormatada: formatDateBR(dataFim)
  };
}

// ---------------------------------------------------------------------------
// Períodos por carga horária (meses corridos, sempre em dias úteis)
// ---------------------------------------------------------------------------

/**
 * Duração do período, em meses, por carga horária (regra informada pelo setor de emissão):
 * - 45h  : do início ao fim do mesmo mês (1 mês)
 * - 100h : do início de um mês ao fim do mês seguinte (2 meses)
 * - 180h : (Aperfeiçoamento) 3 meses
 * - 120h : mesma regra de 100h (2 meses)
 * Outras cargas (sem regra) usam o padrão do tipo de curso.
 */
export const MESES_POR_CARGA = { 45: 1, 100: 2, 120: 2, 180: 3 };

/** Carga considerada quando a do curso é desconhecida ou não tem regra: Aperfeiçoamento = 180h; Extensão = 100h. */
export const CARGA_PADRAO_POR_TIPO = { aperfeicoamento: 180, extensao: 100 };

/** Aceita 45, "45", "45h" ou "100 horas". Retorna null se não houver número. */
export function parseCargaHoraria(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const m = /\d+/.exec(String(valor));
  return m ? Number(m[0]) : null;
}

/**
 * @returns {{ meses: number, cargaConsiderada: number, estimada: boolean }}
 * `estimada` indica que a carga do curso era desconhecida ou sem regra e foi usado o padrão do tipo.
 */
export function mesesDoPeriodo(cargaHoras, tipoCurso) {
  const carga = parseCargaHoraria(cargaHoras);
  if (carga !== null && MESES_POR_CARGA[carga]) {
    return { meses: MESES_POR_CARGA[carga], cargaConsiderada: carga, estimada: false };
  }
  const tipo = String(tipoCurso || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const padrao = tipo.startsWith('aperfeicoamento') ? CARGA_PADRAO_POR_TIPO.aperfeicoamento : CARGA_PADRAO_POR_TIPO.extensao;
  return { meses: MESES_POR_CARGA[padrao], cargaConsiderada: padrao, estimada: true };
}

/** Dia não útil: sábado, domingo ou feriado (ver feriados.js). */
const ehDiaNaoUtil = (d) => d.getDay() === 0 || d.getDay() === 6 || ehFeriado(d);

/** Primeiro dia útil do mês (exclui fins de semana e feriados). `mes` é 0-11 e pode estourar para outros anos. */
export function primeiroDiaUtilDoMes(ano, mes) {
  let d = new Date(ano, mes, 1);
  while (ehDiaNaoUtil(d)) d = addDays(d, 1);
  return d;
}

/** Último dia útil do mês (exclui fins de semana e feriados). */
export function ultimoDiaUtilDoMes(ano, mes) {
  let d = new Date(ano, mes + 1, 0);
  while (ehDiaNaoUtil(d)) d = addDays(d, -1);
  return d;
}

/** Último dia útil em ou antes da data (para datas que caem em fim de semana). */
export function diaUtilAnterior(date) {
  let d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  while (ehDiaNaoUtil(d)) d = addDays(d, -1);
  return d;
}

/** Período que começa no 1º dia útil do mês informado e termina no último dia útil do mês final (início + meses - 1). */
export function periodoMensal(ano, mesInicio, meses) {
  const inicio = primeiroDiaUtilDoMes(ano, mesInicio);
  const fimRef = new Date(ano, mesInicio + meses - 1, 1);
  const fim = ultimoDiaUtilDoMes(fimRef.getFullYear(), fimRef.getMonth());
  return { inicio, fim };
}

/**
 * Valida a data de conclusão informada pelo aluno ao recusar a sugestão ("Não Aceito").
 * - A conclusão que cair em fim de semana é antecipada para o último dia útil anterior.
 * - O início é o 1º dia útil do mês que está (meses - 1) meses antes do mês da conclusão.
 * - O início deve respeitar o limite de 17 meses e a conclusão não pode ultrapassar a data atual.
 * @param {string} dataConclusaoStr - Data no formato YYYY-MM-DD
 * @param {Date} [dataHoje] - Data de referência (padrão: hoje)
 * @param {number} [meses] - Duração do período do curso, em meses (ver mesesDoPeriodo)
 * @returns {{ valida: boolean, erro: string|null, dataInicioISO: string, dataFimISO: string, dataInicioFormatada: string, dataFimFormatada: string }}
 */
export function validarDataConclusao(dataConclusaoStr, dataHoje = new Date(), meses = 1) {
  const vazio = {
    valida: false,
    erro: 'Informe uma data de conclusão válida.',
    dataInicioISO: '',
    dataFimISO: '',
    dataInicioFormatada: '',
    dataFimFormatada: ''
  };
  if (!dataConclusaoStr || !/^\d{4}-\d{2}-\d{2}$/.test(dataConclusaoStr)) return vazio;

  const digitada = parseDate(dataConclusaoStr);
  if (!digitada || isNaN(digitada.getTime())) return vazio;

  const dataFim = diaUtilAnterior(digitada);
  const dataInicio = primeiroDiaUtilDoMes(dataFim.getFullYear(), dataFim.getMonth() - (meses - 1));
  const resultado = {
    dataInicioISO: formatDateISO(dataInicio),
    dataFimISO: formatDateISO(dataFim),
    dataInicioFormatada: formatDateBR(dataInicio),
    dataFimFormatada: formatDateBR(dataFim)
  };

  if (resultado.dataInicioISO < formatDateISO(subtractMonths(dataHoje, 17))) {
    return {
      ...resultado,
      valida: false,
      erro: 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão'
    };
  }

  if (resultado.dataFimISO > formatDateISO(dataHoje)) {
    return {
      ...resultado,
      valida: false,
      erro: 'A data de conclusão ultrapassa a data atual.'
    };
  }

  return { ...resultado, valida: true, erro: null };
}

/**
 * Calcula a lista de períodos sugeridos para os cursos.
 *
 * Regras:
 * - Cada período começa no 1º dia útil de um mês e termina no último dia útil do mês final
 *   (45h = 1 mês, 100h = 2 meses, 180h = 3 meses; ver mesesDoPeriodo).
 * - O 1º curso começa no primeiro mês cujo 1º dia útil é posterior à data da evolução
 *   (ou, sem evolução / evolução anterior ao limite, em ou depois do limite de 17 meses).
 * - Cursos sequenciais, sem sobreposição: o seguinte começa no mês após o término do anterior.
 * - Períodos que terminam depois de hoje são marcados como cancelados (data futura).
 * @param {string} dataEvolucao - Data no formato YYYY-MM-DD
 * @param {Array} cursos - Lista de cursos do aluno (com tipoCurso e cargaHoraria)
 * @param {Date} [dataHoje] - Data atual para conferência de limite
 */
export function gerarSugestoesPeriodos(dataEvolucao, cursos = [], dataHoje = new Date()) {
  if (!cursos || cursos.length === 0) return [];

  const limite17 = subtractMonths(dataHoje, 17);
  const evolucaoParsed = parseDate(dataEvolucao);
  const hojeMeiaNoite = new Date(dataHoje.getFullYear(), dataHoje.getMonth(), dataHoje.getDate());

  // Mês do primeiro curso: estritamente após a evolução, ou em/depois do limite de 17 meses
  const aposEvolucao = Boolean(evolucaoParsed) && evolucaoParsed >= limite17;
  const referencia = aposEvolucao ? evolucaoParsed : limite17;
  let ano = referencia.getFullYear();
  let mes = referencia.getMonth();
  const comeca = (a, m) => {
    const d = primeiroDiaUtilDoMes(a, m);
    return aposEvolucao ? d > referencia : d >= referencia;
  };
  while (!comeca(ano, mes)) mes++;

  const periodos = [];
  for (let i = 0; i < cursos.length; i++) {
    const curso = cursos[i];
    const { meses, cargaConsiderada, estimada } = mesesDoPeriodo(curso.cargaHoraria, curso.tipoCurso);
    const { inicio, fim } = periodoMensal(ano, mes, meses);
    const ultrapassaHoje = fim > hojeMeiaNoite;

    periodos.push({
      indice: i + 1,
      curso: curso.curso,
      tipoCurso: curso.tipoCurso || 'Extensão',
      certificadora: curso.certificadora,
      contrato: curso.contrato,
      cargaHoraria: curso.cargaHoraria || '',
      cargaConsiderada,
      cargaEstimada: estimada,
      mesesPeriodo: meses,
      dataInicio: formatDateISO(inicio),
      dataFim: formatDateISO(fim),
      dataInicioFormatada: formatDateBR(inicio),
      dataFimFormatada: formatDateBR(fim),
      duracao: meses === 1 ? '1 mês' : `${meses} meses`,
      ultrapassaHoje,
      cancelado: ultrapassaHoje,
      status: ultrapassaHoje ? 'CANCELADO_DATA_FUTURA' : 'APROVADO',
      motivoCancelamento: ultrapassaHoje ? 'O término da extensão ultrapassa a data atual.' : null
    });

    // Próximo curso começa no mês seguinte ao término deste
    const proximo = new Date(fim.getFullYear(), fim.getMonth() + 1, 1);
    ano = proximo.getFullYear();
    mes = proximo.getMonth();
  }

  return periodos;
}
