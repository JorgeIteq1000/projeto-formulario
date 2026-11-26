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
const TARGET_GID_CANCELADAS = 710641972;
export const TARGET_GID_USUARIOS = 1338320797;

export const CABECALHOS_CANCELADAS = [
  'SOLICITAÇÃO',
  'CPF',
  'NOME',
  'TIPO DE CERTIFICADO',
  'TIPO DE CURSO',
  'CURSO',
  'CERTIFICADORA',
  'CONTRATO',
  'STATUS DO EVENTO',
  'ID DO EVENTO',
  'DATA CRIAÇÃO EVENTO',
  'TELEFONE',
  'DATA INÍCIO (ISO)',
  'CRIAÇÃO MATRÍCULA (ISO)',
  'USER ID',
  'RG',
  'Nacionalidade',
  'Data de Nascimento',
  'Protocolo',
  'Link',
  'Token',
  'Data Cancelamento',
  'Motivo Cancelamento'
];

let nomeAbaCache = null;
let nomeAbaCanceladasCache = null;

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

// Descobre a aba de solicitações canceladas (prioriza GID 710641972)
async function descobrirNomeAbaCanceladas(sheets, spreadsheetId) {
  if (nomeAbaCanceladasCache) return nomeAbaCanceladasCache;
  if (process.env.GOOGLE_SHEET_TAB_CANCELADAS) {
    nomeAbaCanceladasCache = process.env.GOOGLE_SHEET_TAB_CANCELADAS;
    return nomeAbaCanceladasCache;
  }

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const porGid = meta.data.sheets.find(s => s.properties?.sheetId === TARGET_GID_CANCELADAS);
    if (porGid) {
      nomeAbaCanceladasCache = porGid.properties.title;
      return nomeAbaCanceladasCache;
    }

    const porNome = meta.data.sheets.find(s =>
      (s.properties?.title || '').toLowerCase().includes('cancelad')
    );
    if (porNome) {
      nomeAbaCanceladasCache = porNome.properties.title;
      return nomeAbaCanceladasCache;
    }
  } catch {
    // Fallback abaixo
  }
  return 'Solicitaões Canceladas';
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
        range: `'${nomeAba}'!A1:AD`
      });

      const rows = res.data.values || [];
      if (rows.length > 1) {
        const headers = rows[0].map(h => (h || '').toString().trim().toUpperCase());
        const headersSemAcento = headers.map(semAcento);
        
        // Mapeia índices dinamicamente
        const idxSolicitacao = headersSemAcento.findIndex(h => h.includes('SOLICITA'));
        const idxStatusForm = headersSemAcento.findIndex(
          h => h === 'STATUS DO FORMULARIO' || h === 'STATUS DO EVENTO'
        );
        const idxStatusFallback = headersSemAcento.findIndex(
          h => h.includes('STATUS') && !h.includes('LYRA') && !h.includes('MODIFICACAO') && !h.includes('WHATSAPP')
        );
        const idx = {
          solicitacao: idxSolicitacao !== -1
            ? idxSolicitacao
            : headersSemAcento.findIndex(h => h.includes('DATA') && !h.includes('NASC') && !h.includes('MODIFICACAO')),
          cpf: headersSemAcento.findIndex(h => h === 'CPF'),
          nome: headersSemAcento.findIndex(h => h === 'NOME'),
          tipoCertificado: headersSemAcento.findIndex(h => h.includes('TIPO') && h.includes('CERT')),
          tipoCurso: headersSemAcento.findIndex(h => h.includes('TIPO') && h.includes('CURSO')),
          curso: headersSemAcento.findIndex(h => h === 'CURSO'),
          certificadora: headersSemAcento.findIndex(h => h.includes('CERTIFICADORA') || h.includes('FACULDADE')),
          contrato: headersSemAcento.findIndex(h => h.includes('CONTRATO') || h.includes('MATRICULA')),
          status: idxStatusForm !== -1 ? idxStatusForm : idxStatusFallback,
          telefone: headersSemAcento.findIndex(h => h.includes('TELEFONE') || h.includes('WHATSAPP') || h.includes('CELULAR')),
          dataNascimento: headersSemAcento.findIndex(h => h.includes('NASCIMENTO')),
          rg: headersSemAcento.findIndex(h => h === 'RG' || h.startsWith('RG ') || h.includes('RG')),
          naturalidade: headersSemAcento.findIndex(h => h.includes('NATURALIDADE') || h.includes('NACIONALIDADE')),
          cargaHoraria: headersSemAcento.findIndex(h => h.includes('CARGA')),
          protocolo: headersSemAcento.findIndex(h => h.includes('PROTOCOLO')),
          token: headersSemAcento.findIndex(h => h === 'TOKEN'),
          link: headersSemAcento.findIndex(h => h === 'LINK' || h.includes('FORMULARIO')),
          dataInsercao: headersSemAcento.findIndex(h => h.includes('INSERID') || h.includes('DATA INSER')),
          statusLyra: headersSemAcento.findIndex(h => h.includes('STATUS LYRA')),
          modificacaoStatus: headersSemAcento.findIndex(h => h.includes('MODIFICACAO DO STATUS')),
          prazoMinimoConclusao: headersSemAcento.findIndex(h => h.includes('PRAZO MINIMO')),
          statusWhatsApp: headersSemAcento.findIndex(h => h.includes('STATUS WHATSAPP') || h === 'WHATSAPP_STATUS' || h.includes('STATUS ZIONIC')),
          dataUltimoWhatsApp: headersSemAcento.findIndex(h => h.includes('DATA ENVIO WHATSAPP') || h.includes('DATA ULTIMO WHATSAPP') || h === 'WHATSAPP_DATA' || h.includes('DATA WHATSAPP')),
          totalLembretesWhatsApp: headersSemAcento.findIndex(h => h.includes('LEMBRETES') || h === 'WHATSAPP_COUNT')
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
            // Coluna U ("Inserido na Planilha em")
            dataInsercao: String((idx.dataInsercao !== -1 ? r[idx.dataInsercao] : r[20]) || '').trim(),
            statusOriginal: idx.status !== -1 ? r[idx.status] : '',
            // Coluna V ("STATUS LYRA"), W ("MODIFICAÇÃO DO STATUS"), X ("PRAZO MÍNIMO PARA CONCLUSÃO")
            statusLyra: String((idx.statusLyra !== -1 ? r[idx.statusLyra] : r[21]) || '').trim(),
            modificacaoStatus: String((idx.modificacaoStatus !== -1 ? r[idx.modificacaoStatus] : r[22]) || '').trim(),
            prazoMinimoConclusao: String((idx.prazoMinimoConclusao !== -1 ? r[idx.prazoMinimoConclusao] : r[23]) || '').trim(),
            statusWhatsApp: idx.statusWhatsApp !== -1 ? String(r[idx.statusWhatsApp] || '').trim() : '',
            dataUltimoWhatsApp: idx.dataUltimoWhatsApp !== -1 ? String(r[idx.dataUltimoWhatsApp] || '').trim() : '',
            totalLembretesWhatsApp: idx.totalLembretesWhatsApp !== -1 ? (Number(r[idx.totalLembretesWhatsApp]) || 0) : 0
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

    // Localiza colunas de CPF, STATUS DO FORMULÁRIO/EVENTO, PROTOCOLO, STATUS LYRA e MODIFICAÇÃO DO STATUS
    const headersNorm = headers.map(h => semAcento(h));
    const colCpfIdx = headersNorm.findIndex(h => h === 'CPF');
    const colStatusFormIdx = headersNorm.findIndex(h => h === 'STATUS DO FORMULARIO' || h === 'STATUS DO EVENTO');
    const colStatusIdx = colStatusFormIdx !== -1
      ? colStatusFormIdx
      : headersNorm.findIndex(h => h.includes('STATUS') && !h.includes('LYRA') && !h.includes('MODIFICACAO') && !h.includes('WHATSAPP'));
    let colProtocoloIdx = headersNorm.findIndex(h => h.includes('PROTOCOLO'));
    const colStatusLyraIdx = headersNorm.findIndex(h => h.includes('STATUS LYRA'));
    const colModStatusIdx = headersNorm.findIndex(h => h.includes('MODIFICACAO DO STATUS'));

    if (colCpfIdx === -1) {
      return { atualizado: false, motivo: 'Coluna CPF não encontrada' };
    }

    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A:AD`
    });
    const rows = rowsRes.data.values || [];

    const cpfRawLink = String(linkInfo?.cpf || '').replace(/\D/g, '');
    const cpfBuscado = cpfRawLink ? cpfRawLink.padStart(11, '0') : '';
    const protocoloValor = resposta?.protocolo || '';
    const dataModificacaoValor = resposta?.dataSubmissaoFormatada || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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

        // Atualiza a coluna de status do formulário (I = STATUS DO FORMULÁRIO)
        if (colStatusIdx !== -1) {
          const letraColStatus = idxParaColunaA1(colStatusIdx);
          updates.push({
            range: `'${nomeAba}'!${letraColStatus}${numLinha}`,
            values: [['EMITIR']]
          });
        }

        // Grava o número de protocolo na coluna Protocolo (S = Protocolo) em todas as linhas do aluno
        if (colProtocoloIdx !== -1 && protocoloValor) {
          const letraColProto = idxParaColunaA1(colProtocoloIdx);
          updates.push({
            range: `'${nomeAba}'!${letraColProto}${numLinha}`,
            values: [[protocoloValor]]
          });
        }

        // Grava a data de modificação do status na Coluna W (MODIFICAÇÃO DO STATUS)
        if (colModStatusIdx !== -1) {
          const letraColMod = idxParaColunaA1(colModStatusIdx);
          updates.push({
            range: `'${nomeAba}'!${letraColMod}${numLinha}`,
            values: [[dataModificacaoValor]]
          });
        }

        // Se já foi emitido automaticamente no Lyra, espelha "Aprovado" na Coluna V (STATUS LYRA)
        if (colStatusLyraIdx !== -1 && resposta?.emitidoNoLyra === true) {
          const letraColLyra = idxParaColunaA1(colStatusLyraIdx);
          updates.push({
            range: `'${nomeAba}'!${letraColLyra}${numLinha}`,
            values: [['Aprovado']]
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

/**
 * Extrai o token de uma URL no formato ".../solicitacoes/<token>" ou retorna o valor se já for um token.
 */
export function extrairTokenDeLink(valor) {
  const txt = String(valor || '').trim();
  if (!txt) return '';
  const m = /\/solicitacoes\/([A-Za-z0-9_-]+)/.exec(txt);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(txt)) return txt;
  return '';
}

/**
 * Garante que a aba "Solicitações Canceladas" (GID 710641972) possua os cabeçalhos padrão na linha 1.
 */
export async function garantirCabecalhosCanceladas({ spreadsheetId, sheetsOverride = null } = {}) {
  const sheets = sheetsOverride || inicializarGoogleAuth().sheets;
  if (!sheets || !spreadsheetId) return { ok: false, motivo: 'Planilha não configurada' };

  try {
    const nomeAba = await descobrirNomeAbaCanceladas(sheets, spreadsheetId);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!1:1`
    });
    const linha1 = res.data.values?.[0] || [];
    if (linha1.length === 0) {
      const ultimaCol = idxParaColunaA1(CABECALHOS_CANCELADAS.length - 1);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${nomeAba}'!A1:${ultimaCol}1`,
        valueInputOption: 'RAW',
        resource: { values: [CABECALHOS_CANCELADAS] }
      });
      return { ok: true, criado: true, aba: nomeAba, colunas: CABECALHOS_CANCELADAS.length };
    }
    return { ok: true, criado: false, aba: nomeAba, colunas: linha1.length };
  } catch (err) {
    console.warn(`⚠️  Não foi possível verificar cabeçalhos da aba de canceladas: ${err.message}`);
    return { ok: false, erro: err.message };
  }
}

