import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env da raiz do projeto
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Decodifica o payload do JWT para extrair metadados como sub (user_id) e company_id
 */
export function decodificarJwtPayload(token) {
  if (!token || typeof token !== 'string') return {};
  try {
    const partes = token.split('.');
    if (partes.length < 2) return {};
    const base64 = partes[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = Buffer.from(base64, 'base64').toString('utf-8');
    return JSON.parse(jsonStr);
  } catch {
    return {};
  }
}

/**
 * Obtém as credenciais e configurações ativas do Zionic
 */
export function obterConfigZionic() {
  const token = (process.env.ZIONIC_BEARER_TOKEN || '').trim();
  const apiUrl = (process.env.ZIONIC_API_URL || 'https://api.zionic.app').trim().replace(/\/+$/, '');
  const jwtPayload = decodificarJwtPayload(token);

  const companyId = (
    process.env.ZIONIC_COMPANY_ID ||
    jwtPayload?.user_metadata?.company_id ||
    ''
  ).trim();

  const userId = (
    process.env.ZIONIC_USER_ID ||
    jwtPayload?.sub ||
    ''
  ).trim();

  const whatsappInstanceId = (
    process.env.ZIONIC_WHATSAPP_INSTANCE_ID ||
    '18aa332a-d0cd-4977-a51d-748418eb80cd'
  ).trim();

  return {
    apiUrl,
    token,
    companyId,
    userId,
    whatsappInstanceId,
    jwtPayload
  };
}

/**
 * Monta os headers padrão para chamadas na API Zionic
 */
function obterHeadersZionic(headersExtras = {}) {
  const { token, companyId } = obterConfigZionic();
  return {
    'accept': '*/*',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'authorization': `Bearer ${token}`,
    'content-type': 'application/json',
    'origin': 'https://zionic.app',
    'referer': 'https://zionic.app/',
    'x-acting-company-id': companyId,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36',
    ...headersExtras
  };
}

/**
 * Normaliza o telefone para o formato padrão aceito pelo Zionic (com DDI 55)
 * Ex: (11) 98073-2523 -> 5511980732523
 */
export function normalizarTelefoneZionic(telefone) {
  if (!telefone) return '';
  const digitos = String(telefone).replace(/\D/g, '');
  if (!digitos) return '';
  // Se já começar com 55 e tiver 12 ou 13 dígitos, mantém
  if (digitos.startsWith('55') && (digitos.length === 12 || digitos.length === 13)) {
    return digitos;
  }
  // Se for 10 ou 11 dígitos (DDD + número), prefixa com 55
  if (digitos.length === 10 || digitos.length === 11) {
    return `55${digitos}`;
  }
  return digitos;
}

/**
 * Lista as instâncias de WhatsApp disponíveis na empresa
 */
export async function obterInstanciasWhatsapp() {
  const { apiUrl, companyId } = obterConfigZionic();
  const url = `${apiUrl}/api/whatsapp-instances?company_id=${encodeURIComponent(companyId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: obterHeadersZionic()
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || json?.error || 'Erro ao listar instâncias do WhatsApp');
  }

  return json.data || [];
}

/**
 * Busca contatos existentes pelo número de telefone
 */
export async function buscarContatoPorTelefone(telefone) {
  const { apiUrl, companyId } = obterConfigZionic();
  const telFormatado = normalizarTelefoneZionic(telefone);
  const url = `${apiUrl}/api/contacts?company_id=${encodeURIComponent(companyId)}&search=${encodeURIComponent(telFormatado)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: obterHeadersZionic()
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || json?.error || 'Erro ao buscar contatos');
  }

  const contatos = json.data || [];
  return contatos.find(c => normalizarTelefoneZionic(c.phone) === telFormatado || normalizarTelefoneZionic(c.mobile_phone) === telFormatado) || contatos[0] || null;
}

/**
 * Cria ou registra um novo contato na API do Zionic
 */
