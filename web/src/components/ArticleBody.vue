<script setup>
import { computed } from 'vue';

const props = defineProps({
  text: { type: String, default: '' }
});

// База знаний хранит текст простыми абзацами: пункты «1.» и строки «— …».
const blocks = computed(() => {
  const lines = String(props.text || '').split(/\r?\n/);
  const out = [];
  let list = null;
  const flush = () => {
    if (list) {
      out.push(list);
      list = null;
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^\d+\.\s/.test(line)) {
      if (!list || list.type !== 'ol') {
        flush();
        list = { type: 'ol', items: [] };
      }
      list.items.push(line.replace(/^\d+\.\s*/, ''));
      continue;
    }
    if (/^[—–-]\s/.test(line)) {
      if (!list || list.type !== 'ul') {
        flush();
        list = { type: 'ul', items: [] };
      }
      list.items.push(line.replace(/^[—–-]\s*/, ''));
      continue;
    }
    flush();
    out.push({ type: 'p', text: line });
  }
  flush();
  return out;
});
</script>

<template>
  <div class="space-y-4 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
    <template v-for="(b, i) in blocks" :key="i">
      <p v-if="b.type === 'p'" class="whitespace-pre-wrap">{{ b.text }}</p>
      <ol v-else-if="b.type === 'ol'" class="list-decimal pl-5 space-y-1.5">
        <li v-for="(it, j) in b.items" :key="j">{{ it }}</li>
      </ol>
      <ul v-else class="list-disc pl-5 space-y-1.5">
        <li v-for="(it, j) in b.items" :key="j">{{ it }}</li>
      </ul>
    </template>
  </div>
</template>
