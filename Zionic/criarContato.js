import { criarContatoZionic } from './zionicClient.js';

async function main() {
  console.log('🚀 Iniciando teste de criação de contato no Zionic...\n');

  try {
    const resultado = await criarContatoZionic({
      nome: 'Jorge',
      telefone: '5511980732523'
    });

    console.log('\n--- Resposta da API ---');
    console.log(JSON.stringify(resultado, null, 2));

    if (resultado.sucesso) {
      console.log('\n🎉 Sucesso! Contato cadastrado no Zionic.');
      console.log(`ID: ${resultado.data?.id}`);
      console.log(`Nome: ${resultado.data?.first_name}`);
      console.log(`Telefone: ${resultado.data?.phone}`);
    } else {
      console.error('\n⚠️ Falha ao criar contato:', resultado.erro);
    }
  } catch (err) {
    console.error('\n❌ Erro durante a execução:', err.message);
  }
}

main();
