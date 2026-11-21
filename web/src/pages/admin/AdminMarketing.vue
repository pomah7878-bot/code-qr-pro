<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDate, fmtDateTime } from '../../lib/format.js';
import Modal from '../../components/admin/Modal.vue';

const tab = ref('promo');
const error = ref('');
const notice = ref('');
const busy = ref(false);

// --- Промокоды ---
const promos = ref([]);
const promoModal = reactive({ open: false });
const form = reactive({
  id: null, code: '', kind: 'percent', value: 10, maxUses: 0, perUserLimit: 1,
  startsAt: '', expiresAt: '', active: true, note: ''
});

const KIND_LABEL = { percent: '% скидка', fixed: '₽ скидка', days: 'дней в подарок' };
const kindValue = (p) => (p.kind === 'percent' ? `${p.value} %` : p.kind === 'fixed' ? `${p.value} ₽` : `+${p.value} дн.`);

async function loadPromos() {
  promos.value = (await api.adminPromo()).promos;
}

function newPromo() {
  Object.assign(form, {
    id: null, code: '', kind: 'percent', value: 10, maxUses: 0, perUserLimit: 1,
    startsAt: '', expiresAt: '', active: true, note: ''
  });
  promoModal.open = true;
}

function editPromo(p) {
  Object.assign(form, {
    id: p.id, code: p.code, kind: p.kind, value: p.value, maxUses: p.maxUses,
    perUserLimit: p.perUserLimit, active: p.active, note: p.note || '',
    startsAt: p.startsAt ? p.startsAt.slice(0, 10) : '',
    expiresAt: p.expiresAt ? p.expiresAt.slice(0, 10) : ''
  });
  promoModal.open = true;
}

