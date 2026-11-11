# 🎓 Automação de Emissão de Certificados

Sistema integrado para emissão ágil de certificados acadêmicos (Extensão e Aperfeiçoamento), integrando formulário individual responsivo, controle via **Google Sheets**, CRM **Bitrix24** e disparos via WhatsApp (**IA Zionic**)..

---

## 🚀 Como Rodar o Piloto (Apresentação de Amanhã)

Para a apresentação à diretoria, o sistema está configurado para **funcionar 100% de forma autônoma e segura** na máquina local, mesmo antes de subir para o Hostinger e sem depender obrigatoriamente de conexão ativa com a planilha.

### 1. Iniciar a aplicação:
No terminal, dentro da pasta `certificados-app`:
```bash
npm start
```

### 2. Acessando no computador onde está rodando (Local):
- **Painel da Equipe (Kanban):** [http://localhost:5173](http://localhost:5173)
- **API Backend:** [http://localhost:3000](http://localhost:3000)

### 3. Acessando de OUTRO computador na sala de gestão ou celular (Rede / Wi-Fi):
O sistema detecta automaticamente o IP da sua máquina na rede e permite o acesso de qualquer dispositivo conectado ao mesmo Wi-Fi/rede:
- **No PC da Sala da Gestão:** Abra o navegador e digite o IP exibido no terminal ao iniciar o sistema:
  `http://SEU_IP_LOCAL:5173` (ex: `http://192.168.0.2:5173`)
- Todos os links gerados, botões **"Abrir link"** e **"Copiar link"** usam o IP correto automaticamente para abrir perfeitamente no computador da reunião.

### 4. Portabilidade Total (Qualquer Computador ou Pasta):
O projeto foi 100% desacoplado de caminhos absolutos:
- Você pode copiar a pasta inteira para qualquer computador da empresa (em qualquer pasta ou disco, ex: `C:\Projetos`, `D:\Empresa`, etc.).
- O arquivo `123.json` de credenciais é detectado automaticamente tanto dentro de `certificados-app` quanto na pasta raiz pai.
- Bastará rodar `npm start` no computador da empresa.

---

## 📊 Conectando ao Google Sheets (Produção ou Teste Real)

O projeto já está integrado à biblioteca oficial do Google e configurado com a Service Account do arquivo `123.json`.

### 1. Compartilhar a Planilha:
Abra a sua planilha no Google Sheets e compartilhe com permissão de **Editor** para o e-mail:
```
bot-listador@listador-470119.iam.gserviceaccount.com
```

### 2. Configurar o ID no `.env`:
Abra o arquivo `.env` dentro de `certificados-app` e insira o ID da planilha:
```env
GOOGLE_SHEET_ID=SEU_ID_DA_PLANILHA_AQUI
```
*(O ID fica na URL da planilha: `https://docs.google.com/spreadsheets/d/SEU_ID_AQUI/edit`)*

### 3. Testes locais com a planilha real (somente leitura):
Para ver o formulário com os dados reais da planilha **sem gravar nada nela**, defina `GOOGLE_SHEET_SOMENTE_LEITURA=true` antes de iniciar. A planilha é lida normalmente (aba `Extensões e Aperfeiçoamentos`), mas o status `EMITIR` não é escrito nela ao enviar um formulário. Para também não criar card no Bitrix24, aponte `BITRIX24_WEBHOOK_URL` para um endereço inválido (ex.: `http://localhost:9`) e use um `RESPOSTAS_FILE` de teste.

### 4. Modo de Contingência (Fallback Seguro):
Se o `GOOGLE_SHEET_ID` estiver vazio ou a planilha não estiver acessível, o sistema utiliza automaticamente a base local (`src/data/solicitacoesRaw.json`), garantindo que **a demonstração nunca falhe ou trave**.

---

## 🗂️ Dados Pessoais dos Alunos

Os dados pessoais exibidos no formulário (Data de Nascimento, RG e Naturalidade/Nacionalidade) são lidos diretamente das colunas da aba principal **"Extensões e Aperfeiçoamentos"** (cabeçalhos contendo `NASCIMENTO`, `RG` e `NATURALIDADE` ou `NACIONALIDADE`). Não há necessidade de criar uma aba separada na planilha.

---

## 🔐 Variáveis de Ambiente Obrigatórias

Segredos ficam **somente** no `.env` (que está no `.gitignore`); use o `.env.example` como modelo.

- `BITRIX24_WEBHOOK_URL`: URL do webhook de entrada do Bitrix24. Não há valor padrão no código; sem ela, o formulário continua recebendo respostas, mas nenhum card é criado no Bitrix24 (o erro aparece no log).
- `LINK_SECRET`: segredo que assina os links dos alunos. Em produção (`NODE_ENV=production`) o servidor **não inicia** sem ele; em desenvolvimento usa um segredo fixo e avisa no log. Trocar o valor invalida os links já enviados.

---

## 🌐 Publicação no Domínio Hostinger

Quando for publicar em `certificadosies.com.br`:

1. No arquivo `.env`, altere a URL base:
   ```env
   PUBLIC_FORM_URL=https://certificadoies.com.br
   ```
2. Gere a versão de produção do frontend:
   ```bash
   npm run build
   ```
3. No Hostinger (VPS ou Node.js Selector):
   - Aponte a aplicação para `server.js`;
   - Os links enviados aos alunos pelo WhatsApp serão montados automaticamente no formato:
     `https://certificadoies.com.br/solicitacoes/<token>`

---

## 📋 Regras de Negócio e Validações do Formulário

0. **Dados pessoais e dos cursos (somente leitura):**
   - Exibe Nome, CPF, Data de Nascimento, RG e Naturalidade, e o tipo de cada curso com a carga horária (ex: `Extensão • 45h`).
   - **Data de Nascimento, RG e Naturalidade/Nacionalidade** vêm diretamente das colunas correspondentes na aba principal **"Extensões e Aperfeiçoamentos"**. Sem essas colunas ou vazias, o formulário mostra "Não informado".
   - A **carga horária** vem da coluna `CARGA` da planilha, se existir, ou do catálogo do Lyra (ver "Cargas Horárias dos Cursos"). Sem correspondência, o tipo do curso aparece sem a carga.
   - Logo abaixo dos dados pessoais fica o aviso institucional sobre atualização cadastral na aba "Meus Dados" e o prazo de **96hr**.

1. **Profissional da Educação na Rede Municipal:**
   - Pergunta única: *Você é profissional da área da Educação e atua na Rede Municipal de ensino?*
   - **Sim:** a data da última evolução funcional é **obrigatória** e deve estar dentro do limite retroativo de 17 meses.
   - **Não:** o formulário segue direto para a confirmação.

2. **Sugestão Inteligente de Períodos Pedagógicos:**
   - **Limite Retroativo:** 17 meses a partir da data atual (a data da evolução também respeita esse limite).
   - **Duração por carga horária (meses inteiros, sempre em dias úteis):**
     - **45h:** do início ao fim do mesmo mês (ex.: `01/10/2026` a `30/10/2026`).
     - **100h e 120h:** do início de um mês ao fim do mês seguinte (ex.: `01/09/2026` a `30/10/2026`).
     - **Aperfeiçoamento 180h:** 3 meses (ex.: `03/08/2026` a `30/10/2026`).
   - **Dias úteis:** o início é o 1º dia útil do mês e o fim é o último dia útil do mês final. Sábados, domingos e feriados são pulados (feriados nacionais, Sexta-feira Santa, 25/01 e 09/07 de São Paulo; pontos facultativos como Carnaval e Corpus Christi não entram). A lista fica em `src/utils/feriados.js`.
   - **Primeiro curso:** começa no 1º dia útil do primeiro mês posterior à data da última evolução.
   - **Sem Sobreposição:** cursos sequenciais; o Curso 2 começa no mês seguinte ao término do Curso 1.
   - **Sem datas futuras:** períodos que terminam depois de hoje são cancelados por data futura.
   - **Carga desconhecida ou sem regra (ex.: 36h):** usa o padrão do tipo (Extensão = 100h, Aperfeiçoamento = 180h) e registra `cargaEstimada` na resposta.

3. **Aceite das Datas Sugeridas:**
   - Cada curso tem "Aceito" / "Não Aceito". No "Não Aceito", o aluno informa a **Data de Conclusão**. Se ela cair em fim de semana, é antecipada para o último dia útil; o início é o 1º dia útil do mês que está (duração - 1) meses antes do mês da conclusão, respeitando o limite de 17 meses. A conclusão não pode passar da data atual. O servidor recalcula esse período com a carga horária do curso, sem confiar nas datas enviadas pelo navegador.

4. **Confirmação:**
   - *"Confirmo que todas as informações estão corretas e estou ciente de que não será possível alterá-las após o envio deste formulário."*

---

## 🧪 Testes

```bash
npm test
```
Executa a suíte automatizada (`node --test`) em `tests/`, compatível com Windows. Inclui o teste de persistência, que sobe o servidor localmente numa porta temporária e usa um Bitrix24 simulado (nenhuma chamada ao webhook real).

---

## 📚 Cargas Horárias dos Cursos

Levantamento das cargas horárias dos cursos de Extensão, Aperfeiçoamento, Pós-Graduação, Capacitação, Atualização e variantes (alguns tipos ainda não consultados), feito a partir do Lyra, em [`docs/cargas-horarias.md`](docs/cargas-horarias.md) (lista completa em [`docs/cargas-horarias.csv`](docs/cargas-horarias.csv)). O formulário atende apenas Extensão e Aperfeiçoamento; os demais tipos constam só como referência. O sistema usa esses dados apenas para exibir a carga horária de cada curso no formulário; ainda não são usados no cálculo das datas. Dúvidas pendentes sobre o processo: [`docs/perguntas-processo.md`](docs/perguntas-processo.md).

---

## 📂 Arquitetura do Projeto

* `server.js`: Servidor Express com APIs de links, agrupamento por janela de 24h via HMAC determinístico, sincronização e rotas SPA.
* `services/googleSheets.js`: lê as solicitações e dados pessoais (RG, nascimento, naturalidade) diretamente da aba principal "Extensões e Aperfeiçoamentos".
* `services/escopo.js`: Define o escopo do formulário. Solicitações de tipos diferentes de Extensão e Aperfeiçoamento (inclui "Reingresso" e "Projeto de Extensão") são ignoradas ao carregar a base.
* `services/cargaHoraria.js`: Descobre a carga horária do curso pelo tipo + nome, usando o catálogo do Lyra em `src/data/cargasHorarias.json` (gerado por `node scripts/gerarCargasHorarias.js` a partir de `docs/cargas-horarias.csv`). A carga da planilha tem prioridade; se não houver correspondência única, fica em branco (o sistema não adivinha).
* `services/respostasStore.js`: Persistência das respostas dos alunos em `data/respostas.json` (gravação atômica). As respostas sobrevivem a reinícios do servidor e impedem novo envio do mesmo formulário. O arquivo contém dados pessoais e está no `.gitignore`; o caminho pode ser alterado com a variável `RESPOSTAS_FILE`.
* `services/googleSheets.js`: Módulo de autenticação com o Google Cloud (Service Account `bot-listador@...`), leitura em tempo real da aba `"Extensões e Aperfeiçoamentos"` e atualização do status para `EMITIR`.
* `src/utils/feriados.js`: Calendário de feriados usado para pular dias não úteis nos períodos.
* `src/utils/dateSuggestions.js`: Algoritmo de cálculo de cronograma pedagógico sequencial sem conflito de períodos.
* `src/App.jsx`: Roteamento inteligente que detecta se o acesso é do aluno (`/solicitacoes/:token` ou `?t=...`) ou da equipe (Kanban administrativo).
* `src/components/StudentForm.jsx`: Formulário responsivo com dados pessoais, pergunta única da Rede Municipal, cronograma de datas sugeridas com aceite por curso (Data de Conclusão no "Não Aceito") e confirmação.
* `src/components/AdminKanban.jsx`: Painel Kanban com indicador Google Sheets ao vivo, cards com observações em destaque e cronograma sugerido.
* `src/components/AutomationGuide.jsx`: Guia visual da arquitetura de automação.
