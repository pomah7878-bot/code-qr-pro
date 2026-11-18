<script setup>
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api.js';
import { store } from '../store.js';
import SideNav from '../components/SideNav.vue';

const route = useRoute();
const sub = ref(null);
const providerOk = ref(true);
const orders = ref([]);
const offers = ref([{ days: 30, price: 1990 }]);
const selectedDays = ref(30);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const promoCode = ref('');
const promo = ref(null);
const promoBusy = ref(false);
const selectedOffer = () => offers.value.find(o => o.days === selectedDays.value) || offers.value[0];
const totalPrice = computed(() => {
  const o = selectedOffer();
  if (promo.value && promo.value.days === selectedDays.value) return promo.value.finalAmount;
  return o.finalPrice ?? o.price;
});
watch(selectedDays, () => { promo.value = null; });

async function applyPromo() {
  error.value = '';
  promo.value = null;
  const code = promoCode.value.trim();
  if (!code) return;
  promoBusy.value = true;
  try {
    promo.value = await api.checkPromo({ code, days: selectedDays.value });
  } catch (e) { error.value = e.message; }
  promoBusy.value = false;
}

async function load() {
  try {
    const d = await api.subscription();
    sub.value = d.subscription; providerOk.value = d.providerConfigured;
    orders.value = (await api.orders()).orders;
    const plans = (await api.plans()).plans;
    const prem = plans.find(p => p.id === 'premium');
    if (prem?.offers?.length) { offers.value = prem.offers; selectedDays.value = prem.offers[0].days; }
  } catch (e) { error.value = e.message; }
}
async function checkout(plan = 'premium') {
  error.value = ''; busy.value = true;
  try {
    const body = plan === 'premium'
      ? { plan, days: selectedDays.value, promoCode: promo.value?.code }
      : { plan };
    const d = await api.checkout(body);
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
        </div>
        <div class="mt-5">
          <div class="text-sm text-slate-500 mb-2">Выберите период подписки:</div>
          <div class="flex flex-wrap gap-3">
            <button v-for="o in offers" :key="o.days" @click="selectedDays = o.days"
              class="relative rounded-xl border px-5 py-3 text-left transition"
              :class="selectedDays === o.days ? 'border-brand-500 bg-brand-500/10 ring-2 ring-brand-500/40' : 'border-slate-200 dark:border-white/15 hover:border-brand-500/50'">
              <span v-if="o.discount > 0" class="absolute -top-2 -right-2 text-[10px] font-bold bg-emerald-500 text-white rounded-full px-2 py-0.5">−{{ o.discount }}%</span>
              <div class="font-display font-bold text-lg">{{ (o.finalPrice ?? o.price).toLocaleString('ru') }} ₽</div>
              <div v-if="o.discount > 0" class="text-xs text-slate-400 line-through">{{ o.price.toLocaleString('ru') }} ₽</div>
              <div class="text-xs text-slate-500">{{ o.days }} дней<span v-if="o.days > 30"> · {{ (o.perMonth ?? Math.round(o.price / o.days * 30)).toLocaleString('ru') }} ₽/мес</span></div>
            </button>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-4">
          <input v-model="promoCode" class="input !py-2 !w-56 text-sm" placeholder="Промокод" aria-label="Промокод" autocomplete="off">
          <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="promoBusy" @click="applyPromo">{{ promoBusy ? 'Проверяем…' : 'Применить' }}</button>
          <span v-if="promo" class="text-sm text-emerald-500">
            {{ promo.code }}: −{{ promo.discount.toLocaleString('ru') }} ₽<template v-if="promo.bonusDays"> · +{{ promo.bonusDays }} дней</template>
          </span>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-4 mt-5">
          <ul class="grid md:grid-cols-2 gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <li>✓ 10 000 кодов в день</li><li>✓ Пакеты до 5 000 строк</li>
            <li>✓ Экспорт ZIP и PDF</li><li>✓ Редактор этикеток + Print Bridge</li>
            <li>✓ API для 1С и складов</li><li>✓ История 365 дней</li>
          </ul>
          <div class="text-right">
            <div class="text-3xl font-extrabold">{{ totalPrice.toLocaleString('ru') }} ₽<span class="text-sm text-slate-500 font-medium">/{{ selectedOffer().days + (promo?.bonusDays || 0) }} дней</span></div>
            <div v-if="promo" class="text-sm text-emerald-500">Промокод {{ promo.code }} применён</div>
            <div v-else-if="selectedOffer().discount > 0" class="text-sm text-emerald-500">Скидка {{ selectedOffer().discount }}% · выгода {{ (selectedOffer().price - (selectedOffer().finalPrice ?? selectedOffer().price)).toLocaleString('ru') }} ₽</div>
            <button class="btn-primary mt-2" :disabled="busy || !providerOk" @click="checkout('premium')">{{ busy ? 'Создаём заказ…' : (store.plan?.id === 'premium' ? 'Продлить PREMIUM' : 'Оформить PREMIUM') }}</button>
            <p v-if="!providerOk" class="text-xs text-red-500 mt-2">Платёжный провайдер не настроен — сообщите администратору</p>
          </div>
        </div>
        <p class="text-xs text-slate-500 mt-4">Предоплата через YooKassa (карта, СБП). Автопродления нет — продлевайте кнопкой. Чек приходит на email (54-ФЗ).</p>
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
