<script setup>
import { onMounted } from 'vue';
import PublicShell from '../components/PublicShell.vue';
import BrandIcon from '../components/BrandIcon.vue';
import { applySeo } from '../lib/seo.js';

const stages = [
  { title: '1С:Управление торговлей 11.5', text: 'Первый целевой коннектор: заказ кодов, печать, отчёт о нанесении, ввод в оборот.', badge: 'в разработке' },
  { title: '1С:УНФ 3.0', text: 'Для небольшого бизнеса и одного-двух складов.', badge: 'план' },
  { title: '1С:Розница 3.0', text: 'Розничные магазины и кассы.', badge: 'план' },
  { title: '1С:ERP 2.5', text: 'Крупные компании и несколько юрлиц.', badge: 'план' }
];
onMounted(() => applySeo('/integrations/1c'));
</script>

<template>
  <PublicShell>
    <div class="max-w-3xl mx-auto">
      <div class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-500 border border-amber-500/30 bg-amber-500/10 rounded-full px-4 py-1.5 mb-5">
        Скоро · 1С-коннектор
      </div>
      <h1 class="font-display font-extrabold text-3xl sm:text-5xl leading-tight">Коннектор для 1С</h1>
      <p class="text-slate-500 mt-3 text-sm sm:text-base">Готовим прямое подключение 1С к CODE QR PRO: коды, печать, статусы и отчёт о нанесении без ручных CSV. Пока доступны API и файловый обмен.</p>

      <div class="grid sm:grid-cols-2 gap-3 mt-6">
        <div v-for="s in stages" :key="s.title" class="glass rounded-2xl p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="font-semibold text-sm">{{ s.title }}</div>
            <span class="text-[10px] rounded-full px-2 py-0.5 border" :class="s.badge === 'в разработке' ? 'text-amber-500 border-amber-500/30 bg-amber-500/10' : 'text-slate-500 border-slate-200 dark:border-white/10'">{{ s.badge }}</span>
          </div>
          <p class="text-xs text-slate-500 mt-2">{{ s.text }}</p>
        </div>
      </div>

      <div class="glass rounded-2xl p-5 mt-4 text-sm">
        <h2 class="font-semibold mb-2">Что уже можно делать</h2>
        <ul class="text-slate-500 text-xs space-y-1 list-disc pl-4">
          <li>выгружать коды из 1С в CSV и загружать в «Генерацию»;</li>
          <li>вызывать REST API по ключу: создание задания, статус, результат;</li>
          <li>печатать через Print Bridge.</li>
        </ul>
        <router-link to="/app/apikeys" class="inline-block mt-3 text-xs text-brand-400 hover:underline">Открыть API и примеры →</router-link>
      </div>

      <div class="glass rounded-2xl p-5 mt-3 text-sm">
        <h2 class="font-semibold mb-2">Хотите в ранний доступ?</h2>
        <p class="text-xs text-slate-500">Напишите на <a href="mailto:code-qr-pro@mail.ru?subject=1С-коннектор" class="text-brand-400 hover:underline">code-qr-pro@mail.ru</a> с темой «1С-коннектор»: укажите конфигурацию, версию платформы и версию 1С. Мы свяжемся для тестирования.</p>
      </div>

      <div class="flex items-center gap-2 mt-5 text-xs text-slate-500"><BrandIcon name="api" :size="16" /> 1С:УТ 11.5 — первый в очереди.</div>
    </div>
  </PublicShell>
</template>
