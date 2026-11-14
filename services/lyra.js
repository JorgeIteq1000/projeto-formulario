import crypto from 'crypto';

export const LYRA_BASE_URL = (process.env.LYRA_API_URL || 'https://api-gateway.faculdadeesp.com.br/').replace(/\/?$/, '/');
export const LYRA_LOGIN_URL =
  process.env.LYRA_LOGIN_URL ||
  'https://api-gateway.faculdadeesp.com.br/U2FsdGVkX18tJxVXlIIZptWAhw0ik7pOGx/b1OQG8SGT8oun6VP/MYl5CMxQjrGK';
export const LYRA_CRYPTO_SECRET = process.env.LYRA_CRYPTO_SECRET || '9pYz4paxNPln9nuMC2tEG596';
export const LYRA_COMPANY = process.env.LYRA_COMPANY || 'iteq';
export const LYRA_DEFAULT_CANCEL_REASON =
  'Aluno não preencheu o formulário dentro das 96hr, será necessário abrir outra solicitação para seguir com o processo.';

const LYRA_ORIGIN = 'https://modulos.faculdadeesp.com.br';

let cachedAuth = {
  token: null,
  expiresAt: 0,
};
let loginInFlightPromise = null;
const filasPorChave = new Map();

const LYRA_TIMEOUT_MS = Number(process.env.LYRA_TIMEOUT_MS || 20000);

function executarNaFilaPorChave(chave, tarefa) {
  const anterior = filasPorChave.get(chave) || Promise.resolve();
  const proxima = anterior.catch(() => {}).then(tarefa);
  const sentinela = proxima.finally(() => {
    if (filasPorChave.get(chave) === sentinela) {
      filasPorChave.delete(chave);
    }
  });
  filasPorChave.set(chave, sentinela);
  return proxima;
}

function ehErroConflitoRegistro(err) {
  const msg = String(err?.message || '').toLowerCase();
  return (
    err?.status === 409 ||
    msg.includes('(409)') ||
    /livro|folha|registro|book|registry|duplicad|already exists/.test(msg)
  );
}

function derivarChaveIvOpenSSL(secret, salt) {
  const pass = Buffer.from(secret, 'utf8');
  let keyIv = Buffer.alloc(0);
  let prev = Buffer.alloc(0);
  while (keyIv.length < 48) {
    prev = crypto.createHash('md5').update(Buffer.concat([prev, pass, salt])).digest();
    keyIv = Buffer.concat([keyIv, prev]);
  }
  return {
    key: keyIv.subarray(0, 32),
    iv: keyIv.subarray(32, 48),
  };
}

export function criptografarRotaLyra(rotaLimpa, secret = LYRA_CRYPTO_SECRET) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = derivarChaveIvOpenSSL(secret, salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(rotaLimpa), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('Salted__', 'utf8'), salt, encrypted]).toString('base64');
}

