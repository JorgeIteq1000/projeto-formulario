// Máscaras e validações

export function maskCPF(value) {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    .slice(0, 14)
}

export function maskCEP(value) {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{5})(\d)/, '$1-$2')
    .slice(0, 9)
}

export function maskPhone(value) {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{4})$/, '$1-$2')
    .slice(0, 15)
}

export function maskRG(value) {
  return value
    .replace(/\D/g, '')
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    .slice(0, 12)
}

export function onlyNumbers(value) {
  return value.replace(/\D/g, '')
}

export function calcPeriod(startDate, endDate) {
  if (!startDate || !endDate) return null
  const inicio = new Date(startDate)
  const fim = new Date(endDate)
  if (fim < inicio) return { error: 'A data de conclusão deve ser posterior ao início' }

  const diffMs = fim - inicio
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  const diffMonths = Math.floor(diffDays / 30)
  const diffYears = Math.floor(diffDays / 365)

  let label = ''
  if (diffDays === 0) label = 'Menos de 1 dia'
  else if (diffDays === 1) label = '1 dia'
  else if (diffDays < 30) label = `${diffDays} dias`
  else if (diffDays < 365) label = `${diffMonths} ${diffMonths === 1 ? 'mês' : 'meses'}`
  else {
    label = `${diffYears} ${diffYears === 1 ? 'ano' : 'anos'}`
    if (diffMonths % 12 > 0) label += ` e ${diffMonths % 12} ${diffMonths % 12 === 1 ? 'mês' : 'meses'}`
  }

  return { diffDays, diffMonths, diffYears, label }
}

export function formatDateBR(isoDate) {
  if (!isoDate) return ''
  const [y, m, d] = isoDate.split('-')
  return `${d}/${m}/${y}`
}
