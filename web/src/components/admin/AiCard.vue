<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';

const form = reactive({
  enabled: false,
  backend: 'api',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  maxTokens: 900,
  apiKey: '',
  clearKey: false
});
const state = reactive({ hasKey: false, configured: false });
const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const error = ref('');
const notice = ref('');

const PRESETS = [
  { id: 'deepseek', label: 'DeepSeek API', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'ollama', label: 'Ollama (локально)', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' }
];
const preset = ref('');

function applyPreset() {
  const p = PRESETS.find((x) => x.id === preset.value);
  if (!p) return;
  form.baseUrl = p.baseUrl;
  form.model = p.model;
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const d = await api.adminAiSettings();
    Object.assign(form, {
      enabled: Boolean(d.enabled),
      backend: d.backend || 'api',
      baseUrl: d.baseUrl || 'https://api.deepseek.com/v1',
      model: d.model || 'deepseek-chat',
      maxTokens: d.maxTokens || 900,
      apiKey: '',
      clearKey: false
    });
    state.hasKey = Boolean(d.hasKey);
    state.configured = Boolean(d.configured);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const payload = { ...form };
    if (!payload.apiKey) delete payload.apiKey;
    await api.adminAiSaveSettings(payload);
    notice.value = 'Настройки AI сохранены';
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}

async function test() {
  testing.value = true;
  error.value = '';
  notice.value = '';
  try {
    const r = await api.adminAiTest();
    notice.value = `Подключение работает (${r.backend}${r.model ? ', ' + r.model : ''})`;
  } catch (e) {
    error.value = e.message;
  } finally {
    testing.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold">AI-помощник</h2>
        <p class="text-xs text-slate-500 mt-1">
          Кнопка «Спросить ИИ» в карточке клиента: модель получает только факты об аккаунте (без паролей и токенов)
          и возвращает диагноз, шаги и предложенные действия. Действия выполняет человек — модель ничего не меняет сама.
        </p>
      </div>
      <span class="chip-soon" :class="state.configured ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : ''">
        {{ state.configured ? 'готов' : 'не настроен' }}
      </span>
    </div>

    <p v-if="error" class="text-sm text-red-500 mt-3">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500 mt-3">{{ notice }}</p>
    <p v-if="loading" class="text-sm text-slate-500 mt-3">Загрузка…</p>

    <div class="grid md:grid-cols-2 gap-3 mt-4">
      <label class="flex items-center gap-2 text-sm md:col-span-2">
        <input v-model="form.enabled" type="checkbox"> Включить AI-помощника в админке
      </label>

      <div>
        <label class="label !text-xs" for="ai-backend">Бэкенд</label>
        <select id="ai-backend" v-model="form.backend" class="input !py-2 text-sm">
          <option value="api">LLM API (OpenAI-совместимый)</option>
          <option value="dsh">DSH headless (локальный агент)</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="ai-preset">Быстрый выбор провайдера</label>
        <select id="ai-preset" v-model="preset" class="input !py-2 text-sm" @change="applyPreset">
          <option value="">Не менять</option>
          <option v-for="p in PRESETS" :key="p.id" :value="p.id">{{ p.label }}</option>
        </select>
      </div>

      <div>
        <label class="label !text-xs" for="ai-base">Base URL</label>
        <input id="ai-base" v-model="form.baseUrl" class="input !py-2 text-sm font-mono" placeholder="https://api.deepseek.com/v1">
      </div>
      <div>
        <label class="label !text-xs" for="ai-model">Модель</label>
        <input id="ai-model" v-model="form.model" class="input !py-2 text-sm font-mono" placeholder="deepseek-chat">
      </div>

      <div>
        <label class="label !text-xs" for="ai-key">API-ключ {{ state.hasKey ? '(сохранён, оставьте пустым)' : '' }}</label>
        <input id="ai-key" v-model="form.apiKey" type="password" autocomplete="new-password" class="input !py-2 text-sm" placeholder="sk-…">
        <label v-if="state.hasKey" class="flex items-center gap-2 text-xs text-slate-500 mt-1">
          <input v-model="form.clearKey" type="checkbox"> удалить сохранённый ключ
        </label>
      </div>
      <div>
        <label class="label !text-xs" for="ai-tokens">Лимит ответа, токенов</label>
        <input id="ai-tokens" v-model.number="form.maxTokens" type="number" min="300" max="3000" step="100" class="input !py-2 text-sm">
      </div>
    </div>

    <p class="text-xs text-slate-500 mt-3">
      Для <b>LLM API</b> нужен ключ провайдера. Для <b>DSH</b> на сервере должен быть установлен <code class="font-mono">dsh</code> с настроенным профилем —
      тогда помощник работает на локальном агенте в режиме только чтения (90 секунд на ответ).
    </p>

    <div class="flex flex-wrap items-center gap-2 mt-4">
      <button class="btn-primary !py-2 !px-4 text-sm" :disabled="saving" @click="save">{{ saving ? 'Сохраняем…' : 'Сохранить' }}</button>
      <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="testing || !state.configured" @click="test">{{ testing ? 'Проверяем…' : 'Проверить подключение' }}</button>
      <span class="text-xs text-slate-500">Лимит: 30 запросов в час на администратора.</span>
      <router-link to="/app/admin/ai" class="text-xs text-brand-400 underline">Открыть AI-помощника →</router-link>
    </div>
  </div>
</template>
