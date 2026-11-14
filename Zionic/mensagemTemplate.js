/**
 * Módulo de Templates de Mensagem do Zionic para Emissão de Certificados
 * Suporta régua completa de comunicação:
 * 1. D0 (Boas-vindas e link inicial de 96h)
 * 2. Lembrete Diário (a cada 24h enquanto pendente)
 * 3. Alerta Crítico (faltando 2 horas para expirar)
 * 4. Aviso de Expirado (96h atingidas / cancelamento)
 */

function extrairPrimeiroNome(nome) {
  const nomeLimpo = (nome || 'Aluno(a)').trim();
  return nomeLimpo.split(/\s+/)[0] || 'Aluno(a)';
}

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
 * 1. Mensagem Inicial D0 (Boas-vindas)
 */
export function montarMensagemCertificado({ nome, cursos = [], linkUrl }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural, listaCursosTexto } = formatarListaCursos(cursos);

  return `Olá, *${primeiroNome}*! 👋

Identificamos a sua solicitação para a emissão ${plural ? 'dos certificados' : 'do certificado'} ${plural ? 'dos seguintes cursos' : 'do seguinte curso'}:

${listaCursosTexto}

Para concluir a sua solicitação e conferir as datas pedagógicas programadas, por favor acesse o seu link seguro abaixo:
👉 ${linkUrl}

⚠️ *Atenção:* O prazo para confirmação do formulário é de *96 horas*.

Caso tenha alguma dúvida, basta responder a esta mensagem.`;
}

/**
 * 2. Lembrete Diário (a cada 24h de pendência)
 */
export function montarMensagemLembreteDiario({ nome, cursos = [], linkUrl, horasRestantes = 72 }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural, listaCursosTexto } = formatarListaCursos(cursos);
  const horasFormatadas = Math.max(1, Math.round(horasRestantes));

  return `Olá, *${primeiroNome}*! Tudo bem? 📚

Passando para lembrar que a sua solicitação para emissão ${plural ? 'dos certificados' : 'do certificado'} ainda aguarda confirmação:

${listaCursosTexto}

Ainda dá tempo de conferir e confirmar suas datas pelo seu link exclusivo:
👉 ${linkUrl}

⏳ Restam aproximadamente *${horasFormatadas} horas* para a conclusão do prazo de 96h. Após esse período, o link expira e a solicitação é cancelada automaticamente.

Qualquer dúvida, estamos à disposição!`;
}

/**
 * 3. Alerta Crítico (Faltando ~2 horas para as 96h)
 */
export function montarMensagemAlerta2Horas({ nome, cursos = [], linkUrl }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural, listaCursosTexto } = formatarListaCursos(cursos);

  return `🚨 *ATENÇÃO: ÚLTIMAS 2 HORAS* 🚨

Olá, *${primeiroNome}*!

Identificamos que restam *menos de 2 horas* para o encerramento definitivo do prazo de 96h da sua solicitação ${plural ? 'dos certificados' : 'do certificado'}:

${listaCursosTexto}

Para evitar o cancelamento automático do seu pedido no sistema, acesse agora mesmo e confirme:
👉 ${linkUrl}

⚠️ Ao término do prazo, este link será desativado permanentemente.`;
}

/**
 * 4. Aviso de Expirado / Cancelamento (96h concluídas)
 */
export function montarMensagemExpirado({ nome, cursos = [] }) {
  const primeiroNome = extrairPrimeiroNome(nome);
  const { plural, listaCursosTexto } = formatarListaCursos(cursos);

  return `❌ *SOLICITAÇÃO EXPIRADA*

Olá, *${primeiroNome}*.

Informamos que o prazo institucional de 96 horas para confirmação ${plural ? 'dos certificados' : 'do certificado'} abaixo encerrou:

${listaCursosTexto}

O seu link de acesso foi desativado e a solicitação foi cancelada no sistema de emissão.

📌 *O que fazer agora?*
Caso ainda deseje receber ${plural ? 'os certificados' : 'o certificado'}, será necessário abrir uma nova solicitação diretamente pelo seu *Portal do Aluno*.`;
}

