import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
import { dispararMensagemAlunoZionic } from './Zionic/zionicClient.js';
import { executarReguaWhatsApp } from './Zionic/reguaWhatsApp.js';
import {
  montarMensagemCertificado,
  montarMensagemFormularioEnviado,
  montarMensagemCertificadoEmitido
} from './Zionic/mensagemTemplate.js';
import {
  carregarSolicitacoes,
  carregarSolicitacoesCanceladas,
  registrarRespostaNoSheet,
  atualizarStatusLyraNoSheet,
  atualizarDadosCadastraisAlunoNoSheet,
  inicializarGoogleAuth,
  gravarLinksNaPlanilha
} from './services/googleSheets.js';
import { criarCardAlunoSPA } from './services/bitrix24.js';
import { carregarRespostas, salvarRespostas } from './services/respostasStore.js';
import { carregarConfiguracoes, salvarConfiguracoes } from './services/configStore.js';
import { tipoCursoNoEscopo } from './services/escopo.js';
import { buscarCargaHoraria } from './services/cargaHoraria.js';
import {
  cancelarSolicitacaoLyra,
  emitirCertificadoLyra,
  consultarDadosAlunoLyraPorCpf
} from './services/lyra.js';
import {
  autenticarUsuario,
  criarTokenSessao,
  validarTokenSessao
} from './services/authUsuarios.js';
import {
  validarDataEvolucao17Meses,
  validarDataConclusao,
  mesesDoPeriodo
} from './src/utils/dateSuggestions.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper para descobrir o IP local da máquina na rede (Wi-Fi / Ethernet)
export function obterIpLocal() {
  const nets = os.networkInterfaces();
  let wifiIp = null;
  let ethIp = null;
  let fallbackIp = null;

  for (const name of Object.keys(nets)) {
    const nomeNorm = name.toLowerCase();
    const isVirtual =
      nomeNorm.includes('vmware') ||
      nomeNorm.includes('virtual') ||
      nomeNorm.includes('radmin') ||
      nomeNorm.includes('vbox') ||
      nomeNorm.includes('pseudo');

    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        // Ignora faixa 192.168.56.x (VirtualBox Host-Only Adapter)
        if (net.address.startsWith('192.168.56.')) continue;
        if (isVirtual) continue;

        if (nomeNorm.includes('wi-fi') || nomeNorm.includes('wifi') || nomeNorm.includes('wlan')) {
          wifiIp = net.address;
        } else if (nomeNorm.includes('ethernet') || nomeNorm.includes('eth')) {
          ethIp = net.address;
        } else if (!fallbackIp) {
          fallbackIp = net.address;
        }
      }
    }
  }

  return wifiIp || ethIp || fallbackIp || 'localhost';
}

const ipLocal = obterIpLocal();

// ============================================
// CONFIGURAÇÃO
// ============================================
const PORT = process.env.PORT || 3000;
const FRONTEND_PORT = process.env.FRONTEND_PORT || 5180;
// Segredo usado para assinar os links individuais
const LINK_SECRET_DEV = 'dev-secret-certificados-ies-2026';
let LINK_SECRET = process.env.LINK_SECRET;
if (!LINK_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ LINK_SECRET não configurado. Defina um segredo forte no .env antes de rodar em produção.');
    process.exit(1);
  }
  console.warn('⚠️  LINK_SECRET não configurado: usando segredo de desenvolvimento (não use em produção).');
  LINK_SECRET = LINK_SECRET_DEV;
}
// URL pública do formulário (se vazio ou localhost, adapta automaticamente para o IP da rede)
const PUBLIC_FORM_URL = (process.env.PUBLIC_FORM_URL || '').replace(/\/+$/, '');
// ID da planilha no Google Sheets (se vazio, usa a base local de forma transparente)
const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID || null;
// Modo somente leitura: a planilha é lida normalmente, mas o status EMITIR não é gravado nela (útil em testes locais)
const SHEET_SOMENTE_LEITURA = ['1', 'true', 'sim'].includes(String(process.env.GOOGLE_SHEET_SOMENTE_LEITURA || '').toLowerCase());
// Janela de agrupamento das solicitações em um único link (96 horas)
const JANELA_HORAS = 96;
// Atraso padrão de segurança antes da emissão automática no Lyra após o aluno preencher (120 minutos)
const ATRASO_EMISSAO_AUTO_MINUTOS = Math.max(0, Number(process.env.EMISSAO_AUTOMATICA_DELAY_MINUTOS ?? 120));
const ATRASO_EMISSAO_AUTO_MS = ATRASO_EMISSAO_AUTO_MINUTOS * 60 * 1000;

// Arquivo onde as respostas ficam salvas para sobreviver a reinícios (contém dados pessoais; fora do git)
const RESPOSTAS_FILE = process.env.RESPOSTAS_FILE
  ? path.resolve(process.env.RESPOSTAS_FILE)
  : (process.env.VERCEL
    ? path.join(os.tmpdir(), 'respostas.json')
    : path.join(__dirname, 'data', 'respostas.json'));

// Arquivo onde ficam salvas as configurações operacionais do painel (ex: interruptor de certificação automática)
const CONFIG_FILE = process.env.CONFIG_FILE
  ? path.resolve(process.env.CONFIG_FILE)
  : (process.env.VERCEL
    ? path.join(os.tmpdir(), 'config.json')
    : path.join(__dirname, 'data', 'config.json'));

const REDES_VALIDAS = ['particular', 'estadual', 'municipal'];

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'dist')));

// Garante que a base foi carregada antes de atender qualquer rota /api (essencial no Vercel serverless)
app.use(async (req, res, next) => {
  if (req.path.startsWith('/api')) {
    try {
      await garantirBaseCarregada();
    } catch (err) {
      console.warn('⚠️  Requisição /api recebida antes do término do carregamento da base:', err.message);
    }
  }
  next();
});

// ============================================
// HELPERS
// ============================================
// CPF sempre com 11 dígitos (a planilha perde zeros à esquerda)
const normalizarCpf = (cpf) => (cpf || '').toString().replace(/\D/g, '').padStart(11, '0');

const formatarCpf = (cpf) =>
  normalizarCpf(cpf).replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');

