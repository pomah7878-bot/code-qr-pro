<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { formatArchiveSize } from '../../lib/planFeatures.js';

const data = ref(null);
const loading = ref(true);
const error = ref('');
const q = ref('');
const sort = ref('disk');

const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} Б`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} КБ`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} МБ`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
};
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const totals = computed(() => data.value?.totals || {});
const users = computed(() => {
  const list = [...(data.value?.users || [])];
  const needle = q.value.trim().toLowerCase();
  const filtered = needle ? list.filter((u) => `${u.email} ${u.name}`.toLowerCase().includes(needle)) : list;
  return filtered.sort((a, b) => (sort.value === 'db' ? b.dbBytes - a.dbBytes : b.diskBytes - a.diskBytes));
});
const diskPct = computed(() => {
  const t = totals.value;
  return t.diskTotal ? Math.round((t.diskTotal - t.diskFree) / t.diskTotal * 100) : 0;
});
const mismatch = computed(() => Math.abs(Number(totals.value.diskBytes || 0) - Number(totals.value.localDbBytes || 0)));

async function load() {
  loading.value = true; error.value = '';
  try { data.value = await api.adminStorageAnalytics(); }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

function exportCsv() {
  const rows = [['Клиент', 'Email', 'Тариф', 'Заданий', 'Архивов', 'По БД, байт', 'На диске, байт', 'Квота', 'Последний архив']];
  for (const u of users.value) rows.push([u.name || '', u.email, u.plan, u.jobs, u.archives, u.dbBytes, u.diskBytes, formatArchiveSize(u.quotaMb), u.lastArchived || '']);
  const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `storage-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

onMounted(load);
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-bold text-xl">Хранилище клиентов</h2>
        <p class="text-xs text-slate-500 mt-1">Сколько занимают архивы на сервере и в S3. Данные обновляются раз в 10 секунд.</p>
      </div>
      <div class="flex gap-2">
        <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" @click="load">↻ Обновить</button>
        <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="!users.length" @click="exportCsv">CSV</button>
      </div>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="loading" class="text-sm text-slate-500">Считаем размеры архивов…</p>

    <template v-if="data">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ fmtBytes(totals.diskBytes) }}</div><div class="text-xs text-slate-500 mt-1">на диске сервера</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ fmtBytes(totals.s3Bytes) }}</div><div class="text-xs text-slate-500 mt-1">в S3/R2</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ totals.diskFiles }}</div><div class="text-xs text-slate-500 mt-1">файлов архивов</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ totals.clients }}</div><div class="text-xs text-slate-500 mt-1">клиентов с историей</div></div>
      </div>

      <div class="glass rounded-2xl p-5 text-xs text-slate-500">
        <div class="flex flex-wrap justify-between gap-2 mb-2">
          <span>Диск сервера: занято {{ diskPct }}%</span>
          <span>Свободно {{ fmtBytes(totals.diskFree) }} из {{ fmtBytes(totals.diskTotal) }}</span>
        </div>
        <div class="h-2.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500" :style="{ width: diskPct + '%' }"></div>
        </div>
        <div class="flex flex-wrap gap-x-5 gap-y-1 mt-2">
          <span>В базе: {{ fmtBytes(totals.dbBytes) }}</span>
          <span>Локально по БД: {{ fmtBytes(totals.localDbBytes) }}</span>
          <span v-if="mismatch > 1024" class="text-amber-500">Расхождение с диском: {{ fmtBytes(mismatch) }}</span>
          <span v-if="totals.orphanBytes" class="text-amber-500">Файлы без записи в БД: {{ fmtBytes(totals.orphanBytes) }}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <input v-model="q" class="input !py-2 text-sm max-w-xs" placeholder="Поиск по клиенту или email">
        <select v-model="sort" class="input !py-2 text-sm w-52">
          <option value="disk">Сортировка: на диске</option>
          <option value="db">Сортировка: по базе</option>
        </select>
      </div>

      <div class="glass rounded-2xl overflow-x-auto">
        <table class="w-full text-sm min-w-[820px]">
          <thead>
            <tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="p-3">Клиент</th>
              <th class="p-3">Тариф</th>
              <th class="p-3">Заданий</th>
              <th class="p-3">Архивов</th>
              <th class="p-3">На диске</th>
              <th class="p-3">В базе</th>
              <th class="p-3">Квота</th>
              <th class="p-3">Последний</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u.id" class="border-b border-slate-100 dark:border-white/5">
              <td class="p-3">
                <router-link :to="`/app/admin/users/${u.id}`" class="font-medium hover:text-brand-400">{{ u.name || u.email }}</router-link>
                <div class="text-xs text-slate-500">{{ u.email }}</div>
              </td>
              <td class="p-3"><span class="text-xs uppercase">{{ u.plan }}</span></td>
              <td class="p-3">{{ u.jobs }}</td>
              <td class="p-3">{{ u.archives }}</td>
              <td class="p-3 font-mono text-xs">{{ fmtBytes(u.diskBytes) }}<div class="text-slate-500">{{ u.diskFiles }} файлов</div></td>
              <td class="p-3 font-mono text-xs">{{ fmtBytes(u.dbBytes) }}</td>
              <td class="p-3 min-w-[140px]">
                <div class="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-brand-500" :style="{ width: u.quotaPct + '%' }"></div></div>
                <div class="text-[11px] text-slate-500 mt-1">{{ u.quotaPct }}% из {{ formatArchiveSize(u.quotaMb) }}</div>
              </td>
              <td class="p-3 text-xs text-slate-500">{{ fmtDate(u.lastArchived) }}</td>
            </tr>
            <tr v-if="!users.length"><td colspan="8" class="p-6 text-center text-slate-500">Архивов пока нет.</td></tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>
