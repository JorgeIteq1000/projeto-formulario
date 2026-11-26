/**
 * Google Apps Script — Automação da Planilha de Certificados
 *
 * Gatilhos recomendados (em Extensões -> Apps Script -> Acionadores):
 *  1) Função `preencherLinksNovos`   -> Origem: "Da planilha" | Tipo: "Ao alterar" (On change)
 *     Preenche automaticamente a coluna T (Link) quando novas linhas entrarem na aba "Extensões e Aperfeiçoamentos"
 *     e notifica o servidor para sincronizar a base.
 *  2) Função `verificarExpiracao96h` -> Origem: "Baseado no tempo" | Tipo: "Contador de horas" -> "A cada hora"
 *     Cancela no Lyra, move linhas >= 96h para "Solicitações Canceladas" e sincroniza o bloqueio do link.
 *
 * IMPORTANTE: Em Configurações do Projeto -> Propriedades do script (ou nas constantes abaixo),
 * mantenha `LINK_SECRET` idêntico ao configurado no .env / Hostinger.
 */

const CONFIG_SCRIPT = {
  GID_EXTENSOES: 267936837,
  GID_CANCELADAS: 710641972,
  PUBLIC_FORM_URL: 'https://certificadoies.com.br',
  // Mesmo LINK_SECRET configurado no servidor Node.js (Hostinger / .env)
  LINK_SECRET: PropertiesService.getScriptProperties().getProperty('LINK_SECRET') || 'dev-secret-certificados-ies-2026',
  PRAZO_HORAS: 96
};

function obterAbaPorGid_(ss, gid, fallbackNome) {
  const abas = ss.getSheets();
  for (var i = 0; i < abas.length; i++) {
    if (abas[i].getSheetId() === gid) return abas[i];
  }
  return ss.getSheetByName(fallbackNome);
}

function normalizarCpf_(cpf) {
  var digitos = String(cpf || '').replace(/\D/g, '');
  if (!digitos) return '';
  while (digitos.length < 11) digitos = '0' + digitos;
  return digitos;
}

function semAcento_(txt) {
  return String(txt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

function parseDataPlanilha_(valor) {
  if (!valor) return null;
  if (Object.prototype.toString.call(valor) === '[object Date]' && !isNaN(valor.getTime())) {
    return valor;
  }
  var s = String(valor).trim();
  // DD/MM/YYYY HH:mm:ss ou DD/MM/YYYY
  var m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    return new Date(
      Number(m[3]),
      Number(m[2]) - 1,
      Number(m[1]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    );
  }
  // YYYY-MM-DD
  var mIso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (mIso) {
    return new Date(Number(mIso[1]), Number(mIso[2]) - 1, Number(mIso[3]));
  }
  return null;
}

/**
 * Gera o mesmo token determinístico do servidor Node.js (HMAC-SHA256 em base64url, 22 caracteres).
 */
function gerarTokenAluno_(cpf, dataReferencia) {
  var payload = cpf + '|' + dataReferencia;
  var bytes = Utilities.computeHmacSha256Signature(payload, CONFIG_SCRIPT.LINK_SECRET);
  var b64 = Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, '');
  return b64.slice(0, 22);
}

/**
 * Gatilho "Ao alterar" (On change):
 * Preenche automaticamente a coluna T (Link) para qualquer linha nova ou sem link oficial.
 */
function preencherLinksNovos() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = obterAbaPorGid_(ss, CONFIG_SCRIPT.GID_EXTENSOES, 'Extensões e Aperfeiçoamentos');
    if (!aba) return;

    var dados = aba.getDataRange().getValues();
    if (dados.length <= 1) return;

    var headers = dados[0].map(semAcento_);
    var idxCpf = headers.indexOf('CPF');
    var idxSolic = headers.findIndex(function (h) { return h.indexOf('SOLICITA') !== -1; });
    var idxTipoCurso = headers.findIndex(function (h) { return h.indexOf('TIPO') !== -1 && h.indexOf('CURSO') !== -1; });
    var idxTipoCertLink = headers.findIndex(function (h) { return h.indexOf('TIPO') !== -1 && h.indexOf('CERT') !== -1; });
    var idxLink = headers.indexOf('LINK');
    if (idxCpf === -1) return;
    if (idxLink === -1) idxLink = 19; // Coluna T

    // Agrupa datas de solicitação por CPF (mesma regra do server.js: Impresso nunca recebe link)
    var datasPorCpf = {};
    for (var i = 1; i < dados.length; i++) {
      var tipoNorm = idxTipoCurso !== -1 ? semAcento_(dados[i][idxTipoCurso]) : 'EXTENSAO';
      if (tipoNorm.indexOf('EXTENSAO') === -1 && tipoNorm.indexOf('APERFEICOAMENTO') === -1) continue;
      if (idxTipoCertLink !== -1 && semAcento_(dados[i][idxTipoCertLink]).indexOf('IMPRESSO') !== -1) continue;

      var cpf = normalizarCpf_(dados[i][idxCpf]);
      if (!cpf) continue;

      var dt = idxSolic !== -1 ? parseDataPlanilha_(dados[i][idxSolic]) : null;
      if (!datasPorCpf[cpf]) datasPorCpf[cpf] = [];
      if (dt) datasPorCpf[cpf].push(dt.getTime());
    }

    var linkPorCpf = {};
    Object.keys(datasPorCpf).forEach(function (cpf) {
      var lista = datasPorCpf[cpf];
      var maisRecente = lista.length ? new Date(Math.max.apply(null, lista)) : new Date();
      var dataRef = Utilities.formatDate(maisRecente, 'UTC', 'yyyy-MM-dd');
      var token = gerarTokenAluno_(cpf, dataRef);
      linkPorCpf[cpf] = CONFIG_SCRIPT.PUBLIC_FORM_URL.replace(/\/+$/, '') + '/solicitacoes/' + token;
    });

    var alterou = 0;
    for (var r = 1; r < dados.length; r++) {
      var cpfLinha = normalizarCpf_(dados[r][idxCpf]);
      if (idxTipoCertLink !== -1 && semAcento_(dados[r][idxTipoCertLink]).indexOf('IMPRESSO') !== -1) continue; // Impresso não recebe link
      var urlEsperada = linkPorCpf[cpfLinha];
      if (!urlEsperada) continue;

      var valorAtual = String(dados[r][idxLink] || '').trim();
      if (valorAtual === urlEsperada) continue;
      if (valorAtual && valorAtual.indexOf('/solicitacoes/') === -1) continue; // Preserva anotação manual

      aba.getRange(r + 1, idxLink + 1).setValue(urlEsperada);
      alterou++;
    }

    if (alterou > 0) {
      try {
        UrlFetchApp.fetch(CONFIG_SCRIPT.PUBLIC_FORM_URL + '/api/sincronizar', {
          method: 'post',
          muteHttpExceptions: true
        });
      } catch (e) {
        Logger.log('Aviso ao sincronizar servidor: ' + e.message);
      }
    }
  } finally {
    lock.releaseLock();
  }
}

