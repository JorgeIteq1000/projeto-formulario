/**
 * Carga horária dos cursos de Extensão e Aperfeiçoamento, a partir do catálogo levantado no Lyra
 * (src/data/cargasHorarias.json, gerado por scripts/gerarCargasHorarias.js a partir de docs/cargas-horarias.csv).
 *
 * A busca é por tipo + nome do curso (e certificadora, quando o nome tem mais de uma carga).
 * Se não houver correspondência única, retorna null: o sistema não chuta a carga.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizarTexto } from './escopo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARQUIVO = path.join(__dirname, '..', 'src', 'data', 'cargasHorarias.json');

const familiaTipo = (tipo) => {
  const t = normalizarTexto(tipo);
  if (t.startsWith('aperfeicoamento')) return 'aperfeicoamento';
  if (t.startsWith('extensao')) return 'extensao';
  return t;
};

const chaveCertificadora = (nome) => {
  const c = normalizarTexto(nome);
  if (c.includes('alpha')) return 'alpha';
  if (c.includes('uniao cultural')) return 'uniao';
  if (c.includes('estado de sao paulo') || c === 'fesp') return 'fesp';
  return c;
};

// Remove o sufixo " - 100h", caso o nome venha como no Lyra
const nomeSemCarga = (curso) => normalizarTexto(String(curso || '').replace(/\s*-\s*\d+\s*h\s*$/i, ''));

let indice = null;

function carregarIndice(registros) {
  const mapa = new Map();
  for (const r of registros) {
    const chave = `${familiaTipo(r.tipo)}|${nomeSemCarga(r.curso)}`;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push({ certificadora: chaveCertificadora(r.certificadora), carga: Number(r.carga) });
  }
  return mapa;
}

function obterIndice() {
  if (indice) return indice;
  try {
    indice = carregarIndice(JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8')));
  } catch (err) {
    console.warn(`⚠️  Catálogo de cargas horárias indisponível (${err.message}).`);
    indice = new Map();
  }
  return indice;
}

/** Permite aos testes usarem um catálogo próprio. */
export function definirCatalogo(registros) {
  indice = carregarIndice(registros);
}

/** @returns {number|null} carga em horas, ou null se não houver correspondência única */
export function buscarCargaHoraria(tipoCurso, curso, certificadora = '') {
  const candidatos = obterIndice().get(`${familiaTipo(tipoCurso)}|${nomeSemCarga(curso)}`);
  if (!candidatos || candidatos.length === 0) return null;

  const cargas = new Set(candidatos.map((c) => c.carga));
  if (cargas.size === 1) return [...cargas][0];

  // Nome com mais de uma carga: tenta desempatar pela certificadora
  const daCertificadora = candidatos.filter((c) => c.certificadora === chaveCertificadora(certificadora));
  const cargasCert = new Set(daCertificadora.map((c) => c.carga));
  return cargasCert.size === 1 ? [...cargasCert][0] : null;
}
