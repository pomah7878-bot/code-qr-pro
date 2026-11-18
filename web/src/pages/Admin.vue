<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';

const stats = ref(null);
const users = ref([]);
const orders = ref([]);
const cz = ref({ czEnabled: false, czApiUrl: '', czConfigured: false });
const czToken = ref('');
const error = ref('');
const notice = ref('');
const isAdmin = store.user?.role === 'admin';

async function load() {
  if (!isAdmin) return;
  try {
    stats.value = await api.adminStats();
    users.value = (await api.adminUsers()).users;
    orders.value = (await api.adminOrders()).orders;
    cz.value = await api.adminSettings();
  } catch (e) { error.value = e.message; }
}
async function setPlan(u, plan) {
  error.value = '';
  try { await api.adminSetPlan(u.id, { plan }); notice.value = `${u.email}: тариф ${plan.toUpperCase()}`; load(); }
  catch (e) { error.value = e.message; }
}
async function saveCz() {
  error.value = '';
  try {
    await api.adminSaveSettings({ czEnabled: cz.value.czEnabled, czApiUrl: cz.value.czApiUrl, czToken: czToken.value || undefined });
    czToken.value = '';
    notice.value = 'Настройки Честного ЗНАКа сохранены';
    load();
  } catch (e) { error.value = e.message; }
}
const fmt = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('ru') : '';
onMounted(load);
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/admin" />
    <section v-if="!isAdmin" class="glass rounded-2xl p-8 text-center text-slate-500">Раздел доступен только администратору</section>
    <section v-else class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">Админ-панель</h1>

      <div v-if="stats" class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ stats.users }}</div><div class="text-xs text-slate-500">пользователей</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold grad-text">{{ stats.premium }}</div><div class="text-xs text-slate-500">PREMIUM</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ stats.jobs }}</div><div class="text-xs text-slate-500">пакетов</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ stats.codesToday }}</div><div class="text-xs text-slate-500">кодов сегодня</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold text-emerald-500">{{ stats.revenue }} ₽</div><div class="text-xs text-slate-500">выручка</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold text-amber-500">{{ stats.pendingOrders }}</div><div class="text-xs text-slate-500">ожидают оплаты</div></div>
      </div>

      <div class="glass rounded-2xl p-6 overflow-x-auto">
        <h2 class="font-display font-semibold mb-4">Пользователи</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
            <th class="py-2 pr-3">Email</th><th class="py-2 pr-3">Роль</th><th class="py-2 pr-3">Тариф</th><th class="py-2 pr-3">Кодов сегодня</th><th class="py-2 pr-3">PREMIUM до</th><th class="py-2"></th>
          </tr></thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-b border-slate-100 dark:border-white/5">
              <td class="py-2 pr-3">{{ u.email }}<div class="text-xs text-slate-500">{{ u.name }}</div></td>
              <td class="py-2 pr-3">{{ u.role }}</td>
              <td class="py-2 pr-3 font-semibold" :class="u.plan === 'premium' ? 'grad-text' : ''">{{ u.plan.toUpperCase() }}</td>
              <td class="py-2 pr-3">{{ u.codes_today }}</td>
              <td class="py-2 pr-3">{{ fmt(u.premium_until) || '—' }}</td>
              <td class="py-2">
                <button v-if="u.plan !== 'premium'" class="btn-ghost !py-1 !px-2 text-xs" @click="setPlan(u, 'premium')">→ PREMIUM</button>
                <button v-else class="btn-ghost !py-1 !px-2 text-xs text-red-500" @click="setPlan(u, 'free')">→ FREE</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="glass rounded-2xl p-6">
        <h2 class="font-display font-semibold mb-1">Честный ЗНАК (ГИС МТ)</h2>
        <p class="text-xs text-slate-500 mb-4">
          Статус: <b :class="stats?.cz?.configured ? 'text-emerald-500' : 'text-amber-500'">{{ stats?.cz?.configured ? 'токен сохранён' : 'не подключено' }}</b> ·
          онлайн-проверка требует УКЭП и активируется отдельно. Ключи API:
          <a href="https://xn--80ajghhoc2aj1c8b.xn--p1ai/" target="_blank" rel="noopener" class="text-brand-400">честныйзнак.рф</a>
        </p>
        <div class="grid md:grid-cols-2 gap-4">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="cz.czEnabled"> Интеграция включена</label>
          <div><label class="label !text-xs">API URL</label><input v-model="cz.czApiUrl" class="input !py-2 text-sm"></div>
          <div class="md:col-span-2"><label class="label !text-xs">Токен / ключ API (не отображается после сохранения)</label><input v-model="czToken" type="password" class="input !py-2 text-sm" placeholder="оставьте пустым, чтобы не менять"></div>
        </div>
        <button class="btn-primary !py-2 mt-4" @click="saveCz">Сохранить настройки</button>
      </div>

      <div v-if="orders.length" class="glass rounded-2xl p-6 overflow-x-auto">
        <h2 class="font-display font-semibold mb-4">Платежи</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
            <th class="py-2 pr-3">№</th><th class="py-2 pr-3">Email</th><th class="py-2 pr-3">Сумма</th><th class="py-2 pr-3">Статус</th><th class="py-2">Оплачен</th>
          </tr></thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id" class="border-b border-slate-100 dark:border-white/5">
              <td class="py-2 pr-3 text-slate-500">{{ o.id }}</td><td class="py-2 pr-3">{{ o.email }}</td>
              <td class="py-2 pr-3">{{ o.amount }} ₽</td><td class="py-2 pr-3">{{ o.status }}</td><td class="py-2">{{ fmt(o.paid_at) || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    </section>
  </div>
</template>
