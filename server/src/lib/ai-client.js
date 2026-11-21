import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSetting } from '../settings.js';

/**
 * Бэкенды AI-помощника:
 *  - бесплатные модели Kilo (по умолчанию первыми, без ключа и без оплаты);
 *  - `dsh` — локальный DSH в headless-режиме (аккаунт/платный ключ);
 *  - `api` — любой OpenAI-совместимый endpoint (DeepSeek, OpenAI, Ollama).
 * Все получают только собранные факты (см. ai-context.js), без доступа к базе.
 */

// На РФ-сервере бесплатные модели доступны только через relay на старом (UK) хосте.
const KILO_TOKEN = String(process.env.KILO_RELAY_TOKEN || '');
const KILO_BASE = String(process.env.KILO_BASE_URL || 'https://api.kilo.ai/api/gateway').replace(/\/+$/, '');
// kilo-auto/free — авто-роутер по бесплатному пулу Kilo; openrouter/free — резервный бесплатный роутер.
const FREE_MODELS = ['kilo-auto/free', 'openrouter/free'];

export const freeFirstEnabled = () => getSetting('ai_free_first', '1') !== '0';

export function aiConfig() {
  return {
    enabled: getSetting('ai_enabled', '0') === '1',
    backend: getSetting('ai_backend', 'api') === 'dsh' ? 'dsh' : 'api',
    baseUrl: String(getSetting('ai_base_url', 'https://api.deepseek.com/v1') || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    model: String(getSetting('ai_model', 'deepseek-chat') || 'deepseek-chat').slice(0, 120),
    apiKey: String(getSetting('ai_api_key', '') || process.env.AI_API_KEY || ''),
    maxTokens: Math.min(3000, Math.max(300, Number(getSetting('ai_max_tokens', '600')) || 600)),
    freeFirst: freeFirstEnabled()
  };
}

export const aiConfigured = (cfg = aiConfig()) => {
  if (!cfg.enabled) return false;
  if (cfg.backend === 'dsh') return true;
  return Boolean(cfg.apiKey && cfg.baseUrl && cfg.model);
};

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  for (const candidate of [raw, fenced]) {
    try { return JSON.parse(candidate); } catch { /* ниже попробуем вытащить объект */ }
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* ignore */ }
    }
  }
  // Модель иногда отдаёт почти-JSON (переносы строк внутри строк, лишний текст).
  // Достаём поля регулярками, чтобы не терять ответ.
  const obj = {};
  const str = (name) => {
    const m = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
    if (!m) return null;
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1].replace(/\\n/g, '\n'); }
  };
  for (const key of ['diagnosis', 'draft', 'confidence', 'subject', 'text', 'answer', 'reason']) {
    const v = str(key);
    if (v !== null) obj[key] = v;
  }
  const arr = (name) => {
    const m = new RegExp(`"${name}"\\s*:\\s*(\\[[\\s\\S]*?\\])`).exec(raw);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  };
  for (const key of ['steps', 'actions', 'sources']) {
    const v = arr(key);
    if (v) obj[key] = v;
  }
  if (/"needHuman"\s*:\s*true/.test(raw)) obj.needHuman = true;
  return Object.keys(obj).length ? obj : null;
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

/** Бесплатная модель Kilo: без ключа, без оплаты. Возвращает null, если модель недоступна. */
export async function askKiloFree({ system, user, model = 'kilo-auto/free', timeoutMs = 45000, maxTokens = 900 }) {
  const attempt = async (tokens) => {
    const res = await fetch(`${KILO_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'dsh-our-free-model',
        ...(KILO_TOKEN ? { 'x-relay-token': KILO_TOKEN } : {})
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.2,
        max_tokens: Math.min(2400, Math.max(120, tokens)),
        stream: false
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`kilo ${model}: HTTP ${res.status} ${text.slice(0, 160)}`);
    }
    const data = await res.json().catch(() => ({}));
    const msg = data?.choices?.[0]?.message || {};
    return {
      content: String(msg.content || '').trim(),
      reasoning: String(msg.reasoning || '').slice(0, 400),
      model: `free:${String(data.model || model)}`,
      usage: data.usage || null
    };
  };

  let last = await attempt(maxTokens);
  // reasoning-модели могут потратить весь лимит на размышления — даём второй шанс с большим лимитом
  if (!last.content) last = await attempt(Math.min(2400, maxTokens * 2));
  if (!last.content) {
    const err = new Error(`kilo ${model}: пустой ответ${last.reasoning ? ' (только reasoning)' : ''}`);
    err.retryable = true;
    throw err;
  }
  return {
    content: last.content,
    model: last.model,
    usage: last.usage,
    parsed: extractJson(last.content),
    via: 'free'
  };
}

/**
 * Основной вызов: сначала бесплатные модели Kilo (если включено),
 * и только когда они недоступны — настроенный бэкенд (аккаунт/платный ключ).
 */
export async function askAi({ system, user, cfg = aiConfig(), freeMaxTokens = 900 }) {
  const freeErrors = [];
  if (cfg.freeFirst !== false) {
    for (const model of FREE_MODELS) {
      try {
        return await askKiloFree({ system, user, model, maxTokens: freeMaxTokens });
      } catch (e) {
        freeErrors.push(String(e?.message || e).slice(0, 160));
      }
    }
  }
  try {
    const result = cfg.backend === 'dsh'
      ? await askDsh({ system, user })
      : await askLlmApi({ system, user, cfg });
    return { ...result, via: 'account', freeErrors };
  } catch (e) {
    if (freeErrors.length) {
      throw new Error(`${String(e?.message || e).slice(0, 200)}. Бесплатные модели недоступны: ${freeErrors.join('; ')}`);
    }
    throw e;
  }
}

/** Проверка настроек: сначала бесплатная модель, затем настроенный провайдер. */
export async function testAiProvider(cfg = aiConfig()) {
  const freeErrors = [];
  if (cfg.freeFirst !== false) {
    try {
      const r = await askKiloFree({ system: 'Отвечай строго JSON.', user: 'Верни JSON {"ok":true}.', maxTokens: 120, timeoutMs: 30000 });
      return { ok: true, backend: 'kilo-free', model: r.model, sample: String(r.content || '').slice(0, 80) };
    } catch (e) {
      freeErrors.push(String(e?.message || e).slice(0, 120));
    }
  }
  if (cfg.backend === 'dsh') {
    const probe = await askDsh({ system: 'Отвечай одним словом.', user: 'Ответь: ок', timeoutMs: 60000 });
    return { ok: true, backend: 'dsh', sample: String(probe.content || '').slice(0, 80), freeErrors };
  }
  if (!cfg.apiKey) throw new Error('Не задан API-ключ');
  const res = await askLlmApi({
    system: 'Ты тестовый помощник. Отвечай строго JSON.',
    user: 'Верни JSON {"ok":true}.',
    cfg: { ...cfg, maxTokens: 50 },
    timeoutMs: 25000
  });
  return { ok: true, backend: 'api', model: res.model, sample: String(res.content || '').slice(0, 80), freeErrors };
}

export { extractJson };
