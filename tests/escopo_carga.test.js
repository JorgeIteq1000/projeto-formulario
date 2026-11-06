import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tipoCursoNoEscopo } from '../services/escopo.js';
import { buscarCargaHoraria, definirCatalogo } from '../services/cargaHoraria.js';

test('escopo: aceita apenas Extensão e Aperfeiçoamento (e variantes)', () => {
  for (const t of ['Extensão', 'Aperfeiçoamento', 'Extensão Saúde', 'Aperfeiçoamento Presencial', 'extensao', '', undefined]) {
    assert.equal(tipoCursoNoEscopo(t), true, `deveria aceitar "${t}"`);
  }
  for (const t of ['Pós-Graduação', 'Capacitação', 'Atualização', 'Cursos Livres', 'MBA', 'Reingresso em Extensão', 'Projeto de Extensão']) {
    assert.equal(tipoCursoNoEscopo(t), false, `deveria ignorar "${t}"`);
  }
});

test('carga horária: busca por tipo + nome, ignorando acentos, caixa e sufixo de carga', () => {
  definirCatalogo([
    { tipo: 'Extensão', certificadora: 'FESP', curso: 'LUDICIDADE COMO RECURSO PEDAGÓGICO', carga: 100 },
    { tipo: 'Aperfeiçoamento', certificadora: 'FESP', curso: 'ARTE BRASILEIRA', carga: 180 }
  ]);
  assert.equal(buscarCargaHoraria('Extensão', 'Ludicidade como recurso pedagogico'), 100);
  assert.equal(buscarCargaHoraria('Extensão', 'LUDICIDADE COMO RECURSO PEDAGÓGICO - 100h'), 100);
  assert.equal(buscarCargaHoraria('Aperfeiçoamento', 'Arte Brasileira'), 180);
});

test('carga horária: o tipo distingue cursos de mesmo nome', () => {
  definirCatalogo([
    { tipo: 'Extensão', certificadora: 'FESP', curso: 'A ARTE E A MUSICALIZAÇÃO NA EDUCAÇÃO INFANTIL', carga: 100 },
    { tipo: 'Aperfeiçoamento', certificadora: 'FESP', curso: 'A ARTE E A MUSICALIZAÇÃO NA EDUCAÇÃO INFANTIL', carga: 180 }
  ]);
  assert.equal(buscarCargaHoraria('Extensão', 'A Arte e a Musicalização na Educação Infantil'), 100);
  assert.equal(buscarCargaHoraria('Aperfeiçoamento', 'A Arte e a Musicalização na Educação Infantil'), 180);
});

test('carga horária: nome com cargas diferentes só resolve pela certificadora; senão retorna null', () => {
  definirCatalogo([
    { tipo: 'Extensão', certificadora: 'FESP', curso: 'INCLUSÃO NA EDUCAÇÃO: TEORIA E APLICAÇÃO', carga: 120 },
    { tipo: 'Extensão', certificadora: 'FESP', curso: 'INCLUSÃO NA EDUCAÇÃO: TEORIA E APLICAÇÃO', carga: 100 },
    { tipo: 'Extensão', certificadora: 'Alpha Channel', curso: 'HISTÓRIA MODERNAS', carga: 1 },
    { tipo: 'Extensão', certificadora: 'FESP', curso: 'HISTÓRIA MODERNAS', carga: 100 }
  ]);
  // Mesma certificadora com duas cargas: ambíguo, não chuta
  assert.equal(buscarCargaHoraria('Extensão', 'Inclusão na Educação: Teoria e Aplicação', 'Faculdade do Estado de São Paulo'), null);
  // Certificadoras diferentes: desempata
  assert.equal(buscarCargaHoraria('Extensão', 'História Modernas', 'Faculdade De Tecnologia Alpha Channel'), 1);
  assert.equal(buscarCargaHoraria('Extensão', 'História Modernas', 'Faculdade do Estado de São Paulo'), 100);
  assert.equal(buscarCargaHoraria('Extensão', 'História Modernas'), null);
});

test('carga horária: curso desconhecido retorna null', () => {
  definirCatalogo([]);
  assert.equal(buscarCargaHoraria('Extensão', 'CURSO QUE NÃO EXISTE'), null);
});
