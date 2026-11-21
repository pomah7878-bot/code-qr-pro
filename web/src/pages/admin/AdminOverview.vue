<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime, money } from '../../lib/format.js';
import LineChart from '../../components/admin/LineChart.vue';
import BrandIcon from '../../components/BrandIcon.vue';

const loading = ref(true);
const error = ref('');
const notice = ref('');
const overview = ref(null);
const health = ref(null);
const series = ref([]);
const orders = ref([]);
const reviews = ref([]);

const metric = ref('revenue');
const chartDays = ref(30);
const chartLoading = ref(false);

const METRICS = {
  revenue: { label: 'Выручка', color: '#34d399', money: true },
  signups: { label: 'Регистрации', color: '#818cf8', money: false },
  codes: { label: 'Коды', color: '#22d3ee', money: false }
};

const pendingReviews = computed(() => reviews.value.filter((r) => r.status === 'pending'));
const chartTotal = computed(() => series.value.reduce((s, p) => s + Number(p[metric.value] || 0), 0));
const delta = computed(() => {
  const o = overview.value;
  if (!o?.revenue?.prevMonth) return null;
  return Math.round(((o.revenue.month - o.revenue.prevMonth) / o.revenue.prevMonth) * 100);
});
const attention = computed(() => {
  const o = overview.value;
  if (!o) return [];
  const items = [];
  if (o.orders.pending) items.push({ text: `${o.orders.pending} ${o.orders.pending === 1 ? 'заказ ждёт' : 'заказов ждут'} подтверждения оплаты`, to: '/app/admin/orders?status=pending', tone: 'amber' });
  if (o.subscriptions.expiring7) items.push({ text: `${o.subscriptions.expiring7} подписок истекают в ближайшие 7 дней`, to: '/app/admin/billing', tone: 'amber' });
  if (o.jobs.errors24h) items.push({ text: `${o.jobs.errors24h} заданий упали за сутки`, to: '/app/admin/jobs?status=error', tone: 'red' });
  return items;
});

const fmtBytes = (b) => {
  if (!b) return '0';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};