// "13/08/2026" ou "2026-08-13" -> Date
function parseDataBR(str) {
  if (!str) return null;
  const s = String(str).trim();
  // Formato BR: DD/MM/YYYY
  const mBR = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (mBR) return new Date(Number(mBR[3]), Number(mBR[2]) - 1, Number(mBR[1]));
  // Formato ISO: YYYY-MM-DD
  const mISO = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (mISO) return new Date(Number(mISO[1]), Number(mISO[2]) - 1, Number(mISO[3]));
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Token determinístico: o mesmo aluno + mesma janela gera sempre o mesmo link
function gerarToken(cpf, dataReferencia) {
  return crypto
    .createHmac('sha256', LINK_SECRET)
    .update(`${cpf}|${dataReferencia}`)
    .digest('base64url')
    .slice(0, 22);
}

// ============================================
// CARGA DA BASE (Google Sheets com fallback local)
// ============================================
const links = new Map();
const tokensCancelados = new Map();
const respostas = carregarRespostas(RESPOSTAS_FILE);
let configuracoesPainel = carregarConfiguracoes(CONFIG_FILE);
// Tokens com envio em andamento: impede dois envios simultâneos (duplo clique) de criar dois cards
const enviosEmAndamento = new Set();
// Tokens com emissão manual no Lyra em andamento: impede duplo clique no botão "Emitir"
const emissoesEmAndamento = new Set();
if (respostas.size) console.log(`💾 ${respostas.size} resposta(s) restaurada(s) de ${RESPOSTAS_FILE}.`);
console.log(`⚙️  Certificação automática no Lyra: ${configuracoesPainel.certificacaoAutomatica ? 'ATIVADA' : 'DESATIVADA (emissão manual pelo painel)'}`);

async function executarEmissaoCursosLyra({ link, cursosParaCertificar = [], jaEmitidos = [] }) {
  const resultados = [];
  let emitidosAgora = 0;

  for (const c of cursosParaCertificar) {
    const chaveCurso = String(c.contrato || c.curso || '').trim().toLowerCase();
    const previoOk = Array.isArray(jaEmitidos)
      ? jaEmitidos.find(
          (item) => item?.ok && String(item.contrato || item.curso || '').trim().toLowerCase() === chaveCurso
        )
      : null;

    if (previoOk) {
      resultados.push(previoOk);
      continue;
    }

    const dataInicio = c.dataInicioCustomizada || c.dataInicio || c.dataInicioISO || null;
    const dataFim = c.dataFimCustomizada || c.dataFim || c.dataFimISO || null;
    try {
      const resLyra = await emitirCertificadoLyra({
        cpf: link.cpf,
        nome: link.nome,
        curso: c.curso,
        contrato: c.contrato,
        dataInicio,
        dataFim,
      });
      resultados.push({
        curso: c.curso,
        contrato: c.contrato || null,
        ok: Boolean(resLyra.ok),
        notFound: Boolean(resLyra.notFound),
        solicitationId: resLyra.solicitationId || null,
        certificateId: resLyra.certificateId || null,
        bookRegistry: resLyra.bookRegistry || null,
        startDate: resLyra.startDate || null,
        endDate: resLyra.endDate || null,
        message: resLyra.message || null,
      });
      if (resLyra.ok) {
        emitidosAgora += 1;
        console.log(`🎓 [LYRA] Certificado emitido para ${link.nome} | ${c.curso} | ID: ${resLyra.solicitationId} | Cert: ${resLyra.certificateId || 'N/A'}`);
      } else {
        console.warn(`⚠️  [LYRA] Não foi possível emitir ${c.curso} (${link.nome}): ${resLyra.message}`);
      }
    } catch (err) {
      console.error(`❌ [LYRA] Erro ao emitir ${c.curso} (${link.nome}):`, err.message);
      resultados.push({
        curso: c.curso,
        contrato: c.contrato || null,
        ok: false,
        message: err.message,
      });
    }
  }

  const falhas = resultados.filter((e) => !e.ok);
  const todosEmitidos = cursosParaCertificar.length > 0 && falhas.length === 0;
  return { resultados, falhas, todosEmitidos, emitidosAgora };
}

async function notificarAlunoZionicSilencioso({ nome, telefone, mensagem, contexto }) {
  if (SHEET_SOMENTE_LEITURA) return;
  if (process.env.NODE_ENV === 'test') return;
  const temCredenciaisZionic = Boolean(
    (process.env.ZIONIC_BEARER_TOKEN && process.env.ZIONIC_BEARER_TOKEN.trim()) ||
    (process.env.ZIONIC_EMAIL && process.env.ZIONIC_PASSWORD)
  );
  if (!temCredenciaisZionic) return;

  const telLimpo = String(telefone || '').replace(/\D/g, '');
  if (telLimpo.length < 10) return;

  try {
    const res = await dispararMensagemAlunoZionic({
      nome: nome || 'Aluno(a)',
      telefone: telLimpo,
      mensagem
    });
    if (res?.sucesso) {
      console.log(`📱 [ZIONIC] Notificação (${contexto}) enviada para ${nome} (${telLimpo}). ID: ${res.data?.id || 'OK'}`);
    } else {
      console.warn(`⚠️  [ZIONIC] Falha na notificação (${contexto}) para ${nome}: ${res?.erro || 'erro desconhecido'}`);
    }
  } catch (err) {
    console.warn(`⚠️  [ZIONIC] Exceção na notificação (${contexto}) para ${nome}: ${err.message}`);
  }
}

let filaEmissaoRodando = false;
async function processarFilaEmissaoAutomatica() {
  if (filaEmissaoRodando) return { processados: 0, emitidos: 0, falhas: 0 };
  if (!configuracoesPainel.certificacaoAutomatica) return { processados: 0, emitidos: 0, falhas: 0 };
  if (SHEET_SOMENTE_LEITURA) return { processados: 0, emitidos: 0, falhas: 0 };
  if (!process.env.LYRA_EMAIL || !process.env.LYRA_PASSWORD) return { processados: 0, emitidos: 0, falhas: 0 };

  filaEmissaoRodando = true;
  let processados = 0;
  let emitidos = 0;
  let falhas = 0;

  try {
    await garantirBaseCarregada();
    const agoraMs = Date.now();

    for (const [token, reg] of respostas.entries()) {
      if (!reg || reg.emitidoNoLyra === true) continue;
      if (reg.emissaoModo !== 'AUTOMATICA_AGENDADA') continue;
      const agendadoMs = reg.emissaoAgendadaPara ? new Date(reg.emissaoAgendadaPara).getTime() : NaN;
      if (Number.isNaN(agendadoMs) || agoraMs < agendadoMs) continue;
      if (emissoesEmAndamento.has(token)) continue;

      const link = links.get(token);
      if (!link) continue;

      const listaPeriodos = Array.isArray(reg.periodosSugeridos) ? reg.periodosSugeridos : [];
      const cursosParaCertificar = listaPeriodos.length > 0
        ? listaPeriodos.filter((p) => !p.ultrapassaHoje && !p.cancelado)
        : (link.cursos || []);

      if (cursosParaCertificar.length === 0) {
        reg.emissaoModo = 'AUTOMATICA_SEM_CURSOS';
        salvarRespostas(RESPOSTAS_FILE, respostas);
        continue;
      }

      processados++;
      emissoesEmAndamento.add(token);
      try {
        const execLyra = await executarEmissaoCursosLyra({
          link,
          cursosParaCertificar,
          jaEmitidos: reg.emissaoLyra || []
        });

        const agoraFormatado = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const atualizado = {
          ...reg,
          emissaoLyra: execLyra.resultados,
          emitidoNoLyra: execLyra.todosEmitidos,
          aguardandoEmissaoManual: !execLyra.todosEmitidos,
          emissaoModo: execLyra.todosEmitidos ? 'AUTOMATICA' : 'AUTOMATICA_PENDENTE_REVISAO',
          ...(execLyra.todosEmitidos
            ? { emitidoEm: agoraFormatado, emitidoPor: `Automático (após ${ATRASO_EMISSAO_AUTO_MINUTOS} min)` }
            : {})
        };
        respostas.set(token, atualizado);
        salvarRespostas(RESPOSTAS_FILE, respostas);

        if (execLyra.todosEmitidos) {
          emitidos++;
          if (GOOGLE_SHEET_ID && !SHEET_SOMENTE_LEITURA) {
            try {
              await atualizarStatusLyraNoSheet({
                spreadsheetId: GOOGLE_SHEET_ID,
                cpf: link.cpf,
                statusLyra: 'Aprovado',
                dataModificacao: agoraFormatado
              });
            } catch (err) {
              console.warn(`⚠️  Erro ao atualizar colunas V/W após emissão agendada (${link.nome}): ${err.message}`);
            }
          }
          await notificarAlunoZionicSilencioso({
            nome: link.nome,
            telefone: link.telefone,
            mensagem: montarMensagemCertificadoEmitido({
              nome: link.nome,
              cursos: cursosParaCertificar,
              tipoImpressoStatus: link.tipoImpressoStatus || null
            }),
            contexto: 'certificado_emitido_auto'
          });
        } else {
          falhas++;
        }
      } catch (err) {
        falhas++;
        console.error(`❌ [LYRA AGENDADO] Erro ao processar token ${token}:`, err.message);
      } finally {
        emissoesEmAndamento.delete(token);
      }
    }
  } finally {
    filaEmissaoRodando = false;
  }

  return { processados, emitidos, falhas };
}
let totalSolicitacoes = 0;
let ultimaSincronizacaoMs = 0;
let statusIntegracao = {
  fonte: 'inicializando',
  clientEmail: null,
  sheetId: GOOGLE_SHEET_ID
};

async function carregarBase() {
  links.clear();
  tokensCancelados.clear();
  const res = await carregarSolicitacoes({ spreadsheetId: GOOGLE_SHEET_ID });
  const canceladas = await carregarSolicitacoesCanceladas({ spreadsheetId: GOOGLE_SHEET_ID });
  for (const [tok, info] of canceladas.tokensCancelados) {
    tokensCancelados.set(tok, info);
  }
  ultimaSincronizacaoMs = Date.now();
  // O formulário atende apenas Extensão e Aperfeiçoamento e gera link SOMENTE para solicitações Digitais.
  // Solicitações Impressas são preservadas em um mapa paralelo para escolher a mensagem pós-emissão correta.
  const todasLinhas = res.dados || [];
  const linhasEscopo = todasLinhas.filter((l) => tipoCursoNoEscopo(l.tipoCurso));
  const ehImpresso = (l) => String(l.tipoCertificado || '').trim().toLowerCase().includes('impresso');

  const impressoPorCpfCurso = new Map();
  for (const l of linhasEscopo) {
    if (!ehImpresso(l)) continue;
    const cpfImp = normalizarCpf(l.cpf);
    const cursoImp = String(l.curso || '').trim().toUpperCase();
    if (!cpfImp || !cursoImp) continue;
    const stLyraNorm = String(l.statusLyra || '').trim().toUpperCase();
    const tipoImp = stLyraNorm.includes('PAGAMENTO') ? 'AGUARDANDO_PAGAMENTO' : 'APROVADO';
    impressoPorCpfCurso.set(`${cpfImp}|${cursoImp}`, tipoImp);
  }

  const linhas = linhasEscopo.filter((l) => !ehImpresso(l));
  if (linhas.length < todasLinhas.length) {
    console.log(`ℹ️  ${todasLinhas.length - linhas.length} solicitação(ões) filtrada(s) (fora do escopo ou Impresso sem link ao aluno).`);
  }
  totalSolicitacoes = linhas.length;
  statusIntegracao = {
    fonte: res.fonte,
    clientEmail: res.clientEmail,
    sheetId: GOOGLE_SHEET_ID
  };


  // Agrupa por CPF
  const porCpf = new Map();
  for (const l of linhas) {
    const cpf = normalizarCpf(l.cpf);
    if (!cpf) continue;
    if (!porCpf.has(cpf)) porCpf.set(cpf, []);
    porCpf.get(cpf).push(l);
  }

  // Para cada aluno: link = solicitações ativas dentro da janela de 96h até a mais recente
  const ehCanceladoPlanilha = (i) => {
    const stForm = String(i.statusOriginal || '').trim().toUpperCase();
    const stLyra = String(i.statusLyra || '').trim().toUpperCase();
    return stForm === 'CANCELADO' || stForm === 'CANCELADO_96H' || stForm === 'CANCELADO MANUAL' || stForm === 'CANCELADO_MANUAL' || stLyra === 'CANCELADO';
  };

  // Solicitações importadas do Lyra já Aprovadas/Finalizadas sem resposta de formulário não devem entrar como pendentes em ENTRADA
  const ehAprovadoSemFormulario = (i) => {
    const stForm = String(i.statusOriginal || '').trim().toUpperCase();
    const stLyra = String(i.statusLyra || '').trim().toUpperCase();
    const temProto = String(i.protocolo || '').trim().length > 0;
    if (stForm === 'EMITIR' || temProto) return false;
    return stForm === 'APROVADO' || stForm === 'FINALIZADO' || stLyra === 'APROVADO' || stLyra === 'FINALIZADO';
  };

  for (const [cpf, todosItensRaw] of porCpf) {
    const todosItens = todosItensRaw.filter((i) => !ehAprovadoSemFormulario(i));
    if (todosItens.length === 0) continue;
    const itensAtivos = todosItens.filter((i) => !ehCanceladoPlanilha(i));
    const itens = itensAtivos.length > 0 ? itensAtivos : todosItens;

    const datas = itens.map((i) => parseDataBR(i.solicitacao)).filter(Boolean);
    const maisRecente = datas.length ? new Date(Math.max(...datas)) : new Date();
    const inicioJanela = new Date(maisRecente.getTime() - JANELA_HORAS * 3600 * 1000);

    const cursos = itens
      .filter((i) => {
        const d = parseDataBR(i.solicitacao);
        if (!d) return true;
        return d >= inicioJanela && d <= maisRecente;
      })
      .map((i) => ({
        curso: i.curso || 'Curso de Extensão',
        tipoCurso: i.tipoCurso || 'Extensão',
        certificadora: i.certificadora || 'Faculdade Certificadora',
        contrato: i.contrato || '',
        // Carga da planilha; se ausente, busca no catálogo do Lyra (vazio quando não há correspondência única)
        cargaHoraria: i.cargaHoraria || buscarCargaHoraria(i.tipoCurso, i.curso, i.certificadora) || '',
        solicitacao: i.solicitacao || ''
      }));

    // Dados pessoais exibidos no formulário: lidos diretamente da aba de solicitações ("Extensões e Aperfeiçoamentos")
    const primeiroPreenchido = (campo) => {
      const achado = itens.find((i) => i[campo] && String(i[campo]).trim().length > 0);
      return achado ? String(achado[campo]).trim() : '';
    };

    const dataReferencia = maisRecente.toISOString().slice(0, 10);
    const token = gerarToken(cpf, dataReferencia);

    // Verifica se algum dos cursos Digitais deste aluno possui solicitação Impressa vinculada
    let tipoImpressoStatus = null;
    for (const c of cursos) {
      const imp = impressoPorCpfCurso.get(`${cpf}|${String(c.curso || '').trim().toUpperCase()}`);
      if (imp === 'AGUARDANDO_PAGAMENTO') {
        tipoImpressoStatus = 'AGUARDANDO_PAGAMENTO';
        break;
      }
      if (imp === 'APROVADO') {
        tipoImpressoStatus = 'APROVADO';
      }
    }

    if (itensAtivos.length === 0 && !respostas.has(token)) {
      if (!tokensCancelados.has(token)) {
        tokensCancelados.set(token, {
          token,
          cpf,
          nome: itens[0].nome || 'Aluno(a)',
          dataCancelamento: primeiroPreenchido('modificacaoStatus') || '',
          motivo: 'Prazo de 96 horas expirado'
        });
      }
      continue;
    }

    const statusOriginalPlanilha = itens.some((i) =>
      String(i.statusOriginal || '').trim().toUpperCase() === 'EMITIR' ||
      String(i.protocolo || '').trim().length > 0
    ) ? 'EMITIR' : 'ENTRADA';
    const protocoloPlanilha = primeiroPreenchido('protocolo') || null;
    const inseridoPlanilhaEm = primeiroPreenchido('dataInsercao') || null;

    links.set(token, {
      token,
      cpf,
      nome: itens[0].nome || 'Aluno(a)',
      telefone: itens[0].telefone || '',
      dataNascimento: primeiroPreenchido('dataNascimento'),
      rg: primeiroPreenchido('rg'),
      naturalidade: primeiroPreenchido('naturalidade'),
      statusPlanilha: statusOriginalPlanilha,
      protocoloPlanilha,
      inseridoPlanilhaEm,
      // Link já gravado na coluna T da planilha (só vale se for deste mesmo token)
      linkPlanilha: ((itens.find((i) => i.link && String(i.link).endsWith(`/${token}`)) || {}).link) || '',
      dataReferencia,
      tipoImpressoStatus,
      cursos
    });

    // Se na planilha já consta como EMITIR ou com Protocolo preenchido, hidrata respostas em memória
    const aprovadoNaPlanilha = itens.some(
      (i) => String(i.statusLyra || '').trim().toUpperCase() === 'APROVADO'
    );
    if (!respostas.has(token) && statusOriginalPlanilha === 'EMITIR') {
      const respostaJsonRaw = primeiroPreenchido('respostaJson');
      let respostaHidratada = null;
      if (respostaJsonRaw) {
        try {
          respostaHidratada = JSON.parse(respostaJsonRaw);
        } catch {
          respostaHidratada = null;
        }
      }
      if (respostaHidratada && typeof respostaHidratada === 'object') {
        respostas.set(token, {
          ...respostaHidratada,
          protocolo: respostaHidratada.protocolo || protocoloPlanilha || 'EMITIR',
          statusBitrix: respostaHidratada.statusBitrix || 'EMITIR',
          ...(aprovadoNaPlanilha ? {
            emitidoNoLyra: true,
            aguardandoEmissaoManual: false,
            emitidoEm: respostaHidratada.emitidoEm || primeiroPreenchido('modificacaoStatus') || inseridoPlanilhaEm
          } : {})
        });
      } else {
        respostas.set(token, {
          protocolo: protocoloPlanilha || 'EMITIR',
          dataSubmissao: new Date().toISOString(),
          dataSubmissaoFormatada: inseridoPlanilhaEm || new Date().toLocaleString('pt-BR'),
          statusBitrix: 'EMITIR',
          origemPlanilha: true,
          ...(aprovadoNaPlanilha ? {
            emitidoNoLyra: true,
            aguardandoEmissaoManual: false,
            emitidoEm: primeiroPreenchido('modificacaoStatus') || inseridoPlanilhaEm
          } : {})
        });
      }
    } else if (respostas.has(token) && aprovadoNaPlanilha) {
      const respAtual = respostas.get(token);
      if (respAtual && respAtual.emitidoNoLyra !== true) {
        respAtual.emitidoNoLyra = true;
        respAtual.aguardandoEmissaoManual = false;
        if (!respAtual.emitidoEm) {
          respAtual.emitidoEm = primeiroPreenchido('modificacaoStatus') || inseridoPlanilhaEm;
        }
      }
    }
  }

  console.log(`📊 Base carregada [Fonte: ${statusIntegracao.fonte}]: ${totalSolicitacoes} solicitações → ${links.size} links individuais | ${tokensCancelados.size} cancelado(s) (96h).`);
}

// Recarrega a planilha sob demanda (com intervalo mínimo de 30s) quando um token não é encontrado em cache
async function sincronizarSeNecessario() {
  if (!GOOGLE_SHEET_ID) return;
  if (Date.now() - ultimaSincronizacaoMs < 30_000) return;
  try {
    await carregarBase();
  } catch (err) {
    console.warn('⚠️  Falha ao resincronizar base sob demanda:', err.message);
  }
}

let baseCarregandoPromise = null;

export function garantirBaseCarregada() {
  if (!baseCarregandoPromise) {
    baseCarregandoPromise = carregarBase().catch((err) => {
      console.error('❌ Falha ao carregar base de solicitações:', err);
      baseCarregandoPromise = null;
      throw err;
    });
  }
  return baseCarregandoPromise;
}

// Inicializa a carga assíncrona no startup
garantirBaseCarregada().catch(() => { });

// Monta o link para o aluno (suporta domínio de produção, IP local de rede ou host da requisição)
function montarUrl(token, req = null) {
  // Se houver domínio configurado no .env (diferente de localhost), usa ele
  if (PUBLIC_FORM_URL && !PUBLIC_FORM_URL.includes('localhost')) {
    return `${PUBLIC_FORM_URL}/solicitacoes/${token}`;
  }

  // Se a requisição veio de outro computador na rede pelo IP ou Vercel
  if (req) {
    const host = req.get('x-forwarded-host') || req.get('host');
    if (host) {
      const protocolo = req.get('x-forwarded-proto') || req.protocol || (process.env.VERCEL ? 'https' : 'http');
      // Ajusta porta do backend para o frontend no modo dev se necessário (no Vercel não há portas no host)
      const hostFrontend = host.includes(':') ? host.replace(`:${PORT}`, `:${FRONTEND_PORT}`) : host;
      return `${protocolo}://${hostFrontend}/solicitacoes/${token}`;
    }
  }

  // Fallback para o IP da máquina na rede local
  return `http://${ipLocal}:${FRONTEND_PORT}/solicitacoes/${token}`;
}

// Grava na coluna T da planilha o link individual de cada aluno (domínio oficial em PUBLIC_FORM_URL)
export async function sincronizarLinksNaPlanilha({ dryRun = false } = {}) {
  if (!PUBLIC_FORM_URL || PUBLIC_FORM_URL.includes('localhost')) {
    return { sucesso: false, motivo: 'PUBLIC_FORM_URL precisa apontar para o domínio oficial (não localhost).' };
  }
  if (!GOOGLE_SHEET_ID) return { sucesso: false, motivo: 'GOOGLE_SHEET_ID não configurado.' };
  await garantirBaseCarregada();
  const itens = [...links.values()].map((l) => ({ cpf: l.cpf, url: `${PUBLIC_FORM_URL}/solicitacoes/${l.token}` }));
  return gravarLinksNaPlanilha({
    spreadsheetId: GOOGLE_SHEET_ID,
    itens,
    dryRun: dryRun || SHEET_SOMENTE_LEITURA
  });
}

// ============================================
// ENDPOINTS DO ALUNO (acesso via link individual)
// ============================================

const MENSAGEM_EXPIRADO_96H = 'O prazo de 96 horas para preenchimento desta solicitação expirou e ela foi cancelada. Por favor, abra uma nova solicitação dentro do Portal do Aluno.';

// Dados do link: nome, CPF e cursos da janela de 24h
app.get('/api/link/:token', async (req, res) => {
  const token = req.params.token;
  if (!links.has(token) || tokensCancelados.has(token)) {
    await sincronizarSeNecessario();
  }

  const link = links.get(token);
  if (!link && tokensCancelados.has(token)) {
    return res.status(410).json({
      sucesso: false,
      cancelado: true,
      motivo: 'prazo_96h',
      mensagem: MENSAGEM_EXPIRADO_96H
    });
  }

  if (!link) {
    return res.status(404).json({ sucesso: false, mensagem: 'Link inválido ou expirado.' });
  }

  const resposta = respostas.get(link.token) || (link.statusPlanilha === 'EMITIR' ? {
    protocolo: link.protocoloPlanilha || 'EMITIR',
    dataSubmissaoFormatada: link.inseridoPlanilhaEm || null
  } : null);

  res.json({
    sucesso: true,
    dados: {
      nome: link.nome,
      cpf: formatarCpf(link.cpf),
      dataNascimento: link.dataNascimento,
      rg: link.rg,
      naturalidade: link.naturalidade,
      cursos: link.cursos,
      jaRespondido: !!resposta,
      protocolo: resposta?.protocolo || null,
      respondidoEm: resposta?.dataSubmissaoFormatada || null
    }
  });
});

// Atualiza de forma isolada os dados cadastrais do aluno no Lyra e na planilha Google Sheets
app.post('/api/link/:token/atualizar-dados', async (req, res) => {
  const token = req.params.token;
  if (!links.has(token) || tokensCancelados.has(token)) {
    await sincronizarSeNecessario();
  }

  const link = links.get(token);
  if (!link && tokensCancelados.has(token)) {
    return res.status(410).json({
      sucesso: false,
      cancelado: true,
      motivo: 'prazo_96h',
      mensagem: MENSAGEM_EXPIRADO_96H
    });
  }

  if (!link) {
    return res.status(404).json({ sucesso: false, mensagem: 'Link inválido ou expirado.' });
  }

  try {
    const dadosLyra = await consultarDadosAlunoLyraPorCpf(link.cpf);

    if (!SHEET_SOMENTE_LEITURA) {
      await atualizarDadosCadastraisAlunoNoSheet(dadosLyra);
    }

    if (dadosLyra.nome) link.nome = dadosLyra.nome;
    if (dadosLyra.telefone) link.telefone = dadosLyra.telefone;
    if (dadosLyra.rg !== undefined && dadosLyra.rg !== '') link.rg = dadosLyra.rg;
    if (dadosLyra.nacionalidade) link.naturalidade = dadosLyra.nacionalidade;
    if (dadosLyra.dataNascimento) link.dataNascimento = dadosLyra.dataNascimento;

    // Mantém em memória os demais links do mesmo aluno (CPF) em sincronia
    const soDigitos = (v) => String(v || '').replace(/\D/g, '');
    const cpfLink = soDigitos(link.cpf);
    for (const outro of links.values()) {
      if (outro !== link && soDigitos(outro.cpf) === cpfLink) {
        if (dadosLyra.nome) outro.nome = dadosLyra.nome;
        if (dadosLyra.telefone) outro.telefone = dadosLyra.telefone;
        if (dadosLyra.rg !== undefined && dadosLyra.rg !== '') outro.rg = dadosLyra.rg;
        if (dadosLyra.nacionalidade) outro.naturalidade = dadosLyra.nacionalidade;
        if (dadosLyra.dataNascimento) outro.dataNascimento = dadosLyra.dataNascimento;
      }
    }

    console.log(`🔄 [ATUALIZAR LINK] Dados cadastrais sincronizados no Lyra/Planilha para ${link.nome} (${formatarCpf(link.cpf)}).`);

    return res.json({
      sucesso: true,
      mensagem: 'Dados cadastrais atualizados com sucesso a partir do Portal do Aluno.',
      dados: {
        nome: link.nome,
        cpf: formatarCpf(link.cpf),
        dataNascimento: link.dataNascimento,
        rg: link.rg,
        naturalidade: link.naturalidade
      }
    });
  } catch (err) {
    console.error(`❌ [ATUALIZAR LINK] Erro ao sincronizar dados para CPF ${link.cpf}:`, err.message);
    return res.status(502).json({
      sucesso: false,
      mensagem: 'Não foi possível consultar os dados atualizados no Portal do Aluno no momento. Tente novamente em instantes.',
      detalhe: err.message
    });
  }
});

// Envio do formulário pelo aluno
app.post('/api/link/:token/resposta', async (req, res) => {
  const token = req.params.token;
  if (!links.has(token) || tokensCancelados.has(token)) {
    await sincronizarSeNecessario();
  }

  const link = links.get(token);
  if (!link && tokensCancelados.has(token)) {
    return res.status(410).json({
      sucesso: false,
      cancelado: true,
      motivo: 'prazo_96h',
      mensagem: MENSAGEM_EXPIRADO_96H
    });
  }

  if (!link) {
    return res.status(404).json({ sucesso: false, mensagem: 'Link inválido ou expirado.' });
  }

  if (respostas.has(link.token) || enviosEmAndamento.has(link.token) || link.statusPlanilha === 'EMITIR') {
    return res.status(409).json({
      sucesso: false,
      mensagem: 'Este formulário já foi enviado. Não é possível alterar após o envio.'
    });
  }

  // Reserva o token até a resposta HTTP terminar (sucesso ou erro de validação)
  enviosEmAndamento.add(link.token);
  res.on('close', () => enviosEmAndamento.delete(link.token));

  const { professor, rede, prefeituraSP, dataEvolucao, observacao, periodosSugeridos, confirmacao } = req.body || {};

  // Validações (espelham as regras do formulário)
  if (typeof professor !== 'boolean') {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe se você é professor(a).' });
  }
  if (professor && !REDES_VALIDAS.includes(rede)) {
    return res.status(400).json({ sucesso: false, mensagem: 'Informe a rede de ensino.' });
  }
  if (professor && rede === 'municipal') {
    if (typeof prefeituraSP !== 'boolean') {
      return res.status(400).json({ sucesso: false, mensagem: 'Informe se você atua na Prefeitura de SP.' });
    }
    // Prefeitura de SP / Rede Municipal: data da última evolução é OBRIGATÓRIA
    if (prefeituraSP && !/^\d{4}-\d{2}-\d{2}$/.test(dataEvolucao || '')) {
      return res.status(400).json({
        sucesso: false,
        mensagem: 'Informe a data da última evolução funcional.'
      });
    }
    // Outro município: data da evolução é OPCIONAL
    if (!prefeituraSP && dataEvolucao && !/^\d{4}-\d{2}-\d{2}$/.test(dataEvolucao)) {
      return res.status(400).json({ sucesso: false, mensagem: 'Data de evolução funcional inválida.' });
    }
  }

  // Defesa em profundidade: Se data de evolução foi informada, valida limite de 17 meses retroativos
  if (dataEvolucao) {
    const valEvolucao = validarDataEvolucao17Meses(dataEvolucao);
    if (!valEvolucao.valida) {
      return res.status(400).json({
        sucesso: false,
        mensagem: valEvolucao.erro || 'O período não pode ser contabilizado. Entre em contato com a Central de Atendimento, pelo telefone (11) 2074-5110, no setor de Emissão.'
      });
    }
  }

  if (confirmacao !== true) {
    return res.status(400).json({ sucesso: false, mensagem: 'É necessário confirmar que os dados estão corretos.' });
  }

  const listaPeriodos = Array.isArray(periodosSugeridos) ? periodosSugeridos : [];

  // Defesa em profundidade: Validação de datas customizadas em cursos não aceitos
  for (const p of listaPeriodos) {
    if (p && !p.cancelado && !p.ultrapassaHoje && (p.aceite === 'Não Aceito' || p.customizado === true)) {
      if (!p.dataFimCustomizada) {
        return res.status(400).json({
          sucesso: false,
          mensagem: `Informe a data de conclusão para o curso "${p.curso || 'selecionado'}".`
        });
      }
      // A duração do período vem da carga horária do curso no link (não do que o navegador enviou)
      const cursoDoLink = (link.cursos || []).find((c) => c.contrato && c.contrato === p.contrato) || (link.cursos || [])[(p.indice || 0) - 1] || {};
      const { meses } = mesesDoPeriodo(cursoDoLink.cargaHoraria, cursoDoLink.tipoCurso || p.tipoCurso);
      const valCustom = validarDataConclusao(p.dataFimCustomizada, new Date(), meses);
      if (!valCustom.valida) {
        return res.status(400).json({
          sucesso: false,
          mensagem: valCustom.erro || `Data customizada inválida para o curso "${p.curso || 'selecionado'}".`
        });
      }
      // Sobrescreve com o período recalculado no servidor
      p.dataInicioCustomizada = valCustom.dataInicioISO;
      p.dataFimCustomizada = valCustom.dataFimISO;
      p.dataInicioCustomizadaFormatada = valCustom.dataInicioFormatada;
      p.dataFimCustomizadaFormatada = valCustom.dataFimFormatada;
    }
  }

  // Identifica cursos customizados ("Não Aceito") para rotear revisão Bitrix24 SPA
  const cursosNaoAceitos = listaPeriodos.filter(
    (p) => !p.cancelado && !p.ultrapassaHoje && (p.aceite === 'Não Aceito' || p.customizado === true)
  );
  const temRevisao = cursosNaoAceitos.length > 0 || Boolean(typeof observacao === 'string' && observacao.trim());
  const resumoCustomizacao = cursosNaoAceitos.length > 0
    ? cursosNaoAceitos
      .map((c) => `• ${c.curso}: Início solicitado ${c.dataInicioCustomizadaFormatada || c.dataInicioFormatada} a ${c.dataFimCustomizadaFormatada || c.dataFimFormatada}`)
      .join('\n')
    : null;

  const stageEsperado = temRevisao
    ? (process.env.BITRIX24_SPA_STAGE_REVISAO || 'DT1046_76:PREPARATION')
    : (process.env.BITRIX24_SPA_STAGE_DEFAULT || 'DT1046_76:CLIENT');

  const agora = new Date();
  const registro = {
    protocolo: `CERT-${agora.getFullYear()}-${crypto.randomInt(100000, 999999)}`,
    dataSubmissao: agora.toISOString(),
    dataSubmissaoFormatada: agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    professor,
    rede: professor ? rede : null,
    prefeituraSP: professor && rede === 'municipal' ? prefeituraSP : null,
    dataEvolucao: professor && rede === 'municipal' && dataEvolucao ? dataEvolucao : null,
    observacao: typeof observacao === 'string' && observacao.trim() ? observacao.trim().slice(0, 1000) : null,
    periodosSugeridos: listaPeriodos,
    temRevisao,
    resumoCustomizacao,
    statusBitrix: 'EMITIR',
    bitrixCardId: null,
    bitrixStageId: stageEsperado
  };

  // Cursos que serão certificados (apenas cursos elegíveis / não cancelados)
  const cursosParaCertificar = (listaPeriodos.length > 0)
    ? listaPeriodos.filter((p) => !p.ultrapassaHoje && !p.cancelado)
    : (link.cursos || []);

  // Emissão no Lyra condicionada ao interruptor de Certificação Automática do painel (com janela de 120 min)
  registro.emissaoLyra = [];
  registro.emitidoNoLyra = false;
  registro.emissaoModo = configuracoesPainel.certificacaoAutomatica ? 'AUTOMATICA_AGENDADA' : 'MANUAL';
  registro.aguardandoEmissaoManual = !configuracoesPainel.certificacaoAutomatica && cursosParaCertificar.length > 0;

  if (!configuracoesPainel.certificacaoAutomatica) {
    console.log(`⏸️  [LYRA] Certificação automática DESATIVADA no painel: ${link.nome} aguarda clique em "Emitir" na coluna EMITIR.`);
  } else if (SHEET_SOMENTE_LEITURA) {
    registro.emissaoModo = 'MANUAL';
    registro.aguardandoEmissaoManual = cursosParaCertificar.length > 0;
    console.log('ℹ️  Planilha em modo somente leitura (GOOGLE_SHEET_SOMENTE_LEITURA): emissão automática no Lyra não executada.');
  } else if (cursosParaCertificar.length > 0 && ATRASO_EMISSAO_AUTO_MS > 0) {
    const agendadoEm = new Date(agora.getTime() + ATRASO_EMISSAO_AUTO_MS);
    registro.emissaoAgendadaPara = agendadoEm.toISOString();
    registro.emissaoAgendadaParaFormatada = agendadoEm.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    console.log(`⏱️  [LYRA] Emissão automática de ${link.nome} agendada para ${registro.emissaoAgendadaParaFormatada} (+${ATRASO_EMISSAO_AUTO_MINUTOS} min).`);
  } else if (process.env.LYRA_EMAIL && process.env.LYRA_PASSWORD && cursosParaCertificar.length > 0) {
    registro.emissaoModo = 'AUTOMATICA';
    const execLyra = await executarEmissaoCursosLyra({ link, cursosParaCertificar });
    registro.emissaoLyra = execLyra.resultados;
    registro.emitidoNoLyra = execLyra.todosEmitidos;
    registro.aguardandoEmissaoManual = !execLyra.todosEmitidos;
    if (execLyra.todosEmitidos) {
      registro.emitidoEm = registro.dataSubmissaoFormatada;
      registro.emitidoPor = 'Automático (Formulário)';
    }
  }

  const falhasLyra = registro.emissaoLyra.filter((e) => !e.ok);
  const avisoLyra = falhasLyra.length > 0
    ? falhasLyra.map((f) => `⚠️ Emissão automática no Lyra pendente (${f.curso}): ${f.message || 'Erro desconhecido'}`).join('\n')
    : null;
  const observacaoBitrix = [registro.observacao, avisoLyra].filter(Boolean).join('\n\n') || null;
  const temRevisaoBitrix = temRevisao || falhasLyra.length > 0;
  if (falhasLyra.length > 0) {
    registro.temRevisao = true;
    registro.bitrixStageId = process.env.BITRIX24_SPA_STAGE_REVISAO || 'DT1046_76:PREPARATION';
  }

  // Criação do card no Bitrix24 SPA (DT1046_76:CLIENT padrão, ou DT1046_76:PREPARATION com observação/revisão/pendência Lyra)
  try {
    const resBitrix = await criarCardAlunoSPA({
      nome: link.nome,
      observacao: observacaoBitrix,
      temRevisao: temRevisaoBitrix,
      resumoCustomizacao,
      cursos: cursosParaCertificar,
      protocolo: registro.protocolo
    });
    if (resBitrix.sucesso) {
      registro.bitrixCardId = resBitrix.id;
      registro.bitrixStageId = resBitrix.stageId || stageEsperado;
    } else if (resBitrix.stageId) {
      registro.bitrixStageId = resBitrix.stageId;
    }
  } catch (err) {
    console.error('❌ Erro inesperado ao criar card no Bitrix24 SPA:', err.message);
  }

  respostas.set(link.token, registro);
  try {
    salvarRespostas(RESPOSTAS_FILE, respostas);
  } catch (err) {
    console.error(`❌ Não foi possível salvar as respostas em ${RESPOSTAS_FILE}: ${err.message}`);
  }

  // Atualização no Google Sheets (se configurado e fora do modo somente leitura)
  // Aguarda a conclusão para garantir gravação em ambientes serverless (Vercel)
  if (SHEET_SOMENTE_LEITURA) {
    console.log('ℹ️  Planilha em modo somente leitura (GOOGLE_SHEET_SOMENTE_LEITURA): status EMITIR e protocolo não foram gravados.');
  } else {
    try {
      await registrarRespostaNoSheet({
        spreadsheetId: GOOGLE_SHEET_ID,
        token: link.token,
        resposta: registro,
        linkInfo: link
      });
    } catch (err) {
      console.error('Erro ao registrar resposta no Google Sheets:', err.message);
    }
  }

  console.log(`✅ [BITRIX24/PLANILHA] ${link.nome} (${formatarCpf(link.cpf)}) → ENTRADA ➜ EMITIR | ${registro.protocolo}${registro.bitrixCardId ? ` | Bitrix SPA ID: ${registro.bitrixCardId} (${registro.bitrixStageId})` : ''}`);

  // Disparo assíncrono de confirmação de recebimento do formulário (não bloqueia a resposta ao aluno)
  notificarAlunoZionicSilencioso({
    nome: link.nome,
    telefone: link.telefone,
    mensagem: montarMensagemFormularioEnviado({ nome: link.nome, cursos: cursosParaCertificar }),
    contexto: 'formulario_enviado'
  }).then(() => {
    if (registro.emitidoNoLyra) {
      return notificarAlunoZionicSilencioso({
        nome: link.nome,
        telefone: link.telefone,
        mensagem: montarMensagemCertificadoEmitido({
          nome: link.nome,
          cursos: cursosParaCertificar,
          tipoImpressoStatus: link.tipoImpressoStatus || null
        }),
        contexto: 'certificado_emitido_imediato'
      });
    }
  });

  res.json({
    sucesso: true,
    protocolo: registro.protocolo,
    respondidoEm: registro.dataSubmissaoFormatada,
    bitrixCardId: registro.bitrixCardId,
    bitrixStageId: registro.bitrixStageId,
    emissaoLyra: registro.emissaoLyra
  });
});

// ============================================
// AUTENTICAÇÃO DA EQUIPE (aba USUARIOS da planilha)
// ============================================

export function extrairTokenReq(req) {
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

export function middlewareAutenticacaoAdmin(req, res, next) {
  const cronSecret = String(req.headers['x-cron-secret'] || '').trim();
  if (cronSecret && cronSecret === LINK_SECRET) {
    return next();
  }

  const token = extrairTokenReq(req);
  if (token) {
    const usuario = validarTokenSessao(token, LINK_SECRET);
    if (usuario) {
      req.usuario = usuario;
      return next();
    }
  }

  // Compatibilidade com suíte de testes legada onde não há AUTH_STRICT
  if (process.env.NODE_ENV === 'test' && !process.env.AUTH_STRICT) {
    return next();
  }

  return res.status(401).json({
    sucesso: false,
    mensagem: 'Acesso restrito. Faça login para continuar.'
  });
}

// Login da equipe com credenciais da aba USUARIOS
app.post('/api/auth/login', async (req, res) => {
  const { login, senha } = req.body || {};
  try {
    const resultado = await autenticarUsuario(login, senha, { spreadsheetId: GOOGLE_SHEET_ID });
    if (!resultado.sucesso) {
      return res.status(401).json({
        sucesso: false,
        mensagem: resultado.motivo || 'Usuário ou senha incorretos.'
      });
    }

    const token = criarTokenSessao(resultado.usuario, LINK_SECRET);
    return res.json({
      sucesso: true,
      token,
      usuario: resultado.usuario
    });
  } catch (err) {
    console.error('❌ Erro na rota /api/auth/login:', err.message);
    return res.status(500).json({ sucesso: false, mensagem: 'Erro interno ao autenticar.' });
  }
});

// Verifica a sessão atual do usuário
app.get('/api/auth/me', (req, res) => {
  const token = extrairTokenReq(req);
  const usuario = token ? validarTokenSessao(token, LINK_SECRET) : null;
  if (!usuario) {
    return res.status(401).json({ sucesso: false, mensagem: 'Não autenticado.' });
  }
  return res.json({ sucesso: true, usuario });
});

// Logout da equipe
app.post('/api/auth/logout', (req, res) => {
  return res.json({ sucesso: true, mensagem: 'Logout efetuado com sucesso.' });
});

// ============================================
// ENDPOINTS DA EQUIPE (painel interno)
// ============================================

// Status da integração e estatísticas gerais
app.get('/api/estatisticas', middlewareAutenticacaoAdmin, (req, res) => {
  let respondidos = 0;
  for (const l of links.values()) {
    if (respostas.has(l.token) || l.statusPlanilha === 'EMITIR') {
      respondidos++;
    }
  }
  res.json({
    sucesso: true,
    dados: {
      totalSolicitacoes,
      totalLinks: links.size,
      totalRespondidos: respondidos,
      totalPendentes: Math.max(0, links.size - respondidos),
      integracao: statusIntegracao,
      configuracoes: configuracoesPainel
    }
  });
});

// Consulta e atualização das configurações do painel (ex: interruptor de certificação automática)
app.get('/api/configuracoes', middlewareAutenticacaoAdmin, (req, res) => {
  return res.json({
    sucesso: true,
    dados: configuracoesPainel
  });
});

const atualizarConfiguracoesHandler = (req, res) => {
  const { certificacaoAutomatica } = req.body || {};
  if (typeof certificacaoAutomatica !== 'boolean') {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'O campo "certificacaoAutomatica" deve ser booleano (true ou false).'
    });
  }

  const operador = req.usuario?.nome || req.usuario?.login || 'Painel Administrativo';
  configuracoesPainel = {
    ...configuracoesPainel,
    certificacaoAutomatica,
    atualizadoEm: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    atualizadoPor: operador
  };

  try {
    salvarConfiguracoes(CONFIG_FILE, configuracoesPainel);
  } catch (err) {
    console.error(`❌ Erro ao salvar configurações em ${CONFIG_FILE}: ${err.message}`);
  }

  console.log(`⚙️  [CONFIG PAINEL] Certificação automática ${certificacaoAutomatica ? 'ATIVADA' : 'DESATIVADA'} por ${operador}.`);

  return res.json({
    sucesso: true,
    dados: configuracoesPainel,
    mensagem: certificacaoAutomatica
      ? 'Certificação automática ativada! Novos formulários preenchidos serão emitidos automaticamente no Lyra.'
      : 'Certificação automática desativada! Novos formulários preenchidos aguardarão clique em "Emitir" no card.'
  });
};

