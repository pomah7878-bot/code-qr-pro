<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import { assistantUi, closeAssistant } from '../lib/assistant-ui.js';
import { pageContext } from '../lib/pageContext.js';
import BrandIcon from './BrandIcon.vue';

const route = useRoute();
const messages = ref([]);
const question = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const chatEl = ref(null);
const support = reactive({ open: false, busy: false, subject: '', message: '', aiContext: '', error: '' });

const currentPage = computed(() => pageContext(route.path));
const pageKey = computed(() => assistantUi.pageKey || currentPage.value.key);
const pageLabel = computed(() => pageContext(`/app/${pageKey.value === 'overview' ? '' : pageKey.value}`).label || currentPage.value.label);

const isPremium = computed(() => {
  const id = store.plan?.id || store.plan?.key || '';
  return id === 'premium' || ['admin', 'support'].includes(store.user?.role);
});

function greeting() {
  return `Вы в разделе «${pageLabel.value}». Опишите, что не получается — подскажу по шагам.`;
}

function resetChat() {
  messages.value = [{ role: 'greet', text: greeting() }];
  question.value = '';
  error.value = '';
  notice.value = '';
  support.open = false;
}

watch(() => assistantUi.open, (open) => {
  if (open) {
    resetChat();
    if (isPremium.value) loadTickets();
  }
});
watch(() => route.path, () => {
  // смена раздела: обновляем подсказку, чтобы помощник отвечал про новое меню
  if (assistantUi.open) resetChat();
});

const quickChips = computed(() => pageContext(`/app/${pageKey.value === 'overview' ? '' : pageKey.value}`).chips || []);

function scrollChat() {
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
  });
}

async function ask() {
  const text = question.value.trim();
  if (!text || busy.value || !isPremium.value) return;
  error.value = '';
  notice.value = '';
  messages.value.push({ role: 'q', text });
  question.value = '';
  busy.value = true;
  scrollChat();
  try {
    // передаём историю диалога, чтобы помощник не переспрашивал одно и то же
    const history = messages.value
      .filter((m) => m.role === 'q' || m.role === 'a')
      .slice(-6)
      .map((m) => ({ role: m.role === 'q' ? 'user' : 'assistant', text: m.text }));
    const r = await api.assistantChat(text, pageKey.value, history);
    const repeatedClarify = Boolean(r.clarify) && history.length >= 2;
    messages.value.push({
      role: 'a',
      text: r.answer,
      clarify: Boolean(r.clarify),
      needHuman: Boolean(r.needHuman) || repeatedClarify,
      reason: r.reason || (repeatedClarify ? 'Помощник не смог решить — передайте администратору' : ''),
      sources: r.sources || []
    });
  } catch (e) {
    error.value = e.message;
    messages.value.pop();
    question.value = text;
  } finally {
    busy.value = false;
    scrollChat();
  }
}

const tickets = ref([]);
const ticketsBusy = ref(false);
const showTickets = ref(false);
async function loadTickets() {
  ticketsBusy.value = true;
  try {
    const r = await api.assistantTickets();
    tickets.value = r.tickets || [];
  } catch { /* не критично */ } finally {
    ticketsBusy.value = false;
  }
}

function openSupport() {
  const lastQ = [...messages.value].reverse().find((m) => m.role === 'q')?.text || '';
  const lastA = [...messages.value].reverse().find((m) => m.role === 'a')?.text || '';
  support.subject = (lastQ || `Вопрос из раздела «${pageLabel.value}»`).slice(0, 120);
  support.message = lastQ;
  support.aiContext = lastA.slice(0, 3000);
  support.error = '';
  support.open = true;
}

