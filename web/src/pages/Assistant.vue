<script setup>
import { computed, nextTick, onMounted, reactive, ref } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import BrandIcon from '../components/BrandIcon.vue';
import RobotMascot from '../components/RobotMascot.vue';
import Modal from '../components/admin/Modal.vue';
import SideNav from '../components/SideNav.vue';

const mascotState = ref('idle');
let mascotTimer = 0;
function setMascot(state, holdMs = 0) {
  mascotState.value = state;
  window.clearTimeout(mascotTimer);
  if (holdMs) mascotTimer = window.setTimeout(() => { mascotState.value = 'idle'; }, holdMs);
}

const messages = ref([]);
const question = ref('');
const busy = ref(false);
const error = ref('');
const notice = ref('');
const chatEl = ref(null);
const tickets = ref([]);
const ticketsLoading = ref(false);
const openThreadId = ref(null);
const threadMessages = ref([]);
const threadReply = ref('');
const threadBusy = ref(false);
const support = reactive({ open: false, busy: false, subject: '', message: '', error: '' });

// Доступно всем вошедшим: сервер ограничивает FREE/START 10 вопросами в день, остальные — 60 в час.
const isPremium = computed(() => Boolean(store.user));

const QUICK = [
  'Как сгенерировать GS1 DataMatrix?',
  'Почему PDF не скачивается с телефона?',
  'Как проверить код в «Честном ЗНАК»?',
  'Код не читается сканером',
  'Не получается войти, включена 2FA',
  'Как работает повторная печать?'
];

function scrollChat() {
  nextTick(() => {
    if (chatEl.value) chatEl.value.scrollTop = chatEl.value.scrollHeight;
  });
}

async function ask() {
  const text = question.value.trim();
  if (!text || busy.value) return;
  error.value = '';
  notice.value = '';
  messages.value.push({ role: 'q', text });
  question.value = '';
  busy.value = true;
  setMascot('think');
  scrollChat();
  try {
    const history = messages.value
      .filter((m) => m.role === 'q' || m.role === 'a')
      .slice(-6)
      .map((m) => ({ role: m.role === 'q' ? 'user' : 'assistant', text: m.text }));
    const r = await api.assistantChat(text, 'assistant', history);
    const repeatedClarify = Boolean(r.clarify) && history.length >= 2;
    messages.value.push({
      role: 'a',
      text: r.answer,
      sources: r.sources || [],
      needHuman: Boolean(r.needHuman) || repeatedClarify,
      reason: r.reason || (repeatedClarify ? 'Помощник не смог решить — передайте администратору' : ''),
      model: r.model
    });
    if (/спасибо|благодар/i.test(text)) setMascot('heart', 2200);
    else setMascot('cheer', 1700);
  } catch (e) {
    error.value = e.message;
    messages.value.pop();
    question.value = text;
    setMascot('idle');
  } finally {
    busy.value = false;
    scrollChat();
  }
}

async function toggleThread(t) {
  if (openThreadId.value === t.id) { openThreadId.value = null; return; }
  openThreadId.value = t.id; threadMessages.value = []; threadReply.value = '';
  try { const d = await api.assistantTicket(t.id); threadMessages.value = d.messages || []; }
  catch (e) { support.error = e.message; }
}

async function sendThread(t) {
  if (!threadReply.value.trim()) return;
  threadBusy.value = true;
  try { await api.assistantTicketReply(t.id, threadReply.value.trim()); threadReply.value = ''; const d = await api.assistantTicket(t.id); threadMessages.value = d.messages || []; await loadTickets(); }
  catch (e) { support.error = e.message; }
  finally { threadBusy.value = false; }
}

async function loadTickets() {
  ticketsLoading.value = true;
  try {
    const r = await api.assistantTickets();
    tickets.value = r.tickets || [];
  } catch {
    /* обращения не критичны */
  } finally {
    ticketsLoading.value = false;
  }
}

function openSupport() {
  const lastQ = [...messages.value].reverse().find((m) => m.role === 'q')?.text || '';
  const lastA = [...messages.value].reverse().find((m) => m.role === 'a')?.text || '';
  support.subject = lastQ.slice(0, 120);
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
    notice.value = `Обращение #${r.id} создано — администратор увидит его в поддержке.`;
    await loadTickets();
  } catch (e) {
    support.error = e.message;
  } finally {
    support.busy = false;
  }
}

