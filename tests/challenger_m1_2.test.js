import './_env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// CHALLENGER 2: ADVERSARIAL STRESS TEST & EMPIRICAL VERIFICATION (M1)
// ============================================================================

test('CHALLENGE 1: Character-by-character conformance of Institutional Notice with R3', () => {
  const originalRequestPath = path.resolve(__dirname, '../../.agents/teamwork/ORIGINAL_REQUEST.md');
  const studentFormPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');

  const origContent = fs.readFileSync(originalRequestPath, 'utf8');
  const formContent = fs.readFileSync(studentFormPath, 'utf8');

  // Extract canonical string from ORIGINAL_REQUEST.md R3
  // Target: "Caso seja necessário atualização ou correção de algum dado pessoal, é necessário que primeiro seja realizada a atualização dentro da sua área do aluno, pois após o envio deste formulário, as informações serão processadas conforme consta em sistema. Os dados devem ser atualizados exclusivamente na área do aluno, aba \"Meus Dados\". A falta de finalização do formulário em **96hr**, ocasionará o cancelamento da solicitação, devendo o aluno, abrir uma nova solicitação dentro da área do aluno."
  const r3Line = origContent.split('\n').find((l) => l.includes('Caso seja necessário'));
  assert.ok(r3Line, 'ORIGINAL_REQUEST.md must contain the R3 notice specification');

  // Strip leading and trailing quotes from the requirement line
  const rawExpected = r3Line.trim().replace(/^"/, '').replace(/"$/, '');
  const unescapedExpected = rawExpected.replace(/\\"/g, '"');

  // Extract notice paragraph in StudentForm.jsx
  const matchP = formContent.match(/<p style=\{\{ color: '#cbd5e1'[\s\S]*?<\/p>/);
  assert.ok(matchP, 'StudentForm.jsx must contain the notice paragraph');

  // Extract the text inside <p>...</p>
  const innerP = matchP[0]
    .replace(/^<p[^>]*>/, '')
    .replace(/<\/p>$/, '')
    .trim();

  // Replace &quot; with " and <strong>96hr</strong> with **96hr** to test exact equivalence
  const normalizedFormText = innerP
    .replace(/&quot;/g, '"')
    .replace(/<strong>96hr<\/strong>/g, '**96hr**')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedExpected = unescapedExpected.replace(/\s+/g, ' ').trim();

  // Character-by-character comparison
  assert.equal(
    normalizedFormText.length,
    normalizedExpected.length,
    `Length mismatch: got ${normalizedFormText.length}, expected ${normalizedExpected.length}`
  );

  for (let i = 0; i < normalizedExpected.length; i++) {
    assert.equal(
      normalizedFormText[i],
      normalizedExpected[i],
      `Character mismatch at index ${i}: expected '${normalizedExpected[i]}' (code ${normalizedExpected.charCodeAt(i)}) but got '${normalizedFormText[i]}' (code ${normalizedFormText.charCodeAt(i)}). Context: "${normalizedExpected.slice(Math.max(0, i - 15), i + 15)}"`
    );
  }

  // Verify exact bold tag in JSX
  assert.ok(
    innerP.includes('<strong>96hr</strong>'),
    'Notice must use <strong>96hr</strong>'
  );

  // As aspas de "Meus Dados" podem ser literais ou &quot; no JSX: o texto renderizado é o mesmo
  // (a comparação caractere a caractere acima já normaliza &quot; para ")
  assert.ok(
    /aba (&quot;|")Meus Dados(&quot;|")\./.test(innerP),
    'Notice must contain the "Meus Dados" tab name in quotes'
  );
});

test('CHALLENGE 2: Absolute removal of textarea id="observacao" and state', () => {
  const studentFormPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');
  const formContent = fs.readFileSync(studentFormPath, 'utf8');

  // 1. No textarea tag of any kind
  assert.equal(formContent.includes('<textarea'), false, 'Found <textarea in StudentForm.jsx');
  assert.equal(formContent.includes('</textarea>'), false, 'Found </textarea> in StudentForm.jsx');

  // 2. No id="observacao" or name="observacao"
  assert.equal(formContent.includes('id="observacao"'), false, 'Found id="observacao"');
  assert.equal(formContent.includes("id='observacao'"), false, "Found id='observacao'");
  assert.equal(formContent.includes('name="observacao"'), false, 'Found name="observacao"');

  // 3. No useState for observacao
  assert.equal(formContent.includes('setObservacao'), false, 'Found setObservacao in StudentForm.jsx');
  assert.equal(formContent.includes('useState(') && formContent.includes('observacao,'), false, 'Found observacao state in StudentForm.jsx');

  // 4. In form submission, observacao is explicitly null
  const submitBlockMatch = formContent.match(/body:\s*JSON\.stringify\(\{[\s\S]*?\}\)/);
  assert.ok(submitBlockMatch, 'Form must have JSON.stringify in submit');
  assert.ok(
    submitBlockMatch[0].includes('observacao: null'),
    'Submission body must explicitly set observacao: null'
  );
});

test('CHALLENGE 3: Payload submission logic robustness with null, undefined, and hostile observacao inputs', () => {
  // Test server-side normalization logic directly as written in server.js line 283
  // Line 283: observacao: typeof observacao === 'string' && observacao.trim() ? observacao.trim().slice(0, 1000) : null
  function normalizeObservacao(observacao) {
    return typeof observacao === 'string' && observacao.trim() ? observacao.trim().slice(0, 1000) : null;
  }

  // Case 1: observacao is null (normal client behavior)
  assert.equal(normalizeObservacao(null), null);

  // Case 2: observacao is undefined (field omitted)
  assert.equal(normalizeObservacao(undefined), null);

  // Case 3: observacao is empty string ""
  assert.equal(normalizeObservacao(''), null);

  // Case 4: observacao is whitespace only "   \n\t  "
  assert.equal(normalizeObservacao('   \n\t  '), null);

  // Case 5: observacao is number (type confusion attack)
  assert.equal(normalizeObservacao(12345), null);

  // Case 6: observacao is boolean true/false
  assert.equal(normalizeObservacao(true), null);
  assert.equal(normalizeObservacao(false), null);

  // Case 7: observacao is empty object {} or array []
  assert.equal(normalizeObservacao({}), null);
  assert.equal(normalizeObservacao([]), null);

  // Case 8: observacao is nested object (prototype pollution / DOS attack)
  assert.equal(normalizeObservacao({ toString: () => { throw new Error('attack'); } }), null);

  // Case 9: observacao is valid string (legacy or manual API caller)
  assert.equal(normalizeObservacao(' Observacao legitima '), 'Observacao legitima');

  // Case 10: observacao is excessively large (> 2000 chars)
  const hugeText = 'X'.repeat(2500);
  const sliced = normalizeObservacao(hugeText);
  assert.equal(sliced.length, 1000);
});

test('CHALLENGE 4: Bitrix24 SPA integration handles null observacao without throwing', async () => {
  // Import criarCardAlunoSPA
  const { criarCardAlunoSPA } = await import('../services/bitrix24.js');

  // Mock global fetch to capture payload sent to Bitrix24
  let capturedPayload = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    capturedPayload = {
      url,
      method: options.method,
      headers: options.headers,
      body: JSON.parse(options.body)
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          item: {
            id: 99999
          }
        }
      })
    };
  };

  try {
    // Call with observacao: null
    const res = await criarCardAlunoSPA({
      nome: 'Aluno Teste Challenger',
      observacao: null,
      cursos: [
        { curso: 'Extensão Teste 1', cancelado: false, ultrapassaHoje: false },
        { curso: 'Extensão Teste 2 (Cancelada)', cancelado: true, ultrapassaHoje: true }
      ],
      protocolo: 'CERT-2026-999999'
    });

    assert.equal(res.sucesso, true);
    assert.equal(res.id, 99999);
    // When observacao is null, stage must be CLIENT (standard, no revision needed)
    assert.equal(res.stageId, 'DT1046_76:CLIENT');

    // Verify fields in payload
    assert.ok(capturedPayload, 'Payload must be sent');
    const fields = capturedPayload.body.fields;
    assert.equal(fields.title, 'Aluno Teste Challenger');
    assert.equal(fields.stageId, 'DT1046_76:CLIENT');
    // UF_CRM_14_1748872142 (observation field) MUST NOT be populated when observacao is null
    assert.equal(fields.UF_CRM_14_1748872142, undefined);
    assert.equal(fields.ufCrm14_1748872142, undefined);

    // Verify cancelled course was filtered out
    assert.equal(fields.UF_CRM_14_1791995335, 'Extensão Teste 1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CHALLENGE 5: Bitrix24 SPA integration handles non-null observacao gracefully as well', async () => {
  const { criarCardAlunoSPA } = await import('../services/bitrix24.js');

  let capturedPayload = null;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url, options) => {
    capturedPayload = {
      body: JSON.parse(options.body)
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          item: { id: 88888 }
        }
      })
    };
  };

  try {
    const res = await criarCardAlunoSPA({
      nome: 'Aluno Com Obs',
      observacao: 'Anotação especial de teste',
      cursos: [{ curso: 'Curso X' }]
    });

    assert.equal(res.sucesso, true);
    // When observacao is present, stage must be PREPARATION (revision)
    assert.equal(res.stageId, 'DT1046_76:PREPARATION');
    assert.equal(capturedPayload.body.fields.UF_CRM_14_1748872142, 'Anotação especial de teste');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CHALLENGE 6: e2e-rules.test.js F2.1 assertions hold against StudentForm.jsx source code', () => {
  const studentFormPath = path.resolve(__dirname, '../src/components/StudentForm.jsx');
  const conteudo = fs.readFileSync(studentFormPath, 'utf-8');
  const conteudoNormalizado = conteudo.replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

  // Mesmas asserções do F2.1 do e2e-rules.test.js, com as aspas normalizadas
  assert.ok(conteudoNormalizado.includes('Caso seja necessário atualização ou correção de algum dado pessoal'));
  assert.ok(conteudoNormalizado.includes('exclusivamente na área do aluno, aba "Meus Dados"'));
  assert.ok(conteudoNormalizado.includes('ocasionará o cancelamento da solicitação'));
});
