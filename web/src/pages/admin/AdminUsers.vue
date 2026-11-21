<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, qs } from '../../api.js';
import { fmtDate, money } from '../../lib/format.js';

const router = useRouter();
const filters = reactive({ q: '', plan: '', role: '', status: '', page: 1 });
const data = ref({ users: [], total: 0, page: 1, pages: 1 });
const loading = ref(false);
const error = ref('');
let timer = null;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminUsers({ ...filters, per: 25 });
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

watch(() => [filters.q, filters.plan, filters.role, filters.status], () => {
  clearTimeout(timer);
  timer = setTimeout(applyFilters, 300);
});

function go(page) {
  filters.page = Math.min(Math.max(1, page), data.value.pages || 1);
  load();
}

function reset() {
  filters.q = '';
  filters.plan = '';
  filters.role = '';
  filters.status = '';
  applyFilters();
}

function exportCsv() {
  window.open('/api/admin/users/export.csv' + qs({
    q: filters.q, plan: filters.plan, role: filters.role, status: filters.status
  }), '_blank');
}

function openUser(u) {
  router.push('/app/admin/users/' + u.id);
}

const showFrom = () => (data.value.total ? (data.value.page - 1) * data.value.per + 1 : 0);
const showTo = () => Math.min(data.value.page * data.value.per, data.value.total);

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold text-lg">Клиенты</h2>
        <p class="text-xs text-slate-500 mt-0.5">Поиск, тариф и статус. Нажми на строку, чтобы открыть карточку.</p>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="exportCsv">↓ Экспорт CSV</button>
    </div>

    <div class="glass rounded-2xl p-4 grid sm:grid-cols-2 lg:grid-cols-[1fr_150px_150px_150px_auto] gap-3 items-end">
      <div>
        <label class="label !text-xs" for="admin-user-q">Поиск</label>
        <input id="admin-user-q" v-model="filters.q" class="input !py-2 text-sm" placeholder="Email, имя или ID" autocomplete="off">
      </div>
      <div>
        <label class="label !text-xs" for="admin-user-plan">Тариф</label>
        <select id="admin-user-plan" v-model="filters.plan" class="input !py-2 text-sm">
          <option value="">Все</option>
          <option value="free">FREE</option>
          <option value="start">START</option>
          <option value="pro">PRO</option>
          <option value="business">BUSINESS</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="admin-user-role">Роль</label>
        <select id="admin-user-role" v-model="filters.role" class="input !py-2 text-sm">
          <option value="">Все</option>
          <option value="user">Клиент</option>
          <option value="support">Поддержка</option>
          <option value="admin">Администратор</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="admin-user-status">Статус</label>
        <select id="admin-user-status" v-model="filters.status" class="input !py-2 text-sm">
          <option value="">Все</option>
          <option value="active">Активен</option>
          <option value="blocked">Заблокирован</option>
        </select>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="reset">Сбросить</button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

    <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">ID</th>
              <th class="py-3 px-4 font-medium">Клиент</th>
              <th class="py-3 px-4 font-medium hidden md:table-cell">Роль</th>
              <th class="py-3 px-4 font-medium">Тариф</th>
              <th class="py-3 px-4 font-medium hidden lg:table-cell">Кодов сегодня</th>
              <th class="py-3 px-4 font-medium hidden lg:table-cell">Оплачено</th>
              <th class="py-3 px-4 font-medium hidden sm:table-cell">Регистрация</th>
              <th class="py-3 px-4 font-medium">Статус</th>
              <th class="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !data.users.length">
              <td colspan="9" class="py-8 text-center text-slate-500">Загрузка…</td>
            </tr>
            <tr v-else-if="!data.users.length">
              <td colspan="9" class="py-8 text-center text-slate-500">Никого не нашли — измени поиск или фильтры.</td>
            </tr>
            <tr
              v-for="u in data.users" :key="u.id"
              class="border-b border-slate-100 dark:border-white/5 last:border-0 cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 transition"
              @click="openUser(u)">
              <td class="py-3 px-4 text-slate-500">{{ u.id }}</td>
              <td class="py-3 px-4">
                <div class="font-medium truncate max-w-[220px]">{{ u.email }}</div>
                <div class="text-xs text-slate-500 truncate max-w-[220px]">{{ u.name || '—' }}</div>
              </td>
              <td class="py-3 px-4 hidden md:table-cell">
                <span v-if="u.role !== 'user'" class="chip-soon">{{ u.role }}</span>
                <span v-else class="text-slate-400">—</span>
              </td>
              <td class="py-3 px-4">
                <div class="font-semibold" :class="u.plan !== 'free' ? 'grad-text' : ''">{{ u.plan.toUpperCase() }}</div>
                <div v-if="u.premium_until" class="text-[11px] text-slate-500">до {{ fmtDate(u.premium_until) }}</div>
              </td>
              <td class="py-3 px-4 hidden lg:table-cell">{{ u.codes_today }}</td>
              <td class="py-3 px-4 hidden lg:table-cell">
                <div>{{ money(u.paid_total) }}</div>
                <div class="text-[11px] text-slate-500">{{ u.paid_orders }} {{ u.paid_orders === 1 ? 'заказ' : 'заказов' }}</div>
              </td>
              <td class="py-3 px-4 hidden sm:table-cell text-slate-500">{{ fmtDate(u.created_at) }}</td>
              <td class="py-3 px-4">
                <span class="text-xs font-semibold" :class="u.status === 'blocked' ? 'text-red-500' : 'text-emerald-500'">
                  {{ u.status === 'blocked' ? 'Заблокирован' : 'Активен' }}
                </span>
              </td>
              <td class="py-3 px-4 text-right">
                <button class="btn-ghost !py-1 !px-2.5 text-xs" :aria-label="'Открыть ' + u.email" @click.stop="openUser(u)">Открыть</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 text-sm">
      <span class="text-slate-500">Показано {{ showFrom() }}–{{ showTo() }} из {{ data.total }}</span>
      <div class="flex items-center gap-2">
        <button class="btn-ghost !py-1.5 !px-3 text-sm" :disabled="filters.page <= 1" @click="go(filters.page - 1)">← Назад</button>
        <span class="text-slate-500">{{ data.page }} / {{ data.pages }}</span>
        <button class="btn-ghost !py-1.5 !px-3 text-sm" :disabled="filters.page >= data.pages" @click="go(filters.page + 1)">Вперёд →</button>
      </div>
    </div>
  </div>
</template>
