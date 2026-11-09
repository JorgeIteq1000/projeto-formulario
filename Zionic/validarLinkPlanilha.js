/**
 * Validação ponta a ponta: lê nome (C), telefone (L) e link (T) da planilha,
 * monta a mensagem com TODOS os cursos do aluno e envia pelo Zionic.
 *
 * Uso: node Zionic/validarLinkPlanilha.js [--enviar]
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { carregarSolicitacoes } from '../services/googleSheets.js';
import { montarMensagemCertificado } from './mensagemTemplate.js';
import { dispararMensagemAlunoZionic } from './zionicClient.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const enviar = process.argv.includes('--enviar');
const res = await carregarSolicitacoes({ spreadsheetId: process.env.GOOGLE_SHEET_ID });
console.log(`Fonte: ${res.fonte} | linhas: ${res.dados.length}`);

// Agrupa as linhas por CPF (um aluno pode ter 1 ou N solicitações)
const porCpf = new Map();
for (const l of res.dados) {
  if (!porCpf.has(l.cpf)) porCpf.set(l.cpf, []);
  porCpf.get(l.cpf).push(l);
}

let falhas = 0;
for (const [cpf, linhas] of porCpf) {
  const nome = linhas[0].nome;
  const telefone = linhas[0].telefone;
  const link = linhas.map((l) => l.link).find(Boolean);
  const cursos = linhas.map((l) => l.curso);

  console.log(`\n👤 ${nome} | CPF ${cpf} | tel ${telefone} | ${linhas.length} solicitação(ões)`);
  console.log(`🔗 Link (coluna T): ${link || '(vazio)'}`);
  if (!link || !link.startsWith('https://newsolicitacoes.vercel.app/solicitacoes/')) {
    console.error('❌ Link ausente ou fora do domínio oficial.');
    falhas++;
    continue;
  }
  if (!telefone) { console.error('❌ Telefone ausente.'); falhas++; continue; }

  const mensagem = montarMensagemCertificado({ nome, cursos, linkUrl: link });
  console.log('--- Mensagem ---\n' + mensagem + '\n----------------');

  if (enviar) {
    const r = await dispararMensagemAlunoZionic({ nome, telefone, mensagem });
    console.log(r.sucesso ? `✅ Enviada (id ${r.data?.id}, status ${r.data?.status})` : `❌ Falha: ${r.erro}`);
    if (!r.sucesso) falhas++;
  }
}
process.exit(falhas ? 1 : 0);
