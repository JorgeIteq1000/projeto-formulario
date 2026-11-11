import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega .env da raiz do projeto
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const AUTH_CACHE_FILE = path.resolve(__dirname, '../data/zionic_auth.json');

/**
 * Lê o cache de autenticação em disco (data/zionic_auth.json)
 */
function carregarAuthCache() {
  try {
    if (fs.existsSync(AUTH_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(AUTH_CACHE_FILE, 'utf8'));
    }
  } catch {
    // ignora erro de leitura
  }
  return null;
}

/**
 * Salva o cache de autenticação em disco
 */
function salvarAuthCache(dados) {
  try {
    const dir = path.dirname(AUTH_CACHE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(AUTH_CACHE_FILE, JSON.stringify(dados, null, 2), 'utf8');
  } catch (err) {
    console.warn('⚠️  Não foi possível salvar cache de autenticação da Zionic:', err.message);
  }
}

/**
 * Decodifica o payload do JWT para extrair metadados como sub (user_id), exp e company_id
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
 * Realiza login automático na API da Zionic via e-mail e senha
 */
export async function realizarLoginZionic({ email = null, password = null, apiUrl = null } = {}) {
  const em = email || process.env.ZIONIC_EMAIL;
  const pw = password || process.env.ZIONIC_PASSWORD;
  const urlBase = (apiUrl || process.env.ZIONIC_API_URL || 'https://api.zionic.app').trim().replace(/\/+$/, '');

  if (!em || !pw) {
    throw new Error('ZIONIC_EMAIL e ZIONIC_PASSWORD não configurados para login automático.');
  }

  console.log(`🔐 [ZIONIC AUTH] Realizando login automático para ${em}...`);
  const res = await fetch(`${urlBase}/api/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: em, password: pw })
  });

  const json = await res.json();
  if (!res.ok || !json.success || !json.data?.session?.access_token) {
    throw new Error(json?.error || json?.message || `Falha no login Zionic (Status ${res.status})`);
  }

  const session = json.data.session;
  const accessToken = session.access_token;
  const refreshToken = session.refresh_token;
  const expiresAt = session.expires_at || (Math.floor(Date.now() / 1000) + (session.expires_in || 3600));

  process.env.ZIONIC_BEARER_TOKEN = accessToken;
  if (refreshToken) process.env.ZIONIC_REFRESH_TOKEN = refreshToken;

  salvarAuthCache({
    accessToken,
    refreshToken,
    expiresAt,
    email: em,
    atualizadoEm: new Date().toISOString()
  });

  console.log(`✅ [ZIONIC AUTH] Login automático bem-sucedido! Token ativo até ${new Date(expiresAt * 1000).toLocaleString('pt-BR')}`);
  return { accessToken, refreshToken, expiresAt, session };
}

/**
 * Renova o token de acesso da Zionic usando o refresh_token
 */
export async function renovarTokenZionic({ refreshToken = null, apiUrl = null } = {}) {
  const rf = refreshToken || process.env.ZIONIC_REFRESH_TOKEN || carregarAuthCache()?.refreshToken;
  const urlBase = (apiUrl || process.env.ZIONIC_API_URL || 'https://api.zionic.app').trim().replace(/\/+$/, '');

  if (!rf) return null;

  console.log(`🔄 [ZIONIC AUTH] Renovando token via refresh_token...`);
  const res = await fetch(`${urlBase}/api/auth/refresh-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: rf })
  });

  const json = await res.json();
  if (!res.ok || !json.success || !json.data?.access_token) {
    console.warn(`⚠️ [ZIONIC AUTH] Falha na renovação via refresh_token: ${json?.error || res.statusText}`);
    return null;
  }

  const accessToken = json.data.access_token;
  const newRefreshToken = json.data.refresh_token || rf;
  const payload = decodificarJwtPayload(accessToken);
  const expiresAt = payload?.exp || (Math.floor(Date.now() / 1000) + 3600);

  process.env.ZIONIC_BEARER_TOKEN = accessToken;
  process.env.ZIONIC_REFRESH_TOKEN = newRefreshToken;

  salvarAuthCache({
    accessToken,
    refreshToken: newRefreshToken,
    expiresAt,
    atualizadoEm: new Date().toISOString()
  });

  console.log(`✅ [ZIONIC AUTH] Token renovado com sucesso! Válido até ${new Date(expiresAt * 1000).toLocaleString('pt-BR')}`);
  return { accessToken, refreshToken: newRefreshToken, expiresAt };
}

/**
 * Garante que existe um token de acesso válido (renova ou faz login transparente se expirado)
 */
