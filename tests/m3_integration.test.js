import './_env.js';
/**
 * M3 Integration & Verification Test Suite
 * Covers:
 * - services/bitrix24.js: criarCardAlunoSPA conditional stage routing & field mapping
 * - server.js: Defense-in-depth 17-month and custom dates validations
 * - AdminKanban.jsx: Course badges and SPA stage display
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { criarCardAlunoSPA } from '../services/bitrix24.js';
import { validarDataEvolucao17Meses, validarDataCustomizada } from '../src/utils/dateSuggestions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Worker M3 Integration Tests', () => {

  describe('1. Bitrix24 SPA Conditional Routing (services/bitrix24.js)', () => {
    let originalFetch;
    let requests;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      requests = [];
      globalThis.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        requests.push({ url, body });
        return {
          ok: true,
          status: 200,
          json: async () => ({ result: { item: { id: 98765 } } })
        };
      };
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('M3.1: Should route to DT1046_76:PREPARATION when temRevisao is true and populate custom dates summary', async () => {
      const res = await criarCardAlunoSPA({
        nome: 'Aluno Teste Revisao',
        temRevisao: true,
        resumoCustomizacao: '• Curso Teste: Início solicitado 01/05/2026 a 01/06/2026',
        cursos: [{ curso: 'Curso Teste' }],
        protocolo: 'CERT-2026-000111'
      });

      assert.strictEqual(res.sucesso, true);
      assert.strictEqual(res.stageId, 'DT1046_76:PREPARATION');
      assert.strictEqual(requests.length, 1);
      assert.strictEqual(requests[0].body.fields.stageId, 'DT1046_76:PREPARATION');
      assert.strictEqual(
        requests[0].body.fields.UF_CRM_14_1748872142,
        '• Curso Teste: Início solicitado 01/05/2026 a 01/06/2026'
      );
      assert.strictEqual(requests[0].body.fields.UF_CRM_14_1791995335, 'Curso Teste');
    });

    it('M3.2: Should auto-detect non-accepted course in cursos array and route to DT1046_76:PREPARATION', async () => {
      const res = await criarCardAlunoSPA({
        nome: 'Aluno Auto Detect',
        cursos: [
          { curso: 'Curso Aceito', aceite: 'Aceito' },
          { curso: 'Curso Custom', aceite: 'Não Aceito', dataInicioFormatada: '10/05/2026', dataFimFormatada: '10/06/2026' }
        ],
        protocolo: 'CERT-2026-000222'
      });

      assert.strictEqual(res.sucesso, true);
      assert.strictEqual(res.stageId, 'DT1046_76:PREPARATION');
      assert.ok(requests[0].body.fields.UF_CRM_14_1748872142.includes('Curso Custom'));
      assert.ok(requests[0].body.fields.UF_CRM_14_1791995335.includes('Curso Aceito'));
      assert.ok(requests[0].body.fields.UF_CRM_14_1791995335.includes('Curso Custom'));
    });

    it('M3.3: Should route to DT1046_76:CLIENT when all courses are accepted', async () => {
      const res = await criarCardAlunoSPA({
        nome: 'Aluno Tudo Aceito',
        temRevisao: false,
        resumoCustomizacao: null,
        cursos: [
          { curso: 'Curso 1', aceite: 'Aceito' },
          { curso: 'Curso 2', aceite: 'Aceito' }
        ],
        protocolo: 'CERT-2026-000333'
      });

      assert.strictEqual(res.sucesso, true);
      assert.strictEqual(res.stageId, 'DT1046_76:CLIENT');
      assert.strictEqual(requests[0].body.fields.stageId, 'DT1046_76:CLIENT');
      assert.strictEqual(requests[0].body.fields.UF_CRM_14_1748872142, undefined);
      assert.strictEqual(requests[0].body.fields.UF_CRM_14_1791995335, 'Curso 1\nCurso 2');
    });
  });

  describe('2. Backend Defense-in-Depth Validations (server.js logic)', () => {
    it('M3.4: Evolution date older than 17 months is blocked with exact error', () => {
      const dataAntiga = '2024-01-15';
      const hoje = new Date(2026, 9, 28);
      const res = validarDataEvolucao17Meses(dataAntiga, hoje);

      assert.strictEqual(res.valida, false);
      assert.strictEqual(
        res.erro,
        'O período não pode ser contabilizado. Entre em contato com a Central de Atendimento, pelo telefone (11) 2074-5110, no setor de Emissão.'
      );
    });

    it('M3.5: Non-accepted course with custom date exceeding today is blocked', () => {
      const hoje = new Date(2026, 9, 28);
      // Início em 10/10/2026 -> Término em 10/11/2026 (> hoje)
      const res = validarDataCustomizada('2026-10-10', hoje);
      assert.strictEqual(res.valida, false);
      assert.ok(res.erro.includes('ultrapassa'));
    });

    it('M3.6: Non-accepted course with valid custom date passes validation', () => {
      const hoje = new Date(2026, 9, 28);
      const res = validarDataCustomizada('2026-06-01', hoje);
      assert.strictEqual(res.valida, true);
      assert.strictEqual(res.erro, null);
      assert.strictEqual(res.dataInicioISO, '2026-06-01');
      assert.strictEqual(res.dataFimISO, '2026-07-01');
    });
  });

  describe('3. Admin Kanban UI Conformance (AdminKanban.jsx)', () => {
    const kanbanPath = path.resolve(__dirname, '../src/components/AdminKanban.jsx');
    const source = fs.readFileSync(kanbanPath, 'utf-8');

    it('M3.7: AdminKanban.jsx contains badge for Accepted course', () => {
      assert.ok(source.includes('✓ Aceito'));
      assert.ok(source.includes('#4ade80'));
    });

    it('M3.8: AdminKanban.jsx contains badge for Customized course with requested dates', () => {
      assert.ok(source.includes('✏️ Data Customizada:'));
      assert.ok(source.includes('#fbbf24'));
    });

    it('M3.9: AdminKanban.jsx contains badge for Canceled future date', () => {
      assert.ok(source.includes('[CANCELADO - DATA FUTURA]'));
      assert.ok(source.includes('#ef4444'));
    });

    it('M3.10: AdminKanban.jsx displays SPA stage dynamically with fallback to PREPARATION or CLIENT', () => {
      assert.ok(source.includes('DT1046_76:PREPARATION'));
      assert.ok(source.includes('DT1046_76:CLIENT'));
      assert.ok(source.includes('resumoCustomizacao'));
    });
  });
});
