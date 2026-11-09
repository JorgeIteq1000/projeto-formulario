import { google } from 'googleapis';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Busca o arquivo de credenciais do Google em locais prováveis
function resolverCaminhoCredenciais() {
  const candidatos = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.resolve(__dirname, '..', '..', '123.json'),
    path.resolve(__dirname, '..', '123.json'),
    path.resolve(__dirname, '..', 'credentials.json'),
    path.resolve(process.cwd(), '123.json'),
    path.resolve(process.cwd(), '..', '123.json')
  ].filter(Boolean);

  for (const c of candidatos) {
    if (fs.existsSync(c)) {
      return path.resolve(c);
    }
  }
  return null;
}

// Obtém o objeto de credenciais da Service Account (de variável de ambiente ou arquivo local)
export function obterCredenciaisGoogle() {
  // 1. Variáveis dedicadas de credenciais (JSON direto ou Base64) - Ideal para Vercel
  const candidatosEnv = [
    process.env.GOOGLE_CREDENTIALS,
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON,
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON,
    process.env.GOOGLE_CREDENTIALS_BASE64
  ].filter(Boolean);

  for (const raw of candidatosEnv) {
    const limpo = raw.trim();
    if (limpo.startsWith('{')) {
      try {
        return JSON.parse(limpo);
      } catch (err) {
        console.warn('⚠️  Falha ao parsear JSON das credenciais em variável de ambiente:', err.message);
      }
    }
    try {
      const decodificado = Buffer.from(limpo, 'base64').toString('utf-8');
      if (decodificado.trim().startsWith('{')) {
        return JSON.parse(decodificado);
      }
    } catch {
      // Não era base64
    }
  }

  // 2. Se o usuário colou o JSON diretamente em GOOGLE_APPLICATION_CREDENTIALS
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS.trim();
    if (raw.startsWith('{')) {
      try {
        return JSON.parse(raw);
      } catch (err) {
        console.warn('⚠️  Falha ao parsear JSON em GOOGLE_APPLICATION_CREDENTIALS:', err.message);
      }
    }
  }

  // 3. Fallback: procurar arquivo no disco local (123.json ou credentials.json)
  const caminhoCredenciais = resolverCaminhoCredenciais();
  if (caminhoCredenciais && fs.existsSync(caminhoCredenciais)) {
    try {
      return JSON.parse(fs.readFileSync(caminhoCredenciais, 'utf-8'));
    } catch (err) {
      console.warn(`⚠️  Falha ao ler arquivo de credenciais ${caminhoCredenciais}:`, err.message);
    }
  }

  return null;
}

let sheetsClient = null;
let clientEmail = null;
let credenciaisValidas = false;

