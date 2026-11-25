<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { store } from '../store.js';
import { api } from '../api.js';
import { onPlansChanged } from '../lib/plans-sync.js';
import SideNav from '../components/SideNav.vue';
import PageGuide from '../components/PageGuide.vue';
import AdSlot from '../components/AdSlot.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { openAssistant } from '../lib/assistant-ui.js';
const usagePct = computed(() => {
  const u = store.usage;
  if (!u) return 0;
  if (u.ops?.limit) return Math.min(100, Math.round((u.ops.used / u.ops.limit) * 100));
  if (u.daily?.limit) return Math.min(100, Math.round((u.daily.used / u.daily.limit) * 100));
  return 0;
});
const isPremium = computed(() => store.plan?.id && store.plan.id !== 'free');
const bestOffer = ref(null);
const premiumFrom = computed(() => {
  const o = bestOffer.value;
  if (!o) return 590;
  return Math.round(o.perMonth ?? o.finalPrice ?? o.price);
});
let plansSyncOff = null;
async function loadOffers() {
  try {
    const plans = (await api.plans()).plans;
    const premium = plans.find((p) => p.id === 'pro' || p.id === 'premium');
    const offers = premium?.offers || [];
    if (offers.length) {
      bestOffer.value = offers.reduce((a, b) => ((b.perMonth ?? b.finalPrice) < (a.perMonth ?? a.finalPrice) ? b : a));
    }
  } catch { /* цена останется базовой */ }
}
onMounted(async () => {
  await loadOffers();
  plansSyncOff = onPlansChanged(loadOffers);
});
onUnmounted(() => { plansSyncOff?.(); });
const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('ru') : '';
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app" />

    <section class="space-y-6">
      <div>
        <h1 class="font-display font-bold text-3xl mb-1">Обзор</h1>
        <p class="text-slate-500 text-sm">Аккаунт создан {{ fmtDate(store.user?.createdAt) }}</p>
      </div>

      <div class="glass rounded-2xl p-5 relative overflow-hidden border border-violet-500/25">
        <div class="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-violet-600/20 blur-2xl"></div>
        <div class="relative flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <span class="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-accent-500 text-white shadow-lg shadow-violet-600/30">
              <BrandIcon name="ai" :size="22" solid="#ffffff" />
            </span>
            <div>
              <div class="flex items-center gap-2">
                <div class="font-display font-semibold">Новое в PRO</div>
                <span class="text-[9px] font-bold uppercase tracking-wider text-violet-600 dark:text-violet-300 bg-violet-500/10 border border-violet-500/25 rounded-full px-2 py-0.5">AI</span>
              </div>
              <div class="text-xs text-slate-500 mt-0.5">
                AI-помощник по «Честному ЗНАКу», база знаний и поддержка с историей обращений.
              </div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <router-link v-if="!isPremium" to="/app/billing" class="btn-primary !py-2 !px-4 text-sm">Оформить PRO</router-link>
            <router-link v-else to="/app/help" class="btn-ghost !py-2 !px-3 text-sm">Что нового</router-link>
            <button class="btn-ghost !py-2 !px-3 text-sm" @click="openAssistant()">Спросить AI</button>
          </div>
        </div>
      </div>

      <PageGuide
        id="dashboard"
        title="С чего начать"
        :steps="[
          'Откройте «Генерацию» и загрузите CSV, XLSX или PDF с кодами — либо вставьте коды текстом.',
          'Проверьте пакет: сервис покажет, сколько кодов валидны, а где ошибка.',
          'Скачайте PDF или ZIP. Для готовых этикеток используйте разделы «Этикетки» и «Повторная печать».'
        ]"
        note="Подсказки и инструкции теперь в разделе «Помощь» в меню кабинета."
      />

      <AdSlot placement="app_banner" />

      <div class="grid md:grid-cols-2 gap-6">
        <div class="glass rounded-2xl p-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="font-display font-semibold">Тариф</h2>
            <span class="font-display font-extrabold text-lg"
                  :class="isPremium ? 'grad-text' : ''">{{ store.plan?.title }}</span>
          </div>
          <ul class="text-sm space-y-1.5 text-slate-600 dark:text-slate-300">
            <li>Операций в месяц: <b>{{ (store.plan?.opsPerPeriod || 0).toLocaleString('ru') }}</b></li>
            <li v-if="store.plan?.dailyOps">В сутки: <b>{{ store.plan.dailyOps }}</b> · сегодня {{ store.usage?.daily?.used ?? 0 }}</li>
            <li v-if="store.plan?.checksPerPeriod">Расширенных проверок: <b>{{ store.plan.checksPerPeriod.toLocaleString('ru') }}</b></li>
            <li>Пакет до: <b>{{ store.plan?.batchMax.toLocaleString('ru') }}</b> строк</li>
            <li>Форматы: <b>{{ store.plan?.formats.join(', ').toUpperCase() }}</b></li>
          </ul>
          <router-link v-if="!isPremium" to="/app/billing" class="btn-primary w-full mt-5">
            Оформить PRO — от {{ premiumFrom.toLocaleString('ru') }} ₽/мес
          </router-link>
          <router-link v-else to="/app/billing" class="btn-ghost w-full mt-5">Моя подписка</router-link>
        </div>

        <div class="glass rounded-2xl p-6">
          <h2 class="font-display font-semibold mb-4">Использование за период</h2>
          <div class="text-4xl font-extrabold mb-1">
            {{ (store.usage?.ops?.used ?? 0).toLocaleString('ru') }}
            <span class="text-base font-medium text-slate-500">/ {{ (store.usage?.ops?.limit ?? 0).toLocaleString('ru') }} операций</span>
          </div>
          <div class="h-3 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden mt-4">
            <div class="h-full rounded-full transition-all" :class="usagePct >= 80 ? 'bg-amber-500' : 'bg-gradient-to-r from-brand-500 to-accent-500'" :style="{ width: usagePct + '%' }"></div>
          </div>
          <p class="text-xs text-slate-500 mt-3">Расширенные проверки: {{ store.usage?.checks?.used ?? 0 }} / {{ store.usage?.checks?.limit ?? 0 }} · экспорт: {{ store.usage?.exports?.used ?? 0 }} / {{ store.usage?.exports?.limit ?? 0 }} · до {{ store.usage?.periodEnd ? fmtDate(store.usage.periodEnd) : 'конца периода' }}</p>
          <router-link v-if="store.usage?.warnings?.ops80 || store.usage?.warnings?.checks80 || store.usage?.warnings?.exports80 || store.usage?.warnings?.api80" to="/app/billing" class="text-xs text-amber-500 font-medium mt-2 inline-block">Лимит близок к концу — посмотреть тарифы →</router-link>
        </div>
      </div>

      <div class="glass rounded-2xl p-6">
        <h2 class="font-display font-semibold mb-4">Что дальше</h2>
        <div class="grid md:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
          <router-link to="/app/history" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1"><BrandIcon name="history" :size="16" class="inline-block mr-1.5 -mt-0.5" />История →</div>
            <p class="text-slate-500">Пакеты, архивы, проверки и печать — с автоматическим сроком хранения.</p>
          </router-link>
          <router-link to="/app/generate" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1"><BrandIcon name="generate" :size="16" class="inline-block mr-1.5 -mt-0.5" />Генерация →</div>
            <p class="text-slate-500">Импорт CSV/XLSX, валидация GS1, пакетная генерация и экспорт.</p>
          </router-link>
          <router-link to="/app/labels" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1"><BrandIcon name="label" :size="16" class="inline-block mr-1.5 -mt-0.5" />Этикетки →</div>
            <p class="text-slate-500">Редактор шаблонов и печать на термопринтеры через Print Bridge.</p>
          </router-link>
          <router-link to="/app/marketplaces" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1"><BrandIcon name="set" :size="16" class="inline-block mr-1.5 -mt-0.5" />Маркетплейсы →</div>
            <p class="text-slate-500">Этикетки WB, Ozon и Яндекс Маркета: товарные и транспортные, PDF точного размера.</p>
          </router-link>
          <router-link to="/app/billing" class="rounded-xl border border-brand-500/40 bg-brand-500/5 p-4 hover:bg-brand-500/10 transition block">
            <div class="font-semibold mb-1"><BrandIcon name="billing" :size="16" class="inline-block mr-1.5 -mt-0.5" />Подписка →</div>
            <p class="text-slate-500">Оплата подписки, расширенные лимиты и API.</p>
          </router-link>
        </div>
      </div>

      <AdSlot placement="app_bottom" />
    </section>
  </div>
</template>
