/**
 * Persistência das respostas do formulário em arquivo JSON.
 *
 * Evita perder respostas (e permitir reenvio) quando o servidor reinicia.
 * O arquivo guarda dados pessoais dos alunos: mantenha-o fora do controle de versão.
 */
import fs from 'fs';
import path from 'path';

/**
 * Lê as respostas salvas. Retorna um Map token -> registro.
 * Arquivo ausente resulta em Map vazio; arquivo corrompido é preservado como .corrompido-<timestamp>
 * (para não ser sobrescrito) e o servidor segue com Map vazio.
 */
export function carregarRespostas(arquivo) {
  const mapa = new Map();
  if (!fs.existsSync(arquivo)) return mapa;

  try {
    const conteudo = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
    if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) {
      throw new Error('formato inesperado (esperado objeto token -> resposta)');
    }
    for (const [token, registro] of Object.entries(conteudo)) {
      mapa.set(token, registro);
    }
  } catch (err) {
    const backup = `${arquivo}.corrompido-${Date.now()}`;
    try {
      fs.renameSync(arquivo, backup);
    } catch { /* se não der para renomear, apenas segue */ }
    console.error(`❌ Não foi possível ler ${arquivo} (${err.message}). Arquivo preservado em ${backup}; iniciando sem respostas.`);
    mapa.clear();
  }
  return mapa;
}

/**
 * Grava todas as respostas de forma atômica: escreve em arquivo temporário e renomeia por cima
 * do definitivo, então uma queda no meio da gravação não deixa o arquivo pela metade.
 */
export function salvarRespostas(arquivo, mapa) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(Object.fromEntries(mapa), null, 2), 'utf-8');
  fs.renameSync(temporario, arquivo);
}