// Inicializa a autenticação com o Google
export function inicializarGoogleAuth() {
  if (sheetsClient) return { sheets: sheetsClient, clientEmail, credenciaisValidas };

  const credConteudo = obterCredenciaisGoogle();
  if (!credConteudo || !credConteudo.client_email) {
    console.warn('⚠️  Credenciais do Google (123.json ou GOOGLE_CREDENTIALS) não encontradas.');
    return { sheets: null, clientEmail: null, credenciaisValidas: false };
  }

  try {
    clientEmail = credConteudo.client_email;

    // Normaliza quebras de linha na private_key caso venham escapadas como '\\n'
    let privateKey = credConteudo.private_key;
    if (privateKey && typeof privateKey === 'string') {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: credConteudo.client_email,
        private_key: privateKey,
        project_id: credConteudo.project_id
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    sheetsClient = google.sheets({ version: 'v4', auth });
    credenciaisValidas = true;

    console.log(`🔐 Google Sheets Service Account autenticado: ${clientEmail}`);
    return { sheets: sheetsClient, clientEmail, credenciaisValidas: true };
  } catch (err) {
    console.error('❌ Falha ao carregar credenciais do Google:', err.message);
    return { sheets: null, clientEmail: null, credenciaisValidas: false };
  }
}

// Coluna T (índice 19): onde fica o link individual de cada aluno
const COLUNA_LINK_IDX = 19;

let nomeAbaCache = null;

// Descobre a aba da planilha (prioriza GID 267936837 ou "Extensões e Aperfeiçoamentos")
async function descobrirNomeAba(sheets, spreadsheetId) {
  if (nomeAbaCache) return nomeAbaCache;
  if (process.env.GOOGLE_SHEET_TAB) {
    nomeAbaCache = process.env.GOOGLE_SHEET_TAB;
    return nomeAbaCache;
  }

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const TARGET_GID = 267936837;
    const porGid = meta.data.sheets.find(s => s.properties?.sheetId === TARGET_GID);
    if (porGid) {
      nomeAbaCache = porGid.properties.title;
      return nomeAbaCache;
    }

    const porNome = meta.data.sheets.find(s =>
      (s.properties?.title || '').toLowerCase().includes('extens')
    );
    if (porNome) {
      nomeAbaCache = porNome.properties.title;
      return nomeAbaCache;
    }

    nomeAbaCache = meta.data.sheets[0].properties.title;
    return nomeAbaCache;
  } catch {
    return 'Extensões e Aperfeiçoamentos';
  }
}

/**
 * Lê solicitações da planilha ou faz fallback para base local
 */
