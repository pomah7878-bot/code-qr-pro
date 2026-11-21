<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import BrandIcon from '../../components/BrandIcon.vue';

const tab = ref('tickets');
const error = ref('');
const notice = ref('');

// --- обращения ---
const tickets = ref([]);
const counts = ref({});
const ticketsBusy = ref(false);
const filter = ref('');
const selectedTicket = ref(null);
const ticketForm = reactive({ status: 'open', adminNote: '', busy: false });

// AI-разбор обращения
const aiBusy = ref(false);
const aiResult = ref(null);
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
const actionLabel = (id) => ACTION_LABELS[id] || id;

// Готовые шаблоны ответа клиенту
const REPLY_TEMPLATES = [
  {
    label: 'Решено',
    text: 'Здравствуйте! Проблема устранена — проверьте, пожалуйста, ещё раз. Если что-то осталось, ответьте на это сообщение, и мы продолжим разбор.'
  },
  {
    label: 'Нужны детали',
    text: 'Здравствуйте! Чтобы помочь быстрее, пришлите, пожалуйста: номер задания из «Истории», точный текст ошибки, устройство и браузер. Скриншот тоже поможет.'
  },
  {
    label: 'Инструкция',
    text: 'Здравствуйте! По вашей ситуации пошагово: 1) откройте нужный раздел кабинета; 2) повторите действие по инструкции; 3) если не получится — ответьте на это сообщение и приложите скриншот. Мы на связи.'
  },
  {
    label: 'Передано инженеру',
    text: 'Здравствуйте! Передали вопрос инженеру — вернёмся с ответом в течение рабочего дня. Спасибо за терпение.'
  },
  {
    label: 'Компенсация',
    text: 'Здравствуйте! Приносим извинения за неудобства. Мы продлили ваш тариф PRO на 3 дня в качестве компенсации. Проверьте, пожалуйста, срок в разделе «Подписка».'
  },
  {
    label: 'Оплата',
    text: 'Здравствуйте! Вопрос по оплате разбираем вручную. Уточните, пожалуйста, номер заказа или дату платежа — проверим и вернёмся с ответом.'
  }
];
function useTemplate(t) {
  ticketForm.adminNote = t.text;
  notice.value = `Шаблон «${t.label}» подставлен — можно отредактировать перед отправкой`;
}

async function loadTickets() {
  ticketsBusy.value = true;
  error.value = '';
  try {
    const r = await api.adminTickets(filter.value ? { status: filter.value } : {});
    tickets.value = r.tickets || [];
    counts.value = r.counts || {};
  } catch (e) {
    error.value = e.message;
  } finally {
    ticketsBusy.value = false;
  }
}

function openTicket(t) {
  selectedTicket.value = t;
  ticketForm.status = t.status;
  ticketForm.adminNote = t.admin_note || '';
  aiResult.value = null;
  error.value = '';
  notice.value = '';
}

async function askAiForTicket() {
  if (!selectedTicket.value) return;
  aiBusy.value = true;
  error.value = '';
  notice.value = '';
  try {
    aiResult.value = await api.adminTicketAi(selectedTicket.value.id);
  } catch (e) {
    error.value = e.message;
  } finally {
    aiBusy.value = false;
  }
}

function useAiReply() {
  if (!aiResult.value?.reply) return;
  ticketForm.adminNote = aiResult.value.reply;
  notice.value = 'Ответ AI подставлен в поле ответа — проверьте и нажмите «Сохранить»';
}

async function saveTicket() {
  if (!selectedTicket.value) return;
  ticketForm.busy = true;
  error.value = '';
  try {
    await api.adminTicketUpdate(selectedTicket.value.id, { status: ticketForm.status, adminNote: ticketForm.adminNote });
    notice.value = 'Обращение обновлено';
    await loadTickets();
    const fresh = tickets.value.find((x) => x.id === selectedTicket.value.id);
    if (fresh) openTicket(fresh);
  } catch (e) {
    error.value = e.message;
  } finally {
    ticketForm.busy = false;
  }
}

