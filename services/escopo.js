/**
 * Escopo do formulário: apenas cursos de Extensão e Aperfeiçoamento (incluindo variantes,
 * como "Extensão Saúde" ou "Aperfeiçoamento Presencial"). Outros tipos (Pós-Graduação,
 * Capacitação, Atualização etc.) não passam por este formulário.
 */

export const normalizarTexto = (txt) =>
  String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** "Reingresso em Extensão" é outro fluxo, e "Projeto de Extensão" não é emitido por aqui. */
export function tipoCursoNoEscopo(tipoCurso) {
  const t = normalizarTexto(tipoCurso);
  // Sem tipo informado: mantém o comportamento anterior (tratado como Extensão)
  if (!t) return true;
  if (t.startsWith('reingresso') || t.startsWith('projeto')) return false;
  return t.startsWith('extensao') || t.startsWith('aperfeicoamento');
}