app.put('/api/configuracoes', middlewareAutenticacaoAdmin, atualizarConfiguracoesHandler);
app.post('/api/configuracoes', middlewareAutenticacaoAdmin, atualizarConfiguracoesHandler);

// Sincroniza a base (recarrega do Google Sheets ou base local)
app.all('/api/sincronizar', middlewareAutenticacaoAdmin, async (req, res) => {
  try {
    await carregarBase();
    res.json({
      sucesso: true,
      mensagem: `Base sincronizada via ${statusIntegracao.fonte}!`,
      totalSolicitacoes,
      totalLinks: links.size,
      integracao: statusIntegracao
    });
  } catch (err) {
    res.status(500).json({ sucesso: false, mensagem: err.message });
  }
});

// Cancela solicitações expiradas (96h) no Lyra via chamada autenticada do Google Apps Script
app.post('/api/lyra/cancelar-expirados', async (req, res) => {
  const authHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = String(req.headers['x-cron-secret'] || authHeader || '').trim();

  if (!cronSecret || cronSecret !== LINK_SECRET) {
    return res.status(401).json({ sucesso: false, mensagem: 'Não autorizado.' });
  }

  const payload = req.body || {};
  const itens = Array.isArray(payload.itens)
    ? payload.itens
    : Array.isArray(payload)
      ? payload
      : [payload];

  if (itens.length === 0) {
    return res.status(400).json({ sucesso: false, mensagem: 'Nenhum item informado para cancelamento.' });
  }

  const resultados = [];
  for (let i = 0; i < itens.length; i += 1) {
    const item = itens[i] || {};
    const cpfItem = String(item.cpf || '').replace(/\D/g, '');
    const jaRespondido = cpfItem
      ? [...links.values()].some(
          (l) => String(l.cpf || '').replace(/\D/g, '') === cpfItem && (respostas.has(l.token) || enviosEmAndamento.has(l.token)),
        )
      : false;

    if (jaRespondido) {
      resultados.push({
        index: i,
        cpf: item.cpf || null,
        curso: item.curso || null,
        ok: false,
        alreadyAnswered: true,
        message: 'Aluno já respondeu ao formulário; cancelamento no Lyra bloqueado para evitar conflito.',
      });
      continue;
    }

    try {
      const resultado = await cancelarSolicitacaoLyra({
        solicitationId: item.solicitationId,
        cpf: item.cpf,
        nome: item.nome,
        curso: item.curso,
        contrato: item.contrato,
        reason: item.reason,
      });
      resultados.push({
        index: i,
        cpf: item.cpf || null,
        curso: item.curso || null,
        ...resultado,
      });
    } catch (err) {
      resultados.push({
        index: i,
        cpf: item.cpf || null,
        curso: item.curso || null,
        ok: false,
        message: err.message,
      });
    }
  }

  return res.json({
    sucesso: true,
    total: resultados.length,
    resultados,
  });
});

