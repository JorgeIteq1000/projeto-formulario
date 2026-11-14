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

test('Zionic Templates: D0 Boas-vindas inclui primeiro nome, cursos e link seguro de 96h', () => {
  const msg = montarMensagemCertificado({
    nome: 'Carlos Eduardo da Silva',
    cursos: ['Gestão Escolar', 'Metodologias Ativas'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token123'
  });

  assert.ok(msg.includes('*Carlos*'));
  assert.ok(msg.includes('• *Gestão Escolar*'));
  assert.ok(msg.includes('• *Metodologias Ativas*'));
  assert.ok(msg.includes('https://certificadoies.com.br/solicitacoes/token123'));
  assert.ok(msg.includes('96 horas'));
});

test('Zionic Templates: Lembrete Diário inclui contagem de horas e link', () => {
  const msg = montarMensagemLembreteDiario({
    nome: 'Ana Beatriz Souza',
    cursos: ['Educação Infantil'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token456',
    horasRestantes: 48
  });

  assert.ok(msg.includes('*Ana*'));
  assert.ok(msg.includes('• *Educação Infantil*'));
  assert.ok(msg.includes('48 horas'));
  assert.ok(msg.includes('https://certificadoies.com.br/solicitacoes/token456'));
});

test('Zionic Templates: Alerta Crítico destaca 2 HORAS e urgência', () => {
  const msg = montarMensagemAlerta2Horas({
    nome: 'Mariana Lima',
    cursos: ['Alfabetização e Letramento'],
    linkUrl: 'https://certificadoies.com.br/solicitacoes/token789'
  });

  assert.ok(msg.includes('*Mariana*'));
  assert.ok(msg.includes('ÚLTIMAS 2 HORAS'));
  assert.ok(msg.includes('menos de 2 horas'));
  assert.ok(msg.includes('https://certificadoies.com.br/solicitacoes/token789'));
});

test('Zionic Templates: Aviso de Expirado informa cancelamento e instrui portal do aluno', () => {
  const msg = montarMensagemExpirado({
    nome: 'Roberto Santos',
    cursos: ['Psicopedagogia']
  });

  assert.ok(msg.includes('*Roberto*'));
  assert.ok(msg.includes('SOLICITAÇÃO EXPIRADA'));
  assert.ok(msg.includes('Portal do Aluno'));
  assert.ok(msg.includes('• *Psicopedagogia*'));
});

test('parseDataHoraFlexivel: faz parse correto de múltiplos formatos de data/hora', () => {
  // DD/MM/YYYY HH:mm:ss
  const d1 = parseDataHoraFlexivel('14/11/2026 15:30:45');
  assert.equal(d1.getFullYear(), 2026);
  assert.equal(d1.getMonth(), 10); // Novembro = 10 (0-indexed)
  assert.equal(d1.getDate(), 14);
  assert.equal(d1.getHours(), 15);
  assert.equal(d1.getMinutes(), 30);
  assert.equal(d1.getSeconds(), 45);

  // DD/MM/YYYY
  const d2 = parseDataHoraFlexivel('14/11/2026');
  assert.equal(d2.getFullYear(), 2026);
  assert.equal(d2.getMonth(), 10);
  assert.equal(d2.getDate(), 14);

  // ISO
  const d3 = parseDataHoraFlexivel('2026-11-14T10:00:00.000Z');
  assert.ok(d3 instanceof Date && !isNaN(d3.getTime()));

  // Nulo ou inválido
  assert.equal(parseDataHoraFlexivel(null), null);
  assert.equal(parseDataHoraFlexivel(''), null);
});

test('sleep: atrasa execução pelo tempo especificado', async () => {
  const t0 = Date.now();
  await sleep(50);
  const t1 = Date.now();
  assert.ok(t1 - t0 >= 40);
});
