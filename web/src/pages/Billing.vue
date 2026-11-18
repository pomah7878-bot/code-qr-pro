<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';

const route = useRoute();
const sub = ref(null);
const providerOk = ref(true);
const orders = ref([]);
const error = ref('');
const notice = ref('');
const busy = ref(false);

async function load() {
  try {
    const d = await api.subscription();
    sub.value = d.subscription; providerOk.value = d.providerConfigured;
    orders.value = (await api.orders()).orders;
  } catch (e) { error.value = e.message; }
}
const isAdmin = store.user?.role === 'admin';
async function checkout(plan = 'premium') {
  error.value = ''; busy.value = true;
  try {
    const d = await api.checkout({ plan });
    if (d.order.confirmationUrl) window.location.href = d.order.confirmationUrl;
    else error.value = 'Не получена ссылка на оплату';
  } catch (e) { error.value = e.message; }
  busy.value = false;
}
async function check(orderId) {
  error.value = ''; notice.value = '';
  try {
    const d = await api.checkOrder({ orderId });
    if (d.order.status === 'paid') { notice.value = 'Оплата подтверждена — PREMIUM активирован!'; store.load(); }
    else if (d.order.status === 'canceled') notice.value = 'Заказ отменён';
    else notice.value = 'Платёж ещё не завершён — если вы оплатили, подождите до минуты и проверьте снова';
    load();
  } catch (e) { error.value = e.message; }
}
const fmt = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('ru', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const statusRu = { pending: 'ожидает оплаты', paid: 'оплачен', canceled: 'отменён' };
onMounted(async () => {
  await load();
  if (route.query.order) await check(Number(route.query.order));
});
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/billing" />
    <section class="space-y-6 min-w-0">
      <h1 class="font-display font-bold text-3xl">Подписка</h1>

      <div class="glass rounded-2xl p-6">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="text-sm text-slate-500 mb-1">Текущий тариф</div>
            <div class="font-display font-extrabold text-2xl" :class="store.plan?.id === 'premium' ? 'grad-text' : ''">{{ store.plan?.title }}</div>
            <div v-if="sub" class="text-sm text-emerald-500 mt-1">PREMIUM активен до {{ fmt(sub.expires_at) }}</div>
          </div>
          <div v-if="store.plan?.id !== 'premium'" class="text-right">
            <div class="text-3xl font-extrabold">1 990 ₽<span class="text-sm text-slate-500 font-medium">/30 дней</span></div>
            <button class="btn-primary mt-2" :disabled="busy || !providerOk" @click="checkout('premium')">{{ busy ? 'Создаём заказ…' : 'Оформить PREMIUM' }}</button>
            <p v-if="!providerOk" class="text-xs text-red-500 mt-2">Платёжный провайдер не настроен — сообщите администратору</p>
          </div>
          <button v-else class="btn-ghost" :disabled="busy" @click="checkout('premium')">Продлить на 30 дней</button>
        </div>
        <ul class="grid md:grid-cols-2 gap-1.5 text-sm mt-5 text-slate-600 dark:text-slate-300">
          <li>✓ 10 000 кодов в день</li><li>✓ Пакеты до 5 000 строк</li>
          <li>✓ Экспорт ZIP и PDF</li><li>✓ Редактор этикеток + Print Bridge</li>
          <li>✓ API для 1С и складов</li><li>✓ История 365 дней</li>
        </ul>
        <p class="text-xs text-slate-500 mt-4">Предоплата за 30 дней через YooKassa (карта, СБП). Автопродления нет — продлевайте кнопкой. Чек приходит на email (54-ФЗ).</p>
      </div>

      <div v-if="isAdmin" class="glass rounded-2xl p-6 border-amber-500/40">
        <div class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div class="font-display font-semibold flex items-center gap-2">🧪 Тестовый платёж <span class="chip-soon">админ</span></div>
            <p class="text-sm text-slate-500 mt-1">Полный PREMIUM на 30 дней за 1 ₽ — боевая проверка оплаты через YooKassa без траты 1990 ₽.</p>
          </div>
          <div class="text-right">
            <div class="text-3xl font-extrabold">1 ₽<span class="text-sm text-slate-500 font-medium">/30 дней</span></div>
            <button class="btn-primary mt-2" :disabled="busy || !providerOk" @click="checkout('test')">{{ busy ? 'Создаём заказ…' : 'Тест за 1 ₽' }}</button>
          </div>
        </div>
      </div>

      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>
      <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

      <div v-if="orders.length" class="glass rounded-2xl p-6 overflow-x-auto">
        <h2 class="font-display font-semibold mb-4">История платежей</h2>
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
            <th class="py-2 pr-3">№</th><th class="py-2 pr-3">Дата</th><th class="py-2 pr-3">Сумма</th><th class="py-2 pr-3">Статус</th><th class="py-2"></th>
          </tr></thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id" class="border-b border-slate-100 dark:border-white/5">
              <td class="py-2 pr-3 text-slate-500">{{ o.id }}</td>
              <td class="py-2 pr-3">{{ fmt(o.created_at) }}</td>
              <td class="py-2 pr-3">{{ o.amount }} ₽</td>
              <td class="py-2 pr-3" :class="o.status === 'paid' ? 'text-emerald-500' : o.status === 'canceled' ? 'text-red-500' : 'text-amber-500'">{{ statusRu[o.status] || o.status }}</td>
              <td class="py-2"><button v-if="o.status === 'pending'" class="btn-ghost !py-1 !px-3 text-xs" @click="check(o.id)">Проверить оплату</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