const fmtUptime = (s) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d} д ${h} ч` : `${h} ч ${m} мин`;
};
const metricLabel = computed(() => (METRICS[metric.value].money ? money(chartTotal.value) : chartTotal.value.toLocaleString('ru')));
const diskFreePercent = computed(() => {
  const d = health.value?.disk;
  return d && d.total ? Math.round((d.free / d.total) * 100) : null;
});

async function loadSeries() {
  chartLoading.value = true;
  try {
    const s = await api.adminSeries(chartDays.value);
    series.value = s.points;
  } catch (e) { error.value = e.message; }
  finally { chartLoading.value = false; }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [o, h, ord, rev] = await Promise.all([
      api.adminOverview(30),
      api.adminHealth(),
      api.adminOrders({ per: 5 }),
      api.adminReviews()
    ]);
    overview.value = o;
    health.value = h;
    orders.value = ord.orders;
    reviews.value = rev.reviews;
    await loadSeries();
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
}

watch(chartDays, loadSeries);

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
  <div class="space-y-5">
    <div class="flex items-center justify-between gap-3">
      <h2 class="font-display font-semibold text-lg">Сводка сервиса</h2>
      <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" @click="load">
        <span :class="loading ? 'animate-spin' : ''">↻</span> Обновить
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <template v-if="overview">
      <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <div class="glass rounded-2xl p-4">
          <div class="text-xl font-extrabold text-emerald-500">{{ money(overview.revenue.today) }}</div>
          <div class="text-xs text-slate-500">сегодня · за 7 дней {{ money(overview.revenue.week) }}</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="flex items-baseline gap-2">
            <span class="text-xl font-extrabold">{{ money(overview.revenue.month) }}</span>
            <span v-if="delta !== null" class="text-[11px] font-semibold" :class="delta >= 0 ? 'text-emerald-500' : 'text-red-500'">{{ delta >= 0 ? '↑' : '↓' }} {{ Math.abs(delta) }}%</span>
          </div>
          <div class="text-xs text-slate-500">выручка 30 дней</div>
        </div>
        <router-link to="/app/admin/users" class="glass rounded-2xl p-4 hover:border-brand-500/40 transition">
          <div class="text-xl font-extrabold">{{ overview.users.total }}</div>
          <div class="text-xs text-slate-500">клиентов · +{{ overview.users.new30 }} за 30 дней</div>
        </router-link>
        <div class="glass rounded-2xl p-4">
          <div class="text-xl font-extrabold grad-text">{{ overview.users.premium }}</div>
          <div class="text-xs text-slate-500">На платных тарифах · {{ overview.subscriptions.expiring7 }} истекают</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-xl font-extrabold">{{ overview.money.conversion }}%</div>
          <div class="text-xs text-slate-500">конверсия в оплату · {{ overview.users.paid }} платящих</div>
        </div>
        <div class="glass rounded-2xl p-4">
          <div class="text-xl font-extrabold">{{ money(overview.money.mrr) }}</div>
          <div class="text-xs text-slate-500">оценка MRR · ARPU {{ money(overview.money.arpu) }}</div>
        </div>
      </div>

      <div v-if="attention.length" class="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm space-y-1.5">
        <div class="text-amber-500 font-semibold">Требует внимания</div>
        <router-link v-for="a in attention" :key="a.text" :to="a.to" class="block hover:underline underline-offset-2" :class="a.tone === 'red' ? 'text-red-500' : ''">
          • {{ a.text }} →
        </router-link>
      </div>
      <div v-else class="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
        Всё в порядке: зависших оплат, горящих подписок и упавших заданий нет.
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 class="font-display font-semibold">Динамика</h3>
            <p class="text-xs text-slate-500">Всего за период: <b class="text-slate-700 dark:text-slate-200">{{ metricLabel }}</b></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <div class="flex rounded-xl border border-slate-200 dark:border-white/10 p-0.5">
              <button v-for="(m, key) in METRICS" :key="key" class="px-3 py-1.5 rounded-lg text-xs transition"
                :class="metric === key ? 'bg-brand-500/20 font-semibold' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'"
                @click="metric = key">{{ m.label }}</button>
            </div>
            <div class="flex rounded-xl border border-slate-200 dark:border-white/10 p-0.5">
              <button v-for="d in [30, 90]" :key="d" class="px-3 py-1.5 rounded-lg text-xs transition"
                :class="chartDays === d ? 'bg-brand-500/20 font-semibold' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5'"
                @click="chartDays = d">{{ d }} дн.</button>
            </div>
          </div>
        </div>
        <div :class="chartLoading ? 'opacity-50 transition' : ''">
          <LineChart :points="series" :value-key="metric" :label="METRICS[metric].label" :color="METRICS[metric].color" />
        </div>
      </div>
    </template>

    <div class="grid lg:grid-cols-2 gap-5">
      <div class="glass rounded-2xl p-5">
        <div class="flex items-center justify-between gap-3 mb-3">
          <h3 class="font-display font-semibold">Последние платежи</h3>
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

      <div class="glass rounded-2xl p-5">
        <h3 class="font-display font-semibold mb-3">Здоровье сервиса</h3>
        <div v-if="health" class="grid grid-cols-2 gap-3 text-sm">
          <div><div class="text-xs text-slate-500">Аптайм</div><div class="font-semibold">{{ fmtUptime(health.uptime) }}</div></div>
          <div><div class="text-xs text-slate-500">Память</div><div class="font-semibold">{{ fmtBytes(health.rss) }}</div></div>
          <div><div class="text-xs text-slate-500">База данных</div><div class="font-semibold">{{ fmtBytes(health.dbSize) }}</div></div>
          <div><div class="text-xs text-slate-500">Файлы заданий</div><div class="font-semibold">{{ fmtBytes(health.jobsSize) }}</div></div>
          <div><div class="text-xs text-slate-500">Свободно на диске</div><div class="font-semibold">{{ health.disk ? fmtBytes(health.disk.free) + ' (' + diskFreePercent + '%)' : '—' }}</div></div>
          <div><div class="text-xs text-slate-500">Очередь</div><div class="font-semibold">{{ health.jobs.queued || 0 }} в очереди · {{ health.jobs.error || 0 }} с ошибкой</div></div>
        </div>
        <div v-if="health" class="flex flex-wrap gap-2 mt-4">
          <span v-for="(on, name) in health.integrations" :key="name" class="chip-soon"
            :class="on ? '!text-emerald-500 !border-emerald-500/30 !bg-emerald-500/10' : '!text-slate-400 !border-slate-400/30 !bg-slate-400/10'">
            {{ name }}: {{ on ? 'ок' : 'нет' }}
          </span>
        </div>
      </div>
    </div>

    <div class="glass rounded-2xl p-5">
      <div class="flex items-center justify-between gap-3 mb-3">
        <h3 class="font-display font-semibold">
          Отзывы на модерации
          <span v-if="pendingReviews.length" class="chip-soon ml-2 !text-amber-500 !border-amber-500/30 !bg-amber-500/10">{{ pendingReviews.length }}</span>
        </h3>
      </div>
      <p v-if="!pendingReviews.length" class="text-sm text-slate-500">Новых отзывов нет — всё проверено.</p>
      <div v-for="r in pendingReviews.slice(0, 3)" :key="r.id" class="py-3 border-b border-slate-100 dark:border-white/5 last:border-0">
        <div class="flex items-center gap-2 text-sm">
          <span class="flex gap-0.5 text-amber-500"><BrandIcon v-for="i in 5" :key="i" :name="i <= r.rating ? 'star-filled' : 'star'" :size="14" /></span>
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
</template>
