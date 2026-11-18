<script setup>
import { computed, onMounted, ref } from 'vue';
import { store } from '../store.js';
import { api } from '../api.js';
import SideNav from '../components/SideNav.vue';
const usagePct = computed(() => {
  if (!store.usage) return 0;
  return Math.min(100, Math.round(store.usage.codesToday / store.usage.codesPerDay * 100));
});
const bestOffer = ref(null);
const premiumFrom = computed(() => {
  const o = bestOffer.value;
  if (!o) return 1990;
  return Math.round(o.perMonth ?? o.finalPrice ?? o.price);
});
onMounted(async () => {
  try {
    const plans = (await api.plans()).plans;
    const premium = plans.find((p) => p.id === 'premium');
    const offers = premium?.offers || [];
    if (offers.length) {
      bestOffer.value = offers.reduce((a, b) => ((b.perMonth ?? b.finalPrice) < (a.perMonth ?? a.finalPrice) ? b : a));
    }
  } catch { /* цена останется базовой */ }
});
const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('ru') : '';
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app" />

    <section class="space-y-6">
      <div>
        <h1 class="font-display font-bold text-3xl mb-1">Обзор</h1>
        <p class="text-slate-500 text-sm">Аккаунт создан {{ fmtDate(store.user?.createdAt) }}</p>
      </div>

      <div class="grid md:grid-cols-2 gap-6">
        <div class="glass rounded-2xl p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-display font-semibold">Тариф</h2>
            <span class="font-display font-extrabold text-lg"
                  :class="store.plan?.id === 'premium' ? 'grad-text' : ''">{{ store.plan?.title }}</span>
          </div>
          <ul class="text-sm space-y-1.5 text-slate-600 dark:text-slate-300">
            <li>Кодов в день: <b>{{ store.plan?.codesPerDay.toLocaleString('ru') }}</b></li>
            <li>Пакет до: <b>{{ store.plan?.batchMax.toLocaleString('ru') }}</b> строк</li>
            <li>Форматы: <b>{{ store.plan?.formats.join(', ').toUpperCase() }}</b></li>
          </ul>
          <router-link v-if="store.plan?.id !== 'premium'" to="/app/billing" class="btn-primary w-full mt-5">
            Оформить PREMIUM — от {{ premiumFrom.toLocaleString('ru') }} ₽/мес
          </router-link>
          <router-link v-else to="/app/billing" class="btn-ghost w-full mt-5">Продлить подписку</router-link>
        </div>

        <div class="glass rounded-2xl p-6">
          <h2 class="font-display font-semibold mb-4">Использование сегодня</h2>
          <div class="text-4xl font-extrabold mb-1">
            {{ store.usage?.codesToday ?? 0 }}
            <span class="text-base font-medium text-slate-500">/ {{ store.usage?.codesPerDay?.toLocaleString('ru') }}</span>
          </div>
          <div class="h-3 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden mt-4">
            <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all" :style="{ width: usagePct + '%' }"></div>
          </div>
          <p class="text-xs text-slate-500 mt-3">Лимит обновляется каждый день в 00:00 UTC</p>
        </div>
      </div>

      <div class="glass rounded-2xl p-6">
        <h2 class="font-display font-semibold mb-4">Что дальше</h2>
        <div class="grid md:grid-cols-3 gap-4 text-sm">
          <router-link to="/app/generate" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1">▦ Генерация →</div>
            <p class="text-slate-500">Импорт CSV/XLSX, валидация GS1, пакетная генерация и экспорт.</p>
          </router-link>
          <router-link to="/app/labels" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1">🏷️ Этикетки →</div>
            <p class="text-slate-500">Редактор шаблонов и печать на термопринтеры через Print Bridge.</p>
          </router-link>
          <router-link to="/app/billing" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1">💳 PREMIUM →</div>
            <p class="text-slate-500">Оплата подписки, расширенные лимиты и API.</p>
          </router-link>
        </div>
      </div>
    </section>
  </div>
</template>
