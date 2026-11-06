# 📋 Roteiro de Tarefas • Automação de Emissão de Certificados

> **Nota:** Este arquivo centraliza todas as pendências e implementações planejadas para o projeto. Conforme avançarmos, as etapas serão marcadas como concluídas `[x]` e, após a finalização de todas as entregas, este arquivo será deletado.

---

## 📊 Status Geral de Progresso

- [x] **Configuração da Porta Vite:** Ajustado para porta `5180` sincronizado com backend Express e rede local.
- [x] **Integração Bitrix24 SPA (Processos Internos ID 1046 / Categoria 76):**
  - Criação de card no funil de *Processo de Ext/Aper* (`categoryId: 76`).
  - Etapa padrão: `DT1046_76:CLIENT` (*Certificado Emitido*).
  - Etapa condicional de revisão: `DT1046_76:PREPARATION` (*Aprovação do Aluno com Revisão*) acionada apenas quando houver observação do aluno.
  - Envio do texto da observação para o campo customizado `UF_CRM_14_1748872142`.
  - Inserção dos cursos a certificar de forma empilhada (um por linha) no campo `UF_CRM_14_1791995335` (excluindo cursos cancelados por data futura).
- [x] **Regra Pedagógica de Evolução Funcional (< 10/11/2025):** Banner informativo quando a evolução informada for anterior a 10/11/2025 e ocultação quando posterior.
- [x] **Regra de Extensões com Data Futura:** Identificação de cursos que ultrapassam a data atual, cancelamento automático da extensão futura com notificação clara ao aluno e bloqueio seguro no formulário.

---

## 🎯 Nova Fase: Validação Retroativa de 17 Meses, Aceite Individual e Bitrix24 SPA

- [x] **R1. Regra de Limite Retroativo de 17 Meses para Data da Última Evolução:**
  - Bloquear avanço e exibir mensagem exata: *"Período não pode ser contabilizado. Entrar em contato com a central de atendimento via telefone 11-2074-5110, setor de Emissão"* caso a data seja anterior a 17 meses da data atual.
- [x] **R2. Aceite Individual por Certificado e Sugestão de Datas Customizadas:**
  - Seletor "Aceito" e "Não Aceito" independente para cada certificado sugerido.
  - Se "Não Aceito", exibir campo para data de início desejada validando início >= 17 meses retroativos e término (+1 mês) <= data atual.
- [x] **R3. Substituição do Campo de Observações pelo Aviso Institucional de 72 Horas:**
  - Remoção de `textarea id="observacao"` e inclusão do card institucional com destaque em **72hr**.
- [x] **R4. Integração com Bitrix24 SPA e Painel Admin Kanban:**
  - Se houver certificado "Não Aceito" com data customizada, card SPA vai para `DT1046_76:PREPARATION` com sumário de datas customizadas em `UF_CRM_14_1748872142`.
  - Se todos aceitos, card SPA vai para `DT1046_76:CLIENT`.
  - Exibição no `AdminKanban.jsx` dos badges de status de aceite de cada curso.
- [x] **R5. Testes Automatizados, Build e Sincronização:**
  - Execução com sucesso de `npm.cmd run build` sem erros de compilação.
  - Execução de suíte de testes unitários/E2E cobrindo todas as regras de datas e roteamento (56/56 testes aprovados).

---

## 📘 Ajustes do Manual de Certificados (itens em amarelo)

