<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { api } from '../api.js';
import { store } from '../store.js';
import { importPdf } from '../lib/pdfImport.js';
import { buildCznCsv, downloadCznCsv } from '../lib/cznCsv.js';
import SideNav from '../components/SideNav.vue';
import BrandIcon from '../components/BrandIcon.vue';
import ValidHint from '../components/ValidHint.vue';
import PageGuide from '../components/PageGuide.vue';

const mode = ref('cz');
const modes = [
  { id: 'cz', t: 'Честный ЗНАК', d: 'GTIN + серийник + криптохвост (91/92)' },
  { id: 'gs1', t: 'GS1 DataMatrix', d: 'GTIN + серийник, без криптохвоста' },
  { id: 'text', t: 'Произвольный текст', d: 'Обычный DataMatrix без GS1' }
];
const step = ref('input'); // input | preview | generating | result
const rows = ref([]);
const fileName = ref('');
const pasteText = ref('');
const inputTab = ref('file');
const error = ref('');
const notice = ref('');
const busy = ref(false);
const reading = ref(false);
const pdfProgress = ref(null);
const pdfWarning = ref('');
const exportCodes = ref([]);
const preview = ref(null);
const jobName = ref('');
const format = ref('png');
const job = ref(null);
const items = ref([]);
const history = ref([]);
let poll = null;

const canExport = (f) => store.plan?.formats.includes(f);
const validCount = computed(() => preview.value?.valid ?? 0);

function extractRows(sheetRows) {
  if (!sheetRows.length) return [];
  const header = sheetRows[0].map(c => String(c ?? '').toLowerCase());
  const gi = header.findIndex(h => h.includes('gtin') || h.includes('гтин'));
  const si = header.findIndex(h => h.includes('serial') || h.includes('серий'));
  const ci = header.findIndex(h => h.includes('crypto') || h.includes('крипто') || h.includes('хвост'));
  const hasHeader = gi >= 0 || si >= 0 || ci >= 0 || header.some(h => /код|code|data|маркир/.test(h));
  const body = hasHeader ? sheetRows.slice(1) : sheetRows;
  if (gi >= 0 && si >= 0) {
    return body.map(r => {
      const gtin = String(r[gi] ?? '').trim();
      const serial = String(r[si] ?? '').trim();
      const crypto = ci >= 0 ? String(r[ci] ?? '').trim() : '';
      if (!gtin && !serial) return '';
      let s = `(01)${gtin}(21)${serial}`;
      if (crypto) s += crypto.startsWith('(') ? crypto : `(91)${crypto.slice(0, 4)}(92)${crypto.slice(4)}`;
      return s;
    }).filter(Boolean);
  }
  let idx = 0;
  if (hasHeader) { const f = header.findIndex(h => /код|code|data|маркир/.test(h)); if (f >= 0) idx = f; }
  return body.map(r => String(r[idx] ?? '').trim()).filter(Boolean);
}

async function onFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  error.value = '';
  fileName.value = file.name;
  rows.value = [];
  pdfProgress.value = null;
  pdfWarning.value = '';
  try {
    const head = await file.slice(0, 1024).text();
    const isPdf = head.includes('%PDF-') || /\.pdf$/i.test(file.name);
    if (isPdf) {
      reading.value = true;
      const result = await importPdf(file, (p) => { pdfProgress.value = p; });
      rows.value = result.codes;
      if (result.failed) {
        pdfWarning.value = `Не удалось распознать ${result.failed} из ${result.pages} страниц — в них нет читаемого DataMatrix.`;
      }
      if (!rows.value.length) {
        fileName.value = '';
        error.value = 'В PDF не найдены коды. Нет текстового слоя и не читается DataMatrix на страницах — проверьте, что в файле есть штрихкод.';
      }
      return;
    }
    if (!/\.(csv|xlsx|xls|txt)$/i.test(file.name)) {
      fileName.value = '';
      error.value = 'Поддерживаются PDF, CSV, XLSX, XLS и TXT.';
      return;
    }
    if (/\.txt$/i.test(file.name)) {
      rows.value = (await file.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } else {
      // xlsx грузим только для таблиц, а не при открытии страницы.
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rows.value = extractRows(XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }));
    }
    if (!rows.value.length) error.value = 'Не удалось извлечь строки из файла';
  } catch (e) {
    error.value = 'Ошибка чтения файла: ' + e.message;
  } finally {
    reading.value = false;
    ev.target.value = '';
  }
}