/**
 * Lê os tokens/CPFs já cancelados por expiração de 96h da aba "Solicitações Canceladas".
 * @returns {Promise<{ tokensCancelados: Map<string, object>, fonte: string }>}
 */
export async function carregarSolicitacoesCanceladas({ spreadsheetId, sheetsOverride = null } = {}) {
  const sheets = sheetsOverride || inicializarGoogleAuth().sheets;
  const tokensCancelados = new Map();
  if (!sheets || !spreadsheetId) return { tokensCancelados, fonte: 'nenhuma' };

  try {
    const nomeAba = await descobrirNomeAbaCanceladas(sheets, spreadsheetId);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A1:Z`
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return { tokensCancelados, fonte: `google_sheets:${nomeAba}` };

    const headers = rows[0].map(semAcento);
    const iToken = headers.findIndex((h) => h === 'TOKEN');
    const iLink = headers.findIndex((h) => h === 'LINK' || h.includes('FORMULARIO'));
    const iCpf = headers.findIndex((h) => h === 'CPF');
    const iNome = headers.findIndex((h) => h === 'NOME');
    const iDataCancel = headers.findIndex((h) => h.includes('DATA CANCELAMENTO'));
    const iMotivo = headers.findIndex((h) => h.includes('MOTIVO'));

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const tokenDireto = iToken !== -1 ? extrairTokenDeLink(r[iToken]) : '';
      const tokenLink = iLink !== -1 ? extrairTokenDeLink(r[iLink]) : '';
      const token = tokenDireto || tokenLink;
      if (!token) continue;

      const cpfRaw = iCpf !== -1 ? String(r[iCpf] || '').replace(/\D/g, '') : '';
      tokensCancelados.set(token, {
        token,
        cpf: cpfRaw ? cpfRaw.padStart(11, '0') : '',
        nome: iNome !== -1 ? String(r[iNome] || '').trim() : '',
        dataCancelamento: iDataCancel !== -1 ? String(r[iDataCancel] || '').trim() : '',
        motivo: iMotivo !== -1 ? String(r[iMotivo] || '').trim() : 'Prazo de 96 horas expirado'
      });
    }

    return { tokensCancelados, fonte: `google_sheets:${nomeAba}` };
  } catch (err) {
    console.warn(`⚠️  Não foi possível ler aba de canceladas: ${err.message}`);
    return { tokensCancelados, fonte: 'erro' };
  }
}

/**
 * Grava o status e timestamp da régua de WhatsApp na aba de solicitações
 * nas colunas de controle: STATUS WHATSAPP, DATA ULTIMO WHATSAPP, TOTAL LEMBRETES WHATSAPP.
 * Cria os cabeçalhos se ainda não existirem.
 *
 * @param {Object} params
 * @param {string} params.spreadsheetId
 * @param {Array<{cpf: string, statusWhatsApp: string, dataUltimoWhatsApp?: string, totalLembretes?: number}>} params.itens
 * @param {boolean} [params.dryRun]
 * @param {object} [params.sheetsOverride]
 */
export async function gravarStatusWhatsAppNaPlanilha({ spreadsheetId, itens = [], dryRun = false, sheetsOverride = null }) {
  const sheets = sheetsOverride || inicializarGoogleAuth().sheets;
  if (!sheets || !spreadsheetId) {
    return { sucesso: false, motivo: 'Planilha não configurada' };
  }

  try {
    const nomeAba = await descobrirNomeAba(sheets, spreadsheetId);
    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A1:AD`
    });
    const rows = rowsRes.data.values || [];
    if (!rows.length) return { sucesso: false, motivo: 'Planilha vazia' };
    const headers = rows[0] || [];

    const headersNorm = headers.map((h) => semAcento(h));
    const colCpfIdx = headersNorm.findIndex((h) => h === 'CPF');
    if (colCpfIdx === -1) return { sucesso: false, motivo: 'Coluna CPF não encontrada' };

    const colStatusFormIdx = headersNorm.findIndex((h) => h === 'STATUS DO FORMULARIO' || h === 'STATUS DO EVENTO');
    const colStatusFormFinalIdx = colStatusFormIdx !== -1
      ? colStatusFormIdx
      : headersNorm.findIndex((h) => h.includes('STATUS') && !h.includes('LYRA') && !h.includes('MODIFICACAO') && !h.includes('WHATSAPP'));

    // Coluna Y (24) = DATA ENVIO WHATSAPP, Coluna Z (25) = STATUS WHATSAPP, Coluna AA (26) = TOTAL LEMBRETES WHATSAPP
    let colDataIdx = headersNorm.findIndex((h) => h.includes('DATA ENVIO WHATSAPP') || h.includes('DATA ULTIMO WHATSAPP') || h === 'WHATSAPP_DATA');
    let colStatusIdx = headersNorm.findIndex((h) => h.includes('STATUS WHATSAPP') || h === 'WHATSAPP_STATUS');
    let colTotalIdx = headersNorm.findIndex((h) => h.includes('LEMBRETES') || h === 'WHATSAPP_COUNT');

    const updates = [];
    // Reserva V(21)=STATUS LYRA, W(22)=MODIFICAÇÃO DO STATUS, X(23)=PRAZO MÍNIMO PARA CONCLUSÃO
    let proximaColIdx = Math.max(headers.length, 24);

    if (colDataIdx === -1) {
      colDataIdx = proximaColIdx++;
      const letra = idxParaColunaA1(colDataIdx);
      updates.push({ range: `'${nomeAba}'!${letra}1`, values: [['DATA ENVIO WHATSAPP']] });
    }
    if (colStatusIdx === -1) {
      colStatusIdx = proximaColIdx++;
      const letra = idxParaColunaA1(colStatusIdx);
      updates.push({ range: `'${nomeAba}'!${letra}1`, values: [['STATUS WHATSAPP']] });
    }
    if (colTotalIdx === -1) {
      colTotalIdx = proximaColIdx++;
      const letra = idxParaColunaA1(colTotalIdx);
      updates.push({ range: `'${nomeAba}'!${letra}1`, values: [['TOTAL LEMBRETES WHATSAPP']] });
    }

    const letraStatus = idxParaColunaA1(colStatusIdx);
    const letraData = idxParaColunaA1(colDataIdx);
    const letraTotal = idxParaColunaA1(colTotalIdx);
    const letraStatusForm = colStatusFormFinalIdx !== -1 ? idxParaColunaA1(colStatusFormFinalIdx) : null;

    const porCpf = new Map();
    for (const it of itens) {
      const cpfLimpo = String(it?.cpf || '').replace(/\D/g, '').padStart(11, '0');
      if (cpfLimpo) porCpf.set(cpfLimpo, it);
    }

    let linhasAfetadas = 0;
    const agoraStr = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    for (let i = 1; i < rows.length; i++) {
      const digitos = String(rows[i][colCpfIdx] || '').replace(/\D/g, '').padStart(11, '0');
      if (!digitos || !porCpf.has(digitos)) continue;

      const info = porCpf.get(digitos);
      const linhaNum = i + 1;

      // Atualiza Coluna I (STATUS DO FORMULÁRIO) para "Enviado" apenas se ainda estiver pendente de envio
      if (letraStatusForm) {
        const statusAtualForm = semAcento(rows[i][colStatusFormFinalIdx]);
        if (!statusAtualForm || statusAtualForm === 'PENDENTE_ENVIO' || statusAtualForm === 'PENDENTE') {
          updates.push({ range: `'${nomeAba}'!${letraStatusForm}${linhaNum}`, values: [['Enviado']] });
        }
      }

      updates.push({ range: `'${nomeAba}'!${letraData}${linhaNum}`, values: [[info.dataUltimoWhatsApp || agoraStr]] });
      if (info.statusWhatsApp) {
        updates.push({ range: `'${nomeAba}'!${letraStatus}${linhaNum}`, values: [[info.statusWhatsApp]] });
      }
      if (typeof info.totalLembretes === 'number') {
        updates.push({ range: `'${nomeAba}'!${letraTotal}${linhaNum}`, values: [[String(info.totalLembretes)]] });
      }
      linhasAfetadas++;
    }

    if (!dryRun && updates.length) {
      const colNecessarias = Math.max(colDataIdx, colStatusIdx, colTotalIdx) + 1;
      try {
        const meta = await sheets.spreadsheets.get({
          spreadsheetId,
          fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)'
        });
        const abaMeta = (meta?.data?.sheets || []).find((s) => s.properties?.title === nomeAba);
        const colAtual = abaMeta?.properties?.gridProperties?.columnCount || 0;
        if (abaMeta?.properties?.sheetId !== undefined && colAtual > 0 && colNecessarias > colAtual && typeof sheets.spreadsheets.batchUpdate === 'function') {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            resource: {
              requests: [{
                appendDimension: {
                  sheetId: abaMeta.properties.sheetId,
                  dimension: 'COLUMNS',
                  length: colNecessarias - colAtual
                }
              }]
            }
          });
          console.log(`➕ [GOOGLE SHEETS] Aba "${nomeAba}" expandida automaticamente de ${colAtual} para ${colNecessarias} colunas.`);
        }
      } catch (errExpand) {
        console.warn(`⚠️  Aviso ao verificar/expandir colunas da aba "${nomeAba}": ${errExpand.message}`);
      }

      const TAMANHO_LOTE = 500;
      for (let i = 0; i < updates.length; i += TAMANHO_LOTE) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          resource: { valueInputOption: 'RAW', data: updates.slice(i, i + TAMANHO_LOTE) }
        });
      }
      console.log(`✅ [GOOGLE SHEETS] Status do WhatsApp atualizado em ${linhasAfetadas} linha(s) (${porCpf.size} aluno(s)).`);
    }

    return {
      sucesso: true,
      dryRun,
      alunos: porCpf.size,
      linhasAfetadas,
      totalUpdates: updates.length
    };
  } catch (err) {
    console.error('❌ Erro ao gravar status do WhatsApp no Google Sheets:', err.message);
    return { sucesso: false, erro: err.message };
  }
}

