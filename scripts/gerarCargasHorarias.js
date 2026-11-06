/**
 * Gera src/data/cargasHorarias.json a partir de docs/cargas-horarias.csv.
 * Uso: node scripts/gerarCargasHorarias.js
 * Cursos de teste são ignorados.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const csv = path.join(__dirname, '..', 'docs', 'cargas-horarias.csv');
const saida = path.join(__dirname, '..', 'src', 'data', 'cargasHorarias.json');

const [, ...linhas] = fs.readFileSync(csv, 'utf-8').split(/\r?\n/).filter(Boolean);
const registros = linhas
  .map((l) => {
    const [tipo, carga, certificadora, ...curso] = l.split(';');
    return { tipo, carga: Number(carga), certificadora, curso: curso.join(';') };
  })
  .filter((r) => !/\bTESTE\b/i.test(r.curso));

fs.writeFileSync(saida, JSON.stringify(registros, null, 2), 'utf-8');
console.log(`✅ ${registros.length} cursos gravados em ${saida}`);