async function savePromo() {
  error.value = '';
  busy.value = true;
  try {
    const payload = { ...form, code: form.code.trim().toUpperCase() };
    if (form.id) await api.adminUpdatePromo(form.id, payload);
    else await api.adminCreatePromo(payload);
    promoModal.open = false;
    notice.value = form.id ? 'Промокод сохранён' : 'Промокод создан';
    await loadPromos();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

async function removePromo(p) {
  if (!window.confirm(`Удалить промокод ${p.code}? Погашения сохранятся в заказах.`)) return;
  error.value = '';
  try {
    await api.adminDeletePromo(p.id);
    notice.value = 'Промокод удалён';
    await loadPromos();
  } catch (e) { error.value = e.message; }
}

// --- Рассылки ---
const campaigns = ref([]);
const segments = ref([]);
const smtp = ref({ configured: false, fromEmail: '' });
const email = reactive({ segment: 'all', subject: '', body: '' });
const preview = ref(null);
const previewLoading = ref(false);

async function loadEmail() {
  const [c, s] = await Promise.all([api.adminEmailCampaigns(), api.adminSmtp()]);
  campaigns.value = c.campaigns;
  segments.value = c.segments;
  smtp.value = s;
}

async function doPreview() {
  error.value = '';
  preview.value = null;
  previewLoading.value = true;
  try {
    preview.value = await api.adminEmailPreview({ ...email });
  } catch (e) { error.value = e.message; }
  finally { previewLoading.value = false; }
}

async function sendCampaign() {
  if (!preview.value) { error.value = 'Сначала нажмите «Предпросмотр»'; return; }
  if (!window.confirm(`Отправить письмо «${email.subject}» на ${preview.value.total} адресов?`)) return;
  error.value = '';
  busy.value = true;
  try {
    const d = await api.adminEmailSend({ ...email });
    notice.value = `Кампания №${d.campaign.id} поставлена в очередь: ${d.campaign.total} писем`;
    preview.value = null;
    email.subject = '';
    email.body = '';
    await loadEmail();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; }
}

const segmentCount = computed(() => segments.value.find((s) => s.id === email.segment)?.count ?? 0);
const canSend = computed(() => Boolean(preview.value && preview.value.total && smtp.value.configured));

async function load() {
  error.value = '';
  try {
    await Promise.all([loadPromos(), loadEmail()]);
  } catch (e) { error.value = e.message; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold text-lg">Маркетинг</h2>
        <p class="text-xs text-slate-500 mt-0.5">Промокоды для клиентов и письма по сегментам базы.</p>
      </div>
      <div class="flex rounded-xl border border-slate-200 dark:border-white/10 p-0.5">
        <button class="px-3 py-1.5 rounded-lg text-sm transition" :class="tab === 'promo' ? 'bg-brand-500/20 font-semibold' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'" @click="tab = 'promo'">Промокоды</button>
        <button class="px-3 py-1.5 rounded-lg text-sm transition" :class="tab === 'email' ? 'bg-brand-500/20 font-semibold' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'" @click="tab = 'email'">Рассылки</button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <template v-if="tab === 'promo'">
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-slate-500">Скидка действует в оформлении подписки. Лимит 0 — без ограничений.</p>
        <button class="btn-primary !py-2 !px-4 text-sm" @click="newPromo">+ Промокод</button>
      </div>

      <div class="glass rounded-2xl overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
                <th class="py-3 px-4 font-medium">Код</th>
                <th class="py-3 px-4 font-medium">Условие</th>
                <th class="py-3 px-4 font-medium">Использовано</th>
                <th class="py-3 px-4 font-medium hidden md:table-cell">Период</th>
                <th class="py-3 px-4 font-medium">Статус</th>
                <th class="py-3 px-4 font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!promos.length"><td colspan="6" class="py-8 text-center text-slate-500">Промокодов пока нет.</td></tr>
              <tr v-for="p in promos" :key="p.id" class="border-b border-slate-100 dark:border-white/5 last:border-0">
                <td class="py-3 px-4">
                  <div class="font-mono font-semibold">{{ p.code }}</div>
                  <div v-if="p.note" class="text-[11px] text-slate-500">{{ p.note }}</div>
                </td>
                <td class="py-3 px-4">
                  <div>{{ KIND_LABEL[p.kind] }}</div>
                  <div class="text-xs text-slate-500">{{ kindValue(p) }}</div>
                </td>
                <td class="py-3 px-4">{{ p.usedCount }}<span class="text-slate-500"> / {{ p.maxUses || '∞' }}</span></td>
                <td class="py-3 px-4 hidden md:table-cell text-xs text-slate-500">
                  {{ p.startsAt ? fmtDate(p.startsAt) : 'сразу' }} — {{ p.expiresAt ? fmtDate(p.expiresAt) : 'бессрочно' }}
                </td>
                <td class="py-3 px-4">
                  <span class="text-xs font-semibold" :class="p.active ? 'text-emerald-500' : 'text-slate-400'">{{ p.active ? 'Активен' : 'Выключен' }}</span>
                </td>
                <td class="py-3 px-4">
                  <div class="flex gap-1.5">
                    <button class="btn-ghost !py-1 !px-2.5 text-xs" @click="editPromo(p)">Изменить</button>
                    <button class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" @click="removePromo(p)">Удалить</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-if="!smtp.configured" class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        SMTP не настроен — письма не уйдут. <router-link to="/app/admin/settings" class="underline underline-offset-2">Настроить в разделе «Настройки» →</router-link>
      </div>
      <div v-else class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
        SMTP настроен · отправляем с {{ smtp.fromEmail }}
      </div>

      <div class="grid lg:grid-cols-2 gap-4">
        <div class="glass rounded-2xl p-5 space-y-3">
          <div>
            <label class="label !text-xs" for="mail-segment">Сегмент</label>
            <select id="mail-segment" v-model="email.segment" class="input !py-2 text-sm" @change="preview = null">
              <option v-for="s in segments" :key="s.id" :value="s.id">{{ s.label }} — {{ s.count }}</option>
            </select>
          </div>
          <div>
            <label class="label !text-xs" for="mail-subject">Тема</label>
            <input id="mail-subject" v-model="email.subject" class="input !py-2 text-sm" maxlength="200" placeholder="Например: скидка 20% на PRO до пятницы" @input="preview = null">
          </div>
          <div>
            <label class="label !text-xs" for="mail-body">Текст письма</label>
            <textarea id="mail-body" v-model="email.body" rows="8" class="input text-sm" maxlength="20000" placeholder="Здравствуйте! ..." @input="preview = null"></textarea>
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="previewLoading" @click="doPreview">{{ previewLoading ? 'Считаем…' : 'Предпросмотр' }}</button>
            <button class="btn-primary !py-2 !px-4 text-sm ml-auto" :disabled="busy || !canSend" @click="sendCampaign">{{ busy ? 'Отправляем…' : 'Отправить' }}</button>
          </div>
          <p v-if="preview" class="text-xs text-slate-500">Получателей: <b>{{ preview.total }}</b> · сегмент «{{ preview.segmentLabel }}»</p>
          <p v-else class="text-xs text-slate-500">Перед отправкой проверьте письмо в предпросмотре — уйдёт сразу {{ segmentCount }} адресам.</p>
        </div>

        <div class="glass rounded-2xl p-5">
          <h3 class="font-display font-semibold mb-2">Предпросмотр</h3>
          <p v-if="!preview" class="text-sm text-slate-500">Здесь появится письмо после нажатия «Предпросмотр».</p>
          <iframe v-else :srcdoc="preview.html" sandbox class="w-full h-[420px] rounded-xl bg-white" title="Предпросмотр письма"></iframe>
        </div>
      </div>

      <div class="glass rounded-2xl p-5">
        <h3 class="font-display font-semibold mb-3">История рассылок</h3>
        <p v-if="!campaigns.length" class="text-sm text-slate-500">Рассылок ещё не было.</p>
        <div v-for="c in campaigns" :key="c.id" class="py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <b class="truncate max-w-[280px]">{{ c.subject }}</b>
            <span class="text-xs text-slate-500">{{ c.segment }} · {{ fmtDateTime(c.createdAt) }}</span>
            <span class="ml-auto text-xs" :class="c.status === 'done' ? 'text-emerald-500' : c.status === 'sending' ? 'text-amber-500' : 'text-slate-400'">
              {{ c.status }} · {{ c.sent }} из {{ c.total }}<span v-if="c.failed"> · ошибок {{ c.failed }}</span>
            </span>
          </div>
        </div>
      </div>
    </template>

    <Modal :open="promoModal.open" :title="form.id ? 'Изменить промокод' : 'Новый промокод'" @close="promoModal.open = false">
      <div class="grid sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="label !text-xs" for="promo-code">Код</label>
          <input id="promo-code" v-model="form.code" class="input !py-2 text-sm font-mono uppercase" maxlength="32" placeholder="SALE20">
        </div>
        <div>
          <label class="label !text-xs" for="promo-kind">Тип</label>
          <select id="promo-kind" v-model="form.kind" class="input !py-2 text-sm">
            <option value="percent">Скидка %</option>
            <option value="fixed">Скидка ₽</option>
            <option value="days">Дни в подарок</option>
          </select>
        </div>
        <div>
          <label class="label !text-xs" for="promo-value">Значение</label>
          <input id="promo-value" v-model.number="form.value" type="number" min="1" class="input !py-2 text-sm">
        </div>
        <div>
          <label class="label !text-xs" for="promo-max">Всего использований (0 — без лимита)</label>
          <input id="promo-max" v-model.number="form.maxUses" type="number" min="0" class="input !py-2 text-sm">
        </div>
        <div>
          <label class="label !text-xs" for="promo-per-user">На одного клиента (0 — без лимита)</label>
          <input id="promo-per-user" v-model.number="form.perUserLimit" type="number" min="0" class="input !py-2 text-sm">
        </div>
        <div>
          <label class="label !text-xs" for="promo-start">Действует с</label>
          <input id="promo-start" v-model="form.startsAt" type="date" class="input !py-2 text-sm">
        </div>
        <div>
          <label class="label !text-xs" for="promo-end">По</label>
          <input id="promo-end" v-model="form.expiresAt" type="date" class="input !py-2 text-sm">
        </div>
        <div class="sm:col-span-2">
          <label class="label !text-xs" for="promo-note">Заметка</label>
          <input id="promo-note" v-model="form.note" class="input !py-2 text-sm" maxlength="200" placeholder="Для какой акции">
        </div>
        <label class="flex items-center gap-2 text-sm sm:col-span-2">
          <input v-model="form.active" type="checkbox"> Промокод активен
        </label>
      </div>
      <p class="text-xs text-slate-500 mt-3">Скидка не может быть больше суммы заказа: минимальная цена — 1 ₽.</p>
      <div class="flex justify-end gap-2 mt-4">
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="promoModal.open = false">Отмена</button>
        <button class="btn-primary !py-2 !px-4 text-sm" :disabled="busy" @click="savePromo">{{ busy ? 'Сохраняем…' : 'Сохранить' }}</button>
      </div>
    </Modal>
  </div>
</template>
