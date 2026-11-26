import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  montarMensagemCertificado,
  montarMensagemLembreteDiario,
  montarMensagemAlerta2Horas,
  montarMensagemExpirado
} from '../Zionic/mensagemTemplate.js';
import { parseDataHoraFlexivel, sleep } from '../Zionic/reguaWhatsApp.js';

test('Zionic Templates: 1ª mensagem (D0) trata singular e plural corretamente com link', () => {
  const msgSingular = montarMensagemCertificado({
    nome: 'Carlos Eduardo da Silva',
    cursos: ['Gestão Escolar'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token123'
  });

  assert.ok(msgSingular.includes('Prezado(a) *Carlos*'));
  assert.ok(msgSingular.includes('sua solicitação de certificado referente ao curso'));
  assert.ok(msgSingular.includes('à sua solicitação'));
  assert.ok(msgSingular.includes('cancelamento da solicitação'));
  assert.ok(msgSingular.includes('Link: https://certificadoies.com.br/solicitacoes/token123'));

  const msgPlural = montarMensagemCertificado({
    nome: 'Carlos Eduardo da Silva',
    cursos: ['Gestão Escolar', 'Metodologias Ativas'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token123'
  });

  assert.ok(msgPlural.includes('suas solicitações de certificados referentes aos cursos'));
  assert.ok(msgPlural.includes('às suas solicitações'));
  assert.ok(msgPlural.includes('cancelamento das solicitações'));
});

test('Zionic Templates: 2ª mensagem (Lembrete) trata singular e plural corretamente', () => {
  const msgSingular = montarMensagemLembreteDiario({
    nome: 'Ana Beatriz Souza',
    cursos: ['Educação Infantil'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token456'
  });

  assert.ok(msgSingular.includes('Prezado(a) *Ana*'));
  assert.ok(msgSingular.includes('imprescindível o preenchimento para a emissão do seu certificado.'));
  assert.ok(msgSingular.includes('Link: https://certificadoies.com.br/solicitacoes/token456'));

  const msgPlural = montarMensagemLembreteDiario({
    nome: 'Ana Beatriz Souza',
    cursos: ['Educação Infantil', 'Ludicidade'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token456'
  });

  assert.ok(msgPlural.includes('dos seus certificados.'));
});

test('Zionic Templates: 3ª mensagem (Últimas 24h) alerta sobre prazo de 24 horas e portal do aluno', () => {
  const msg = montarMensagemAlerta2Horas({
    nome: 'Mariana Lima',
    cursos: ['Alfabetização e Letramento', 'Educação Especial'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token789'
  });

  assert.ok(msg.includes('Prezado(a) *Mariana*'));
  assert.ok(msg.includes('consta pendente o preenchimento do formulário enviado'));
  assert.ok(msg.includes('nas próximas 24 horas, as solicitações serão canceladas'));
  assert.ok(msg.includes('portal do aluno'));
  assert.ok(msg.includes('Link: https://certificadoies.com.br/solicitacoes/token789'));
});

test('Zionic Templates: 4ª mensagem (96h Expirado) informa falta de interação e concordância singular/plural', () => {
  const msgSingular = montarMensagemExpirado({
    nome: 'Roberto Santos',
    cursos: ['Psicopedagogia']
  });

  assert.ok(msgSingular.includes('Prezado(a) *Roberto*, por falta de interação, sua solicitação de certificado referente ao curso:'));
  assert.ok(msgSingular.includes('• *Psicopedagogia*'));
  assert.ok(msgSingular.includes('foi cancelada.'));
  assert.ok(msgSingular.includes('portal do aluno e será enviado um novo formulário.'));

  const msgPlural = montarMensagemExpirado({
    nome: 'Roberto Santos',
    cursos: ['Psicopedagogia', 'Neuropsicopedagogia']
  });

  assert.ok(msgPlural.includes('suas solicitações de certificados referentes aos cursos:'));
  assert.ok(msgPlural.includes('foram canceladas.'));
});

test('parseDataHoraFlexivel: faz parse correto de múltiplos formatos de data/hora', () => {
  const d1 = parseDataHoraFlexivel('14/11/2026 15:30:45');
  assert.equal(d1.getFullYear(), 2026);
  assert.equal(d1.getMonth(), 10);
  assert.equal(d1.getDate(), 14);
  assert.equal(d1.getHours(), 15);
  assert.equal(d1.getMinutes(), 30);
  assert.equal(d1.getSeconds(), 45);

  const d2 = parseDataHoraFlexivel('14/11/2026');
  assert.equal(d2.getFullYear(), 2026);
  assert.equal(d2.getMonth(), 10);
  assert.equal(d2.getDate(), 14);

  const d3 = parseDataHoraFlexivel('2026-11-14T10:00:00.000Z');
  assert.ok(d3 instanceof Date && !isNaN(d3.getTime()));

  assert.equal(parseDataHoraFlexivel(null), null);
  assert.equal(parseDataHoraFlexivel(''), null);
});

test('sleep: atrasa execução pelo tempo especificado', async () => {
  const t0 = Date.now();
  await sleep(50);
  const t1 = Date.now();
  assert.ok(t1 - t0 >= 40);
});
