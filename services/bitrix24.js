/**
 * Serviço de Integração com Bitrix24 (CRM / SPA - Smart Process Automation)
 * Portal: grupoiteq.bitrix24.com.br
 * SPA: Processos Internos (entityTypeId: 1046)
 * Categoria / Pipeline: PROCESSO DE EXT/APER (categoryId: 76)
 * 
 * Etapas:
 * - Padrão (sem observação): DT1046_76:CLIENT (CERTIFICADO EMITIDO)
 * - Com observação do aluno: DT1046_76:PREPARATION (APROVAÇÃO DO ALUNO COM REVISÃO)
 * 
 * Campos Customizados:
 * - UF_CRM_14_1748872142: Campo de Observação do aluno
 * - UF_CRM_14_1791995335: Cursos a certificar empilhados (um por linha)
 */

export async function criarCardAlunoSPA({
  nome,
  observacao = null,
  temRevisao = false,
  resumoCustomizacao = null,
  cursos = [],
  protocolo = null
}) {
  // O webhook contém a chave de acesso: vem somente do ambiente (.env), nunca do código
  const webhookUrl = (process.env.BITRIX24_WEBHOOK_URL || '').trim().replace(/\/+$/, '');
  const entityTypeId = Number(process.env.BITRIX24_SPA_ENTITY_TYPE_ID) || 1046;
  const categoryId = Number(process.env.BITRIX24_SPA_CATEGORY_ID) || 76;

  const temCustomizacao = Boolean(temRevisao) || (Array.isArray(cursos) && cursos.some(c => c && (c.aceite === 'Não Aceito' || c.customizado === true)));
  const temObservacao = typeof observacao === 'string' && observacao.trim().length > 0;
  const temRevisaoEfetiva = temCustomizacao || temObservacao;

  let textoRevisao = null;
  if (typeof resumoCustomizacao === 'string' && resumoCustomizacao.trim().length > 0) {
    textoRevisao = resumoCustomizacao.trim();
  } else if (temObservacao) {
    textoRevisao = observacao.trim();
  } else if (temCustomizacao && Array.isArray(cursos)) {
    const naoAceitos = cursos.filter(c => c && (c.aceite === 'Não Aceito' || c.customizado === true));
    if (naoAceitos.length > 0) {
      textoRevisao = naoAceitos.map(c => {
        const ini = c.dataInicioCustomizadaFormatada || c.dataInicioFormatada || c.dataInicioCustomizada || c.dataInicio || '';
        const fim = c.dataFimCustomizadaFormatada || c.dataFimFormatada || c.dataFimCustomizada || c.dataFim || '';
        return `• ${c.curso}: Início solicitado ${ini} a ${fim}`;
      }).join('\n');
    }
  }

  // Se houver revisão (cursos customizados) ou observação do aluno, direciona para PREPARATION
  // Caso contrário, vai diretamente para a etapa padrão (CLIENT)
  const stageId = temRevisaoEfetiva
    ? (process.env.BITRIX24_SPA_STAGE_REVISAO || 'DT1046_76:PREPARATION')
    : (process.env.BITRIX24_SPA_STAGE_DEFAULT || 'DT1046_76:CLIENT');

  if (!webhookUrl) {
    const msgErro = 'BITRIX24_WEBHOOK_URL não configurada no ambiente (.env).';
    console.error(`❌ [BITRIX24 SPA] Card de "${nome}" não criado: ${msgErro}`);
    return { sucesso: false, erro: msgErro, stageId };
  }

  const endpoint = `${webhookUrl}/crm.item.add`;

  // Monta a lista de cursos empilhados (um embaixo do outro com \n)
  // Filtra cursos cancelados (caso passem objetos de períodos com cancelado: true)
  let listaCursos = [];
  if (Array.isArray(cursos)) {
    listaCursos = cursos
      .map((c) => {
        if (!c) return null;
        if (typeof c === 'string') return c.trim();
        // Não inclui cursos cancelados por data futura
        if (c.cancelado || c.ultrapassaHoje) return null;
        return (c.curso || '').trim();
      })
      .filter(Boolean);
  }

  const textoCursos = listaCursos.join('\n');

  const fields = {
    title: (nome || 'Aluno Sem Nome').trim(),
    categoryId,
    stageId
  };

  const campoObs = process.env.BITRIX24_SPA_FIELD_OBS || 'UF_CRM_14_1748872142';
  const campoCursos = process.env.BITRIX24_SPA_FIELD_CURSOS || 'UF_CRM_14_1791995335';

  // Preenche campo de observação/customização se houver revisão
  if (textoRevisao) {
    fields[campoObs] = textoRevisao;
    fields.ufCrm14_1748872142 = textoRevisao;
    fields.UF_CRM_14_1748872142 = textoRevisao;
  }

  // Preenche campo de cursos empilhados
  if (textoCursos) {
    fields[campoCursos] = textoCursos;
    fields.ufCrm14_1791995335 = textoCursos;
    fields.UF_CRM_14_1791995335 = textoCursos;
  }

  const payload = {
    entityTypeId,
    fields
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      const msgErro = data.error_description || data.error || `HTTP ${response.status}`;
      console.error(`❌ [BITRIX24 SPA] Falha ao criar card para "${nome}": ${msgErro}`);
      return { sucesso: false, erro: msgErro, stageId };
    }

    const itemCriado = data?.result?.item;
    console.log(`✅ [BITRIX24 SPA] Card criado com sucesso! ID: ${itemCriado?.id} | Aluno: "${nome}" | Etapa: ${stageId}${textoRevisao ? ` | Revisão/Obs enviada` : ''}${textoCursos ? ` | ${listaCursos.length} curso(s) empilhado(s)` : ''}`);

    return {
      sucesso: true,
      id: itemCriado?.id,
      stageId,
      cursosEmpilhados: textoCursos,
      item: itemCriado
    };
  } catch (err) {
    console.error(`❌ [BITRIX24 SPA] Erro de rede/requisição: ${err.message}`);
    return { sucesso: false, erro: err.message, stageId };
  }
}
