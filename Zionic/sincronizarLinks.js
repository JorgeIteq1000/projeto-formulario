/**
 * Grava na coluna T da planilha o link individual de cada aluno.
 *
 * Uso:
 *   node Zionic/sincronizarLinks.js            -> simulação (não grava nada)
 *   node Zionic/sincronizarLinks.js --gravar   -> grava os links na coluna T
 */
import { sincronizarLinksNaPlanilha } from '../server.js';

const gravar = process.argv.includes('--gravar');

console.log(gravar ? '✍️  Gravando links na coluna T...' : '🔎 Simulação (use --gravar para gravar).');
const resultado = await sincronizarLinksNaPlanilha({ dryRun: !gravar });
console.log(JSON.stringify(resultado, null, 2));
process.exit(resultado.sucesso ? 0 : 1);