app.get('/api/solicitacoes', middlewareAutenticacaoAdmin, (req, res) => {
  const dados = [...links.values()].map((l) => {
    const r = respostas.get(l.token);
    const estaEmitir = Boolean(r) || l.statusPlanilha === 'EMITIR';
    return {
      token: l.token,
      link: montarUrl(l.token, req),
      nome: l.nome,
      cpf: formatarCpf(l.cpf),
      telefone: l.telefone,
      dataReferencia: l.dataReferencia,
      cursos: l.cursos,
      status: estaEmitir ? 'EMITIR' : 'ENTRADA',
      resposta: r || (l.statusPlanilha === 'EMITIR' ? {
        protocolo: l.protocoloPlanilha || 'EMITIR',
        dataSubmissaoFormatada: l.inseridoPlanilhaEm || null,
        statusBitrix: 'EMITIR',
        origemPlanilha: true
      } : null)
    };
  });
  res.json({
    sucesso: true,
    total: dados.length,
    integracao: statusIntegracao,
    configuracoes: configuracoesPainel,
    ipLocal,
    dados
  });
});

// Emissão manual no Lyra acionada pelo botão "Emitir" no card do aluno na coluna EMITIR
app.post('/api/solicitacoes/:token/emitir', middlewareAutenticacaoAdmin, async (req, res) => {
  const token = req.params.token;
  let link = links.get(token);
  if (!link) {
    await sincronizarSeNecessario();
    link = links.get(token);
  }
  if (!link) {
    return res.status(404).json({ sucesso: false, mensagem: 'Solicitação não encontrada.' });
  }

  const registroAtual = respostas.get(token);
  if (!registroAtual && link.statusPlanilha !== 'EMITIR') {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'Este aluno ainda não preencheu o formulário de confirmação.'
    });
  }

  if (registroAtual?.emitidoNoLyra === true) {
    return res.status(409).json({
      sucesso: false,
      mensagem: 'Os certificados deste aluno já foram emitidos no Lyra.'
    });
  }

  if (emissoesEmAndamento.has(token)) {
    return res.status(409).json({
      sucesso: false,
      mensagem: 'A emissão deste aluno já está em andamento. Aguarde alguns instantes.'
    });
  }

  if (SHEET_SOMENTE_LEITURA) {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'Ambiente em modo somente leitura (GOOGLE_SHEET_SOMENTE_LEITURA): emissão no Lyra bloqueada.'
    });
  }

  if (!process.env.LYRA_EMAIL || !process.env.LYRA_PASSWORD) {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'Credenciais do Lyra (LYRA_EMAIL / LYRA_PASSWORD) não estão configuradas no servidor.'
    });
  }

  const listaPeriodos = Array.isArray(registroAtual?.periodosSugeridos) ? registroAtual.periodosSugeridos : [];
  const cursosParaCertificar = listaPeriodos.length > 0
    ? listaPeriodos.filter((p) => !p.ultrapassaHoje && !p.cancelado)
    : (link.cursos || []);

  if (cursosParaCertificar.length === 0) {
    return res.status(400).json({
      sucesso: false,
      mensagem: 'Nenhum curso elegível para emissão (cursos cancelados por data futura ou lista vazia).'
    });
  }

  emissoesEmAndamento.add(token);
  res.on('close', () => emissoesEmAndamento.delete(token));

  try {
    const execLyra = await executarEmissaoCursosLyra({
      link,
      cursosParaCertificar,
      jaEmitidos: registroAtual?.emissaoLyra || []
    });

    const agoraFormatado = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const operador = req.usuario?.nome || req.usuario?.login || 'Painel Administrativo';

    const baseRegistro = registroAtual || {
      protocolo: link.protocoloPlanilha || 'EMITIR',
      dataSubmissao: new Date().toISOString(),
      dataSubmissaoFormatada: link.inseridoPlanilhaEm || agoraFormatado,
      statusBitrix: 'EMITIR',
      origemPlanilha: true
    };

    const registroAtualizado = {
      ...baseRegistro,
      emissaoLyra: execLyra.resultados,
      emitidoNoLyra: execLyra.todosEmitidos,
      aguardandoEmissaoManual: !execLyra.todosEmitidos,
      ...(execLyra.todosEmitidos
        ? { emitidoEm: agoraFormatado, emitidoPor: operador }
        : {})
    };

    respostas.set(token, registroAtualizado);
    try {
      salvarRespostas(RESPOSTAS_FILE, respostas);
    } catch (err) {
      console.error(`❌ Erro ao salvar resposta após emissão manual (${RESPOSTAS_FILE}): ${err.message}`);
    }

    if (execLyra.todosEmitidos && GOOGLE_SHEET_ID && !SHEET_SOMENTE_LEITURA) {
      try {
        await atualizarStatusLyraNoSheet({
          spreadsheetId: GOOGLE_SHEET_ID,
          cpf: link.cpf,
          statusLyra: 'Aprovado',
          dataModificacao: agoraFormatado
        });
      } catch (err) {
        console.warn(`⚠️  Não foi possível atualizar colunas V/W no Google Sheets após emissão manual: ${err.message}`);
      }
    }

    if (!execLyra.todosEmitidos) {
      const msgFalha = execLyra.falhas.map((f) => `${f.curso}: ${f.message || 'Falha no Lyra'}`).join(' | ');
      return res.status(200).json({
        sucesso: false,
        parcial: execLyra.emitidosAgora > 0,
        mensagem: `Não foi possível concluir todos os cursos no Lyra (${msgFalha}).`,
        emissaoLyra: execLyra.resultados,
        resposta: registroAtualizado
      });
    }

    // Disparo assíncrono avisando o aluno que o certificado foi emitido e está no portal
    notificarAlunoZionicSilencioso({
      nome: link.nome,
      telefone: link.telefone,
      mensagem: montarMensagemCertificadoEmitido({
        nome: link.nome,
        cursos: cursosParaCertificar,
        tipoImpressoStatus: link.tipoImpressoStatus || null
      }),
      contexto: 'certificado_emitido_manual'
    });

    return res.json({
      sucesso: true,
      mensagem: `Certificado(s) de ${link.nome} emitido(s) com sucesso no Lyra!`,
      emissaoLyra: execLyra.resultados,
      resposta: registroAtualizado
    });
  } catch (err) {
    console.error(`❌ Erro inesperado na emissão manual de ${link.nome}:`, err);
    return res.status(500).json({
      sucesso: false,
      mensagem: `Erro ao emitir no Lyra: ${err.message}`
    });
  } finally {
    emissoesEmAndamento.delete(token);
  }
});

