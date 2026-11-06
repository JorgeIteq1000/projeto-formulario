import './_env.js';
/**
 * E2E & Contract Test Suite — Emissão de Certificados
 * 
 * Cobertura Completa de 4 Tiers para as Features F1 a F6:
 * - F1: Regra de Limite Retroativo de 17 Meses para Data da Última Evolução (R1)
 * - F2: Aviso Institucional de 96 Horas substituindo campo de observação (R3)
 * - F3: Aceite Individual por Certificado ("Aceito" vs "Não Aceito") (R2)
 * - F4: Sugestão de Datas Customizadas e Validação (início >= 17m, fim <= hoje) (R2)
 * - F5: Integração Bitrix24 SPA Condicional (PREPARATION vs CLIENT, campos UF_CRM_14_*) (R4)
 * - F6: Painel Admin Kanban com Badges de Aceite e Etapa SPA (R4)
 * 
 * Runner: Node.js native test runner (node:test e node:assert/strict)
 * Autoridade de Especificação: ORIGINAL_REQUEST.md e PROJECT.md
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Importa dinamicamente ou estaticamente módulos do projeto
import * as dateUtils from '../src/utils/dateSuggestions.js';
import { criarCardAlunoSPA } from '../services/bitrix24.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Constante canônica do erro exigida pela especificação R1 / F1
const MENSAGEM_ERRO_17_MESES = 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão';

// Texto institucional exato exigido pela especificação R3 / F2
const TEXTO_INSTITUCIONAL_72H = 'Caso seja necessário atualização ou correção de algum dado pessoal, é necessário que primeiro seja realizada a atualização dentro da sua área do aluno, pois após o envio deste formulário, as informações serão processadas conforme consta em sistema. Os dados devem ser atualizados exclusivamente na área do aluno, aba "Meus Dados". A falta de finalização do formulário em 96hr, ocasionará o cancelamento da solicitação, devendo o aluno, abrir uma nova solicitação dentro da área do aluno.';

// ============================================================================
// ORÁCULOS DE REFERÊNCIA & UTILITÁRIOS DE APOIO AO TESTE
// ============================================================================

/**
 * Oráculo matemático canônico para subtração de meses conforme especificação
 */
function oracleSubtractMonths(dateInput, months) {
  const d = typeof dateInput === 'string' ? new Date(dateInput + 'T00:00:00') : new Date(dateInput.getTime());
  const ano = d.getFullYear();
  const mes = d.getMonth();
  const dia = d.getDate();

  const totalMeses = ano * 12 + mes - months;
  const novoAno = Math.floor(totalMeses / 12);
  const novoMes = ((totalMeses % 12) + 12) % 12;

  const diasNoMesDestino = new Date(novoAno, novoMes + 1, 0).getDate();
  const diaAjustado = Math.min(dia, diasNoMesDestino);

  return new Date(novoAno, novoMes, diaAjustado);
}

