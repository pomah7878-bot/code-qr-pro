<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../../api.js';
import { notifyPlansChanged } from '../../lib/plans-sync.js';

const tab = ref('plans');
const plans = ref([]);
const archive = ref(null);
const subs = ref([]);
const errors = ref(null);
const stats = ref(null);
const search = ref('');
const loading = ref(false);
const error = ref('');
const notice = ref('');
const edit = ref({});
const newPlan = ref({ id: '', title: '' });
const assign = ref({ userId: null, planId: 'pro', days: 30, kind: 'paid' });
const extendDays = ref({});

const planIds = computed(() => plans.value.map((p) => p.id));

async function loadPlans() {
  const d = await api.adminBillingPlans();
  plans.value = d.plans || [];
  archive.value = d.archive;
  for (const p of plans.value) {
    edit.value[p.id] = {
      ...p,
      formats: [...(p.formats || [])],
      features: { ...(p.features || {}) }
    };
  }
}
async function loadSubs() {
  const d = await api.adminBillingSubscriptions({ query: search.value, limit: 100 });
  subs.value = d.users || [];
}
async function loadErrors() {
  errors.value = await api.adminBillingErrors();
  stats.value = await api.adminBillingStats();
}
async function loadTab() {
  error.value = ''; notice.value = '';
  loading.value = true;
  try {
    if (tab.value === 'plans') await loadPlans();
    if (tab.value === 'subs') await loadSubs();
    if (tab.value === 'errors') await loadErrors();
  } catch (e) { error.value = e.message; }
  loading.value = false;
}
// Годовая цена = 10 месячных платежей: 2 месяца в подарок.
// При изменении любой из цен вторая пересчитывается сразу.
function syncFromMonthly(id, raw) {
  if (String(raw).trim() === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !edit.value[id]) return;
  edit.value[id].priceMonthly = value;
  edit.value[id].priceYearly = Math.round(value * 10);
}
function syncFromYearly(id, raw) {
  if (String(raw).trim() === '') return;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || !edit.value[id]) return;
  edit.value[id].priceYearly = value;
  edit.value[id].priceMonthly = Math.round(value / 10);
}