/**
 * Atualiza a Coluna V ("STATUS LYRA") e a Coluna W ("MODIFICAÇÃO DO STATUS") para um aluno (CPF)
 * após emissão manual no painel ou atualização de status no Lyra.
 */
export async function atualizarStatusLyraNoSheet({
  spreadsheetId,
  cpf,
  statusLyra = 'Aprovado',
  dataModificacao = null,
  sheetsOverride = null
}) {
  const sheets = sheetsOverride || inicializarGoogleAuth().sheets;
  if (!sheets || !spreadsheetId) {
    return { atualizado: false, motivo: 'Planilha não configurada' };
  }

  try {
    const nomeAba = await descobrirNomeAba(sheets, spreadsheetId);
    const rowsRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A:AD`
    });
    const rows = rowsRes.data.values || [];
    if (!rows.length) return { atualizado: false, motivo: 'Planilha vazia' };

    const headersNorm = rows[0].map((h) => semAcento(h));
    const colCpfIdx = headersNorm.findIndex((h) => h === 'CPF');
    if (colCpfIdx === -1) return { atualizado: false, motivo: 'Coluna CPF não encontrada' };

    const colStatusLyraIdx = headersNorm.findIndex((h) => h.includes('STATUS LYRA'));
    const colModStatusIdx = headersNorm.findIndex((h) => h.includes('MODIFICACAO DO STATUS'));
    const cpfBuscado = String(cpf || '').replace(/\D/g, '').padStart(11, '0');
    const dataValor = dataModificacao || new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    const updates = [];
    let linhasAfetadas = 0;

    for (let i = 1; i < rows.length; i++) {
      const rowCpf = String(rows[i][colCpfIdx] || '').replace(/\D/g, '').padStart(11, '0');
      if (!rowCpf || rowCpf !== cpfBuscado) continue;

      const numLinha = i + 1;
      linhasAfetadas++;

      if (colStatusLyraIdx !== -1) {
        updates.push({
          range: `'${nomeAba}'!${idxParaColunaA1(colStatusLyraIdx)}${numLinha}`,
          values: [[statusLyra]]
        });
      }
      if (colModStatusIdx !== -1) {
        updates.push({
          range: `'${nomeAba}'!${idxParaColunaA1(colModStatusIdx)}${numLinha}`,
          values: [[dataValor]]
        });
      }
    }

    if (!linhasAfetadas || !updates.length) {
      return { atualizado: false, motivo: 'Nenhuma linha ou coluna V/W encontrada para atualizar' };
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: { valueInputOption: 'USER_ENTERED', data: updates }
    });

    console.log(`✅ [GOOGLE SHEETS] Colunas V/W atualizadas (${statusLyra} em ${dataValor}) para CPF ${cpfBuscado}`);
    return { atualizado: true, linhasAfetadas, statusLyra, dataModificacao: dataValor };
  } catch (err) {
    console.error('❌ Erro ao atualizar STATUS LYRA / MODIFICAÇÃO DO STATUS no Google Sheets:', err.message);
    return { atualizado: false, erro: err.message };
  }
}

/**
 * Atualiza de forma isolada os dados cadastrais (Nome, Telefone, RG, Nacionalidade/Naturalidade, Data de Nascimento)
 * de todas as linhas de um aluno específico na planilha Google Sheets.
 */
export async function atualizarDadosCadastraisAlunoNoSheet(
  { cpf, nome, telefone, rg, nacionalidade, dataNascimento },
  { spreadsheetId = process.env.GOOGLE_SHEET_ID, nomeAba = process.env.GOOGLE_SHEET_ABA || 'Extensões e Aperfeiçoamentos' } = {}
) {
  try {
    if (!spreadsheetId) {
      return { atualizado: false, motivo: 'GOOGLE_SHEET_ID não configurado' };
    }
    const { sheets, credenciaisValidas: ok } = inicializarGoogleAuth();
    if (!ok || !sheets) {
      return { atualizado: false, motivo: 'Credenciais do Google Sheets não configuradas' };
    }

    const cpfBuscado = String(cpf || '').replace(/\D/g, '').padStart(11, '0');
    if (!cpfBuscado || cpfBuscado === '00000000000') {
      return { atualizado: false, motivo: 'CPF inválido' };
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${nomeAba}'!A:AD`
    });

    const rows = res.data.values || [];
    if (rows.length < 2) {
      return { atualizado: false, motivo: 'Planilha vazia ou sem linhas de dados' };
    }

    const headersNorm = rows[0].map((h) => semAcento(String(h || '').trim().toUpperCase()));
    const colCpfIdx = headersNorm.findIndex((h) => h === 'CPF');
    if (colCpfIdx === -1) return { atualizado: false, motivo: 'Coluna CPF não encontrada' };

    const colNomeIdx = headersNorm.findIndex((h) => h === 'NOME');
    const colTelIdx = headersNorm.findIndex((h) => h.includes('TELEFONE') || h.includes('WHATSAPP') || h.includes('CELULAR'));
    const colRgIdx = headersNorm.findIndex((h) => h === 'RG' || h.startsWith('RG ') || h.includes('RG'));
    const colNacIdx = headersNorm.findIndex((h) => h.includes('NATURALIDADE') || h.includes('NACIONALIDADE'));
    const colNascIdx = headersNorm.findIndex((h) => h.includes('NASCIMENTO'));

    const updates = [];
    let linhasAfetadas = 0;

    for (let i = 1; i < rows.length; i++) {
      const rowCpf = String(rows[i][colCpfIdx] || '').replace(/\D/g, '').padStart(11, '0');
      if (!rowCpf || rowCpf !== cpfBuscado) continue;

      const numLinha = i + 1;
      linhasAfetadas++;

      if (colNomeIdx !== -1 && nome) {
        updates.push({ range: `'${nomeAba}'!${idxParaColunaA1(colNomeIdx)}${numLinha}`, values: [[nome]] });
      }
      if (colTelIdx !== -1 && telefone) {
        updates.push({ range: `'${nomeAba}'!${idxParaColunaA1(colTelIdx)}${numLinha}`, values: [[telefone]] });
      }
      if (colRgIdx !== -1 && rg !== undefined && rg !== null && String(rg).trim() !== '') {
        updates.push({ range: `'${nomeAba}'!${idxParaColunaA1(colRgIdx)}${numLinha}`, values: [[rg]] });
      }
      if (colNacIdx !== -1 && nacionalidade) {
        updates.push({ range: `'${nomeAba}'!${idxParaColunaA1(colNacIdx)}${numLinha}`, values: [[nacionalidade]] });
      }
      if (colNascIdx !== -1 && dataNascimento) {
        updates.push({ range: `'${nomeAba}'!${idxParaColunaA1(colNascIdx)}${numLinha}`, values: [[dataNascimento]] });
      }
    }

    if (!linhasAfetadas || !updates.length) {
      return { atualizado: false, motivo: 'Nenhuma linha encontrada para este CPF ou nenhum dado para atualizar' };
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      resource: { valueInputOption: 'USER_ENTERED', data: updates }
    });

    console.log(`✅ [GOOGLE SHEETS] Dados cadastrais atualizados em ${linhasAfetadas} linha(s) para CPF ${cpfBuscado}`);
    return { atualizado: true, linhasAfetadas };
  } catch (err) {
    console.error('❌ Erro ao atualizar dados cadastrais no Google Sheets:', err.message);
    return { atualizado: false, erro: err.message };
  }
}



