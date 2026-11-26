/**
 * Módulo de Templates de Mensagem do Zionic para Emissão de Certificados
 *
 * Régua completa de comunicação (com concordância singular/plural):
 * 1. 1ª Mensagem (D0): Boas-vindas com link seguro de preenchimento.
 * 2. 2ª Mensagem (Lembrete): Cobrança educada enquanto pendente.
 * 3. 3ª Mensagem (Últimas 24h): Aviso de cancelamento caso não preencha nas próximas 24 horas.
 * 4. 4ª Mensagem (96h - Expirado): Confirmação de cancelamento por falta de interação.
 */

function extrairPrimeiroNome(nome) {
  const nomeLimpo = (nome || 'Aluno(a)').trim();
  return nomeLimpo.split(/\s+/)[0] || 'Aluno(a)';
}

const RODAPE_AUTOMATICO = '*MENSAGEM AUTOMÁTICA, FAVOR NÃO RESPONDER*';

function formatarListaCursos(cursos = []) {
  const nomesCursos = [
    ...new Set(
      (Array.isArray(cursos) ? cursos : [])
        .map((c) => {
          if (typeof c === 'string') return c.trim();
          return (c?.curso || c?.nome || '').trim();
        })
        .filter(Boolean)
    )
  ];

  const plural = nomesCursos.length > 1;
  const listaCursosTexto =
    nomesCursos.length > 0
      ? nomesCursos.map((c) => `• *${c}*`).join('\n')
      : '• *Certificado solicitado*';

  return { plural, nomesCursos, listaCursosTexto };
}

/**
 * 1ª Mensagem (D0 - Recebimento da solicitação)
 */
export function montarMensagemCertificado({ nome, cursos = [], linkUrl }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural, listaCursosTexto } = formatarListaCursos(cursos);

  return `Prezado(a) *${primeiroNome}*, recebemos ${
    plural
      ? 'suas solicitações de certificados referentes aos cursos'
      : 'sua solicitação de certificado referente ao curso'
  }:

${listaCursosTexto}

Clique no link abaixo e preencha as informações para que possamos dar continuidade ${
    plural ? 'às suas solicitações' : 'à sua solicitação'
  }:

Link: ${linkUrl}

A falta de preenchimento ocasionará o cancelamento ${plural ? 'das solicitações' : 'da solicitação'}.

${RODAPE_AUTOMATICO}`;
}

/**
 * 2ª Mensagem (Lembrete Diário enquanto pendente)
 */
export function montarMensagemLembreteDiario({ nome, cursos = [], linkUrl }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural } = formatarListaCursos(cursos);

  return `Prezado(a) *${primeiroNome}*, até o momento não recebemos a resposta do seu formulário. É imprescindível o preenchimento para a emissão ${
    plural ? 'dos seus certificados' : 'do seu certificado'
  }.

Link: ${linkUrl}

${RODAPE_AUTOMATICO}`;
}

/**
 * 3ª Mensagem (Últimas 24h antes do cancelamento automático)
 */
export function montarMensagemAlerta2Horas({ nome, cursos = [], linkUrl }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural } = formatarListaCursos(cursos);

  return `Prezado(a) *${primeiroNome}*, consta pendente o preenchimento do formulário enviado. Caso o preenchimento não seja realizado nas próximas 24 horas, ${
    plural ? 'as solicitações serão canceladas' : 'a solicitação será cancelada'
  } e, se houver interesse na certificação, será necessário realizar ${
    plural ? 'novas solicitações' : 'uma nova solicitação'
  } em seu portal do aluno.

Link: ${linkUrl}

${RODAPE_AUTOMATICO}`;
}

/**
 * 4ª Mensagem (96h - Solicitação cancelada por falta de interatividade)
 */
export function montarMensagemExpirado({ nome, cursos = [] }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural, listaCursosTexto } = formatarListaCursos(cursos);

  return `Prezado(a) *${primeiroNome}*, por falta de interatividade, ${
    plural
      ? 'suas solicitações de certificados referentes aos cursos'
      : 'sua solicitação de certificado referente ao curso'
  }:

${listaCursosTexto}

${plural ? 'foram canceladas' : 'foi cancelada'}.

Caso ainda tenha interesse, realize ${
    plural ? 'novas solicitações' : 'uma nova solicitação'
  } em seu portal do aluno e será enviado um novo formulário.

${RODAPE_AUTOMATICO}`;
}