- [x] Dados pessoais no formulário: Data de Nascimento, RG e Naturalidade (lidos de colunas opcionais da planilha).
- [x] Tipo do curso com carga horária (coluna opcional `CARGA` da planilha).
- [x] Aviso institucional posicionado logo abaixo dos dados pessoais.
- [x] Pergunta única: "Você é profissional da área da Educação e atua na Rede Municipal de ensino?" (Sim → data da última evolução obrigatória).
- [x] Campo "Data de Conclusão" no lugar de "data de início desejada" ao marcar "Não Aceito".
- [x] Removida a "Notificação sobre Extensões Canceladas (Data Futura)".
- [x] Texto da confirmação conforme o manual.
- [x] Persistir as respostas em arquivo (`data/respostas.json`) e bloquear envio duplo (duplo clique / reenvio após reinício).
- [x] `npm test` corrigido para Windows e testes do aviso de 72h alinhados ao texto exibido (84/84 passando).
- [x] Webhook do Bitrix24 removido do código (somente `.env`) e `LINK_SECRET` obrigatório em produção. **Recomendado:** gerar um novo webhook no Bitrix24 e atualizar o `.env`, pois a chave antiga já esteve no código.
- [x] Prazo do aviso do formulário alterado de 72hr para **96hr**, alinhado ao fluxo do manual (cancelamento após o lembrete de 72h).
- [x] Levantar as cargas horárias dos cursos no Lyra (`docs/cargas-horarias.md` e `.csv`): Extensão 100h/120h/45h, Aperfeiçoamento 180h, Pós-Graduação 420h (dominante), Capacitação (cargas variadas), Atualização 140h. Faltam alguns tipos do Lyra (unidades, Cursos Livres, MBA).
- [x] Escopo definido: o formulário atende apenas cursos de **Extensão** e **Aperfeiçoamento** (Pós, Capacitação, Atualização etc. ficam fora).
- [x] Servidor ignora solicitações que não sejam Extensão ou Aperfeiçoamento.
- [x] Carga horária exibida no formulário a partir do catálogo do Lyra (sem depender da coluna da planilha). Cobertura nas solicitações de exemplo: cerca de 50%; faltam cursos que não constam nos tipos consultados.
- [x] Roteiro de perguntas ao setor do processo em `docs/perguntas-processo.md`.
- [x] Regra de períodos por carga horária em dias úteis (45h = 1 mês, 100h = 2 meses, Aperfeiçoamento 180h = 3 meses), com "Não Aceito" baseado na Data de Conclusão. **Confirmado:** início em fim de semana vai para o 1º dia útil; o 1º curso começa no mês seguinte à evolução; sem regra para 120h/carga desconhecida usa o padrão do tipo (Extensão = 100h, Aperfeiçoamento = 180h); sem aplicar a janela de um ano. 120h segue a regra das 100h (2 meses) e feriados são pulados (nacionais, Sexta-feira Santa, 25/01 e 09/07 de SP; sem pontos facultativos). Lista de feriados confirmada.
- [x] Decisões: data de evolução futura continua **bloqueada**; prazo de **96 horas** confirmado (aviso do formulário agora diz "96hr", sem o "horas" repetido); telefone mantido com DDD (11-2074-5110).
- [x] Sistema lê Data de Nascimento, RG e Naturalidade da aba **DADOS_ALUNOS** (por CPF), sem alterar a aba das solicitações; a coluna Carga Horária deixou de ser necessária (catálogo do Lyra).
- [x] Fonte dos dados pessoais investigada: Bitrix24 não serve (RG e nascimento vazios); no Lyra a ficha do estudante usa API criptografada (`api-gateway`). Caminho recomendado: reaproveitar o que o robô "Listador" já usa.
- [ ] **Criar a aba `DADOS_ALUNOS`** na planilha (CPF, DATA DE NASCIMENTO, RG, NATURALIDADE) e definir quem a preenche; confirmar com o responsável pelo robô "Listador" como ele escreve na planilha.

## 🚀 Próximas Tarefas Pendentes

### 1. Conexão do Disparo Ativo via WhatsApp com IA (Zionic)
- [ ] **Mapeamento e Leitura da Base:**
  - Consultar dados da planilha oficial no Google Sheets (Telefone, Nome, CPF, Contratos e Cursos solicitados).
  - Obter/gerar o link individual seguro de 24h para cada aluno.
- [ ] **Integração com API / Webhook da IA Zionic:**
  - Montar payload com número de telefone formatado com DDI/DDD e mensagem personalizada.
  - Enviar link individual do formulário (`http://.../solicitacoes/:token` ou domínio oficial).
- [ ] **Garantias e Registro:**
  - Salvar status do disparo (Enviado / Erro / Data e Hora) para conferência e evitar mensagens duplicadas.

---

### 2. Automação de Aprovação e Cancelamento no Portal Lyra
- [ ] **Módulo de Integração / RPA Lyra:**
  - Implementar fluxo de autenticação e navegação nas solicitações de certificados no Lyra.
- [ ] **Aprovação Automática:**
  - Para cada curso aprovado/elegível pelo formulário, preencher automaticamente as datas pedagógicas sequenciais sugeridas (data início e data término de 1 mês corrido sem conflito de períodos).
  - Efetivar a aprovação no portal acadêmico.
- [ ] **Cancelamento Automático de Cursos Futuros:**
  - Para as extensões identificadas como data futura (que ultrapassaram a data de hoje), acionar a rotina de cancelamento da respectiva solicitação no Lyra com a justificativa de período futuro.

---

### 3. Notificações Inteligentes em Grupo do Bitrix24 (Via IA)
- [ ] **Webhook / Chat API do Grupo no Bitrix24:**
  - Configurar envio de mensagens para o grupo/chat do setor responsável no Bitrix24.
- [ ] **Geração da Mensagem com IA:**
  - Criar gerador de texto por IA com base nos dados reais do evento:
    - Identificação do aluno (Nome, CPF mascarado, Protocolo).
    - Cursos e períodos pedagógicos aprovados para emissão.
    - Cursos cancelados por extrapolação de data futura (com explicação).
- [ ] **Triagem e Análise de Observações/Customizações por IA:**
  - Análise inteligente do sumário de customizações de datas e eventuais observações institucionais.

---

## 🗑️ Critério de Finalização
Quando todos os módulos acima estiverem construídos, integrados e validados em ambiente real, este arquivo `TAREFAS.md` será **permanentemente deletado** do repositório.