function extrairTokenDeUrl_(url) {
  var m = /\/solicitacoes\/([A-Za-z0-9_-]+)/.exec(String(url || ''));
  return m ? m[1] : '';
}

/**
 * Chama o servidor Node.js para cancelar a solicitação pendente no Lyra.
 * Retornar `true` permite prosseguir com a movimentação da linha para "Solicitações Canceladas".
 */
function cancelarNoLyra_(linhaDados, headers) {
  var idxCpf = headers.indexOf('CPF');
  var idxNome = headers.indexOf('NOME');
  var idxCurso = headers.indexOf('CURSO');
  var idxContrato = headers.indexOf('CONTRATO');
  var idxIdEvento = headers.indexOf('ID DO EVENTO');

  var payload = {
    cpf: idxCpf !== -1 ? normalizarCpf_(linhaDados[idxCpf]) : '',
    nome: idxNome !== -1 ? String(linhaDados[idxNome] || '').trim() : '',
    curso: idxCurso !== -1 ? String(linhaDados[idxCurso] || '').trim() : '',
    contrato: idxContrato !== -1 ? String(linhaDados[idxContrato] || '').trim() : '',
    solicitationId: idxIdEvento !== -1 ? String(linhaDados[idxIdEvento] || '').trim() : ''
  };

  try {
    var resp = UrlFetchApp.fetch(CONFIG_SCRIPT.PUBLIC_FORM_URL + '/api/lyra/cancelar-expirados', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-cron-secret': CONFIG_SCRIPT.LINK_SECRET
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var status = resp.getResponseCode();
    var bodyText = resp.getContentText() || '';
    var json = bodyText ? JSON.parse(bodyText) : null;
    var item = json && json.resultados && json.resultados[0] ? json.resultados[0] : null;

    if (status >= 200 && status < 300 && json && json.sucesso && item && item.ok) {
      Logger.log('Lyra cancelado com sucesso: ID=' + item.solicitationId + ' | CPF=' + payload.cpf);
      return true;
    }

    Logger.log('Falha ao cancelar no Lyra (HTTP ' + status + '): ' + bodyText);
    return false;
  } catch (err) {
    Logger.log('Erro ao chamar endpoint de cancelamento no Lyra: ' + err);
    return false;
  }
}

/**
 * Gatilho baseado em tempo (a cada 1 hora):
 * 1. Identifica solicitações pendentes com >= 96h desde DATA CRIAÇÃO EVENTO.
 * 2. Executa o cancelamento no Lyra (`cancelarNoLyra_`).
 * 3. Mantém a linha na MESMA aba ("Extensões e Aperfeiçoamentos") e atualiza:
 *    - Coluna I (STATUS DO FORMULÁRIO) -> "Cancelado"
 *    - Coluna V (STATUS LYRA)          -> "Cancelado"
 *    - Coluna W (MODIFICAÇÃO DO STATUS)-> Data/hora do cancelamento
 * 4. Notifica o servidor (/api/sincronizar) para bloquear o link imediatamente.
 */
function verificarExpiracao96h() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return;

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var aba = obterAbaPorGid_(ss, CONFIG_SCRIPT.GID_EXTENSOES, 'Extensões e Aperfeiçoamentos');
    if (!aba) return;

    var dados = aba.getDataRange().getValues();
    if (dados.length <= 1) return;

    var headers = dados[0].map(semAcento_);
    var idxStatus = headers.findIndex(function (h) {
      return h === 'STATUS DO FORMULARIO' || h === 'STATUS DO EVENTO';
    });
    if (idxStatus === -1) {
      idxStatus = headers.findIndex(function (h) {
        return h.indexOf('STATUS') !== -1 && h.indexOf('LYRA') === -1 && h.indexOf('MODIFICACAO') === -1 && h.indexOf('WHATSAPP') === -1;
      });
    }
    var idxDataEvento = headers.findIndex(function (h) { return h.indexOf('DATA CRIACAO EVENTO') !== -1; });
    var idxProtocolo = headers.findIndex(function (h) { return h.indexOf('PROTOCOLO') !== -1; });
    var idxStatusLyra = headers.indexOf('STATUS LYRA');
    if (idxStatusLyra === -1) idxStatusLyra = 21; // Coluna V
    var idxTipoCert = headers.findIndex(function (h) { return h.indexOf('TIPO') !== -1 && h.indexOf('CERT') !== -1; });
    var idxModStatus = headers.findIndex(function (h) { return h.indexOf('MODIFICACAO DO STATUS') !== -1; });
    if (idxModStatus === -1) idxModStatus = 22; // Coluna W
    if (idxDataEvento === -1) return;

    var agora = new Date();
    var agoraMs = agora.getTime();
    var limiteMs = CONFIG_SCRIPT.PRAZO_HORAS * 60 * 60 * 1000;
    var dataCancelStr = Utilities.formatDate(agora, 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm:ss');
    var linhasCanceladas = [];

    for (var i = 1; i < dados.length; i++) {
      var linha = dados[i];
      var status = idxStatus !== -1 ? semAcento_(linha[idxStatus]) : '';
      var statusLyra = semAcento_(linha[idxStatusLyra]);
      var protocolo = idxProtocolo !== -1 ? String(linha[idxProtocolo] || '').trim() : '';
      // Certificado Impresso tem ciclo próprio (CRIAR DIGITAL / Aguardando Pagamento / Finalizado no Lyra): nunca cancelar por 96h
      var tipoCert = idxTipoCert !== -1 ? semAcento_(linha[idxTipoCert]) : '';
      if (tipoCert.indexOf('IMPRESSO') !== -1) continue;
      if (status === 'EMITIR' || status === 'FINALIZADO' || status === 'CANCELADO' || status === 'CANCELADO_96H' || statusLyra === 'CANCELADO' || statusLyra === 'FINALIZADO' || protocolo) continue;

      var dtCriacao = parseDataPlanilha_(linha[idxDataEvento]);
      if (!dtCriacao) continue;
      if (agoraMs - dtCriacao.getTime() < limiteMs) continue;

      if (!cancelarNoLyra_(linha, headers)) {
        Logger.log('Cancelamento no Lyra falhou para a linha ' + (i + 1) + '; linha mantida pendente.');
        continue;
      }

      var numLinha = i + 1;
      if (idxStatus !== -1) {
        aba.getRange(numLinha, idxStatus + 1).setValue('Cancelado');
      }
      aba.getRange(numLinha, idxStatusLyra + 1).setValue('Cancelado');
      aba.getRange(numLinha, idxModStatus + 1).setValue(dataCancelStr);
      linhasCanceladas.push(numLinha);
    }

    if (linhasCanceladas.length > 0) {
      try {
        UrlFetchApp.fetch(CONFIG_SCRIPT.PUBLIC_FORM_URL + '/api/sincronizar', {
          method: 'post',
          muteHttpExceptions: true
        });
      } catch (e) {
        Logger.log('Aviso ao sincronizar servidor após cancelamento: ' + e.message);
      }
    }

    Logger.log('Linhas canceladas na mesma aba (96h): ' + JSON.stringify(linhasCanceladas));
  } finally {
    lock.releaseLock();
  }
}
