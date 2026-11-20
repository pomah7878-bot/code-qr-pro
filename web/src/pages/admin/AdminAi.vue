<script setup>
import { nextTick, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import BrandIcon from '../../components/BrandIcon.vue';

const search = ref('');
const users = ref([]);
const searchBusy = ref(false);
const selected = ref(null);
const messages = ref([]);
const question = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const aiState = reactive({ configured: false, checked: false });
const historyLoading = ref(false);
const chatEl = ref(null);
const actionBusy = ref('');

const QUICK = [
  'Клиент не может войти — в чём причина?',
  'Не скачивается PDF или ошибка печати',
  'Исчерпан дневной лимит кодов',
  'Оплата не прошла, PREMIUM не активировался',
  'Проверь общее состояние аккаунта'
];
const ACTION_LABELS = {
  unlock_login: 'Разблокировать вход',
  reset_2fa: 'Сбросить 2FA',
  login_link: 'Ссылка для входа',
  reset_usage: 'Обнулить лимит кодов',
  clear_password_flag: 'Снять «сменить пароль»',
  clear_rate_limits: 'Снять лимит запросов',
  compensate: 'Компенсация',
  revoke_api_keys: 'Отозвать API-ключи',
  view_as_client: 'Смотреть как клиент',
  send_email: 'Написать клиенту'
};
const confidenceLabel = (c) => ({ high: 'уверен', medium: 'средняя уверенность', low: 'мало данных' }[c] || c);
const actionLabel = (id) => ACTION_LABELS[id] || id;

let searchTimer = 0;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(), 300);
});

async function runSearch() {
  const q = search.value.trim();
  if (!q) { users.value = []; return; }
  searchBusy.value = true;
  error.value = '';
  try {
    const r = await api.adminUsers({ q, per: 8 });
    users.value = r.users || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    searchBusy.value = false;
  }
}

async function checkAi() {
  try {
    const s = await api.adminAiSettings();
    aiState.configured = Boolean(s.configured);
  } catch {
    aiState.configured = false;
  } finally {
    aiState.checked = true;
  }
}

function scrollChat() {
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
  });
}

async function selectUser(user) {
  selected.value = user;
  messages.value = [];
  error.value = '';
  notice.value = '';
  historyLoading.value = true;
  try {
    const r = await api.adminAiHistory(user.id);
    for (const q of (r.queries || []).slice().reverse()) {
      messages.value.push({ role: 'q', text: q.question, at: q.created_at });
      messages.value.push({ role: 'a', answer: q.answer, actions: q.actions || [], model: q.model, durationMs: q.duration_ms });
    }
  } catch {
    /* история не критична */
  } finally {
    historyLoading.value = false;
    scrollChat();
  }
}

async function ask() {
  const text = question.value.trim();
  if (!text || !selected.value || busy.value) return;
  error.value = '';
  notice.value = '';
  messages.value.push({ role: 'q', text });
  question.value = '';
  busy.value = true;
  scrollChat();
  try {
    const r = await api.adminAiAsk(selected.value.id, text);
    messages.value.push({ role: 'a', answer: r, actions: r.actions || [], model: r.model, durationMs: r.durationMs });
  } catch (e) {
    error.value = e.message;
    messages.value.pop();
    question.value = text;
  } finally {
    busy.value = false;
    scrollChat();
  }
}