// Disparo WhatsApp via Zionic com IA (com suporte a fallback simulado)
app.post('/api/notificacoes/whatsapp', middlewareAutenticacaoAdmin, async (req, res) => {
  const link = links.get(req.body?.token);
  if (!link) return res.status(404).json({ sucesso: false, mensagem: 'Link não encontrado.' });

  let url = link.linkPlanilha;
  // Se a coluna T ainda não estiver preenchida para esse aluno, grava na planilha antes do disparo
  if (!url) {
    url = montarUrl(link.token, req);
    if (GOOGLE_SHEET_ID && !SHEET_SOMENTE_LEITURA) {
      try {
        const gravacao = await gravarLinksNaPlanilha({
          spreadsheetId: GOOGLE_SHEET_ID,
          itens: [{ cpf: link.cpf, url }]
        });
        if (gravacao.sucesso) {
          link.linkPlanilha = url;
          console.log(`✍️ [COLUNA T] Link gravado automaticamente na planilha para ${link.nome} (CPF ${link.cpf}) antes do disparo.`);
        }
      } catch (err) {
        console.warn(`⚠️ [COLUNA T] Falha ao gravar link na planilha antes do disparo: ${err.message}`);
      }
    }
  }
  const textoMensagem = montarMensagemCertificado({
    nome: link.nome,
    cursos: link.cursos,
    linkUrl: url
  });

  const simular = Boolean(req.body?.simular) || !process.env.ZIONIC_BEARER_TOKEN;

  if (simular) {
    console.log(`📱 [ZIONIC SIMULADO] ${link.nome} (${link.telefone}) → ${url}`);
    return res.json({
      sucesso: true,
      simulado: true,
      mensagem: 'Notificação simulada com sucesso.',
      linkEnviado: url,
      textoMensagem
    });
  }

  try {
    const resZionic = await dispararMensagemAlunoZionic({
      nome: link.nome,
      telefone: link.telefone,
      mensagem: textoMensagem
    });

    if (!resZionic.sucesso) {
      return res.status(500).json({
        sucesso: false,
        mensagem: resZionic.erro || 'Falha ao enviar mensagem pelo Zionic.',
        detalhes: resZionic
      });
    }

    res.json({
      sucesso: true,
      mensagem: 'Notificação enviada com sucesso via WhatsApp (Zionic).',
      linkEnviado: url,
      messageId: resZionic.data?.id,
      status: resZionic.data?.status,
      textoMensagem
    });
  } catch (err) {
    console.error('❌ [ZIONIC] Erro ao disparar mensagem:', err.message);
    res.status(500).json({ sucesso: false, mensagem: err.message });
  }
});


