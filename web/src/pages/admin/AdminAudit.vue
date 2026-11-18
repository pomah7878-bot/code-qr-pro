<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import Modal from '../../components/admin/Modal.vue';

const filters = reactive({ action: '', actor: '', from: '', to: '', page: 1 });
const data = ref({ entries: [], actions: [], total: 0, page: 1, pages: 1 });
const loading = ref(false);
const error = ref('');
const detail = ref(null);
let timer = null;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    data.value = await api.adminAudit({ ...filters, per: 50 });
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

watch(() => filters.action, () => {
  clearTimeout(timer);
  timer = setTimeout(applyFilters, 300);
});
watch(() => filters.actor, () => {
  clearTimeout(timer);
  timer = setTimeout(applyFilters, 400);
});
watch(() => [filters.from, filters.to], applyFilters);

function go(page) {
  filters.page = Math.min(Math.max(1, page), data.value.pages || 1);
  load();
}

function reset() {
  filters.action = '';
  filters.actor = '';
  filters.from = '';
  filters.to = '';
  applyFilters();
}

const prettyMeta = computed(() => {
  if (!detail.value?.meta) return '';
  try { return JSON.stringify(JSON.parse(detail.value.meta), null, 2); } catch { return detail.value.meta; }
});

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="font-display font-semibold text-lg">Журнал действий</h2>
      <p class="text-xs text-slate-500 mt-0.5">Кто и что менял в админке. Хранится 365 дней, доступен только администратору.</p>
    </div>

    <div class="glass rounded-2xl p-4 grid sm:grid-cols-2 lg:grid-cols-[1fr_1fr_150px_150px_auto] gap-3 items-end">
      <div>
        <label class="label !text-xs" for="audit-action">Действие</label>
        <input id="audit-action" v-model="filters.action" class="input !py-2 text-sm" list="audit-actions" placeholder="user.grant, order.refund…">
        <datalist id="audit-actions">
          <option v-for="a in data.actions" :key="a.action" :value="a.action">{{ a.action }} ({{ a.c }})</option>
        </datalist>
      </div>
      <div>
        <label class="label !text-xs" for="audit-actor">Администратор</label>
        <input id="audit-actor" v-model="filters.actor" class="input !py-2 text-sm" placeholder="email" autocomplete="off">
      </div>
      <div>
        <label class="label !text-xs" for="audit-from">С даты</label>
        <input id="audit-from" v-model="filters.from" type="date" class="input !py-2 text-sm">
      </div>
      <div>
        <label class="label !text-xs" for="audit-to">По дату</label>
        <input id="audit-to" v-model="filters.to" type="date" class="input !py-2 text-sm">
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" @click="reset">Сбросить</button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>

    <div class="glass rounded-2xl overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-3 px-4 font-medium">Когда</th>
              <th class="py-3 px-4 font-medium">Кто</th>
              <th class="py-3 px-4 font-medium">Действие</th>
              <th class="py-3 px-4 font-medium hidden md:table-cell">Объект</th>
              <th class="py-3 px-4 font-medium hidden lg:table-cell">IP</th>
              <th class="py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !data.entries.length"><td colspan="6" class="py-8 text-center text-slate-500">Загрузка…</td></tr>
            <tr v-else-if="!data.entries.length"><td colspan="6" class="py-8 text-center text-slate-500">Записей нет.</td></tr>
            <tr v-for="e in data.entries" :key="e.id" class="border-b border-slate-100 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/5 transition">
              <td class="py-2.5 px-4 text-slate-500 whitespace-nowrap">{{ fmtDateTime(e.createdAt) }}</td>
              <td class="py-2.5 px-4">
                <div class="truncate max-w-[200px]">{{ e.actorEmail || '—' }}</div>
                <div class="text-[11px] text-slate-500">{{ e.actorRole || 'система' }}</div>
              </td>
              <td class="py-2.5 px-4"><span class="font-mono text-xs">{{ e.action }}</span></td>
              <td class="py-2.5 px-4 hidden md:table-cell text-slate-500">{{ e.targetType }}<span v-if="e.targetId"> #{{ e.targetId }}</span></td>
              <td class="py-2.5 px-4 hidden lg:table-cell text-slate-500 font-mono text-xs">{{ e.ip || '—' }}</td>
              <td class="py-2.5 px-4 text-right">
                <button class="btn-ghost !py-1 !px-2.5 text-xs" @click="detail = e">Детали</button>
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

    <Modal :open="Boolean(detail)" title="Запись журнала" max-width="max-w-2xl" @close="detail = null">
      <template v-if="detail">
        <dl class="grid grid-cols-[120px_1fr] gap-2 text-sm">
          <dt class="text-slate-500">Когда</dt><dd>{{ fmtDateTime(detail.createdAt) }}</dd>
          <dt class="text-slate-500">Кто</dt><dd>{{ detail.actorEmail || '—' }} ({{ detail.actorRole || 'система' }})</dd>
          <dt class="text-slate-500">Действие</dt><dd class="font-mono text-xs">{{ detail.action }}</dd>
          <dt class="text-slate-500">Объект</dt><dd>{{ detail.targetType }}<span v-if="detail.targetId"> #{{ detail.targetId }}</span></dd>
          <dt class="text-slate-500">IP</dt><dd class="font-mono text-xs">{{ detail.ip || '—' }}</dd>
        </dl>
        <div v-if="detail.meta && detail.meta !== '{}'" class="mt-4">
          <div class="text-xs text-slate-500 mb-1">Данные</div>
          <pre class="rounded-xl bg-slate-100 dark:bg-ink-900 border border-slate-200 dark:border-white/10 p-3 text-xs overflow-x-auto">{{ prettyMeta }}</pre>
        </div>
      </template>
    </Modal>
  </div>
</template>