export function descriptografarRotaLyra(tokenBase64, secret = LYRA_CRYPTO_SECRET) {
  const buf = Buffer.from(String(tokenBase64), 'base64');
  const salt = buf.subarray(8, 16);
  const ciphertext = buf.subarray(16);
  const { key, iv } = derivarChaveIvOpenSSL(secret, salt);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function montarUrlLyra(rotaLimpa, baseUrl = LYRA_BASE_URL, secret = LYRA_CRYPTO_SECRET) {
  const cleanBase = String(baseUrl || LYRA_BASE_URL).replace(/\/?$/, '/');
  return `${cleanBase}${criptografarRotaLyra(rotaLimpa, secret)}`;
}

function extrairExpiracaoJwtMs(authHeader) {
  try {
    const raw = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    const parts = raw.split('.');
    if (parts.length !== 3) return Date.now() + 50 * 60 * 1000;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (typeof payload.exp === 'number') {
      return payload.exp * 1000;
    }
  } catch {
    // Fallback para cache conservador de 50 minutos
  }
  return Date.now() + 50 * 60 * 1000;
}

function normalizarTexto(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function limparCpf(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function ehIdValido(valor) {
  const s = String(valor || '').trim();
  return Boolean(s && s.toUpperCase() !== 'N/A' && /^[a-f0-9]{24}$/i.test(s));
}

export function slugificarLyra(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function converterDataParaIsoLyra(dataStr) {
  if (!dataStr) return null;
  const s = String(dataStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s}T03:00:00.000Z`;
  }
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (br) {
    return `${br[3]}-${br[2]}-${br[1]}T03:00:00.000Z`;
  }
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function criarHeadersLyra(token = null) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Company: process.env.LYRA_COMPANY || LYRA_COMPANY,
    Origin: LYRA_ORIGIN,
    Referer: `${LYRA_ORIGIN}/`,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };
  if (token) {
    headers.Authorization = token;
  }
  return headers;
}

export function limparCacheTokenLyra() {
  cachedAuth = { token: null, expiresAt: 0 };
  loginInFlightPromise = null;
}

export async function obterTokenLyra({ fetchImpl = fetch, forceRefresh = false } = {}) {
  const agora = Date.now();
  if (!forceRefresh && cachedAuth.token && cachedAuth.expiresAt - agora > 5 * 60 * 1000) {
    return cachedAuth.token;
  }

  if (loginInFlightPromise && !forceRefresh) {
    return loginInFlightPromise;
  }

  const email = process.env.LYRA_EMAIL;
  const password = process.env.LYRA_PASSWORD;
  if (!email || !password) {
    throw new Error('Credenciais do Lyra não configuradas (LYRA_EMAIL / LYRA_PASSWORD).');
  }

  const tarefaLogin = (async () => {
    const loginUrl = process.env.LYRA_LOGIN_URL || LYRA_LOGIN_URL;
    const res = await fetchImpl(loginUrl, {
      method: 'POST',
      headers: criarHeadersLyra(),
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(LYRA_TIMEOUT_MS),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Falha ao autenticar no Lyra (${res.status}): ${txt.slice(0, 200)}`);
    }

    const json = await res.json();
    const token = json?.data?.user?.authorization;
    if (!token) {
      throw new Error('Resposta de login do Lyra não retornou data.user.authorization.');
    }

    cachedAuth = {
      token,
      expiresAt: extrairExpiracaoJwtMs(token),
    };
    return token;
  })();

  loginInFlightPromise = tarefaLogin;
  try {
    return await tarefaLogin;
  } finally {
    if (loginInFlightPromise === tarefaLogin) {
      loginInFlightPromise = null;
    }
  }
}

async function requisitarLyra({ method = 'GET', rotaLimpa, body, fetchImpl = fetch }) {
  let token = await obterTokenLyra({ fetchImpl });

  const executar = async (authToken) => {
    const url = montarUrlLyra(
      rotaLimpa,
      process.env.LYRA_API_URL || LYRA_BASE_URL,
      process.env.LYRA_CRYPTO_SECRET || LYRA_CRYPTO_SECRET,
    );
    return fetchImpl(url, {
      method,
      headers: criarHeadersLyra(authToken),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(LYRA_TIMEOUT_MS),
    });
  };

  const tentarComRetryGet = async () => {
    const maxTentativas = method === 'GET' ? 2 : 1;
    let ultimoErro = null;
    for (let t = 0; t < maxTentativas; t += 1) {
      try {
        let res = await executar(token);
        if (res.status === 401 || res.status === 403) {
          token = await obterTokenLyra({ fetchImpl, forceRefresh: true });
          res = await executar(token);
        }
        if (method === 'GET' && [502, 503, 504].includes(res.status) && t + 1 < maxTentativas) {
          continue;
        }
        return res;
      } catch (err) {
        ultimoErro = err;
        if (t + 1 >= maxTentativas) throw err;
      }
    }
    throw ultimoErro;
  };

  const res = await tentarComRetryGet();

  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(`Erro Lyra ${method} ${rotaLimpa} (${res.status}): ${text.slice(0, 250)}`);
    err.status = res.status;
    throw err;
  }

  return json;
}

export async function buscarSolicitacoesPendentesLyra({ searchTerm = '', limit = 25, fetchImpl = fetch } = {}) {
  const termo = encodeURIComponent(String(searchTerm || '').trim());
  const rota = `certificates/certificate-solicitations?status=waiting_approval&searchTerm=${termo}&sort={"_id":-1}&page=1&limit=${limit}&aggregate=[]`;
  const json = await requisitarLyra({ method: 'GET', rotaLimpa: rota, fetchImpl });
  return Array.isArray(json?.data) ? json.data : [];
}

