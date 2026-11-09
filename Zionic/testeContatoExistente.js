import {
  garantirContatoZionic,
  dispararMensagemAlunoZionic
} from './zionicClient.js';

async function main() {
  const nome = 'Jorge';
  const telefone = '5511980732523';

  console.log('🧪 TESTE: Cenário onde o contato já existe no Zionic\n');
  console.log(`👤 Aluno: ${nome}`);
  console.log(`📱 Telefone: ${telefone}\n`);

  // 1. Testa a garantia do contato (tenta cadastrar novamente um contato existente)
  console.log('1️⃣ Executando garantirContatoZionic (esperado: detectar 409 e reaproveitar dados)...');
  const resContato = await garantirContatoZionic({ nome, telefone });

  console.log('\n--- Resultado do Contato ---');
  console.log(`Sucesso: ${resContato.sucesso}`);
  console.log(`Já existia no Zionic? ${resContato.jaExistia}`);
  console.log(`Status HTTP: ${resContato.statusHttp}`);
  console.log(`Mensagem: ${resContato.mensagem}`);
  console.log(`Contact ID: ${resContato.id}`);
  console.log('Dados do contato:', JSON.stringify(resContato.data, null, 2));

  // 2. Testa o fluxo completo de envio de mensagem para contato existente
  console.log('\n2️⃣ Executando dispararMensagemAlunoZionic (Fluxo Completo)...');
  const textoMensagem = `Olá ${nome}, teste de envio para contato existente no Zionic às ${new Date().toLocaleTimeString('pt-BR')}.`;

  const resDisparo = await dispararMensagemAlunoZionic({
    nome,
    telefone,
    mensagem: textoMensagem
  });

  console.log('\n--- Resultado do Disparo Completo ---');
  console.log(JSON.stringify(resDisparo, null, 2));

  if (resDisparo.sucesso) {
    console.log('\n🎉 SUCESSO TOTAL!');
    console.log(`- Contato reaproveitado: ${resDisparo.contactId}`);
    console.log(`- Conversa utilizada: ${resDisparo.conversationId}`);
    console.log(`- Mensagem enviada ID: ${resDisparo.data?.id}`);
    console.log(`- Status: ${resDisparo.data?.status}`);
  } else {
    console.error('\n❌ Falha no disparo:', resDisparo.erro);
  }
}

main();
