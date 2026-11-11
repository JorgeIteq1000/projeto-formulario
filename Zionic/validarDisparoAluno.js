import { montarMensagemCertificado } from './mensagemTemplate.js';
import { dispararMensagemAlunoZionic, consultarMensagemZionic } from './zionicClient.js';

async function main() {
  console.log('🧪 ========================================================');
  console.log('🧪 TESTE DE VALIDAÇÃO: DISPARO DE MENSAGEM VIA ZIONIC (WHATSAPP)');
  console.log('🧪 ========================================================\n');

  // -------------------------------------------------------------------------
  // TESTE 1: Aluno com 1 solicitação (1 curso)
  // -------------------------------------------------------------------------
  console.log('📌 CENÁRIO 1: Aluno com 1 único curso solicitado');
  const msg1 = montarMensagemCertificado({
    nome: 'Maria Silva',
    cursos: ['PRÁTICAS PEDAGÓGICAS NA EDUCAÇÃO INFANTIL'],
    linkUrl: 'https://solicitacao.certificadoies.com.br/solicitacoes/token-exemplo-1'
  });
  console.log('--- Texto Gerado (1 curso) ---');
  console.log(msg1);
  console.log('------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 2: Aluno com múltiplas solicitações (3 cursos - XXX / YYY / ZZ)
  // -------------------------------------------------------------------------
  console.log('📌 CENÁRIO 2: Aluno com 3 cursos solicitados (encapsulados)');
  const msg3 = montarMensagemCertificado({
    nome: 'Carlos Eduardo Oliveira',
    cursos: [
      { curso: 'ALFABETIZAÇÃO E LETRAMENTO' },
      { curso: 'GESTÃO ESCOLAR E COORDENAÇÃO PEDAGÓGICA' },
      { curso: 'EDUCAÇÃO ESPECIAL E INCLUSIVA' }
    ],
    linkUrl: 'https://solicitacao.certificadoies.com.br/solicitacoes/token-exemplo-3'
  });
  console.log('--- Texto Gerado (3 cursos) ---');
  console.log(msg3);
  console.log('------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 3: Aluno com 10 cursos solicitados
  // -------------------------------------------------------------------------
  console.log('📌 CENÁRIO 3: Aluno com 10 cursos solicitados (encapsulados)');
  const cursos10 = Array.from({ length: 10 }, (_, i) => `Curso de Extensão Especialização Módulo ${i + 1}`);
  const msg10 = montarMensagemCertificado({
    nome: 'Fernanda Lima dos Santos',
    cursos: cursos10,
    linkUrl: 'https://solicitacao.certificadoies.com.br/solicitacoes/token-exemplo-10'
  });
  console.log('--- Texto Gerado (10 cursos) ---');
  console.log(msg10);
  console.log('------------------------------\n');

  // -------------------------------------------------------------------------
  // TESTE 4: Envio Real de Validação para o Jorge no Zionic
  // -------------------------------------------------------------------------
  console.log('🚀 CENÁRIO 4: Envio Real de Validação via WhatsApp para o Jorge');
  const nomeAluno = 'Jorge'; // Coluna C
  const telefoneAluno = '5511980732523'; // Coluna L
  const cursosJorge = [
    'PRÁTICAS PEDAGÓGICAS NA EDUCAÇÃO INFANTIL',
    'GESTÃO ESTRATÉGICA EM EDUCAÇÃO',
    'METODOLOGIAS ATIVAS E INOVAÇÃO DOCENTE'
  ];
  const linkReal = 'https://solicitacao.certificadoies.com.br/solicitacoes/tok-jorge-valida-2026';

  const textoReal = montarMensagemCertificado({
    nome: nomeAluno,
    cursos: cursosJorge,
    linkUrl: linkReal
  });

  console.log(`👤 Destinatário: ${nomeAluno} (${telefoneAluno})`);
  console.log(`📚 Cursos agrupados (${cursosJorge.length}): ${cursosJorge.join(' / ')}`);
  console.log(`🔗 Link: ${linkReal}`);
  console.log('\nDisparando mensagem...');

  const resultado = await dispararMensagemAlunoZionic({
    nome: nomeAluno,
    telefone: telefoneAluno,
    mensagem: textoReal
  });

  console.log('\n--- Resultado do Disparo ---');
  console.log(JSON.stringify(resultado, null, 2));

  if (resultado.sucesso) {
    console.log('\n🎉 SUCESSO NA VALIDAÇÃO REAL DO ZIONIC!');
    console.log(`✅ Contato ID: ${resultado.contactId} (Já existia: ${resultado.jaExistia})`);
    console.log(`✅ Conversa ID: ${resultado.conversationId}`);
    console.log(`✅ Mensagem ID: ${resultado.data?.id}`);
    console.log(`✅ Status: ${resultado.data?.status}`);

    // Consulta status
    if (resultado.data?.id) {
      console.log('\n🔎 Consultando status da mensagem entregue...');
      const consulta = await consultarMensagemZionic(resultado.data.id);
      console.log(`Mensagem registrada no Zionic com status: ${consulta.data?.status}`);
    }
  } else {
    console.error('❌ Falha na validação:', resultado.erro);
  }
}

main();
