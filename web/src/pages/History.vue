<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { formatArchiveSize } from '../lib/planFeatures.js';
import SideNav from '../components/SideNav.vue';
import PageGuide from '../components/PageGuide.vue';
import BrandIcon from '../components/BrandIcon.vue';

const data = ref(null);
const loading = ref(true);
const error = ref('');
const notice = ref('');
const busyId = ref(null);
const tab = ref('jobs');

const plan = computed(() => data.value?.plan || { historyDays: 7, archiveMb: 50, formats: [] });
const jobs = computed(() => data.value?.jobs || []);
const activity = computed(() => data.value?.activity || []);
const stats = computed(() => data.value?.stats || { jobs: 0, codes: 0, storage: 0 });
const canZip = computed(() => (plan.value.formats || []).includes('zip'));
const canPdf = computed(() => (plan.value.formats || []).includes('pdf'));
const storagePct = computed(() => {
  const max = Number(plan.value.archiveMb || 0) * 1024 * 1024;
  return max ? Math.min(100, Math.round((stats.value.storage || 0) / max * 100)) : 0;
});
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
const statusLabel = { queued: 'В очереди', running: 'Генерация', done: 'Готово', error: 'Ошибка' };
const statusClass = { done: 'text-emerald-500', error: 'text-red-500', queued: 'text-slate-500', running: 'text-amber-500' };
const modeLabel = { cz: 'ЧЗ', gs1: 'GS1', text: 'Текст' };
const kindLabel = { cz_verify: 'Проверка ЧЗ', labels_pdf: 'PDF этикеток' };
const kindIcon = { cz_verify: 'cz', labels_pdf: 'label' };

async function load() {
  loading.value = true; error.value = '';
  try { data.value = await api.history(); }
  catch (e) { error.value = e.message; }
  finally { loading.value = false; }
}

async function retry(job) {
  busyId.value = job.id; error.value = ''; notice.value = '';
  try { await api.retryJob(job.id); notice.value = 'Задание поставлено в очередь'; await load(); }
  catch (e) { error.value = e.message; }
  finally { busyId.value = null; }
}

async function remove(job) {
  if (!confirm(`Удалить «${job.name}» и его архив? Действие необратимо.`)) return;
  busyId.value = job.id; error.value = ''; notice.value = '';
  try { await api.deleteJob(job.id); notice.value = 'Задание удалено'; await load(); }
  catch (e) { error.value = e.message; }
  finally { busyId.value = null; }
}