export function selecionarSolicitacaoCorrespondente(lista, { solicitationId, cpf, curso, contrato } = {}) {
  if (!Array.isArray(lista) || lista.length === 0) return null;

  if (ehIdValido(solicitationId)) {
    const porId = lista.find((item) => item?._id === solicitationId || item?.id === solicitationId);
    if (porId) return porId;
  }

  const cpfAlvo = limparCpf(cpf);
  const cursoAlvo = normalizarTexto(curso);
  const contratoAlvo = String(contrato || '').trim();

  const pendentes = lista.filter((item) => !item?.status || item.status === 'waiting_approval');
  const candidatosCpf = cpfAlvo
    ? pendentes.filter((item) => limparCpf(item?.dataStudent?.cpf) === cpfAlvo)
    : pendentes;

  if (candidatosCpf.length === 0) return null;

  if (ehIdValido(contratoAlvo)) {
    const porContrato = candidatosCpf.find((item) => String(item?._enrolmentId || '').trim() === contratoAlvo);
    if (porContrato) return porContrato;
  }

  if (cursoAlvo) {
    const porCursoExato = candidatosCpf.find((item) => normalizarTexto(item?.dataCourse?.course) === cursoAlvo);
    if (porCursoExato) return porCursoExato;
  }

  if (candidatosCpf.length === 1) {
    return candidatosCpf[0];
  }

  return null;
}

export async function cancelarSolicitacaoLyra(
  { solicitationId, cpf, nome, curso, contrato, reason } = {},
  { fetchImpl = fetch } = {},
) {
  let idFinal = ehIdValido(solicitationId) ? String(solicitationId).trim() : null;

  if (!idFinal) {
    const cpfLimpo = limparCpf(cpf);
    const termos = [cpfLimpo, String(nome || '').trim()].filter(Boolean);

    for (const termo of termos) {
      const lista = await buscarSolicitacoesPendentesLyra({ searchTerm: termo, fetchImpl });
      const match = selecionarSolicitacaoCorrespondente(lista, { cpf: cpfLimpo, curso, contrato });
      if (match?._id || match?.id) {
        idFinal = match._id || match.id;
        break;
      }
    }
  }

  if (!idFinal) {
    return {
      ok: false,
      notFound: true,
      message: 'Solicitação pendente (waiting_approval) não encontrada no Lyra para este aluno/curso.',
    };
  }

  const motivo = String(reason || LYRA_DEFAULT_CANCEL_REASON).trim();
  const rotaCancelamento = `certificates/certificate-solicitations/${idFinal}/cancel`;
  const json = await requisitarLyra({
    method: 'PUT',
    rotaLimpa: rotaCancelamento,
    body: { reason: motivo },
    fetchImpl,
  });

  const statusRetornado = json?.data?.status;
  if (statusRetornado !== 'canceled' && json?.code !== 200) {
    return {
      ok: false,
      solicitationId: idFinal,
      message: `Resposta inesperada do Lyra ao cancelar: ${JSON.stringify(json).slice(0, 200)}`,
    };
  }

  return {
    ok: true,
    solicitationId: idFinal,
    status: statusRetornado || 'canceled',
    data: json?.data || null,
  };
}

export async function obterBuildDataLyra(solicitationId, { fetchImpl = fetch } = {}) {
  const rota = `certificates/certificate-solicitations/build-data/${solicitationId}`;
  const json = await requisitarLyra({ method: 'GET', rotaLimpa: rota, fetchImpl });
  if (!json?.data) {
    throw new Error(`build-data não retornou dados para a solicitação ${solicitationId}.`);
  }
  return json.data;
}

export async function obterProximoLivroRegistroLyra({ certifier, courseType }, { fetchImpl = fetch } = {}) {
  const slugCert = slugificarLyra(certifier);
  const slugTipo = slugificarLyra(courseType);
  if (!slugCert || !slugTipo) {
    throw new Error(`Certificadora ou tipo de curso inválido para next-book-registry: "${certifier}" / "${courseType}".`);
  }
  const rota = `certificates/certificate-solicitations/next-book-registry/${slugCert}/${slugTipo}`;
  const json = await requisitarLyra({ method: 'GET', rotaLimpa: rota, fetchImpl });
  if (!json?.data || json.data.book === undefined) {
    throw new Error(`next-book-registry não retornou livro/folha/registro para ${slugCert}/${slugTipo}.`);
  }
  return {
    book: json.data.book,
    sheet: json.data.sheet,
    registry: json.data.registry,
  };
}

