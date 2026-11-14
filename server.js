import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';
import dotenv from 'dotenv';
import { dispararMensagemAlunoZionic } from './Zionic/zionicClient.js';
import { montarMensagemCertificado } from './Zionic/mensagemTemplate.js';
import {
  carregarSolicitacoes,
  carregarSolicitacoesCanceladas,
  registrarRespostaNoSheet,
  inicializarGoogleAuth,
  gravarLinksNaPlanilha
} from './services/googleSheets.js';
import { criarCardAlunoSPA } from './services/bitrix24.js';
import { carregarRespostas, salvarRespostas } from './services/respostasStore.js';
import { tipoCursoNoEscopo } from './services/escopo.js';
import { buscarCargaHoraria } from './services/cargaHoraria.js';
import { cancelarSolicitacaoLyra, emitirCertificadoLyra } from './services/lyra.js';
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
// Janela de agrupamento das solicitações em um único link (24 horas)
const JANELA_HORAS = 96;

// Arquivo onde as respostas ficam salvas para sobreviver a reinícios (contém dados pessoais; fora do git)
const RESPOSTAS_FILE = process.env.RESPOSTAS_FILE
  ? path.resolve(process.env.RESPOSTAS_FILE)
  : (process.env.VERCEL
    ? path.join(os.tmpdir(), 'respostas.json')
    : path.join(__dirname, 'data', 'respostas.json'));

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
// Tokens com envio em andamento: impede dois envios simultâneos (duplo clique) de criar dois cards
const enviosEmAndamento = new Set();
if (respostas.size) console.log(`💾 ${respostas.size} resposta(s) restaurada(s) de ${RESPOSTAS_FILE}.`);
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
  // O formulário atende apenas Extensão e Aperfeiçoamento: demais tipos são ignorados
  const todasLinhas = res.dados || [];
  const linhas = todasLinhas.filter((l) => tipoCursoNoEscopo(l.tipoCurso));
  if (linhas.length < todasLinhas.length) {
    console.log(`ℹ️  ${todasLinhas.length - linhas.length} solicitação(ões) ignorada(s) por tipo de curso fora do escopo (apenas Extensão e Aperfeiçoamento).`);
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

  // Para cada aluno: link = solicitações dentro da janela de 96h até a mais recente
  for (const [cpf, itens] of porCpf) {
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

    links.set(token, {
      token,
      cpf,
      nome: itens[0].nome || 'Aluno(a)',
      telefone: itens[0].telefone || '',
      dataNascimento: primeiroPreenchido('dataNascimento'),
      rg: primeiroPreenchido('rg'),
      naturalidade: primeiroPreenchido('naturalidade'),
      // Link já gravado na coluna T da planilha (só vale se for deste mesmo token)
      linkPlanilha: ((itens.find((i) => i.link && String(i.link).endsWith(`/${token}`)) || {}).link) || '',
      dataReferencia,
      cursos
    });
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

  const resposta = respostas.get(link.token) || null;

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

  if (respostas.has(link.token) || enviosEmAndamento.has(link.token)) {
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

  // Emissão automática no Lyra com as datas aprovadas para cada curso
  registro.emissaoLyra = [];
  if (SHEET_SOMENTE_LEITURA) {
    console.log('ℹ️  Planilha em modo somente leitura (GOOGLE_SHEET_SOMENTE_LEITURA): emissão automática no Lyra não executada.');
  } else if (process.env.LYRA_EMAIL && process.env.LYRA_PASSWORD) {
    for (const c of cursosParaCertificar) {
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
        registro.emissaoLyra.push({
          curso: c.curso,
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
          console.log(`🎓 [LYRA] Certificado emitido para ${link.nome} | ${c.curso} | ID: ${resLyra.solicitationId} | Cert: ${resLyra.certificateId || 'N/A'}`);
        } else {
          console.warn(`⚠️  [LYRA] Não foi possível emitir ${c.curso} (${link.nome}): ${resLyra.message}`);
        }
      } catch (err) {
        console.error(`❌ [LYRA] Erro ao emitir ${c.curso} (${link.nome}):`, err.message);
        registro.emissaoLyra.push({
          curso: c.curso,
          ok: false,
          message: err.message,
        });
      }
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
// ENDPOINTS DA EQUIPE (painel interno)
// ============================================

// Status da integração e estatísticas gerais
app.get('/api/estatisticas', (req, res) => {
  res.json({
    sucesso: true,
    dados: {
      totalSolicitacoes,
      totalLinks: links.size,
      totalRespondidos: respostas.size,
      totalPendentes: links.size - respostas.size,
      integracao: statusIntegracao
    }
  });
});

// Sincroniza a base (recarrega do Google Sheets ou base local)
app.all('/api/sincronizar', async (req, res) => {
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

app.get('/api/solicitacoes', (req, res) => {
  const dados = [...links.values()].map((l) => {
    const r = respostas.get(l.token);
    return {
      token: l.token,
      link: montarUrl(l.token, req),
      nome: l.nome,
      cpf: formatarCpf(l.cpf),
      telefone: l.telefone,
      dataReferencia: l.dataReferencia,
      cursos: l.cursos,
      status: r ? 'EMITIR' : 'ENTRADA',
      resposta: r || null
    };
  });
  res.json({
    sucesso: true,
    total: dados.length,
    integracao: statusIntegracao,
    ipLocal,
    dados
  });
});

// Disparo WhatsApp via Zionic com IA (com suporte a fallback simulado)
app.post('/api/notificacoes/whatsapp', async (req, res) => {
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
}

export { app, carregarBase };
export default app;
