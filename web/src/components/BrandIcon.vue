<script setup>
import { computed } from 'vue';

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 28 },
  title: { type: String, default: '' }
});

const paths = {
  matrix: [
    { d: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z' },
    { d: 'M14 14h3v3h-3z M19 14h1v1h-1z M14 19h1v1h-1z', fill: true }
  ],
  import: [
    { d: 'M7 3h6l4 4v14H7z M13 3v5h4' },
    { d: 'M12 11v7 M9 15l3 3 3-3' },
    { d: 'M5 21h14' }
  ],
  check: [
    { d: 'M12 3l7 3v5c0 4-3 7-7 10-4-3-7-6-7-10V6z' },
    { d: 'M9 12l2 2 4-4' },
    { d: 'M12 3l7 3v1l-7-3z', fill: true }
  ],
  label: [
    { d: 'M3 12l8-8h9v9l-8 8z' },
    { d: 'M8 8h.01 M12 12h4' },
    { d: 'M3 12l2 2 2-2-2-2z', fill: true }
  ],
  set: [
    { d: 'M4 8l8-4 8 4-8 4z M4 8v8l8 4 8-4V8 M12 12v8' },
    { d: 'M12 4v4 M8 6l8 4' }
  ],
  print: [
    { d: 'M7 8V4h10v4 M5 8h14v8H5z M7 16h10v5H7z' },
    { d: 'M8 12h3 M15 12h1' },
    { d: 'M7 16h10v1H7z', fill: true }
  ],
  archive: [
    { d: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z' },
    { d: 'M12 8v5l3 2' },
    { d: 'M12 4v1 M4 12h1' }
  ],
  api: [
    { d: 'M8 8l-4 4 4 4 M16 8l4 4-4 4' },
    { d: 'M13 5l-2 14' },
    { d: 'M12 12h.01 M5 5h2 M17 19h2' }
  ],
  lock: [
    { d: 'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3' },
    { d: 'M12 14v3 M10 14h4' },
    { d: 'M6 10h12v1H6z', fill: true }
  ],
  speed: [
    { d: 'M13 2L5 14h6l-1 8 8-12h-6z' },
    { d: 'M13 2l-2 5 M19 5l-2 2' }
  ]
};

const shapes = computed(() => paths[props.name] || paths.matrix);
const gradId = `brand-grad-${Math.random().toString(36).slice(2, 9)}`;
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    :aria-hidden="title ? undefined : 'true'"
    :role="title ? 'img' : undefined"
  >
    <title v-if="title">{{ title }}</title>
    <defs>
      <linearGradient :id="gradId" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop stop-color="#8b5cf6" />
        <stop offset="1" stop-color="#22d3ee" />
      </linearGradient>
    </defs>
    <path
      v-for="(shape, i) in shapes"
      :key="i"
      :d="shape.d"
      :fill="shape.fill ? `url(#${gradId})` : 'none'"
      :stroke="shape.fill ? 'none' : `url(#${gradId})`"
      stroke-width="1.55"
      stroke-linecap="round"
      stroke-linejoin="round"
      opacity="1"
    />
  </svg>
</template>
