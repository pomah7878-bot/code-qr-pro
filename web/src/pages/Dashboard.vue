<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
const usagePct = computed(() => {
  if (!store.usage) return 0;
  return Math.min(100, Math.round(store.usage.codesToday / store.usage.codesPerDay * 100));
});
const nav = [
  { icon: '📊', t: 'Обзор', active: true },
  { icon: '▦', t: 'Генерация', soon: 'этап 2' },
  { icon: '🏷️', t: 'Этикетки', soon: 'этап 3' },
  { icon: '🖨️', t: 'Печать', soon: 'этап 3' },
  { icon: '💳', t: 'Подписка', soon: 'этап 4' },
  { icon: '🔌', t: 'API', soon: 'этап 4' }
];
const fmtDate = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('ru') : '';
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <aside class="glass rounded-2xl p-4 h-fit">
      <div class="px-3 py-2 mb-2">
        <div class="font-semibold truncate">{{ store.user?.name || store.user?.email }}</div>
        <div class="text-xs text-slate-500 truncate">{{ store.user?.email }}</div>
      </div>
      <nav class="space-y-1">
        <div v-for="n in nav" :key="n.t"
             class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm"
             :class="n.active ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 font-semibold border border-brand-500/30' : 'text-slate-500'">
          <span>{{ n.icon }}</span><span>{{ n.t }}</span>
          <span v-if="n.soon" class="chip-soon ml-auto">{{ n.soon }}</span>
        </div>
      </nav>
    </aside>

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
          <button v-if="store.plan?.id !== 'premium'" class="btn-primary w-full mt-5 opacity-60 cursor-not-allowed" disabled>
            PREMIUM — подключение на этапе 4
          </button>
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
          <div class="rounded-xl border border-slate-200 dark:border-white/10 p-4">
            <div class="font-semibold mb-1">▦ Генерация <span class="chip-soon">этап 2</span></div>
            <p class="text-slate-500">Импорт CSV/XLSX, валидация GS1, пакетная генерация и экспорт.</p>
          </div>
          <div class="rounded-xl border border-slate-200 dark:border-white/10 p-4">
            <div class="font-semibold mb-1">🏷️ Этикетки <span class="chip-soon">этап 3</span></div>
            <p class="text-slate-500">Редактор шаблонов и печать на термопринтеры через Print Bridge.</p>
          </div>
          <div class="rounded-xl border border-slate-200 dark:border-white/10 p-4">
            <div class="font-semibold mb-1">💳 PREMIUM <span class="chip-soon">этап 4</span></div>
            <p class="text-slate-500">Оплата подписки, расширенные лимиты и API.</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
