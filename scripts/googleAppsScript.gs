/**
 * Google Apps Script — Automação da Planilha de Certificados
 *
 * Gatilhos recomendados (em Extensões -> Apps Script -> Acionadores):
 *  1) Função `preencherLinksNovos`   -> Origem: "Da planilha" | Tipo: "Ao alterar" (On change)
 *     Preenche automaticamente a coluna T (Link) quando novas linhas entrarem na aba "Extensões e Aperfeiçoamentos"
 *     e notifica o servidor para sincronizar a base.
 *  2) Função `verificarExpiracao96h` -> Origem: "Baseado no tempo" | Tipo: "Contador de horas" -> "A cada hora"
 *     (Será integrada ao cancelamento no Lyra + movimentação para "Solicitações Canceladas" na próxima etapa.)
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
    var idxLink = headers.indexOf('LINK');
    if (idxCpf === -1) return;
    if (idxLink === -1) idxLink = 19; // Coluna T

    // Agrupa datas de solicitação por CPF (mesma regra do server.js)
    var datasPorCpf = {};
    for (var i = 1; i < dados.length; i++) {
      var tipoNorm = idxTipoCurso !== -1 ? semAcento_(dados[i][idxTipoCurso]) : 'EXTENSAO';
      if (tipoNorm.indexOf('EXTENSAO') === -1 && tipoNorm.indexOf('APERFEICOAMENTO') === -1) continue;

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

/**
 * Gatilho baseado em tempo (a cada 1 hora):
 * Identifica solicitações pendentes com mais de 96 horas desde DATA CRIAÇÃO EVENTO.
 * (A chamada de cancelamento no Lyra será conectada aqui assim que a rota for configurada.)
 */
function verificarExpiracao96h() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var aba = obterAbaPorGid_(ss, CONFIG_SCRIPT.GID_EXTENSOES, 'Extensões e Aperfeiçoamentos');
  if (!aba) return;

  var dados = aba.getDataRange().getValues();
  if (dados.length <= 1) return;

  var headers = dados[0].map(semAcento_);
  var idxStatus = headers.findIndex(function (h) { return h.indexOf('STATUS') !== -1; });
  var idxDataEvento = headers.findIndex(function (h) { return h.indexOf('DATA CRIACAO EVENTO') !== -1; });
  var idxProtocolo = headers.findIndex(function (h) { return h.indexOf('PROTOCOLO') !== -1; });
  if (idxDataEvento === -1) return;

  var agoraMs = Date.now();
  var limiteMs = CONFIG_SCRIPT.PRAZO_HORAS * 60 * 60 * 1000;
  var expiradas = [];

  for (var i = 1; i < dados.length; i++) {
    var status = idxStatus !== -1 ? semAcento_(dados[i][idxStatus]) : '';
    var protocolo = idxProtocolo !== -1 ? String(dados[i][idxProtocolo] || '').trim() : '';
    if (status === 'EMITIR' || protocolo) continue;

    var dtCriacao = parseDataPlanilha_(dados[i][idxDataEvento]);
    if (!dtCriacao) continue;

    if (agoraMs - dtCriacao.getTime() >= limiteMs) {
      expiradas.push(i + 1);
    }
  }

  Logger.log('Linhas elegíveis para cancelamento (96h): ' + JSON.stringify(expiradas));
}
