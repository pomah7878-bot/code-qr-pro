import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSetting } from '../settings.js';

/**
 * Два бэкенда AI-помощника:
 *  - `api`  — любой OpenAI-совместимый endpoint (DeepSeek, OpenAI, локальный Ollama);
 *  - `dsh`  — локальный DSH в headless-режиме (если установлен на сервере).
 * Оба получают только собранные факты (см. ai-context.js), без доступа к прод-базе.
 */

export function aiConfig() {
  return {
    enabled: getSetting('ai_enabled', '0') === '1',
    backend: getSetting('ai_backend', 'api') === 'dsh' ? 'dsh' : 'api',
    baseUrl: String(getSetting('ai_base_url', 'https://api.deepseek.com/v1') || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: String(getSetting('ai_model', 'deepseek-chat') || 'deepseek-chat').slice(0, 120),
    apiKey: String(getSetting('ai_api_key', '') || process.env.AI_API_KEY || ''),
    maxTokens: Math.min(3000, Math.max(300, Number(getSetting('ai_max_tokens', '900')) || 900))
  };
}

export const aiConfigured = (cfg = aiConfig()) => {
  if (!cfg.enabled) return false;
  if (cfg.backend === 'dsh') return true;
  return Boolean(cfg.apiKey && cfg.baseUrl && cfg.model);
};

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch { /* ниже попробуем вытащить объект */ }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { /* ignore */ }
  }
  return null;
}

/** Вызов OpenAI-совместимого /chat/completions. JSON-режим с фолбэком на обычный. */
export async function askLlmApi({ system, user, cfg = aiConfig(), timeoutMs = 45000 }) {
  if (!cfg.apiKey) throw new Error('Не задан API-ключ AI — добавьте его в «Настройки → AI-помощник»');
  const body = {
    model: cfg.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature: 0.2,
    max_tokens: cfg.maxTokens
  };

  const call = async (withJsonMode) => {
    const payload = withJsonMode ? { ...body, response_format: { type: 'json_object' } } : body;
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`LLM HTTP ${res.status}: ${text.slice(0, 240)}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  };

  let data;
  try {
    data = await call(true);
  } catch (e) {
    // некоторые провайдеры не поддерживают response_format
    if (e?.status && e.status < 500) data = await call(false);
    else throw e;
  }
  const content = String(data?.choices?.[0]?.message?.content || '');
  return { content, model: String(data?.model || cfg.model), usage: data?.usage || null, parsed: extractJson(content) };
}

/** DSH headless: один вопрос — один запуск агента в режиме только чтения. */
export async function askDsh({ system, user, timeoutMs = 90000 }) {
  const dir = mkdtempSync(join(tmpdir(), 'cq-ai-'));
  const prompt = [
    system,
    '',
    '=== ДАННЫЕ ===',
    user,
    '',
    'Верни только JSON-объект по схеме из системной инструкции, без markdown.'
  ].join('\n');
  writeFileSync(join(dir, 'prompt.txt'), prompt, 'utf8');

  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('dsh', [
        '--profile', process.env.DSH_PROFILE || 'ai-support', '--json',
        '--approval-policy', 'never', '--permission-mode', 'read-only',
        '-'
      ], { cwd: dir, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(new Error('DSH не ответил за 90 секунд'));
      }, timeoutMs);
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error('dsh не найден: ' + e.message));
      });
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('close', (code) => {
        clearTimeout(timer);
        let final = '';
        for (const line of stdout.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed[0] !== '{') continue;
          try {
            const ev = JSON.parse(trimmed);
            if (typeof ev.text === 'string' && ev.text.trim()) final = ev.text;
            else if (ev.message && typeof ev.message.content === 'string') final = ev.message.content;
          } catch { /* не JSON-событие */ }
        }
        if (!final) final = stdout.trim();
        if (code !== 0 && !final) return reject(new Error((stderr || stdout).slice(0, 300) || 'dsh вернул ошибку'));
        resolve(final);
      });
      child.stdin.end(prompt);
    });
    return { content: result, model: 'dsh-headless', usage: null, parsed: extractJson(result) };
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export async function askAi({ system, user, cfg = aiConfig() }) {
  if (cfg.backend === 'dsh') return askDsh({ system, user });
  return askLlmApi({ system, user, cfg });
}

/** Проверка настроек: короткий запрос к провайдеру. */
export async function testAiProvider(cfg = aiConfig()) {
  if (cfg.backend === 'dsh') {
    const probe = await askDsh({ system: 'Отвечай одним словом.', user: 'Ответь: ок', timeoutMs: 60000 });
    return { ok: true, backend: 'dsh', sample: String(probe.content || '').slice(0, 80) };
  }
  if (!cfg.apiKey) throw new Error('Не задан API-ключ');
  const res = await askLlmApi({
    system: 'Ты тестовый помощник. Отвечай строго JSON.',
    user: 'Верни JSON {"ok":true}.',
    cfg: { ...cfg, maxTokens: 50 },
    timeoutMs: 25000
  });
  return { ok: true, backend: 'api', model: res.model, sample: String(res.content || '').slice(0, 80) };
}

export { extractJson };
