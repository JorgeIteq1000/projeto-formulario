import crypto from 'crypto';
import { inicializarGoogleAuth, TARGET_GID_USUARIOS } from './googleSheets.js';

const GID_USUARIOS = TARGET_GID_USUARIOS || 1338320797;
const CACHE_TTL_MS = 60 * 1000; // 1 minuto de cache em memória

let cacheUsuarios = null;
let cacheTimestamp = 0;

function normalizarLogin(login) {
  return String(login || '').trim().toLowerCase();
}

/**
 * Carrega a lista de usuários e senhas da aba USUARIOS da planilha Google Sheets.
 * Esta função roda EXCLUSIVAMENTE no servidor e NUNCA envia senhas para o cliente.
 */
export async function carregarUsuariosGoogleSheets({ spreadsheetId, forceRefresh = false } = {}) {
  const agora = Date.now();
  if (!forceRefresh && cacheUsuarios && agora - cacheTimestamp < CACHE_TTL_MS) {
    return cacheUsuarios;
  }

  const { sheets, credenciaisValidas } = inicializarGoogleAuth();
  const idPlanilha = spreadsheetId || process.env.GOOGLE_SHEET_ID;

  if (!sheets || !credenciaisValidas || !idPlanilha) {
    console.warn('⚠️  [AUTH] Google Sheets não configurado para leitura de usuários.');
    return cacheUsuarios || [];
  }

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: idPlanilha });
    const abas = meta.data.sheets || [];
    const abaUsuarios = abas.find(
      (s) => s.properties.sheetId === GID_USUARIOS || s.properties.title.toUpperCase() === 'USUARIOS'
    );

    if (!abaUsuarios) {
      console.warn(`⚠️  [AUTH] Aba USUARIOS (GID ${GID_USUARIOS}) não encontrada na planilha.`);
      return cacheUsuarios || [];
    }

    const nomeAba = abaUsuarios.properties.title;
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: idPlanilha,
      range: `'${nomeAba}'!A1:C100`
    });

    const linhas = res.data.values || [];
    if (linhas.length <= 1) {
      cacheUsuarios = [];
      cacheTimestamp = agora;
      return [];
    }

    const cabecalhos = (linhas[0] || []).map((c) => String(c || '').trim().toUpperCase());
    const idxLogin = cabecalhos.indexOf('LOGIN');
    const idxSenha = cabecalhos.indexOf('SENHA');
    const idxNome = cabecalhos.indexOf('NOME');

    const colLogin = idxLogin !== -1 ? idxLogin : 0;
    const colSenha = idxSenha !== -1 ? idxSenha : 1;
    const colNome = idxNome !== -1 ? idxNome : 2;

    const lista = [];
    for (let i = 1; i < linhas.length; i += 1) {
      const row = linhas[i] || [];
      const login = String(row[colLogin] || '').trim();
      const senha = String(row[colSenha] || '').trim();
      const nome = String(row[colNome] || login).trim();

      if (login && senha) {
        lista.push({
          login,
          loginNorm: normalizarLogin(login),
          senha,
          nome: nome || login
        });
      }
    }

    cacheUsuarios = lista;
    cacheTimestamp = agora;
    return lista;
  } catch (err) {
    console.error('❌ [AUTH] Erro ao carregar usuários da planilha:', err.message);
    return cacheUsuarios || [];
  }
}

/**
 * Valida se login e senha coincidem com algum registro da planilha.
 */
export async function autenticarUsuario(login, senha, { spreadsheetId } = {}) {
  const loginLimpo = normalizarLogin(login);
  const senhaLimpa = String(senha || '').trim();

  if (!loginLimpo || !senhaLimpa) {
    return { sucesso: false, motivo: 'Login e senha são obrigatórios.' };
  }

  // Tenta com cache ou recarrega se não encontrar
  let usuarios = await carregarUsuariosGoogleSheets({ spreadsheetId });
  let usuario = usuarios.find((u) => u.loginNorm === loginLimpo);

  if (!usuario) {
    // Força recarga para caso o usuário tenha acabado de ser adicionado na planilha
    usuarios = await carregarUsuariosGoogleSheets({ spreadsheetId, forceRefresh: true });
    usuario = usuarios.find((u) => u.loginNorm === loginLimpo);
  }

  if (!usuario) {
    return { sucesso: false, motivo: 'Usuário ou senha incorretos.' };
  }

  if (usuario.senha !== senhaLimpa) {
    return { sucesso: false, motivo: 'Usuário ou senha incorretos.' };
  }

  return {
    sucesso: true,
    usuario: {
      login: usuario.login,
      nome: usuario.nome
    }
  };
}

/**
 * Cria token de sessão assinado com HMAC-SHA256 usando o LINK_SECRET.
 * O token expira em 12 horas.
 */
export function criarTokenSessao(usuario, secret) {
  const agora = Math.floor(Date.now() / 1000);
  const expira = agora + 12 * 3600; // 12 horas

  const payload = {
    login: usuario.login,
    nome: usuario.nome,
    iat: agora,
    exp: expira
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const hmac = crypto.createHmac('sha256', String(secret || 'default-secret-auth'));
  hmac.update(payloadB64);
  const assinatura = hmac.digest('base64url');

  return `${payloadB64}.${assinatura}`;
}

/**
 * Valida o token de sessão assinado.
 */
export function validarTokenSessao(token, secret) {
  if (!token || typeof token !== 'string') return null;

  const partes = token.trim().split('.');
  if (partes.length !== 2) return null;

  const [payloadB64, assinatura] = partes;
  const hmac = crypto.createHmac('sha256', String(secret || 'default-secret-auth'));
  hmac.update(payloadB64);
  const assinaturaEsperada = hmac.digest('base64url');

  // Comparação em tempo constante para evitar timing attacks
  const bufA = Buffer.from(assinatura);
  const bufB = Buffer.from(assinaturaEsperada);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const agora = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < agora) {
      return null; // Expirado
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Extrai o token de autenticação dos headers ou cookie da requisição.
 */
export function extrairTokenReq(req) {
  if (!req || !req.headers) return null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  if (req.headers['x-auth-token']) {
    return String(req.headers['x-auth-token']).trim();
  }
  if (req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

/**
 * Middleware Express para proteger rotas administrativas da equipe.
 */
export function criarMiddlewareAutenticacaoAdmin({ linkSecret } = {}) {
  return function middlewareAutenticacaoAdmin(req, res, next) {
    const secret = linkSecret || process.env.LINK_SECRET || 'dev-secret-certificados-ies-2026';
    const cronSecret = String(req.headers['x-cron-secret'] || '').trim();
    if (cronSecret && cronSecret === secret) {
      return next();
    }

    const token = extrairTokenReq(req);
    if (token) {
      const usuario = validarTokenSessao(token, secret);
      if (usuario) {
        req.usuario = usuario;
        return next();
      }
    }

    // Compatibilidade com ambiente de teste legado onde não há AUTH_STRICT
    if (process.env.NODE_ENV === 'test' && !process.env.AUTH_STRICT) {
      return next();
    }

    return res.status(401).json({
      sucesso: false,
      mensagem: 'Acesso restrito. Faça login para continuar.'
    });
  };
}
