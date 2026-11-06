// Ambiente dos testes: webhook fictício e planilha somente leitura para não gravar dados de teste em produção.
process.env.BITRIX24_WEBHOOK_URL = 'http://bitrix.invalid/rest/1/teste';
process.env.GOOGLE_SHEET_SOMENTE_LEITURA = '1';
