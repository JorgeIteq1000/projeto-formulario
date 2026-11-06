import { app, garantirBaseCarregada } from '../server.js';

export default async function handler(req, res) {
  try {
    await garantirBaseCarregada();
  } catch (err) {
    console.error('Erro ao inicializar base de dados no handler Vercel:', err);
  }
  return app(req, res);
}

