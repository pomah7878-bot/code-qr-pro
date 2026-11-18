<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, qs } from '../../api.js';
import { fmtDate, fmtDateTime, money } from '../../lib/format.js';
import Modal from '../../components/admin/Modal.vue';

const route = useRoute();
const filters = reactive({ q: '', status: String(route.query.status || ''), from: '', to: '', page: 1 });
const data = ref({ orders: [], total: 0, page: 1, pages: 1, summary: { paid_sum: 0, pending_sum: 0, refunded_sum: 0, c: 0 } });
const loading = ref(false);
const error = ref('');
const notice = ref('');
const actionBusy = ref(0);

const refundTarget = ref(null);
const refundOpen = ref(false);
const refundRevoke = ref(true);
const refundBusy = ref(false);

const STATUS_LABEL = { pending: 'Ожидает', paid: 'Оплачен', canceled: 'Отменён', refunded: 'Возврат' };

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminOrders({ ...filters, per: 25 });
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

function applyFilters() {
  filters.page = 1;
  load();
}

let timer = null;
watch(() => filters.q, () => {
  clearTimeout(timer);
  timer = setTimeout(applyFilters, 320);
});
watch(() => [filters.status, filters.from, filters.to], applyFilters);
watch(() => route.query.status, (v) => {
  if (v !== undefined) { filters.status = String(v); }
});

function go(page) {
  filters.page = Math.min(Math.max(1, page), data.value.pages || 1);
  load();
}

function reset() {
  filters.q = '';
  filters.status = '';
  filters.from = '';
  filters.to = '';
  applyFilters();
}

function exportCsv() {
  window.open('/api/admin/orders/export.csv' + qs({
    q: filters.q, status: filters.status, from: filters.from, to: filters.to
  }), '_blank');
}

async function run(order, fn, okText) {
  actionBusy.value = order.id;
  error.value = '';
  notice.value = '';
  try {
    const r = await fn();
    notice.value = typeof okText === 'function' ? okText(r) : okText;
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    actionBusy.value = 0;
  }
}

function confirmOrder(o) {
  if (!window.confirm(`Подтвердить оплату заказа №${o.id} на ${money(o.amount)}?\nPREMIUM активируется на ${o.days} дн.`)) return;
  run(o, () => api.adminConfirmOrder(o.id), 'Оплата подтверждена, PREMIUM выдан');
}

function cancelOrder(o) {
  if (!window.confirm(`Отменить заказ №${o.id}? Если платёж уже создан, он будет отменён в ЮKassa.`)) return;
  run(o, () => api.adminCancelOrder(o.id), 'Заказ отменён');
}

function recheck(o) {
  run(o, () => api.adminRecheckOrder(o.id), (r) => 'Статус обновлён: ' + r.order.status);
}

function openRefund(o) {
  refundTarget.value = o;
  refundRevoke.value = true;
  refundOpen.value = true;
}

async function doRefund() {
  if (!refundTarget.value) return;
  refundBusy.value = true;
  error.value = '';
  try {
    const r = await api.adminRefundOrder(refundTarget.value.id, refundRevoke.value);
    refundOpen.value = false;
    notice.value = r.pending
      ? 'Возврат отправлен в ЮKassa и обрабатывается'
      : 'Возврат выполнен' + (refundRevoke.value ? ', PREMIUM снят' : '');
    await load();
  } catch (e) {
    error.value = e.message;
  } finally {
    refundBusy.value = false;
  }
}