async function savePlan(id) {
  error.value = ''; notice.value = '';
  try {
    const p = edit.value[id];
    const res = await api.adminSaveBillingPlan({
      id: p.id,
      title: p.title,
      description: p.description,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      opsPerPeriod: p.opsPerPeriod,
      dailyOps: p.dailyOps,
      checksPerPeriod: p.checksPerPeriod,
      exportsPerPeriod: p.exportsPerPeriod,
      apiCallsPerPeriod: p.apiCallsPerPeriod,
      batchMax: p.batchMax,
      historyDays: p.historyDays,
      archiveMb: p.archiveMb,
      formats: p.formats,
      features: p.features,
      sortOrder: p.sortOrder,
      recommended: p.recommended,
      active: p.active
    });
    notice.value = `Тариф ${res.plan.title} сохранён`;
    notifyPlansChanged();
    await loadPlans();
  } catch (e) { error.value = e.message; }
}
async function createPlan() {
  error.value = '';
  try {
    if (!newPlan.value.id || !newPlan.value.title) throw new Error('Укажите ID и название тарифа');
    await api.adminSaveBillingPlan({
      id: newPlan.value.id.trim().toLowerCase(),
      title: newPlan.value.title.trim(),
      priceMonthly: 0,
      priceYearly: 0,
      opsPerPeriod: 100,
      dailyOps: 0,
      checksPerPeriod: 0,
      exportsPerPeriod: 0,
      apiCallsPerPeriod: 0,
      batchMax: 100,
      historyDays: 7,
      archiveMb: 100,
      formats: ['png', 'svg'],
      features: { aiAssistant: true, employees: 1 },
      active: true
    });
    newPlan.value = { id: '', title: '' };
    notice.value = 'Тариф создан';
    notifyPlansChanged();
    await loadPlans();
  } catch (e) { error.value = e.message; }
}
async function toggleActive(p) {
  try {
    await api.adminSaveBillingPlan({ ...p, active: !p.active, features: p.features, priceMonthly: p.priceMonthly, priceYearly: p.priceYearly, opsPerPeriod: p.opsPerPeriod, dailyOps: p.dailyOps, checksPerPeriod: p.checksPerPeriod, exportsPerPeriod: p.exportsPerPeriod, apiCallsPerPeriod: p.apiCallsPerPeriod, batchMax: p.batchMax, historyDays: p.historyDays, archiveMb: p.archiveMb, formats: p.formats });
    notifyPlansChanged();
    await loadPlans();
  } catch (e) { error.value = e.message; }
}
async function assignPlan(user) {
  error.value = ''; notice.value = '';
  const planId = assign.value.planId;
  const days = Number(assign.value.days) || 30;
  try {
    await api.adminAssignPlan(user.id, { planId, days, kind: assign.value.kind });
    notice.value = `Тариф ${planId} назначен ${user.email}`;
    await loadSubs();
  } catch (e) { error.value = e.message; }
}
async function extend(user) {
  const days = Number(extendDays.value[user.id] ?? 30);
  try {
    await api.adminExtendSubscription(user.id, days);
    notice.value = `Подписка ${user.email} продлена на ${days} дн.`;
    await loadSubs();
  } catch (e) { error.value = e.message; }
}
async function grantTrial(user) {
  try {
    await api.adminGrantTrial(user.id);
    notice.value = `Пробный период выдан ${user.email}`;
    await loadSubs();
  } catch (e) { error.value = e.message; }
}
async function cancelSub(user) {
  try {
    await api.adminCancelSubscription(user.id, { immediate: false });
    notice.value = `Автопродление отключено у ${user.email}`;
    await loadSubs();
  } catch (e) { error.value = e.message; }
}
const fmt = (s) => s ? new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z').toLocaleString('ru', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const money = (n) => Number(n || 0).toLocaleString('ru');
onMounted(loadTab);
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="font-display font-bold text-2xl">Тарифы и подписки</h1>
        <p class="text-slate-500 text-sm">Цены, лимиты, доступы, ручные назначения и платежи. Все изменения пишутся в журнал аудита.</p>
      </div>
      <div class="inline-flex rounded-xl border border-slate-200 dark:border-white/15 p-1">
        <button v-for="t in [['plans','Тарифы'],['subs','Подписки'],['errors','Ошибки и статистика']]" :key="t[0]"
          class="px-3 py-1.5 rounded-lg text-sm" :class="tab === t[0] ? 'bg-brand-500 text-white' : 'text-slate-500'"
          @click="tab = t[0]; loadTab()">{{ t[1] }}</button>
      </div>
    </div>

    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <div v-if="loading" class="text-sm text-slate-500">Загружаем…</div>

    <!-- Тарифы -->
    <div v-if="tab === 'plans'" class="space-y-4">
      <div class="glass rounded-2xl p-4 flex flex-wrap items-end gap-3">
        <div><label class="text-xs text-slate-500">ID нового тарифа</label><input v-model="newPlan.id" class="input !py-2 text-sm" placeholder="vip"></div>
        <div><label class="text-xs text-slate-500">Название</label><input v-model="newPlan.title" class="input !py-2 text-sm" placeholder="VIP"></div>
        <button class="btn-primary" @click="createPlan">Создать тариф</button>
        <div class="text-xs text-slate-500 ml-auto">Архив на 3 года: {{ archive?.price }} ₽ · {{ archive?.days }} дней · {{ archive?.mb }} МБ</div>
      </div>
      <div class="grid xl:grid-cols-2 gap-4">
        <div v-for="plan in plans" :key="plan.id" class="glass rounded-2xl p-5">
          <div class="flex items-center justify-between gap-2">
            <div class="font-display font-bold">{{ edit[plan.id]?.title }} <span class="text-xs text-slate-500 font-normal">({{ plan.id }})</span></div>
            <div class="flex items-center gap-2 text-xs">
              <label class="flex items-center gap-1"><input v-model="edit[plan.id].recommended" type="checkbox"> рекомендуемый</label>
              <button class="btn-ghost !py-1 !px-2 text-xs" @click="toggleActive(edit[plan.id])">{{ edit[plan.id]?.active ? 'Отключить' : 'Включить' }}</button>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3 text-xs">
            <label>Название<input v-model="edit[plan.id].title" class="input !py-1.5 text-sm mt-1"></label>
            <label>Цена/мес<input :value="edit[plan.id].priceMonthly" @input="syncFromMonthly(plan.id, $event.target.value)" type="number" min="0" step="1" class="input !py-1.5 text-sm mt-1"></label>
            <label>Цена/год<input :value="edit[plan.id].priceYearly" @input="syncFromYearly(plan.id, $event.target.value)" type="number" min="0" step="1" class="input !py-1.5 text-sm mt-1"></label>
            <label>Операций/период<input v-model.number="edit[plan.id].opsPerPeriod" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Операций/день<input v-model.number="edit[plan.id].dailyOps" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Проверок/период<input v-model.number="edit[plan.id].checksPerPeriod" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Экспортов/период<input v-model.number="edit[plan.id].exportsPerPeriod" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>API-запросов/период<input v-model.number="edit[plan.id].apiCallsPerPeriod" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Пакет строк<input v-model.number="edit[plan.id].batchMax" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>История, дней<input v-model.number="edit[plan.id].historyDays" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Архив, МБ<input v-model.number="edit[plan.id].archiveMb" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Сортировка<input v-model.number="edit[plan.id].sortOrder" type="number" class="input !py-1.5 text-sm mt-1"></label>
            <label>Сотрудники<input v-model.number="edit[plan.id].features.employees" type="number" class="input !py-1.5 text-sm mt-1"></label>
          </div>
          <div class="text-[11px] text-slate-500 mt-1">Год = 10 месячных платежей · 2 месяца в подарок</div>
          <div class="flex flex-wrap gap-3 mt-3 text-xs">
            <label v-for="f in ['png','svg','pdf','zip']" :key="f" class="flex items-center gap-1">
              <input type="checkbox" :value="f" v-model="edit[plan.id].formats"> {{ f.toUpperCase() }}
            </label>
          </div>
          <div class="flex flex-wrap gap-3 mt-2 text-xs">
            <label v-for="f in [['labelEditor','Редактор этикеток'],['printBridge','Print Bridge'],['templates','Шаблоны'],['apiAccess','API'],['aiAssistant','AI-помощник']]" :key="f[0]" class="flex items-center gap-1">
              <input type="checkbox" v-model="edit[plan.id].features[f[0]]"> {{ f[1] }}
            </label>
          </div>
          <div class="flex items-center justify-between mt-3">
            <div class="text-xs text-slate-500">{{ edit[plan.id]?.description }}</div>
            <button class="btn-primary !py-1.5 text-sm" @click="savePlan(plan.id)">Сохранить</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Подписки -->
    <div v-if="tab === 'subs'" class="space-y-4">
      <div class="glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <input v-model="search" class="input !py-2 !w-64 text-sm" placeholder="Поиск по email или имени">
        <button class="btn-ghost !py-2 text-sm" @click="loadSubs">Найти</button>
        <div class="text-xs text-slate-500">Пользователей: {{ subs.length }}</div>
      </div>
      <div class="glass rounded-2xl p-4 overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
            <th class="py-2 pr-3">ID</th><th class="py-2 pr-3">Email</th><th class="py-2 pr-3">Тариф</th><th class="py-2 pr-3">Период</th><th class="py-2 pr-3">Использование</th><th class="py-2 pr-3">Действия</th>
          </tr></thead>
          <tbody>
            <tr v-for="u in subs" :key="u.id" class="border-b border-slate-100 dark:border-white/5 align-top">
              <td class="py-2 pr-3 text-slate-500">{{ u.id }}</td>
              <td class="py-2 pr-3">{{ u.email }}<div class="text-xs text-slate-500">{{ u.name }}</div></td>
              <td class="py-2 pr-3">
                <div class="font-medium">{{ u.planDef?.title || u.plan }}</div>
                <div v-if="u.sub_expires" class="text-xs text-slate-500">до {{ fmt(u.sub_expires) }}</div>
                <div v-else-if="u.trial_ends_at" class="text-xs text-amber-500">триал до {{ fmt(u.trial_ends_at) }}</div>
                <div v-else class="text-xs text-slate-500">без подписки</div>
              </td>
              <td class="py-2 pr-3 text-xs">{{ u.usage?.source }}<div class="text-slate-500">оп: {{ u.usage?.ops?.used }}/{{ u.usage?.ops?.limit }}</div><div class="text-slate-500">пр: {{ u.usage?.checks?.used }}/{{ u.usage?.checks?.limit }}</div></td>
              <td class="py-2 pr-3">
                <div class="flex flex-wrap gap-2 items-center">
                  <select v-model="assign.planId" class="input !py-1 text-xs">
                    <option v-for="id in planIds" :key="id" :value="id">{{ id }}</option>
                  </select>
                  <input v-model.number="assign.days" type="number" class="input !py-1 !w-20 text-xs" title="Дней">
                  <button class="btn-ghost !py-1 !px-2 text-xs" @click="assign.userId = u.id; assignPlan(u)">Назначить</button>
                  <button class="btn-ghost !py-1 !px-2 text-xs" @click="grantTrial(u)">Триал</button>
                </div>
                <div class="flex flex-wrap gap-2 items-center mt-2">
                  <input v-model.number="extendDays[u.id]" type="number" placeholder="+дней" class="input !py-1 !w-20 text-xs">
                  <button class="btn-ghost !py-1 !px-2 text-xs" @click="extend(u)">Продлить</button>
                  <button v-if="u.sub_id" class="btn-ghost !py-1 !px-2 text-xs" @click="cancelSub(u)">Отключить автопродление</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Ошибки и статистика -->
    <div v-if="tab === 'errors'" class="space-y-4">
      <div v-if="stats" class="grid md:grid-cols-3 gap-3">
        <div class="glass rounded-2xl p-4">
          <div class="text-xs text-slate-500">Пользователи по тарифам</div>
          <div class="mt-1 text-sm">
            <div v-for="row in stats.byPlan" :key="row.plan" class="flex justify-between"><span>{{ row.plan }}</span><b>{{ row.count }}</b></div>
          </div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-xs text-slate-500">Платежи за 30 дней</div>
          <div class="text-2xl font-extrabold mt-1">{{ money(stats.paid30d?.sum) }} ₽</div>
          <div class="text-xs text-slate-500">{{ stats.paid30d?.c }} успешных</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-xs text-slate-500">Активных триалов</div>
          <div class="text-2xl font-extrabold mt-1">{{ stats.activeTrials }}</div>
          <div class="text-xs text-slate-500">PRO 7 дней</div>
        </div>
      </div>
      <div class="glass rounded-2xl p-4">
        <h3 class="font-semibold mb-2">Стоимость внешних запросов (30 дней)</h3>
        <table class="w-full text-xs">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10"><th class="py-1 pr-3">День</th><th class="py-1 pr-3">Адаптер</th><th class="py-1 pr-3">Всего</th><th class="py-1 pr-3">Ошибки</th><th class="py-1 pr-3">Cost units</th><th class="py-1 pr-3">Ср. латентность</th></tr></thead>
          <tbody>
            <tr v-for="s in (errors?.stats || [])" :key="s.day + s.adapter" class="border-b border-slate-100 dark:border-white/5">
              <td class="py-1 pr-3">{{ s.day }}</td><td class="py-1 pr-3">{{ s.adapter }}</td><td class="py-1 pr-3">{{ s.total }}</td><td class="py-1 pr-3 text-red-500">{{ s.failed }}</td><td class="py-1 pr-3">{{ s.cost_units }}</td><td class="py-1 pr-3">{{ s.avg_latency_ms }} мс</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="glass rounded-2xl p-4">
        <h3 class="font-semibold mb-2">Ошибки внешних источников</h3>
        <div v-if="!errors?.failed?.length" class="text-sm text-slate-500">Ошибок нет</div>
        <div v-for="e in errors?.failed" :key="e.id" class="text-xs py-1 border-b border-slate-100 dark:border-white/5">
          {{ fmt(e.created_at) }} · {{ e.adapter }} · {{ e.status_code }} · {{ e.latency_ms }} мс · {{ e.error }}
        </div>
      </div>
    </div>
  </div>
</template>
