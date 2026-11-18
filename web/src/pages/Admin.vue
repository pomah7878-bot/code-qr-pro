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
const offers = ref([]);
const testPrice = ref(1);
const reviews = ref([]);
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
    const pr = await api.adminPricing();
    offers.value = pr.offers.map(o => ({ ...o }));
    testPrice.value = pr.testPrice;
    reviews.value = (await api.adminReviews()).reviews;
  } catch (e) { error.value = e.message; }
}
function addOffer() { offers.value.push({ days: 30, price: 1990 }); }
function removeOffer(i) { offers.value.splice(i, 1); }
async function savePricing() {
  error.value = '';
  try {
    const d = await api.adminSavePricing({ offers: offers.value, testPrice: testPrice.value });
    offers.value = d.offers.map(o => ({ ...o }));
    testPrice.value = d.testPrice;
    notice.value = 'Тарифы сохранены';
  } catch (e) { error.value = e.message; }
}
async function moderate(r, status) {
  error.value = '';
  try { await api.adminModerateReview(r.id, { status }); notice.value = 'Отзыв №' + r.id + ': ' + status; reviews.value = (await api.adminReviews()).reviews; }
  catch (e) { error.value = e.message; }
}
async function delReview(r) {
  error.value = '';
  try { await api.deleteReview(r.id); reviews.value = (await api.adminReviews()).reviews; }
  catch (e) { error.value = e.message; }
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
        <h2 class="font-display font-semibold mb-1">💳 Тарифы PREMIUM</h2>
        <p class="text-xs text-slate-500 mb-4">Периоды подписки и цены. Клиенты выберут период на странице оплаты. Срок 1–3650 дней, цена 1–1 000 000 ₽.</p>
        <div class="space-y-2">
          <div v-for="(o, i) in offers" :key="i" class="flex items-center gap-3">
            <div class="flex items-center gap-1"><input v-model.number="o.days" type="number" min="1" max="3650" class="input !py-2 text-sm w-24"><span class="text-sm text-slate-500">дн.</span></div>
            <div class="flex items-center gap-1"><input v-model.number="o.price" type="number" min="1" class="input !py-2 text-sm w-32"><span class="text-sm text-slate-500">₽</span></div>
            <button class="text-slate-400 hover:text-red-500 ml-auto" @click="removeOffer(i)" title="Удалить период">✕</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-3 mt-4 items-center">
          <button class="btn-ghost !py-2 text-sm" @click="addOffer">+ Добавить период</button>
          <div class="flex items-center gap-2 ml-auto"><span class="text-sm text-slate-500">TEST:</span><input v-model.number="testPrice" type="number" min="1" class="input !py-2 text-sm w-24"><span class="text-sm text-slate-500">₽</span></div>
        </div>
        <button class="btn-primary !py-2 mt-4" @click="savePricing">Сохранить тарифы</button>
      </div>

      <div class="glass rounded-2xl p-6 overflow-x-auto">
        <h2 class="font-display font-semibold mb-4">⭐ Отзывы клиентов</h2>
        <p v-if="!reviews.length" class="text-sm text-slate-500">Отзывов пока нет.</p>
        <div v-for="r in reviews" :key="r.id" class="border-b border-slate-100 dark:border-white/5 py-3">
          <div class="flex items-center gap-2 text-sm">
            <span class="text-amber-500">{{ '★'.repeat(r.rating) }}{{ '☆'.repeat(5 - r.rating) }}</span>
            <b>{{ r.author_name || 'Клиент' }}</b>
            <span class="text-xs text-slate-500">{{ r.email }}</span>
            <span class="chip-soon ml-auto" :class="r.status === 'approved' ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : r.status === 'hidden' ? '!text-red-500 !border-red-500/30 !bg-red-500/10' : ''">{{ r.status }}</span>
          </div>
          <p class="text-sm mt-1 text-slate-600 dark:text-slate-300">{{ r.text }}</p>
          <div class="flex gap-2 mt-2">
            <button v-if="r.status !== 'approved'" class="btn-ghost !py-1 !px-2 text-xs text-emerald-500" @click="moderate(r, 'approved')">Одобрить</button>
            <button v-if="r.status !== 'hidden'" class="btn-ghost !py-1 !px-2 text-xs text-amber-500" @click="moderate(r, 'hidden')">Скрыть</button>
            <button class="btn-ghost !py-1 !px-2 text-xs text-red-500" @click="delReview(r)">Удалить</button>
          </div>
        </div>
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
