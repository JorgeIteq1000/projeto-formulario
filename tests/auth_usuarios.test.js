import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criarTokenSessao,
  validarTokenSessao,
  extrairTokenReq,
  criarMiddlewareAutenticacaoAdmin
} from '../services/authUsuarios.js';

test('criarTokenSessao e validarTokenSessao: gera token HMAC válido e decodifica usuário', () => {
  const secret = 'segredo-teste-auth-2026';
  const usuario = { login: 'jorge.augusto', nome: 'Jorge Augusto' };

  const token = criarTokenSessao(usuario, secret);
  assert.ok(typeof token === 'string' && token.includes('.'));

  const payload = validarTokenSessao(token, secret);
  assert.ok(payload);
  assert.equal(payload.login, 'jorge.augusto');
  assert.equal(payload.nome, 'Jorge Augusto');
  assert.ok(payload.exp > Math.floor(Date.now() / 1000));
});

test('validarTokenSessao: rejeita token adulterado ou com secret incorreto', () => {
  const secret = 'segredo-teste-auth-2026';
  const usuario = { login: 'ana.beatriz', nome: 'Ana Beatriz' };
  const token = criarTokenSessao(usuario, secret);

  // Secret incorreto
  assert.equal(validarTokenSessao(token, 'outro-segredo'), null);

  // Payload adulterado
  const [b64, sig] = token.split('.');
  const adulterado = Buffer.from(JSON.stringify({ login: 'hacker', exp: 9999999999 })).toString('base64url');
  assert.equal(validarTokenSessao(`${adulterado}.${sig}`, secret), null);

  // Token inválido / malformado
  assert.equal(validarTokenSessao('token-invalido', secret), null);
  assert.equal(validarTokenSessao('', secret), null);
  assert.equal(validarTokenSessao(null, secret), null);
});

test('extrairTokenReq: extrai token de Bearer header, x-auth-token e cookie', () => {
  const reqBearer = { headers: { authorization: 'Bearer meu-token-123' } };
  assert.equal(extrairTokenReq(reqBearer), 'meu-token-123');

  const reqHeader = { headers: { 'x-auth-token': 'meu-token-456' } };
  assert.equal(extrairTokenReq(reqHeader), 'meu-token-456');

  const reqCookie = { headers: { cookie: 'foo=bar; auth_token=meu-token-789; baz=qux' } };
  assert.equal(extrairTokenReq(reqCookie), 'meu-token-789');

  const reqVazio = { headers: {} };
  assert.equal(extrairTokenReq(reqVazio), null);
});

test('criarMiddlewareAutenticacaoAdmin: bloqueia quando não autenticado em AUTH_STRICT', () => {
  process.env.AUTH_STRICT = 'true';
  const middleware = criarMiddlewareAutenticacaoAdmin({ linkSecret: 'segredo-teste' });

  const req = { headers: {} };
  let statusEnviado = null;
  let jsonEnviado = null;
  const res = {
    status(s) {
      statusEnviado = s;
      return this;
    },
    json(j) {
      jsonEnviado = j;
      return this;
    }
  };
  let chamouNext = false;
  middleware(req, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, false);
  assert.equal(statusEnviado, 401);
  assert.equal(jsonEnviado?.sucesso, false);
  delete process.env.AUTH_STRICT;
});

test('criarMiddlewareAutenticacaoAdmin: permite acesso quando token Bearer é válido', () => {
  const secret = 'segredo-teste-middleware';
  const middleware = criarMiddlewareAutenticacaoAdmin({ linkSecret: secret });
  const token = criarTokenSessao({ login: 'jorge.augusto', nome: 'Jorge Augusto' }, secret);

  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {};
  let chamouNext = false;

  middleware(req, res, () => {
    chamouNext = true;
  });

  assert.equal(chamouNext, true);
  assert.equal(req.usuario?.login, 'jorge.augusto');
  assert.equal(req.usuario?.nome, 'Jorge Augusto');
});
