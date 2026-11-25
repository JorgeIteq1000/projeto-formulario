import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { carregarConfiguracoes, salvarConfiguracoes } from '../services/configStore.js';
import { descriptografarRotaLyra } from '../services/lyra.js';
import { criarTokenSessao } from '../services/authUsuarios.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raizApp = path.resolve(__dirname, '..');

function pastaTemporaria() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'config-cert-'));
}

function iniciarServidor(env) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['server.js'], {
      cwd: raizApp,
      env: { ...process.env, GOOGLE_SHEET_ID: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let saida = '';
    const timer = setTimeout(() => reject(new Error(`Servidor não iniciou:\n${saida}`)), 15000);
    const aoReceber = (d) => {
      saida += d;
      if (saida.includes('SERVIDOR ATIVO')) {
        clearTimeout(timer);
        resolve(proc);
      }
    };
    proc.stdout.on('data', aoReceber);
    proc.stderr.on('data', aoReceber);
    proc.on('exit', (code) => reject(new Error(`Servidor saiu (${code}):\n${saida}`)));
  });
}

const parar = (proc) => new Promise((resolve) => {
  proc.removeAllListeners('exit');
  proc.on('exit', resolve);
  proc.kill();
});

test('configStore: padrão seguro é certificacaoAutomatica=false e salva/restaura com sucesso', () => {
  const dir = pastaTemporaria();
  const arq = path.join(dir, 'config.json');

  const inicial = carregarConfiguracoes(arq);
  assert.equal(inicial.certificacaoAutomatica, false);

  salvarConfiguracoes(arq, {
    certificacaoAutomatica: true,
    atualizadoEm: '25/11/2026, 14:55:00',
    atualizadoPor: 'Jorge Augusto'
  });

  const lido = carregarConfiguracoes(arq);
  assert.equal(lido.certificacaoAutomatica, true);
  assert.equal(lido.atualizadoPor, 'Jorge Augusto');
  assert.equal(fs.existsSync(`${arq}.tmp`), false);
});

