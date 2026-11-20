<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import Modal from '../../components/admin/Modal.vue';
import BrandIcon from '../../components/BrandIcon.vue';

const data = ref({ logs: [], total: 0, page: 1, pages: 1, counts: {} });
const loading = ref(true);
const error = ref('');
const notice = ref('');
const filters = reactive({ level: '', source: '', q: '', days: 7, page: 1 });
const detail = reactive({ open: false, log: null, busy: false });

const levelClass = (level) => (level === 'error' ? 'text-red-500 border-red-500/30 bg-red-500/10'
  : level === 'warn' ? 'text-amber-500 border-amber-500/30 bg-amber-500/10'
    : 'text-slate-500 border-slate-300/40 bg-slate-500/10');
const sourceLabel = (s) => (s === 'client' ? 'клиент' : s === 'process' ? 'процесс' : 'сервер');

const errorsCount = computed(() => Number(data.value.counts?.error || 0));
const warnsCount = computed(() => Number(data.value.counts?.warn || 0));

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminLogs({ ...filters });
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

function goPage(page) {
  if (page < 1 || page > data.value.pages) return;
  filters.page = page;
  load();
}

async function openDetail(log) {
  detail.open = true;
  detail.log = log;
  try {
    const r = await api.adminLogDetail(log.id);
    detail.log = r.log;
  } catch { /* показываем строку из списка */ }
}

async function copyDiagnostics() {
  if (!detail.log) return;
  const l = detail.log;
  const text = [
    `CODE QR PRO — диагностика`,
    `Время: ${l.created_at} (UTC)`,
    `Уровень: ${l.level}`,
    `Источник: ${l.source}`,
    `Событие: ${l.event}`,
    `Сообщение: ${l.message}`,
    `Метод/URL: ${l.method} ${l.url}`,
    `Статус: ${l.status}`,
    `Пользователь: ${l.user_id ?? '—'}`,
    `IP: ${l.ip || '—'}`,
    `Request ID: ${l.request_id || '—'}`,
    `User-Agent: ${l.user_agent || '—'}`,
    `Meta: ${l.meta || '{}'}`,
    l.stack ? `Stack:\n${l.stack}` : ''
  ].filter(Boolean).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    notice.value = 'Диагностика скопирована';
  } catch {
    error.value = 'Не удалось скопировать — выделите текст вручную';
  }
}

