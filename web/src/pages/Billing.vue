<script setup>
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';
import PageGuide from '../components/PageGuide.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { LEGAL } from '../content/legal.js';

const route = useRoute();
const info = ref(null);
const orders = ref([]);
const archiveInfo = ref(null);
const archiveBusy = ref(false);
const providerOk = ref(true);
const busy = ref(false);
const trialBusy = ref(false);
const error = ref('');
const notice = ref('');
const period = ref('month');
const selectedPlanId = ref('pro');
const promoCode = ref('');
const promo = ref(null);
const promoBusy = ref(false);
const autoRenewBusy = ref(false);

const plans = computed(() => (info.value?.plans || []).filter((p) => p.id !== 'free'));
const freePlan = computed(() => (info.value?.plans || []).find((p) => p.id === 'free'));
const currentPlan = computed(() => info.value?.plan || null);
const usage = computed(() => info.value?.usage || null);
const trial = computed(() => info.value?.trial || null);
const subscription = computed(() => info.value?.subscription || null);
const selectedPlan = computed(() => (info.value?.plans || []).find((p) => p.id === selectedPlanId.value) || plans.value[0] || null);
const periodDays = computed(() => (period.value === 'year' ? 365 : 30));
function planPrice(plan, p = period.value) {
  if (!plan) return 0;
  if (p === 'year') return Number(plan.priceYearly) || Math.round(Number(plan.priceMonthly || 0) * 12);
  return Number(plan.priceMonthly) || 0;
}
const priceNow = computed(() => {
  const plan = selectedPlan.value;
  if (!plan) return 0;
  const base = planPrice(plan);
  if (promo.value && promo.value.planId === plan.id && Number(promo.value.days) === periodDays.value) return promo.value.finalAmount;
  return base;
});
const pricePerMonth = (plan) => {
  const per = period.value === 'year' ? 12 : 1;
  return Math.round(planPrice(plan) / per);
};
const isCurrentPlan = (id) => currentPlan.value?.id === id && usage.value?.source !== 'free';

const featuresOf = (plan) => {
  const f = [];
  f.push(`${Number(plan.opsPerPeriod || 0).toLocaleString('ru')} операций ${plan.dailyOps ? `(до ${plan.dailyOps}/день)` : 'в месяц'}`);
  if (plan.checksPerPeriod > 0) f.push(`${Number(plan.checksPerPeriod).toLocaleString('ru')} расширенных проверок`);
  else f.push('Без расширенных проверок');
  f.push((plan.formats || []).map((x) => x.toUpperCase()).join(', ') + ' на выгрузке');
  if (plan.features?.labelEditor) f.push('Редактор этикеток и печать с термопринтера');
  if (plan.features?.templates) f.push('Сохранение шаблонов');
  if (plan.features?.apiAccess) f.push('API для 1С и складов');
  if (plan.features?.aiAssistant) f.push(plan.id === 'free' || plan.id === 'start' ? 'AI-помощник (базовый)' : 'AI-помощник без ограничений');
  if (plan.features?.employees > 1) f.push(`До ${plan.features.employees} сотрудников`);
  f.push(`История ${plan.historyDays} дней`);
  return f;
};