test('Interruptor de Certificação Automática: controla emissão automática vs botão manual Emitir com dados do aluno', async () => {
  const aprovacoesLyra = [];
  let registroLivro = 500;

  // Servidor HTTP falso simulando API Gateway do Lyra + Bitrix24 SPA
  const mockLyra = http.createServer((req, res) => {
    let rawBody = '';
    req.on('data', (c) => { rawBody += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');

      // Login Lyra
      if (req.method === 'POST' && req.url === '/lyra-login') {
        res.end(JSON.stringify({ code: 200, data: { user: { authorization: 'Bearer jwt-mock-toggle' } } }));
        return;
      }

      // Bitrix24 SPA stub
      if (req.url.startsWith('/bitrix')) {
        res.end(JSON.stringify({ result: { item: { id: 777 } } }));
        return;
      }

      // Rotas criptografadas do Lyra
      const tokenRota = req.url.replace(/^\/+/, '');
      let rotaLimpa = '';
      try {
        rotaLimpa = descriptografarRotaLyra(tokenRota);
      } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
        return;
      }

      if (req.method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations?')) {
        const qs = rotaLimpa.split('?')[1] || '';
        const params = new URLSearchParams(qs);
        const searchTerm = params.get('searchTerm') || '';
        res.end(JSON.stringify({
          code: 200,
          data: [
            {
              _id: '6af86d4310b9458d40c032d1',
              status: 'waiting_approval',
              dataStudent: { name: 'Aluno Mock', cpf: searchTerm.replace(/\D/g, '') },
              dataCourse: { course: '' }
            }
          ]
        }));
        return;
      }

      if (req.method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations/build-data/')) {
        res.end(JSON.stringify({
          code: 200,
          data: {
            type: 'digital',
            dataStudent: { name: 'Aluno Mock', cpf: '12345678901' },
            dataCourse: {
              certifier: 'Faculdade Alpha',
              courseType: 'Extensão',
              course: 'Curso Teste Toggle',
              workload: 60,
              startDate: '2026-01-01T03:00:00.000Z',
              endDate: '2026-02-01T03:00:00.000Z',
              knowledgeArea: 'Educação'
            },
            disciplines: []
          }
        }));
        return;
      }

      if (req.method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations/next-book-registry/')) {
        registroLivro += 1;
        res.end(JSON.stringify({
          code: 200,
          data: { book: 2, sheet: 10, registry: registroLivro }
        }));
        return;
      }

      if (req.method === 'PUT' && rotaLimpa.endsWith('/approve')) {
        const body = rawBody ? JSON.parse(rawBody) : {};
        aprovacoesLyra.push(body);
        res.end(JSON.stringify({
          code: 200,
          data: {
            status: 'approved',
            metadata: { _certificateId: `cert-${registroLivro}` }
          }
        }));
        return;
      }

      if (req.method === 'PUT') {
        res.end(JSON.stringify({ code: 200, data: { status: 'waiting_approval' } }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: `Rota não mapeada: ${rotaLimpa}` }));
    });
  });

  await new Promise((r) => mockLyra.listen(0, '127.0.0.1', r));
  const mockPort = mockLyra.address().port;

  const dir = pastaTemporaria();
  const porta = 3992;
  const linkSecret = 'segredo-teste-toggle-2026';
  const env = {
    PORT: String(porta),
    LINK_SECRET: linkSecret,
    AUTH_STRICT: 'true',
    RESPOSTAS_FILE: path.join(dir, 'respostas.json'),
    CONFIG_FILE: path.join(dir, 'config.json'),
    GOOGLE_SHEET_SOMENTE_LEITURA: 'false',
    LYRA_EMAIL: 'bot@iteq.test',
    LYRA_PASSWORD: '123',
    LYRA_API_URL: `http://127.0.0.1:${mockPort}/`,
    LYRA_LOGIN_URL: `http://127.0.0.1:${mockPort}/lyra-login`,
    BITRIX24_WEBHOOK_URL: `http://127.0.0.1:${mockPort}/bitrix`
  };

  const base = `http://127.0.0.1:${porta}`;
  const adminToken = criarTokenSessao({ login: 'jorge.augusto', nome: 'Jorge Augusto' }, linkSecret);
  const authHeaders = {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  };

  let servidor = await iniciarServidor(env);
  try {
    // 1. Verifica que por padrão seguro o interruptor inicia DESATIVADO (false)
    const cfgInicial = await (await fetch(`${base}/api/configuracoes`, { headers: authHeaders })).json();
    assert.equal(cfgInicial.sucesso, true);
    assert.equal(cfgInicial.dados.certificacaoAutomatica, false);

    // Obtém dois alunos distintos da base local piloto
    const solRes = await (await fetch(`${base}/api/solicitacoes`, { headers: authHeaders })).json();
    assert.ok(solRes.dados.length >= 2, 'Base local deve ter pelo menos 2 alunos para testar ambos os modos');
    const alunoManual = solRes.dados[0];
    const alunoAuto = solRes.dados[1];

    // 2. Com interruptor DESATIVADO: Aluno 1 envia o formulário -> NÃO deve emitir no Lyra ainda!
    const payloadAluno1 = {
      professor: false,
      confirmacao: true,
      periodosSugeridos: [
        {
          indice: 1,
          curso: alunoManual.cursos[0]?.curso || 'Curso Manual',
          contrato: alunoManual.cursos[0]?.contrato || '',
          dataInicio: '2026-03-02',
          dataFim: '2026-04-02',
          dataInicioFormatada: '02/03/2026',
          dataFimFormatada: '02/04/2026',
          aceite: 'Aceito'
        }
      ]
    };

    const respEnvio1 = await fetch(`${base}/api/link/${alunoManual.token}/resposta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadAluno1)
    });
    assert.equal(respEnvio1.status, 200);
    const jsonEnvio1 = await respEnvio1.json();
    assert.equal(jsonEnvio1.sucesso, true);
    assert.equal(aprovacoesLyra.length, 0, 'Com interruptor desativado, Lyra não pode ser chamado no envio do aluno');

    // Verifica no Kanban que o card está em EMITIR aguardando emissão manual
    const solApos1 = await (await fetch(`${base}/api/solicitacoes`, { headers: authHeaders })).json();
    const cardManual = solApos1.dados.find((d) => d.token === alunoManual.token);
    assert.equal(cardManual.status, 'EMITIR');
    assert.equal(cardManual.resposta.emitidoNoLyra, false);
    assert.equal(cardManual.resposta.aguardandoEmissaoManual, true);

    // 3. Colaborador clica em "Emitir" no card da coluna EMITIR -> emite no Lyra com as datas do aluno!
    const respEmitirManual = await fetch(`${base}/api/solicitacoes/${alunoManual.token}/emitir`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(respEmitirManual.status, 200);
    const jsonEmitirManual = await respEmitirManual.json();
    assert.equal(jsonEmitirManual.sucesso, true);
    assert.equal(jsonEmitirManual.resposta.emitidoNoLyra, true);
    assert.equal(aprovacoesLyra.length, 1, 'Clique em Emitir deve aprovar no Lyra');
    assert.equal(aprovacoesLyra[0].dataCourse.startDate, '2026-03-02T03:00:00.000Z');
    assert.equal(aprovacoesLyra[0].dataCourse.endDate, '2026-04-02T03:00:00.000Z');

    // Segundo clique em "Emitir" para o mesmo aluno deve ser bloqueado (409) para evitar dupla emissão
    const respDuplo = await fetch(`${base}/api/solicitacoes/${alunoManual.token}/emitir`, {
      method: 'POST',
      headers: authHeaders
    });
    assert.equal(respDuplo.status, 409);

    // 4. Liga o interruptor no painel (certificacaoAutomatica = true)
    const respToggleOn = await fetch(`${base}/api/configuracoes`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ certificacaoAutomatica: true })
    });
    assert.equal(respToggleOn.status, 200);
    const jsonToggleOn = await respToggleOn.json();
    assert.equal(jsonToggleOn.dados.certificacaoAutomatica, true);

    // Reinicia o servidor para garantir que o estado do interruptor sobrevive ao restart!
    await parar(servidor);
    servidor = await iniciarServidor(env);

    const cfgAposRestart = await (await fetch(`${base}/api/configuracoes`, { headers: authHeaders })).json();
    assert.equal(cfgAposRestart.dados.certificacaoAutomatica, true, 'Estado do interruptor deve persistir após reinício');

    // 5. Com interruptor ATIVO: Aluno 2 envia o formulário -> emite automaticamente no Lyra na hora!
    const payloadAluno2 = {
      professor: false,
      confirmacao: true,
      periodosSugeridos: [
        {
          indice: 1,
          curso: alunoAuto.cursos[0]?.curso || 'Curso Auto',
          contrato: alunoAuto.cursos[0]?.contrato || '',
          dataInicio: '2026-05-04',
          dataFim: '2026-06-04',
          dataInicioFormatada: '04/05/2026',
          dataFimFormatada: '04/06/2026',
          aceite: 'Aceito'
        }
      ]
    };

    const respEnvio2 = await fetch(`${base}/api/link/${alunoAuto.token}/resposta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadAluno2)
    });
    assert.equal(respEnvio2.status, 200);
    const jsonEnvio2 = await respEnvio2.json();
    assert.equal(jsonEnvio2.sucesso, true);
    assert.equal(aprovacoesLyra.length, 2, 'Com interruptor ativo, Lyra deve emitir automaticamente no envio do aluno');
    assert.equal(aprovacoesLyra[1].dataCourse.startDate, '2026-05-04T03:00:00.000Z');
    assert.equal(aprovacoesLyra[1].dataCourse.endDate, '2026-06-04T03:00:00.000Z');

    const solApos2 = await (await fetch(`${base}/api/solicitacoes`, { headers: authHeaders })).json();
    const cardAuto = solApos2.dados.find((d) => d.token === alunoAuto.token);
    assert.equal(cardAuto.resposta.emitidoNoLyra, true);
    assert.equal(cardAuto.resposta.emissaoModo, 'AUTOMATICA');
  } finally {
    await parar(servidor);
    mockLyra.close();
  }
});
