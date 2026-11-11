/**
 * Disparo em lote de notificações via WhatsApp (Zionic).
 *
 * Regra:
 *   Antes de enviar a mensagem, o sistema verifica a coluna T da planilha.
 *   Se estiver em branco, gera o link individual seguro e grava na planilha antes de disparar.
 *
 * Uso:
 *   node Zionic/dispararLote.js             -> Modo simulação (mostra o que seria gravado e enviado)
 *   node Zionic/dispararLote.js --enviar    -> Disparo real (grava na coluna T se necessário e envia pelo Zionic)
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { carregarSolicitacoes, gravarLinksNaPlanilha } from '../services/googleSheets.js';
import { montarMensagemCertificado } from './mensagemTemplate.js';
import { dispararMensagemAlunoZionic } from './zionicClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PUBLIC_FORM_URL = (process.env.PUBLIC_FORM_URL || 'https://certificadoies.com.br').replace(/\/+$/, '');
const LINK_SECRET = process.env.LINK_SECRET || 'dev-secret-change-in-production';
const DISPAROS_LOG_FILE = path.resolve(__dirname, '../data/disparos_whatsapp.json');

// Carrega histórico de disparos para evitar mensagens repetidas
function carregarHistoricoDisparos() {
  try {
    if (fs.existsSync(DISPAROS_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(DISPAROS_LOG_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('⚠️  Não foi possível ler histórico de disparos:', err.message);
  }
  return {};
}

function salvarHistoricoDisparos(historico) {
  try {
    const dir = path.dirname(DISPAROS_LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DISPAROS_LOG_FILE, JSON.stringify(historico, null, 2), 'utf8');
  } catch (err) {
    console.error('❌ Erro ao salvar histórico de disparos:', err.message);
  }
}

function gerarToken(cpf, dataReferencia) {
  return crypto
    .createHmac('sha256', LINK_SECRET)
    .update(`${cpf}|${dataReferencia}`)
    .digest('base64url')
    .slice(0, 22);
}

function parseDataBR(str) {
  if (!str) return null;
  const partes = String(str).split('/');
  if (partes.length !== 3) return null;
  const d = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
  return isNaN(d.getTime()) ? null : d;
}

export async function processarDisparoLote({ enviar = false, forcarReenvio = false } = {}) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID não configurado no .env');
  }

  console.log(`\n============================================================`);
  console.log(`🤖 DISPARO DE WHATSAPP VIA ZIONIC (LOTE)`);
  console.log(`Modo: ${enviar ? '🚀 ENVIO REAL' : '🔎 SIMULAÇÃO (use --enviar para disparar)'}`);
  console.log(`============================================================\n`);

  const res = await carregarSolicitacoes({ spreadsheetId });
  const todasLinhas = res.dados || [];

  // Agrupa solicitações por CPF
  const porCpf = new Map();
  for (const l of todasLinhas) {
    const cpf = String(l.cpf || '').replace(/\D/g, '');
    if (!cpf) continue;
    if (!porCpf.has(cpf)) porCpf.set(cpf, []);
    porCpf.get(cpf).push(l);
  }

  const historico = carregarHistoricoDisparos();
  const relatorio = {
    totalAlunos: porCpf.size,
    linksGravadosColunaT: 0,
    mensagensEnviadas: 0,
    mensagensSimuladas: 0,
    jaEnviadosIgnorados: 0,
    falhas: 0,
    detalhes: []
  };

  for (const [cpf, linhas] of porCpf) {
    const nome = linhas[0].nome || 'Aluno(a)';
    const telefone = linhas[0].telefone || '';
    const cursos = linhas.map((l) => l.curso).filter(Boolean);

    // Calcula token individual
    const datas = linhas.map((i) => parseDataBR(i.solicitacao)).filter(Boolean);
    const maisRecente = datas.length ? new Date(Math.max(...datas)) : new Date();
    const dataReferencia = maisRecente.toISOString().slice(0, 10);
    const token = gerarToken(cpf, dataReferencia);
    const urlEsperada = `${PUBLIC_FORM_URL}/solicitacoes/${token}`;

    // Link atual na coluna T
    let linkPlanilha = linhas.map((l) => l.link).find(Boolean) || '';
    const precisaGravarColunaT = !linkPlanilha || !linkPlanilha.startsWith(PUBLIC_FORM_URL);

    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`👤 ${nome} | CPF: ${cpf} | Tel: ${telefone || '(SEM TELEFONE)'}`);
    console.log(`📚 Cursos (${cursos.length}): ${cursos.join(' / ')}`);
    console.log(`🔗 Link Atual na Coluna T: ${linkPlanilha || '(EM BRANCO)'}`);

    if (precisaGravarColunaT) {
      console.log(`✍️  Coluna T precisa ser alimentada -> ${urlEsperada}`);
      if (enviar) {
        try {
          const grav = await gravarLinksNaPlanilha({
            spreadsheetId,
            itens: [{ cpf, url: urlEsperada }]
          });
          if (grav.sucesso) {
            linkPlanilha = urlEsperada;
            relatorio.linksGravadosColunaT++;
            console.log(`   ✅ Link gravado com sucesso na Coluna T.`);
          } else {
            console.warn(`   ⚠️  Não foi possível gravar na Coluna T: ${grav.motivo}`);
          }
        } catch (err) {
          console.error(`   ❌ Erro ao gravar Coluna T: ${err.message}`);
        }
      } else {
        linkPlanilha = urlEsperada;
        relatorio.linksGravadosColunaT++;
        console.log(`   🔎 [Simulação] Seria gravado na Coluna T.`);
      }
    }

    const urlFinal = linkPlanilha || urlEsperada;

    if (!telefone) {
      console.warn(`⚠️  Pulando aluno: Telefone ausente.`);
      relatorio.falhas++;
      relatorio.detalhes.push({ cpf, nome, status: 'SEM_TELEFONE' });
      continue;
    }

    // Verifica se já foi enviado anteriormente
    const jaEnviado = historico[cpf];
    if (jaEnviado && !forcarReenvio) {
      console.log(`ℹ️  Mensagem já enviada anteriormente em ${jaEnviado.dataEnvio} (Message ID: ${jaEnviado.messageId || 'N/A'}). Pulando.`);
      relatorio.jaEnviadosIgnorados++;
      relatorio.detalhes.push({ cpf, nome, status: 'JA_ENVIADO', messageId: jaEnviado.messageId });
      continue;
    }

    const mensagem = montarMensagemCertificado({
      nome,
      cursos,
      linkUrl: urlFinal
    });

    if (enviar) {
      console.log(`🚀 Disparando mensagem via WhatsApp Zionic...`);
      const resEnvio = await dispararMensagemAlunoZionic({
        nome,
        telefone,
        mensagem
      });

      if (resEnvio.sucesso) {
        console.log(`   ✅ Enviado com sucesso! Message ID: ${resEnvio.data?.id}`);
        relatorio.mensagensEnviadas++;
        historico[cpf] = {
          nome,
          telefone,
          linkUrl: urlFinal,
          cursos,
          messageId: resEnvio.data?.id,
          status: resEnvio.data?.status || 'sent',
          dataEnvio: new Date().toISOString()
        };
        salvarHistoricoDisparos(historico);
        relatorio.detalhes.push({ cpf, nome, status: 'ENVIADO', messageId: resEnvio.data?.id });
      } else {
        console.error(`   ❌ Falha ao enviar WhatsApp: ${resEnvio.erro}`);
        relatorio.falhas++;
        relatorio.detalhes.push({ cpf, nome, status: 'ERRO', erro: resEnvio.erro });
      }
    } else {
      console.log(`🔎 [Simulação] Mensagem pronta para disparo:`);
      console.log(`   "${mensagem.replace(/\n/g, ' ')}"`);
      relatorio.mensagensSimuladas++;
      relatorio.detalhes.push({ cpf, nome, status: 'SIMULADO', link: urlFinal });
    }
  }

  console.log(`\n============================================================`);
  console.log(`📊 RESUMO DO PROCESSAMENTO`);
  console.log(`Total de alunos: ${relatorio.totalAlunos}`);
  console.log(`Links alimentados na Coluna T: ${relatorio.linksGravadosColunaT}`);
  if (enviar) {
    console.log(`Mensagens enviadas via WhatsApp: ${relatorio.mensagensEnviadas}`);
  } else {
    console.log(`Mensagens simuladas: ${relatorio.mensagensSimuladas}`);
  }
  console.log(`Já enviados anteriormente (ignorados): ${relatorio.jaEnviadosIgnorados}`);
  console.log(`Falhas ou sem telefone: ${relatorio.falhas}`);
  console.log(`============================================================\n`);

  return relatorio;
}

// Execução direta via CLI
const isDirectRun = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isDirectRun) {
  const enviar = process.argv.includes('--enviar');
  const forcarReenvio = process.argv.includes('--forcar');
  processarDisparoLote({ enviar, forcarReenvio })
    .then((r) => process.exit(r.falhas > 0 && enviar ? 1 : 0))
    .catch((err) => {
      console.error('❌ Erro fatal:', err);
      process.exit(1);
    });
}