async function exportCsv() {
  error.value = '';
  try {
    const res = await fetch(`/api/admin/logs/export.csv?days=${filters.days}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Не удалось выгрузить CSV');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `app-logs-${filters.days}d.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    notice.value = 'CSV скачан';
  } catch (e) {
    error.value = e.message;
  }
}

async function clearOld() {
  const days = Number(prompt('Удалить записи старше, дней:', '30'));
  if (!Number.isFinite(days) || days < 1) return;
  if (!window.confirm(`Удалить записи журнала старше ${days} дн.?`)) return;
  try {
    const r = await api.adminClearLogs(days);
    notice.value = `Удалено записей: ${r.removed}`;
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-bold text-xl">Журнал ошибок</h2>
        <p class="text-xs text-slate-500 mt-1">
          Серверные и клиентские ошибки, медленные запросы. Глубокий разбор — <code class="font-mono">journalctl -u code-qr</code>.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="load" :disabled="loading">{{ loading ? 'Обновляем…' : 'Обновить' }}</button>
        <button class="btn-ghost !py-2 !px-3 text-sm" @click="exportCsv">CSV за {{ filters.days }} дн.</button>
        <button class="btn-ghost !py-2 !px-3 text-sm text-red-500" @click="clearOld">Очистить старые</button>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 text-xs">
      <span class="chip-soon !text-red-500 !border-red-500/30 !bg-red-500/10">ошибок: {{ errorsCount }}</span>
      <span class="chip-soon !text-amber-500 !border-amber-500/30 !bg-amber-500/10">предупреждений: {{ warnsCount }}</span>
      <span class="chip-soon">всего за {{ filters.days }} дн.: {{ data.total }}</span>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div class="glass rounded-2xl p-4 flex flex-wrap items-end gap-2">
      <div>
        <label class="label !text-xs" for="logs-level">Уровень</label>
        <select id="logs-level" v-model="filters.level" class="input !py-2 text-sm" @change="applyFilters">
          <option value="">Все</option>
          <option value="error">Ошибки</option>
          <option value="warn">Предупреждения</option>
          <option value="info">Инфо</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="logs-source">Источник</label>
        <select id="logs-source" v-model="filters.source" class="input !py-2 text-sm" @change="applyFilters">
          <option value="">Все</option>
          <option value="server">Сервер</option>
          <option value="client">Клиент</option>
          <option value="process">Процесс</option>
        </select>
      </div>
      <div>
        <label class="label !text-xs" for="logs-days">Период</label>
        <select id="logs-days" v-model.number="filters.days" class="input !py-2 text-sm" @change="applyFilters">
          <option :value="1">1 день</option>
          <option :value="7">7 дней</option>
          <option :value="30">30 дней</option>
          <option :value="90">90 дней</option>
        </select>
      </div>
      <div class="flex-1 min-w-[200px]">
        <label class="label !text-xs" for="logs-q">Поиск</label>
        <input id="logs-q" v-model="filters.q" class="input !py-2 text-sm" placeholder="сообщение, URL, событие" @keyup.enter="applyFilters">
      </div>
      <button class="btn-primary !py-2 !px-4 text-sm" @click="applyFilters">Показать</button>
    </div>

    <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[760px]">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">Время</th>
              <th class="py-3 px-4 font-medium">Уровень</th>
              <th class="py-3 px-4 font-medium">Источник</th>
              <th class="py-3 px-4 font-medium">Сообщение</th>
              <th class="py-3 px-4 font-medium">Статус</th>
              <th class="py-3 px-4 font-medium">Пользователь</th>
              <th class="py-3 px-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !data.logs.length"><td colspan="7" class="py-8 px-4 text-center text-slate-500">Загружаем…</td></tr>
            <tr v-else-if="!data.logs.length"><td colspan="7" class="py-8 px-4 text-center text-slate-500">Записей нет — хороший знак.</td></tr>
            <tr v-for="l in data.logs" :key="l.id" class="border-b border-slate-100 dark:border-white/5 last:border-0 align-top hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer" @click="openDetail(l)">
              <td class="py-2.5 px-4 text-xs text-slate-500 whitespace-nowrap">{{ fmtDateTime(l.created_at) }}</td>
              <td class="py-2.5 px-4"><span class="chip-soon" :class="levelClass(l.level)">{{ l.level }}</span></td>
              <td class="py-2.5 px-4 text-xs">{{ sourceLabel(l.source) }}</td>
              <td class="py-2.5 px-4">
                <div class="text-sm line-clamp-2">{{ l.message }}</div>
                <div class="text-[11px] text-slate-500 truncate max-w-[420px]">{{ l.method }} {{ l.url }}</div>
              </td>
              <td class="py-2.5 px-4 text-xs">{{ l.status || '—' }}</td>
              <td class="py-2.5 px-4 text-xs text-slate-500">{{ l.user_id ?? '—' }}</td>
              <td class="py-2.5 px-4 text-right"><BrandIcon name="eye" :size="16" class="inline-block text-slate-400" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="data.pages > 1" class="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-200 dark:border-white/10 text-sm">
        <span class="text-xs text-slate-500">Страница {{ data.page }} из {{ data.pages }}</span>
        <div class="flex gap-2">
          <button class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="data.page <= 1" @click="goPage(data.page - 1)">Назад</button>
          <button class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="data.page >= data.pages" @click="goPage(data.page + 1)">Вперёд</button>
        </div>
      </div>
    </div>

    <Modal :open="detail.open" title="Запись журнала" max-width="max-w-2xl" @close="detail.open = false">
      <div v-if="detail.log" class="space-y-3 text-sm">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="chip-soon" :class="levelClass(detail.log.level)">{{ detail.log.level }}</span>
          <span class="chip-soon">{{ sourceLabel(detail.log.source) }}</span>
          <span class="text-slate-500">{{ fmtDateTime(detail.log.created_at) }} · ID {{ detail.log.id }}</span>
        </div>
        <p class="font-medium">{{ detail.log.message }}</p>
        <div class="text-xs text-slate-500 grid sm:grid-cols-2 gap-1">
          <div>Метод/URL: <code class="font-mono">{{ detail.log.method }} {{ detail.log.url }}</code></div>
          <div>Статус: {{ detail.log.status || '—' }}</div>
          <div>Пользователь: {{ detail.log.user_id ?? '—' }}</div>
          <div>IP: {{ detail.log.ip || '—' }}</div>
          <div>Request ID: <code class="font-mono">{{ detail.log.request_id || '—' }}</code></div>
          <div class="truncate">UA: {{ detail.log.user_agent || '—' }}</div>
        </div>
        <div v-if="detail.log.stack">
          <div class="label !text-xs">Stack trace</div>
          <pre class="text-[11px] leading-relaxed whitespace-pre-wrap break-all rounded-xl bg-slate-100 dark:bg-ink-900 p-3 max-h-56 overflow-auto">{{ detail.log.stack }}</pre>
        </div>
        <div v-if="detail.log.meta && detail.log.meta !== '{}'">
          <div class="label !text-xs">Дополнительно</div>
          <pre class="text-[11px] whitespace-pre-wrap break-all rounded-xl bg-slate-100 dark:bg-ink-900 p-3 max-h-40 overflow-auto">{{ detail.log.meta }}</pre>
        </div>
        <div class="flex justify-end gap-2 pt-2">
          <button class="btn-ghost !py-2 !px-3 text-sm" @click="copyDiagnostics">Скопировать диагностику</button>
          <button class="btn-primary !py-2 !px-4 text-sm" @click="detail.open = false">Закрыть</button>
        </div>
      </div>
    </Modal>
  </div>
</template>
