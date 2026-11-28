/**
 * Régua Automatizada de Notificações via WhatsApp (Zionic)
 *
 * Etapas da Régua:
 * 1. D0 (Boas-vindas): Disparo imediato com o link seguro de 96h ao entrar na planilha.
 * 2. Lembrete Diário: 1 lembrete a cada 24 horas enquanto o status for pendente (não emitido).
 * 3. Alerta Crítico (2h): Aviso urgente quando restarem 2 horas para expirar o prazo de 96h.
 * 4. Expirado (96h): Aviso institucional informando que o prazo expirou e orientando nova solicitação no portal.
 *
 * Proteção Anti-Bloqueio WhatsApp:
 * - Intervalo de 60 segundos obrigatório entre cada mensagem enviada (configurável via INTERVALO_DISPARO_SEGUNDOS).
 *
 * Persistência Multi-Ambiente:
 * - Grava status e timestamp diretamente nas colunas V, W, X da planilha Google Sheets
 *   e mantém cache de segurança em data/disparos_whatsapp.json.
 *
 * Uso CLI:
 *   node Zionic/reguaWhatsApp.js             -> Modo simulação (Dry-Run seguro)
 *   node Zionic/reguaWhatsApp.js --enviar    -> Execução real com envios via Zionic
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  carregarSolicitacoes,
  gravarLinksNaPlanilha,
  gravarStatusWhatsAppNaPlanilha
} from '../services/googleSheets.js';
import { tipoCursoNoEscopo } from '../services/escopo.js';
import {
  montarMensagemCertificado,
  montarMensagemLembreteDiario,
  montarMensagemAlerta2Horas,
  montarMensagemExpirado,
  montarMensagemCertificadoEmitido
} from './mensagemTemplate.js';
import { dispararMensagemAlunoZionic } from './zionicClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PUBLIC_FORM_URL = (process.env.PUBLIC_FORM_URL || 'https://certificadoies.com.br').replace(/\/+$/, '');
const LINK_SECRET = process.env.LINK_SECRET || 'dev-secret-certificados-ies-2026';
const DISPAROS_LOG_FILE = path.resolve(__dirname, '../data/disparos_whatsapp.json');

// Delay anti-ban padrão: 60 segundos
const INTERVALO_PADRAO_SEG = Number(process.env.INTERVALO_DISPARO_SEGUNDOS || 60);
const LIMITE_PADRAO_POR_EXECUCAO = Number(process.env.LIMITE_DISPAROS_POR_EXECUCAO || 0) || null;

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '').padStart(11, '0');
}

function gerarToken(cpf, dataReferencia) {
  return crypto
    .createHmac('sha256', LINK_SECRET)
    .update(`${normalizarCpf(cpf)}|${dataReferencia}`)
    .digest('base64url')
    .slice(0, 22);
}

/**
 * Converte strings de data da planilha para objeto Date:
 * Suporta: "14/11/2026 11:46:02", "14/11/2026", "2026-11-14T11:46:02"
 */
export function parseDataHoraFlexivel(str) {
  if (!str) return null;
  const s = String(str).trim();

  // "DD/MM/YYYY HH:mm:ss" ou "DD/MM/YYYY HH:mm"
  const mDateTime = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s);
  if (mDateTime) {
    const [, dia, mes, ano, hora, min, seg] = mDateTime;
    return new Date(Number(ano), Number(mes) - 1, Number(dia), Number(hora), Number(min), Number(seg || 0));
  }

  // "DD/MM/YYYY"
  const mDateOnly = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (mDateOnly) {
    const [, dia, mes, ano] = mDateOnly;
    return new Date(Number(ano), Number(mes) - 1, Number(dia), 12, 0, 0);
  }

  // ISO
  const dIso = new Date(s);
  return isNaN(dIso.getTime()) ? null : dIso;
}

function carregarHistoricoLocal() {
  try {
    if (fs.existsSync(DISPAROS_LOG_FILE)) {
      return JSON.parse(fs.readFileSync(DISPAROS_LOG_FILE, 'utf8'));
    }
  } catch {
    // ignora
  }
  return {};
}