onMounted(load);
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/history" />
    <section class="space-y-6 min-w-0">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="font-display font-bold text-3xl">История работ</h1>
          <p class="text-sm text-slate-500 mt-1">Пакеты, проверки и печать — всё в одном месте.</p>
        </div>
        <button class="btn-ghost !py-2 !px-3 text-sm" :disabled="loading" @click="load">↻ Обновить</button>
      </div>

      <div v-if="error" class="text-sm text-red-500">{{ error }}</div>
      <div v-if="notice" class="text-sm text-emerald-500">{{ notice }}</div>

      <PageGuide
        id="history"
        title="Как пользоваться историей"
        :steps="[
          'Во вкладке «Пакеты» хранятся результаты генерации: название, дата, количество кодов и размер архива.',
          'Кнопка «Скачать ZIP» отдаёт готовый архив, «PDF» — лист с этикетками. Скачайте нужное до истечения срока хранения.',
          'Проверки ЧЗ и печать PDF собраны во вкладке «Другие операции».'
        ]"
        note="Срок хранения и размер архива зависят от тарифа. Старые архивы удаляются автоматически."
      />

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ stats.jobs }}</div><div class="text-xs text-slate-500 mt-1">пакетов</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ Number(stats.codes || 0).toLocaleString('ru') }}</div><div class="text-xs text-slate-500 mt-1">кодов</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ fmtBytes(stats.storage) }}</div><div class="text-xs text-slate-500 mt-1">из {{ formatArchiveSize(plan.archiveMb) }} архива</div></div>
        <div class="glass rounded-2xl p-4"><div class="text-2xl font-extrabold">{{ plan.historyDays }} дн.</div><div class="text-xs text-slate-500 mt-1">срок хранения</div></div>
      </div>

      <div class="glass rounded-2xl p-4 text-xs text-slate-500">
        <div class="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
          <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-accent-500" :style="{ width: storagePct + '%' }"></div>
        </div>
        <div class="flex flex-wrap items-center gap-2 mt-2">
          <span>Занято {{ storagePct }}% архива.</span>
          <span>Архивы хранятся в сжатом ZIP на сервере сервиса и автоматически удаляются через {{ plan.historyDays }} дней. Скачайте нужное заранее.</span>
          <router-link v-if="!canZip" to="/app/billing" class="text-brand-400 font-medium">PRO: 30 дней и 2 ГБ →</router-link>
          <router-link v-else-if="plan.historyDays < 1095" to="/app/billing" class="text-brand-400 font-medium">Нужно дольше? Архив на 3 года →</router-link>
        </div>
      </div>

      <div class="flex gap-2">
        <button class="btn-ghost !py-2 !px-3 text-sm" :class="tab === 'jobs' ? '!bg-brand-500/10 !text-brand-400' : ''" @click="tab = 'jobs'">Пакеты ({{ jobs.length }})</button>
        <button class="btn-ghost !py-2 !px-3 text-sm" :class="tab === 'activity' ? '!bg-brand-500/10 !text-brand-400' : ''" @click="tab = 'activity'">Другие операции ({{ activity.length }})</button>
      </div>

      <p v-if="loading" class="text-sm text-slate-500">Загружаем историю…</p>

      <div v-else-if="tab === 'jobs'" class="space-y-3">
        <p v-if="!jobs.length" class="glass rounded-2xl p-8 text-sm text-slate-500 text-center">Пока нет пакетов. <router-link to="/app/generate" class="text-brand-400 font-medium">Сгенерировать первый →</router-link></p>
        <div v-for="j in jobs" :key="j.id" class="glass rounded-2xl p-4">
          <div class="flex flex-wrap items-start gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold truncate">{{ j.name }}</span>
                <span class="text-[11px] rounded-full bg-slate-100 dark:bg-white/10 px-2 py-0.5">{{ modeLabel[j.mode] || j.mode }} · {{ (j.format || 'png').toUpperCase() }}</span>
                <span class="text-xs" :class="statusClass[j.status]">{{ statusLabel[j.status] || j.status }}</span>
              </div>
              <div class="text-xs text-slate-500 mt-1">
                {{ fmtDate(j.created_at) }} · {{ j.done }}/{{ j.valid }} кодов
                <span v-if="j.artifact_size"> · архив {{ fmtBytes(j.artifact_size) }}</span>
                <span v-if="j.artifact_backend === 's3'"> · S3</span>
                <span v-if="j.expires_at"> · хранится до {{ fmtDate(j.expires_at) }}</span>
              </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <a v-if="j.status === 'done' && canZip" :href="`/api/jobs/${j.id}/archive`" class="btn-primary !py-1.5 !px-3 text-xs">Скачать ZIP</a>
              <a v-if="j.status === 'done' && canPdf" :href="`/api/jobs/${j.id}/export?format=pdf`" class="btn-ghost !py-1.5 !px-3 text-xs">PDF</a>
              <button v-if="['done', 'error'].includes(j.status)" class="btn-ghost !py-1.5 !px-3 text-xs" :disabled="busyId === j.id" @click="retry(j)">Повторить</button>
              <button class="btn-ghost !py-1.5 !px-3 text-xs text-red-500" :disabled="busyId === j.id" @click="remove(j)">Удалить</button>
            </div>
          </div>
        </div>
      </div>

      <div v-else class="space-y-3">
        <p v-if="!activity.length" class="glass rounded-2xl p-8 text-sm text-slate-500 text-center">Пока нет проверок и печати.</p>
        <div v-for="a in activity" :key="a.id" class="glass rounded-2xl p-4 flex flex-wrap items-start gap-3">
          <div class="shrink-0"><BrandIcon :name="kindIcon[a.kind] || 'info'" :size="20" /></div>
          <div class="min-w-0 flex-1">
            <div class="font-semibold">{{ a.title || kindLabel[a.kind] || a.kind }}</div>
            <div class="text-xs text-slate-500 mt-1">
              {{ fmtDate(a.created_at) }}
              <span v-if="a.total"> · обработано {{ a.total }}</span>
              <span v-if="a.fail"> · ошибок {{ a.fail }}</span>
              <span v-if="a.expires_at"> · до {{ fmtDate(a.expires_at) }}</span>
            </div>
          </div>
          <span class="text-xs" :class="a.status === 'ok' ? 'text-emerald-500' : 'text-red-500'"><BrandIcon :name="a.status === 'ok' ? 'check' : 'close'" :size="13" /></span>
        </div>
      </div>
    </section>
  </div>
</template>
