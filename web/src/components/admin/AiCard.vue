<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import BrandIcon from '../BrandIcon.vue';

const form = reactive({
  enabled: false,
  backend: 'api',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  maxTokens: 600,
  freeFirst: true,
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
      maxTokens: d.maxTokens || 600,
      freeFirst: d.freeFirst !== false,
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

const usage = ref(null);
const usageBusy = ref(false);
const usageError = ref('');

async function loadUsage() {
  usageBusy.value = true;
  usageError.value = '';
  try {
    usage.value = await api.adminAiUsage();
  } catch (e) {
    usageError.value = e.message;
  } finally {
    usageBusy.value = false;
  }
}

const money = (v, currency) => {
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : '';
  return `${symbol}${Number(v || 0).toFixed(2)}`;
};
const fmtNum = (v) => Number(v || 0).toLocaleString('ru-RU');

onMounted(() => { load(); loadUsage(); });
</script>

<template>
  <div class="glass rounded-2xl p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold flex items-center gap-2">
          <span class="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-accent-500 text-white shadow-md shadow-violet-600/30">
            <BrandIcon name="ai" :size="18" solid="#ffffff" />
          </span>
          AI-помощник
        </h2>
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
      <label class="flex items-start gap-2 text-sm md:col-span-2">
        <input v-model="form.freeFirst" type="checkbox" class="mt-0.5">
        <span>
          <b>Сначала бесплатные модели Kilo</b> (kilo-auto/free, openrouter/free), аккаунт — только если они недоступны.
          <span class="block text-xs text-slate-500">Экономит токены платного аккаунта: бесплатные модели не тарифицируются.</span>
        </span>
      </label>
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

    <div class="mt-5 rounded-xl border border-slate-200 dark:border-white/10 p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="text-sm font-semibold">Использование и остатки</div>
        <button class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="usageBusy" @click="loadUsage">
          {{ usageBusy ? 'Обновляем…' : 'Обновить' }}
        </button>
      </div>
      <p v-if="usageError" class="text-xs text-red-500 mt-2">{{ usageError }}</p>
      <p v-else-if="!usage" class="text-xs text-slate-500 mt-2">Загрузка…</p>

      <div v-else class="grid md:grid-cols-2 gap-3 mt-3 text-sm">
        <div class="rounded-xl bg-emerald-500/5 border border-emerald-500/20 p-3">
          <div class="text-xs text-slate-500">Бесплатные модели Kilo</div>
          <div class="mt-1">
            <b>{{ usage.free.models }}</b> доступно
            <span v-if="usage.free.enabled" class="chip-soon !text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10 ml-1">включены первыми</span>
            <span v-else class="chip-soon !text-amber-500 !border-amber-500/30 !bg-amber-500/10 ml-1">выключены</span>
          </div>
          <div class="text-xs text-slate-500 mt-1">
            Сегодня: {{ fmtNum(usage.free.today.requests) }} запросов · {{ fmtNum(usage.free.today.totalTokens) }} токенов
            <span class="text-emerald-500">(бесплатно)</span>
          </div>
          <div v-if="usage.free.sample?.length" class="text-[11px] text-slate-500 mt-1 font-mono truncate">
            {{ usage.free.sample.slice(0, 3).join(', ') }}
          </div>
          <div v-if="!usage.free.available" class="text-[11px] text-amber-500 mt-1">пул недоступен: {{ usage.free.error }}</div>
        </div>

        <div class="rounded-xl bg-brand-500/5 border border-brand-500/20 p-3">
          <div class="text-xs text-slate-500">Платный аккаунт ({{ usage.account.backend === 'dsh' ? 'DSH' : 'LLM API' }})</div>
          <div v-if="usage.account.balance?.available" class="mt-1">
            Баланс: <b>{{ money(usage.account.balance.total, usage.account.balance.currency) }}</b>
            <span class="text-xs text-slate-500">(пополнено {{ money(usage.account.balance.toppedUp, usage.account.balance.currency) }})</span>
          </div>
          <div v-else class="mt-1 text-xs text-amber-500">
            Баланс недоступен: {{ usage.account.balance?.error || 'нет ключа' }}
          </div>
          <div class="text-xs text-slate-500 mt-1">
            Сегодня: {{ fmtNum(usage.account.today.requests) }} запросов · {{ fmtNum(usage.account.today.totalTokens) }} токенов
          </div>
          <div class="text-[11px] text-slate-500 mt-1">
            Средний разбор: {{ fmtNum(usage.account.avgTokens.prompt) }} вх. / {{ fmtNum(usage.account.avgTokens.completion) }} исх. токенов
          </div>
          <div v-if="usage.account.estimatedQueries !== null" class="text-[11px] text-slate-500">
            Хватит примерно на <b>{{ fmtNum(usage.account.estimatedQueries) }}</b> разборов
          </div>
        </div>
      </div>
      <p v-if="usage" class="text-[11px] text-slate-500 mt-2">
        За последний час: {{ fmtNum(usage.lastHour) }} из 30 запросов.
        <span v-if="usage.account.balance?.available && usage.account.balance.total < 1" class="text-amber-500">Баланс заканчивается — пополните аккаунт.</span>
      </p>
    </div>
  </div>
</template>