export async function garantirTokenValido() {
  let token = (process.env.ZIONIC_BEARER_TOKEN || '').trim();
  if (!token) {
    const cache = carregarAuthCache();
    if (cache?.accessToken) token = cache.accessToken;
  }

  const MARGEM_SEGURANCA_SEGUNDOS = 300; // 5 minutos antes de expirar
  if (token) {
    const payload = decodificarJwtPayload(token);
    if (payload?.exp && (payload.exp - MARGEM_SEGURANCA_SEGUNDOS > Math.floor(Date.now() / 1000))) {
      return token; // Token ainda válido com folga
    }
  }

  // Token expirado ou inexistente: tenta refresh primeiro se houver refreshToken
  try {
    const refreshRes = await renovarTokenZionic();
    if (refreshRes?.accessToken) return refreshRes.accessToken;
  } catch (err) {
    console.warn(`⚠️ [ZIONIC AUTH] Erro no refresh: ${err.message}`);
  }

  // Se o refresh falhou ou não existe, realiza login automático transparente via e-mail e senha
  if (process.env.ZIONIC_EMAIL && process.env.ZIONIC_PASSWORD) {
    const loginRes = await realizarLoginZionic();
    return loginRes.accessToken;
  }

  return token;
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

  const integrationId = (
    process.env.ZIONIC_INTEGRATION_ID ||
    'd74a60b0-8c34-421a-b18b-b8ca2c7e8042'
  ).trim();

  return {
    apiUrl,
    token,
    companyId,
    userId,
    whatsappInstanceId,
    integrationId,
    jwtPayload
  };
}

/**
 * Monta os headers padrão para chamadas na API Zionic (garantindo token válido)
 */