async function runAction(action) {
  if (!selected.value) return;
  const user = selected.value;
  const act = async (fn, okText) => {
    actionBusy.value = action;
    error.value = '';
    notice.value = '';
    try {
      const r = await fn();
      notice.value = typeof okText === 'function' ? okText(r) : okText;
    } catch (e) {
      error.value = e.message;
    } finally {
      actionBusy.value = '';
    }
  };
  if (action === 'unlock_login') return act(() => api.adminUnlockLogin(user.id), (r) => `Вход разблокирован (было попыток: ${r.clearedFails})`);
  if (action === 'reset_2fa') {
    if (!window.confirm(`Сбросить 2FA у ${user.email}? Все сессии завершатся.`)) return;
    return act(() => api.adminReset2fa(user.id), '2FA сброшена, сессии завершены');
  }
  if (action === 'login_link') {
    return act(async () => {
      const r = await api.adminLoginLink(user.id);
      try { await navigator.clipboard.writeText(r.url); } catch { /* clipboard может быть запрещён */ }
      return r;
    }, (r) => `Ссылка входа скопирована: ${String(r.url).slice(0, 48)}…`);
  }
  if (action === 'reset_usage') return act(() => api.adminResetUsage(user.id), (r) => `Лимит кодов обнулён (было ${r.cleared})`);
  if (action === 'clear_password_flag') return act(() => api.adminClearPasswordFlag(user.id), 'Требование сменить пароль снято');
  if (action === 'clear_rate_limits') return act(() => api.adminClearRateLimits(user.id), (r) => `Снято лимитов: ${r.removed}`);
  if (action === 'revoke_api_keys') {
    if (!window.confirm('Отозвать все API-ключи клиента?')) return;
    return act(() => api.adminRevokeApiKeys(user.id), (r) => `Отозвано ключей: ${r.removed}`);
  }
  if (action === 'compensate') {
    const days = Number(prompt('Компенсация: на сколько дней продлить PREMIUM?', '3'));
    if (!Number.isFinite(days) || days < 1) return;
    return act(() => api.adminCompensate(user.id, days, 'AI-помощник'), (r) => `PREMIUM продлён до ${String(r.premiumUntil).slice(0, 10)}`);
  }
  if (action === 'view_as_client') {
    return act(async () => {
      const r = await api.adminImpersonate(user.id);
      window.open(r.url, '_blank', 'noopener');
      return r;
    }, 'Просмотр открыт в новой вкладке');
  }
  if (action === 'send_email') {
    notice.value = 'Письмо отправляется из карточки клиента → «Написать клиенту»';
  }
}

function copyDraft(answer) {
  navigator.clipboard.writeText(answer.draft || '').then(
    () => { notice.value = 'Черновик письма скопирован'; },
    () => { error.value = 'Не удалось скопировать'; }
  );
}

