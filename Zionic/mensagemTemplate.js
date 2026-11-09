/**
 * Módulo de Templates de Mensagem do Zionic para Emissão de Certificados
 */

/**
 * Monta o texto de notificação para o aluno via WhatsApp (Zionic),
 * encapsulando todos os cursos solicitados pelo aluno (1, 3, 10 cursos)
 * e o link seguro para confirmação.
 *
 * @param {Object} params
 * @param {string} params.nome Nome do aluno (capturado da coluna C)
 * @param {Array<string|Object>} params.cursos Lista de cursos solicitados
 * @param {string} params.linkUrl Link individual seguro do formulário
 * @returns {string} Mensagem formatada para o WhatsApp
 */
export function montarMensagemCertificado({ nome, cursos = [], linkUrl }) {
  const nomeLimpo = (nome || 'Aluno(a)').trim();
  const primeiroNome = nomeLimpo.split(/\s+/)[0] || 'Aluno(a)';

  // Extrai os nomes dos cursos sem duplicação
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

  const texto =
`Olá, *${primeiroNome}*! 👋

Identificamos a sua solicitação para a emissão ${plural ? 'dos certificados' : 'do certificado'} ${plural ? 'dos seguintes cursos' : 'do seguinte curso'}:

${listaCursosTexto}

Para concluir a sua solicitação e conferir as datas pedagógicas programadas, por favor acesse o seu link seguro abaixo:
👉 ${linkUrl}

⚠️ *Atenção:* O prazo para confirmação do formulário é de *96 horas*.

Caso tenha alguma dúvida, basta responder a esta mensagem.`;

  return texto;
}
