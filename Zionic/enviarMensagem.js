import {
  buscarConversaPorTelefone,
  enviarMensagemConversa,
  consultarMensagemZionic
} from './zionicClient.js';

async function main() {
  const telefone = '5511980732523';
  const textoMensagem = 'Olá Jorge, esta é uma mensagem de teste automatizada da emissão de certificados.';

  console.log(`🚀 Iniciando envio de mensagem Zionic para ${telefone}...\n`);

  try {
    // 1. Busca a conversa pelo telefone do contato
    console.log(`🔍 Localizando conversa para o telefone ${telefone}...`);
    const conversa = await buscarConversaPorTelefone(telefone);

    if (!conversa || !conversa.conversation_id) {
      console.error('❌ Nenhuma conversa encontrada para o telefone especificado.');
      return;
    }

    console.log(`✅ Conversa encontrada! ID: ${conversa.conversation_id}`);
    console.log(`Contato: ${conversa.contact_full_name} (${conversa.contact_phone})`);

    // 2. Envia a mensagem na conversa
    console.log(`\n✉️ Enviando mensagem: "${textoMensagem}"...`);
    const resEnvio = await enviarMensagemConversa({
      conversationId: conversa.conversation_id,
      mensagem: textoMensagem
    });

    if (!resEnvio.sucesso) {
      console.error('❌ Falha ao enviar mensagem:', resEnvio.erro);
      return;
    }

    console.log('\n--- Resultado do Envio ---');
    console.log(JSON.stringify(resEnvio.data, null, 2));

    const messageId = resEnvio.data?.id;
    if (messageId) {
      // 3. Consulta detalhes da mensagem enviada
      console.log(`\n🔎 Consultando status da mensagem ID: ${messageId}...`);
      const resConsulta = await consultarMensagemZionic(messageId);
      console.log('--- Detalhes da Mensagem na API ---');
      console.log(JSON.stringify(resConsulta.data, null, 2));
    }

    console.log('\n🎉 Teste de envio concluído com sucesso!');
  } catch (err) {
    console.error('\n❌ Erro durante o fluxo:', err.message);
  }
}

main();