// Acionador da fila de emissão automática (útil para cron externo / Vercel ou processamento sob demanda)
app.all('/api/cron/emissao-automatica', middlewareAutenticacaoAdmin, async (req, res) => {
  try {
    const resultado = await processarFilaEmissaoAutomatica();
    return res.json({ sucesso: true, ...resultado });
  } catch (err) {
    return res.status(500).json({ sucesso: false, mensagem: err.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    ipLocal,
    integracao: statusIntegracao,
    timestamp: new Date().toISOString()
  });
});

// SPA fallback (produção) — rotas não-API servem o index do build
app.get(/^(?!\/api).*/, (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  res.status(404).send('Build não encontrado. Rode "npm run build" ou use "npm start" para desenvolvimento.');
});

const isDirectRun = !process.env.VERCEL;

if (isDirectRun) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n========================================================`);
    console.log(`🚀 SERVIDOR ATIVO E ACESSÍVEL NA REDE LOCAL (LAN)!`);
    console.log(`========================================================`);
    console.log(`💻 Neste Computador (Host):`);
    console.log(`   ➔ Painel da Equipe:  http://localhost:${FRONTEND_PORT}`);
    console.log(`   ➔ API Backend:       http://localhost:${PORT}`);
    console.log(`\n📱 Em Outro PC (Sala de Reunião / Celular):`);
    console.log(`   ➔ Painel da Gestão:  http://${ipLocal}:${FRONTEND_PORT}`);
    console.log(`   ➔ Link de Aluno:     http://${ipLocal}:${FRONTEND_PORT}/solicitacoes/<token>`);
    console.log(`\n📊 Fonte de Dados:      ${statusIntegracao.fonte}`);
    if (statusIntegracao.clientEmail) {
      console.log(`🔐 Google Service:     ${statusIntegracao.clientEmail}`);
    }
    console.log(`========================================================\n`);
  });

  // Verifica periodicamente (a cada 30s) emissões automáticas que atingiram a janela de 120 minutos
  const intervaloFilaMs = Math.max(500, Number(process.env.FILA_EMISSAO_INTERVALO_MS || 30000));
  setInterval(() => {
    processarFilaEmissaoAutomatica().catch((err) => {
      console.error('❌ Erro no loop da fila de emissão automática:', err.message);
    });
  }, intervaloFilaMs).unref();

  // Executa a Régua de WhatsApp (Zionic) automaticamente a cada 1 hora no servidor,
  // mantendo o intervalo anti-bloqueio de 60s entre disparos e limite de 45 por ciclo.
  if (process.env.NODE_ENV !== 'test' && process.env.DESABILITAR_REGUA_AUTO !== 'true') {
    let reguaWhatsAppEmAndamento = false;
    const executarReguaAgendada = async () => {
      if (SHEET_SOMENTE_LEITURA || !GOOGLE_SHEET_ID) return;
      if (reguaWhatsAppEmAndamento) {
        console.log('⏭️  [RÉGUA 1H] Execução anterior ainda em andamento; pulando ciclo.');
        return;
      }
      reguaWhatsAppEmAndamento = true;
      try {
        await executarReguaWhatsApp({
          enviar: true,
          intervaloSegundos: Number(process.env.INTERVALO_DISPARO_SEGUNDOS || 60),
          limiteDisparos: Number(process.env.LIMITE_DISPAROS_POR_EXECUCAO || 45),
          spreadsheetId: GOOGLE_SHEET_ID
        });
      } catch (err) {
        console.error('❌ [RÉGUA 1H] Erro na execução agendada:', err.message);
      } finally {
        reguaWhatsAppEmAndamento = false;
      }
    };

    const intervaloReguaMs = Math.max(60_000, Number(process.env.REGUA_INTERVALO_MS || 60 * 60 * 1000));
    setTimeout(() => {
      executarReguaAgendada();
    }, 60_000).unref();
    setInterval(() => {
      executarReguaAgendada();
    }, intervaloReguaMs).unref();
    console.log(`⏰ [RÉGUA 1H] Agendamento automático ativo no servidor (a cada ${Math.round(intervaloReguaMs / 60000)} min).`);
  }
}

export { app, carregarBase };
export default app;