const statusClass = (s) => (s === 'paid' ? 'text-emerald-500'
  : s === 'pending' ? 'text-amber-500'
    : s === 'refunded' ? 'text-red-500' : 'text-slate-400');

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold text-lg">Платежи</h2>
        <p class="text-xs text-slate-500 mt-0.5">Ручное подтверждение, отмена и возврат. Деньги возвращает ЮKassa.</p>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="exportCsv">↓ Экспорт CSV</button>
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div class="glass rounded-2xl p-4">
        <div class="text-xl font-extrabold text-emerald-500">{{ money(data.summary.paid_sum) }}</div>
        <div class="text-xs text-slate-500">оплачено по фильтру</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xl font-extrabold text-amber-500">{{ money(data.summary.pending_sum) }}</div>
        <div class="text-xs text-slate-500">ожидает оплаты</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xl font-extrabold text-red-500">{{ money(data.summary.refunded_sum) }}</div>
        <div class="text-xs text-slate-500">возвраты</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xl font-extrabold">{{ data.summary.c }}</div>
        <div class="text-xs text-slate-500">заказов в выборке</div>
      </div>
    </div>

    <div class="glass rounded-2xl p-4 grid sm:grid-cols-2 lg:grid-cols-[1fr_160px_150px_150px_auto] gap-3 items-end">
      <div>
        <label class="label !text-xs" for="order-q">Поиск</label>
        <input id="order-q" v-model="filters.q" class="input !py-2 text-sm" placeholder="Email или номер заказа" autocomplete="off">
      </div>
      <div>
        <label class="label !text-xs" for="order-status">Статус</label>
        <select id="order-status" v-model="filters.status" class="input !py-2 text-sm">
          <option value="">Все</option>
          <option value="pending">Ожидает</option>
          <option value="paid">Оплачен</option>
          <option value="canceled">Отменён</option>
          <option value="refunded">Возврат</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="order-from">С даты</label>
        <input id="order-from" v-model="filters.from" type="date" class="input !py-2 text-sm">
      </div>
      <div>
        <label class="label !text-xs" for="order-to">По дату</label>
        <input id="order-to" v-model="filters.to" type="date" class="input !py-2 text-sm">
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="reset">Сбросить</button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">№</th>
              <th class="py-3 px-4 font-medium">Клиент</th>
              <th class="py-3 px-4 font-medium">Тариф</th>
              <th class="py-3 px-4 font-medium">Сумма</th>
              <th class="py-3 px-4 font-medium">Статус</th>
              <th class="py-3 px-4 font-medium hidden md:table-cell">Создан</th>
              <th class="py-3 px-4 font-medium hidden md:table-cell">Оплачен</th>
              <th class="py-3 px-4 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !data.orders.length">
              <td colspan="8" class="py-8 text-center text-slate-500">Загрузка…</td>
            </tr>
            <tr v-else-if="!data.orders.length">
              <td colspan="8" class="py-8 text-center text-slate-500">Заказов нет — измени фильтры.</td>
            </tr>
            <tr v-for="o in data.orders" :key="o.id" class="border-b border-slate-100 dark:border-white/5 last:border-0">
              <td class="py-3 px-4 text-slate-500">{{ o.id }}</td>
              <td class="py-3 px-4">
                <div class="truncate max-w-[220px]">{{ o.email }}</div>
                <div class="text-[11px] text-slate-500">ID {{ o.user_id }}</div>
              </td>
              <td class="py-3 px-4">{{ o.plan.toUpperCase() }}<span class="text-slate-500"> · {{ o.days }} дн.</span></td>
              <td class="py-3 px-4">
                <div class="font-semibold">{{ money(o.amount) }}</div>
                <div v-if="o.discount > 0" class="text-[11px] text-emerald-500">скидка {{ money(o.discount) }}</div>
                <div v-if="o.promo_code" class="text-[11px] text-brand-400">{{ o.promo_code }}</div>
              </td>
              <td class="py-3 px-4">
                <span class="text-xs font-semibold" :class="statusClass(o.status)">{{ STATUS_LABEL[o.status] || o.status }}</span>
              </td>
              <td class="py-3 px-4 hidden md:table-cell text-slate-500">{{ fmtDateTime(o.created_at) }}</td>
              <td class="py-3 px-4 hidden md:table-cell text-slate-500">{{ o.paid_at ? fmtDateTime(o.paid_at) : '—' }}</td>
              <td class="py-3 px-4">
                <div class="flex flex-wrap gap-1.5">
                  <template v-if="o.status === 'pending'">
                    <button class="btn-ghost !py-1 !px-2.5 text-xs text-emerald-500" :disabled="actionBusy === o.id" @click="confirmOrder(o)">Подтвердить</button>
                    <button class="btn-ghost !py-1 !px-2.5 text-xs" :disabled="actionBusy === o.id" @click="recheck(o)">Проверить</button>
                    <button class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" :disabled="actionBusy === o.id" @click="cancelOrder(o)">Отменить</button>
                  </template>
                  <button v-else-if="o.status === 'paid'" class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" :disabled="actionBusy === o.id" @click="openRefund(o)">Возврат</button>
                  <span v-else class="text-slate-400 text-xs">—</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span class="text-slate-500">Всего {{ data.total }}</span>
      <div class="flex items-center gap-2">
        <button class="btn-ghost !py-1.5 !px-3 text-sm" :disabled="filters.page <= 1" @click="go(filters.page - 1)">← Назад</button>
        <span class="text-slate-500">{{ data.page }} / {{ data.pages }}</span>
        <button class="btn-ghost !py-1.5 !px-3 text-sm" :disabled="filters.page >= data.pages" @click="go(filters.page + 1)">Вперёд →</button>
      </div>
    </div>

    <Modal :open="refundOpen" title="Возврат средств" @close="refundOpen = false">
      <template v-if="refundTarget">
        <p class="text-sm">
          Заказ №{{ refundTarget.id }} на <b>{{ money(refundTarget.amount) }}</b> будет возвращён через ЮKassa.
          Клиент: {{ refundTarget.email }}.
        </p>
        <label class="flex items-start gap-2 mt-4 text-sm">
          <input v-model="refundRevoke" type="checkbox" class="mt-1">
          <span>Снять PREMIUM после возврата<br><span class="text-xs text-slate-500">Если снять галочку, доступ останется до конца оплаченного срока.</span></span>
        </label>
        <p class="text-xs text-amber-500 mt-3">Возврат затрагивает реальные деньги. ЮKassa принимает его необратимо.</p>
        <div class="flex justify-end gap-2 mt-4">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="refundOpen = false">Отмена</button>
          <button class="btn-primary !py-2 !px-4 text-sm !from-red-600 !to-red-500" :disabled="refundBusy" @click="doRefund">{{ refundBusy ? 'Возвращаем…' : 'Вернуть деньги' }}</button>
        </div>
      </template>
    </Modal>
  </div>
</template>
