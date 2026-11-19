<script setup>
import { ref } from 'vue';

defineProps({
  title: { type: String, default: 'Подсказка' },
  text: { type: String, required: true }
});
const open = ref(false);
</script>

<template>
  <span class="relative inline-flex align-middle">
    <button
      type="button"
      class="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 dark:border-white/20 text-[11px] font-bold text-slate-500 hover:border-brand-400 hover:text-brand-400"
      :aria-label="title"
      :aria-expanded="open"
      @mouseenter="open = true"
      @mouseleave="open = false"
      @click.stop="open = !open"
      @keydown.esc="open = false"
    >?</button>
    <span
      v-if="open"
      class="absolute left-1/2 top-7 z-50 w-64 -translate-x-1/2 rounded-xl border border-slate-200 dark:border-white/15 bg-white dark:bg-ink-900 p-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300 shadow-xl"
      @mouseenter="open = true"
      @mouseleave="open = false"
    >
      <b class="block text-slate-800 dark:text-white mb-1">{{ title }}</b>
      {{ text }}
    </span>
  </span>
</template>
