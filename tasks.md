# 📋 Plano de Execução & Acompanhamento de Tarefas

**Projeto:** Automação de Emissão de Certificados — Extensão e Aperfeiçoamento  
**Repositório:** `https://github.com/JorgeIteq1000/projeto-formulario`  
**Data:** 14/11/2026  
**Status Geral:** ✅ Concluído (Pronto para Push)

---

## 🎯 Lista de Tarefas

- [x] **Tarefa 1: Estruturação do Plano de Execução (`tasks.md`)**
  - Mapear todo o fluxo do Listador para execução autônoma em nuvem via GitHub Actions.
  - Documentar dependências, variáveis e requisitos de integração.

- [x] **Tarefa 2: Configuração do MCP Server do GitHub (`mcp_config.json`)**
  - Adicionar o servidor MCP do GitHub em `C:\Users\GEO\.gemini\config\mcp_config.json` para comunicação com a API do GitHub.
  - Configurado runner via npx (`@modelcontextprotocol/server-github`) e documentada opção via Docker (`ghcr.io/github/github-mcp-server`).

- [x] **Tarefa 3: Adequação do Script `listador-extensoes-aperf.py` para Nuvem**
  - Suporte a credenciais do Google Sheets via Secret/Ambiente (`GOOGLE_CREDENTIALS` / `GOOGLE_CREDENTIALS_BASE64`) ou arquivo local `123.json`.
  - Suporte a credenciais da API Lyra via variáveis de ambiente (`LYRA_EMAIL` e `LYRA_PASSWORD`).
  - Criação do `requirements.txt` com as dependências exatas (`requests`, `gspread`, `oauth2client`, `pycryptodome`).

