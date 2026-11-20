import http from 'node:http';

/**
 * Мок OpenAI-совместимого провайдера для E2E AI-помощника.
 * Отвечает валидным JSON по схеме и печатает в лог полученный промпт (для проверки фактов).
 */
const answer = {
  diagnosis: 'Клиент заблокирован после 5 неудачных попыток входа; 2FA включена, а телефон потерян — нужен сброс 2FA и разблокировка.',
  steps: [
    'Снять блокировку входа после неудачных попыток',
    'Сбросить 2FA, чтобы клиент вошёл по паролю',
    'Отправить клиенту письмо с инструкцией и предложить включить 2FA заново'
  ],
  actions: ['unlock_login', 'reset_2fa', 'send_email'],
  draft: 'Здравствуйте! Мы разблокировали вход и сбросили двухфакторную аутентификацию. Войдите по обычному паролю и включите 2FA заново в разделе «Безопасность».',
  confidence: 'high'
};

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url.startsWith('/v1/chat/completions')) {
      let promptOk = false;
      try {
        const parsed = JSON.parse(body);
        const user = parsed?.messages?.find((m) => m.role === 'user')?.content || '';
        promptOk = user.includes('Пользователь #') || user.includes('Данные аккаунта');
        if (process.env.MOCK_SAVE_PROMPT) {
          import('node:fs').then((fs) => fs.writeFileSync(process.env.MOCK_SAVE_PROMPT, user, 'utf8')).catch(() => {});
        }
      } catch { /* ignore */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock-1',
        object: 'chat.completion',
        model: 'mock-model',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ ...answer, _promptOk: promptOk }) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 }
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  });
});

server.listen(8099, '127.0.0.1', () => console.log('mock llm on 127.0.0.1:8099'));