export async function carregarSolicitacoes({ spreadsheetId }) {
  const { sheets, clientEmail: email } = inicializarGoogleAuth();

  if (sheets && spreadsheetId) {
    try {
      const nomeAba = await descobrirNomeAba(sheets, spreadsheetId);
      console.log(`📊 Buscando dados da planilha Google Sheets [ID: ${spreadsheetId}] (Aba: "${nomeAba}")...`);
      
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${nomeAba}'!A1:Z`
      });

      const rows = res.data.values || [];
      if (rows.length > 1) {
        const headers = rows[0].map(h => (h || '').toString().trim().toUpperCase());
        
        // Mapeia índices dinamicamente
        const idxSolicitacao = headers.findIndex(h => h.includes('SOLICITA'));
        const idx = {
          solicitacao: idxSolicitacao !== -1
            ? idxSolicitacao
            : headers.findIndex(h => h.includes('DATA') && !h.includes('NASC')),
          cpf: headers.findIndex(h => h === 'CPF'),
          nome: headers.findIndex(h => h === 'NOME'),
          tipoCertificado: headers.findIndex(h => h.includes('TIPO') && h.includes('CERT')),
          tipoCurso: headers.findIndex(h => h.includes('TIPO') && h.includes('CURSO')),
          curso: headers.findIndex(h => h === 'CURSO'),
          certificadora: headers.findIndex(h => h.includes('CERTIFICADORA') || h.includes('FACULDADE')),
          contrato: headers.findIndex(h => h.includes('CONTRATO') || h.includes('MATRICULA')),
          status: headers.findIndex(h => h.includes('STATUS')),
          telefone: headers.findIndex(h => h.includes('TELEFONE') || h.includes('WHATSAPP') || h.includes('CELULAR')),
          dataNascimento: headers.findIndex(h => h.includes('NASCIMENTO')),
          rg: headers.findIndex(h => h === 'RG' || h.startsWith('RG ') || h.includes('RG')),
          naturalidade: headers.findIndex(h => h.includes('NATURALIDADE') || h.includes('NACIONALIDADE')),
          cargaHoraria: headers.findIndex(h => h.includes('CARGA')),
          protocolo: headers.findIndex(h => h.includes('PROTOCOLO')),
          token: headers.findIndex(h => h === 'TOKEN'),
          link: headers.findIndex(h => h === 'LINK' || h.includes('FORMULARIO'))
        };

        const solicitacoes = [];
        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const cpfRaw = idx.cpf !== -1 ? r[idx.cpf] : '';
          if (!cpfRaw) continue;

          solicitacoes.push({
            linhaPlanilha: i + 1, // 1-indexed para edição posterior
            solicitacao: idx.solicitacao !== -1 ? r[idx.solicitacao] : '',
            cpf: (cpfRaw || '').toString().replace(/\D/g, ''),
            nome: (idx.nome !== -1 ? r[idx.nome] : r[2]) || '',
            tipoCertificado: idx.tipoCertificado !== -1 ? r[idx.tipoCertificado] : 'Digital',
            tipoCurso: idx.tipoCurso !== -1 ? r[idx.tipoCurso] : 'Extensão',
            curso: idx.curso !== -1 ? r[idx.curso] : '',
            certificadora: idx.certificadora !== -1 ? r[idx.certificadora] : '',
            contrato: idx.contrato !== -1 ? r[idx.contrato] : `lin-${i + 1}`,
            telefone: (idx.telefone !== -1 ? r[idx.telefone] : r[11]) ? (idx.telefone !== -1 ? r[idx.telefone] : r[11]).toString().replace(/\D/g, '') : '',
            dataNascimento: idx.dataNascimento !== -1 ? r[idx.dataNascimento] || '' : '',
            rg: idx.rg !== -1 ? r[idx.rg] || '' : '',
            naturalidade: idx.naturalidade !== -1 ? r[idx.naturalidade] || '' : '',
            cargaHoraria: idx.cargaHoraria !== -1 ? r[idx.cargaHoraria] || '' : '',
            protocolo: idx.protocolo !== -1 ? r[idx.protocolo] || '' : '',
            // Coluna T ("Link"): link individual do aluno, gravado por gravarLinksNaPlanilha
            link: String((idx.link !== -1 ? r[idx.link] : r[COLUNA_LINK_IDX]) || '').trim(),
            statusOriginal: idx.status !== -1 ? r[idx.status] : ''
          });
        }

        console.log(`✅ Sucesso! Carregadas ${solicitacoes.length} solicitações da aba "${nomeAba}" do Google Sheets.`);
        return {
          fonte: 'google_sheets',
          aba: nomeAba,
          dados: solicitacoes,
          headers,
          indices: idx,
          clientEmail: email
        };
      }
    } catch (err) {
      console.warn(`⚠️  Não foi possível ler a planilha Google [${spreadsheetId}]: ${err.message}`);
      console.warn(`💡 Verifique se a planilha está compartilhada como Editor com: ${email}`);
    }
  }

  // Fallback seguro para base local
  console.log('📂 Usando base local (src/data/solicitacoesRaw.json) para o piloto/demonstração.');
  const caminhoLocal = path.join(__dirname, '..', 'src', 'data', 'solicitacoesRaw.json');
  if (fs.existsSync(caminhoLocal)) {
    const dados = JSON.parse(fs.readFileSync(caminhoLocal, 'utf-8'));
    return {
      fonte: 'local_json',
      dados,
      clientEmail: email
    };
  }

  return { fonte: 'vazio', dados: [], clientEmail: email };
}

// Converte índice de coluna 0-based para notação A1 (0 -> A, 8 -> I, 18 -> S, 26 -> AA)
export function idxParaColunaA1(colIdx) {
  let n = colIdx;
  let col = '';
  while (n >= 0) {
    col = String.fromCharCode(65 + (n % 26)) + col;
    n = Math.floor(n / 26) - 1;
  }
  return col;
}

const semAcento = (txt) => String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

/**
 * Registra a resposta do aluno no Google Sheets (se ativo)
 * Atualiza o STATUS DO EVENTO para 'EMITIR' e grava o número de Protocolo
 * em todas as linhas correspondentes à certificação do aluno.
 */