const statusLabel = (s) => ({ open: 'в работе', in_progress: 'проверяем', resolved: 'решено' }[s] || s);
const statusClass = (s) => (s === 'resolved'
  ? 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10'
  : s === 'in_progress'
    ? 'text-amber-500 border-amber-500/30 bg-amber-500/10'
    : 'text-brand-400 border-brand-500/30 bg-brand-500/10');

onMounted(() => {
  if (!isPremium.value) return;
  loadTickets();
});
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/assistant" />
    <div class="space-y-4">
    <div class="ai-hero rounded-2xl p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <span class="ai-hero-bot"><RobotMascot :state="mascotState" :size="76" /></span>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="font-display font-bold text-2xl">AI-помощник</h1>
              <span class="ai-premium-tag">AI</span>
            </div>
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">
              CODE QR PRO · отвечает по «Честному ЗНАКу» и работе сервиса, сложные вопросы передаёт администратору.
            </p>
          </div>
        </div>
        <span class="chip-soon" :class="isPremium ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : '!text-amber-500 !border-amber-500/30 !bg-amber-500/10'">
          {{ isPremium ? 'AI · доступен' : 'AI недоступен' }}
        </span>
      </div>
    </div>

    <div v-if="!isPremium" class="glass rounded-2xl p-6 text-center">
      <BrandIcon name="star" :size="30" class="mx-auto text-brand-400" />
      <h2 class="font-display font-semibold mt-3">AI-помощник</h2>
      <p class="text-sm text-slate-500 mt-1 max-w-lg mx-auto">
        Он разбирается в GS1 DataMatrix, «Честном ЗНАКе», печати этикеток и работе сервиса, а сложные вопросы передаёт администратору.
      </p>
      <router-link to="/app/billing" class="btn-primary inline-block mt-4 !py-2.5 !px-5 text-sm">Перейти в кабинет</router-link>
    </div>

    <template v-else>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

      <div class="glass rounded-2xl p-4 flex flex-col min-h-[380px] sm:min-h-[460px]">
        <div ref="chatEl" class="flex-1 overflow-y-auto overscroll-contain space-y-3 max-h-[55vh] sm:max-h-[440px] pb-2">
          <p v-if="!messages.length" class="text-sm text-slate-500">
            Задайте вопрос — например, «почему код не читается сканером» или «как перепечатать этикетки».
          </p>

          <template v-for="(m, i) in messages" :key="i">
            <div v-if="m.role === 'q'" class="flex justify-end">
              <div class="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500/15 border border-brand-500/25 px-3 py-2 text-sm whitespace-pre-wrap">{{ m.text }}</div>
            </div>
            <div v-else class="rounded-2xl border border-slate-200 dark:border-white/10 p-3 text-sm bg-white/40 dark:bg-white/[0.03]">
              <p class="whitespace-pre-wrap">{{ m.text }}</p>
              <div v-if="m.sources?.length" class="flex flex-wrap items-center gap-1.5 mt-2">
                <span class="text-[11px] text-slate-500">Источники:</span>
                <span v-for="s in m.sources" :key="s.slug" class="text-[11px] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500">{{ s.title }}</span>
              </div>
              <div class="flex flex-wrap items-center gap-2 mt-2">
                <span v-if="m.needHuman" class="text-[11px] text-amber-500">{{ m.reason || 'Похоже, нужен администратор' }}</span>
                <button v-if="m.needHuman" class="btn-primary !py-1.5 !px-3 text-[11px]" @click="openSupport">Передать в поддержку</button>
              </div>
            </div>
          </template>

          <div v-if="busy" class="text-xs text-slate-500">Помощник ищет ответ в базе знаний…</div>
        </div>

        <div class="pt-3 border-t border-slate-200 dark:border-white/10 space-y-2">
          <div class="flex flex-wrap gap-1.5">
            <button v-for="q in QUICK" :key="q"
              class="text-[11px] px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 hover:border-brand-500/40"
              @click="question = q">{{ q }}</button>
          </div>
          <div class="flex items-end gap-2">
            <textarea v-model="question" rows="2" maxlength="1500" class="input !py-2.5 text-base sm:text-sm flex-1"
              placeholder="Ваш вопрос по сервису или маркировке…" @keydown.enter.exact.prevent="ask"></textarea>
            <button class="btn-primary !py-2.5 !px-4 text-sm shrink-0" :disabled="busy || !question.trim()" @click="ask">
              {{ busy ? 'Ищем…' : 'Спросить' }}
            </button>
          </div>
          <button class="text-[11px] text-slate-500 underline" @click="openSupport">Не помогло — передать вопрос администратору</button>
        </div>
      </div>

      <div class="glass rounded-2xl p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-display font-semibold text-sm">Мои обращения в поддержку</h2>
          <button class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="ticketsLoading" @click="loadTickets">
            {{ ticketsLoading ? 'Обновляем…' : 'Обновить' }}
          </button>
        </div>
        <p v-if="!tickets.length" class="text-xs text-slate-500 mt-2">Обращений пока нет.</p>
        <div v-else class="mt-2 space-y-2">
          <div v-for="t in tickets" :key="t.id" class="rounded-xl border border-slate-200 dark:border-white/10 p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="text-sm font-medium truncate">{{ t.subject }}</div>
              <span class="chip-soon" :class="statusClass(t.status)">{{ statusLabel(t.status) }}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1 whitespace-pre-wrap">{{ t.message }}</p>
            <p v-if="t.admin_note" class="text-xs text-emerald-500 mt-1 whitespace-pre-wrap">Ответ: {{ t.admin_note }}</p>
            <button class="btn-ghost !py-1 !px-2 text-[11px] mt-2" @click="toggleThread(t)">Диалог</button>
            <div v-if="openThreadId === t.id" class="mt-2 space-y-2 border-t border-slate-200 dark:border-white/10 pt-2">
              <div v-if="!threadMessages.length" class="text-xs text-slate-500">Сообщений нет.</div>
              <div v-for="m in threadMessages" :key="m.id" class="text-xs rounded-lg p-2" :class="m.author_type === 'admin' ? 'bg-brand-500/10' : 'bg-slate-100 dark:bg-white/5'">
                <div class="text-slate-500 mb-0.5">{{ m.author_name || m.author_type }}</div>
                <div class="whitespace-pre-wrap">{{ m.text }}</div>
              </div>
              <div class="flex gap-2">
                <input v-model="threadReply" class="input !py-1.5 text-xs" placeholder="Сообщение поддержке" @keyup.enter="sendThread(t)">
                <button class="btn-primary !py-1.5 !px-2.5 text-xs" :disabled="threadBusy || !threadReply.trim()" @click="sendThread(t)">Отправить</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <Modal :open="support.open" title="Передать вопрос в поддержку" @close="support.open = false">
      <p class="text-sm text-slate-500">Администратор увидит вопрос и ответ помощника. Опишите проблему подробно.</p>
      <p v-if="support.error" class="text-sm text-red-500 mt-2">{{ support.error }}</p>
      <label class="label mt-3" for="sup-subject">Тема</label>
      <input id="sup-subject" v-model="support.subject" class="input text-sm" maxlength="200">
      <label class="label mt-3" for="sup-message">Проблема</label>
      <textarea id="sup-message" v-model="support.message" rows="5" maxlength="4000" class="input text-sm"></textarea>
      <div class="flex justify-end gap-2 mt-4">
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="support.open = false">Отмена</button>
        <button class="btn-primary !py-2 !px-4 text-sm" :disabled="support.busy || !support.message.trim()" @click="submitSupport">
          {{ support.busy ? 'Отправляем…' : 'Отправить в поддержку' }}
        </button>
      </div>
    </Modal>
    </div>
  </div>
</template>

<style scoped>
.ai-hero {
  background: linear-gradient(120deg, rgba(124, 58, 237, 0.16), rgba(99, 102, 241, 0.08) 55%, rgba(217, 70, 239, 0.14));
  border: 1px solid rgba(124, 58, 237, 0.28);
  box-shadow: 0 18px 45px -24px rgba(124, 58, 237, 0.55);
}
.ai-hero-bot {
  width: 76px;
  height: 76px;
  flex: none;
  filter: drop-shadow(0 10px 22px rgba(124, 58, 237, .45));
}
.ai-logo {
  border-radius: 12px;
  padding: 1px;
  background: linear-gradient(135deg, #7c3aed, #d946ef);
  box-shadow: 0 6px 16px -6px rgba(124, 58, 237, 0.65);
}
.ai-premium-tag {
  font-size: 9px;
  letter-spacing: 0.08em;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 6px;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
  border: 1px solid rgba(124, 58, 237, 0.3);
}
:global(.dark) .ai-premium-tag {
  color: #ddd6fe;
  background: rgba(124, 58, 237, 0.25);
}
</style>
