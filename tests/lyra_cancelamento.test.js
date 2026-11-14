import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criptografarRotaLyra,
  descriptografarRotaLyra,
  selecionarSolicitacaoCorrespondente,
  cancelarSolicitacaoLyra,
  limparCacheTokenLyra,
  LYRA_DEFAULT_CANCEL_REASON,
} from '../services/lyra.js';

test('criptografarRotaLyra e descriptografarRotaLyra são compatíveis com OpenSSL/Lyra', () => {
  const tokenCurl1 =
    'U2FsdGVkX1+U5P/zasRHvRplN8OEpnA0OrAzffNOxrc5xbOKl9PNYvmGyIdZrPQgNGQ4ZkUPzq59zEhNZkDKnmDh8nY7gY/ttB7cBonRlAX8qsOApwqPSdDtRMd0GUdF';
  assert.equal(
    descriptografarRotaLyra(tokenCurl1),
    'certificates/certificate-solicitations/6af49cce26aaec0823b812ca/cancel',
  );

  const rota = 'certificates/certificate-solicitations/1234567890abcdef12345678/cancel';
  const cifrado = criptografarRotaLyra(rota);
  assert.ok(cifrado.startsWith('U2FsdGVkX1'));
  assert.equal(descriptografarRotaLyra(cifrado), rota);
});

test('selecionarSolicitacaoCorrespondente encontra por contrato (_enrolmentId) ou curso normalizado', () => {
  const lista = [
    {
      _id: '6af49ca410b9458d40bfa6b1',
      _enrolmentId: '6af464227cb7141a1f1371d6',
      status: 'waiting_approval',
      dataStudent: { name: 'Ianca Pires Paulino', cpf: '43777553824' },
      dataCourse: { course: 'A AVALIAÇÃO COMO ORIENTAÇÃO DO APRENDIZADO' },
    },
    {
      _id: '6af49cce26aaec0823b812ca',
      _enrolmentId: '6af4647cdcecc91a297faf96',
      status: 'waiting_approval',
      dataStudent: { name: 'Ianca Pires Paulino', cpf: '43777553824' },
      dataCourse: { course: 'A ADMINISTRAÇÃO ECONÔMICO-FINANCEIRA NAS INSTITUIÇÕES DE ENSINO' },
    },
  ];

  const porContrato = selecionarSolicitacaoCorrespondente(lista, {
    cpf: '437.775.538-24',
    contrato: '6af4647cdcecc91a297faf96',
    curso: 'OUTRO',
  });
  assert.equal(porContrato?._id, '6af49cce26aaec0823b812ca');

  const porCurso = selecionarSolicitacaoCorrespondente(lista, {
    cpf: '43777553824',
    curso: 'a avaliacao como orientacao do aprendizado',
  });
  assert.equal(porCurso?._id, '6af49ca410b9458d40bfa6b1');
});

test('cancelarSolicitacaoLyra autentica, busca waiting_approval e envia PUT /cancel', async () => {
  limparCacheTokenLyra();
  process.env.LYRA_EMAIL = 'bot@iteq.test';
  process.env.LYRA_PASSWORD = 'segredo-teste';

  const chamadas = [];
  const fakeFetch = async (url, init = {}) => {
    chamadas.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body });

    if (init.method === 'POST') {
      return new Response(
        JSON.stringify({
          code: 200,
          data: { user: { authorization: 'Bearer jwt-fake-123' } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if ((init.method || 'GET') === 'GET') {
      return new Response(
        JSON.stringify({
          code: 200,
          data: [
            {
              _id: '6af49cce26aaec0823b812ca',
              _enrolmentId: '6af4647cdcecc91a297faf96',
              status: 'waiting_approval',
              dataStudent: { name: 'Ianca Pires Paulino', cpf: '43777553824' },
              dataCourse: { course: 'A ADMINISTRAÇÃO ECONÔMICO-FINANCEIRA NAS INSTITUIÇÕES DE ENSINO' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (init.method === 'PUT') {
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'ok',
          data: { _id: '6af49cce26aaec0823b812ca', status: 'canceled' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    throw new Error(`Método inesperado: ${init.method}`);
  };

  const res = await cancelarSolicitacaoLyra(
    {
      cpf: '437.775.538-24',
      nome: 'Ianca Pires Paulino',
      curso: 'A ADMINISTRAÇÃO ECONÔMICO-FINANCEIRA NAS INSTITUIÇÕES DE ENSINO',
      contrato: '6af4647cdcecc91a297faf96',
    },
    { fetchImpl: fakeFetch },
  );

  assert.equal(res.ok, true);
  assert.equal(res.solicitationId, '6af49cce26aaec0823b812ca');
  assert.equal(res.status, 'canceled');
  assert.equal(chamadas.length, 3);
  assert.equal(chamadas[2].method, 'PUT');
  assert.equal(chamadas[2].headers.Authorization, 'Bearer jwt-fake-123');
  assert.equal(chamadas[2].headers.Company, 'iteq');
  assert.deepEqual(JSON.parse(chamadas[2].body), { reason: LYRA_DEFAULT_CANCEL_REASON });

  const tokenPut = chamadas[2].url.split('https://api-gateway.faculdadeesp.com.br/')[1];
  assert.equal(
    descriptografarRotaLyra(tokenPut),
    'certificates/certificate-solicitations/6af49cce26aaec0823b812ca/cancel',
  );
});

test('cancelarSolicitacaoLyra retorna notFound quando não encontra pendente no Lyra', async () => {
  limparCacheTokenLyra();
  process.env.LYRA_EMAIL = 'bot@iteq.test';
  process.env.LYRA_PASSWORD = 'segredo-teste';

  const fakeFetch = async (_url, init = {}) => {
    if (init.method === 'POST') {
      return new Response(
        JSON.stringify({ code: 200, data: { user: { authorization: 'Bearer jwt-fake-123' } } }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ code: 200, data: [] }), { status: 200 });
  };

  const res = await cancelarSolicitacaoLyra(
    { cpf: '11122233344', curso: 'CURSO INEXISTENTE' },
    { fetchImpl: fakeFetch },
  );

  assert.equal(res.ok, false);
  assert.equal(res.notFound, true);
});