function usePaste() {
  rows.value = pasteText.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  fileName.value = 'вставленный текст';
  if (!rows.value.length) error.value = 'Вставьте хотя бы одну строку';
}

async function doValidate() {
  error.value = ''; notice.value = ''; busy.value = true;
  try {
    preview.value = await api.validate({ mode: mode.value, rows: rows.value });
    exportCodes.value = preview.value.items.filter(i => i.ok).map(i => rows.value[i.row]);
    step.value = 'preview';
  } catch (e) { error.value = e.message; }
  busy.value = false;
}

function downloadForCz() {
  error.value = '';
  notice.value = '';
  const codes = exportCodes.value.length
    ? exportCodes.value
    : items.value.filter(i => i.status !== 'invalid').map(i => i.normalized || i.raw);
  const result = buildCznCsv(codes);
  if (result.error) { error.value = result.error; return; }
  const name = downloadCznCsv(result.csv, result.count);
  notice.value = `CSV для отчёта о нанесении готов: ${result.count} кодов · ${name}`;
}

async function doGenerate() {
  error.value = ''; busy.value = true;
  try {
    const d = await api.createJob({ name: jobName.value || fileName.value || 'Пакет', mode: mode.value, format: format.value, rows: rows.value });
    job.value = d.job; items.value = [];
    step.value = 'generating';
    poll = setInterval(refreshJob, 800);
  } catch (e) { error.value = e.message; }
  busy.value = false;
}

async function refreshJob() {
  if (!job.value) return;
  try {
    const d = await api.job(job.value.id);
    job.value = d.job; items.value = d.items;
    if (d.job.status === 'done' || d.job.status === 'error') {
      clearInterval(poll); poll = null;
      step.value = 'result';
      loadHistory();
      store.load();
    }
  } catch { clearInterval(poll); poll = null; }
}

async function openJob(id) {
  error.value = '';
  try {
    const d = await api.job(id);
    job.value = d.job; items.value = d.items;
    step.value = d.job.status === 'done' || d.job.status === 'error' ? 'result' : 'generating';
    if (step.value === 'generating' && !poll) poll = setInterval(refreshJob, 800);
  } catch (e) { error.value = e.message; }
}

async function removeJob(id) {
  try { await api.deleteJob(id); if (job.value?.id === id) reset(); loadHistory(); } catch (e) { error.value = e.message; }
}

async function retryJob(id) {
  error.value = ''; notice.value = '';
  try {
    await api.retryJob(id);
    await openJob(id);
    loadHistory();
  } catch (e) { error.value = e.message; }
}

async function loadHistory() { try { history.value = (await api.jobs()).jobs; } catch {} }
function reset() {
  if (poll) { clearInterval(poll); poll = null; }
  step.value = 'input'; rows.value = []; preview.value = null; job.value = null; items.value = [];
  fileName.value = ''; pasteText.value = ''; error.value = ''; notice.value = ''; exportCodes.value = [];
}
onUnmounted(() => { if (poll) clearInterval(poll); });
loadHistory();

const statusLabel = { queued: 'В очереди', running: 'Генерация…', done: 'Готово', error: 'Ошибка' };
const itemStatus = { ok: 'ожидает', generated: 'готов', invalid: 'ошибка' };
</script>