function salvarHistoricoLocal(hist) {
  try {
    const dir = path.dirname(DISPAROS_LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DISPAROS_LOG_FILE, JSON.stringify(hist, null, 2), 'utf8');
  } catch (err) {
    console.warn('⚠️  Não foi possível gravar histórico local de WhatsApp:', err.message);
  }
}

/**
 * Executa a régua completa de WhatsApp
 */
export async function executarReguaWhatsApp({
  enviar = false,
  intervaloSegundos = INTERVALO_PADRAO_SEG,
  limiteDisparos = LIMITE_PADRAO_POR_EXECUCAO,
  spreadsheetId = process.env.GOOGLE_SHEET_ID
} = {}) {
  const agora = new Date();

  const temCredenciaisZionic = Boolean(
    (process.env.ZIONIC_BEARER_TOKEN && process.env.ZIONIC_BEARER_TOKEN.trim().length > 0) ||
    (process.env.ZIONIC_EMAIL && process.env.ZIONIC_PASSWORD)
  );

  let modoEfetivoEnviar = enviar;
  if (enviar && !temCredenciaisZionic) {
    console.warn(`\n⚠️  [SEGURANÇA] Credenciais da Zionic não configuradas nos Secrets (ZIONIC_EMAIL ou ZIONIC_BEARER_TOKEN ausentes).`);
    console.warn(`🛡️  Executando em modo SIMULAÇÃO SEGURA (nenhuma mensagem será enviada até você cadastrar os Secrets).\n`);
    modoEfetivoEnviar = false;
  }

  console.log(`\n============================================================`);
  console.log(`📱 RÉGUA AUTOMATIZADA DE WHATSAPP (ZIONIC)`);
  console.log(`Data/Hora: ${agora.toLocaleString('pt-BR')}`);
  console.log(`Modo: ${modoEfetivoEnviar ? '🚀 ENVIO REAL' : '🔎 SIMULAÇÃO (Dry-Run)'}`);
  console.log(`Intervalo Anti-Bloqueio: ${intervaloSegundos}s por envio`);
  console.log(`============================================================\n`);

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEET_ID não configurado no ambiente.');
  }

  const res = await carregarSolicitacoes({ spreadsheetId });
  const todasLinhas = res.dados || [];
  // O aluno não recebe link nem cobrança de WhatsApp para solicitação Impressa (apenas Digital)
  const ehImpresso = (l) => String(l.tipoCertificado || '').trim().toLowerCase().includes('impresso');
  const impressoPorCpfCurso = new Map();
  for (const l of todasLinhas) {
    if (!tipoCursoNoEscopo(l.tipoCurso) || !ehImpresso(l)) continue;
    const cpfImp = normalizarCpf(l.cpf);
    const cursoImp = String(l.curso || '').trim().toUpperCase();
    if (!cpfImp || !cursoImp) continue;
    const stLyraImp = String(l.statusLyra || '').trim().toUpperCase();
    impressoPorCpfCurso.set(`${cpfImp}|${cursoImp}`, stLyraImp.includes('PAGAMENTO') ? 'AGUARDANDO_PAGAMENTO' : 'APROVADO');
  }
  const linhas = todasLinhas.filter((l) => tipoCursoNoEscopo(l.tipoCurso) && !ehImpresso(l));

  // Agrupa solicitações por CPF
  const porCpf = new Map();
  for (const l of linhas) {
    const cpf = normalizarCpf(l.cpf);
    if (!cpf) continue;
    if (!porCpf.has(cpf)) porCpf.set(cpf, []);
    porCpf.get(cpf).push(l);
  }

  const historico = carregarHistoricoLocal();
  const relatorio = {
    totalAlunos: porCpf.size,
    linksGeradosColunaT: 0,
    avaliados: 0,
    enviadosD0: 0,
    enviadosLembrete: 0,
    enviadosAlerta2h: 0,
    enviadosExpirado: 0,
    semTelefone: 0,
    jaEmitidos: 0,
    aguardandoJanela: 0,
    erros: 0,
    detalhes: []
  };

  const linksParaGravar = [];
  const filaDeEnvios = [];

  // Fase 1: Análise e Montagem da Fila de Ações
  const ehCanceladoLinha = (i) => {
    const stForm = String(i.statusOriginal || '').trim().toUpperCase();
    const stLyra = String(i.statusLyra || '').trim().toUpperCase();
    return stForm === 'CANCELADO' || stForm === 'CANCELADO_96H' || stForm === 'CANCELADO MANUAL' || stForm === 'CANCELADO_MANUAL' || stLyra === 'CANCELADO';
  };

  const ehEmitidoLinha = (i) => {
    const stForm = String(i.statusOriginal || '').trim().toUpperCase();
    const stLyra = String(i.statusLyra || '').trim().toUpperCase();
    return (
      stForm === 'EMITIR' ||
      stForm === 'APROVADO' ||
      stForm === 'FINALIZADO' ||
      stLyra === 'APROVADO' ||
      stLyra === 'FINALIZADO' ||
      String(i.protocolo || '').trim().length > 0
    );
  };

  for (const [cpf, todosItens] of porCpf) {
    relatorio.avaliados++;
    // Separa linhas ativas das canceladas e, dentre as ativas, separa o que já foi emitido/aprovado do que ainda está pendente.
    // Assim, se o aluno pediu novos cursos em outro dia após já ter um emitido, os novos entram normalmente no fluxo!
    const itensAtivos = todosItens.filter((i) => !ehCanceladoLinha(i));
    const itensPendentes = itensAtivos.filter((i) => !ehEmitidoLinha(i));
    const itens = itensPendentes.length > 0 ? itensPendentes : (itensAtivos.length > 0 ? itensAtivos : todosItens);

    const nome = itens[0].nome || 'Aluno(a)';
    const telefone = itens.find((i) => i.telefone)?.telefone || todosItens.find((i) => i.telefone)?.telefone || '';
    const cursos = [...new Set(itens.map((i) => i.curso).filter(Boolean))];

    // 1. Se não há nenhum curso pendente e existem ativos já emitidos/aprovados:
    //    Se TODOS os cursos de um lote EMITIR foram aprovados no Lyra (mesmo manualmente fora do painel)
    //    a partir de 28/11/2026 11:25 e ainda não receberam EMITIDO_ENVIADO, envia a notificação de emissão!
    const jaEmitido = itensPendentes.length === 0 && itensAtivos.length > 0;

    if (jaEmitido) {
      const itensEmitir = itensAtivos.filter(
        (i) => String(i.statusOriginal || '').trim().toUpperCase() === 'EMITIR'
      );
      const todosAprovados =
        itensEmitir.length > 0 &&
        itensEmitir.every((i) => String(i.statusLyra || '').trim().toUpperCase() === 'APROVADO');
      const jaNotificadoEmitido = itensEmitir.some(
        (i) => String(i.statusWhatsApp || '').trim().toUpperCase() === 'EMITIDO_ENVIADO'
      );
      const corteEmitidoMs = new Date(process.env.DATA_CORTE_NOTIF_EMITIDO_ISO || '2026-11-28T11:25:00-03:00').getTime();
      const modRecente = itensEmitir.some((i) => {
        const dtMod = parseDataHoraFlexivel(i.modificacaoStatus);
        return dtMod && dtMod.getTime() >= corteEmitidoMs;
      });

      if (todosAprovados && !jaNotificadoEmitido && modRecente && telefone && telefone.length >= 10) {
        const cursosEmitir = [...new Set(itensEmitir.map((i) => i.curso).filter(Boolean))];
        let tipoImpressoStatus = null;
        for (const crs of cursosEmitir) {
          const imp = impressoPorCpfCurso.get(`${cpf}|${String(crs || '').trim().toUpperCase()}`);
          if (imp === 'AGUARDANDO_PAGAMENTO') {
            tipoImpressoStatus = 'AGUARDANDO_PAGAMENTO';
            break;
          }
          if (imp === 'APROVADO') tipoImpressoStatus = 'APROVADO';
        }
        filaDeEnvios.push({
          cpf,
          nome,
          telefone,
          cursos: cursosEmitir,
          linkAtual: '',
          etapa: 'CERTIFICADO_EMITIDO',
          mensagem: montarMensagemCertificadoEmitido({ nome, cursos: cursosEmitir, tipoImpressoStatus }),
          proximoStatus: 'EMITIDO_ENVIADO',
          novoTotalLembretes: Number(itensEmitir[0]?.totalLembretesWhatsApp || 0),
          horasRestantes: 0
        });
        continue;
      }

      relatorio.jaEmitidos++;
      relatorio.detalhes.push({ cpf, nome, acao: 'IGNORADO_JA_EMITIDO' });
      continue;
    }

    // Verifica se todas as linhas restantes estão marcadas como Cancelado na mesma aba
    const jaCanceladoPlanilha = itensAtivos.length === 0;

    if (!telefone || telefone.length < 10) {
      relatorio.semTelefone++;
      relatorio.detalhes.push({ cpf, nome, acao: 'SEM_TELEFONE' });
      continue;
    }

    // Calcula token e link individual
    const datasReferencia = itens
      .map((i) => parseDataHoraFlexivel(i.solicitacao))
      .filter(Boolean);
    const dataMaisRecente = datasReferencia.length ? new Date(Math.max(...datasReferencia)) : agora;
    const dataReferenciaStr = dataMaisRecente.toISOString().slice(0, 10);
    const token = gerarToken(cpf, dataReferenciaStr);
    const urlEsperada = `${PUBLIC_FORM_URL}/solicitacoes/${token}`;

    // Link atual na coluna T
    let linkAtual = itens.map((i) => i.link).find(Boolean) || '';
    if (!linkAtual || !linkAtual.includes('/solicitacoes/')) {
      linksParaGravar.push({ cpf, url: urlEsperada });
      linkAtual = urlEsperada;
      relatorio.linksGeradosColunaT++;
    }

    // Data de início da contagem (inserção na planilha ou solicitação)
    const datasInsercao = itens
      .map((i) => parseDataHoraFlexivel(i.dataInsercao || i.solicitacao))
      .filter(Boolean);
    const dataInicio96h = datasInsercao.length ? new Date(Math.max(...datasInsercao)) : dataMaisRecente;

    const msDesdeInicio = agora.getTime() - dataInicio96h.getTime();
    const horasDesdeInicio = msDesdeInicio / (1000 * 3600);
    const horasRestantes = 96 - horasDesdeInicio;

    // Status atual do WhatsApp (planilha ou histórico local)
    const statusPlanilha = itens.map((i) => i.statusWhatsApp).find(Boolean) || '';
    const dataUltimoPlanilha = itens.map((i) => i.dataUltimoWhatsApp).find(Boolean) || '';
    const totalLembretesPlanilha = itens.reduce((max, i) => Math.max(max, i.totalLembretesWhatsApp || 0), 0);

    const hist = historico[cpf] || {};
    const statusAtual = statusPlanilha || hist.statusEtapa || '';
    const dataUltimoEnvio = parseDataHoraFlexivel(dataUltimoPlanilha) || parseDataHoraFlexivel(hist.dataEnvio);
    const horasDesdeUltimoEnvio = dataUltimoEnvio ? (agora.getTime() - dataUltimoEnvio.getTime()) / (1000 * 3600) : null;
    const totalLembretes = Math.max(totalLembretesPlanilha, hist.totalLembretes || 0);

    // Tomada de Decisão da Régua
    let etapa = null;
    let mensagem = null;
    let proximoStatus = null;
    let novoTotalLembretes = totalLembretes;

    // 0. Se foi marcado como Cancelado na planilha:
    //    - Cancelamento Manual no Lyra: silencia completamente (não envia nada até abrir nova solicitação).
    //    - Expiração 96h: se já recebeu contato antes e ainda não recebeu o aviso EXPIRADO, dispara o aviso final.
    if (jaCanceladoPlanilha) {
      const canceladoManual = itens.some((i) =>
        String(i.statusOriginal || '').trim().toUpperCase().includes('CANCELADO MANUAL')
      );
      if (canceladoManual) {
        relatorio.jaEmitidos++;
        relatorio.detalhes.push({ cpf, nome, acao: 'IGNORADO_CANCELADO_MANUAL' });
        continue;
      }
      if (statusAtual && statusAtual !== 'EXPIRADO') {
        etapa = 'EXPIRADO_96H';
        mensagem = montarMensagemExpirado({ nome, cursos });
        proximoStatus = 'EXPIRADO';
      } else {
        relatorio.jaEmitidos++;
        relatorio.detalhes.push({ cpf, nome, acao: 'IGNORADO_CANCELADO_JA_NOTIFICADO' });
        continue;
      }
    }
    // 1. D0 (Boas-vindas): Nunca recebeu nada e ainda está dentro do prazo (< 96h)
    else if (!statusAtual && horasRestantes > 0) {
      etapa = 'D0_BOAS_VINDAS';
      mensagem = montarMensagemCertificado({ nome, cursos, linkUrl: linkAtual });
      proximoStatus = 'D0_ENVIADO';
      novoTotalLembretes = 0;
    }
    // 2. EXPIRADO (>= 96h)
    else if (horasRestantes <= 0 && statusAtual !== 'EXPIRADO') {
      etapa = 'EXPIRADO_96H';
      mensagem = montarMensagemExpirado({ nome, cursos });
      proximoStatus = 'EXPIRADO';
    }
    // 3. ALERTA FINAL (Últimas 24h antes de expirar as 96h e ainda não recebeu o aviso final)
    else if (horasRestantes <= 24 && horasRestantes > 0 && statusAtual !== 'ALERTA_24H' && statusAtual !== 'ALERTA_2H' && statusAtual !== 'EXPIRADO') {
      etapa = 'ALERTA_24H';
      mensagem = montarMensagemAlerta2Horas({ nome, cursos, linkUrl: linkAtual });
      proximoStatus = 'ALERTA_24H';
    }
    // 4. LEMBRETE DIÁRIO (Passou >= 24h desde o último envio e faltam mais de 24h para as 96h)
    else if (
      horasRestantes > 24 &&
      horasDesdeUltimoEnvio !== null &&
      horasDesdeUltimoEnvio >= 24 &&
      statusAtual !== 'EXPIRADO' &&
      statusAtual !== 'ALERTA_24H' &&
      statusAtual !== 'ALERTA_2H'
    ) {
      novoTotalLembretes = totalLembretes + 1;
      etapa = `LEMBRETE_DIARIO_${novoTotalLembretes}`;
      mensagem = montarMensagemLembreteDiario({ nome, cursos, linkUrl: linkAtual, horasRestantes });
      proximoStatus = `LEMBRETE_${novoTotalLembretes}`;
    } else {
      relatorio.aguardandoJanela++;
      relatorio.detalhes.push({
        cpf,
        nome,
        statusAtual,
        horasRestantes: Math.round(horasRestantes),
        horasDesdeUltimoEnvio: horasDesdeUltimoEnvio !== null ? Math.round(horasDesdeUltimoEnvio) : null,
        acao: 'AGUARDANDO_JANELA'
      });
      continue;
    }

    filaDeEnvios.push({
      cpf,
      nome,
      telefone,
      cursos,
      linkUrl: linkAtual,
      etapa,
      mensagem,
      proximoStatus,
      novoTotalLembretes,
      horasRestantes: Math.round(horasRestantes)
    });
  }

  // Grava links pendentes na coluna T da planilha antes dos disparos
  if (linksParaGravar.length > 0) {
    console.log(`🔗 Alimentando ${linksParaGravar.length} links pendentes na coluna T do Google Sheets...`);
    await gravarLinksNaPlanilha({
      spreadsheetId,
      itens: linksParaGravar,
      dryRun: !modoEfetivoEnviar
    });
  }

  console.log(`📋 Total de alunos na fila de envio da régua: ${filaDeEnvios.length}`);

  const updatesPlanilha = [];
  const limite = limiteDisparos ? Math.min(limiteDisparos, filaDeEnvios.length) : filaDeEnvios.length;

  // Fase 2: Execução dos Envios com Delay de 60 Segundos Anti-Ban
  for (let idx = 0; idx < limite; idx++) {
    const item = filaDeEnvios[idx];
    console.log(`\n────────────────────────────────────────────────────────────`);
    console.log(`[${idx + 1}/${limite}] 👤 ${item.nome} | Tel: ${item.telefone} | Etapa: ${item.etapa}`);
    console.log(`⏳ Horas restantes de prazo: ${item.horasRestantes}h`);

    if (modoEfetivoEnviar) {
      console.log(`🚀 Enviando mensagem via Zionic WhatsApp...`);
      try {
        const resEnvio = await dispararMensagemAlunoZionic({
          nome: item.nome,
          telefone: item.telefone,
          mensagem: item.mensagem
        });

        if (resEnvio.sucesso) {
          console.log(`   ✅ Sucesso! Mensagem ID: ${resEnvio.data?.id || 'OK'}`);

          if (item.etapa === 'D0_BOAS_VINDAS') relatorio.enviadosD0++;
          else if (item.etapa.startsWith('LEMBRETE')) relatorio.enviadosLembrete++;
          else if (item.etapa === 'ALERTA_2H') relatorio.enviadosAlerta2h++;
          else if (item.etapa === 'EXPIRADO_96H') relatorio.enviadosExpirado++;
          else if (item.etapa === 'CERTIFICADO_EMITIDO') relatorio.jaEmitidos++;

          const agoraISO = new Date().toISOString();
          const agoraFormatado = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

          // Salva histórico local
          historico[item.cpf] = {
            nome: item.nome,
            telefone: item.telefone,
            statusEtapa: item.proximoStatus,
            totalLembretes: item.novoTotalLembretes,
            dataEnvio: agoraISO,
            messageId: resEnvio.data?.id
          };
          salvarHistoricoLocal(historico);

          // Grava imediatamente na planilha (Coluna I = Enviado, Y = data, Z = status, AA = total)
          // para evitar envio duplicado caso o workflow seja interrompido antes do fim da fila
          const updateAluno = {
            cpf: item.cpf,
            statusWhatsApp: item.proximoStatus,
            dataUltimoWhatsApp: agoraFormatado,
            totalLembretes: item.novoTotalLembretes
          };
          try {
            await gravarStatusWhatsAppNaPlanilha({
              spreadsheetId,
              itens: [updateAluno],
              dryRun: false
            });
          } catch (errSheet) {
            console.warn(`   ⚠️  Falha ao gravar status na planilha para ${item.nome}: ${errSheet.message}`);
            updatesPlanilha.push(updateAluno);
          }

          relatorio.detalhes.push({
            cpf: item.cpf,
            nome: item.nome,
            etapa: item.etapa,
            status: 'ENVIADO',
            messageId: resEnvio.data?.id
          });
        } else {
          console.error(`   ❌ Falha ao enviar: ${resEnvio.erro}`);
          relatorio.erros++;
          relatorio.detalhes.push({ cpf: item.cpf, nome: item.nome, etapa: item.etapa, status: 'ERRO', erro: resEnvio.erro });
        }
      } catch (err) {
        console.error(`   ❌ Exceção ao disparar: ${err.message}`);
        relatorio.erros++;
        relatorio.detalhes.push({ cpf: item.cpf, nome: item.nome, etapa: item.etapa, status: 'ERRO', erro: err.message });
      }

      // Aplica intervalo anti-bloqueio se houver mais mensagens na fila
      if (idx < limite - 1 && intervaloSegundos > 0) {
        console.log(`⏳ [ANTI-BAN WHATSAPP] Aguardando ${intervaloSegundos} segundos antes do próximo envio...`);
        await sleep(intervaloSegundos * 1000);
      }
    } else {
      // Modo Simulação (Dry-Run)
      console.log(`🔎 [Simulação] Mensagem pronta para envio:`);
      console.log(item.mensagem.split('\n').map((l) => `   | ${l}`).join('\n'));

      if (item.etapa === 'D0_BOAS_VINDAS') relatorio.enviadosD0++;
      else if (item.etapa.startsWith('LEMBRETE')) relatorio.enviadosLembrete++;
      else if (item.etapa === 'ALERTA_2H') relatorio.enviadosAlerta2h++;
      else if (item.etapa === 'EXPIRADO_96H') relatorio.enviadosExpirado++;

      updatesPlanilha.push({
        cpf: item.cpf,
        statusWhatsApp: item.proximoStatus,
        dataUltimoWhatsApp: new Date().toLocaleString('pt-BR'),
        totalLembretes: item.novoTotalLembretes
      });

      relatorio.detalhes.push({
        cpf: item.cpf,
        nome: item.nome,
        etapa: item.etapa,
        status: 'SIMULADO'
      });
    }
  }

  // Atualiza as colunas de WhatsApp na planilha Google Sheets
  if (updatesPlanilha.length > 0) {
    console.log(`\n📝 Atualizando colunas de controle do WhatsApp no Google Sheets (${updatesPlanilha.length} alunos)...`);
    await gravarStatusWhatsAppNaPlanilha({
      spreadsheetId,
      itens: updatesPlanilha,
      dryRun: !modoEfetivoEnviar
    });
  }

  console.log(`\n============================================================`);
  console.log(`📊 RESUMO DA EXECUÇÃO DA RÉGUA DE WHATSAPP`);
  console.log(`Total de alunos avaliados: ${relatorio.avaliados}`);
  console.log(`Já emitidos no Lyra (ignorados): ${relatorio.jaEmitidos}`);
  console.log(`Aguardando janela de 24h: ${relatorio.aguardandoJanela}`);
  console.log(`Sem telefone válido: ${relatorio.semTelefone}`);
  console.log(`Novos links gravados na Coluna T: ${relatorio.linksGeradosColunaT}`);
  console.log(`------------------------------------------------------------`);
  console.log(`📩 Disparos D0 (Boas-vindas): ${relatorio.enviadosD0}`);
  console.log(`⏰ Lembretes Diários: ${relatorio.enviadosLembrete}`);
  console.log(`🚨 Alertas de 2 Horas: ${relatorio.enviadosAlerta2h}`);
  console.log(`❌ Avisos de Expirado (96h): ${relatorio.enviadosExpirado}`);
  console.log(`Falhas / Erros: ${relatorio.erros}`);
  console.log(`============================================================\n`);

  return relatorio;
}

// Execução direta via CLI
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const enviar = process.argv.includes('--enviar');
  const argIntervalo = process.argv.find((a) => a.startsWith('--intervalo='));
  const intervaloSegundos = argIntervalo ? Number(argIntervalo.split('=')[1]) : INTERVALO_PADRAO_SEG;
  const argLimite = process.argv.find((a) => a.startsWith('--limite='));
  const limiteDisparos = argLimite ? Number(argLimite.split('=')[1]) : LIMITE_PADRAO_POR_EXECUCAO;

  executarReguaWhatsApp({ enviar, intervaloSegundos, limiteDisparos })
    .then((r) => process.exit(r.erros > 0 && enviar ? 1 : 0))
    .catch((err) => {
      console.error('❌ Erro fatal na régua de WhatsApp:', err);
      process.exit(1);
    });
}
