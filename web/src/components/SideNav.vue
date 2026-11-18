<script setup>
import { store } from '../store.js';
defineProps({ active: String });
const items = [
  { icon: '📊', t: 'Обзор', to: '/app' },
  { icon: '▦', t: 'Генерация', to: '/app/generate' },
  { icon: '🏷️', t: 'Этикетки', to: '/app/labels' },
  { icon: '🖨️', t: 'Печать', to: '/app/labels' },
  { icon: '💳', t: 'Подписка', to: '/app/billing' },
  { icon: '🔌', t: 'API', to: '/app/apikeys' },
  { icon: '🛡️', t: 'Честный ЗНАК', to: '/app/cz' },
  { icon: '⭐', t: 'Отзывы', to: '/app/reviews' },
  ...(store.user?.role === 'admin' ? [{ icon: '⚙️', t: 'Админка', to: '/app/admin' }] : [])
];
</script>

<template>
  <aside class="glass rounded-2xl p-4 h-fit">
    <div class="px-3 py-2 mb-2">
      <div class="font-semibold truncate">{{ store.user?.name || store.user?.email }}</div>
      <div class="text-xs text-slate-500 truncate">{{ store.user?.email }}</div>
    </div>
    <nav class="space-y-1">
      <template v-for="n in items" :key="n.t">
        <router-link v-if="n.to" :to="n.to"
          class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition"
          :class="active === n.to ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 font-semibold border border-brand-500/30' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'">
          <span>{{ n.icon }}</span><span>{{ n.t }}</span>
        </router-link>
        <div v-else class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-slate-500">
          <span>{{ n.icon }}</span><span>{{ n.t }}</span><span class="chip-soon ml-auto">{{ n.soon }}</span>
        </div>
      </template>
    </nav>
  </aside>
</template>
