# 🎓 Automação de Emissão de Certificados (Extensão e Aperfeiçoamento)

Sistema integrado para solicitação, validação de períodos pedagógicos, emissão automática de certificados no **Lyra**, registro no **Google Sheets**, criação de cards no **Bitrix24 (SPA)** e cancelamento automático após **96 horas** sem resposta do aluno.

Domínio de produção: **`https://certificadoies.com.br`**

---

## 🔄 Visão Geral do Processo (Ponta a Ponta)

0. **Varredura Contínua em Nuvem (GitHub Actions Cron — a cada 20 minutos)**:
   - O script `LISTADOR/listador-extensoes-aperf.py` executa de forma 100% autônoma no GitHub Actions (`.github/workflows/listador-cron.yml`) a cada **20 minutos** (`*/20 * * * *`).
   - Autentica na API do Lyra, filtra as solicitações de Extensão e Aperfeiçoamento, consulta telefones cadastrais e insere novas linhas na planilha Google Sheets.
   - **Zero consumo de CPU local**: O colaborador não precisa manter scripts rodando em sua máquina nem deixar o computador ligado.

1. **Entrada na Planilha (`Extensões e Aperfeiçoamentos` — GID `267936837`)**:
   - Novas solicitações de **Extensão** e **Aperfeiçoamento** entram na aba principal.
   - O gatilho **"Ao alterar"** do Google Apps Script (`preencherLinksNovos`) preenche automaticamente a coluna **T (`Link`)** com `https://certificadoies.com.br/solicitacoes/<token>` (HMAC-SHA256 determinístico por `CPF + data`) e notifica `POST /api/sincronizar`.
2. **Acesso do Aluno ao Formulário (`/solicitacoes/:token`)**:
   - O servidor agrupa todos os cursos ativos do aluno na janela de **96 horas** até a solicitação mais recente.
   - O aluno confere seus dados pessoais, responde se atua como **Profissional da Educação na Rede Municipal** e confirma o envio.
   - **Se Rede Municipal**: informa a data da última evolução funcional (limite de 17 meses retroativos) e aceita as datas sugeridas ou informa uma **Data de Conclusão** customizada por curso (recalculada no servidor em dias úteis).
   - **Se NÃO for da Rede Municipal (ou não for professor)**: segue direto para confirmação sem datas customizadas; na emissão do Lyra são mantidas as **datas originais** calculadas pelo próprio Lyra (`build-data`).
3. **Emissão Automática no Lyra + Bitrix24 + Planilha (`POST /api/link/:token/resposta`)**:
   - Para cada curso aprovado no formulário, o servidor executa em fila sequencial (`services/lyra.js`):
     1. Busca a solicitação `waiting_approval` no Lyra (`CPF` + `CONTRATO` `_enrolmentId` + `CURSO`).
     2. Consulta `build-data/{id}` (dados do aluno, curso e disciplinas com professor/titulação).
     3. Consulta `next-book-registry/{certificadora}/{tipoCurso}` dentro de uma fila serializada para evitar duplicidade de livro/folha/registro mesmo em envios no mesmo segundo (com retry automático em conflito `409`).
     4. Envia `PUT /certificate-solicitations/{id}` e `PUT /certificate-solicitations/{id}/approve` com as datas do aluno (ou originais do `build-data`).
   - Cria o card no **Bitrix24 SPA**:
     - Padrão: `DT1046_76:CLIENT`.
     - Se houver customização de data, observação do aluno **ou falha em algum curso no Lyra**, direciona para revisão (`DT1046_76:PREPARATION`) com o alerta detalhado na observação.
   - Atualiza a planilha com status `EMITIR` e o número de protocolo (`CERT-AAAA-XXXXXX`).
4. **Cancelamento Automático após 96 horas (`verificarExpiracao96h`)**:
   - O gatilho **"A cada hora"** do Google Apps Script verifica linhas sem `EMITIR` e sem `PROTOCOLO` com `DATA CRIAÇÃO EVENTO >= 96h`.
   - Chama `POST /api/lyra/cancelar-expirados` (protegido por `x-cron-secret`):
     - O servidor bloqueia o cancelamento caso o aluno já tenha acabado de responder (`alreadyAnswered: true`).
     - Caso contrário, cancela a solicitação no Lyra (`PUT .../cancel`).
   - Somente após confirmação do Lyra (`ok: true`), a linha é movida para **`Solicitaões Canceladas` (GID `710641972`)**, excluída da aba principal e o servidor é sincronizado.
   - O aluno que abrir o link antigo recebe **HTTP 410** com o aviso de prazo de 96h expirado e instrução para abrir nova solicitação no Portal do Aluno.