async function submitSupport() {
  if (!support.message.trim()) return;
  support.busy = true;
  support.error = '';
  try {
    const r = await api.assistantCreateTicket({
      subject: support.subject || support.message.slice(0, 80),
      message: support.message,
      aiContext: support.aiContext
    });
    support.open = false;
    notice.value = `Обращение #${r.id} создано — администратор ответит в разделе «Поддержка».`;
    await loadTickets();
  } catch (e) {
    support.error = e.message;
  } finally {
    support.busy = false;
  }
}

const statusLabel = (s) => ({ open: 'в работе', in_progress: 'проверяем', resolved: 'решено' }[s] || s);
const statusClass = (s) => (s === 'resolved'
  ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10'
  : s === 'in_progress'
    ? '!text-amber-500 !border-amber-500/30 !bg-amber-500/10'
    : '!text-brand-400 !border-brand-500/30 !bg-brand-500/10');

function onKeydown(e) {
  if (e.key === 'Escape' && assistantUi.open) closeAssistant();
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <Teleport to="body">
    <!-- Кнопка вызова окна -->
    <button
      class="ai-launcher fixed bottom-24 right-5 z-40 flex items-center gap-2 rounded-full px-4 py-3 text-sm font-semibold text-white print:hidden"
      aria-label="Открыть AI-помощника"
      @click="assistantUi.open ? closeAssistant() : (assistantUi.open = true)"
    >
      <span class="ai-launcher-icon"><BrandIcon name="star" :size="15" /></span>
      <BrandIcon name="help" :size="18" />
      <span class="hidden sm:inline">AI-помощник</span>
      <span class="ai-premium-tag">PREMIUM</span>
    </button>

    <!-- Диалоговое окно -->
    <div v-if="assistantUi.open" class="fixed inset-x-2 bottom-2 z-[75] sm:inset-auto sm:bottom-40 sm:right-5 sm:w-[430px] print:hidden">
      <div class="ai-shell">
        <div class="ai-panel flex flex-col h-[min(600px,80vh)] bg-white/95 dark:bg-[#0a0a14]/95" role="dialog" aria-modal="false" aria-label="AI-помощник">
          <div class="ai-head px-4 py-3">
            <div class="flex items-start justify-between gap-2">
              <div class="flex items-center gap-2.5 min-w-0">
                <img src="/qr-icon.svg" alt="CODE QR PRO" class="w-9 h-9 ai-logo">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="font-display font-bold tracking-wide">AI-помощник</span>
                    <span class="ai-premium-tag">PREMIUM</span>
                  </div>
                  <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    CODE QR PRO · раздел <b class="text-brand-400">{{ pageLabel }}</b>
                  </div>
                </div>
              </div>
              <button class="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Закрыть" @click="closeAssistant">
                <BrandIcon name="close" :size="18" />
              </button>
            </div>
            <div class="ai-head-line"></div>
          </div>

          <div v-if="!isPremium" class="p-5 text-center">
            <div class="ai-upsell rounded-2xl p-5">
              <BrandIcon name="star" :size="30" class="mx-auto text-brand-400" />
              <p class="text-sm mt-3 font-semibold">AI-помощник — премиальная функция</p>
              <p class="text-xs text-slate-500 mt-1">Отвечает по «Честному ЗНАКу» и работе сервиса, а сложные вопросы передаёт администратору.</p>
              <router-link to="/app/billing" class="ai-cta inline-block mt-4 !py-2.5 !px-5 text-sm" @click="closeAssistant">Оформить PREMIUM</router-link>
            </div>
          </div>

        <template v-else>
          <div ref="chatEl" class="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
            <template v-for="(m, i) in messages" :key="i">
              <div v-if="m.role === 'greet'" class="ai-greet rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-slate-200">
                {{ m.text }}
              </div>
              <div v-else-if="m.role === 'q'" class="flex justify-end">
                <div class="max-w-[86%] rounded-2xl rounded-br-md bg-brand-500/15 border border-brand-500/25 px-3 py-2 text-sm whitespace-pre-wrap">{{ m.text }}</div>
              </div>
              <div v-else class="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 text-sm bg-white/40 dark:bg-white/[0.03]">
                <p class="whitespace-pre-wrap">{{ m.text }}</p>
                <div v-if="m.clarify" class="text-[11px] text-slate-500 mt-1">Уточнение — ответьте, и подскажу точнее.</div>
                <div v-if="m.sources?.length" class="flex flex-wrap gap-1 mt-1.5">
                  <span v-for="s in m.sources" :key="s.slug" class="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-white/10 text-slate-500">{{ s.title }}</span>
                </div>
                <div v-if="m.needHuman" class="mt-1.5 flex flex-wrap items-center gap-2">
                  <span class="text-[11px] text-amber-500">{{ m.reason || 'Нужен администратор' }}</span>
                  <button class="btn-primary !py-1 !px-2.5 text-[11px]" @click="openSupport">Передать в поддержку</button>
                </div>
              </div>
            </template>
            <div v-if="busy" class="text-xs text-slate-500">Смотрю базу знаний…</div>
            <p v-if="error" class="text-xs text-red-500">{{ error }}</p>
            <p v-if="notice" class="text-xs text-emerald-500">{{ notice }}</p>
            <div v-if="showTickets" class="rounded-xl border border-slate-200 dark:border-white/10 p-2.5">
              <div class="flex items-center justify-between gap-2">
                <div class="text-[11px] text-slate-500">Мои обращения</div>
                <button class="text-[11px] text-brand-400" :disabled="ticketsBusy" @click="loadTickets">{{ ticketsBusy ? '…' : 'обновить' }}</button>
              </div>
              <p v-if="!tickets.length" class="text-[11px] text-slate-500 mt-1">Обращений пока нет.</p>
              <div v-for="t in tickets" :key="t.id" class="mt-1.5 text-[11px]">
                <div class="flex items-center justify-between gap-2">
                  <span class="truncate">{{ t.subject }}</span>
                  <span class="chip-soon" :class="statusClass(t.status)">{{ statusLabel(t.status) }}</span>
                </div>
                <p v-if="t.admin_note" class="text-slate-500 mt-0.5">Ответ: {{ t.admin_note }}</p>
              </div>
            </div>
          </div>

          <div class="ai-foot px-3 pb-2 pt-2 space-y-1.5">
            <div class="flex flex-wrap gap-1">
              <button v-for="c in quickChips" :key="c"
                class="ai-chip text-[10px] px-2 py-1 rounded-lg"
                @click="question = c">{{ c }}</button>
            </div>
            <div class="flex items-end gap-1.5">
              <textarea v-model="question" rows="2" maxlength="1500" class="input !py-2 text-sm flex-1"
                :placeholder="`Вопрос по разделу «${pageLabel}»…`" @keydown.enter.exact.prevent="ask"></textarea>
              <button class="ai-cta !py-2 !px-3 text-sm shrink-0" :disabled="busy || !question.trim()" @click="ask">
                {{ busy ? '…' : 'Спросить' }}
              </button>
            </div>
            <div class="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-500">
              <button class="underline" @click="openSupport">Не помогло — передать администратору</button>
              <div class="flex gap-2">
                <button class="underline" @click="showTickets = !showTickets">Мои обращения</button>
                <router-link to="/app/assistant" class="underline" @click="closeAssistant">Полная страница →</router-link>
              </div>
            </div>
          </div>
        </template>
        </div>
      </div>
    </div>

    <!-- Окно эскалации -->
    <div v-if="support.open" class="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" @click.self="support.open = false">
      <div class="mx-auto mt-10 w-full max-w-lg rounded-2xl bg-white dark:bg-ink-900 border border-slate-200 dark:border-white/10 p-5 shadow-2xl">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-display font-bold text-lg">Передать в поддержку</h2>
            <p class="text-xs text-slate-500 mt-1">Раздел «{{ pageLabel }}». Администратор увидит вопрос и ответ помощника.</p>
          </div>
          <button class="text-slate-400 hover:text-slate-700 dark:hover:text-white" aria-label="Закрыть" @click="support.open = false"><BrandIcon name="close" :size="18" /></button>
        </div>
        <p v-if="support.error" class="text-sm text-red-500 mt-2">{{ support.error }}</p>
        <label class="label mt-3" for="w-subject">Тема</label>
        <input id="w-subject" v-model="support.subject" class="input text-sm" maxlength="200">
        <label class="label mt-3" for="w-message">Проблема</label>
        <textarea id="w-message" v-model="support.message" rows="5" maxlength="4000" class="input text-sm"></textarea>
        <div class="flex justify-end gap-2 mt-4">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="support.open = false">Отмена</button>
          <button class="btn-primary !py-2 !px-4 text-sm" :disabled="support.busy || !support.message.trim()" @click="submitSupport">
            {{ support.busy ? 'Отправляем…' : 'Отправить в поддержку' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* Премиальное оформление: фирменный градиент, свечение, бейдж PREMIUM */
.ai-launcher {
  background: linear-gradient(135deg, #7c3aed 0%, #6366f1 45%, #d946ef 100%);
  box-shadow: 0 10px 30px -8px rgba(124, 58, 237, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.18) inset;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.ai-launcher:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 34px -8px rgba(124, 58, 237, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.24) inset;
}
.ai-launcher-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.ai-premium-tag {
  font-size: 9px;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  color: #f5d0fe;
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);
}
.ai-shell {
  padding: 1px;
  border-radius: 1.25rem;
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.85), rgba(99, 102, 241, 0.35) 45%, rgba(217, 70, 239, 0.75));
  box-shadow: 0 24px 60px -18px rgba(124, 58, 237, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.ai-panel {
  border-radius: 1.2rem;
  overflow: hidden;
  backdrop-filter: blur(18px);
}
.ai-head {
  background: linear-gradient(120deg, rgba(124, 58, 237, 0.16), rgba(99, 102, 241, 0.08) 55%, rgba(217, 70, 239, 0.14));
  border-bottom: 1px solid rgba(124, 58, 237, 0.18);
}
.ai-head-line {
  height: 1px;
  margin-top: 10px;
  background: linear-gradient(90deg, transparent, rgba(124, 58, 237, 0.45), rgba(217, 70, 239, 0.35), transparent);
}
.ai-logo {
  border-radius: 10px;
  padding: 1px;
  background: linear-gradient(135deg, #7c3aed, #d946ef);
  box-shadow: 0 4px 12px -4px rgba(124, 58, 237, 0.6);
}
.ai-greet {
  background: linear-gradient(120deg, rgba(124, 58, 237, 0.12), rgba(217, 70, 239, 0.06));
  border: 1px solid rgba(124, 58, 237, 0.25);
}
.ai-upsell {
  background: linear-gradient(140deg, rgba(124, 58, 237, 0.14), rgba(217, 70, 239, 0.08));
  border: 1px solid rgba(124, 58, 237, 0.3);
}
.ai-cta {
  border-radius: 12px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #d946ef 100%);
  box-shadow: 0 8px 22px -8px rgba(124, 58, 237, 0.7);
  transition: opacity 0.18s ease;
}
.ai-cta:disabled {
  opacity: 0.6;
  box-shadow: none;
}
.ai-chip {
  color: #7c3aed;
  border: 1px solid rgba(124, 58, 237, 0.28);
  background: rgba(124, 58, 237, 0.06);
}
.ai-chip:hover {
  border-color: rgba(124, 58, 237, 0.55);
}
:global(.dark) .ai-chip {
  color: #c4b5fd;
  background: rgba(124, 58, 237, 0.16);
}
.ai-foot {
  background: linear-gradient(180deg, transparent, rgba(124, 58, 237, 0.05));
  border-top: 1px solid rgba(124, 58, 237, 0.16);
}
</style>

