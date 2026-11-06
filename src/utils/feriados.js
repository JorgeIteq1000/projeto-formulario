/**
 * Calendário de feriados usado para pular dias não úteis no cálculo dos períodos.
 *
 * Considera os feriados nacionais, a Sexta-feira Santa e os feriados de São Paulo (estado e capital).
 * Pontos facultativos (Carnaval, Corpus Christi etc.) NÃO entram. Para incluir outro feriado,
 * acrescente em FERIADOS_FIXOS (mês 1-12 e dia) ou em feriadosMoveis (relativo à Páscoa).
 */

/** [mês (1-12), dia, descrição] */
export const FERIADOS_FIXOS = [
  [1, 1, 'Confraternização Universal'],
  [1, 25, 'Aniversário de São Paulo'],
  [4, 21, 'Tiradentes'],
  [5, 1, 'Dia do Trabalho'],
  [7, 9, 'Revolução Constitucionalista (SP)'],
  [9, 7, 'Independência do Brasil'],
  [10, 12, 'Nossa Senhora Aparecida'],
  [11, 2, 'Finados'],
  [11, 15, 'Proclamação da República'],
  [11, 20, 'Consciência Negra'],
  [12, 25, 'Natal']
];

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function domingoDePascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

/** Feriados que dependem da Páscoa (apenas a Sexta-feira Santa). */
function feriadosMoveis(ano) {
  const pascoa = domingoDePascoa(ano);
  const sextaSanta = new Date(ano, pascoa.getMonth(), pascoa.getDate() - 2);
  return [[sextaSanta.getMonth() + 1, sextaSanta.getDate(), 'Sexta-feira Santa']];
}

/** @returns {Array<[number, number, string]>} feriados do ano como [mês, dia, descrição] */
export function feriadosDoAno(ano) {
  return [...FERIADOS_FIXOS, ...feriadosMoveis(ano)];
}

export function ehFeriado(date) {
  const mes = date.getMonth() + 1;
  const dia = date.getDate();
  return feriadosDoAno(date.getFullYear()).some(([m, d]) => m === mes && d === dia);
}
