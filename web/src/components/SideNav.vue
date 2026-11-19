<script setup>
import { store } from '../store.js';
defineProps({ active: String });
const items = [
  { icon: '📊', t: 'Обзор', to: '/app' },
  { icon: '▦', t: 'Генерация', to: '/app/generate' },
  { icon: '🏷️', t: 'Этикетки', to: '/app/labels' },
  { icon: '🖨️', t: 'Повторная печать', to: '/app/reprint' },
  { icon: '💳', t: 'Подписка', to: '/app/billing' },
  { icon: '🔌', t: 'API', to: '/app/apikeys' },
  { icon: '🛡️', t: 'Честный ЗНАК', to: '/app/cz' },
  { icon: '⭐', t: 'Отзывы', to: '/app/reviews' },
  { icon: '🔐', t: 'Безопасность', to: '/app/security' },
  ...(['admin', 'support'].includes(store.user?.role) ? [{ icon: '⚙️', t: 'Админка', to: '/app/admin' }] : [])
];
</script>

<template>
  <!-- mobile: горизонтальная лента -->
  <nav class="lg:hidden -mx-4 px-4 overflow-x-auto">
    <div class="flex gap-2 pb-1 min-w-max">
      <template v-for="n in items" :key="n.t">
        <a v-if="n.href" :href="n.href" target="_blank" rel="noopener"
          class="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap border border-slate-200 dark:border-white/10 text-slate-500">
          <span>{{ n.icon }}</span><span>{{ n.t }} ↗</span>
        </a>
        <router-link v-else :to="n.to"
          class="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap border transition"
          :class="active === n.to ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 border-brand-500/40 text-slate-800 dark:text-white' : 'border-slate-200 dark:border-white/10 text-slate-500'">
          <span>{{ n.icon }}</span><span>{{ n.t }}</span>
        </router-link>
      </template>
    </div>
  </nav>

  <!-- desktop: вертикальный сайдбар -->
  <aside class="hidden lg:block glass rounded-2xl p-4 h-fit">
    <div class="px-3 py-2 mb-2">
      <div class="font-semibold truncate">{{ store.user?.name || store.user?.email }}</div>
      <div class="text-xs text-slate-500 truncate">{{ store.user?.email }}</div>
    </div>
    <nav class="space-y-1">
      <template v-for="n in items" :key="n.t">
        <a v-if="n.href" :href="n.href" target="_blank" rel="noopener"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5">
          <span>{{ n.icon }}</span><span>{{ n.t }} ↗</span>
        </a>
        <router-link v-else :to="n.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition"
          :class="active === n.to ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 font-semibold border border-brand-500/30' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'">
          <span>{{ n.icon }}</span><span>{{ n.t }}</span>
        </router-link>
      </template>
    </nav>
  </aside>
</template>
