<script setup>
import { ref } from 'vue';
import { hints } from '../lib/hints.js';
import BrandIcon from './BrandIcon.vue';

const open = ref(false);

const props = defineProps({
  id: { type: String, required: true },
  title: { type: String, default: 'Как это работает' },
  steps: { type: Array, default: () => [] },
  note: { type: String, default: '' }
});
</script>

<template>
  <div v-if="hints.isVisible(props.id)" class="glass rounded-2xl p-4 border-l-4 border-brand-500 bg-brand-500/5">
    <div class="flex items-start gap-3">
      <BrandIcon name="info" :size="20" class="mt-0.5 shrink-0" />
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h2 class="font-display font-semibold text-sm">{{ title }}</h2>
          <div class="flex items-center gap-3">
            <button class="sm:hidden text-xs text-brand-500 font-medium" @click="open = !open">{{ open ? 'Свернуть' : 'Показать шаги' }}</button>
            <button class="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" @click="hints.dismiss(props.id)">Понятно</button>
          </div>
        </div>
        <div :class="open ? 'mt-2' : 'mt-2 hidden sm:block'">
        <ol class="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-slate-300 list-decimal list-inside">
          <li v-for="(step, i) in steps" :key="i">{{ step }}</li>
        </ol>
        <p v-if="note" class="text-xs text-slate-500 mt-2">{{ note }}</p>
        <button class="text-[11px] text-slate-400 hover:text-red-500 mt-2" @click="hints.disable()">Больше не показывать подсказки</button>
        </div>
      </div>
    </div>
  </div>
</template>