export async function criarContatoZionic({
  nome,
  sobrenome = '',
  telefone,
  email = null,
  notas = null,
  status = 'active'
}) {
  const { apiUrl, token, companyId, userId } = obterConfigZionic();

  if (!token) throw new Error('ZIONIC_BEARER_TOKEN não configurado.');
  if (!companyId) throw new Error('ZIONIC_COMPANY_ID não identificado.');

  const telFormatado = normalizarTelefoneZionic(telefone);
  if (!telFormatado) throw new Error('Telefone inválido ou não informado.');

  let firstName = (nome || '').trim();
  let lastName = (sobrenome || '').trim();
  if (!lastName && firstName.includes(' ')) {
    const partes = firstName.split(/\s+/);
    firstName = partes[0];
    lastName = partes.slice(1).join(' ');
  }

  const payload = {
    first_name: firstName || 'Aluno',
    last_name: lastName || '',
    email: email || null,
    phone: telFormatado,
    mobile_phone: telFormatado,
    company_name: null,
    company_website: null,
    job_title: null,
    address_street: null,
    address_city: null,
    address_state: null,
    address_zip_code: null,
    address_country: 'Brasil',
    linkedin_url: null,
    status: status,
    source: null,
    notes: notas || null,
    company_id: companyId,
    created_by: userId || null
  };

  const url = `${apiUrl}/api/contacts`;
  console.log(`🌐 [ZIONIC] Tentando criar contato: ${firstName} ${lastName} (${telFormatado})...`);

  const response = await fetch(url, {
    method: 'POST',
    headers: obterHeadersZionic(),
    body: JSON.stringify(payload)
  });

  const statusHttp = response.status;
  const textoResposta = await response.text();
  let respostaJson = null;
  try {
    respostaJson = JSON.parse(textoResposta);
  } catch {
    respostaJson = { raw: textoResposta };
  }

  if (!response.ok) {
    return {
      sucesso: false,
      statusHttp,
      erro: respostaJson?.message || respostaJson?.error || 'Erro na requisição para Zionic',
      detalhes: respostaJson
    };
  }

  console.log(`✅ [ZIONIC] Contato criado com sucesso! ID:`, respostaJson?.data?.id);
  return {
    sucesso: true,
    statusHttp,
    data: respostaJson?.data,
    mensagem: respostaJson?.message
  };
}

/**
 * Garante que o contato existe no Zionic:
 * - Se for novo, cria.
 * - Se já existir (HTTP 409 isDuplicate), reaproveita os dados do contato existente de forma transparente.
 */
export async function garantirContatoZionic({
  nome,
  sobrenome = '',
  telefone,
  email = null,
  notas = null
}) {
  const telFormatado = normalizarTelefoneZionic(telefone);

  const resCriacao = await criarContatoZionic({
    nome,
    sobrenome,
    telefone: telFormatado,
    email,
    notas
  });

  // Caso 1: Contato criado agora
  if (resCriacao.sucesso) {
    return {
      sucesso: true,
      jaExistia: false,
      statusHttp: resCriacao.statusHttp,
      data: resCriacao.data,
      id: resCriacao.data?.id,
      mensagem: 'Contato criado com sucesso.'
    };
  }

  // Caso 2: Contato já existia (retorno 409 da API Zionic com isDuplicate: true)
  if (resCriacao.statusHttp === 409 && resCriacao.detalhes?.isDuplicate && resCriacao.detalhes?.existingContact) {
    const existing = resCriacao.detalhes.existingContact;
    console.log(`ℹ️ [ZIONIC] Contato já existente identificado (ID: ${existing.id}). Dados reaproveitados.`);
    return {
      sucesso: true,
      jaExistia: true,
      statusHttp: 200,
      data: existing,
      id: existing.id,
      mensagem: 'Contato já existia no Zionic (reaproveitado com sucesso).'
    };
  }

  // Caso 3: Fallback - busca direta pelo endpoint de contatos
  try {
    const existente = await buscarContatoPorTelefone(telFormatado);
    if (existente && existente.id) {
      console.log(`ℹ️ [ZIONIC] Contato localizado via busca por telefone (ID: ${existente.id}).`);
      return {
        sucesso: true,
        jaExistia: true,
        statusHttp: 200,
        data: existente,
        id: existente.id,
        mensagem: 'Contato localizado na base do Zionic.'
      };
    }
  } catch (errBusca) {
    console.warn('⚠️ Falha ao buscar contato por telefone:', errBusca.message);
  }

  // Erro real
  return resCriacao;
}

/**
 * Busca conversas existentes pelo número de telefone do contato
 */
