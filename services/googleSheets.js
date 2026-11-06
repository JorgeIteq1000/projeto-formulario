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

let sheetsClient = null;
let clientEmail = null;
let credenciaisValidas = false;

// Inicializa a autenticação com o Google
export function inicializarGoogleAuth() {
  if (sheetsClient) return { sheets: sheetsClient, clientEmail, credenciaisValidas };

  const caminhoCredenciais = resolverCaminhoCredenciais();
  if (!caminhoCredenciais) {
    console.warn('⚠️  Arquivo de credenciais do Google (123.json) não encontrado.');
    return { sheets: null, clientEmail: null, credenciaisValidas: false };
  }

  try {
    const credConteudo = JSON.parse(fs.readFileSync(caminhoCredenciais, 'utf-8'));
    clientEmail = credConteudo.client_email;

    const auth = new google.auth.GoogleAuth({
      keyFile: caminhoCredenciais,
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
          rg: headers.findIndex(h => h === 'RG' || h.startsWith('RG ')),
          naturalidade: headers.findIndex(h => h.includes('NATURALIDADE')),
          cargaHoraria: headers.findIndex(h => h.includes('CARGA')),
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
            nome: idx.nome !== -1 ? r[idx.nome] : '',
            tipoCertificado: idx.tipoCertificado !== -1 ? r[idx.tipoCertificado] : 'Digital',
            tipoCurso: idx.tipoCurso !== -1 ? r[idx.tipoCurso] : 'Extensão',
            curso: idx.curso !== -1 ? r[idx.curso] : '',
            certificadora: idx.certificadora !== -1 ? r[idx.certificadora] : '',
            contrato: idx.contrato !== -1 ? r[idx.contrato] : `lin-${i + 1}`,
            telefone: idx.telefone !== -1 ? (r[idx.telefone] || '').toString().replace(/\D/g, '') : '',
            dataNascimento: idx.dataNascimento !== -1 ? r[idx.dataNascimento] || '' : '',
            rg: idx.rg !== -1 ? r[idx.rg] || '' : '',
            naturalidade: idx.naturalidade !== -1 ? r[idx.naturalidade] || '' : '',
            cargaHoraria: idx.cargaHoraria !== -1 ? r[idx.cargaHoraria] || '' : '',
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

/**
 * Registra a resposta do aluno no Google Sheets (se ativo)
 * Atualiza o STATUS DO EVENTO para 'EMITIR' nas linhas do aluno.
 */
export async function registrarRespostaNoSheet({
  spreadsheetId,
  token,
  resposta,
  linkInfo
}) {
  const { sheets } = inicializarGoogleAuth();
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

    // Localiza colunas de CPF e STATUS DO EVENTO
    const colCpfIdx = headers.findIndex(h => (h || '').toString().toUpperCase() === 'CPF');
    const colStatusIdx = headers.findIndex(h => (h || '').toString().toUpperCase().includes('STATUS'));

    if (colCpfIdx === -1) {
      return { atualizado: false, motivo: 'Coluna CPF não encontrada' };
    }

    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A:Z`
    });
    const rows = rowsRes.data.values || [];

    const cpfBuscado = (linkInfo?.cpf || '').replace(/\D/g, '');
    const updates = [];

    // Função auxiliar para converter índice numérico (0 -> A, 8 -> I)
    const idxParaLetra = (colIdx) => String.fromCharCode(65 + colIdx);

    for (let i = 1; i < rows.length; i++) {
      const rowCpf = (rows[i][colCpfIdx] || '').toString().replace(/\D/g, '');
      if (rowCpf && rowCpf === cpfBuscado) {
        const numLinha = i + 1;
        // Se a coluna de status existir (geralmente I = STATUS DO EVENTO)
        if (colStatusIdx !== -1) {
          const letraCol = idxParaLetra(colStatusIdx);
          updates.push({
            range: `'${nomeAba}'!${letraCol}${numLinha}`,
            values: [['EMITIR']]
          });
        }
      }
    }

    if (!updates.length) {
      return { atualizado: false, motivo: 'Nenhuma linha encontrada para o CPF' };
    }

    // Executa batchUpdate para atualizar todas as linhas do aluno
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: {
        valueInputOption: 'USER_ENTERED',
        data: updates
      }
    });

    console.log(`✅ [GOOGLE SHEETS] Atualizadas ${updates.length} linha(s) para status EMITIR (CPF: ${cpfBuscado}, Protocolo: ${resposta.protocolo})`);

    return {
      atualizado: true,
      linhasAfetadas: updates.length,
      protocolo: resposta.protocolo
    };
  } catch (err) {
    console.error('❌ Erro ao atualizar resposta no Google Sheets:', err.message);
    return { atualizado: false, erro: err.message };
  }
}

// ============================================
// DADOS PESSOAIS DOS ALUNOS (aba separada, por CPF)
// ============================================
// Os dados exibidos no certificado (nascimento, RG, naturalidade) ficam numa aba própria, para não
// mexer na aba de solicitações preenchida pela automação. Colunas: CPF, DATA DE NASCIMENTO, RG, NATURALIDADE.

const cpfDigitos = (cpf) => String(cpf || '').replace(/\D/g, '').padStart(11, '0');
const semAcento = (txt) => String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

/**
 * Converte as linhas da aba (primeira linha = cabeçalhos) em um Map cpf (11 dígitos) -> dados do aluno.
 * Cabeçalhos são reconhecidos pelo texto, em qualquer ordem. Sem a coluna CPF, retorna Map vazio.
 */
export function montarDadosAlunos(linhas = []) {
  const mapa = new Map();
  if (!linhas.length) return mapa;

  const cab = linhas[0].map(semAcento);
  const iCpf = cab.findIndex((h) => h === 'CPF');
  if (iCpf === -1) return mapa;
  const iNasc = cab.findIndex((h) => h.includes('NASCIMENTO'));
  const iRg = cab.findIndex((h) => h === 'RG' || h.startsWith('RG '));
  const iNat = cab.findIndex((h) => h.includes('NATURALIDADE'));
  const valor = (linha, i) => (i === -1 ? '' : String(linha[i] ?? '').trim());

  for (const linha of linhas.slice(1)) {
    if (!String(linha[iCpf] ?? '').replace(/\D/g, '')) continue;
    mapa.set(cpfDigitos(linha[iCpf]), {
      dataNascimento: valor(linha, iNasc),
      rg: valor(linha, iRg),
      naturalidade: valor(linha, iNat)
    });
  }
  return mapa;
}

/** Aceita um arquivo local com array [{ cpf, dataNascimento, rg, naturalidade }]. */
export function montarDadosAlunosDeLista(lista = []) {
  const mapa = new Map();
  for (const a of Array.isArray(lista) ? lista : []) {
    if (!String(a?.cpf ?? '').replace(/\D/g, '')) continue;
    mapa.set(cpfDigitos(a.cpf), {
      dataNascimento: String(a.dataNascimento ?? '').trim(),
      rg: String(a.rg ?? '').trim(),
      naturalidade: String(a.naturalidade ?? '').trim()
    });
  }
  return mapa;
}

/**
 * Lê os dados pessoais dos alunos: primeiro da aba DADOS_ALUNOS da planilha (nome configurável em
 * GOOGLE_SHEET_TAB_DADOS); se ela não existir ou estiver vazia, tenta o arquivo local
 * (DADOS_ALUNOS_FILE ou src/data/dadosAlunos.json). Nunca lança erro: sem dados, o formulário mostra "Não informado".
 * @returns {Promise<{ dados: Map<string, {dataNascimento: string, rg: string, naturalidade: string}>, fonte: string }>}
 */
export async function carregarDadosAlunos({ spreadsheetId } = {}) {
  const { sheets } = inicializarGoogleAuth();
  const aba = process.env.GOOGLE_SHEET_TAB_DADOS || 'DADOS_ALUNOS';

  if (sheets && spreadsheetId) {
    try {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${aba}'!A1:Z` });
      const dados = montarDadosAlunos(res.data.values || []);
      if (dados.size) return { dados, fonte: `google_sheets:${aba}` };
    } catch (err) {
      console.log(`ℹ️  Aba "${aba}" não lida (${err.message.split('\n')[0]}). Dados pessoais ficarão como "Não informado" até a aba existir.`);
    }
  }

  const arquivo = process.env.DADOS_ALUNOS_FILE
    ? path.resolve(process.env.DADOS_ALUNOS_FILE)
    : path.join(__dirname, '..', 'src', 'data', 'dadosAlunos.json');
  if (fs.existsSync(arquivo)) {
    try {
      const dados = montarDadosAlunosDeLista(JSON.parse(fs.readFileSync(arquivo, 'utf-8')));
      if (dados.size) return { dados, fonte: 'arquivo_local' };
    } catch (err) {
      console.warn(`⚠️  Arquivo de dados pessoais inválido (${arquivo}): ${err.message}`);
    }
  }
  return { dados: new Map(), fonte: 'nenhuma' };
}