export async function obterHeadersZionic(headersExtras = {}) {
  const tokenValido = await garantirTokenValido();
  const { companyId } = obterConfigZionic();
  return {
    'accept': '*/*',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'authorization': `Bearer ${tokenValido}`,
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
  const headers = await obterHeadersZionic();

  const res = await fetch(url, {
    method: 'GET',
    headers
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
  const headers = await obterHeadersZionic();

  const res = await fetch(url, {
    method: 'GET',
    headers
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || json?.error || 'Erro ao buscar contatos');
  }

  const contatos = json.data || [];
  return contatos.find(c => normalizarTelefoneZionic(c.phone) === telFormatado || normalizarTelefoneZionic(c.mobile_phone) === telFormatado) || contatos[0] || null;
}

/**
 * Cria um novo contato no Zionic
 */
export async function criarContatoZionic({
  nome,
  telefone,
  email = null,
  notas = null
}) {
  const { apiUrl, companyId, userId } = obterConfigZionic();
  const telFormatado = normalizarTelefoneZionic(telefone);

  const partesNome = (nome || 'Contato').trim().split(/\s+/);
  const firstName = partesNome[0] || 'Contato';
  const lastName = partesNome.slice(1).join(' ') || '';

  const payload = {
    first_name: firstName,
    last_name: lastName,
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
    status: 'active',
    source: null,
    notes: notas || null,
    company_id: companyId,
    created_by: userId || null
  };

  const url = `${apiUrl}/api/contacts`;
  console.log(`🌐 [ZIONIC] Tentando criar contato: ${firstName} ${lastName} (${telFormatado})...`);
  const headers = await obterHeadersZionic();

  const response = await fetch(url, {
    method: 'POST',
    headers,
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
      erro: respostaJson?.message || respostaJson?.error || 'Falha ao criar contato',
      detalhes: respostaJson
    };
  }

  return {
    sucesso: true,
    statusHttp,
    data: respostaJson.data,
    detalhes: respostaJson
  };
}

/**
 * Garante a existência do contato no Zionic:
 * 1. Tenta criar diretamente
 * 2. Se retornar conflito/duplicado (HTTP 409), reaproveita o existente
 * 3. Faz busca por telefone se necessário
 */
export async function garantirContatoZionic({ nome, telefone, email = null, notas = null }) {
  const telFormatado = normalizarTelefoneZionic(telefone);

  // 1. Tenta criar o contato
  const resCriacao = await criarContatoZionic({ nome, telefone: telFormatado, email, notas });

  if (resCriacao.sucesso && resCriacao.data?.id) {
    console.log(`✅ [ZIONIC] Contato criado com sucesso! ID: ${resCriacao.data.id}`);
    return {
      sucesso: true,
      contactId: resCriacao.data.id,
      origem: 'criado',
      dados: resCriacao.data
    };
  }

  // 2. Trata retorno de duplicidade (HTTP 409)
  const detalhes = resCriacao.detalhes;
  const isDuplicado = resCriacao.statusHttp === 409 ||
    detalhes?.isDuplicate ||
    (typeof detalhes?.message === 'string' && detalhes.message.toLowerCase().includes('já existe')) ||
    (typeof detalhes?.error === 'string' && detalhes.error.toLowerCase().includes('already exists'));

  if (isDuplicado) {
    const existingContact = detalhes?.existingContact || detalhes?.data;
    if (existingContact?.id) {
      console.log(`ℹ️ [ZIONIC] Contato já existente identificado (ID: ${existingContact.id}). Dados reaproveitados.`);
      return {
        sucesso: true,
        contactId: existingContact.id,
        origem: 'existente_payload',
        dados: existingContact
      };
    }

    // Busca o contato pelo telefone
    console.log(`🔍 [ZIONIC] Buscando contato existente pelo telefone ${telFormatado}...`);
    try {
      const contatoBuscado = await buscarContatoPorTelefone(telFormatado);
      if (contatoBuscado && contatoBuscado.id) {
        console.log(`✅ [ZIONIC] Contato localizado na busca! ID: ${contatoBuscado.id}`);
        return {
          sucesso: true,
          contactId: contatoBuscado.id,
          origem: 'existente_busca',
          dados: contatoBuscado
        };
      }
    } catch (errBusca) {
      console.warn(`⚠️ Falha ao buscar contato por telefone: ${errBusca.message}`);
    }
  }

  return {
    sucesso: false,
    erro: resCriacao.erro || 'Não foi possível criar ou localizar o contato.',
    detalhes: resCriacao.detalhes
  };
}

/**
 * Busca conversas existentes pelo número de telefone do contato
 */
export async function buscarConversaPorTelefone(telefone) {
  const { apiUrl, companyId } = obterConfigZionic();
  const telFormatado = normalizarTelefoneZionic(telefone);
  const url = `${apiUrl}/api/chat/conversations?company_id=${encodeURIComponent(companyId)}&search=${encodeURIComponent(telFormatado)}`;
  const headers = await obterHeadersZionic();

  const res = await fetch(url, {
    method: 'GET',
    headers
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.message || json?.error || 'Erro ao buscar conversas');
  }

  const conversas = json.data || [];
  return conversas.find(c => normalizarTelefoneZionic(c.contact_phone) === telFormatado) || conversas[0] || null;
}

/**
 * Inicia ou localiza uma conversa para um contato
 */
export async function obterOuCriarConversa({ contactId, telefone, instanceId = null }) {
  const { apiUrl, companyId, whatsappInstanceId, integrationId } = obterConfigZionic();
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

  // 2. Se não existir, cria nova conversa (Zionic espera integration_id no campo instance_id)
  const instId = instanceId || integrationId || whatsappInstanceId;
  const url = `${apiUrl}/api/chat/conversations`;
  console.log(`🌐 [ZIONIC] Abrindo nova conversa para contact_id ${contactId} na instância ${instId}...`);
  const headers = await obterHeadersZionic();

  const res = await fetch(url, {
    method: 'POST',
    headers,
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
  const { apiUrl } = obterConfigZionic();
  const customMessageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  const url = `${apiUrl}/api/chat/conversations/${encodeURIComponent(conversationId)}/send`;
  console.log(`🌐 [ZIONIC] Enviando mensagem na conversa ${conversationId}...`);

  const payload = {
    content: mensagem,
    message_type: 'text',
    metadata: {
      message_source: 'api',
      sent_via_agent: false,
      is_follow_up: false,
      saved_by_api: true,
      quoted_message_id: null,
      quoted_content: null,
      is_quoted: false
    },
    customMessageId: customMessageId
  };

  const headers = await obterHeadersZionic();
  const res = await fetch(url, {
    method: 'POST',
    headers,
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
  const headers = await obterHeadersZionic();

  const res = await fetch(url, {
    method: 'GET',
    headers
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
 * Fluxo completo de disparo de notificação para um aluno:
 * 1. Garante existência do contato (cria ou reaproveita).
 * 2. Localiza ou abre a conversa.
 * 3. Envia a mensagem formatada.
 */
export async function dispararMensagemAlunoZionic({ nome, telefone, mensagem }) {
  // 1. Garante contato
  const resContato = await garantirContatoZionic({ nome, telefone });
  if (!resContato.sucesso || !resContato.contactId) {
    return {
      sucesso: false,
      etapa: 'contato',
      erro: resContato.erro || 'Não foi possível obter ou criar o contato.',
      detalhes: resContato
    };
  }

  // 2. Busca ou cria conversa
  const resConversa = await obterOuCriarConversa({
    contactId: resContato.contactId,
    telefone
  });

  if (!resConversa.sucesso || !resConversa.conversationId) {
    return {
      sucesso: false,
      etapa: 'conversa',
      erro: resConversa.erro || 'Não foi possível obter ou criar a conversa.',
      detalhes: resConversa
    };
  }

  // 3. Envia mensagem
  const resEnvio = await enviarMensagemConversa({
    conversationId: resConversa.conversationId,
    mensagem
  });

  return {
    ...resEnvio,
    contactId: resContato.contactId,
    conversationId: resConversa.conversationId
  };
}
