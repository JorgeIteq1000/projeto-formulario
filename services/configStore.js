/**
 * Persistência das configurações operacionais do painel em arquivo JSON.
 *
 * Mantém o estado do interruptor de Certificação Automática (Lyra) salvo entre
 * reinícios do servidor e compartilhado para toda a equipe logada.
 */
import fs from 'fs';
import path from 'path';

export function obterConfigPadrao() {
  const defaultEnv = String(process.env.CERTIFICACAO_AUTOMATICA_DEFAULT || '').trim().toLowerCase();
  const certificacaoAutomatica = ['1', 'true', 'sim', 'on'].includes(defaultEnv);
  return {
    certificacaoAutomatica,
    atualizadoEm: null,
    atualizadoPor: null
  };
}

/**
 * Lê as configurações salvas em disco. Se o arquivo não existir ou estiver inválido,
 * retorna o padrão seguro (certificacaoAutomatica = false, salvo override via env).
 */
export function carregarConfiguracoes(arquivo) {
  const padrao = obterConfigPadrao();
  if (!arquivo || !fs.existsSync(arquivo)) return padrao;

  try {
    const conteudo = JSON.parse(fs.readFileSync(arquivo, 'utf-8'));
    if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) {
      return padrao;
    }
    return {
      certificacaoAutomatica:
        typeof conteudo.certificacaoAutomatica === 'boolean'
          ? conteudo.certificacaoAutomatica
          : padrao.certificacaoAutomatica,
      atualizadoEm: conteudo.atualizadoEm || null,
      atualizadoPor: conteudo.atualizadoPor || null
    };
  } catch (err) {
    console.warn(`⚠️  Não foi possível ler configurações em ${arquivo} (${err.message}); usando padrão seguro.`);
    return padrao;
  }
}

/**
 * Grava as configurações de forma atômica (arquivo temporário + rename).
 */
export function salvarConfiguracoes(arquivo, config) {
  if (!arquivo) return;
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(config, null, 2), 'utf-8');
  fs.renameSync(temporario, arquivo);
}