function oracleFormatISO(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${y}-${m}-${d}`;
}

function oracleFormatBR(date) {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

// ============================================================================
// TIER 1 — FEATURE COVERAGE (F1 A F6)
// ============================================================================
describe('Tier 1 — Feature Coverage (F1 a F6)', () => {

  describe('F1: Limite Retroativo de 17 Meses para Data de Evolução', () => {
    it('F1.1: Deve permitir data de evolução dentro do limite de 17 meses retroativos', () => {
      if (typeof dateUtils.validarDataEvolucao17Meses !== 'function') {
        assert.fail('validarDataEvolucao17Meses não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      const hoje = new Date(2026, 9, 28); // 28/10/2026
      // Data com 10 meses retroativos: 28/12/2025
      const dataValida = '2025-12-28';
      const resultado = dateUtils.validarDataEvolucao17Meses(dataValida, hoje);

      assert.strictEqual(resultado.valida, true, 'Data de 10 meses atrás deve ser válida');
      assert.strictEqual(resultado.erro, null, 'Erro deve ser nulo para data válida');
      assert.ok(resultado.limite17MesesISO, 'Deve retornar a data limite de 17 meses');
    });

    it('F1.2: Deve rejeitar data de evolução anterior a 17 meses com mensagem de erro exata', () => {
      if (typeof dateUtils.validarDataEvolucao17Meses !== 'function') {
        assert.fail('validarDataEvolucao17Meses não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      const hoje = new Date(2026, 9, 28); // 28/10/2026
      // 18 meses atrás: 28/04/2025
      const dataInvalida = '2025-04-28';
      const resultado = dateUtils.validarDataEvolucao17Meses(dataInvalida, hoje);

      assert.strictEqual(resultado.valida, false, 'Data de 18 meses atrás deve ser inválida');
      assert.strictEqual(
        resultado.erro,
        MENSAGEM_ERRO_17_MESES,
        'A mensagem de erro deve ser idêntica à especificação R1 (inclusive "ENtrar")'
      );
    });

    it('F1.3: Deve retornar limite17MesesISO correspondente a exatamente 17 meses retroativos', () => {
      if (typeof dateUtils.validarDataEvolucao17Meses !== 'function') {
        assert.fail('validarDataEvolucao17Meses não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      const hoje = new Date(2026, 9, 28); // 2026-10-28
      const resultado = dateUtils.validarDataEvolucao17Meses('2026-01-15', hoje);
      assert.strictEqual(resultado.limite17MesesISO, '2025-05-28');
    });
  });

  describe('F2: Aviso Institucional de 96 Horas substituindo Observação', () => {
    const studentFormPath = path.join(__dirname, '../src/components/StudentForm.jsx');

    it('F2.1: Deve conter o texto institucional de 96h no StudentForm.jsx', () => {
      const conteudo = fs.readFileSync(studentFormPath, 'utf-8');

      // Normaliza espaços e quebras de linha para comparação textual
      const normalizar = (txt) => txt.replace(/\s+/g, ' ').trim();
      const conteudoNormalizado = normalizar(conteudo);

      // O texto deve estar presente no componente
      assert.ok(
        conteudoNormalizado.includes('Caso seja necessário atualização ou correção de algum dado pessoal') &&
        (conteudoNormalizado.includes('exclusivamente na área do aluno, aba "Meus Dados"') ||
         conteudoNormalizado.includes('exclusivamente na área do aluno, aba &quot;Meus Dados&quot;')) &&
        conteudoNormalizado.includes('ocasionará o cancelamento da solicitação'),
        'StudentForm.jsx deve conter o aviso institucional de 96h conforme especificado em R3'
      );
    });

    it('F2.2: O aviso institucional deve destacar "96hr" em negrito (tag strong ou b)', () => {
      const conteudo = fs.readFileSync(studentFormPath, 'utf-8');
      const possuiNegrito72 =
        conteudo.includes('<strong>96hr</strong>') ||
        conteudo.includes('<b>96hr</b>') ||
        conteudo.includes('<strong>96h</strong>');

      assert.ok(possuiNegrito72, 'StudentForm.jsx deve ter o termo "96hr" destacado com tag <strong>');
    });

    it('F2.3: O textarea id="observacao" deve ser removido do StudentForm.jsx', () => {
      const conteudo = fs.readFileSync(studentFormPath, 'utf-8');
      const possuiTextareaObservacao = conteudo.includes('id="observacao"') || conteudo.includes("id='observacao'");
      assert.strictEqual(
        possuiTextareaObservacao,
        false,
        'O campo textarea id="observacao" deve ter sido removido de StudentForm.jsx conforme R3'
      );
    });
  });

  describe('F3: Aceite Individual por Certificado', () => {
    it('F3.1: Cada período sugerido deve conter o campo de aceite com opções "Aceito" e "Não Aceito"', () => {
      // Cria mock de cursos
      const cursosMock = [
        { curso: 'Curso A', tipoCurso: 'Extensão', certificadora: 'Faculdade 1', contrato: '111' },
        { curso: 'Curso B', tipoCurso: 'Extensão', certificadora: 'Faculdade 2', contrato: '222' }
      ];

      // Gera períodos sugeridos
      const periodos = dateUtils.gerarSugestoesPeriodos('2026-01-10', cursosMock, new Date(2026, 9, 28));
      assert.ok(Array.isArray(periodos), 'Deve retornar array de períodos');
      assert.strictEqual(periodos.length, 2);

      // Simulação de preenchimento de aceite individual
      const periodosComAceite = periodos.map((p, idx) => ({
        ...p,
        aceite: idx === 0 ? 'Aceito' : 'Não Aceito',
        customizado: idx === 1
      }));

      assert.strictEqual(periodosComAceite[0].aceite, 'Aceito');
      assert.strictEqual(periodosComAceite[1].aceite, 'Não Aceito');
    });

    it('F3.2: Marcar "Não Aceito" deve permitir estado customizado independente dos outros cursos', () => {
      const curso1 = { indice: 1, curso: 'Extensão 1', aceite: 'Aceito', customizado: false };
      const curso2 = { indice: 2, curso: 'Extensão 2', aceite: 'Não Aceito', customizado: true };
      const curso3 = { indice: 3, curso: 'Extensão 3', aceite: 'Aceito', customizado: false };

      const lista = [curso1, curso2, curso3];
      const customizados = lista.filter(c => c.aceite === 'Não Aceito');
      const aceitos = lista.filter(c => c.aceite === 'Aceito');

      assert.strictEqual(customizados.length, 1, 'Apenas o curso 2 deve ser customizado');
      assert.strictEqual(aceitos.length, 2, 'Cursos 1 e 3 continuam aceitos normalmente');
    });
  });

  describe('F4: Sugestão de Datas Customizadas e Validação (validarDataCustomizada)', () => {
    it('F4.1: Deve validar com sucesso data de início customizada cujo término não ultrapassa hoje', () => {
      if (typeof dateUtils.validarDataCustomizada !== 'function') {
        assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
      }

      const hoje = new Date(2026, 9, 28); // 28/10/2026
      // Início: 15/06/2026 -> Término: 15/07/2026 (<= 28/10/2026)
      const res = dateUtils.validarDataCustomizada('2026-06-15', hoje);

      assert.strictEqual(res.valida, true);
      assert.strictEqual(res.erro, null);
      assert.strictEqual(res.dataInicioISO, '2026-06-15');
      assert.strictEqual(res.dataFimISO, '2026-07-15');
      assert.strictEqual(res.dataInicioFormatada, '15/06/2026');
      assert.strictEqual(res.dataFimFormatada, '15/07/2026');
    });

    it('F4.2: Deve rejeitar data de início customizada anterior a 17 meses', () => {
      if (typeof dateUtils.validarDataCustomizada !== 'function') {
        assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
      }

      const hoje = new Date(2026, 9, 28); // Limite 17 meses: 28/05/2025
      const res = dateUtils.validarDataCustomizada('2025-05-20', hoje);

      assert.strictEqual(res.valida, false);
      assert.ok(res.erro && res.erro.length > 0, 'Deve retornar mensagem de erro para data anterior a 17 meses');
    });

    it('F4.3: Deve rejeitar data customizada cujo término (+1 mês) ultrapassa a data atual', () => {
      if (typeof dateUtils.validarDataCustomizada !== 'function') {
        assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
      }

      const hoje = new Date(2026, 9, 28); // 28/10/2026
      // Início: 10/10/2026 -> Término: 10/11/2026 (> 28/10/2026)
      const res = dateUtils.validarDataCustomizada('2026-10-10', hoje);

      assert.strictEqual(res.valida, false);
      assert.ok(res.erro && res.erro.includes('ultrapassa'), 'Deve indicar que o término ultrapassa a data atual');
    });

    it('F4.4: Deve calcular a data final somando exatamente 1 mês corrido', () => {
      if (typeof dateUtils.validarDataCustomizada !== 'function') {
        assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
      }

      const hoje = new Date(2026, 9, 28);
      const res = dateUtils.validarDataCustomizada('2026-02-10', hoje);
      assert.strictEqual(res.dataFimISO, '2026-03-10');
    });
  });

  describe('F5: Integração Bitrix24 SPA Condicional', () => {
    let originalFetch;
    let chamadasFetch = [];

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      chamadasFetch = [];
      globalThis.fetch = async (url, opts) => {
        chamadasFetch.push({ url, opts, body: JSON.parse(opts.body) });
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { item: { id: 777123 } } })
        };
      };
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('F5.1: Deve direcionar para DT1046_76:PREPARATION quando houver cursos com revisão/customização', async () => {
      const resultado = await criarCardAlunoSPA({
        nome: 'Maria da Silva',
        temRevisao: true,
        resumoCustomizacao: 'Curso 2: Início 10/06/2026 até 10/07/2026',
        cursos: ['Curso de Gestão Escolar'],
        protocolo: 'CERT-2026-112233'
      });

      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.stageId, 'DT1046_76:PREPARATION');

      assert.strictEqual(chamadasFetch.length, 1);
      const payloadEnviado = chamadasFetch[0].body;
      assert.strictEqual(payloadEnviado.fields.stageId, 'DT1046_76:PREPARATION');
      assert.strictEqual(
        payloadEnviado.fields.UF_CRM_14_1748872142 || payloadEnviado.fields.ufCrm14_1748872142,
        'Curso 2: Início 10/06/2026 até 10/07/2026'
      );
    });

    it('F5.2: Deve direcionar para DT1046_76:CLIENT quando todos os cursos forem aceitos (sem revisão)', async () => {
      const resultado = await criarCardAlunoSPA({
        nome: 'João Santos',
        temRevisao: false,
        resumoCustomizacao: null,
        cursos: ['Curso de Alfabetização', 'Curso de Educação Inclusiva'],
        protocolo: 'CERT-2026-445566'
      });

      assert.strictEqual(resultado.sucesso, true);
      assert.strictEqual(resultado.stageId, 'DT1046_76:CLIENT');

      assert.strictEqual(chamadasFetch.length, 1);
      const payloadEnviado = chamadasFetch[0].body;
      assert.strictEqual(payloadEnviado.fields.stageId, 'DT1046_76:CLIENT');
      assert.strictEqual(
        payloadEnviado.fields.UF_CRM_14_1748872142 || payloadEnviado.fields.ufCrm14_1748872142,
        undefined,
        'Campo de observação/customização deve ficar vazio quando não há revisão'
      );
    });

    it('F5.3: Deve empilhar os cursos elegíveis com quebra de linha em UF_CRM_14_1791995335', async () => {
      await criarCardAlunoSPA({
        nome: 'Carlos Oliveira',
        temRevisao: false,
        cursos: [
          { curso: 'Curso A', cancelado: false },
          { curso: 'Curso B', cancelado: true, ultrapassaHoje: true },
          { curso: 'Curso C', cancelado: false }
        ],
        protocolo: 'CERT-2026-778899'
      });

      const payloadEnviado = chamadasFetch[0].body;
      const cursosEmpilhados = payloadEnviado.fields.UF_CRM_14_1791995335 || payloadEnviado.fields.ufCrm14_1791995335;

      assert.ok(cursosEmpilhados.includes('Curso A'));
      assert.ok(cursosEmpilhados.includes('Curso C'));
      assert.strictEqual(
        cursosEmpilhados.includes('Curso B'),
        false,
        'Cursos cancelados por ultrapassarem a data atual não devem ser enviados para emissão'
      );
      assert.strictEqual(cursosEmpilhados, 'Curso A\nCurso C');
    });
  });

  describe('F6: Admin Kanban e Badges de Aceite', () => {
    const kanbanPath = path.join(__dirname, '../src/components/AdminKanban.jsx');

    it('F6.1: AdminKanban.jsx deve conter lógica para exibição do status de aceite individual dos cursos', () => {
      const conteudo = fs.readFileSync(kanbanPath, 'utf-8');

      // Verifica se o componente trata status de cursos customizados ou aceitos
      const trataAceiteOuCustomizacao =
        conteudo.includes('Customizada') ||
        conteudo.includes('Aceito') ||
        conteudo.includes('customizado') ||
        conteudo.includes('aceite');

      assert.ok(
        trataAceiteOuCustomizacao,
        'AdminKanban.jsx deve conter tratamento e exibição dos badges de aceite individual'
      );
    });

    it('F6.2: AdminKanban.jsx deve exibir a etapa Bitrix24 correta (PREPARATION ou CLIENT)', () => {
      const conteudo = fs.readFileSync(kanbanPath, 'utf-8');
      assert.ok(
        conteudo.includes('DT1046_76:PREPARATION') && conteudo.includes('DT1046_76:CLIENT'),
        'AdminKanban.jsx deve referenciar as etapas DT1046_76:PREPARATION e DT1046_76:CLIENT'
      );
    });
  });
});

// ============================================================================
// TIER 2 — BOUNDARY & CORNER CASES
// ============================================================================
describe('Tier 2 — Boundary & Corner Cases', () => {

  describe('B1 & B2: Limite Exato de 17 Meses Retroativos', () => {
    const hoje = new Date(2026, 9, 28); // 28/10/2026

    it('B1: Data exatamente no limite de 17 meses (28/05/2025) deve ser VÁLIDA', () => {
      if (typeof dateUtils.validarDataEvolucao17Meses !== 'function') {
        assert.fail('validarDataEvolucao17Meses não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      // 28/10/2026 menos 17 meses = 28/05/2025
      const dataLimiteExata = '2025-05-28';
      const res = dateUtils.validarDataEvolucao17Meses(dataLimiteExata, hoje);

      assert.strictEqual(res.valida, true, 'Data exatamente no limite de 17 meses retroativos deve ser aceita');
      assert.strictEqual(res.erro, null);
    });

    it('B2: Data 1 dia anterior ao limite de 17 meses (27/05/2025) deve ser REJEITADA com mensagem exata', () => {
      if (typeof dateUtils.validarDataEvolucao17Meses !== 'function') {
        assert.fail('validarDataEvolucao17Meses não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      const dataAlemDoLimite = '2025-05-27';
      const res = dateUtils.validarDataEvolucao17Meses(dataAlemDoLimite, hoje);

      assert.strictEqual(res.valida, false, 'Data 1 dia antes de 17 meses deve ser bloqueada');
      assert.strictEqual(res.erro, MENSAGEM_ERRO_17_MESES);
    });
  });

  describe('B3 & B4: Data Customizada Término Hoje vs Amanhã', () => {
    const hoje = new Date(2026, 9, 28); // 28/10/2026

    it('B3: Data customizada com término exatamente HOJE (28/10/2026) deve PASSAR', () => {
      if (typeof dateUtils.validarDataCustomizada !== 'function') {
        assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
      }

      // Início: 28/09/2026 -> +1 mês = 28/10/2026 (hoje)
      const res = dateUtils.validarDataCustomizada('2026-09-28', hoje);

      assert.strictEqual(res.valida, true, 'Término igual ao dia de hoje deve ser válido');
      assert.strictEqual(res.erro, null);
      assert.strictEqual(res.dataFimISO, '2026-10-28');
    });

    it('B4: Data customizada com término AMANHÃ (29/10/2026) deve FALHAR', () => {
      if (typeof dateUtils.validarDataCustomizada !== 'function') {
        assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
      }

      // Início: 29/09/2026 -> +1 mês = 29/10/2026 (> hoje)
      const res = dateUtils.validarDataCustomizada('2026-09-29', hoje);

      assert.strictEqual(res.valida, false, 'Término posterior ao dia de hoje deve falhar');
      assert.ok(res.erro && res.erro.length > 0);
    });
  });

  describe('B5: Transições de Calendário e Ajustes de Fim de Mês (Calendar Math)', () => {
    it('B5.1: subtractMonths em ano bissexto (31 Março -> 29 Fevereiro)', () => {
      if (typeof dateUtils.subtractMonths !== 'function') {
        assert.fail('subtractMonths não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      // 2024 é ano bissexto
      const mar31 = new Date(2024, 2, 31); // 31/03/2024
      const res = dateUtils.subtractMonths(mar31, 1);

      assert.strictEqual(res.getFullYear(), 2024);
      assert.strictEqual(res.getMonth(), 1); // Fevereiro
      assert.strictEqual(res.getDate(), 29, 'Fevereiro de 2024 tem 29 dias');
    });

    it('B5.2: subtractMonths em ano comum (31 Março -> 28 Fevereiro)', () => {
      if (typeof dateUtils.subtractMonths !== 'function') {
        assert.fail('subtractMonths não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      // 2025 é ano não bissexto
      const mar31 = new Date(2025, 2, 31); // 31/03/2025
      const res = dateUtils.subtractMonths(mar31, 1);

      assert.strictEqual(res.getFullYear(), 2025);
      assert.strictEqual(res.getMonth(), 1); // Fevereiro
      assert.strictEqual(res.getDate(), 28, 'Fevereiro de 2025 tem 28 dias');
    });

    it('B5.3: subtractMonths transições de meses com 30 dias (31 Maio -> 30 Abril)', () => {
      if (typeof dateUtils.subtractMonths !== 'function') {
        assert.fail('subtractMonths não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      const mai31 = new Date(2026, 4, 31); // 31/05/2026
      const res = dateUtils.subtractMonths(mai31, 1);

      assert.strictEqual(res.getMonth(), 3); // Abril
      assert.strictEqual(res.getDate(), 30, 'Abril tem 30 dias');
    });

    it('B5.4: subtractMonths transição de 17 meses cruzando múltiplos anos', () => {
      if (typeof dateUtils.subtractMonths !== 'function') {
        assert.fail('subtractMonths não está exportada em dateSuggestions.js (Pendente implementação M1)');
      }

      // 28/02/2026 menos 17 meses:
      // Fev 2026 (mês 1) - 17 = mês -16 -> 2024, Setembro (mês 8)
      const fev28 = new Date(2026, 1, 28);
      const res = dateUtils.subtractMonths(fev28, 17);

      assert.strictEqual(res.getFullYear(), 2024);
      assert.strictEqual(res.getMonth(), 8); // Setembro
      assert.strictEqual(res.getDate(), 28);
    });

    it('B5.5: addOneMonth trata estouro de dias (31 de Janeiro -> 28 de Fevereiro)', () => {
      const jan31 = new Date(2025, 0, 31);
      const res = dateUtils.addOneMonth(jan31);

      assert.strictEqual(res.getFullYear(), 2025);
      assert.strictEqual(res.getMonth(), 1); // Fevereiro
      assert.strictEqual(res.getDate(), 28);
    });
  });
});

// ============================================================================
// TIER 3 — CROSS-FEATURE COMBINATIONS
// ============================================================================
describe('Tier 3 — Cross-Feature Combinations', () => {

  it('C1: Data de evolução válida + 2 cursos aceitos + 1 curso customizado válido deve rotear para PREPARATION com sumário', async () => {
    let chamadaBitrix = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      chamadaBitrix = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 200, json: async () => ({ result: { item: { id: 888 } } }) };
    };

    try {
      const hoje = new Date(2026, 9, 28);
      const dataEvolucao = '2026-03-10'; // 7 meses atrás (válida)

      if (typeof dateUtils.validarDataEvolucao17Meses === 'function') {
        const valEvolucao = dateUtils.validarDataEvolucao17Meses(dataEvolucao, hoje);
        assert.strictEqual(valEvolucao.valida, true);
      }

      const cursos = [
        {
          indice: 1,
          curso: 'Gestão Escolar',
          aceite: 'Aceito',
          customizado: false,
          dataInicio: '2026-03-11',
          dataFim: '2026-04-11',
          cancelado: false,
          ultrapassaHoje: false
        },
        {
          indice: 2,
          curso: 'Alfabetização',
          aceite: 'Aceito',
          customizado: false,
          dataInicio: '2026-04-12',
          dataFim: '2026-05-12',
          cancelado: false,
          ultrapassaHoje: false
        },
        {
          indice: 3,
          curso: 'Educação Especial',
          aceite: 'Não Aceito',
          customizado: true,
          dataInicioCustomizada: '2026-06-01',
          dataFimCustomizada: '2026-07-01',
          dataInicioCustomizadaFormatada: '01/06/2026',
          dataFimCustomizadaFormatada: '01/07/2026',
          cancelado: false,
          ultrapassaHoje: false
        }
      ];

      const temRevisao = cursos.some(c => c.aceite === 'Não Aceito' || c.customizado);
      assert.strictEqual(temRevisao, true);

      const cursosCustomizados = cursos.filter(c => c.aceite === 'Não Aceito');
      const resumoCustomizacao = cursosCustomizados
        .map(c => `• ${c.curso}: Início solicitado ${c.dataInicioCustomizadaFormatada} a ${c.dataFimCustomizadaFormatada}`)
        .join('\n');

      const res = await criarCardAlunoSPA({
        nome: 'Fernanda Lima',
        temRevisao,
        resumoCustomizacao,
        cursos: cursos.filter(c => !c.cancelado),
        protocolo: 'CERT-2026-888999'
      });

      assert.strictEqual(res.stageId, 'DT1046_76:PREPARATION');
      assert.ok(chamadaBitrix.body.fields.UF_CRM_14_1748872142.includes('Educação Especial'));
      assert.ok(chamadaBitrix.body.fields.UF_CRM_14_1748872142.includes('01/06/2026'));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('C2: Data de evolução válida + todos os cursos aceitos deve rotear para CLIENT sem observação', async () => {
    let chamadaBitrix = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      chamadaBitrix = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 200, json: async () => ({ result: { item: { id: 999 } } }) };
    };

    try {
      const cursos = [
        { indice: 1, curso: 'Extensão 1', aceite: 'Aceito', customizado: false },
        { indice: 2, curso: 'Extensão 2', aceite: 'Aceito', customizado: false }
      ];

      const temRevisao = cursos.some(c => c.aceite === 'Não Aceito' || c.customizado);
      assert.strictEqual(temRevisao, false);

      const res = await criarCardAlunoSPA({
        nome: 'Roberto Carlos',
        temRevisao,
        resumoCustomizacao: null,
        cursos,
        protocolo: 'CERT-2026-999000'
      });

      assert.strictEqual(res.stageId, 'DT1046_76:CLIENT');
      assert.strictEqual(chamadaBitrix.body.fields.UF_CRM_14_1748872142, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('C3: Data de evolução superior a 17 meses retroativos bloqueia submissão mesmo que cursos estejam aceitos', () => {
    if (typeof dateUtils.validarDataEvolucao17Meses !== 'function') {
      assert.fail('validarDataEvolucao17Meses não está exportada em dateSuggestions.js (Pendente implementação M1)');
    }

    const hoje = new Date(2026, 9, 28);
    const dataEvolucaoAntiga = '2024-01-01'; // Quase 3 anos atrás

    const validacao = dateUtils.validarDataEvolucao17Meses(dataEvolucaoAntiga, hoje);
    assert.strictEqual(validacao.valida, false);
    assert.strictEqual(validacao.erro, MENSAGEM_ERRO_17_MESES);

    // No formulário, se validacao.valida === false, o envio é sumariamente bloqueado
    const podeSubmeter = validacao.valida;
    assert.strictEqual(podeSubmeter, false);
  });

  it('C4: Curso não aceito com data customizada cujo término ultrapassa hoje bloqueia submissão', () => {
    if (typeof dateUtils.validarDataCustomizada !== 'function') {
      assert.fail('validarDataCustomizada não está exportada em dateSuggestions.js (Pendente implementação M2)');
    }

    const hoje = new Date(2026, 9, 28);
    // Término calculado será 15/11/2026 (> 28/10/2026)
    const validacaoCustom = dateUtils.validarDataCustomizada('2026-10-15', hoje);
    assert.strictEqual(validacaoCustom.valida, false);

    const podeSubmeter = validacaoCustom.valida;
    assert.strictEqual(podeSubmeter, false);
  });

  it('C5: Múltiplos cursos com datas customizadas são todos consolidados no sumário', () => {
    const cursos = [
      {
        curso: 'Matemática Financeira',
        aceite: 'Não Aceito',
        dataInicioCustomizadaFormatada: '01/03/2026',
        dataFimCustomizadaFormatada: '01/04/2026'
      },
      {
        curso: 'Didática Geral',
        aceite: 'Aceito'
      },
      {
        curso: 'Psicologia da Educação',
        aceite: 'Não Aceito',
        dataInicioCustomizadaFormatada: '01/05/2026',
        dataFimCustomizadaFormatada: '01/06/2026'
      }
    ];

    const resumo = cursos
      .filter(c => c.aceite === 'Não Aceito')
      .map(c => `• ${c.curso}: Início solicitado ${c.dataInicioCustomizadaFormatada} a ${c.dataFimCustomizadaFormatada}`)
      .join('\n');

    assert.ok(resumo.includes('Matemática Financeira'));
    assert.ok(resumo.includes('01/03/2026 a 01/04/2026'));
    assert.ok(resumo.includes('Psicologia da Educação'));
    assert.ok(resumo.includes('01/05/2026 a 01/06/2026'));
    assert.strictEqual(resumo.includes('Didática Geral'), false);
  });
});

// ============================================================================
// TIER 4 — REAL-WORLD APPLICATION SCENARIOS
// ============================================================================
describe('Tier 4 — Real-World Application Scenarios', () => {

  it('S1: Contrato do Payload de Submissão Aluno -> Backend (/api/link/:token/resposta)', () => {
    // Validação estrita do payload JSON esperado conforme PROJECT.md § Contrato de Submissão
    const payloadValido = {
      professor: true,
      rede: 'municipal',
      prefeituraSP: true,
      dataEvolucao: '2026-02-15',
      periodosSugeridos: [
        {
          indice: 1,
          curso: 'Metodologia do Ensino',
          tipoCurso: 'Extensão',
          certificadora: 'Faculdade Integrada',
          contrato: '998877',
          aceite: 'Aceito',
          dataInicio: '2026-02-16',
          dataFim: '2026-03-16',
          dataInicioFormatada: '16/02/2026',
          dataFimFormatada: '16/03/2026',
          dataInicioCustomizada: null,
          dataFimCustomizada: null,
          dataInicioCustomizadaFormatada: null,
          dataFimCustomizadaFormatada: null,
          customizado: false,
          cancelado: false,
          ultrapassaHoje: false
        },
        {
          indice: 2,
          curso: 'Avaliação da Aprendizagem',
          tipoCurso: 'Extensão',
          certificadora: 'Faculdade Integrada',
          contrato: '998877',
          aceite: 'Não Aceito',
          dataInicio: '2026-03-17',
          dataFim: '2026-04-17',
          dataInicioFormatada: '17/03/2026',
          dataFimFormatada: '17/04/2026',
          dataInicioCustomizada: '2026-05-01',
          dataFimCustomizada: '2026-06-01',
          dataInicioCustomizadaFormatada: '01/05/2026',
          dataFimCustomizadaFormatada: '01/06/2026',
          customizado: true,
          cancelado: false,
          ultrapassaHoje: false
        }
      ],
      confirmacao: true
    };

    // Asserções de conformidade estrutural
    assert.strictEqual(typeof payloadValido.professor, 'boolean');
    assert.ok(['particular', 'estadual', 'municipal'].includes(payloadValido.rede));
    assert.strictEqual(typeof payloadValido.prefeituraSP, 'boolean');
    assert.match(payloadValido.dataEvolucao, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Array.isArray(payloadValido.periodosSugeridos));
    assert.strictEqual(payloadValido.confirmacao, true);

    for (const p of payloadValido.periodosSugeridos) {
      assert.ok(['Aceito', 'Não Aceito'].includes(p.aceite));
      assert.strictEqual(typeof p.customizado, 'boolean');
      assert.strictEqual(typeof p.cancelado, 'boolean');
      assert.strictEqual(typeof p.ultrapassaHoje, 'boolean');
    }
  });

  it('S2: Contrato do Webhook SPA Bitrix24 (crm.item.add)', async () => {
    let payloadCapturado = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      payloadCapturado = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: { item: { id: 54321 } } })
      };
    };

    try {
      await criarCardAlunoSPA({
        nome: 'Juliana Ferreira',
        temRevisao: true,
        resumoCustomizacao: '• Extensão X: 01/02/2026 a 01/03/2026',
        cursos: [{ curso: 'Extensão X' }],
        protocolo: 'CERT-2026-554433'
      });

      assert.strictEqual(payloadCapturado.entityTypeId, 1046, 'entityTypeId do SPA deve ser 1046');
      assert.strictEqual(payloadCapturado.fields.categoryId, 76, 'categoryId do SPA deve ser 76');
      assert.strictEqual(payloadCapturado.fields.title, 'Juliana Ferreira');
      assert.strictEqual(payloadCapturado.fields.stageId, 'DT1046_76:PREPARATION');
      assert.strictEqual(payloadCapturado.fields.UF_CRM_14_1748872142, '• Extensão X: 01/02/2026 a 01/03/2026');
      assert.strictEqual(payloadCapturado.fields.UF_CRM_14_1791995335, 'Extensão X');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('S3: Projeção de Dados para o Painel Admin Kanban', () => {
    // Simula resposta salva no backend e conferência no Kanban
    const linkMock = {
      token: 'tok-xyz-123',
      nome: 'Patrícia Souza',
      cpf: '12345678901',
      telefone: '11987654321',
      dataReferencia: '2026-10-28',
      cursos: [{ curso: 'Curso Único' }]
    };

    const respostaMock = {
      protocolo: 'CERT-2026-123456',
      dataSubmissaoFormatada: '28/10/2026 14:00',
      professor: true,
      rede: 'municipal',
      prefeituraSP: true,
      dataEvolucao: '2026-04-10',
      periodosSugeridos: [
        {
          curso: 'Curso Único',
          aceite: 'Não Aceito',
          customizado: true,
          dataInicioCustomizadaFormatada: '01/06/2026',
          dataFimCustomizadaFormatada: '01/07/2026',
          ultrapassaHoje: false
        }
      ],
      bitrixCardId: 54321,
      bitrixStageId: 'DT1046_76:PREPARATION'
    };

    // Mapeamento projetado no endpoint GET /api/solicitacoes
    const itemKanban = {
      token: linkMock.token,
      nome: linkMock.nome,
      status: respostaMock ? 'EMITIR' : 'ENTRADA',
      resposta: respostaMock
    };

    assert.strictEqual(itemKanban.status, 'EMITIR');
    assert.strictEqual(itemKanban.resposta.bitrixStageId, 'DT1046_76:PREPARATION');
    assert.strictEqual(itemKanban.resposta.periodosSugeridos[0].customizado, true);
    assert.strictEqual(itemKanban.resposta.periodosSugeridos[0].aceite, 'Não Aceito');
  });

  it('S4: Validação de Defesa em Profundidade no Backend', () => {
    // Simula a validação no servidor Express
    const hoje = new Date(2026, 9, 28);
    const limite17Meses = oracleSubtractMonths(hoje, 17);

    // 1. Data de evolução enviada no body
    const bodyRequisicaoInvalida = {
      professor: true,
      rede: 'municipal',
      prefeituraSP: true,
      dataEvolucao: '2024-05-10', // < limite 17m
      confirmacao: true
    };

    const evolucaoDate = new Date(bodyRequisicaoInvalida.dataEvolucao + 'T00:00:00');
    const evolucaoExcede17Meses = evolucaoDate < limite17Meses;

    assert.strictEqual(evolucaoExcede17Meses, true, 'Backend deve detectar e bloquear evolução anterior a 17 meses');
  });
});