const statusLabel = (s) => ({ open: 'открыто', in_progress: 'в работе', resolved: 'решено' }[s] || s);

// --- база знаний ---
const kb = ref([]);
const kbBusy = ref(false);
const kbForm = reactive({ id: null, slug: '', title: '', summary: '', body: '', tags: '', published: true, busy: false });

async function loadKb() {
  kbBusy.value = true;
  error.value = '';
  try {
    const r = await api.adminKb();
    kb.value = r.articles || [];
  } catch (e) {
    error.value = e.message;
  } finally {
    kbBusy.value = false;
  }
}

function editKb(a) {
  Object.assign(kbForm, {
    id: a?.id || null,
    slug: a?.slug || '',
    title: a?.title || '',
    summary: a?.summary || '',
    body: a?.body || '',
    tags: a?.tags || '',
    published: a ? a.published !== 0 : true
  });
  notice.value = '';
  error.value = '';
}

async function saveKb() {
  kbForm.busy = true;
  error.value = '';
  try {
    await api.adminKbSave({ ...kbForm });
    notice.value = 'Статья сохранена';
    await loadKb();
    editKb(null);
  } catch (e) {
    error.value = e.message;
  } finally {
    kbForm.busy = false;
  }
}

async function removeKb(a) {
  if (!window.confirm(`Удалить статью «${a.title}»?`)) return;
  try {
    await api.adminKbDelete(a.id);
    notice.value = 'Статья удалена';
    await loadKb();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(() => { loadTickets(); loadKb(); });
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-bold text-xl">Поддержка</h2>
        <p class="text-xs text-slate-500 mt-1">Обращения клиентов от AI-помощника и база знаний, по которой он отвечает.</p>
      </div>
      <div class="flex gap-1.5">
        <button class="btn-ghost !py-1.5 !px-3 text-xs" :class="tab === 'tickets' ? '!border-brand-500/50 !text-brand-400' : ''" @click="tab = 'tickets'; loadTickets()">
          Обращения <span v-if="counts.open" class="ml-1 text-[11px] text-amber-500">({{ counts.open }})</span>
        </button>
        <button class="btn-ghost !py-1.5 !px-3 text-xs" :class="tab === 'kb' ? '!border-brand-500/50 !text-brand-400' : ''" @click="tab = 'kb'; loadKb()">База знаний</button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <template v-if="tab === 'tickets'">
      <div class="flex flex-wrap items-center gap-2">
        <select v-model="filter" class="input !py-1.5 text-xs w-auto" @change="loadTickets">
          <option value="">Все обращения</option>
          <option value="open">Открытые</option>
          <option value="in_progress">В работе</option>
          <option value="resolved">Решённые</option>
        </select>
        <button class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="ticketsBusy" @click="loadTickets">{{ ticketsBusy ? 'Обновляем…' : 'Обновить' }}</button>
        <span class="text-xs text-slate-500">открыто: {{ counts.open || 0 }} · в работе: {{ counts.in_progress || 0 }} · решено: {{ counts.resolved || 0 }}</span>
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-4 space-y-2 max-h-[560px] overflow-y-auto">
          <p v-if="!tickets.length" class="text-xs text-slate-500">Обращений нет.</p>
          <button v-for="t in tickets" :key="t.id"
            class="w-full text-left rounded-xl border p-3 transition"
            :class="selectedTicket?.id === t.id ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'"
            @click="openTicket(t)">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm font-medium truncate">{{ t.subject }}</div>
              <span class="chip-soon" :class="t.status === 'resolved' ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : t.status === 'in_progress' ? '!text-amber-500 !border-amber-500/30 !bg-amber-500/10' : ''">{{ statusLabel(t.status) }}</span>
            </div>
            <div class="text-[11px] text-slate-500 mt-1 truncate">{{ t.email }} · #{{ t.id }} · {{ fmtDateTime(t.created_at) }}</div>
          </button>
        </div>

        <div class="glass rounded-2xl p-4">
          <p v-if="!selectedTicket" class="text-xs text-slate-500">Выберите обращение слева.</p>
          <div v-else class="space-y-3">
            <div>
              <div class="text-sm font-semibold">{{ selectedTicket.subject }}</div>
              <div class="text-[11px] text-slate-500">#{{ selectedTicket.id }} · {{ selectedTicket.email }} · {{ fmtDateTime(selectedTicket.created_at) }}</div>
            </div>
            <div class="rounded-xl bg-slate-50 dark:bg-white/5 p-3 text-sm whitespace-pre-wrap">{{ selectedTicket.message }}</div>
            <div v-if="selectedTicket.ai_context" class="rounded-xl border border-slate-200 dark:border-white/10 p-3">
              <div class="text-[11px] text-slate-500 mb-1">Ответ AI-помощника клиенту</div>
              <p class="text-xs whitespace-pre-wrap text-slate-600 dark:text-slate-300 max-h-40 overflow-y-auto">{{ selectedTicket.ai_context }}</p>
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <button class="btn-ghost !py-1.5 !px-3 text-xs" :class="ticketForm.status === 'open' ? '!border-brand-500/50 !text-brand-400' : ''" @click="ticketForm.status = 'open'">Открыто</button>
              <button class="btn-ghost !py-1.5 !px-3 text-xs" :class="ticketForm.status === 'in_progress' ? '!border-amber-500/50 !text-amber-500' : ''" @click="ticketForm.status = 'in_progress'">В работе</button>
              <button class="btn-ghost !py-1.5 !px-3 text-xs" :class="ticketForm.status === 'resolved' ? '!border-emerald-500/50 !text-emerald-500' : ''" @click="ticketForm.status = 'resolved'">Решено</button>
              <button
                class="btn-primary !py-1.5 !px-3 text-xs ml-auto inline-flex items-center gap-1.5"
                :disabled="aiBusy" @click="askAiForTicket"
              >
                <BrandIcon name="ai" :size="15" solid="#ffffff" />
                {{ aiBusy ? 'AI думает…' : 'Передать AI-помощнику' }}
              </button>
            </div>

            <div v-if="aiResult" class="rounded-xl border border-brand-500/30 bg-brand-500/5 p-3 space-y-2.5">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <BrandIcon name="ai" :size="13" />
                  Решение от AI · {{ aiResult.model }}
                </div>
                <div class="flex items-center gap-2">
                  <button v-if="aiResult.reply" class="text-[11px] text-brand-400 underline" @click="useAiReply">Подставить в ответ</button>
                  <button class="text-[11px] text-slate-400" @click="aiResult = null">скрыть</button>
                </div>
              </div>
              <div v-if="aiResult.diagnosis">
                <div class="text-[11px] text-slate-500 mb-0.5">Диагноз</div>
                <p class="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">{{ aiResult.diagnosis }}</p>
              </div>
              <div v-if="aiResult.steps?.length">
                <div class="text-[11px] text-slate-500 mb-0.5">Что сделать</div>
                <ol class="list-decimal pl-5 text-sm space-y-1 text-slate-700 dark:text-slate-200">
                  <li v-for="(s, i) in aiResult.steps" :key="i">{{ s }}</li>
                </ol>
              </div>
              <div v-if="aiResult.reply">
                <div class="text-[11px] text-slate-500 mb-0.5">Ответ клиенту</div>
                <p class="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">{{ aiResult.reply }}</p>
              </div>
              <div v-if="aiResult.actions?.length || selectedTicket.user_id" class="flex flex-wrap items-center gap-1.5 pt-1">
                <span v-for="a in aiResult.actions" :key="a" class="text-[11px] px-2 py-0.5 rounded border border-slate-200 dark:border-white/10 text-slate-500">{{ actionLabel(a) }}</span>
                <router-link :to="`/app/admin/users/${selectedTicket.user_id}`" class="text-[11px] text-brand-400 underline ml-auto">Открыть карточку клиента →</router-link>
              </div>
              <div v-if="aiResult.needHuman" class="text-[11px] text-amber-500">AI считает, что нужен ручной разбор администратора.</div>
            </div>
            <div>
              <div class="flex flex-wrap items-center justify-between gap-1.5 mb-1">
                <label class="label !text-xs !mb-0" for="t-note">Ответ клиенту (увидит в кабинете)</label>
                <div class="flex flex-wrap gap-1">
                  <button
                    v-for="tpl in REPLY_TEMPLATES" :key="tpl.label"
                    class="text-[10px] px-2 py-0.5 rounded-lg border border-slate-200 dark:border-white/10 text-slate-500 hover:border-brand-500/40 hover:text-brand-400"
                    @click="useTemplate(tpl)"
                  >{{ tpl.label }}</button>
                </div>
              </div>
              <textarea id="t-note" v-model="ticketForm.adminNote" rows="4" maxlength="3000" class="input text-sm" placeholder="Что сделали / что ответить"></textarea>
            </div>
            <div class="flex justify-end">
              <button class="btn-primary !py-2 !px-4 text-sm" :disabled="ticketForm.busy" @click="saveTicket">{{ ticketForm.busy ? 'Сохраняем…' : 'Сохранить' }}</button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-4 space-y-2 max-h-[560px] overflow-y-auto">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Статьи ({{ kb.length }})</div>
            <button class="btn-ghost !py-1.5 !px-3 text-xs" @click="editKb(null)">Новая статья</button>
          </div>
          <button v-for="a in kb" :key="a.id"
            class="w-full text-left rounded-xl border p-2.5 transition"
            :class="kbForm.id === a.id ? 'border-brand-500/50 bg-brand-500/10' : 'border-slate-200 dark:border-white/10 hover:bg-slate-50 dark:hover:bg-white/5'"
            @click="editKb(a)">
            <div class="flex items-center justify-between gap-2">
              <div class="text-sm truncate">{{ a.title }}</div>
              <span v-if="a.published === 0" class="text-[11px] text-amber-500">скрыта</span>
            </div>
            <div class="text-[11px] text-slate-500 truncate">{{ a.slug }} · вызовов: {{ a.calls }}</div>
          </button>
        </div>

        <div class="glass rounded-2xl p-4 space-y-3">
          <div class="text-sm font-semibold">{{ kbForm.id ? 'Редактирование статьи' : 'Новая статья' }}</div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="label !text-xs" for="kb-slug">Slug</label>
              <input id="kb-slug" v-model="kbForm.slug" class="input text-sm font-mono" placeholder="print-labels">
            </div>
            <div>
              <label class="label !text-xs" for="kb-tags">Теги (через запятую)</label>
              <input id="kb-tags" v-model="kbForm.tags" class="input text-sm" placeholder="печать, pdf, этикетки">
            </div>
          </div>
          <div>
            <label class="label !text-xs" for="kb-title">Заголовок</label>
            <input id="kb-title" v-model="kbForm.title" class="input text-sm" maxlength="200">
          </div>
          <div>
            <label class="label !text-xs" for="kb-summary">Краткое описание</label>
            <input id="kb-summary" v-model="kbForm.summary" class="input text-sm" maxlength="400">
          </div>
          <div>
            <label class="label !text-xs" for="kb-body">Текст статьи</label>
            <textarea id="kb-body" v-model="kbForm.body" rows="10" maxlength="8000" class="input text-sm"></textarea>
          </div>
          <div class="flex items-center justify-between gap-2">
            <label class="flex items-center gap-2 text-xs text-slate-500">
              <input v-model="kbForm.published" type="checkbox"> опубликована
            </label>
            <div class="flex gap-2">
              <button v-if="kbForm.id" class="btn-ghost !py-2 !px-3 text-sm" @click="removeKb({ id: kbForm.id, title: kbForm.title })">Удалить</button>
              <button class="btn-primary !py-2 !px-4 text-sm" :disabled="kbForm.busy || !kbForm.slug.trim() || !kbForm.title.trim()" @click="saveKb">
                {{ kbForm.busy ? 'Сохраняем…' : 'Сохранить' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