export async function registrarRespostaNoSheet({
  spreadsheetId,
  token,
  resposta,
  linkInfo,
  sheetsOverride = null
}) {
  const { sheets: authSheets } = sheetsOverride ? { sheets: sheetsOverride } : inicializarGoogleAuth();
  const sheets = sheetsOverride || authSheets;
  if (!sheets || !spreadsheetId) {
    return { atualizado: false, motivo: 'Planilha não configurada' };
  }

  try {
    const nomeAba = await descobrirNomeAba(sheets, spreadsheetId);
    
    // 1. Busca os cabeçalhos
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!1:1`
    });
    const headers = (headerRes.data.values && headerRes.data.values[0]) || [];

    // Localiza colunas de CPF, STATUS DO EVENTO e PROTOCOLO
    const colCpfIdx = headers.findIndex(h => semAcento(h) === 'CPF');
    const colStatusIdx = headers.findIndex(h => semAcento(h).includes('STATUS'));
    let colProtocoloIdx = headers.findIndex(h => semAcento(h).includes('PROTOCOLO'));

    if (colCpfIdx === -1) {
      return { atualizado: false, motivo: 'Coluna CPF não encontrada' };
    }

    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A:Z`
    });
    const rows = rowsRes.data.values || [];

    const cpfRawLink = String(linkInfo?.cpf || '').replace(/\D/g, '');
    const cpfBuscado = cpfRawLink ? cpfRawLink.padStart(11, '0') : '';
    const protocoloValor = resposta?.protocolo || '';
    const updates = [];
    let linhasAfetadas = 0;

    // Se a coluna Protocolo não existir no cabeçalho, cria na próxima coluna disponível
    if (colProtocoloIdx === -1 && protocoloValor) {
      colProtocoloIdx = headers.length;
      const letraColProto = idxParaColunaA1(colProtocoloIdx);
      updates.push({
        range: `'${nomeAba}'!${letraColProto}1`,
        values: [['Protocolo']]
      });
    }

    for (let i = 1; i < rows.length; i++) {
      const rowCpfDigits = (rows[i][colCpfIdx] || '').toString().replace(/\D/g, '');
      const rowCpf = rowCpfDigits ? rowCpfDigits.padStart(11, '0') : '';
      if (rowCpf && rowCpf === cpfBuscado) {
        const numLinha = i + 1;
        linhasAfetadas++;

        // Atualiza a coluna de status (ex: I = STATUS DO EVENTO)
        if (colStatusIdx !== -1) {
          const letraColStatus = idxParaColunaA1(colStatusIdx);
          updates.push({
            range: `'${nomeAba}'!${letraColStatus}${numLinha}`,
            values: [['EMITIR']]
          });
        }

        // Grava o número de protocolo na coluna Protocolo (ex: S = Protocolo) em todas as linhas do aluno
        if (colProtocoloIdx !== -1 && protocoloValor) {
          const letraColProto = idxParaColunaA1(colProtocoloIdx);
          updates.push({
            range: `'${nomeAba}'!${letraColProto}${numLinha}`,
            values: [[protocoloValor]]
          });
        }
      }
    }

    if (!linhasAfetadas) {
      return { atualizado: false, motivo: 'Nenhuma linha encontrada para o CPF' };
    }

    // Executa batchUpdate para atualizar todas as linhas do aluno (status EMITIR + Protocolo)
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });

    console.log(`✅ [GOOGLE SHEETS] Atualizadas ${linhasAfetadas} linha(s) com status EMITIR e Protocolo ${protocoloValor} (CPF: ${cpfBuscado})`);

    return {
      atualizado: true,
      linhasAfetadas,
      protocolo: protocoloValor
    };
  } catch (err) {
    console.error('❌ Erro ao atualizar resposta no Google Sheets:', err.message);
    return { atualizado: false, erro: err.message };
  }
}

/**
 * Grava o link individual de cada aluno na coluna T ("Link") da aba de solicitações,
 * em todas as linhas do aluno (por CPF). Só escreve na coluna do link:
 * - célula vazia ou com um link do formulário (contém "/solicitacoes/") é atualizada se for diferente;
 * - qualquer outro conteúdo é preservado (não sobrescreve texto de terceiros).
 * @param {Object} params
 * @param {string} params.spreadsheetId
 * @param {Array<{cpf: string, url: string}>} params.itens um item por aluno
 * @param {boolean} [params.dryRun] apenas calcula, sem gravar
 */
