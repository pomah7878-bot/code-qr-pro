<script setup>
import { computed } from 'vue';

const props = defineProps({
  points: { type: Array, default: () => [] },
  valueKey: { type: String, default: 'revenue' },
  color: { type: String, default: '#818cf8' },
  height: { type: Number, default: 180 },
  label: { type: String, default: 'значение' }
});

const W = 600;
const PAD = 12;
const values = computed(() => props.points.map((p) => Number(p[props.valueKey]) || 0));
const max = computed(() => Math.max(1, ...values.value));
const coords = computed(() => {
  const n = values.value.length;
  if (!n) return [];
  const inner = props.height - PAD * 2;
  if (n === 1) return [{ x: W / 2, y: PAD + (1 - values.value[0] / max.value) * inner }];
  return values.value.map((v, i) => ({
    x: PAD + (i * (W - PAD * 2)) / (n - 1),
    y: PAD + (1 - v / max.value) * inner
  }));
});
const line = computed(() => coords.value.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
const area = computed(() => {
  if (!coords.value.length) return '';
  const first = coords.value[0];
  const last = coords.value[coords.value.length - 1];
  return `${line.value} L${last.x.toFixed(1)},${props.height - PAD} L${first.x.toFixed(1)},${props.height - PAD} Z`;
});
const total = computed(() => values.value.reduce((a, b) => a + b, 0));
const gradientId = 'chart-' + Math.random().toString(36).slice(2, 8);

const fmtShort = (v) => (v >= 1000 ? (v / 1000).toFixed(1).replace('.0', '') + 'к' : String(Math.round(v)));
const dates = computed(() => {
  const n = props.points.length;
  if (!n) return [];
  const pick = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  return pick.map((i) => ({
    i,
    x: PAD + (i * (W - PAD * 2)) / Math.max(1, n - 1),
    text: new Date(props.points[i].date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
  }));
});
</script>

<template>
  <div>
    <svg
      :viewBox="`0 0 ${W} ${height}`"
      class="w-full h-auto text-slate-400"
      role="img"
      :aria-label="`${label}: всего ${Math.round(total)}, за последний день ${Math.round(values[values.length - 1] || 0)}`"
      preserveAspectRatio="none">
      <defs>
        <linearGradient :id="gradientId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" :stop-color="color" stop-opacity="0.35" />
          <stop offset="100%" :stop-color="color" stop-opacity="0" />
        </linearGradient>
      </defs>

      <line v-for="p in [0.25, 0.5, 0.75]" :key="p" :x1="PAD" :x2="W - PAD"
        :y1="PAD + p * (height - PAD * 2)" :y2="PAD + p * (height - PAD * 2)"
        stroke="currentColor" stroke-opacity="0.12" stroke-dasharray="3 5" />

      <path v-if="area" :d="area" :fill="`url(#${gradientId})`" />
      <path v-if="line" :d="line" fill="none" :stroke="color" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      <circle v-if="coords.length" :cx="coords[coords.length - 1].x" :cy="coords[coords.length - 1].y" r="4" :fill="color" />

      <text :x="W - PAD" :y="PAD + 4" text-anchor="end" font-size="11" fill="currentColor" opacity="0.7">{{ fmtShort(max) }}</text>
      <text v-for="d in dates" :key="d.i" :x="d.x" :y="height - 1" :text-anchor="d.i === 0 ? 'start' : d.i === points.length - 1 ? 'end' : 'middle'"
        font-size="10" fill="currentColor" opacity="0.6">{{ d.text }}</text>
    </svg>
  </div>
</template>
