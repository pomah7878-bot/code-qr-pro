<script setup>
import BrandIcon from '../BrandIcon.vue';
import { onBeforeUnmount, watch } from 'vue';

const props = defineProps({
  open: Boolean,
  title: { type: String, default: '' },
  maxWidth: { type: String, default: 'max-w-lg' }
});
const emit = defineEmits(['close']);

function onKey(e) {
  if (e.key === 'Escape' && props.open) emit('close');
}
watch(() => props.open, (v) => {
  if (v) document.addEventListener('keydown', onKey);
  else document.removeEventListener('keydown', onKey);
});
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" @click="emit('close')"></div>
      <div class="relative glass rounded-2xl p-6 w-full max-h-[90vh] overflow-y-auto" :class="maxWidth" role="dialog" aria-modal="true" :aria-label="title">
        <div class="flex items-start justify-between gap-4 mb-4">
          <h2 class="font-display font-semibold text-lg">{{ title }}</h2>
          <button type="button" class="text-slate-400 hover:text-slate-700 dark:hover:text-white transition" aria-label="Закрыть" @click="emit('close')"><BrandIcon name="close" :size="18" /></button>
        </div>
        <slot />
      </div>
    </div>
  </Teleport>
</template>
