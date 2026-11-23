<script setup>
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { store } from '../../store.js';
import { api } from '../../api.js';

const route = useRoute();
const router = useRouter();
const searchQ = ref('');
const searchData = ref(null);
let searchTimer = null;
watch(searchQ, (v) => {
  clearTimeout(searchTimer);
  const q = String(v || '').trim();
  if (q.length < 2) { searchData.value = null; return; }
  searchTimer = setTimeout(async () => {
    try { searchData.value = await api.adminSearch(q); } catch { searchData.value = null; }
  }, 250);
});
function go(path) { searchQ.value = ''; searchData.value = null; router.push(path); }
const isStaff = computed(() => ['admin', 'support'].includes(store.user?.role));

const groups = computed(() => {
  const all = [
    {
      title: 'Обзор',
      links: [{ to: '/app/admin', label: 'Сводка', adminOnly: true }]
    },
    {
      title: 'Клиенты и деньги',
      links: [
        { to: '/app/admin/users', label: 'Клиенты' },
        { to: '/app/admin/orders', label: 'Платежи', adminOnly: true },
        { to: '/app/admin/bank', label: 'Сверка выписки', adminOnly: true },
        { to: '/app/admin/billing', label: 'Тарифы и подписки', adminOnly: true }
      ]
    },
    {
      title: 'Сервис',
      links: [
        { to: '/app/admin/jobs', label: 'Задания' },
        { to: '/app/admin/storage', label: 'Хранилище', adminOnly: true },
        { to: '/app/admin/logs', label: 'Ошибки', adminOnly: true },
        { to: '/app/admin/audit', label: 'Аудит', adminOnly: true }
      ]
    },
    {
      title: 'Поддержка и AI',
      links: [
        { to: '/app/admin/support', label: 'Обращения', adminOnly: true },
        { to: '/app/admin/reviews', label: 'Отзывы', adminOnly: true },
        { to: '/app/admin/ai', label: 'AI-помощник', adminOnly: true }
      ]
    },
    {
      title: 'Маркетинг',
      links: [
        { to: '/app/admin/analytics', label: 'SEO и аналитика', adminOnly: true },
        { to: '/app/admin/marketing', label: 'Рассылки и акции', adminOnly: true },
        { to: '/app/admin/content', label: 'Статьи и база знаний', adminOnly: true },
        { to: '/app/admin/ads', label: 'Реклама', adminOnly: true }
      ]
    },
    {
      title: 'Система',
      links: [{ to: '/app/admin/system', label: 'Система', adminOnly: true }, { to: '/app/admin/settings', label: 'Настройки', adminOnly: true }]
    }
  ];
  const role = store.user?.role;
  return all
    .map((g) => ({ ...g, links: g.links.filter((l) => role === 'admin' || !l.adminOnly) }))
    .filter((g) => g.links.length);
});

const isActive = (to) => (to === '/app/admin' ? route.path === '/app/admin' : route.path === to || route.path.startsWith(to + '/'));
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
    <section v-if="!isStaff" class="glass rounded-2xl p-8 text-center text-slate-500">
      Раздел доступен только администратору и поддержке
    </section>
    <section v-else class="space-y-5 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-2xl sm:text-3xl">Админ-панель</h1>
          <p class="text-xs sm:text-sm text-slate-500 mt-1">CODE QR PRO · клиенты, платежи, тарифы, задания и поддержка</p>
        </div>
        <router-link to="/app" class="btn-ghost !py-2 text-sm">← В кабинет</router-link>
      </div>

      <div class="glass rounded-2xl p-3 relative">
        <input v-model="searchQ" class="input !py-2 text-sm" placeholder="Поиск: email, заказ, обращение, задание…" autocomplete="off">
        <div v-if="searchData" class="mt-2 divide-y divide-slate-200 dark:divide-white/10 max-h-80 overflow-y-auto">
          <button v-for="u in searchData.users" :key="'u'+u.id" class="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-white/5" @click="go('/app/admin/users/' + u.id)">Клиент #{{ u.id }} · {{ u.email }} · {{ u.plan }}</button>
          <button v-for="o in searchData.orders" :key="'o'+o.id" class="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-white/5" @click="go('/app/admin/orders?q=' + encodeURIComponent(o.email || o.id))">Заказ #{{ o.id }} · {{ o.amount }} ₽ · {{ o.status }} · {{ o.email }}</button>
          <button v-for="t in searchData.tickets" :key="'t'+t.id" class="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-white/5" @click="go('/app/admin/support')">Обращение #{{ t.id }} · {{ t.subject }} · {{ t.email }}</button>
          <button v-for="j in searchData.jobs" :key="'j'+j.id" class="w-full text-left px-2 py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-white/5" @click="go('/app/admin/jobs')">Задание #{{ j.id }} · {{ j.name }} · {{ j.email }}</button>
        </div>
      </div>

      <nav class="glass rounded-2xl p-3 sm:p-4" aria-label="Разделы админки">
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div v-for="g in groups" :key="g.title" class="rounded-xl border border-slate-200/80 dark:border-white/10 bg-white/40 dark:bg-white/5 p-2">
            <div class="px-2 pt-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{{ g.title }}</div>
            <div class="flex flex-wrap gap-1.5">
              <router-link
                v-for="l in g.links" :key="l.to" :to="l.to"
                class="inline-flex items-center px-3 py-2 rounded-xl text-sm border transition-all duration-150"
                :class="isActive(l.to)
                  ? 'bg-gradient-to-r from-brand-500 to-accent-500 border-transparent text-white font-semibold shadow-md shadow-brand-500/30'
                  : 'bg-white/70 border-slate-200 text-slate-700 font-medium shadow-sm hover:bg-slate-50 hover:border-slate-300 hover:-translate-y-px dark:bg-white/[0.04] dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10 dark:hover:border-white/20'">
                {{ l.label }}
                <span
                  v-if="l.to === '/app/admin/support' && store.supportOpen > 0"
                  class="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold align-middle"
                >{{ store.supportOpen }}</span>
              </router-link>
            </div>
          </div>
        </div>
      </nav>

      <router-view />
    </section>
  </div>
</template>