export async function emitirCertificadoLyra(
  { solicitationId, cpf, nome, curso, contrato, dataInicio, dataFim } = {},
  { fetchImpl = fetch } = {},
) {
  let idFinal = ehIdValido(solicitationId) ? String(solicitationId).trim() : null;

  if (!idFinal) {
    const cpfLimpo = limparCpf(cpf);
    const termos = [cpfLimpo, String(nome || '').trim()].filter(Boolean);

    for (const termo of termos) {
      const lista = await buscarSolicitacoesPendentesLyra({ searchTerm: termo, fetchImpl });
      const match = selecionarSolicitacaoCorrespondente(lista, { cpf: cpfLimpo, curso, contrato });
      if (match?._id || match?.id) {
        idFinal = match._id || match.id;
        break;
      }
    }
  }

  if (!idFinal) {
    return {
      ok: false,
      notFound: true,
      message: 'Solicitação pendente (waiting_approval) não encontrada no Lyra para este aluno/curso.',
    };
  }

  const buildData = await obterBuildDataLyra(idFinal, { fetchImpl });
  const certifier = buildData?.dataCourse?.certifier;
  const courseType = buildData?.dataCourse?.courseType;
  const chaveFila = `${slugificarLyra(certifier) || 'default'}/${slugificarLyra(courseType) || 'default'}`;

  const startDateIso = converterDataParaIsoLyra(dataInicio) || buildData?.dataCourse?.startDate;
  const endDateIso = converterDataParaIsoLyra(dataFim) || buildData?.dataCourse?.endDate;

  const ds = buildData.dataStudent || {};
  const dc = buildData.dataCourse || {};
  const disciplinas = Array.isArray(buildData.disciplines)
    ? buildData.disciplines.map((d) => ({
        _name: d._name,
        workload: d.workload,
        frequency: d.frequency ?? 100,
        teacher: d.teacher,
        titration: d.titration,
        grade: d.grade ?? 10,
      }))
    : [];

  return executarNaFilaPorChave(chaveFila, async () => {
    const maxTentativasLivro = 3;

    for (let tentativa = 1; tentativa <= maxTentativasLivro; tentativa += 1) {
      const bookRegistry = await obterProximoLivroRegistroLyra({ certifier, courseType }, { fetchImpl });

      const payload = {
        metadata: { manualUpdate: true },
        type: buildData.type || 'digital',
        dataStudent: {
          name: ds.name,
          cpf: ds.cpf,
          rg: ds.rg,
          studentRegistrationCode: ds.studentRegistrationCode,
          naturalessCity: ds.naturalessCity,
          naturalessState: ds.naturalessState,
          nationality: ds.nationality,
          birthDate: ds.birthDate,
        },
        dataCourse: {
          course: dc.course,
          courseType: dc.courseType,
          certifier: dc.certifier,
          workload: dc.workload,
          knowledgeArea: dc.knowledgeArea,
          startDate: startDateIso,
          endDate: endDateIso,
          objective: dc.objective ?? null,
          program: dc.program ?? null,
        },
        disciplines: disciplinas,
        bookRegistry,
      };

      try {
        // 1. Atualiza a solicitação com as datas e dados completos
        await requisitarLyra({
          method: 'PUT',
          rotaLimpa: `certificates/certificate-solicitations/${idFinal}`,
          body: payload,
          fetchImpl,
        });

        // 2. Aprova e emite o certificado
        const jsonApprove = await requisitarLyra({
          method: 'PUT',
          rotaLimpa: `certificates/certificate-solicitations/${idFinal}/approve`,
          body: payload,
          fetchImpl,
        });

        const statusRetornado = jsonApprove?.data?.status;
        const certificateId = jsonApprove?.data?.metadata?._certificateId || null;

        if (statusRetornado !== 'approved' && jsonApprove?.code !== 200) {
          return {
            ok: false,
            solicitationId: idFinal,
            message: `Resposta inesperada do Lyra ao aprovar: ${JSON.stringify(jsonApprove).slice(0, 200)}`,
          };
        }

        return {
          ok: true,
          solicitationId: idFinal,
          certificateId,
          status: statusRetornado || 'approved',
          startDate: startDateIso,
          endDate: endDateIso,
          bookRegistry,
          data: jsonApprove?.data || null,
        };
      } catch (err) {
        if (ehErroConflitoRegistro(err) && tentativa < maxTentativasLivro) {
          console.warn(
            `⚠️  [LYRA] Conflito de livro/registro na tentativa ${tentativa} (${chaveFila}); consultando próximo número disponível...`,
          );
          continue;
        }
        throw err;
      }
    }
  });
}
