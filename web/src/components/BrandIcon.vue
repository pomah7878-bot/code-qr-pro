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
  ],
  overview: [
    { d: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z' }
  ],
  generate: [
    { d: 'M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7z' },
    { d: 'M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z' }
  ],
  billing: [
    { d: 'M3 7h18v10H3z M3 10h18 M7 14h3' }
  ],
  cz: [
    { d: 'M12 3l7 3v5c0 4-3 7-7 10-4-3-7-6-7-10V6z' },
    { d: 'M9 11l2 2 4-4 M9 16h6' }
  ],
  star: [
    { d: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z' }
  ],
  'star-filled': [
    { d: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z', fill: true }
  ],
  settings: [
    { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M19.1 4.9L17 7 M7 17l-2.1 2.1' }
  ],
  users: [
    { d: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3 3 0 0 1 0 6 M17 14a5.5 5.5 0 0 1 4.5 5.5' }
  ],
  orders: [
    { d: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6 M9 16h4' }
  ],
  jobs: [
    { d: 'M12 3l9 5-9 5-9-5z M3 12l9 5 9-5 M3 16l9 5 9-5' }
  ],
  storage: [
    { d: 'M4 6c0-2 16-2 16 0v12c0 2-16 2-16 0z M4 6c0 2 16 2 16 0 M4 12c0 2 16 2 16 0' }
  ],
  marketing: [
    { d: 'M4 10v4l11 4V6L4 10z M15 8l5-3v14l-5-3 M7 14v4' }
  ],
  audit: [
    { d: 'M6 4h12v16H6z M9 8h6 M9 12h6 M9 16h4' }
  ],
  help: [
    { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M9.5 9a2.5 2.5 0 1 1 4 2c-.8.6-1.5 1-1.5 2.2 M12 17h.01' }
  ],
  sun: [
    { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.9 4.9l1.4 1.4 M17.7 17.7l1.4 1.4 M19.1 4.9l-1.4 1.4 M6.3 17.7l-1.4 1.4' }
  ],
  moon: [
    { d: 'M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5z' }
  ],
  close: [
    { d: 'M6 6l12 12 M18 6L6 18' }
  ],
  plus: [
    { d: 'M12 5v14 M5 12h14' }
  ],
  trash: [
    { d: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 11v6 M14 11v6' }
  ],
  save: [
    { d: 'M4 4h13l3 3v13H4z M8 4v6h8V4 M8 20v-6h8v6' }
  ],
  edit: [
    { d: 'M4 20h4L20 8l-4-4L4 16z M13 7l4 4 M4 20v-4' }
  ],
  download: [
    { d: 'M12 3v12 M7 11l5 5 5-5 M4 21h16' }
  ],
  upload: [
    { d: 'M12 21V9 M7 13l5-5 5 5 M4 3h16' }
  ],
  eye: [
    { d: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z' }
  ],
  camera: [
    { d: 'M4 8h4l2-3h4l2 3h4v12H4z M12 12a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' }
  ],
  sound: [
    { d: 'M4 10v4h4l5 4V6L8 10z M16 9a4 4 0 0 1 0 6 M18.5 6.5a7.5 7.5 0 0 1 0 11' }
  ],
  mute: [
    { d: 'M4 10v4h4l5 4V6L8 10z M16 9l4 6 M20 9l-4 6' }
  ],
  warning: [
    { d: 'M12 3L2.5 20h19z M12 9v5 M12 17h.01' }
  ],
  info: [
    { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 11v5 M12 8h.01' }
  ],
  crown: [
    { d: 'M4 18h16l-2-9-4 3-2-6-2 6-4-3z M5 21h14' }
  ],
  seed: [
    { d: 'M12 21c0-7 4-11 9-12-1 7-4 10-9 12z M12 21c0-4-2-6-4-7' }
  ],
  flame: [
    { d: 'M12 3c3 4 5 6 5 10a5 5 0 0 1-10 0c0-2 1-4 3-6 0 2 1 3 2 3 1-2 0-4 0-7z' }
  ],
  refresh: [
    { d: 'M20 11a8 8 0 0 0-14.7-3L3 11 M3 5v6h6 M4 13a8 8 0 0 0 14.7 3L21 13 M21 19v-6h-6' }
  ],
  external: [
    { d: 'M14 4h6v6 M20 4l-9 9 M19 14v6H4V5h6' }
  ],
  search: [
    { d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16 16l5 5' }
  ],
  menu: [
    { d: 'M4 7h16 M4 12h16 M4 17h16' }
  ],
  shirt: [
    { d: 'M8 4l4 3 4-3 4 4-3 3v9H7v-9L4 8z M9 21v-7h6v7' }
  ],
  shoe: [
    { d: 'M4 16c3-1 4-2 5-5l3 2c2 4 5 4 8 5v3H4z M7 20h13' }
  ],
  toy: [
    { d: 'M7 8a5 5 0 1 0 10 0 5 5 0 0 0-10 0z M7 5a2 2 0 1 0 0 4 M17 5a2 2 0 1 0 0 4 M10 8h.01 M14 8h.01 M10 11c1 1 3 1 4 0' }
  ],
  bottle: [
    { d: 'M10 3h4v4l2 2v12H8V9l2-2z M10 3h4 M10 10h4' }
  ],
  pill: [
    { d: 'M8 5l11 11-3 3L5 8z M8 5l3 3' }
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