- [x] **Tarefa 4: Criação do Workflow Cron no GitHub Actions (a cada 20 min)**
  - Criado [`.github/workflows/listador-cron.yml`](file:///d:/projeto-formulario/.github/workflows/listador-cron.yml) com agendamento cron `*/20 * * * *` (a cada 20 minutos) e disparo manual (`workflow_dispatch`).
  - Execução 100% em nuvem (runner `ubuntu-latest`), liberando totalmente a CPU do computador do colaborador.

- [x] **Tarefa 5: Validação e Testes Locais da Rotina do Listador**
  - Validada sintaxe Python com `python -m py_compile LISTADOR/listador-extensoes-aperf.py`.
  - Validada estrutura do workflow YAML.
  - Executada a suíte com 129 testes automatizados (`npm test`) com 100% de aprovação (0 falhas).

- [x] **Tarefa 6: Atualização do `README.md`**
  - Documentada a nova arquitetura do Listador rodando periodicamente via GitHub Actions.
  - Detalhadas as GitHub Secrets necessárias (`GOOGLE_CREDENTIALS`, `GOOGLE_SHEET_ID`, `LYRA_EMAIL`, `LYRA_PASSWORD`).

- [x] **Tarefa 7: Atualização dos Manuais Operacionais (`HTML` e `DOCX`)**
  - Atualizado o Guia Arquitetural e a Seção 4 (Matriz RACI) dos manuais destacando a varredura autônoma em nuvem a cada 20 minutos.
  - Enfatizado o ganho de tempo, redução de esforço do colaborador e liberação de CPU (execução 24/7 autônoma na nuvem sem precisar manter o PC ligado).
  - Regenerados [`docs/manual_apresentacao.html`](file:///d:/projeto-formulario/docs/manual_apresentacao.html) (11,4 MB com capturas em Base64) e [`docs/manual_apresentacao.docx`](file:///d:/projeto-formulario/docs/manual_apresentacao.docx) (8,3 MB).

- [x] **Tarefa 8: Commit e Push das Alterações no GitHub**
  - Enviar todas as alterações para a branch `main` no GitHub.
  - Confirmar integridade de deploy.

- [x] **Tarefa 9: Sincronização Bidirecional de Status da Planilha no Kanban e Estatísticas (Correção de Estado)**
  - Identificada causa raiz em que o servidor local dependia exclusivamente do arquivo `data/respostas.json` para definir o status `EMITIR`.
  - Quando alunos já estavam como `STATUS DO EVENTO: EMITIR` e possuíam protocolo preenchido na planilha Google Sheets (caso da aluna Ianca Pires Paulino, protocolo `CERT-2026-797774`), o painel mantinha o aluno em `ENTRADA`.
  - Corrigido `server.js` em `carregarBase()`, `/api/solicitacoes`, `/api/link/:token`, `/api/resposta/:token` e `/api/estatisticas` para reconhecer automaticamente o status e protocolo vindos da planilha como autoridade, hidratando em memória e movendo o card imediatamente para `EMITIR`.

- [x] **Tarefa 10: Régua Automatizada de Notificações via WhatsApp (Zionic) com Proteção Anti-Bloqueio (60s)**
  - Implementada régua em 4 estágios em [`Zionic/reguaWhatsApp.js`](file:///d:/projeto-formulario/Zionic/reguaWhatsApp.js):
    1. **D0 (Boas-vindas):** Envio imediato do link seguro de 96h assim que o aluno cai na planilha pelo Listador.
    2. **Lembrete Diário (24h):** Mensagem periódica a cada 24 horas enquanto o formulário estiver pendente e com prazo > 2h.
    3. **Alerta Crítico (2h):** Aviso urgente quando faltarem 2 horas para o cancelamento automático.
    4. **Expirado (96h):** Notificação institucional informando que o prazo encerrou e orientando a solicitar novamente pelo Portal do Aluno.
  - Implementada **proteção anti-bloqueio WhatsApp**: intervalo obrigatório de 60 segundos entre cada disparo individual de aluno.
  - Criada persistência em colunas do Google Sheets (`STATUS WHATSAPP`, `DATA ULTIMO WHATSAPP`, `TOTAL LEMBRETES WHATSAPP`) via `gravarStatusWhatsAppNaPlanilha` em `services/googleSheets.js`.
  - Separados os workflows no GitHub Actions para controle independente e economia de cota:
    - [`listador-cron.yml`](file:///d:/projeto-formulario/.github/workflows/listador-cron.yml): Executa exclusivamente o Listador Python a cada 20 minutos.
    - [`whatsapp-regua-cron.yml`](file:///d:/projeto-formulario/.github/workflows/whatsapp-regua-cron.yml): Executa a Régua de WhatsApp a cada 1 hora com seletor de "envio_real" vs "simulação" e trava de segurança se faltarem credenciais Zionic.
  - Criada suíte de testes unitários [`tests/regua_whatsapp.test.js`](file:///d:/projeto-formulario/tests/regua_whatsapp.test.js) com 100% de aprovação.

- [x] **Tarefa 11: Interruptor de Certificação Automática no Painel & Botão "Emitir" Manual por Card**
  - Criada persistência atômica da configuração operacional em [`services/configStore.js`](file:///d:/projeto-formulario/services/configStore.js) (`data/config.json`) com padrão inicial seguro (`certificacaoAutomatica = false`).
  - Adicionados endpoints autenticados `GET/PUT /api/configuracoes` e `POST /api/solicitacoes/:token/emitir` em [`server.js`](file:///d:/projeto-formulario/server.js) com trava anti-duplo clique e idempotência por curso no Lyra.
  - Adicionado interruptor visual ("Certificação Automática") e botão `"Emitir"` nos cards da coluna `EMITIR` em [`src/components/AdminKanban.jsx`](file:///d:/projeto-formulario/src/components/AdminKanban.jsx) + estilos em [`src/styles.css`](file:///d:/projeto-formulario/src/styles.css).
  - Criada suíte de testes ponta a ponta [`tests/certificacao_automatica_toggle.test.js`](file:///d:/projeto-formulario/tests/certificacao_automatica_toggle.test.js).

- [x] **Tarefa 12: Listador Python & Planilha com Colunas V (Status Lyra), W (Modificação do Status) e X (Prazo Mínimo) + Cancelamento na Mesma Aba**
  - Atualizado [`LISTADOR/listador-extensoes-aperf.py`](file:///d:/projeto-formulario/LISTADOR/listador-extensoes-aperf.py) para capturar solicitações tanto em **Aguardando Aprovação** (`waiting_approval`) quanto em **Aguardando Pagamento** (`waiting_payment`) para Extensão e Aperfeiçoamento, gravando na Coluna V (`STATUS LYRA`), mantendo a Coluna W (`MODIFICAÇÃO DO STATUS`) e preenchendo o prazo mínimo na Coluna X (`PRAZO MÍNIMO PARA CONCLUSÃO`), além de atualizar linhas existentes.
  - Atualizado [`scripts/googleAppsScript.gs`](file:///d:/projeto-formulario/scripts/googleAppsScript.gs) (`verificarExpiracao96h`) para **não arrastar/mover** linhas expiradas para outra aba, marcando `"Cancelado"` nas colunas I e V e a data/hora na coluna W.
  - Atualizados [`services/googleSheets.js`](file:///d:/projeto-formulario/services/googleSheets.js), [`server.js`](file:///d:/projeto-formulario/server.js) e [`Zionic/reguaWhatsApp.js`](file:///d:/projeto-formulario/Zionic/reguaWhatsApp.js) para gravar a data de modificação na Coluna W no preenchimento/emissão, reconhecer `"Cancelado"` na mesma aba e reservar V/W/X.
  - Criada suíte de testes [`tests/colunas_vwx_sheets.test.js`](file:///d:/projeto-formulario/tests/colunas_vwx_sheets.test.js).

- [x] **Tarefa 13: Ajustes Finais das 5 Frentes (Coluna I/Y no 1º Envio, Re-listagem após Cancelado e Janela de 120 min)**
  - **Frente 2 (`services/googleSheets.js`):** Ao disparar o WhatsApp, marca `"Enviado"` na Coluna I (`STATUS DO FORMULÁRIO`, se ainda pendente) e a data/hora na Coluna Y (`DATA ENVIO WHATSAPP`), movendo status/contador da régua para Z e AA.
  - **Frente 4 (`LISTADOR/listador-extensoes-aperf.py`, `server.js`, `Zionic/reguaWhatsApp.js`):** Grava `_id` na Coluna J (`ID DO EVENTO`) e ignora linhas `"Cancelado"` na trava anti-duplicidade, permitindo re-listagem automática caso o aluno abra nova solicitação com o mesmo contrato.
  - **Frente 5 (`server.js`, `src/components/AdminKanban.jsx`, `src/styles.css`):** Quando o interruptor está ativo, agenda a emissão automática no Lyra para **+120 minutos** após o envio do formulário, com exibição do horário previsto no card e processamento contínuo em segundo plano (`processarFilaEmissaoAutomatica`).
