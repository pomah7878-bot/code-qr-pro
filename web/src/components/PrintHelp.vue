<script setup>
import { ref } from 'vue';
import BrandIcon from './BrandIcon.vue';

const open = ref(false);
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const platform = ref(/iPad|iPhone|iPod/.test(ua) ? 'ios' : 'android');

const tabs = [
  { id: 'ios', label: 'iPhone / iPad' },
  { id: 'android', label: 'Android' }
];
</script>

<template>
  <div class="rounded-xl border border-slate-200 dark:border-white/10 text-xs">
    <button type="button" class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left" @click="open = !open">
      <span class="flex items-center gap-2 font-medium"><BrandIcon name="print" :size="15" />Печать с телефона — AirPrint / Android</span>
      <span class="text-slate-500 shrink-0">{{ open ? 'Скрыть' : 'Как?' }}</span>
    </button>

    <div v-if="open" class="px-3 pb-3 space-y-2">
      <div class="inline-flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
        <button
          v-for="t in tabs" :key="t.id" type="button"
          class="px-3 py-1.5 transition"
          :class="platform === t.id ? 'bg-brand-500/15 font-semibold text-slate-800 dark:text-white' : 'text-slate-500'"
          @click="platform = t.id">
          {{ t.label }}
        </button>
      </div>

      <div v-if="platform === 'ios'" class="space-y-1.5 text-slate-500">
        <ol class="list-decimal pl-4 space-y-1">
          <li>Нажмите «Печать» или «PDF» — откроется просмотрщик PDF в Safari.</li>
          <li>Нажмите «Поделиться» → «Напечатать».</li>
          <li>Выберите принтер. Он должен быть в той же Wi-Fi сети — AirPrint не требует драйверов и приложений.</li>
        </ol>
        <p class="text-[11px]">Поддерживают HP, Canon, Epson, Brother, Xerox, Kyocera, Pantum и другие. Перед печатью выберите размер бумаги этикетки (например, 58×40 мм), иначе масштаб съедет.</p>
      </div>

      <div v-else class="space-y-1.5 text-slate-500">
        <ol class="list-decimal pl-4 space-y-1">
          <li>Нажмите «Печать» — Chrome откроет системное окно печати.</li>
          <li>Выберите принтер (служба печати Mopria / Default Print Service встроена в Android) и размер бумаги этикетки.</li>
          <li>Если окно не открылось — нажмите «PDF», откройте файл и выберите меню ⋮ → «Печать».</li>
        </ol>
        <p class="text-[11px]">Телефон и принтер должны быть в одной Wi-Fi сети. Для старых моделей может понадобиться приложение производителя или «Mopria Print Service» из Play Market.</p>
      </div>
    </div>
  </div>
</template>
