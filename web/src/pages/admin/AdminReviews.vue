<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import BrandIcon from '../../components/BrandIcon.vue';

const rows = ref([]);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const filter = ref('all');
const busy = ref(0);

const counts = computed(() => ({
  all: rows.value.length,
  pending: rows.value.filter((r) => r.status === 'pending').length,
  approved: rows.value.filter((r) => r.status === 'approved').length,
  hidden: rows.value.filter((r) => r.status === 'hidden').length
}));
const filtered = computed(() => filter.value === 'all' ? rows.value : rows.value.filter((r) => r.status === filter.value));
const statusLabel = (s) => ({ pending: 'На модерации', approved: 'Опубликован', hidden: 'Скрыт' }[s] || s);
const statusClass = (s) => s === 'approved' ? 'text-emerald-500' : s === 'pending' ? 'text-amber-500' : 'text-slate-500';

async function load() {
  loading.value = true; error.value = '';
  try { rows.value = (await api.adminReviews()).reviews || []; }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function moderate(r, status) {
  busy.value = r.id; error.value = ''; notice.value = '';
  try {
    await api.adminModerateReview(r.id, { status });
    notice.value = `Отзыв №${r.id}: ${statusLabel(status).toLowerCase()}`;
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = 0; }
}

async function remove(r) {
  if (!window.confirm(`Удалить отзыв №${r.id} навсегда?`)) return;
  busy.value = r.id; error.value = ''; notice.value = '';
  try {
    await api.deleteReview(r.id);
    notice.value = `Отзыв №${r.id} удалён`;
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = 0; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold text-lg">Отзывы</h2>
        <p class="text-xs text-slate-500 mt-0.5">Модерация отзывов клиентов: публикация, скрытие и удаление.</p>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" data-tooltip="Обновить список отзывов" @click="load">
        <BrandIcon name="refresh" :size="15" class="inline-block mr-1 -mt-0.5" />{{ loading ? 'Обновляем…' : 'Обновить' }}
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="flex flex-wrap gap-2">
      <button v-for="f in [['all','Все'],['pending','На модерации'],['approved','Опубликованные'],['hidden','Скрытые']]" :key="f[0]"
        class="px-3 py-1.5 rounded-lg text-sm border transition"
        :class="filter === f[0] ? 'bg-brand-500/15 border-brand-500/40 text-brand-400 font-semibold' : 'border-slate-200 dark:border-white/10 text-slate-500'"
        @click="filter = f[0]">{{ f[1] }} <span class="text-xs opacity-70">{{ counts[f[0]] }}</span></button>
    </div>

    <div class="glass rounded-2xl overflow-hidden">
      <div v-if="!filtered.length" class="p-8 text-center text-sm text-slate-500">Отзывов нет.</div>
      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
            <th class="py-3 px-4 font-medium">№</th><th class="py-3 px-4 font-medium">Клиент</th><th class="py-3 px-4 font-medium">Оценка</th><th class="py-3 px-4 font-medium">Отзыв</th><th class="py-3 px-4 font-medium">Статус</th><th class="py-3 px-4 font-medium">Действия</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" class="border-b border-slate-100 dark:border-white/5 last:border-0 align-top">
              <td class="py-3 px-4 text-slate-500">{{ r.id }}</td>
              <td class="py-3 px-4"><div>{{ r.author_name || 'Клиент' }}</div><div class="text-[11px] text-slate-500">{{ r.email }}</div></td>
              <td class="py-3 px-4 whitespace-nowrap"><span class="text-amber-500">{{ '★'.repeat(Number(r.rating) || 0) }}</span><span class="text-slate-300 dark:text-white/20">{{ '★'.repeat(5 - (Number(r.rating) || 0)) }}</span></td>
              <td class="py-3 px-4 max-w-[380px]"><div class="whitespace-pre-wrap line-clamp-4">{{ r.text }}</div><div class="text-[11px] text-slate-500 mt-1">{{ fmtDateTime(r.created_at) }}</div></td>
              <td class="py-3 px-4"><span class="text-xs font-semibold" :class="statusClass(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td class="py-3 px-4">
                <div class="flex flex-wrap gap-1.5">
                  <button v-if="r.status !== 'approved'" class="btn-ghost !py-1 !px-2.5 text-xs text-emerald-500" :disabled="busy === r.id" data-tooltip="Опубликовать отзыв на сайте" @click="moderate(r, 'approved')">Одобрить</button>
                  <button v-if="r.status !== 'hidden'" class="btn-ghost !py-1 !px-2.5 text-xs text-amber-500" :disabled="busy === r.id" data-tooltip="Скрыть отзыв с сайта" @click="moderate(r, 'hidden')">Скрыть</button>
                  <button v-if="r.status !== 'pending'" class="btn-ghost !py-1 !px-2.5 text-xs" :disabled="busy === r.id" data-tooltip="Вернуть отзыв на модерацию" @click="moderate(r, 'pending')">На модерацию</button>
                  <button class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" :disabled="busy === r.id" data-tooltip="Удалить отзыв навсегда" @click="remove(r)">Удалить</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