---

## 🔐 Variáveis de Ambiente (`.env` / Hostinger)

Segredos devem ser configurados apenas no `.env` local (ignorado pelo Git) e no painel de variáveis da Hostinger. Use [`.env.example`](file:///d:/projeto-formulario/.env.example) como referência.

| Variável | Obrigatória | Descrição |
| :--- | :---: | :--- |
| `PORT` | Sim | Porta do servidor Express (padrão `3000`). |
| `LINK_SECRET` | **Sim (Prod)** | Segredo forte para assinatura HMAC dos links e autenticação de `/api/lyra/cancelar-expirados`. |
| `PUBLIC_FORM_URL` | **Sim (Prod)** | URL pública oficial: `https://certificadoies.com.br`. |
| `GOOGLE_SHEET_ID` | Sim | ID da planilha Google Sheets. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Local | Caminho do JSON da Service Account (ex.: `./123.json`). |
| `GOOGLE_CREDENTIALS` / `GOOGLE_CREDENTIALS_BASE64` | Cloud | Conteúdo JSON (ou Base64) da Service Account na Hostinger. |
| `GOOGLE_SHEET_SOMENTE_LEITURA` | Não | Se `true`, lê a planilha mas **não** grava `EMITIR` e **não** emite no Lyra (útil para testes locais). |
| `BITRIX24_WEBHOOK_URL` | Sim | Webhook de entrada do Bitrix24 SPA. |
| `BITRIX24_SPA_ENTITY_TYPE_ID` | Sim | ID do SPA no Bitrix24 (`1046`). |
| `BITRIX24_SPA_CATEGORY_ID` | Sim | ID da categoria do funil (`76`). |
| `BITRIX24_SPA_STAGE_DEFAULT` | Sim | Estágio padrão (`DT1046_76:CLIENT`). |
| `BITRIX24_SPA_STAGE_REVISAO` | Sim | Estágio de revisão/pendência (`DT1046_76:PREPARATION`). |
| `LYRA_EMAIL` | **Sim (Prod)** | E-mail de acesso à API do Lyra. |
| `LYRA_PASSWORD` | **Sim (Prod)** | Senha de acesso à API do Lyra. |
| `LYRA_COMPANY` | Não | Código da empresa no Lyra (padrão `iteq`). |

---

## 📊 Configuração do Google Sheets e Apps Script

1. **Permissão na Planilha**: compartilhar com a Service Account `bot-listador@listador-470119.iam.gserviceaccount.com` como **Editor**.
2. **Abas utilizadas**:
   - `Extensões e Aperfeiçoamentos` (GID `267936837`)
   - `Solicitaões Canceladas` (GID `710641972`)
3. **Google Apps Script** ([`scripts/googleAppsScript.gs`](file:///d:/projeto-formulario/scripts/googleAppsScript.gs)):
   - Em *Configurações do Projeto → Propriedades do script*, definir `LINK_SECRET` com o **mesmo valor** configurado na Hostinger.
   - Em *Acionadores*, manter os 2 gatilhos ativos:
     1. `preencherLinksNovos` → Origem: **Da planilha** | Tipo: **Ao alterar**
     2. `verificarExpiracao96h` → Origem: **Baseado no tempo** | Tipo: **Contador de horas** → **A cada hora**

---

## 📋 Regras de Negócio e Validações do Formulário

- **Dados pessoais (somente leitura)**: Nome, CPF, Data de Nascimento, RG e Naturalidade/Nacionalidade lidos da aba `Extensões e Aperfeiçoamentos`.
- **Carga horária**: lida da coluna `CARGA` da planilha ou do catálogo em `src/data/cargasHorarias.json` (ver [`docs/cargas-horarias.md`](file:///d:/projeto-formulario/docs/cargas-horarias.md)).
- **Limite retroativo**: `17 meses` a partir da data atual.
- **Duração em meses inteiros (dias úteis)**:
  - `45h`: 1 mês (do 1º ao último dia útil do mês).
  - `100h` e `120h`: 2 meses.
  - `180h` (Aperfeiçoamento): 3 meses.
  - Feriados nacionais e estaduais/municipais de SP tratados em [`src/utils/feriados.js`](file:///d:/projeto-formulario/src/utils/feriados.js).
- **Sem sobreposição e sem datas futuras**: cursos sequenciais; períodos que ultrapassem a data atual ou que não aceitem datas válidas são bloqueados/sinalizados.
- **Cache HTTP desabilitado nas APIs**: todas as rotas `/api/*` retornam `Cache-Control: no-store` para evitar respostas `410` ou `404` cacheadas por proxy/navegador após alterações na planilha.

---

## 💻 Desenvolvimento, Build e Testes

### Instalar e rodar localmente
```bash
npm install
npm start
```
- Frontend Vite (dev): `http://localhost:5173`
- Backend Express: `http://localhost:3000`

### Build de produção (Hostinger)
```bash
npm run build
node server.js
```

### Suíte de testes automatizados
```bash
npm test
```
Executa `node --test "tests/*.test.js"`, incluindo testes de:
- Geração/atualização de links na coluna T e leitura de cancelados (`tests/links_planilha.test.js`);
- Criptografia OpenSSL do Lyra e cancelamento (`tests/lyra_cancelamento.test.js`);
- Emissão no Lyra, fila sequencial para concorrência no mesmo segundo e retry em conflito `409` (`tests/lyra_emissao.test.js`).

---

## ☁️ Automação do Listador e Régua de WhatsApp (GitHub Actions Cron - 20 min)

Para eliminar a dependência de manter computadores ligados ou gastar CPU local dos colaboradores:
- **Workflow**: [`.github/workflows/listador-cron.yml`](file:///d:/projeto-formulario/.github/workflows/listador-cron.yml)
- **Frequência**: Executa automaticamente a cada 20 minutos (`cron: '*/20 * * * *'`) com suporte a disparo manual sob demanda (`workflow_dispatch`).
- **Etapas Integradas**:
  1. **Varredura Lyra (Python)**: Extrai novas solicitações de Extensão e Aperfeiçoamento e grava na planilha Google Sheets.
  2. **Régua Automatizada de WhatsApp (Node.js - Zionic)**: Dispara automaticamente as notificações e lembretes para os alunos:
     - **D0 (Boas-vindas)**: Envia o link individual seguro de 96h assim que o aluno cai na planilha.
     - **Lembrete Diário**: Envia 1 lembrete a cada 24 horas para quem ainda não confirmou o formulário.
     - **Alerta Crítico (2h)**: Notifica com urgência quando restarem menos de 2 horas para expirar.
     - **Expirado (96h)**: Informa o cancelamento institucional e orienta reabrir pelo Portal do Aluno.
  3. **Proteção Anti-Bloqueio WhatsApp**: Intervalo obrigatório de **60 segundos** entre cada mensagem enviada, prevenindo banimentos no chip da Zionic.
  4. **Persistência das Notificações**: O status do disparo (`STATUS WHATSAPP`, `DATA ULTIMO WHATSAPP`, `TOTAL LEMBRETES WHATSAPP`) é registrado diretamente nas colunas V, W, X da planilha Google Sheets.
- **Secrets Necessárias no Repositório GitHub**:
  - `GOOGLE_CREDENTIALS`: JSON completo da conta de serviço Google (ou `GOOGLE_CREDENTIALS_BASE64`).
  - `GOOGLE_SHEET_ID`: ID da planilha do Google Drive.
  - `LYRA_EMAIL`: E-mail corporativo de acesso à API Lyra.
  - `LYRA_PASSWORD`: Senha de acesso à API Lyra.
  - `LINK_SECRET`: Segredo HMAC para assinatura dos links dos alunos.
  - `PUBLIC_FORM_URL`: URL base do formulário (ex: `https://certificadoies.com.br`).
  - `ZIONIC_EMAIL` / `ZIONIC_PASSWORD` (ou `ZIONIC_BEARER_TOKEN`): Acesso à API Zionic.
  - `ZIONIC_WHATSAPP_INSTANCE_ID`: Identificador da instância do WhatsApp na Zionic.
  - `ZIONIC_COMPANY_ID` / `ZIONIC_INTEGRATION_ID`: Metadados da empresa na Zionic.
- **Vantagem Operacional**: Autonomia total sem consumir memória ou processador da equipe, garantindo que novas solicitações entrem na planilha e os alunos sejam notificados quase em tempo real.

---

## 🔒 Autenticação da Equipe (Painel Administrativo)

Para acessar o painel administrativo (`https://certificadoies.com.br/`), os colaboradores devem autenticar-se na tela de login corporativa.
- **Credenciais**: O login e a senha de acesso são os mesmos utilizados para acessar a **Central de Diplomas** (cadastrados na aba `USUARIOS` da planilha Google Sheets, GID `1338320797`).
- **Segurança Blindada (DevTools F12)**: A autenticação é processada 100% no servidor (Node.js). Nenhuma senha ou lista de usuários é transmitida ao cliente ou exposta no console/DevTools do navegador.
- **Sessão por Token HMAC-SHA256**: Ao logar com sucesso, é emitido um token assinado com 12 horas de validade, exigido nas rotas administrativas (`/api/solicitacoes`, `/api/sincronizar`, `/api/estatisticas`, etc.).
- **Acesso Livre para Alunos**: O acesso dos estudantes via `/solicitacoes/:token` permanece 100% público e direto.

---

## 📂 Estrutura Principal do Projeto

- [`server.js`](file:///d:/projeto-formulario/server.js): Servidor Express, rotas `/api/*`, agrupamento na janela de 96h, validações e orquestração Lyra + Bitrix24 + Sheets.
- [`LISTADOR/listador-extensoes-aperf.py`](file:///d:/projeto-formulario/LISTADOR/listador-extensoes-aperf.py): Script de extração e varredura de solicitações na API Lyra e gravação no Google Sheets.
- [`Zionic/reguaWhatsApp.js`](file:///d:/projeto-formulario/Zionic/reguaWhatsApp.js): Motor da régua automatizada de notificações e lembretes via WhatsApp (Zionic) com delay de 60s anti-bloqueio.
- [`.github/workflows/listador-cron.yml`](file:///d:/projeto-formulario/.github/workflows/listador-cron.yml): Workflow GitHub Actions para execução autônoma do Listador e da Régua de WhatsApp a cada 20 minutos em nuvem.
- [`requirements.txt`](file:///d:/projeto-formulario/requirements.txt): Dependências Python do Listador para execução local e em nuvem.
- [`services/authUsuarios.js`](file:///d:/projeto-formulario/services/authUsuarios.js): Autenticação da equipe via aba `USUARIOS` da planilha, cache e geração/validação de tokens HMAC-SHA256.
- [`services/lyra.js`](file:///d:/projeto-formulario/services/lyra.js): Autenticação JWT, criptografia AES-256-CBC compatível com `api-gateway.faculdadeesp.com.br`, cancelamento e emissão sequencial com `next-book-registry`.
- [`services/googleSheets.js`](file:///d:/projeto-formulario/services/googleSheets.js): Leitura/escrita na aba principal, aba `USUARIOS` e tokens cancelados em `Solicitaões Canceladas`.
- [`services/bitrix24.js`](file:///d:/projeto-formulario/services/bitrix24.js): Criação de cards no SPA do Bitrix24 (`CLIENT` / `PREPARATION`).
- [`services/escopo.js`](file:///d:/projeto-formulario/services/escopo.js): Filtro de escopo (apenas Extensão e Aperfeiçoamento).
- [`services/cargaHoraria.js`](file:///d:/projeto-formulario/services/cargaHoraria.js): Resolução de carga horária via catálogo do Lyra.
- [`services/respostasStore.js`](file:///d:/projeto-formulario/services/respostasStore.js): Persistência atômica das respostas em `data/respostas.json`.
- [`scripts/googleAppsScript.gs`](file:///d:/projeto-formulario/scripts/googleAppsScript.gs): Automação de links na coluna T e rotina horária de expiração de 96h.
- [`src/components/LoginView.jsx`](file:///d:/projeto-formulario/src/components/LoginView.jsx): Tela de login corporativo com validação no backend.
- [`src/components/StudentForm.jsx`](file:///d:/projeto-formulario/src/components/StudentForm.jsx): Interface do formulário do aluno (incluindo tela de prazo de 96h expirado).
- [`src/components/AdminKanban.jsx`](file:///d:/projeto-formulario/src/components/AdminKanban.jsx): Painel administrativo de acompanhamento.
- [`docs/manual_apresentacao.html`](file:///d:/projeto-formulario/docs/manual_apresentacao.html): Manual operacional e apresentação executiva em HTML standalone com capturas de tela em base64.
- [`docs/manual_apresentacao.docx`](file:///d:/projeto-formulario/docs/manual_apresentacao.docx): Manual operacional e apresentação executiva em formato DOCX.

---

**Feito por Jorge Augusto**
