<script setup>
import { ref, onMounted, computed } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import BrandIcon from '../components/BrandIcon.vue';

const plans = ref([]);
const period = ref('month');
const loading = ref(true);

const price = (plan) => period.value === 'year'
  ? Number(plan.priceYearly) || Math.round(Number(plan.priceMonthly || 0) * 12)
  : Number(plan.priceMonthly) || 0;
const perMonth = (plan) => Math.round(price(plan) / (period.value === 'year' ? 12 : 1));
const features = (plan) => [
  `${Number(plan.opsPerPeriod || 0).toLocaleString('ru')} операций ${plan.dailyOps ? `(до ${plan.dailyOps}/сутки)` : 'в месяц'}`,
  plan.checksPerPeriod > 0 ? `${Number(plan.checksPerPeriod).toLocaleString('ru')} расширенных проверок` : 'Локальная проверка кодов',
  `Форматы выгрузки: ${(plan.formats || []).map((f) => f.toUpperCase()).join(', ')}`,
  plan.features?.labelEditor ? 'Редактор этикеток и Print Bridge' : 'Готовые шаблоны без редактора',
  plan.features?.templates ? 'Сохранение шаблонов' : 'Без сохранения шаблонов',
  plan.features?.apiAccess ? 'API для 1С и складов' : 'API недоступен',
  plan.features?.aiAssistant ? (plan.id === 'free' || plan.id === 'start' ? 'AI-помощник (базовый)' : 'AI-помощник без ограничений') : 'Без AI-помощника',
  `${plan.features?.employees || 1} сотрудник(ов)`,
  `История ${plan.historyDays} дней`
];
const cta = (plan) => {
  if (!store.user) return { to: '/register', label: plan.id === 'free' ? 'Начать бесплатно' : `Выбрать ${plan.title}` };
  return { to: '/app/billing', label: plan.id === 'free' ? 'Перейти в кабинет' : `Оформить ${plan.title}` };
};
onMounted(async () => {
  try {
    const d = await api.billingPlans();
    plans.value = (d.plans || []).filter((p) => p.id !== 'archive');
  } finally { loading.value = false; }
});
</script>

<template>
  <div class="max-w-[1200px] mx-auto px-4 py-12">
    <div class="text-center max-w-2xl mx-auto">
      <h1 class="font-display font-extrabold text-4xl">Тарифы CODE QR PRO</h1>
      <p class="text-slate-500 mt-3">Маркировка «Честный ЗНАК», GS1 DataMatrix, печать этикеток и проверка кодов. Пробный период PRO — 7 дней бесплатно, без автосписания.</p>
      <div class="inline-flex rounded-xl border border-slate-200 dark:border-white/15 p-1 mt-6">
        <button class="px-5 py-2 rounded-lg text-sm" :class="period === 'month' ? 'bg-brand-500 text-white' : 'text-slate-500'" @click="period = 'month'">Месяц</button>
        <button class="px-5 py-2 rounded-lg text-sm" :class="period === 'year' ? 'bg-brand-500 text-white' : 'text-slate-500'" @click="period = 'year'">Год <span class="text-xs opacity-80">выгоднее</span></button>
      </div>
    </div>

    <div v-if="loading" class="text-center text-slate-500 py-16">Загружаем тарифы…</div>
    <div v-else class="grid md:grid-cols-2 xl:grid-cols-4 gap-5 mt-10">
      <div v-for="plan in plans" :key="plan.id" class="glass rounded-2xl p-6 relative flex flex-col"
        :class="plan.recommended ? 'ring-2 ring-brand-500 border border-brand-500/50' : ''">
        <div v-if="plan.recommended" class="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-bold bg-brand-500 text-white rounded-full px-3 py-0.5">РЕКОМЕНДУЕМ</div>
        <div class="font-display font-bold text-xl">{{ plan.title }}</div>
        <div class="text-sm text-slate-500 min-h-[40px] mt-1">{{ plan.description }}</div>
        <div class="mt-4 text-3xl font-extrabold">{{ price(plan).toLocaleString('ru') }} ₽<span class="text-sm text-slate-500 font-medium">/{{ period === 'year' ? 'год' : 'мес' }}</span></div>
        <div class="text-xs text-slate-500 mt-1">{{ period === 'year' ? `${perMonth(plan).toLocaleString('ru')} ₽/мес · экономия ${(plan.priceMonthly * 12 - price(plan)).toLocaleString('ru')} ₽` : 'Оплата раз в месяц' }}</div>
        <ul class="mt-5 space-y-2 text-sm text-slate-600 dark:text-slate-300 flex-1">
          <li v-for="f in features(plan)" :key="f" class="flex items-start gap-2"><BrandIcon name="check" :size="14" class="mt-0.5 shrink-0" />{{ f }}</li>
        </ul>
        <router-link class="mt-6 btn-primary text-center" :to="cta(plan).to">{{ cta(plan).label }}</router-link>
      </div>
    </div>

    <div class="glass rounded-2xl p-6 mt-8 text-sm text-slate-500">
      <p><b>Пробный период PRO</b> — 7 календарных дней, один раз на аккаунт, 50 расширенных проверок. После окончания автоматически FREE, деньги не списываются.</p>
      <p class="mt-2">Оплата через ЮKassa (карта, СБП), чек на email. Подписка активируется только после подтверждения платежа на сервере. Автопродление по умолчанию выключено.</p>
      <p class="mt-2">Операции и расширенные проверки учитываются раздельно. Неуспешные запросы к внешним источникам лимит не списывают.</p>
    </div>
  </div>
</template>
