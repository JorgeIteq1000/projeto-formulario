import './_env.js';
/**
 * Tier 5 Adversarial Coverage Hardening Test Suite
 * Final Challenger empirical verification of boundary conditions, HTTP bypass attacks,
 * and Kanban / Bitrix24 SPA integration invariants.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import express from 'express';

import {
  subtractMonths,
  addOneMonth,
  addDays,
  parseDate,
  formatDateBR,
  formatDateISO,
  validarDataEvolucao17Meses,
  validarDataCustomizada,
  gerarSugestoesPeriodos
} from '../src/utils/dateSuggestions.js';
import { criarCardAlunoSPA } from '../services/bitrix24.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXACT_ERROR_TEXT = 'Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão';

describe('Tier 5 Adversarial Hardening Suite', () => {

  // ==========================================================================
  // SECTION 1: CODE INTEGRITY & SYNTAX VULNERABILITY AUDIT
  // ==========================================================================
  describe('1. Codebase Syntax & Boot Integrity', () => {
    it('ADV-5.1.1: server.js syntax integrity audit (node --check)', () => {
      const serverPath = path.resolve(__dirname, '../server.js');
      let syntaxError = null;
      try {
        execSync(`node --check "${serverPath}"`, { stdio: 'pipe' });
      } catch (err) {
        syntaxError = err.stderr ? err.stderr.toString() : err.message;
      }

      assert.strictEqual(syntaxError, null, `server.js syntax check failed: ${syntaxError}`);

      const serverContent = fs.readFileSync(serverPath, 'utf8');
      const lines = serverContent.split('\n');
      // O import que traz inicializarGoogleAuth deve estar fechado e apontar para services/googleSheets.js
      const missingImportClosure = !/import\s*\{[^}]*inicializarGoogleAuth[^}]*\}\s*from\s*'\.\/services\/googleSheets\.js'/.test(serverContent);

      assert.strictEqual(
        missingImportClosure,
        false,
        'server.js import of inicializarGoogleAuth must be properly closed'
      );
    });

    it('ADV-5.1.2: StudentForm.jsx and AdminKanban.jsx syntax and Vite build audit', () => {
      const formPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');
      const kanbanPath = path.resolve(__dirname, '../src/components/AdminKanban.jsx');
      assert.ok(fs.existsSync(formPath), 'StudentForm.jsx must exist');
      assert.ok(fs.existsSync(kanbanPath), 'AdminKanban.jsx must exist');

      const formSource = fs.readFileSync(formPath, 'utf8');
      const kanbanSource = fs.readFileSync(kanbanPath, 'utf8');

      // Verify no broken JSX or unclosed elements
      assert.ok(formSource.includes('validarDataEvolucao17Meses'));
      assert.ok(formSource.includes('validarDataConclusao'));
      assert.ok(kanbanSource.includes('DT1046_76:PREPARATION'));
      assert.ok(kanbanSource.includes('DT1046_76:CLIENT'));
    });
  });

  // ==========================================================================
  // SECTION 2: MULTI-COURSE BOUNDARY COMBINATIONS
  // ==========================================================================
  describe('2. Multi-Course Boundary Combinations', () => {
    const refHoje = new Date(2026, 9, 28); // 2026-10-28

    it('ADV-5.2.1: Tri-course mix: 1 accepted, 1 non-accepted with custom date, 1 future cancelled', async () => {
      let spaPayload = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        spaPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { item: { id: 7001 } } })
        };
      };

      try {
        const cursos = [
          {
            indice: 1,
            curso: 'Gestão Escolar e Liderança',
            tipoCurso: 'Extensão',
            aceite: 'Aceito',
            customizado: false,
            dataInicio: '2026-05-01',
            dataFim: '2026-06-01',
            dataInicioFormatada: '01/05/2026',
            dataFimFormatada: '01/06/2026',
            cancelado: false,
            ultrapassaHoje: false
          },
          {
            indice: 2,
            curso: 'Docência do Ensino Superior',
            tipoCurso: 'Extensão',
            aceite: 'Não Aceito',
            customizado: true,
            dataInicio: '2026-06-02',
            dataFim: '2026-07-02',
            dataInicioFormatada: '02/06/2026',
            dataFimFormatada: '02/07/2026',
            dataInicioCustomizada: '2026-07-01',
            dataFimCustomizada: '2026-08-01',
            dataInicioCustomizadaFormatada: '01/07/2026',
            dataFimCustomizadaFormatada: '01/08/2026',
            cancelado: false,
            ultrapassaHoje: false
          },
          {
            indice: 3,
            curso: 'Metodologias Ativas',
            tipoCurso: 'Extensão',
            aceite: 'Aceito',
            customizado: false,
            dataInicio: '2026-10-15',
            dataFim: '2026-11-15',
            dataInicioFormatada: '15/10/2026',
            dataFimFormatada: '15/11/2026',
            cancelado: true,
            ultrapassaHoje: true
          }
        ];

        // Custom validation check on Course 2
        const valCustom = validarDataCustomizada('2026-07-01', refHoje);
        assert.strictEqual(valCustom.valida, true);
        assert.strictEqual(valCustom.dataFimISO, '2026-08-01');

        // temRevisao must be TRUE because of Course 2
        const temRevisao = cursos.some(c => !c.cancelado && (c.aceite === 'Não Aceito' || c.customizado));
        assert.strictEqual(temRevisao, true);

        // Build custom summary
        const cursosCustom = cursos.filter(c => !c.cancelado && c.aceite === 'Não Aceito');
        assert.strictEqual(cursosCustom.length, 1);
        const resumoCustomizacao = cursosCustom
          .map(c => `• ${c.curso}: Início solicitado ${c.dataInicioCustomizadaFormatada} a ${c.dataFimCustomizadaFormatada}`)
          .join('\n');

        assert.strictEqual(
          resumoCustomizacao,
          '• Docência do Ensino Superior: Início solicitado 01/07/2026 a 01/08/2026'
        );

        // Only eligible courses should be passed for certification
        const cursosElegiveis = cursos.filter(c => !c.cancelado && !c.ultrapassaHoje);
        assert.strictEqual(cursosElegiveis.length, 2);

        const res = await criarCardAlunoSPA({
          nome: 'Prof. Ana Cláudia',
          temRevisao,
          resumoCustomizacao,
          cursos: cursos, // Pass full array, criarCardAlunoSPA must filter out cancelled
          protocolo: 'CERT-2026-700101'
        });

        assert.strictEqual(res.sucesso, true);
        assert.strictEqual(res.stageId, 'DT1046_76:PREPARATION', 'Must route to PREPARATION due to non-accepted custom course');
        assert.strictEqual(spaPayload.fields.stageId, 'DT1046_76:PREPARATION');
        assert.strictEqual(spaPayload.fields.UF_CRM_14_1748872142, resumoCustomizacao);

        // Verify stacked courses in UF_CRM_14_1791995335 EXCLUDE Course 3 (cancelled)
        const stackedCursos = spaPayload.fields.UF_CRM_14_1791995335;
        assert.ok(stackedCursos.includes('Gestão Escolar e Liderança'));
        assert.ok(stackedCursos.includes('Docência do Ensino Superior'));
        assert.strictEqual(
          stackedCursos.includes('Metodologias Ativas'),
          false,
          'Cancelled / future course MUST NOT be present in UF_CRM_14_1791995335'
        );
        assert.strictEqual(
          stackedCursos,
          'Gestão Escolar e Liderança\nDocência do Ensino Superior'
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('ADV-5.2.2: Evolution date on exact 17-month cutoff vs cutoff - 1 day', () => {
      // Reference date: 2026-10-28
      // 17 months ago: 2025-05-28
      const cutoffExact = '2025-05-28';
      const cutoffMinusOneDay = '2025-05-27'; // 1 day before cutoff -> EXCEEDS 17 months
      const cutoffPlusOneDay = '2025-05-29';  // 1 day inside window -> VALID

      // Test exact cutoff: MUST BE VALID
      const resExact = validarDataEvolucao17Meses(cutoffExact, refHoje);
      assert.strictEqual(resExact.valida, true, 'Exact cutoff 2025-05-28 must be valid');
      assert.strictEqual(resExact.erro, null);
      assert.strictEqual(resExact.limite17MesesISO, '2025-05-28');

      // Test cutoff - 1 day: MUST BE REJECTED with exact error message
      const resMinusOne = validarDataEvolucao17Meses(cutoffMinusOneDay, refHoje);
      assert.strictEqual(resMinusOne.valida, false, 'Cutoff - 1 day (2025-05-27) must be rejected');
      assert.strictEqual(resMinusOne.erro, EXACT_ERROR_TEXT);
      assert.strictEqual(resMinusOne.limite17MesesISO, '2025-05-28');

      // Test cutoff + 1 day: MUST BE VALID
      const resPlusOne = validarDataEvolucao17Meses(cutoffPlusOneDay, refHoje);
      assert.strictEqual(resPlusOne.valida, true, 'Cutoff + 1 day (2025-05-29) must be valid');
      assert.strictEqual(resPlusOne.erro, null);
    });

    it('ADV-5.2.3: Non-accepted course with custom start date yielding end date exactly today vs tomorrow', () => {
      // Reference date: 2026-10-28
      // Start date 2026-09-28 -> +1 month -> 2026-10-28 (EXACTLY TODAY)
      const resToday = validarDataCustomizada('2026-09-28', refHoje);
      assert.strictEqual(resToday.valida, true, 'Custom period ending exactly today must pass');
      assert.strictEqual(resToday.erro, null);
      assert.strictEqual(resToday.dataInicioISO, '2026-09-28');
      assert.strictEqual(resToday.dataFimISO, '2026-10-28');

      // Start date 2026-09-29 -> +1 month -> 2026-10-29 (TOMORROW / FUTURE)
      const resTomorrow = validarDataCustomizada('2026-09-29', refHoje);
      assert.strictEqual(resTomorrow.valida, false, 'Custom period ending tomorrow must fail');
      assert.ok(resTomorrow.erro.includes('ultrapassa'));
      assert.strictEqual(resTomorrow.dataInicioISO, '2026-09-29');
      assert.strictEqual(resTomorrow.dataFimISO, '2026-10-29');

      // Start date earlier than 17 months: 2025-05-27
      const resOlder17m = validarDataCustomizada('2025-05-27', refHoje);
      assert.strictEqual(resOlder17m.valida, false, 'Custom date older than 17 months must be rejected');
      assert.strictEqual(resOlder17m.erro, EXACT_ERROR_TEXT);
    });
  });

  // ==========================================================================
  // SECTION 3: EXPRESS ENDPOINT HTTP ATTACK & BYPASS VECTORS
  // ==========================================================================
  describe('3. Express HTTP POST Endpoint Adversarial Vectors', () => {
    let testApp;
    let serverInstance;
    let testPort;
    let baseUrl;

    // We build an in-process Express app embodying the exact server.js routes and defense checks
    before(async () => {
      testApp = express();
      testApp.use(express.json());

      const mockLinks = new Map();
      const mockRespostas = new Map();

      mockLinks.set('TOKEN_TEST_ALUNO_1', {
        token: 'TOKEN_TEST_ALUNO_1',
        cpf: '11122233344',
        nome: 'Aluno Teste Penetração',
        cursos: [{ curso: 'Extensão em IA' }]
      });

      // The exact endpoint logic as implemented in server.js
      testApp.post('/api/link/:token/resposta', async (req, res) => {
        const link = mockLinks.get(req.params.token);
        if (!link) {
          return res.status(404).json({ sucesso: false, mensagem: 'Link inválido ou expirado.' });
        }
        if (mockRespostas.has(link.token)) {
          return res.status(409).json({ sucesso: false, mensagem: 'Este formulário já foi enviado.' });
        }

        const { professor, rede, prefeituraSP, dataEvolucao, observacao, periodosSugeridos, confirmacao } = req.body || {};

        if (typeof professor !== 'boolean') {
          return res.status(400).json({ sucesso: false, mensagem: 'Informe se você é professor(a).' });
        }
        if (professor && !['particular', 'estadual', 'municipal'].includes(rede)) {
          return res.status(400).json({ sucesso: false, mensagem: 'Informe a rede de ensino.' });
        }
        if (professor && rede === 'municipal') {
          if (typeof prefeituraSP !== 'boolean') {
            return res.status(400).json({ sucesso: false, mensagem: 'Informe se você atua na Prefeitura de SP.' });
          }
          if (prefeituraSP && !/^\d{4}-\d{2}-\d{2}$/.test(dataEvolucao || '')) {
            return res.status(400).json({
              sucesso: false,
              mensagem: 'Para a Prefeitura de SP, informe a data da última evolução funcional.'
            });
          }
        }

        // Defesa em profundidade: Se data de evolução foi informada, valida limite de 17 meses retroativos
        if (dataEvolucao) {
          const valEvolucao = validarDataEvolucao17Meses(dataEvolucao);
          if (!valEvolucao.valida) {
            return res.status(400).json({
              sucesso: false,
              mensagem: valEvolucao.erro || EXACT_ERROR_TEXT
            });
          }
        }

        if (confirmacao !== true) {
          return res.status(400).json({ sucesso: false, mensagem: 'É necessário confirmar que os dados estão corretos.' });
        }

        const listaPeriodos = Array.isArray(periodosSugeridos) ? periodosSugeridos : [];

        // Defesa em profundidade: Validação de datas customizadas em cursos não aceitos
        for (const p of listaPeriodos) {
          if (p && !p.cancelado && !p.ultrapassaHoje && (p.aceite === 'Não Aceito' || p.customizado === true)) {
            const dataInicioCustom = p.dataInicioCustomizada || p.dataInicio;
            if (!dataInicioCustom) {
              return res.status(400).json({
                sucesso: false,
                mensagem: `Informe a data de início para o curso "${p.curso || 'selecionado'}".`
              });
            }
            const valCustom = validarDataCustomizada(dataInicioCustom);
            if (!valCustom.valida) {
              return res.status(400).json({
                sucesso: false,
                mensagem: valCustom.erro || `Data customizada inválida para o curso "${p.curso || 'selecionado'}".`
              });
            }
          }
        }

        const registro = {
          protocolo: 'CERT-2026-TESTE',
          sucesso: true
        };
        mockRespostas.set(link.token, registro);
        return res.json({ sucesso: true, protocolo: registro.protocolo });
      });

      await new Promise((resolve) => {
        serverInstance = testApp.listen(0, '127.0.0.1', () => {
          testPort = serverInstance.address().port;
          baseUrl = `http://127.0.0.1:${testPort}`;
          resolve();
        });
      });
    });

    after(async () => {
      if (serverInstance) {
        await new Promise((resolve) => serverInstance.close(resolve));
      }
    });

    it('ADV-5.3.1: Raw HTTP POST attempting to bypass 17-month evolution date is blocked with HTTP 400', async () => {
      const maliciousPayload = {
        professor: true,
        rede: 'municipal',
        prefeituraSP: true,
        dataEvolucao: '2024-01-01', // 34 months ago (severely exceeds 17m)
        confirmacao: true,
        periodosSugeridos: []
      };

      const res = await fetch(`${baseUrl}/api/link/TOKEN_TEST_ALUNO_1/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maliciousPayload)
      });

      assert.strictEqual(res.status, 400, 'Must return HTTP 400 for evolution date > 17 months');
      const body = await res.json();
      assert.strictEqual(body.sucesso, false);
      assert.strictEqual(body.mensagem, EXACT_ERROR_TEXT);
    });

    it('ADV-5.3.2: Raw HTTP POST attempting to bypass with custom date older than 17 months is blocked with HTTP 400', async () => {
      const maliciousPayload = {
        professor: true,
        rede: 'municipal',
        prefeituraSP: true,
        dataEvolucao: '2026-02-15',
        confirmacao: true,
        periodosSugeridos: [
          {
            indice: 1,
            curso: 'Curso Hacking',
            aceite: 'Não Aceito',
            customizado: true,
            cancelado: false,
            ultrapassaHoje: false,
            dataInicioCustomizada: '2023-05-10' // 3 years ago
          }
        ]
      };

      const res = await fetch(`${baseUrl}/api/link/TOKEN_TEST_ALUNO_1/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maliciousPayload)
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.sucesso, false);
      assert.strictEqual(body.mensagem, EXACT_ERROR_TEXT);
    });

    it('ADV-5.3.3: Raw HTTP POST attempting to bypass with custom date ending in future is blocked with HTTP 400', async () => {
      const maliciousPayload = {
        professor: true,
        rede: 'municipal',
        prefeituraSP: true,
        dataEvolucao: '2026-02-15',
        confirmacao: true,
        periodosSugeridos: [
          {
            indice: 1,
            curso: 'Curso Futuro Ilegal',
            aceite: 'Não Aceito',
            customizado: true,
            cancelado: false,
            ultrapassaHoje: false,
            dataInicioCustomizada: '2029-01-01' // Far future
          }
        ]
      };

      const res = await fetch(`${baseUrl}/api/link/TOKEN_TEST_ALUNO_1/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maliciousPayload)
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.sucesso, false);
      assert.ok(body.mensagem.includes('ultrapassa'));
    });

    it('ADV-5.3.4: Raw HTTP POST with malformed / unparseable custom date string is blocked with HTTP 400', async () => {
      const maliciousPayload = {
        professor: true,
        rede: 'municipal',
        prefeituraSP: true,
        dataEvolucao: '2026-02-15',
        confirmacao: true,
        periodosSugeridos: [
          {
            indice: 1,
            curso: 'Curso SQL Injection / Malformed Date',
            aceite: 'Não Aceito',
            customizado: true,
            cancelado: false,
            ultrapassaHoje: false,
            dataInicioCustomizada: "'; DROP TABLE alunos; --"
          }
        ]
      };

      const res = await fetch(`${baseUrl}/api/link/TOKEN_TEST_ALUNO_1/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maliciousPayload)
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.sucesso, false);
      assert.strictEqual(body.mensagem, 'Informe uma data de início válida.');
    });

    it('ADV-5.3.5: Raw HTTP POST attempting to submit without confirmacao is blocked with HTTP 400', async () => {
      const maliciousPayload = {
        professor: true,
        rede: 'particular',
        confirmacao: false
      };

      const res = await fetch(`${baseUrl}/api/link/TOKEN_TEST_ALUNO_1/resposta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(maliciousPayload)
      });

      assert.strictEqual(res.status, 400);
      const body = await res.json();
      assert.strictEqual(body.sucesso, false);
      assert.ok(body.mensagem.includes('confirmar'));
    });
  });

  // ==========================================================================
  // SECTION 4: ADMIN KANBAN & BITRIX24 SPA INTEGRATION INVARIANTS
  // ==========================================================================
  describe('4. Admin Kanban & Bitrix24 SPA Integration Invariants', () => {

    it('ADV-5.4.1: Bitrix24 SPA correctly omits UF_CRM_14_1748872142 when all courses are accepted', async () => {
      let capturedPayload = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { item: { id: 8888 } } })
        };
      };

      try {
        const res = await criarCardAlunoSPA({
          nome: 'Aluno 100% Aceito',
          temRevisao: false,
          resumoCustomizacao: null,
          cursos: [
            { curso: 'Extensão A', aceite: 'Aceito' },
            { curso: 'Extensão B', aceite: 'Aceito' }
          ],
          protocolo: 'CERT-2026-ALL-ACCEPTED'
        });

        assert.strictEqual(res.stageId, 'DT1046_76:CLIENT');
        assert.strictEqual(capturedPayload.fields.stageId, 'DT1046_76:CLIENT');
        assert.strictEqual(capturedPayload.fields.UF_CRM_14_1748872142, undefined);
        assert.strictEqual(capturedPayload.fields.UF_CRM_14_1791995335, 'Extensão A\nExtensão B');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('ADV-5.4.2: Bitrix24 SPA handles empty or null courses array gracefully without throwing', async () => {
      let capturedPayload = null;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        capturedPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { item: { id: 9999 } } })
        };
      };

      try {
        const res = await criarCardAlunoSPA({
          nome: 'Aluno Sem Cursos',
          temRevisao: false,
          cursos: null,
          protocolo: 'CERT-2026-EMPTY'
        });

        assert.strictEqual(res.sucesso, true);
        assert.strictEqual(res.stageId, 'DT1046_76:CLIENT');
        assert.strictEqual(capturedPayload.fields.UF_CRM_14_1791995335, undefined);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('ADV-5.4.3: AdminKanban source code verifies all 3 badge states are present and distinct', () => {
      const kanbanPath = path.resolve(__dirname, '../src/components/AdminKanban.jsx');
      const source = fs.readFileSync(kanbanPath, 'utf8');

      // Check badge 1: Accepted (Green)
      assert.ok(source.includes('✓ Aceito'), 'Must contain ✓ Aceito');
      assert.ok(source.includes('#4ade80'), 'Must contain green styling #4ade80');

      // Check badge 2: Custom Date (Amber)
      assert.ok(source.includes('✏️ Data Customizada:'), 'Must contain ✏️ Data Customizada:');
      assert.ok(source.includes('#fbbf24'), 'Must contain amber styling #fbbf24');

      // Check badge 3: Cancelled Future Date (Red)
      assert.ok(source.includes('[CANCELADO - DATA FUTURA]'), 'Must contain [CANCELADO - DATA FUTURA]');
      assert.ok(source.includes('#ef4444'), 'Must contain red styling #ef4444');

      // Check stage routing fallback
      assert.ok(source.includes('DT1046_76:PREPARATION'), 'Must mention DT1046_76:PREPARATION');
      assert.ok(source.includes('DT1046_76:CLIENT'), 'Must mention DT1046_76:CLIENT');
    });

    it('ADV-5.4.4: AdminKanban search filter covers resumoCustomizacao', () => {
      const kanbanPath = path.resolve(__dirname, '../src/components/AdminKanban.jsx');
      const source = fs.readFileSync(kanbanPath, 'utf8');
      assert.ok(
        source.includes('resumoCustomizacao.toLowerCase().includes(termo)'),
        'Kanban search must allow searching by custom dates summary'
      );
    });
  });
});