<template>
  <div class="max-w-[1680px] mx-auto px-4 py-10 grid lg:grid-cols-[240px_1fr] gap-8">
    <SideNav active="/app/generate" />
    <section class="space-y-6 min-w-0">
      <div class="flex items-center justify-between gap-4 flex-wrap">
        <h1 class="font-display font-bold text-3xl">Генерация DataMatrix</h1>
        <button v-if="step !== 'input'" class="btn-ghost" @click="reset">← Новый пакет</button>
      </div>

      <p v-if="notice" class="text-sm text-emerald-500">{{ notice }}</p>

      <PageGuide
        v-if="step === 'input'"
        id="generator"
        title="Генерация за 3 шага"
        :steps="[
          'Выберите режим: «Честный ЗНАК» для КИЗ, «GS1» для обычных GS1-кодов, «Текст» для произвольного текста.',
          'Загрузите файл или вставьте коды — по одному на строку. Подойдут CSV, XLSX, TXT и PDF.',
          'Проверьте пакет и скачайте PDF, ZIP или отдельные PNG/SVG.'
        ]"
        note="Если в файле есть ошибки — сервис покажет их до генерации, и вы сможете исправить."
      />

      <!-- шаг 1: ввод -->
      <div v-if="step === 'input'" class="space-y-6">
        <div class="grid md:grid-cols-3 gap-3">
          <button v-for="m in modes" :key="m.id" @click="mode = m.id"
            class="glass rounded-2xl p-4 text-left transition"
            :class="mode === m.id ? 'ring-2 ring-brand-500/70' : 'opacity-70 hover:opacity-100'">
            <div class="font-display font-semibold text-sm mb-1">{{ m.t }}</div>
            <div class="text-xs text-slate-500">{{ m.d }}</div>
          </button>
        </div>

        <div class="glass rounded-2xl p-6">
          <div class="flex gap-2 mb-4">
            <button class="btn-ghost !py-1.5" :class="inputTab === 'file' ? 'ring-2 ring-brand-500/60' : ''" @click="inputTab = 'file'">Файл</button>
            <button class="btn-ghost !py-1.5" :class="inputTab === 'paste' ? 'ring-2 ring-brand-500/60' : ''" @click="inputTab = 'paste'">Вставить текст</button>
          </div>
          <div v-if="inputTab === 'file'">
            <label class="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-white/20 rounded-2xl p-10 cursor-pointer hover:border-brand-500/60 transition">
              <span class="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/10 ring-1 ring-violet-500/20"><BrandIcon name="upload" :size="30" /></span>
              <span class="font-semibold">{{ fileName || 'Перетащите или выберите файл' }}</span>
              <span class="text-xs text-slate-500 mt-1">PDF (текст или DataMatrix), CSV, XLSX, TXT · коды GTIN/Serial/Crypto или один столбец</span>
              <span class="text-[11px] text-slate-400 mt-1">В PDF считаются только сами коды маркировки, а не строки файла</span>
              <input type="file" accept=".pdf,.csv,.xlsx,.xls,.txt" class="hidden" @change="onFile">
            </label>
          </div>
          <div v-else>
            <textarea v-model="pasteText" rows="8" class="input font-mono text-sm" placeholder="По одному коду на строку:&#10;(01)04600000000015(21)5PojkV(91)EE10(92)dGVzdA==&#10;или raw с GS-разделителями"></textarea>
            <button class="btn-ghost mt-3" @click="usePaste">Использовать текст</button>
          </div>
          <p v-if="reading" class="mt-4 text-sm text-slate-500">
            <template v-if="pdfProgress">
              {{ pdfProgress.phase === 'text' ? 'Читаем текст PDF' : 'Распознаём DataMatrix' }}: {{ pdfProgress.page }} / {{ pdfProgress.total }}<span v-if="pdfProgress.phase === 'barcode'"> · найдено {{ pdfProgress.found }}</span>
              <span v-if="pdfProgress.total > 100" class="text-xs">— не закрывайте вкладку</span>
            </template>
            <template v-else>Читаем PDF и ищем коды маркировки…</template>
          </p>
          <p v-if="pdfWarning" class="mt-2 text-sm text-amber-500">{{ pdfWarning }}</p>
          <p v-if="rows.length" class="mt-4 text-sm text-slate-500">Извлечено кодов: <b class="text-slate-700 dark:text-slate-200">{{ rows.length }}</b> <span v-if="fileName">· {{ fileName }}</span> <span class="text-xs">— один код = одна строка</span></p>
          <p v-if="error" class="mt-3 text-sm text-red-500">{{ error }}</p>
          <button class="btn-primary mt-5" :disabled="!rows.length || busy || reading" @click="doValidate">
            {{ reading ? 'Читаем PDF…' : busy ? 'Проверяем…' : 'Проверить данные →' }}
          </button>
        </div>
      </div>

      <!-- шаг 2: предпросмотр -->
      <div v-if="step === 'preview' && preview" class="space-y-6">
        <div class="glass rounded-2xl p-6">
          <div class="flex flex-wrap gap-6 items-center">
            <div><div class="text-3xl font-extrabold text-emerald-500">{{ preview.valid }}</div><div class="text-xs text-slate-500">валидных</div></div>
            <div><div class="text-3xl font-extrabold text-red-500">{{ preview.total - preview.valid }}</div><div class="text-xs text-slate-500">с ошибками</div></div>
            <div class="text-sm text-slate-500">Лимит пакета: {{ store.plan?.batchMax }} · осталось операций: {{ store.usage?.ops?.left ?? '∞' }}<template v-if="store.usage?.daily?.limit"> · сегодня {{ store.usage.daily.used }} / {{ store.usage.daily.limit }}</template></div>
          </div>
          <ValidHint class="mt-3" />
        </div>
        <div class="glass rounded-2xl p-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-2 pr-3">#</th><th class="py-2 pr-3">Код</th><th class="py-2 pr-3">GTIN</th><th class="py-2 pr-3">Серийник</th><th class="py-2">Статус</th>
            </tr></thead>
            <tbody>
              <tr v-for="it in preview.items.slice(0, 50)" :key="it.row" class="border-b border-slate-100 dark:border-white/5">
                <td class="py-2 pr-3 text-slate-500">{{ it.row + 1 }}</td>
                <td class="py-2 pr-3 font-mono text-xs max-w-[260px] truncate" :title="it.raw">{{ it.raw }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ it.gtin || '—' }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ it.serial || '—' }}</td>
                <td class="py-2">
                  <span v-if="it.ok" class="text-emerald-500"><BrandIcon name="check" :size="13" class="inline-block mr-0.5 -mt-0.5" />ок</span>
                  <span v-else class="text-red-500" :title="it.error"><BrandIcon name="close" :size="13" class="inline-block mr-0.5 -mt-0.5" />{{ it.error }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="preview.items.length > 50" class="text-xs text-slate-500 mt-2">Показаны первые 50 из {{ preview.items.length }}</p>
        </div>
        <div class="glass rounded-2xl p-6 flex flex-wrap gap-4 items-end">
          <div class="flex-1 min-w-[200px]"><label class="label">Название пакета</label><input v-model="jobName" class="input" :placeholder="fileName || 'Мой пакет'"></div>
          <div><label class="label">Формат</label>
            <select v-model="format" class="input"><option value="png">PNG</option><option value="svg">SVG</option></select>
          </div>
          <button class="btn-ghost" :disabled="!validCount" title="Один CSV-файл для отчёта о нанесении: полные коды с GS, поля экранированы" @click="downloadForCz"><BrandIcon name="download" :size="15" class="inline-block mr-1 -mt-0.5" />CSV для отчёта ЧЗ</button>
          <button class="btn-primary" :disabled="!validCount || busy" @click="doGenerate">
            {{ busy ? 'Создаём…' : `Сгенерировать ${validCount} кодов` }}
          </button>
        </div>
        <p class="text-xs text-slate-500">CSV для «Честного знака»: полные коды с GS-разделителями и кавычками по RFC 4180 — один файл для отчёта о нанесении.</p>
        <p v-if="error" class="text-sm text-red-500">{{ error }}</p>
      </div>

      <!-- шаг 3: генерация -->
      <div v-if="step === 'generating' && job" class="glass rounded-2xl p-8 text-center">
        <div class="font-display font-semibold text-xl mb-2">{{ statusLabel[job.status] || job.status }}</div>
        <div class="text-4xl font-extrabold mb-4">{{ job.done }} <span class="text-lg text-slate-500">/ {{ job.valid }}</span></div>
        <div class="h-3 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden max-w-md mx-auto">
          <div class="h-full bg-gradient-to-r from-brand-500 to-accent-500 transition-all" :style="{ width: (job.valid ? Math.round(job.done / job.valid * 100) : 0) + '%' }"></div>
        </div>
      </div>

      <!-- шаг 4: результат -->
      <div v-if="step === 'result' && job" class="space-y-6">
        <div class="glass rounded-2xl p-6">
          <div class="flex flex-wrap items-center gap-4 justify-between">
            <div>
              <div class="font-display font-semibold text-lg">{{ job.name }}</div>
              <div class="text-sm text-slate-500">{{ statusLabel[job.status] }} · сгенерировано {{ job.done }} из {{ job.valid }} <span v-if="job.error" class="text-red-500">· {{ job.error }}</span></div>
            </div>
            <div class="flex gap-2 flex-wrap">
              <button class="btn-ghost !py-2.5" @click="downloadForCz"><BrandIcon name="download" :size="15" class="inline-block mr-1 -mt-0.5" />CSV для отчёта ЧЗ</button>
              <a v-if="canExport('zip')" :href="`/api/jobs/${job.id}/export?format=zip`" class="btn-primary !py-2.5"><BrandIcon name="download" :size="15" class="inline-block mr-1 -mt-0.5" />ZIP</a>
              <a v-if="canExport('pdf')" :href="`/api/jobs/${job.id}/export?format=pdf`" class="btn-primary !py-2.5"><BrandIcon name="download" :size="15" class="inline-block mr-1 -mt-0.5" />PDF А4</a>
              <span v-if="!canExport('zip')" class="chip-soon self-center">ZIP/PDF — PRO</span>
              <button v-if="job.status === 'error'" class="btn-ghost !py-2.5" @click="retryJob(job.id)"><BrandIcon name="refresh" :size="15" class="inline-block mr-1 -mt-0.5" />Повторить</button>
              <button class="btn-ghost !py-2.5 text-red-500" @click="removeJob(job.id)">Удалить</button>
            </div>
          </div>
        </div>
        <div class="glass rounded-2xl p-6 overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-slate-500 border-b border-slate-200 dark:border-white/10">
              <th class="py-2 pr-3">#</th><th class="py-2 pr-3">GTIN</th><th class="py-2 pr-3">Серийник</th><th class="py-2 pr-3">Статус</th><th class="py-2">Файлы</th>
            </tr></thead>
            <tbody>
              <tr v-for="it in items" :key="it.row_index" class="border-b border-slate-100 dark:border-white/5">
                <td class="py-2 pr-3 text-slate-500">{{ it.row_index + 1 }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ it.gtin || '—' }}</td>
                <td class="py-2 pr-3 font-mono text-xs">{{ it.serial || '—' }}</td>
                <td class="py-2 pr-3">
                  <span v-if="it.status === 'generated'" class="text-emerald-500"><BrandIcon name="check" :size="13" class="inline-block mr-0.5 -mt-0.5" />готов</span>
                  <span v-else-if="it.status === 'invalid'" class="text-red-500" :title="it.error"><BrandIcon name="close" :size="13" class="inline-block mr-0.5 -mt-0.5" />{{ it.error }}</span>
                  <span v-else class="text-slate-500">{{ itemStatus[it.status] || it.status }}</span>
                </td>
                <td class="py-2">
                  <template v-if="it.status === 'generated'">
                    <a class="text-brand-400 font-medium mr-3" :href="`/api/jobs/${job.id}/item/${it.row_index}.png`" download>PNG</a>
                    <a class="text-brand-400 font-medium" :href="`/api/jobs/${job.id}/item/${it.row_index}.svg`" download>SVG</a>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- история -->
      <div v-if="history.length" class="glass rounded-2xl p-6">
        <div class="flex items-center justify-between gap-2 mb-4">
          <h2 class="font-display font-semibold">История пакетов</h2>
          <router-link to="/app/history" class="text-xs text-brand-400 font-medium">Вся история →</router-link>
        </div>
        <div class="space-y-2">
          <div v-for="h in history" :key="h.id" class="flex items-center gap-3 text-sm rounded-xl border border-slate-200 dark:border-white/10 px-4 py-2.5">
            <button class="font-medium hover:text-brand-400 truncate" @click="openJob(h.id)">{{ h.name }}</button>
            <span class="text-slate-500 text-xs">{{ h.mode.toUpperCase() }} · {{ h.done }}/{{ h.valid }}</span>
            <span class="ml-auto text-xs" :class="h.status === 'done' ? 'text-emerald-500' : h.status === 'error' ? 'text-red-500' : 'text-slate-500'">{{ statusLabel[h.status] || h.status }}</span>
            <button class="text-slate-400 hover:text-red-500" @click="removeJob(h.id)"><BrandIcon name="close" :size="17" /></button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
