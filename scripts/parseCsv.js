import fs from 'fs';
import path from 'path';

// Helper to parse CSV lines handling quoted fields
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

const csvPath = process.argv[2] || path.resolve(__dirname, 'solicitacoes.csv');
if (!fs.existsSync(csvPath)) {
  console.log(`ℹ️  Para reprocessar um CSV, execute: node scripts/parseCsv.js <caminho-do-arquivo.csv>`);
  process.exit(0);
}
const content = fs.readFileSync(csvPath, 'utf-8');

// Find start of CSV
const lines = content.split('\n');
let headerIndex = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].startsWith('SOLICITAÇÃO,CPF,NOME')) {
    headerIndex = i;
    break;
  }
}

if (headerIndex === -1) {
  console.error('Header not found!');
  process.exit(1);
}

const headers = parseCSVLine(lines[headerIndex]);
console.log('Headers found:', headers);

const rows = [];
for (let i = headerIndex + 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const cols = parseCSVLine(line);
  if (cols.length >= 6 && cols[1]) {
    const item = {
      solicitacao: cols[0] || '',
      cpf: cols[1].replace(/\D/g, ''),
      nome: cols[2] || '',
      tipoCertificado: cols[3] || 'Digital',
      tipoCurso: cols[4] || 'Extensão',
      curso: cols[5] || '',
      certificadora: cols[6] || '',
      contrato: cols[7] || '',
      statusEvento: cols[8] || 'PENDENTE_ENVIO',
      idEvento: cols[9] || 'N/A',
      dataCriacaoEvento: cols[10] || '',
      telefone: cols[11] || '',
      dataInicioIso: cols[12] || '',
      criacaoMatriculaIso: cols[13] || '',
      userId: cols[14] || ''
    };
    rows.push(item);
  }
}

console.log(`Parsed ${rows.length} rows`);

// Group by CPF
const porCpf = {};
rows.forEach(r => {
  if (!porCpf[r.cpf]) {
    porCpf[r.cpf] = {
      cpf: r.cpf,
      nome: r.nome,
      telefone: r.telefone,
      cursos: []
    };
  }
  porCpf[r.cpf].cursos.push({
    solicitacao: r.solicitacao,
    tipoCertificado: r.tipoCertificado,
    tipoCurso: r.tipoCurso,
    curso: r.curso,
    certificadora: r.certificadora,
    contrato: r.contrato,
    statusEvento: r.statusEvento
  });
});

const outDir = path.resolve('./src/data');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(path.join(outDir, 'solicitacoesRaw.json'), JSON.stringify(rows, null, 2), 'utf-8');
fs.writeFileSync(path.join(outDir, 'alunosPorCpf.json'), JSON.stringify(porCpf, null, 2), 'utf-8');

console.log(`Saved ${Object.keys(porCpf).length} unique students to ${outDir}`);
