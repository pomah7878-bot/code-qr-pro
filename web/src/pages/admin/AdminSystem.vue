<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../../api.js';
import { fmtDateTime } from '../../lib/format.js';
import BrandIcon from '../../components/BrandIcon.vue';

const data = ref(null);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const busy = ref(false);
const confirmMaintenance = ref(false);

const fmtBytes = (b) => {
  const n = Number(b) || 0;
  if (!n) return '0';
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
};
const fmtUptime = (s) => {
  const d = Math.floor(Number(s || 0) / 86400);
  const h = Math.floor((Number(s || 0) % 86400) / 3600);
  if (d) return `${d} д ${h} ч`;
  return `${h} ч`;
};
const pct = (v) => Math.min(100, Math.max(0, Math.round(Number(v) || 0)));
const integrationLabel = (key) => ({
  sqlite: 'SQLite', smtp: 'SMTP', yookassa: 'ЮKassa', telegram: 'Telegram',
  cz: 'Честный ЗНАК', npd: 'Чеки НПД', npdEnabled: 'НПД включён'
}[key] || key);
const integrationOk = (key, value) => key === 'npdEnabled' ? true : Boolean(value);
const integrationText = (key, value) => key === 'npdEnabled' ? `НПД: ${value ? 'включён' : 'выключен'}` : `${integrationLabel(key)}: ${integrationOk(key, value) ? 'ок' : 'нет'}`;
const integrationClass = (key, value) => key === 'npdEnabled' ? 'border-slate-500/30 bg-slate-500/10 text-slate-500' : (integrationOk(key, value) ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-500');
const alertClass = (level) => level === 'red' ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400';
const diskPercent = computed(() => data.value?.disk?.percent || 0);
const memPercent = computed(() => {
  const p = data.value?.process;
  if (!p?.totalMem) return 0;
  return Math.round(((p.totalMem - p.freeMem) / p.totalMem) * 100);
});

async function load() {
  loading.value = true; error.value = '';
  try { data.value = await api.adminSystemStatus(); }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function toggleMaintenance() {
  if (!data.value) return;
  const enabled = !data.value.maintenance;
  if (enabled && !window.confirm('Включить режим обслуживания? Сайт и кабинет будут недоступны клиентам до выключения.')) return;
  busy.value = true; error.value = ''; notice.value = '';
  try {
    const r = await api.adminSetMaintenance(enabled);
    data.value.maintenance = r.enabled;
    notice.value = r.enabled ? 'Режим обслуживания включён' : 'Режим обслуживания выключен';
    await load();
  } catch (e) { error.value = e.message; }
  finally { busy.value = false; confirmMaintenance.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-display font-semibold text-lg">Система и эксплуатация</h2>
        <p class="text-xs text-slate-500 mt-0.5">Ресурсы сервера, интеграции, очередь, ошибки и состояние резервных копий.</p>
      </div>
      <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" data-tooltip="Обновить состояние сервера и интеграций" @click="load">
        <BrandIcon name="refresh" :size="15" class="inline-block mr-1 -mt-0.5" />{{ loading ? 'Обновляем…' : 'Обновить' }}
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
    <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

    <div v-if="data?.alerts?.length" class="space-y-2">
      <router-link v-for="(a, i) in data.alerts" :key="i" :to="a.to || '/app/admin/system'" class="block rounded-xl border p-3 text-sm hover:underline" :class="alertClass(a.level)">
        {{ a.text }} →
      </router-link>
    </div>
    <div v-else-if="data" class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-400">
      Критичных проблем не обнаружено.
    </div>

    <div v-if="data" class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
      <div class="glass rounded-2xl p-4">
        <div class="text-xs text-slate-500">Аптайм процесса</div>
        <div class="text-xl font-extrabold mt-1">{{ fmtUptime(data.process.uptime) }}</div>
        <div class="text-[11px] text-slate-500 mt-1">Node {{ data.process.node }} · PID {{ data.process.pid }}</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xs text-slate-500">Память</div>
        <div class="text-xl font-extrabold mt-1">{{ fmtBytes(data.process.rss) }}</div>
        <div class="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 mt-2 overflow-hidden"><div class="h-full bg-brand-500" :style="{ width: pct(memPercent) + '%' }"></div></div>
        <div class="text-[11px] text-slate-500 mt-1">занято {{ memPercent }}% RAM</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xs text-slate-500">Диск</div>
        <div class="text-xl font-extrabold mt-1">{{ fmtBytes(data.disk?.free) }}</div>
        <div class="h-1.5 rounded-full bg-slate-200 dark:bg-white/10 mt-2 overflow-hidden"><div class="h-full" :class="diskPercent >= 85 ? 'bg-red-500' : 'bg-emerald-500'" :style="{ width: pct(diskPercent) + '%' }"></div></div>
        <div class="text-[11px] text-slate-500 mt-1">занято {{ diskPercent }}%</div>
      </div>
      <div class="glass rounded-2xl p-4">
        <div class="text-xs text-slate-500">База данных</div>
        <div class="text-xl font-extrabold mt-1">{{ fmtBytes(data.db.size) }}</div>
        <div class="text-[11px] text-slate-500 mt-1">WAL {{ fmtBytes(data.db.wal) }} · схема v{{ data.db.userVersion }}</div>
      </div>
    </div>

    <div v-if="data" class="grid lg:grid-cols-2 gap-4">
      <div class="glass rounded-2xl p-5">
        <div class="font-semibold mb-3">Интеграции</div>
        <div class="flex flex-wrap gap-2">
          <span v-for="(value, key) in data.integrations" :key="key" class="px-2.5 py-1.5 rounded-lg text-xs border"
            :class="integrationClass(key, value)">
            {{ integrationText(key, value) }}
          </span>
        </div>
        <div class="mt-4 pt-3 border-t border-slate-200/70 dark:border-white/10 text-xs text-slate-500">
          За сутки: {{ data.external.total }} внешних запросов · {{ data.external.failed }} ошибок · {{ data.external.costUnits }} cost units
        </div>
        <div class="mt-2 space-y-1 text-xs">
          <div v-for="a in data.external.adapters" :key="a.adapter" class="flex justify-between gap-2"><span class="font-mono">{{ a.adapter }}</span><span :class="a.failed ? 'text-red-500' : 'text-slate-500'">{{ a.total }}{{ a.failed ? ' · ошибок ' + a.failed : '' }}</span></div>
        </div>
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="font-semibold">Очередь и счётчики</div>
          <router-link to="/app/admin/jobs" class="text-xs text-brand-400 hover:underline">Задания →</router-link>
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div><div class="text-xs text-slate-500">В очереди</div><div class="font-semibold">{{ data.counts.jobsQueued }}</div></div>
          <div><div class="text-xs text-slate-500">Выполняется</div><div class="font-semibold">{{ data.counts.jobsRunning }}</div></div>
          <div><div class="text-xs text-slate-500">С ошибкой</div><div class="font-semibold text-red-500">{{ data.counts.jobsError }}</div></div>
          <div><div class="text-xs text-slate-500">Ожидают оплаты</div><div class="font-semibold text-amber-500">{{ data.counts.ordersPending }}</div></div>
          <div><div class="text-xs text-slate-500">Обращений</div><div class="font-semibold">{{ data.counts.supportOpen }}</div></div>
          <div><div class="text-xs text-slate-500">Отзывов на модерации</div><div class="font-semibold">{{ data.counts.reviewsPending }}</div></div>
          <div><div class="text-xs text-slate-500">Несопоставленных платежей</div><div class="font-semibold">{{ data.counts.bankUnmatched }}</div></div>
          <div><div class="text-xs text-slate-500">Ошибок чеков НПД</div><div class="font-semibold" :class="data.counts.npdErrors ? 'text-red-500' : ''">{{ data.counts.npdErrors }}</div></div>
        </div>
      </div>
    </div>

    <div v-if="data" class="grid lg:grid-cols-2 gap-4">
      <div class="glass rounded-2xl p-5">
        <div class="flex items-center justify-between gap-3 mb-3">
          <div class="font-semibold">Резервные копии</div>
          <span class="text-xs" :class="data.backups.ok ? 'text-emerald-500' : 'text-amber-500'">{{ data.backups.ok ? 'свежий бэкап есть' : 'нет свежего бэкапа' }}</span>
        </div>
        <div v-if="data.backups.latest" class="text-sm">
          Последний: <b>{{ data.backups.latest.name }}</b>
          <div class="text-xs text-slate-500">{{ fmtDateTime(data.backups.latest.at) }} · {{ fmtBytes(data.backups.latest.size) }} · возраст {{ data.backups.ageHours }} ч</div>
        </div>
        <div v-else class="text-sm text-amber-500">Файлы бэкапа не найдены. Проверьте cron и права на каталог.</div>
        <div class="mt-3 text-xs text-slate-500 font-mono whitespace-pre-wrap max-h-24 overflow-auto">{{ data.backups.log || 'Лог бэкапа недоступен' }}</div>
      </div>

      <div class="glass rounded-2xl p-5">
        <div class="font-semibold mb-3">Режим обслуживания</div>
        <p class="text-xs text-slate-500 mb-3">Клиенты получат страницу обслуживания; здоровье API и вебхуки останутся доступны. Режим автоматически выключится через 60 минут.</p>
        <div class="flex items-center gap-3">
          <button class="btn-primary !py-2 text-sm" :disabled="busy" :data-tooltip="data.maintenance ? 'Выключить режим обслуживания' : 'Включить режим обслуживания'" @click="toggleMaintenance">
            {{ data.maintenance ? 'Выключить обслуживание' : 'Включить обслуживание' }}
          </button>
          <span class="text-xs" :class="data.maintenance ? 'text-amber-500' : 'text-slate-500'">{{ data.maintenance ? 'включён до ' + fmtDateTime(data.maintenanceUntil) : 'выключен' }}</span>
        </div>
      </div>
    </div>

    <div v-if="data" class="glass rounded-2xl p-5">
      <div class="font-semibold mb-3">Последние ошибки</div>
      <div v-if="!data.errors.length" class="text-sm text-slate-500">Ошибок нет.</div>
      <div v-else class="space-y-2">
        <div v-for="e in data.errors" :key="e.id" class="text-xs border-b border-slate-100 dark:border-white/5 pb-2 last:border-0">
          <div class="flex flex-wrap gap-2"><span class="font-semibold">{{ e.source }}</span><span class="text-slate-500">{{ fmtDateTime(e.created_at) }}</span><span class="text-slate-500">{{ e.event }}</span></div>
          <div class="text-slate-600 dark:text-slate-300">{{ e.message }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
