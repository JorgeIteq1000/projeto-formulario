/**
 * Validação ponta a ponta: lê nome (C), telefone (L) e link (T) da planilha.
 * Se a coluna T estiver vazia, gera e grava na planilha antes do disparo.
 * Monta a mensagem com TODOS os cursos do aluno e envia pelo Zionic.
 *
 * Uso: node Zionic/validarLinkPlanilha.js [--enviar]
 */
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { carregarSolicitacoes, gravarLinksNaPlanilha } from '../services/googleSheets.js';
import { montarMensagemCertificado } from './mensagemTemplate.js';
import { dispararMensagemAlunoZionic } from './zionicClient.js';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const PUBLIC_FORM_URL = (process.env.PUBLIC_FORM_URL || 'https://solicitacao.certificadoies.com.br').replace(/\/+$/, '');
const LINK_SECRET = process.env.LINK_SECRET || 'dev-secret-change-in-production';

function gerarToken(cpf, dataReferencia) {
  return crypto
    .createHmac('sha256', LINK_SECRET)
    .update(`${cpf}|${dataReferencia}`)
    .digest('base64url')
    .slice(0, 22);
}

function parseDataBR(str) {
  if (!str) return null;
  const partes = String(str).split('/');
  if (partes.length !== 3) return null;
  const d = new Date(Number(partes[2]), Number(partes[1]) - 1, Number(partes[0]));
  return isNaN(d.getTime()) ? null : d;
}

const enviar = process.argv.includes('--enviar');
const spreadsheetId = process.env.GOOGLE_SHEET_ID;
const res = await carregarSolicitacoes({ spreadsheetId });
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
  let link = linhas.map((l) => l.link).find(Boolean);
  const cursos = linhas.map((l) => l.curso);

  // Se a coluna T estiver em branco, gera e grava na planilha antes do disparo (Opção 1)
  if (!link || !link.startsWith(PUBLIC_FORM_URL)) {
    const datas = linhas.map((i) => parseDataBR(i.solicitacao)).filter(Boolean);
    const maisRecente = datas.length ? new Date(Math.max(...datas)) : new Date();
    const dataReferencia = maisRecente.toISOString().slice(0, 10);
    const token = gerarToken(cpf, dataReferencia);
    link = `${PUBLIC_FORM_URL}/solicitacoes/${token}`;

    if (enviar && spreadsheetId) {
      console.log(`✍️  [Coluna T] Gravando link para ${nome} na planilha...`);
      try {
        await gravarLinksNaPlanilha({
          spreadsheetId,
          itens: [{ cpf, url: link }]
        });
        console.log(`   ✅ Link gravado na coluna T.`);
      } catch (err) {
        console.warn(`   ⚠️  Falha ao gravar link na planilha: ${err.message}`);
      }
    }
  }

  console.log(`\n👤 ${nome} | CPF ${cpf} | tel ${telefone} | ${linhas.length} solicitação(ões)`);
  console.log(`🔗 Link (coluna T): ${link || '(vazio)'}`);
  if (!link || !link.startsWith(PUBLIC_FORM_URL)) {
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