export async function gravarLinksNaPlanilha({ spreadsheetId, itens = [], dryRun = false, sheetsOverride = null }) {
  const sheets = sheetsOverride || inicializarGoogleAuth().sheets;
  if (!sheets || !spreadsheetId) {
    return { sucesso: false, motivo: 'Planilha não configurada' };
  }

  try {
    const nomeAba = await descobrirNomeAba(sheets, spreadsheetId);
    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A:Z`
    });
    const rows = rowsRes.data.values || [];
    const headers = rows[0] || [];

    const colCpfIdx = headers.findIndex((h) => semAcento(h) === 'CPF');
    if (colCpfIdx === -1) return { sucesso: false, motivo: 'Coluna CPF não encontrada' };

    // Coluna do link: cabeçalho "Link"; se não existir, usa a coluna T
    let colLinkIdx = headers.findIndex((h) => semAcento(h) === 'LINK');
    const criarCabecalho = colLinkIdx === -1;
    if (criarCabecalho) colLinkIdx = COLUNA_LINK_IDX;
    const letra = idxParaColunaA1(colLinkIdx);

    const urlPorCpf = new Map();
    for (const it of itens) {
      const cpf = String(it?.cpf || '').replace(/\D/g, '').padStart(11, '0');
      if (cpf && it?.url) urlPorCpf.set(cpf, it.url);
    }

    const updates = [];
    if (criarCabecalho) updates.push({ range: `'${nomeAba}'!${letra}1`, values: [['Link']] });

    let jaCorretos = 0;
    let preservados = 0;
    const cpfsAtualizados = new Set();
    for (let i = 1; i < rows.length; i++) {
      const digitos = String(rows[i][colCpfIdx] || '').replace(/\D/g, '');
      if (!digitos) continue;
      const url = urlPorCpf.get(digitos.padStart(11, '0'));
      if (!url) continue;

      const atual = String(rows[i][colLinkIdx] || '').trim();
      if (atual === url) { jaCorretos++; continue; }
      if (atual && !atual.includes('/solicitacoes/')) { preservados++; continue; }

      updates.push({ range: `'${nomeAba}'!${letra}${i + 1}`, values: [[url]] });
      cpfsAtualizados.add(digitos.padStart(11, '0'));
    }

    const linhasAtualizadas = updates.length - (criarCabecalho ? 1 : 0);
    const resumo = {
      sucesso: true,
      dryRun,
      aba: nomeAba,
      coluna: letra,
      alunos: urlPorCpf.size,
      alunosAtualizados: cpfsAtualizados.size,
      linhasAtualizadas,
      jaCorretos,
      preservados
    };

    if (!dryRun && updates.length) {
      const TAMANHO_LOTE = 500;
      for (let i = 0; i < updates.length; i += TAMANHO_LOTE) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          resource: { valueInputOption: 'RAW', data: updates.slice(i, i + TAMANHO_LOTE) }
        });
      }
      console.log(`✅ [GOOGLE SHEETS] ${linhasAtualizadas} link(s) gravado(s) na coluna ${letra} (${cpfsAtualizados.size} aluno(s)).`);
    }
    return resumo;
  } catch (err) {
    console.error('❌ Erro ao gravar links no Google Sheets:', err.message);
    return { sucesso: false, erro: err.message };
  }
}

// ============================================
// DADOS PESSOAIS DOS ALUNOS (aba separada, por CPF)
// ============================================
// Os dados exibidos no certificado (nascimento, RG, naturalidade) ficam numa aba própria, para não
// mexer na aba de solicitações preenchida pela automação. Colunas: CPF, DATA DE NASCIMENTO, RG, NATURALIDADE.