const fmt = (s) => s ? new Date(String(s).includes('T') ? s : String(s).replace(' ', 'T') + 'Z').toLocaleString('ru', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const statusRu = { pending: 'ожидает оплаты', paid: 'оплачен', canceled: 'отменён' };
const planTitleOf = (o) => o.plan_title || ({ start: 'START', pro: 'PRO', business: 'BUSINESS', archive: 'Архив', premium: 'PRO' }[o.plan] || o.plan);

async function load() {
  const data = await api.subscription();
  info.value = data;
  providerOk.value = data.providerConfigured;
  if (data.plan?.id && data.plan.id !== 'free') selectedPlanId.value = data.plan.id;
  orders.value = (await api.orders()).orders;
  archiveInfo.value = await api.billingArchive();
}
async function applyPromo() {
  error.value = ''; promo.value = null;
  const code = promoCode.value.trim();
  if (!code || !selectedPlan.value) return;
  promoBusy.value = true;
  try {
    promo.value = await api.checkPromo({ code, planId: selectedPlan.value.id, period: period.value });
  } catch (e) { error.value = e.message; }
  promoBusy.value = false;
}
async function checkout() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    const idemKey = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
    const d = await api.checkoutPlan({
      planId: selectedPlan.value.id,
      period: period.value,
      promoCode: promo.value?.code,
      idemKey
    });
    if (d.order?.confirmationUrl) window.location.href = d.order.confirmationUrl;
    else error.value = 'Не получена ссылка на оплату';
  } catch (e) { error.value = e.message; }
  busy.value = false;
}
async function startTrial() {
  error.value = ''; notice.value = ''; trialBusy.value = true;
  try {
    await api.startTrial();
    notice.value = 'Пробный период PRO активирован!';
    store.load();
    await load();
  } catch (e) { error.value = e.message; }
  trialBusy.value = false;
}
async function toggleAutoRenew() {
  autoRenewBusy.value = true; error.value = '';
  try {
    await api.setAutoRenew(!subscription.value?.autoRenew);
    await load();
  } catch (e) { error.value = e.message; }
  autoRenewBusy.value = false;
}
async function check(orderId) {
  error.value = ''; notice.value = '';
  try {
    const d = await api.checkOrder({ orderId });
    if (d.order?.status === 'paid') {
      notice.value = 'Оплата подтверждена — тариф активирован!';
      store.load();
    } else if (d.order?.status === 'canceled') notice.value = 'Заказ отменён';
    else notice.value = 'Платёж ещё не завершён — если оплатили, подождите до минуты';
    await load();
  } catch (e) { error.value = e.message; }
}
async function checkoutArchive() {
  error.value = ''; archiveBusy.value = true;
  try {
    const d = await api.checkoutPlan({ planId: 'archive', idemKey: String(Date.now()) + Math.random() });
    if (d.order?.confirmationUrl) window.location.href = d.order.confirmationUrl;
    else error.value = 'Не получена ссылка на оплату';
  } catch (e) { error.value = e.message; } finally { archiveBusy.value = false; }
}
onMounted(async () => {
  try { await load(); } catch (e) { error.value = e.message; }
  if (route.query.order) await check(Number(route.query.order));
});
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-8 grid lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
    <SideNav active="/app/billing" />
    <section class="space-y-6 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-3xl">Моя подписка</h1>
          <p class="text-slate-500 mt-1">Тариф, лимиты операций и расширенных проверок, история платежей.</p>
        </div>
        <router-link to="/pricing" class="btn-ghost !py-2 text-sm">Сравнить тарифы</router-link>
      </div>

      <PageGuide
        id="subscription"
        title="Подписка за 3 шага"
        :steps="[
          'Попробуйте PRO бесплатно 7 дней или выберите тариф и период.',
          'Оплатите через ЮKassa — тариф активируется серверным подтверждением платежа.',
          'Следите за остатком операций и расширенных проверок на этой странице.'
        ]"
        note="Автопродления по умолчанию нет. Пробный период — один раз на аккаунт."
      />

      <div v-if="trial?.active" class="glass rounded-2xl p-5 border border-brand-500/40">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div class="text-xs uppercase tracking-wide text-brand-400 font-semibold">Пробный период PRO</div>
            <div class="font-display font-bold text-xl mt-1">Осталось {{ trial.daysLeft }} дн. до {{ fmt(trial.endsAt) }}</div>
            <div class="text-sm text-slate-500 mt-1">Доступны все возможности PRO. Расширенных проверок на триал: {{ usage?.checks?.limit }}. Автосписания не будет.</div>
          </div>
          <button class="btn-primary" :disabled="busy" @click="checkout">Оформить PRO</button>
        </div>
      </div>

      <div class="glass rounded-2xl p-6">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div class="text-sm text-slate-500 mb-1">Текущий тариф</div>
            <div class="font-display font-extrabold text-2xl grad-text">{{ currentPlan?.title || 'FREE' }}</div>
            <div class="text-sm text-slate-500 mt-1">
              <template v-if="usage?.source === 'trial'">Пробный период до {{ fmt(usage.periodEnd) }}</template>
              <template v-else-if="subscription">Оплачен до {{ fmt(subscription.expiresAt) }}</template>
              <template v-else>Бесплатный тариф, лимит обновится {{ usage?.periodEnd ? fmt(usage.periodEnd) : 'в начале месяца' }}</template>
            </div>
            <div v-if="subscription" class="text-xs text-slate-500 mt-1">Тариф {{ subscription.plan || currentPlan?.id }}{{ subscription.autoRenew ? ' · автопродление включено' : '' }}</div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-if="trial?.used !== true && usage?.source === 'free'" class="btn-ghost" :disabled="trialBusy" @click="startTrial">
              {{ trialBusy ? 'Активируем…' : 'Попробовать PRO 7 дней бесплатно' }}
            </button>
            <button v-if="subscription" class="btn-ghost !py-2 text-xs" :disabled="autoRenewBusy" @click="toggleAutoRenew">
              {{ subscription.autoRenew ? 'Отключить автопродление' : 'Включить автопродление' }}
            </button>
            <router-link v-if="!subscription && !trial?.active" :to="{ path: '/app/billing', query: { } }" class="hidden" />
          </div>
        </div>

        <div v-if="usage" class="grid md:grid-cols-2 gap-4 mt-6">
          <div>
            <div class="flex items-center justify-between text-sm mb-1">
              <span class="font-medium">Операции</span>
              <span class="text-slate-500">{{ usage.ops.used.toLocaleString('ru') }} / {{ usage.ops.limit.toLocaleString('ru') }}</span>
            </div>
            <div class="h-2.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div class="h-full rounded-full transition-all"
                :class="usage.warnings.ops100 ? 'bg-red-500' : usage.warnings.ops80 ? 'bg-amber-500' : 'bg-brand-500'"
                :style="{ width: Math.min(100, usage.ops.percent) + '%' }"></div>
            </div>
            <div class="text-xs text-slate-500 mt-1">
              Осталось {{ usage.ops.left === null ? '—' : usage.ops.left.toLocaleString('ru') }}
              <template v-if="usage.daily.limit">· сегодня {{ usage.daily.used }} / {{ usage.daily.limit }}</template>
            </div>
            <div v-if="usage.warnings.ops80 && !usage.warnings.ops100" class="text-xs text-amber-500 mt-1">Использовано 80% лимита операций.</div>
            <div v-if="usage.warnings.ops100" class="text-xs text-red-500 mt-1">Лимит операций исчерпан — генерация и печать остановлены до нового периода.</div>
          </div>
          <div>
            <div class="flex items-center justify-between text-sm mb-1">
              <span class="font-medium">Расширенные проверки</span>
              <span class="text-slate-500">{{ usage.checks.used.toLocaleString('ru') }} / {{ usage.checks.limit.toLocaleString('ru') }}</span>
            </div>
            <div class="h-2.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
              <div class="h-full rounded-full transition-all"
                :class="usage.warnings.checks100 ? 'bg-red-500' : usage.warnings.checks80 ? 'bg-amber-500' : 'bg-emerald-500'"
                :style="{ width: Math.min(100, usage.checks.percent) + '%' }"></div>
            </div>
            <div class="text-xs text-slate-500 mt-1">
              Осталось {{ usage.checks.limit ? usage.checks.left.toLocaleString('ru') : '0' }}
              <template v-if="usage.checks.limit === 0">· доступны на PRO и BUSINESS</template>
            </div>
            <div v-if="usage.warnings.checks80 && !usage.warnings.checks100" class="text-xs text-amber-500 mt-1">Использовано 80% расширенных проверок.</div>
            <div v-if="usage.warnings.checks100 && usage.checks.limit > 0" class="text-xs text-red-500 mt-1">Лимит проверок исчерпан — карточки доступны из кэша и по локальному разбору.</div>
          </div>
        </div>
        <div v-else class="text-sm text-slate-500 mt-4">Загружаем лимиты…</div>
      </div>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="font-display font-bold text-xl">Тарифы</h2>
        <div class="inline-flex rounded-xl border border-slate-200 dark:border-white/15 p-1">
          <button class="px-4 py-1.5 rounded-lg text-sm" :class="period === 'month' ? 'bg-brand-500 text-white' : 'text-slate-500'" @click="period = 'month'">Месяц</button>
          <button class="px-4 py-1.5 rounded-lg text-sm" :class="period === 'year' ? 'bg-brand-500 text-white' : 'text-slate-500'" @click="period = 'year'">Год <span class="text-xs opacity-80">−2 месяца</span></button>
        </div>
      </div>

      <div class="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div v-for="plan in plans" :key="plan.id"
          class="glass rounded-2xl p-5 relative cursor-pointer transition border-2"
          :class="selectedPlanId === plan.id ? 'border-brand-500 ring-2 ring-brand-500/30' : 'border-transparent hover:border-brand-500/40'"
          @click="selectedPlanId = plan.id; promo = null">
          <div v-if="plan.recommended" class="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold bg-brand-500 text-white rounded-full px-3 py-0.5">РЕКОМЕНДУЕМ</div>
          <div class="font-display font-bold text-lg">{{ plan.title }}</div>
          <div class="text-xs text-slate-500 min-h-[32px]">{{ plan.description }}</div>
          <div class="mt-3 text-2xl font-extrabold">{{ planPrice(plan).toLocaleString('ru') }} ₽<span class="text-xs text-slate-500 font-medium">/{{ period === 'year' ? 'год' : 'мес' }}</span></div>
          <div v-if="period === 'year'" class="text-xs text-emerald-500">{{ pricePerMonth(plan).toLocaleString('ru') }} ₽/мес</div>
          <ul class="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
            <li v-for="f in featuresOf(plan)" :key="f" class="flex items-start gap-1.5"><BrandIcon name="check" :size="13" class="mt-0.5 shrink-0" />{{ f }}</li>
          </ul>
          <button class="mt-4 w-full text-sm" :class="isCurrentPlan(plan.id) ? 'btn-ghost' : 'btn-primary'"
            :disabled="busy || !providerOk || plan.id === currentPlan?.id"
            @click.stop="selectedPlanId = plan.id; checkout()">
            {{ isCurrentPlan(plan.id) ? 'Продлить' : plan.id === currentPlan?.id ? 'Текущий тариф' : 'Оформить' }}
          </button>
        </div>
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="flex flex-wrap items-center gap-3">
          <div class="text-sm min-w-[220px]">
            <div class="font-semibold">Оформляем: {{ selectedPlan?.title }} · {{ period === 'year' ? 'год' : 'месяц' }}</div>
            <div class="text-slate-500">{{ priceNow.toLocaleString('ru') }} ₽<template v-if="promo?.discount"> · промокод −{{ promo.discount.toLocaleString('ru') }} ₽</template></div>
          </div>
          <input v-model="promoCode" class="input !py-2 !w-52 text-sm" placeholder="Промокод" aria-label="Промокод" autocomplete="off">
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="promoBusy" @click="applyPromo">{{ promoBusy ? 'Проверяем…' : 'Применить' }}</button>
          <button class="btn-primary ml-auto" :disabled="busy || !providerOk || !selectedPlan" @click="checkout">{{ busy ? 'Создаём заказ…' : 'Перейти к оплате' }}</button>
        </div>
        <p class="text-xs text-slate-500 mt-3">Оплата через ЮKassa (карта, СБП). Чек на email. Подписка активируется только после серверного подтверждения платежа; возврат на страницу сам по себе тариф не включает. Автопродление по умолчанию выключено.</p>
        <p class="text-[11px] text-slate-500 mt-2">
          Исполнитель: {{ LEGAL.operator.label }}, {{ LEGAL.operator.status.toLowerCase() }}, ИНН {{ LEGAL.operator.inn }}.
          <router-link to="/offer" class="text-brand-400 hover:underline">Публичная оферта</router-link> ·
          <router-link to="/privacy" class="text-brand-400 hover:underline">Обработка персональных данных</router-link>
        </p>
        <p v-if="!providerOk" class="text-xs text-red-500 mt-2">Платёжный провайдер не настроен — сообщите администратору.</p>
      </div>

      <div v-if="archiveInfo" class="glass rounded-2xl p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="text-sm text-slate-500 mb-1">Дополнительно</div>
            <h2 class="font-display font-bold text-xl">Архив на 3 года</h2>
            <p class="text-sm text-slate-500 mt-1">История работ {{ archiveInfo.addon.days }} дней и архив до {{ (archiveInfo.addon.mb / 1024).toFixed(0) }} ГБ. Работает вместе с любым тарифом.</p>
            <p v-if="archiveInfo.activeUntil" class="text-sm text-emerald-500 mt-1">Архив активен до {{ fmt(archiveInfo.activeUntil) }}</p>
          </div>
          <div class="text-right">
            <div class="text-2xl font-extrabold">{{ archiveInfo.addon.price.toLocaleString('ru') }} ₽</div>
            <button class="btn-ghost mt-2" :disabled="archiveBusy || !archiveInfo.providerConfigured" @click="checkoutArchive">
              {{ archiveBusy ? 'Создаём заказ…' : (archiveInfo.activeUntil ? 'Продлить архив' : 'Подключить архив') }}
            </button>
          </div>
        </div>
      </div>

      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

      <div v-if="orders.length" class="glass rounded-2xl p-6 overflow-x-auto">
        <h2 class="font-display font-semibold mb-4">История платежей</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
            <th class="py-2 pr-3">№</th><th class="py-2 pr-3">Дата</th><th class="py-2 pr-3">Тариф</th><th class="py-2 pr-3">Сумма</th><th class="py-2 pr-3">Статус</th><th class="py-2"></th>
          </tr></thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id" class="border-b border-slate-100 dark:border-white/5">
              <td class="py-2 pr-3 text-slate-500">{{ o.id }}</td>
              <td class="py-2 pr-3">{{ fmt(o.created_at) }}</td>
              <td class="py-2 pr-3">{{ planTitleOf(o) }}<span class="text-slate-500"> · {{ o.days }} дн.</span></td>
              <td class="py-2 pr-3">{{ Number(o.amount).toLocaleString('ru') }} ₽</td>
              <td class="py-2 pr-3" :class="o.status === 'paid' ? 'text-emerald-500' : o.status === 'canceled' ? 'text-red-500' : 'text-amber-500'">{{ statusRu[o.status] || o.status }}</td>
              <td class="py-2"><button v-if="o.status === 'pending'" class="btn-ghost !py-1 !px-3 text-xs" @click="check(o.id)">Проверить оплату</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
