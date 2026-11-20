import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Локальная проверка цепочки: бесплатные Kilo недоступны → должен сработать
 * настроенный платный бэкенд (мок OpenAI-совместимого провайдера).
 */

const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'mock',
      object: 'chat.completion',
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true,"from":"paid"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }));
  });
});
await new Promise((resolve) => mock.listen(8099, '127.0.0.1', resolve));

const dbPath = path.join(os.tmpdir(), `cq-ai-chain-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
process.env.KILO_BASE_URL = 'http://127.0.0.1:9/api/gateway'; // заведомо недоступен

const { db } = await import('../src/db.js');
const { setSetting } = await import('../src/settings.js');
setSetting('ai_enabled', '1');
setSetting('ai_backend', 'api');
setSetting('ai_base_url', 'http://127.0.0.1:8099/v1');
setSetting('ai_model', 'mock-model');
setSetting('ai_api_key', 'mock-key');
setSetting('ai_free_first', '1');
setSetting('ai_max_tokens', '300');

const { askAi, aiConfig } = await import('../src/lib/ai-client.js');
const cfg = aiConfig();
const started = Date.now();
const result = await askAi({ system: 'Верни JSON.', user: 'Верни {"ok":true}', cfg, freeMaxTokens: 120 });
console.log(JSON.stringify({
  via: result.via,
  model: result.model,
  content: String(result.content).slice(0, 80),
  durationMs: Date.now() - started
}, null, 1));

mock.close();
try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
