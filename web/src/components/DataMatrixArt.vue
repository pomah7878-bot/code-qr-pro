<script setup>
import { computed } from 'vue';
const N = 22;
const cells = computed(() => {
  const out = [];
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let on;
    if (x === 0 || y === N - 1) on = true;                 // сплошные L-стороны
    else if (y === 0) on = x % 2 === 0;                    // тактовая сверху
    else if (x === N - 1) on = y % 2 === 1;                // тактовая справа
    else on = rnd() > 0.5;
    out.push(on);
  }
  return out;
});
</script>

<template>
  <div class="relative p-5 rounded-3xl glass">
    <div class="grid gap-[2px]" :style="{ gridTemplateColumns: `repeat(${N}, 1fr)` }">
      <div v-for="(on, i) in cells" :key="i"
           class="aspect-square rounded-[1px] transition-colors"
           :class="on ? 'bg-slate-900 dark:bg-slate-100' : 'bg-transparent'" />
    </div>
    <div class="scanline absolute left-4 right-4 h-[3px] rounded-full bg-gradient-to-r from-transparent via-accent-400 to-transparent"></div>
    <div class="mt-4 flex items-center justify-between text-xs font-mono text-slate-500">
      <span>GS1 · ECC200 · FNC1</span><span class="text-accent-400">✓ валиден</span>
    </div>
  </div>
</template>

<style scoped>
.scanline { animation: scan 3.2s ease-in-out infinite; top: 20px; }
@keyframes scan { 0%,100% { top: 20px; opacity:.2 } 50% { top: calc(100% - 60px); opacity:1 } }
</style>
