<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';

const filters = reactive({ q: '', status: '', page: 1 });
const data = ref({ jobs: [], total: 0, page: 1, pages: 1 });
const loading = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(0);
let timer = null;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminJobs({ ...filters, per: 25 });
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

watch(() => filters.q, () => {
  clearTimeout(timer);
  timer = setTimeout(applyFilters, 300);
});
watch(() => filters.status, applyFilters);

function go(page) {
  filters.page = Math.min(Math.max(1, page), data.value.pages || 1);
  load();
}

async function retry(job) {
  if (!window.confirm(`Перезапустить задание №${job.id}? Прогресс начнётся заново.`)) return;
  busy.value = job.id;
  error.value = '';
  try {
    await api.adminRetryJob(job.id);
    notice.value = `Задание №${job.id} поставлено в очередь`;
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = 0; }
}

async function remove(job) {
  if (!window.confirm(`Удалить задание №${job.id} вместе с файлами? Действие необратимо.`)) return;
  busy.value = job.id;
  error.value = '';
  try {
    await api.adminDeleteJob(job.id);
    notice.value = `Задание №${job.id} удалено`;
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = 0; }
}

const statusClass = (s) => (s === 'done' ? 'text-emerald-500'
  : s === 'error' ? 'text-red-500'
    : s === 'running' ? 'text-brand-400' : 'text-slate-400');
const STATUS = { queued: 'В очереди', running: 'Генерация', done: 'Готово', error: 'Ошибка' };

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="font-display font-semibold text-lg">Задания</h2>
      <p class="text-xs text-slate-500 mt-0.5">Очередь генерации по всем клиентам. Перезапуск и удаление — с подтверждением.</p>
    </div>

    <div class="glass rounded-2xl p-4 grid sm:grid-cols-2 lg:grid-cols-[1fr_180px_auto] gap-3 items-end">
      <div>
        <label class="label !text-xs" for="job-q">Поиск</label>
        <input id="job-q" v-model="filters.q" class="input !py-2 text-sm" placeholder="Email, название или номер" autocomplete="off">
      </div>
      <div>
        <label class="label !text-xs" for="job-status">Статус</label>
        <select id="job-status" v-model="filters.status" class="input !py-2 text-sm">
          <option value="">Все</option>
          <option value="queued">В очереди</option>
          <option value="running">Генерация</option>
          <option value="done">Готово</option>
          <option value="error">Ошибка</option>
        </select>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="filters.q = ''; filters.status = ''">Сбросить</button>
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
              <th class="py-3 px-4 font-medium">Задание</th>
              <th class="py-3 px-4 font-medium hidden md:table-cell">Формат</th>
              <th class="py-3 px-4 font-medium">Готово</th>
              <th class="py-3 px-4 font-medium">Статус</th>
              <th class="py-3 px-4 font-medium hidden lg:table-cell">Создано</th>
              <th class="py-3 px-4 font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !data.jobs.length">
              <td colspan="8" class="py-8 text-center text-slate-500">Загрузка…</td>
            </tr>
            <tr v-else-if="!data.jobs.length">
              <td colspan="8" class="py-8 text-center text-slate-500">Заданий нет.</td>
            </tr>
            <tr v-for="j in data.jobs" :key="j.id" class="border-b border-slate-100 dark:border-white/5 last:border-0">
              <td class="py-3 px-4 text-slate-500">{{ j.id }}</td>
              <td class="py-3 px-4"><div class="truncate max-w-[200px]">{{ j.email }}</div></td>
              <td class="py-3 px-4">
                <div class="truncate max-w-[220px]">{{ j.name || 'Без названия' }}</div>
                <div v-if="j.error" class="text-[11px] text-red-500 truncate max-w-[220px]">{{ j.error }}</div>
              </td>
              <td class="py-3 px-4 hidden md:table-cell text-xs uppercase text-slate-500">{{ j.format }} · {{ j.mode }}</td>
              <td class="py-3 px-4">{{ j.done }} / {{ j.valid }}</td>
              <td class="py-3 px-4 text-xs font-semibold" :class="statusClass(j.status)">{{ STATUS[j.status] || j.status }}</td>
              <td class="py-3 px-4 hidden lg:table-cell text-slate-500">{{ fmtDateTime(j.created_at) }}</td>
              <td class="py-3 px-4">
                <div class="flex flex-wrap gap-1.5">
                  <button v-if="['done', 'error'].includes(j.status)" class="btn-ghost !py-1 !px-2.5 text-xs" :disabled="busy === j.id" @click="retry(j)">Повторить</button>
                  <button class="btn-ghost !py-1 !px-2.5 text-xs text-red-500" :disabled="busy === j.id" @click="remove(j)">Удалить</button>
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
  </div>
</template>
