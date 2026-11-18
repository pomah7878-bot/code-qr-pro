<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime, money } from '../../lib/format.js';

const loading = ref(true);
const error = ref('');
const notice = ref('');
const stats = ref(null);
const orders = ref([]);
const reviews = ref([]);

const pendingReviews = computed(() => reviews.value.filter((r) => r.status === 'pending'));
const attention = computed(() => (stats.value?.pendingOrders > 0 ? stats.value.pendingOrders : 0));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [s, o, r] = await Promise.all([
      api.adminStats(),
      api.adminOrders({ per: 6 }),
      api.adminReviews()
    ]);
    stats.value = s;
    orders.value = o.orders;
    reviews.value = r.reviews;
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

async function moderate(review, status) {
  error.value = '';
  try {
    await api.adminModerateReview(review.id, { status });
    notice.value = 'Отзыв №' + review.id + ': ' + status;
    reviews.value = (await api.adminReviews()).reviews;
  } catch (e) { error.value = e.message; }
}

async function removeReview(review) {
  if (!window.confirm('Удалить отзыв №' + review.id + '? Действие необратимо.')) return;
  error.value = '';
  try {
    await api.deleteReview(review.id);
    reviews.value = (await api.adminReviews()).reviews;
  } catch (e) { error.value = e.message; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-display font-semibold text-lg">Сводка сервиса</h2>
      <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" @click="load">
        <span :class="loading ? 'animate-spin' : ''">↻</span> Обновить
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div v-if="stats" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      <router-link to="/app/admin/users" class="glass rounded-2xl p-4 hover:border-brand-500/40 transition">
        <div class="text-2xl font-extrabold">{{ stats.users }}</div>
        <div class="text-xs text-slate-500">клиентов</div>
      </router-link>
      <div class="glass rounded-2xl p-4">
        <div class="text-2xl font-extrabold grad-text">{{ stats.premium }}</div>
        <div class="text-xs text-slate-500">PREMIUM</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-2xl font-extrabold" :class="stats.blocked ? 'text-red-500' : ''">{{ stats.blocked }}</div>
        <div class="text-xs text-slate-500">заблокировано</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-2xl font-extrabold">{{ stats.codesToday }}</div>
        <div class="text-xs text-slate-500">кодов сегодня</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-2xl font-extrabold text-emerald-500">{{ money(stats.revenue) }}</div>
        <div class="text-xs text-slate-500">выручка всего</div>
      </div>
      <router-link to="/app/admin/orders" class="glass rounded-2xl p-4 hover:border-amber-500/40 transition">
        <div class="text-2xl font-extrabold" :class="stats.pendingOrders ? 'text-amber-500' : ''">{{ stats.pendingOrders }}</div>
        <div class="text-xs text-slate-500">ожидают оплаты</div>
      </router-link>
    </div>

    <div v-if="attention" class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm flex flex-wrap items-center gap-2">
      <span class="text-amber-500 font-semibold">Требует внимания:</span>
      <span>{{ attention }} {{ attention === 1 ? 'заказ ждёт' : 'заказов ждут' }} подтверждения оплаты.</span>
      <router-link to="/app/admin/orders?status=pending" class="underline underline-offset-2 hover:text-amber-500">Открыть платежи →</router-link>
    </div>

    <div class="grid lg:grid-cols-2 gap-6">
      <div class="glass rounded-2xl p-6">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h2 class="font-display font-semibold">Последние платежи</h2>
          <router-link to="/app/admin/orders" class="text-xs text-brand-400 hover:underline">Все →</router-link>
        </div>
        <p v-if="!orders.length" class="text-sm text-slate-500">Платежей пока нет.</p>
        <div v-for="o in orders" :key="o.id" class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0">
          <div class="min-w-0">
            <div class="text-sm truncate">{{ o.email }}</div>
            <div class="text-xs text-slate-500">№{{ o.id }} · {{ fmtDateTime(o.created_at) }}</div>
          </div>
          <div class="text-right shrink-0">
            <div class="text-sm font-semibold">{{ money(o.amount) }}</div>
            <div class="text-[11px]" :class="o.status === 'paid' ? 'text-emerald-500' : o.status === 'pending' ? 'text-amber-500' : 'text-slate-400'">{{ o.status }}</div>
          </div>
        </div>
      </div>

      <div class="glass rounded-2xl p-6">
        <div class="flex items-center justify-between gap-3 mb-4">
          <h2 class="font-display font-semibold">
            Отзывы на модерации
            <span v-if="pendingReviews.length" class="chip-soon ml-2 !text-amber-500 !border-amber-500/30 !bg-amber-500/10">{{ pendingReviews.length }}</span>
          </h2>
        </div>
        <p v-if="!pendingReviews.length" class="text-sm text-slate-500">Новых отзывов нет — всё проверено.</p>
        <div v-for="r in pendingReviews.slice(0, 3)" :key="r.id" class="py-3 border-b border-slate-100 dark:border-white/5 last:border-0">
          <div class="flex items-center gap-2 text-sm">
            <span class="text-amber-500">{{ '★'.repeat(r.rating) }}{{ '☆'.repeat(5 - r.rating) }}</span>
            <b class="truncate">{{ r.author_name || 'Клиент' }}</b>
            <span class="text-xs text-slate-500 truncate">{{ r.email }}</span>
          </div>
          <p class="text-sm mt-1 text-slate-600 dark:text-slate-300 line-clamp-3">{{ r.text }}</p>
          <div class="flex flex-wrap gap-2 mt-2">
            <button class="btn-ghost !py-1 !px-2.5 text-xs text-emerald-500" @click="moderate(r, 'approved')">Одобрить</button>
            <button class="btn-ghost !py-1 !px-2.5 text-xs text-amber-500" @click="moderate(r, 'hidden')">Скрыть</button>
            <button class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" @click="removeReview(r)">Удалить</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