export async function buscarConversaPorTelefone(telefone) {
  const { apiUrl, companyId } = obterConfigZionic();
  const telFormatado = normalizarTelefoneZionic(telefone);
  const url = `${apiUrl}/api/chat/conversations?company_id=${encodeURIComponent(companyId)}&search=${encodeURIComponent(telFormatado)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: obterHeadersZionic()
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || json?.error || 'Erro ao buscar conversas');
  }

  const conversas = json.data || [];
  // Procura correspondência exata de telefone se houver múltiplos
  return conversas.find(c => normalizarTelefoneZionic(c.contact_phone) === telFormatado) || conversas[0] || null;
}

/**
 * Inicia ou localiza uma conversa para um contato
 */
export async function obterOuCriarConversa({ contactId, telefone, instanceId = null }) {
  const { apiUrl, companyId, whatsappInstanceId } = obterConfigZionic();
  const telFormatado = normalizarTelefoneZionic(telefone);

  // 1. Tenta buscar conversa existente
  if (telFormatado) {
    const existente = await buscarConversaPorTelefone(telFormatado);
    if (existente && existente.conversation_id) {
      return {
        sucesso: true,
        conversationId: existente.conversation_id,
        origem: 'existente',
        dados: existente
      };
    }
  }

  // 2. Se não existir, cria nova conversa
  const instId = instanceId || whatsappInstanceId;
  const url = `${apiUrl}/api/chat/conversations`;
  console.log(`🌐 [ZIONIC] Abrindo nova conversa para contact_id ${contactId} na instância ${instId}...`);

  const res = await fetch(url, {
    method: 'POST',
    headers: obterHeadersZionic(),
    body: JSON.stringify({
      contact_id: contactId,
      instance_id: instId,
      company_id: companyId
    })
  });

  const json = await res.json();
  if (!res.ok) {
    return {
      sucesso: false,
      erro: json?.message || json?.error || 'Erro ao criar conversa no Zionic',
      detalhes: json
    };
  }

  const conversationId = json?.data?.id || json?.data?.conversation_id;
  return {
    sucesso: true,
    conversationId,
    origem: 'criada',
    dados: json.data
  };
}

/**
 * Envia uma mensagem em uma conversa aberta no Zionic
 */
export async function enviarMensagemConversa({ conversationId, mensagem }) {
  const { apiUrl, userId } = obterConfigZionic();
  const timestamp = new Date().toISOString();
  const customMessageId = `sending_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;

  const url = `${apiUrl}/api/chat/conversations/${encodeURIComponent(conversationId)}/send`;
  console.log(`🌐 [ZIONIC] Enviando mensagem na conversa ${conversationId}...`);

  const payload = {
    message: mensagem,
    userId: userId || null,
    timestamp: timestamp,
    agentMetadata: {
      sent_by_ai: false,
      sent_via_agent: false,
      message_source: 'api',
      is_follow_up: false,
      replyid: null,
      quoted_message_id: null,
      quoted_content: null,
      is_quoted: false
    },
    customMessageId: customMessageId
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: obterHeadersZionic(),
    body: JSON.stringify(payload)
  });

  const texto = await res.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = { raw: texto };
  }

  if (!res.ok) {
    console.error(`❌ [ZIONIC] Erro ao enviar mensagem (${res.status}):`, json);
    return {
      sucesso: false,
      statusHttp: res.status,
      erro: json?.message || json?.error || 'Falha no envio da mensagem',
      detalhes: json
    };
  }

  console.log(`✅ [ZIONIC] Mensagem enviada com sucesso! ID:`, json?.data?.id, '| Status:', json?.data?.status);
  return {
    sucesso: true,
    statusHttp: res.status,
    data: json?.data
  };
}

/**
 * Consulta os detalhes/status de uma mensagem específica
 */
export async function consultarMensagemZionic(messageId) {
  const { apiUrl } = obterConfigZionic();
  const url = `${apiUrl}/api/chat/messages/${encodeURIComponent(messageId)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: obterHeadersZionic()
  });

  const json = await res.json();
  if (!res.ok) {
    return {
      sucesso: false,
      erro: json?.message || json?.error || 'Erro ao consultar mensagem'
    };
  }

  return {
    sucesso: true,
    data: json?.data
  };
}

/**
 * Fluxo completo resiliente:
 * 1. Garante o contato (cria ou reaproveita o existente caso já cadastrado).
 * 2. Localiza ou abre a conversa.
 * 3. Envia a mensagem.
 */
export async function dispararMensagemAlunoZionic({ nome, telefone, mensagem }) {
  const telFormatado = normalizarTelefoneZionic(telefone);

  // 1. Garante o contato
  const resContato = await garantirContatoZionic({ nome, telefone: telFormatado });
  if (!resContato.sucesso || !resContato.id) {
    return {
      sucesso: false,
      etapa: 'contato',
      erro: resContato.erro || 'Não foi possível garantir o contato no Zionic.',
      detalhes: resContato
    };
  }

  const contactId = resContato.id;

  // 2. Busca ou cria conversa
  const resConversa = await obterOuCriarConversa({
    contactId,
    telefone: telFormatado
  });

  if (!resConversa.sucesso || !resConversa.conversationId) {
    return {
      sucesso: false,
      etapa: 'conversa',
      erro: resConversa.erro || 'Não foi possível obter ou criar a conversa.'
    };
  }

  // 3. Envia a mensagem
  const resEnvio = await enviarMensagemConversa({
    conversationId: resConversa.conversationId,
    mensagem
  });

  return {
    ...resEnvio,
    contactId,
    jaExistia: resContato.jaExistia,
    conversationId: resConversa.conversationId
  };
}