onMounted(checkAi);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-bold text-xl">AI-помощник</h2>
        <p class="text-xs text-slate-500 mt-1">
          Выберите клиента, опишите проблему — помощник посмотрит факты аккаунта и предложит диагноз, шаги и действия.
          Меняет только человек: действия запускаются кнопками.
        </p>
      </div>
      <span class="chip-soon" :class="aiState.configured ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : '!text-amber-500 !border-amber-500/30 !bg-amber-500/10'">
        {{ aiState.configured ? 'готов к работе' : 'не настроен' }}
      </span>
    </div>

    <p v-if="aiState.checked && !aiState.configured" class="text-sm text-amber-500">
      AI-помощник не настроен. <router-link to="/app/admin/settings" class="underline">Настройки → AI-помощник</router-link>
    </p>
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="grid lg:grid-cols-[300px_1fr] gap-4">
      <div class="glass rounded-2xl p-4 space-y-3">
        <label class="label !text-xs" for="ai-user-search">Клиент</label>
        <div class="flex items-center gap-2">
          <input id="ai-user-search" v-model="search" class="input !py-2 text-sm" placeholder="email или ID">
          <BrandIcon name="search" :size="16" class="text-slate-400 shrink-0" />
        </div>
        <p v-if="searchBusy" class="text-xs text-slate-500">Ищем…</p>
        <p v-else-if="search && !users.length" class="text-xs text-slate-500">Никого не нашли.</p>
        <div class="space-y-1 max-h-[420px] overflow-y-auto">
          <button v-for="u in users" :key="u.id"
            class="w-full text-left rounded-xl border px-3 py-2 transition"
            :class="selected?.id === u.id ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'"
            @click="selectUser(u)">
            <div class="text-sm truncate">{{ u.email }}</div>
            <div class="text-[11px] text-slate-500">ID {{ u.id }} · {{ String(u.plan).toUpperCase() }} · {{ u.status === 'blocked' ? 'заблокирован' : 'активен' }}</div>
          </button>
        </div>
        <p v-if="!search" class="text-xs text-slate-500">Введите email клиента или его ID, чтобы начать.</p>
      </div>

      <div class="glass rounded-2xl p-4 flex flex-col min-h-[520px]">
        <div v-if="!selected" class="flex-1 flex flex-col items-center justify-center text-center text-slate-500 gap-2">
          <BrandIcon name="star" :size="28" />
          <p class="text-sm">Слева выберите клиента — здесь появится диалог.</p>
        </div>

        <template v-else>
          <div class="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-white/10">
            <div class="min-w-0">
              <div class="text-sm font-semibold truncate">{{ selected.email }}</div>
              <div class="text-[11px] text-slate-500">ID {{ selected.id }} · {{ String(selected.plan).toUpperCase() }} · {{ selected.status }}</div>
            </div>
            <router-link :to="`/app/admin/users/${selected.id}`" class="btn-ghost !py-1.5 !px-3 text-xs">Открыть карточку</router-link>
          </div>

          <div ref="chatEl" class="flex-1 overflow-y-auto py-3 space-y-3 max-h-[420px]">
            <p v-if="historyLoading" class="text-xs text-slate-500">Загружаем историю…</p>
            <p v-if="!historyLoading && !messages.length" class="text-xs text-slate-500">
              История пуста. Задайте вопрос или выберите быстрый вариант ниже.
            </p>

            <template v-for="(m, i) in messages" :key="i">
              <div v-if="m.role === 'q'" class="flex justify-end">
                <div class="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500/15 border border-brand-500/25 px-3 py-2 text-sm">
                  {{ m.text }}
                  <div v-if="m.at" class="text-[10px] text-slate-500 mt-1">{{ fmtDateTime(m.at) }}</div>
                </div>
              </div>

              <div v-else class="rounded-2xl border border-slate-200 dark:border-white/10 p-3 space-y-2 text-sm bg-white/40 dark:bg-white/[0.03]">
                <div class="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                  <span class="chip-soon"
                    :class="m.answer?.confidence === 'high' ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10'
                      : m.answer?.confidence === 'low' ? '!text-amber-500 !border-amber-500/30 !bg-amber-500/10' : ''">
                    {{ confidenceLabel(m.answer?.confidence) }}
                  </span>
                  <span v-if="m.model">{{ m.model }}</span>
                  <span v-if="m.durationMs">· {{ (m.durationMs / 1000).toFixed(1) }} с</span>
                </div>
                <div>
                  <div class="text-[11px] text-slate-500 mb-1">Диагноз</div>
                  <p class="whitespace-pre-wrap">{{ m.answer?.diagnosis }}</p>
                </div>
                <div v-if="m.answer?.steps?.length">
                  <div class="text-[11px] text-slate-500 mb-1">Что сделать</div>
                  <ol class="list-decimal pl-5 space-y-1">
                    <li v-for="(s, si) in m.answer.steps" :key="si">{{ s }}</li>
                  </ol>
                </div>
                <div v-if="m.answer?.draft">
                  <div class="flex items-center justify-between gap-2">
                    <div class="text-[11px] text-slate-500">Черновик письма</div>
                    <button class="text-[11px] text-brand-400" @click="copyDraft(m.answer)">Копировать</button>
                  </div>
                  <p class="whitespace-pre-wrap mt-1 text-slate-600 dark:text-slate-300">{{ m.answer.draft }}</p>
                </div>
                <div v-if="m.actions?.length" class="flex flex-wrap gap-1.5 pt-1">
                  <button v-for="a in m.actions" :key="a"
                    class="btn-ghost !py-1.5 !px-2.5 text-[11px]"
                    :disabled="actionBusy === a" @click="runAction(a)">
                    {{ actionLabel(a) }}
                  </button>
                </div>
              </div>
            </template>

            <div v-if="busy" class="text-xs text-slate-500">Помощник изучает аккаунт… обычно 10–20 секунд.</div>
          </div>

          <div class="pt-3 border-t border-slate-200 dark:border-white/10 space-y-2">
            <div class="flex flex-wrap gap-1.5">
              <button v-for="q in QUICK" :key="q"
                class="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 hover:border-brand-500/40"
                @click="question = q">{{ q }}</button>
            </div>
            <div class="flex items-end gap-2">
              <textarea v-model="question" rows="2" maxlength="2000" class="input text-sm flex-1"
                placeholder="Опишите проблему клиента…" @keydown.enter.exact.prevent="ask"></textarea>
              <button class="btn-primary !py-2.5 !px-4 text-sm shrink-0" :disabled="busy || !question.trim()" @click="ask">
                {{ busy ? 'Думаем…' : 'Спросить' }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
