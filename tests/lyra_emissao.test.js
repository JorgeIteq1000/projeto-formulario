import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugificarLyra,
  converterDataParaIsoLyra,
  descriptografarRotaLyra,
  emitirCertificadoLyra,
  limparCacheTokenLyra,
} from '../services/lyra.js';

test('slugificarLyra e converterDataParaIsoLyra seguem exatamente o padrão do Lyra', () => {
  assert.equal(
    slugificarLyra('Faculdade De Tecnologia Alpha Channel'),
    'faculdade-de-tecnologia-alpha-channel',
  );
  assert.equal(slugificarLyra('Extensão Presencial'), 'extensao-presencial');
  assert.equal(converterDataParaIsoLyra('2026-01-01'), '2026-01-01T03:00:00.000Z');
  assert.equal(converterDataParaIsoLyra('01/05/2026'), '2026-05-01T03:00:00.000Z');
});

test('emitirCertificadoLyra busca build-data, next-book-registry, atualiza datas e aprova certificado', async () => {
  limparCacheTokenLyra();
  process.env.LYRA_EMAIL = 'bot@iteq.test';
  process.env.LYRA_PASSWORD = 'segredo-teste';

  const chamadas = [];
  const fakeFetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const pathToken = url.startsWith('https://api-gateway.faculdadeesp.com.br/')
      ? url.split('https://api-gateway.faculdadeesp.com.br/')[1]
      : null;
    const rotaLimpa = pathToken && pathToken.startsWith('U2FsdGVkX1') && method !== 'POST'
      ? descriptografarRotaLyra(pathToken)
      : url;

    chamadas.push({
      method,
      rotaLimpa,
      body: init.body ? JSON.parse(init.body) : null,
    });

    if (method === 'POST') {
      return new Response(
        JSON.stringify({ code: 200, data: { user: { authorization: 'Bearer jwt-emissao' } } }),
        { status: 200 },
      );
    }

    if (method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations?')) {
      return new Response(
        JSON.stringify({
          code: 200,
          data: [
            {
              _id: '6af86d4310b9458d40c032d1',
              _enrolmentId: '6af4647cdcecc91a297faf96',
              status: 'waiting_approval',
              dataStudent: { name: 'Ianca Pires Paulino', cpf: '43777553824' },
              dataCourse: { course: 'A ADMINISTRAÇÃO ECONÔMICO-FINANCEIRA NAS INSTITUIÇÕES DE ENSINO' },
            },
          ],
        }),
        { status: 200 },
      );
    }

    if (method === 'GET' && rotaLimpa === 'certificates/certificate-solicitations/build-data/6af86d4310b9458d40c032d1') {
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            type: 'digital',
            dataStudent: {
              name: 'Ianca Pires Paulino',
              cpf: '43777553824',
              rg: '383435055',
              studentRegistrationCode: 3999,
              naturalessCity: 'São Paulo',
              naturalessState: 'SP',
              nationality: 'Brasileiro (a)',
              birthDate: '1996-03-17T03:00:00.000Z',
            },
            dataCourse: {
              objective: null,
              program: null,
              certifier: 'Faculdade De Tecnologia Alpha Channel',
              courseType: 'Extensão Presencial',
              course: 'A ADMINISTRAÇÃO ECONÔMICO-FINANCEIRA NAS INSTITUIÇÕES DE ENSINO',
              workload: 45,
              startDate: '2026-01-01T03:00:00.000Z',
              endDate: '2026-05-01T03:00:00.000Z',
              knowledgeArea: 'Educação',
            },
            disciplines: [
              {
                frequency: 100,
                grade: 10,
                _name: 'A Administração Econômico-financeira nas Instituições de Ensino',
                workload: 45,
                teacher: 'Nádia Lima da Cruz',
                titration: 'especialista',
              },
            ],
          },
        }),
        { status: 200 },
      );
    }

    if (
      method === 'GET' &&
      rotaLimpa === 'certificates/certificate-solicitations/next-book-registry/faculdade-de-tecnologia-alpha-channel/extensao-presencial'
    ) {
      return new Response(
        JSON.stringify({
          code: 200,
          data: { book: 4, sheet: 9, registry: 820 },
        }),
        { status: 200 },
      );
    }

    if (method === 'PUT' && rotaLimpa === 'certificates/certificate-solicitations/6af86d4310b9458d40c032d1') {
      return new Response(
        JSON.stringify({ code: 200, message: 'ok', data: { _id: '6af86d4310b9458d40c032d1', status: 'waiting_approval' } }),
        { status: 200 },
      );
    }

    if (method === 'PUT' && rotaLimpa === 'certificates/certificate-solicitations/6af86d4310b9458d40c032d1/approve') {
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'ok',
          data: {
            _id: '6af86d4310b9458d40c032d1',
            status: 'approved',
            metadata: { _certificateId: '6af86e546049a646377db9eb' },
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Rota inesperada nos testes: ${method} ${rotaLimpa}`);
  };

  const res = await emitirCertificadoLyra(
    {
      cpf: '437.775.538-24',
      nome: 'Ianca Pires Paulino',
      curso: 'A ADMINISTRAÇÃO ECONÔMICO-FINANCEIRA NAS INSTITUIÇÕES DE ENSINO',
      contrato: '6af4647cdcecc91a297faf96',
      dataInicio: '2025-08-10',
      dataFim: '2025-12-15',
    },
    { fetchImpl: fakeFetch },
  );

  assert.equal(res.ok, true);
  assert.equal(res.status, 'approved');
  assert.equal(res.solicitationId, '6af86d4310b9458d40c032d1');
  assert.equal(res.certificateId, '6af86e546049a646377db9eb');
  assert.deepEqual(res.bookRegistry, { book: 4, sheet: 9, registry: 820 });

  assert.equal(chamadas.length, 6);
  const putUpdate = chamadas[4];
  const putApprove = chamadas[5];

  assert.equal(putUpdate.method, 'PUT');
  assert.equal(putUpdate.rotaLimpa, 'certificates/certificate-solicitations/6af86d4310b9458d40c032d1');
  assert.equal(putUpdate.body.dataCourse.startDate, '2025-08-10T03:00:00.000Z');
  assert.equal(putUpdate.body.dataCourse.endDate, '2025-12-15T03:00:00.000Z');
  assert.deepEqual(putUpdate.body.bookRegistry, { book: 4, sheet: 9, registry: 820 });

  assert.equal(putApprove.method, 'PUT');
  assert.equal(putApprove.rotaLimpa, 'certificates/certificate-solicitations/6af86d4310b9458d40c032d1/approve');
  assert.equal(putApprove.body.dataCourse.startDate, '2025-08-10T03:00:00.000Z');
  assert.equal(putApprove.body.dataCourse.endDate, '2025-12-15T03:00:00.000Z');
});

test('emitirCertificadoLyra serializa emissões simultâneas para não repetir bookRegistry', async () => {
  limparCacheTokenLyra();
  process.env.LYRA_EMAIL = 'bot@iteq.test';
  process.env.LYRA_PASSWORD = 'segredo-teste';

  let proximoRegistro = 820;
  let loginsRealizados = 0;
  const eventos = [];

  const fakeFetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const pathToken = url.startsWith('https://api-gateway.faculdadeesp.com.br/')
      ? url.split('https://api-gateway.faculdadeesp.com.br/')[1]
      : null;
    const rotaLimpa =
      pathToken && pathToken.startsWith('U2FsdGVkX1') && method !== 'POST'
        ? descriptografarRotaLyra(pathToken)
        : url;

    if (method === 'POST') {
      loginsRealizados += 1;
      await new Promise((r) => setTimeout(r, 15));
      return new Response(
        JSON.stringify({ code: 200, data: { user: { authorization: 'Bearer jwt-concorrencia' } } }),
        { status: 200 },
      );
    }

    if (method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations/build-data/')) {
      const id = rotaLimpa.split('/').pop();
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            type: 'digital',
            dataStudent: { name: `Aluno ${id}`, cpf: '12345678900' },
            dataCourse: {
              certifier: 'Faculdade De Tecnologia Alpha Channel',
              courseType: 'Extensão Presencial',
              course: 'CURSO TESTE',
              workload: 45,
              knowledgeArea: 'Educação',
            },
            disciplines: [],
          },
        }),
        { status: 200 },
      );
    }

    if (method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations/next-book-registry/')) {
      const regAtual = proximoRegistro;
      eventos.push(`next:${regAtual}`);
      return new Response(JSON.stringify({ code: 200, data: { book: 4, sheet: 9, registry: regAtual } }), { status: 200 });
    }

    if (method === 'PUT' && rotaLimpa.endsWith('/approve')) {
      const body = JSON.parse(init.body);
      await new Promise((r) => setTimeout(r, 20));
      proximoRegistro += 1;
      eventos.push(`approve:${body.bookRegistry.registry}`);
      return new Response(
        JSON.stringify({
          code: 200,
          data: { status: 'approved', metadata: { _certificateId: `cert-${body.bookRegistry.registry}` } },
        }),
        { status: 200 },
      );
    }

    if (method === 'PUT') {
      return new Response(JSON.stringify({ code: 200, data: { status: 'waiting_approval' } }), { status: 200 });
    }

    throw new Error(`Rota inesperada: ${method} ${rotaLimpa}`);
  };

  const [res1, res2] = await Promise.all([
    emitirCertificadoLyra(
      { solicitationId: 'aaaaaaaaaaaaaaaaaaaaaaaa', dataInicio: '2026-01-01', dataFim: '2026-05-01' },
      { fetchImpl: fakeFetch },
    ),
    emitirCertificadoLyra(
      { solicitationId: 'bbbbbbbbbbbbbbbbbbbbbbbb', dataInicio: '2026-01-01', dataFim: '2026-05-01' },
      { fetchImpl: fakeFetch },
    ),
  ]);

  assert.equal(loginsRealizados, 1);
  assert.equal(res1.bookRegistry.registry, 820);
  assert.equal(res2.bookRegistry.registry, 821);
  assert.deepEqual(eventos, ['next:820', 'approve:820', 'next:821', 'approve:821']);
});

test('emitirCertificadoLyra reconsulta next-book-registry quando PUT /approve retorna conflito 409', async () => {
  limparCacheTokenLyra();
  process.env.LYRA_EMAIL = 'bot@iteq.test';
  process.env.LYRA_PASSWORD = 'segredo-teste';

  let tentativaLivro = 0;
  const fakeFetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const pathToken = url.startsWith('https://api-gateway.faculdadeesp.com.br/')
      ? url.split('https://api-gateway.faculdadeesp.com.br/')[1]
      : null;
    const rotaLimpa =
      pathToken && pathToken.startsWith('U2FsdGVkX1') && method !== 'POST'
        ? descriptografarRotaLyra(pathToken)
        : url;

    if (method === 'POST') {
      return new Response(
        JSON.stringify({ code: 200, data: { user: { authorization: 'Bearer jwt-retry' } } }),
        { status: 200 },
      );
    }

    if (method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations/build-data/')) {
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            type: 'digital',
            dataStudent: { name: 'Aluno Retry', cpf: '12345678900' },
            dataCourse: {
              certifier: 'Faculdade De Tecnologia Alpha Channel',
              courseType: 'Extensão Presencial',
              course: 'CURSO RETRY',
              workload: 45,
            },
            disciplines: [],
          },
        }),
        { status: 200 },
      );
    }

    if (method === 'GET' && rotaLimpa.startsWith('certificates/certificate-solicitations/next-book-registry/')) {
      tentativaLivro += 1;
      return new Response(
        JSON.stringify({ code: 200, data: { book: 4, sheet: 9, registry: 819 + tentativaLivro } }),
        { status: 200 },
      );
    }

    if (method === 'PUT' && rotaLimpa.endsWith('/approve')) {
      const body = JSON.parse(init.body);
      if (body.bookRegistry.registry === 820) {
        return new Response(JSON.stringify({ message: 'Registro já utilizado' }), { status: 409 });
      }
      return new Response(
        JSON.stringify({ code: 200, data: { status: 'approved', metadata: { _certificateId: 'cert-821' } } }),
        { status: 200 },
      );
    }

    if (method === 'PUT') {
      return new Response(JSON.stringify({ code: 200, data: { status: 'waiting_approval' } }), { status: 200 });
    }

    throw new Error(`Rota inesperada: ${method} ${rotaLimpa}`);
  };

  const res = await emitirCertificadoLyra(
    { solicitationId: 'cccccccccccccccccccccccc', dataInicio: '2026-01-01', dataFim: '2026-05-01' },
    { fetchImpl: fakeFetch },
  );

  assert.equal(tentativaLivro, 2);
  assert.equal(res.ok, true);
  assert.equal(res.bookRegistry.registry, 821);
  assert.equal(res.certificateId, 'cert-821');
});
