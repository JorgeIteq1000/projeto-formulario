// Ambiente dos testes: webhook fictício. Os testes interceptam o fetch; nenhuma chamada real é feita.
process.env.BITRIX24_WEBHOOK_URL = 'http://bitrix.invalid/rest/1/teste';
