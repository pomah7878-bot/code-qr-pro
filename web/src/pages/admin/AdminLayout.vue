<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { store } from '../../store.js';
import SideNav from '../../components/SideNav.vue';

const route = useRoute();
const isAdmin = computed(() => store.user?.role === 'admin');
const links = computed(() => {
  const all = [
    { to: '/app/admin', label: 'Обзор', adminOnly: true },
    { to: '/app/admin/users', label: 'Клиенты' },
    { to: '/app/admin/orders', label: 'Платежи', adminOnly: true },
    { to: '/app/admin/jobs', label: 'Задания' },
    { to: '/app/admin/storage', label: 'Хранилище', adminOnly: true },
    { to: '/app/admin/marketing', label: 'Маркетинг', adminOnly: true },
    { to: '/app/admin/ads', label: 'Реклама', adminOnly: true },
    { to: '/app/admin/audit', label: 'Аудит', adminOnly: true },
    { to: '/app/admin/logs', label: 'Ошибки', adminOnly: true },
    { to: '/app/admin/settings', label: 'Настройки', adminOnly: true }
  ];
  return store.user?.role === 'admin' ? all : all.filter((l) => !l.adminOnly);
});
const isActive = (to) => (to === '/app/admin' ? route.path === '/app/admin' : route.path === to || route.path.startsWith(to + '/'));
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/admin" />
    <section v-if="!isAdmin" class="glass rounded-2xl p-8 text-center text-slate-500">
      Раздел доступен только администратору
    </section>
    <section v-else class="space-y-6 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-2xl sm:text-3xl">Админ-панель</h1>
          <p class="text-xs text-slate-500 mt-1">CODE QR PRO · управление клиентами, платежами и сервисом</p>
        </div>
      </div>

      <nav class="flex flex-wrap gap-2" aria-label="Разделы админки">
        <router-link
          v-for="l in links" :key="l.to" :to="l.to"
          class="px-4 py-2.5 rounded-xl text-sm border transition"
          :class="isActive(l.to)
            ? 'bg-gradient-to-r from-brand-500/20 to-accent-500/10 border-brand-500/40 font-semibold text-slate-800 dark:text-white'
            : 'border-slate-200 dark:border-white/10 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'">
          {{ l.label }}
        </router-link>
      </nav>

      <router-view />
    </section>
  </div>
</template>
